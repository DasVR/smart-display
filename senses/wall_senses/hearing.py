"""The webcam's ears: hear "hey wall …", and take notes when asked.

Sound comes from the webcam's microphone through PipeWire (`parec`, the same
tool the wall's music visualiser uses), at 16 kHz mono. A loudness gate
(vad.py) cuts it into pieces of speech; Parakeet (stt.py, NVIDIA's Parakeet
TDT 0.6B through sherpa-onnx, on this machine's CPU) turns a piece into words. Nothing is recorded: a piece lives in
memory only until it has been transcribed, and only the words go on.

Two ways to wake it:
  phrase        (default) every piece's first few seconds are transcribed and
                checked for "hey wall"; only then is the rest transcribed and
                sent. Nothing extra to install.
  openwakeword  a small always-on model listens for its wake word and the
                transcriber runs only after it fires. Lighter on the CPU while
                music plays.

While the wall itself is talking, the ears are shut (the server says so), so
the wall never answers itself. When it ends on a question ("Should I add
that to your list?"), the server keeps the ears open a few seconds longer and
the answer needs no "hey wall".
"""

import queue
import re
import shutil
import subprocess
import threading
import time
from collections import deque

from .vad import FRAME_BYTES, FRAME_MS, SAMPLE_RATE, SpeechGate, apply_gain, rms
from .stt import MODEL_NAME, Parakeet, model_ready, models_dir
from .wake import is_noise, match_wake

HEAD_SECONDS = 3.0
# after a bare "hey wall", how long the next thing said counts as the command
AWAIT_SECONDS = 7.0
WEBCAM_HINT = re.compile(r"usb|cam|webcam|brio|c9\d\d|c270|c310|logi|razer|kiyo|elgato|emeet|anker", re.I)


def choose_source(pactl_lines, wanted=""):
    """Which PipeWire/PulseAudio source to listen to.

    pactl_lines: `pactl list short sources` output, one source per line
    (index, name, driver, format, state, tab-separated). `wanted` is a name or
    part of one from settings. Without it, the first microphone that looks
    like a webcam's wins, else the default source. Monitors (what's playing
    out of the speakers) are never chosen.
    """
    names = []
    for line in pactl_lines:
        cols = line.split("\t") if "\t" in line else line.split()
        if len(cols) >= 2 and not cols[1].endswith(".monitor"):
            names.append(cols[1])
    if wanted:
        for n in names:
            if wanted.lower() in n.lower():
                return n
    # the cleaned webcam microphone (scripts/senses/clean-mic.sh), when it's there
    if "wall_mic" in names:
        return "wall_mic"
    for n in names:
        if WEBCAM_HINT.search(n):
            return n
    return "@DEFAULT_SOURCE@"


def list_sources():
    if not shutil.which("pactl"):
        return []
    try:
        out = subprocess.run(["pactl", "list", "short", "sources"], capture_output=True, text=True, timeout=5)
        return [line for line in out.stdout.splitlines() if line.strip()]
    except (OSError, subprocess.SubprocessError):
        return []


def describe_sources(pactl_long):
    """[{name, label}] for every microphone in `pactl list sources` output, so
    the phone can show "HD Pro Webcam C920 Analog Stereo" rather than
    alsa_input.usb-046d_…. Monitors (what the speakers play) are left out."""
    found = []
    name = None
    for raw in pactl_long:
        line = raw.strip()
        if line.startswith("Name:"):
            name = line.split(":", 1)[1].strip()
        elif line.startswith("Description:") and name:
            if not name.endswith(".monitor"):
                found.append({"name": name, "label": line.split(":", 1)[1].strip() or name})
            name = None
    return found


def list_source_details():
    if not shutil.which("pactl"):
        return []
    try:
        out = subprocess.run(["pactl", "list", "sources"], capture_output=True, text=True, timeout=5)
        return describe_sources(out.stdout.splitlines())
    except (OSError, subprocess.SubprocessError):
        return []


