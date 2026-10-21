"""The wall's voice box: its ears and its voice, for anything on this machine
that wants them (the wall's server passes them on to phones, computers and
Hermes: docs/voice-server.md).

    GET  /health       { stt, tts, model, voices: [{ name, description }] }
    POST /transcribe   a WAV (any rate, 16-bit) -> { text }
    POST /speech       { text, voice? } -> a 24 kHz WAV

It listens on 127.0.0.1 only (WALL_VOICEBOX_PORT, default 3011): the
service may talk to nothing but this machine, and the wall's server is the
one that checks who is asking.

Ears: the same Parakeet the microphone uses (stt.shared), so it costs no
extra memory. Voice: Phonon (Gradium), a 31M-parameter speech model that
runs on the CPU in a few times real time with about 0.1 s before the first
sound, and comes with about a hundred voices. scripts/senses/install.sh
fetches it into the models folder; nothing is downloaded at run time.
"""

import importlib.util
import io
import json
import os
import shutil
import subprocess
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .stt import model_ready, models_dir, shared

DEFAULT_PORT = 3011
MAX_AUDIO = 25 * 1024 * 1024  # about 13 minutes of 16 kHz WAV
MAX_TEXT = 1000
# the larger model when it was fetched (it needs a Hugging Face sign-in), else the open one
PHONON_MODELS = ("phonon-40m-en", "phonon-31m-en")
PHONON_FILES = ("config.json", "model.q8.gguf", "tokenizer.json")
VOICES_DIR = "phonon-voices"
DEFAULT_VOICE = "Easton"


def port():
    try:
        return int(os.environ.get("WALL_VOICEBOX_PORT", DEFAULT_PORT))
    except ValueError:
        return DEFAULT_PORT


def phonon_model(folder):
    """The Phonon model folder in the models folder, or None."""
    for name in PHONON_MODELS:
        path = os.path.join(folder, name)
        if all(os.path.isfile(os.path.join(path, f)) for f in PHONON_FILES):
            return path
    return None


def read_voices(folder):
    """The voices fetched with the model: [{ name, description }], English only."""
    path = os.path.join(folder, VOICES_DIR, "voices.jsonl")
    out = []
    try:
        with open(path, encoding="utf8") as f:
            for line in f:
                try:
                    v = json.loads(line)
                except ValueError:
                    continue
                file = os.path.join(folder, VOICES_DIR, v.get("filename") or "")
                if v.get("name") and (v.get("language") or "en") == "en" and os.path.isfile(file):
                    out.append({"name": v["name"], "description": v.get("description") or ""})
    except OSError:
        pass
    return out


def decode_wav(data):
    """A WAV file's bytes -> (float32 mono samples, sample rate). Raises ValueError."""
    import numpy as np  # noqa: PLC0415

    try:
        with wave.open(io.BytesIO(data)) as w:
            if w.getsampwidth() != 2:
                raise ValueError("only 16-bit WAV")
            rate, channels = w.getframerate(), w.getnchannels()
            frames = w.readframes(w.getnframes())
    except (wave.Error, EOFError) as e:
        raise ValueError(str(e)) from e
    audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    return audio, rate


def decode_any(data):
    """Any audio ffmpeg can read (ogg, webm, m4a, mp3) -> 16 kHz mono samples."""
    import numpy as np  # noqa: PLC0415

    if data[:4] == b"RIFF":
        return decode_wav(data)
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise ValueError("send a 16-bit WAV (ffmpeg is not installed to read other kinds)")
    run = subprocess.run(
        [ffmpeg, "-loglevel", "error", "-i", "pipe:0", "-f", "s16le", "-ac", "1", "-ar", "16000", "pipe:1"],
        input=data,
        capture_output=True,
        timeout=60,
        check=False,
    )
    if run.returncode != 0 or not run.stdout:
        raise ValueError("could not read that audio")
    return np.frombuffer(run.stdout, dtype=np.int16).astype(np.float32) / 32768.0, 16000


def to_16k(audio, rate):
    """Parakeet hears 16 kHz. sherpa-onnx's own resampler costs it words
    (24 kHz Phonon speech came back as "Hay Display, How Far Away..."), so
    it's done here: whole multiples are averaged down (which also filters),
    anything else is interpolated."""
    import numpy as np  # noqa: PLC0415

    if rate == 16000 or not audio.size:
        return audio
    if rate > 16000 and rate % 16000 == 0:
        k = rate // 16000
        n = len(audio) // k
        return audio[: n * k].reshape(n, k).mean(axis=1).astype(np.float32)
    n = int(len(audio) * 16000 / rate)
    return np.interp(np.linspace(0, len(audio) - 1, n), np.arange(len(audio)), audio).astype(np.float32)


def level(audio):
    """Bring a quiet recording up (at most 20x, so hiss stays hiss), as the microphone does."""
    peak = float(abs(audio).max()) if audio.size else 0.0
    return audio * min(20.0, 0.9 / peak) if peak > 1e-4 else audio


