"""The wall's voice box: its ears and its voice, for anything on this machine
that wants them (the wall's server passes them on to phones, computers and
Hermes: docs/voice-server.md).

    GET  /health       { stt, tts, model, voices: [{ name, description }] }
    POST /transcribe   a WAV (any rate, 16-bit) -> { text }
    POST /speech       { text, voice?, duration_delta? } -> a 24 kHz WAV

It listens on 127.0.0.1 only (WALL_VOICEBOX_PORT, default 3011): the
service may talk to nothing but this machine, and the wall's server is the
one that checks who is asking.

Pace: WALL_VOICE_DURATION_DELTA shifts every reply's speaking rate
(phonon's duration_delta: +0.2/0.3 slower and calmer, -0.3 faster, 0 the
default). A request's own duration_delta paces that reply alone, clamped
to ±0.5 — beyond that speech gets unreliable. What the voice says for
things it trips on (acronyms, file names, symbols) lives in
data/voice-lexicon.json, re-read the moment the file changes.

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
import re
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
DELTA_MAX = 0.5
LEXICON_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "voice-lexicon.json")


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


def clamp_delta(value):
    """A pace shift kept where Phonon stays reliable (small is best)."""
    return max(-DELTA_MAX, min(DELTA_MAX, value))


def duration_delta_env():
    """Every reply's pace: WALL_VOICE_DURATION_DELTA (0.0, the default, is unchanged)."""
    try:
        return clamp_delta(float(os.environ.get("WALL_VOICE_DURATION_DELTA", "") or 0.0))
    except (TypeError, ValueError):
        return 0.0


def request_delta(value):
    """One request's pace (the duration_delta body key): a number clamped
    to ±0.5, or None when absent or not a number (the env's pace applies)."""
    if value is None or isinstance(value, bool):
        return None
    try:
        return clamp_delta(float(value))
    except (TypeError, ValueError):
        return None


_lexicon = {"path": None, "mtime": None, "rules": []}


def lexicon_path():
    return os.environ.get("WALL_VOICE_LEXICON") or LEXICON_FILE


def load_lexicon(log=print):
    """data/voice-lexicon.json -> [(regex, replacement)]: acronym entries first
    (whole-word, case-sensitive), then the ordered rewrites. Re-read the moment
    the file changes; a half-written or broken save keeps the last good copy,
    and a missing one says nothing. Never raises."""
    path = lexicon_path()
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        mtime = None
    if _lexicon["path"] == path and _lexicon["mtime"] == mtime:
        return _lexicon["rules"]
    if mtime is None:
        _lexicon.update({"path": path, "mtime": None, "rules": []})
        return []
    rules = []
    try:
        with open(path, encoding="utf8") as f:
            data = json.load(f)
    except (OSError, ValueError) as e:
        log("voice: lexicon unreadable:", e)
        rules = _lexicon["rules"] if _lexicon["path"] == path else []
    else:
        for word, said in (data.get("acronyms") or {}).items():
            if isinstance(word, str) and isinstance(said, str) and word:
                rules.append((re.compile(r"\b" + re.escape(word) + r"\b"), said))
        for rewrite in data.get("rewrites") or []:
            if not isinstance(rewrite, dict):
                continue
            try:
                rx = re.compile(str(rewrite.get("pattern", "")))
                said = str(rewrite.get("replace", ""))
                rx.sub(said, "")  # a bad backreference fails here, not mid-speech
            except re.error:
                continue
            rules.append((rx, said))
    _lexicon.update({"path": path, "mtime": mtime, "rules": rules})
    return rules


def speakable(text, rules):
    """The text said right: the lexicon's acronyms spelt out and its rewrites applied."""
    for rx, said in rules:
        text = rx.sub(said, text)
    return " ".join(text.split())


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
            delta = duration_delta_env()
            self._tts = ptts.TTS(
                path,
                lang="en",
                quant="q8_0",
                conditions={"duration_delta": delta} if delta else None,
                voice_catalog=voices if os.path.isdir(voices) else None,
            )
            self.log(f"voice: {os.path.basename(path)} loaded")
        return self._tts

    def speak(self, text, voice=None, duration_delta=None):
        """-> (WAV bytes, seconds). Unknown voices fall back to the default.
        duration_delta paces this reply alone (+ slower, - faster); without it,
        WALL_VOICE_DURATION_DELTA paces them all."""
        with self._lock:
            tts = self._engine()
            text = speakable(text, load_lexicon(self.log))
            names = {v["name"].lower(): v["name"] for v in read_voices(self.folder)}
            pick = names.get(str(voice or "").lower()) or names.get(DEFAULT_VOICE.lower())
            if duration_delta is not None:
                tts.set_conditions({"duration_delta": duration_delta})
            try:
                samples = tts.synth(text, voice=pick) if pick else tts.synth(text)
            finally:
                if duration_delta is not None:
                    tts.set_conditions({"duration_delta": duration_delta_env()})
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
                        audio, seconds = box.voice.speak(text, req.get("voice"), request_delta(req.get("duration_delta")))
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
