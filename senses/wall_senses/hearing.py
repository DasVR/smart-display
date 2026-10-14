"""The webcam's ears: hear "hey wall …", and take notes when asked.

Sound comes from the webcam's microphone through PipeWire (`parec`, the same
tool the wall's music visualiser uses), at 16 kHz mono. A loudness gate
(vad.py) cuts it into pieces of speech; Whisper (faster-whisper, on this
machine's CPU) turns a piece into words. Nothing is recorded: a piece lives in
memory only until it has been transcribed, and only the words go on.

Two ways to wake it:
  phrase        (default) every piece's first few seconds are transcribed and
                checked for "hey wall"; only then is the rest transcribed and
                sent. Nothing extra to install.
  openwakeword  a small always-on model listens for its wake word and Whisper
                runs only after it fires. Lighter on the CPU while music plays.

While the wall itself is talking, the ears are shut (the server says so), so
the wall never answers itself.
"""

import os
import queue
import re
import shutil
import subprocess
import threading
import time
from collections import deque

from .vad import FRAME_BYTES, FRAME_MS, SAMPLE_RATE, SpeechGate, rms
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
        return ("command", text.strip().rstrip(".!?,").strip())
    if notes:
        return ("note", text.strip())
    return None


class Ears:
    def __init__(self, on_heard, log=print):
        self.on_heard = on_heard
        self.log = log
        self.source = ""
        self.wake_mode = "phrase"
        self.wake_words = None
        self.oww_model_name = "hey_jarvis"
        self.model_name = "base.en"
        self.language = "en"
        self.notes = False
        self.hush_until = 0.0
        self.await_until = 0.0
        self.state = "idle"  # idle | listening (after a wake) | thinking (transcribing for the wall)
        self.level = 0.0
        self.error = ""
        self.device = ""
        self._stop = threading.Event()
        self._threads = []
        self._proc = None
        self._pieces = queue.Queue(maxsize=4)
        self._whisper = None
        self._whisper_name = None
        self._oww = None
        self._lock = threading.Lock()

    # --- settings from the wall -------------------------------------------

    def configure(self, s):
        restart = (s.get("micSource") or "") != self.source or (s.get("wakeMode") or "phrase") != self.wake_mode
        self.source = s.get("micSource") or ""
        self.wake_mode = s.get("wakeMode") or "phrase"
        self.wake_words = s.get("wakeWords") or None
        self.oww_model_name = s.get("wakeModel") or "hey_jarvis"
        self.model_name = s.get("model") or "base.en"
        self.language = s.get("language") or "en"
        return restart

    def hush(self, seconds):
        """Shut the ears for a while (the wall is talking)."""
        self.hush_until = max(self.hush_until, time.monotonic() + max(0.0, seconds))

    def listening(self):
        return time.monotonic() < self.await_until

    def snapshot(self):
        return {
            "ok": self.running() and self.error in ("", "no-openwakeword"),
            "device": self.device,
            "level": round(self.level, 4),
            "state": "listening" if self.state == "idle" and self.listening() else self.state,
            "notes": self.notes,
            "wakeMode": self.wake_mode,
            "model": self.model_name,
            "error": self.error or None,
        }

    # --- lifecycle --------------------------------------------------------

    def start(self):
        if self.running():
            return
        self._stop.clear()
        self.error = ""
        self._threads = [
            threading.Thread(target=self._capture, name="ears", daemon=True),
            threading.Thread(target=self._transcribe_loop, name="whisper", daemon=True),
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
        self.log(f"ears: listening to {self.device}")
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

    def _offer(self, audio):
        # openWakeWord mode: only transcribe what follows the wake word (or notes)
        if self.wake_mode == "openwakeword" and not self.listening() and not self.notes:
            return
        try:
            self._pieces.put_nowait((audio, self.listening()))
        except queue.Full:
            pass  # still busy with earlier pieces: this one is dropped, not stored

    # --- transcription -----------------------------------------------------

    def _model(self):
        if self._whisper is None or self._whisper_name != self.model_name:
            try:
                from faster_whisper import WhisperModel  # noqa: PLC0415
            except ImportError:
                self.error = "no-whisper"
                raise
            threads = int(os.environ.get("WALL_SENSES_THREADS", "0")) or max(1, min(4, (os.cpu_count() or 2) - 1))
            self.log(f"ears: loading Whisper {self.model_name} on the CPU ({threads} threads)")
            try:
                self._whisper = WhisperModel(self.model_name, device="cpu", compute_type="int8", cpu_threads=threads)
            except Exception:
                # not fetched: the service may not download (scripts/senses/install.sh --models)
                self.error = "no-model"
                raise
            self._whisper_name = self.model_name
            self.error = ""
        return self._whisper

    def _words(self, audio_bytes):
        import numpy as np  # noqa: PLC0415

        audio = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        lang = None if self.language in ("", "auto") or self.model_name.endswith(".en") else self.language
        segments, _ = self._model().transcribe(
            audio,
            language=lang,
            beam_size=1,
            vad_filter=True,
            condition_on_previous_text=False,
            without_timestamps=True,
        )
        kept = [s.text for s in segments if not (s.no_speech_prob > 0.6 and s.avg_logprob < -1.0)]
        return " ".join(t.strip() for t in kept).strip()

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
                        continue
                    awaiting = False
                    self.state = "thinking"
                if awaiting:
                    self.state = "thinking"
                text = self._words(audio)
                del audio
                if not text:
                    continue
                what = route(text, self.wake_words, self.notes, awaiting)
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
                if self.error in ("no-whisper", "no-model"):
                    self._stop.wait(30)
            finally:
                self.state = "idle"