def route(text, wake_words, notes, awaiting):
    """What a transcribed piece means.

    Returns ("command", words), ("wake", "") for a bare "hey wall" (listen for
    the command next), ("note", words) while notes are on, or None.
    """
    if is_noise(text):
        return None
    rest = match_wake(text, wake_words)
    if rest is not None:
        return ("command", rest) if rest and not is_noise(rest) else ("wake", "")
    if awaiting:
        return ("command", text.strip().rstrip(".,").strip())
    if notes:
        return ("note", text.strip())
    return None


class Ears:
    def __init__(self, on_heard, log=print, on_decision=None):
        self.on_heard = on_heard
        self.log = log
        # what it made of each piece of sound, in words (diary.py), or None
        self.on_decision = on_decision
        self.source = ""
        self.wake_mode = "phrase"
        self.wake_words = None
        self.oww_model_name = "hey_jarvis"
        self.gain = 3.0
        self.noise = "light"  # noise suppression: off | light | strong
        self.boost = True  # voice boost: cut rumble, lift the speech band
        # how far above the room's noise a voice must rise to count as talking:
        # across the room a voice is barely above a fan (tested: about 2x)
        self.ratio = 1.6
        self.profile = None  # the room's noise (denoise.NoiseProfile), learned while nobody talks
        self.notes = False
        self.hush_until = 0.0
        self.await_until = 0.0
        self.state = "idle"  # idle | listening (after a wake) | thinking (transcribing for the wall)
        self.level = 0.0
        self.error = ""
        # the last thing that went wrong turning speech into words, for the phone
        self.error_detail = ""
        self.device = ""
        # the microphones there are, for the phone's picker: [{name, label}]
        self.sources = []
        self._stop = threading.Event()
        self._threads = []
        self._proc = None
        self._pieces = queue.Queue(maxsize=4)
        self._stt = None
        self._oww = None
        self._lock = threading.Lock()

    # --- settings from the wall -------------------------------------------

    def configure(self, s):
        restart = (s.get("micSource") or "") != self.source or (s.get("wakeMode") or "phrase") != self.wake_mode
        self.source = s.get("micSource") or ""
        self.wake_mode = s.get("wakeMode") or "phrase"
        self.wake_words = s.get("wakeWords") or None
        self.oww_model_name = s.get("wakeModel") or "hey_jarvis"
        try:
            self.gain = max(1.0, min(10.0, float(s.get("micGain") or 3)))
        except (TypeError, ValueError):
            self.gain = 3.0
        self.noise = s.get("noiseSuppress") if s.get("noiseSuppress") in ("off", "light", "strong") else "light"
        self.boost = s.get("voiceBoost", True) is not False
        self.ratio = 3.0 if s.get("hearFrom") == "near" else 1.6
        return restart

    def hush(self, seconds):
        """Shut the ears for a while (the wall is talking)."""
        self.hush_until = max(self.hush_until, time.monotonic() + max(0.0, seconds))

    def listen_for(self, seconds):
        """The wall asked something back: the next thing said is the answer,
        no "hey wall" needed, for this long from now."""
        self.await_until = max(self.await_until, time.monotonic() + max(0.0, seconds))

    def listening(self):
        return time.monotonic() < self.await_until

    def snapshot(self):
        return {
            "ok": self.running() and self.error in ("", "no-openwakeword"),
            "device": self.device,
            "sources": self.sources,
            "level": round(self.level, 4),
            "state": "listening" if self.state == "idle" and self.listening() else self.state,
            "notes": self.notes,
            "wakeMode": self.wake_mode,
            "model": MODEL_NAME,
            "error": self.error or None,
            "detail": self.error_detail or None,
        }

    # --- lifecycle --------------------------------------------------------

    def start(self):
        if self.running():
            return
        self._stop.clear()
        self.error = ""
        self._threads = [
            threading.Thread(target=self._capture, name="ears", daemon=True),
            threading.Thread(target=self._transcribe_loop, name="transcribe", daemon=True),
        ]
        for t in self._threads:
            t.start()

    def stop(self):
        self._stop.set()
        if self._proc:
            try:
                self._proc.terminate()
            except OSError:
                pass
        for t in self._threads:
            t.join(timeout=3)
        self._threads = []
        self.state = "idle"
        self.level = 0.0

    def running(self):
        return any(t.is_alive() for t in self._threads)

    # --- capture ----------------------------------------------------------

    def _open(self):
        if not shutil.which("parec"):
            self.error = "no-parec"
            self.log("ears: parec not found (install pulseaudio-utils)")
            return None
        self.device = choose_source(list_sources(), self.source)
        self.sources = list_source_details()
        self.log(f"ears: listening to {self.device}, turned up {self.gain:g}x")
        # webcams often come up with their microphone at half volume: start from full
        if shutil.which("pactl"):
            try:
                subprocess.run(["pactl", "set-source-volume", self.device, "100%"], capture_output=True, timeout=5, check=False)
            except (OSError, subprocess.SubprocessError):
                pass
        return subprocess.Popen(
            [
                "parec",
                "-d",
                self.device,
                "--format=s16le",
                f"--rate={SAMPLE_RATE}",
                "--channels=1",
                "--raw",
                "--latency-msec=60",
                "--client-name=wall-senses",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )

    def _capture(self):
        gate = SpeechGate()
        pre = deque(maxlen=gate.pre_roll or 1)
        piece = []
        quiet = []
        oww_buf = b""
        while not self._stop.is_set():
            self._proc = self._open()
            if not self._proc:
                self._stop.wait(10)
                continue
            out = self._proc.stdout
            while not self._stop.is_set():
                frame = out.read(FRAME_BYTES)
                if not frame or len(frame) < FRAME_BYTES:
                    break
                frame = apply_gain(frame, self.gain)
                level = rms(frame)
                self.level += (level - self.level) * 0.2
                if time.monotonic() < self.hush_until:
                    # the wall is talking: drop everything, including a piece in progress
                    if gate.speaking:
                        gate = SpeechGate()
                    piece = []
                    pre.clear()
                    continue
                if self.wake_mode == "openwakeword":
                    oww_buf += frame
                    if len(oww_buf) >= 2560:  # 80 ms, what openWakeWord wants
                        self._feed_wake(oww_buf)
                        oww_buf = b""
                gate.ratio = self.ratio
                event = gate.push(level)
                if event == "start":
                    piece = list(pre) + [frame]
                elif gate.speaking:
                    piece.append(frame)
                elif event == "end":
                    piece.append(frame)
                    if gate.was_speech():
                        self._offer(b"".join(piece))
                    piece = []
                else:
                    pre.append(frame)
                    # nobody talking: this is what the room sounds like, so learn it
                    quiet.append(frame)
                    if len(quiet) >= 33:
                        self._learn_room(b"".join(quiet))
                        quiet = []
            if self._proc:
                self._proc.terminate()
                self._proc = None
            if not self._stop.is_set():
                self.log("ears: the microphone went away; trying again in 5 s")
                self._stop.wait(5)

    def _feed_wake(self, chunk):
        try:
            if self._oww is None:
                from openwakeword.model import Model  # noqa: PLC0415

                self._oww = Model(wakeword_models=[self.oww_model_name], inference_framework="onnx")
            import numpy as np  # noqa: PLC0415

            scores = self._oww.predict(np.frombuffer(chunk, dtype=np.int16))
            if max(scores.values() or [0]) > 0.5:
                self.await_until = time.monotonic() + AWAIT_SECONDS
                self._oww.reset()
        except Exception as e:  # noqa: BLE001  a missing model must not stop the ears
            if self.error != "no-openwakeword":
                self.log(f"ears: openWakeWord unavailable ({e}); falling back to the phrase")
            self.error = "no-openwakeword"
            self.wake_mode = "phrase"

    def _learn_room(self, quiet_bytes):
        try:
            import numpy as np  # noqa: PLC0415

            from .denoise import NoiseProfile  # noqa: PLC0415

            if self.profile is None:
                self.profile = NoiseProfile()
            self.profile.learn(np.frombuffer(quiet_bytes, dtype=np.int16).astype(np.float32) / 32768.0)
        except Exception:  # noqa: BLE001  the room's noise is a nicety, never a reason to stop listening
            pass

    def _offer(self, audio):
        # openWakeWord mode: only transcribe what follows the wake word (or notes)
        if self.wake_mode == "openwakeword" and not self.listening() and not self.notes:
            return
        try:
            self._pieces.put_nowait((audio, self.listening()))
        except queue.Full:
            pass  # still busy with earlier pieces: this one is dropped, not stored

    # --- transcription -----------------------------------------------------

    def _engine(self):
        if self._stt is None:
            try:
                import sherpa_onnx  # noqa: F401, PLC0415
            except ImportError:
                self.error = "no-sherpa"
                raise
            if not model_ready(models_dir()):
                # not fetched: the service may not download (scripts/senses/install.sh)
                self.error = "no-model"
                raise FileNotFoundError(f"{MODEL_NAME} is not in {models_dir()}")
            self._stt = Parakeet(models_dir())
            self.log(f"ears: {MODEL_NAME} loaded on the CPU ({self._stt.threads} threads)")
            self.error = ""
        return self._stt

    def decided(self, kind, **data):
        if self.on_decision:
            try:
                self.on_decision(kind, **data)
            except Exception:  # noqa: BLE001  the diary must never stop the ears
                pass

    def _words(self, audio_bytes):
        import numpy as np  # noqa: PLC0415

        audio = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        # take the room's noise out and bring the voice forward (denoise.py)
        from .denoise import clean  # noqa: PLC0415

        audio = clean(audio, self.profile, self.noise, self.boost)
        # level each piece first: a quiet voice from across the room comes out
        # as loud as one up close (at most 20x more, so hiss stays hiss)
        peak = float(np.abs(audio).max()) if audio.size else 0.0
        if peak > 1e-4:
            audio = audio * min(20.0, 0.9 / peak)
        return self._engine().words(audio)

    def _transcribe_loop(self):
        head_bytes = int(HEAD_SECONDS * SAMPLE_RATE) * 2
        while not self._stop.is_set():
            try:
                audio, was_listening = self._pieces.get(timeout=0.5)
            except queue.Empty:
                continue
            try:
                awaiting = was_listening or self.listening()
                if not awaiting and not self.notes and len(audio) > head_bytes:
                    # phrase mode: is it even for the wall? check the start first
                    head = self._words(audio[:head_bytes])
                    if match_wake(head, self.wake_words) is None:
                        self.decided("ignored", seconds=round(len(audio) / 2 / SAMPLE_RATE, 2), head=head)
                        continue
                    awaiting = False
                    self.state = "thinking"
                if awaiting:
                    self.state = "thinking"
                seconds = round(len(audio) / 2 / SAMPLE_RATE, 2)
                text = self._words(audio)
                del audio
                if self.error == "failed":
                    self.error, self.error_detail = "", ""
                what = route(text, self.wake_words, self.notes, awaiting) if text else None
                self.decided("heard", seconds=seconds, text=text, awaiting=bool(awaiting), notes=bool(self.notes), routed=what[0] if what else None)
                if not what:
                    continue
                kind, words = what
                if kind == "wake":
                    self.await_until = time.monotonic() + AWAIT_SECONDS
                    self.on_heard("wake", "")
                    continue
                self.await_until = 0.0
                self.on_heard(kind, words)
            except Exception as e:  # noqa: BLE001  one bad piece must not stop the ears
                self.log(f"ears: transcription failed: {e}")
                if self.error in ("no-sherpa", "no-model"):
                    self._stop.wait(30)
                else:
                    # say so on the phone instead of going quiet (cleared by the next piece that works)
                    self.error = "failed"
                    self.error_detail = f"{type(e).__name__}: {e}"[:200]
            finally:
                self.state = "idle"