def wav_bytes(samples, rate):
    import numpy as np  # noqa: PLC0415

    pcm = (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


class Voice:
    """Phonon, loaded the first time something is said (about 5 s, then
    kept). One sentence at a time."""

    def __init__(self, folder, log=print):
        self.folder = folder
        self.log = log
        self._tts = None
        self._lock = threading.Lock()

    def ready(self):
        # fetched, and ptts installed (install.sh does both; a deploy alone doesn't)
        return phonon_model(self.folder) is not None and importlib.util.find_spec("ptts") is not None

    def model(self):
        path = phonon_model(self.folder)
        return os.path.basename(path) if path else ""

    def _engine(self):
        if self._tts is None:
            import ptts  # noqa: PLC0415  imported here so tests run without it

            path = phonon_model(self.folder)
            if not path:
                raise FileNotFoundError("Phonon is not in " + self.folder)
            voices = os.path.join(self.folder, VOICES_DIR)
            ptts.set_num_threads(int(os.environ.get("WALL_VOICE_THREADS", "2")))
            self._tts = ptts.TTS(
                path, lang="en", quant="q8_0", voice_catalog=voices if os.path.isdir(voices) else None
            )
            self.log(f"voice: {os.path.basename(path)} loaded")
        return self._tts

    def speak(self, text, voice=None):
        """-> (WAV bytes, seconds). Unknown voices fall back to the default."""
        with self._lock:
            tts = self._engine()
            names = {v["name"].lower(): v["name"] for v in read_voices(self.folder)}
            pick = names.get(str(voice or "").lower()) or names.get(DEFAULT_VOICE.lower())
            samples = tts.synth(text, voice=pick) if pick else tts.synth(text)
            return wav_bytes(samples, tts.sample_rate), len(samples) / tts.sample_rate


class VoiceBox:
    def __init__(self, folder=None, log=print):
        self.folder = folder or models_dir()
        self.log = log
        self.voice = Voice(self.folder, log=log)
        self._server = None

    def health(self):
        return {
            "stt": model_ready(self.folder),
            "tts": self.voice.ready(),
            "model": self.voice.model(),
            "voices": read_voices(self.folder),
        }

    def transcribe(self, data):
        audio, rate = decode_any(data)
        if not model_ready(self.folder):
            raise FileNotFoundError("Parakeet is not installed")
        return shared(self.folder).words(level(to_16k(audio, rate)))

    def start(self):
        box = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass  # what people say is never logged

            def _send(self, status, body, kind="application/json"):
                data = body if isinstance(body, bytes) else json.dumps(body).encode("utf8")
                self.send_response(status)
                self.send_header("Content-Type", kind)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def _body(self):
                n = int(self.headers.get("Content-Length") or 0)
                if n <= 0 or n > MAX_AUDIO:
                    return None
                return self.rfile.read(n)

            def do_GET(self):
                if self.path == "/health":
                    return self._send(200, box.health())
                return self._send(404, {"error": "not-found"})

            def do_POST(self):
                body = self._body()
                if body is None:
                    return self._send(413 if int(self.headers.get("Content-Length") or 0) else 400, {"error": "no-body"})
                try:
                    if self.path == "/transcribe":
                        return self._send(200, {"text": box.transcribe(body)})
                    if self.path == "/speech":
                        req = json.loads(body.decode("utf8") or "{}")
                        text = " ".join(str(req.get("text") or "").split())[:MAX_TEXT]
                        if not text:
                            return self._send(400, {"error": "no-text"})
                        if not box.voice.ready():
                            return self._send(503, {"error": "no-voice"})
                        audio, seconds = box.voice.speak(text, req.get("voice"))
                        self.send_response(200)
                        self.send_header("Content-Type", "audio/wav")
                        self.send_header("Content-Length", str(len(audio)))
                        self.send_header("X-Duration-Ms", str(round(seconds * 1000)))
                        self.end_headers()
                        self.wfile.write(audio)
                        return None
                    return self._send(404, {"error": "not-found"})
                except FileNotFoundError:
                    return self._send(503, {"error": "not-installed"})
                except ValueError as e:
                    return self._send(415, {"error": "bad-audio", "detail": str(e)[:200]})
                except Exception as e:  # noqa: BLE001  one bad request must not stop the box
                    box.log("voicebox:", type(e).__name__)
                    return self._send(500, {"error": "failed"})

        try:
            self._server = ThreadingHTTPServer(("127.0.0.1", port()), Handler)
        except OSError as e:
            self.log(f"voicebox: can't listen on 127.0.0.1:{port()} ({e.strerror or e})")
            return False
        self._server.daemon_threads = True
        threading.Thread(target=self._server.serve_forever, name="voicebox", daemon=True).start()
        self.log(f"voicebox: on 127.0.0.1:{port()}")
        return True

    def stop(self):
        if self._server:
            self._server.shutdown()
            self._server.server_close()
            self._server = None
