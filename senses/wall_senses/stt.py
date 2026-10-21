"""Speech to text for the wall's ears: NVIDIA Parakeet TDT 0.6B v2 (int8), run
on this machine's CPU through sherpa-onnx.

Chosen over Whisper on the wall's own kind of audio (short commands, CPU only,
4 threads; benchmark in docs/senses.md): about 0.5 s a phrase against 1.9 s
for Whisper small.en, with fewer mistakes (2.4% of words against 6.1%). It
writes nothing at all for silence and noise, where Whisper invents "Thank
you." and the like, and it needs no example sentence to hear "hey wall".

The model is fetched by scripts/senses/install.sh into the models folder
(~/.cache/wall-senses); the running process never downloads anything.
"""

import os
import threading

MODEL_NAME = "parakeet-tdt-0.6b-v2"
MODEL_DIR = "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8"
MODEL_FILES = ("encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt")
SAMPLE_RATE = 16000


def models_dir():
    """Where install.sh puts the wall's models (the same folder as the camera's)."""
    return os.environ.get("WALL_SENSES_MODELS") or os.path.join(os.path.expanduser("~"), ".cache", "wall-senses")


def model_path(folder):
    """The Parakeet folder inside the models folder, whether or not it's there yet."""
    return os.path.join(folder, MODEL_DIR)


def model_ready(folder):
    path = model_path(folder)
    return all(os.path.isfile(os.path.join(path, f)) for f in MODEL_FILES)


def default_threads():
    """Two threads transcribe a phrase as fast as four (measured), and leave the
    rest of the CPU to the display and the music. WALL_SENSES_THREADS overrides."""
    try:
        wanted = int(os.environ.get("WALL_SENSES_THREADS", "0"))
    except ValueError:
        wanted = 0
    return wanted if wanted > 0 else max(1, min(2, (os.cpu_count() or 2) - 1))


class Parakeet:
    """Loads once (about 3 s, about 1 GB of memory), then turns 16 kHz mono
    float audio into words."""

    def __init__(self, folder, threads=None):
        import sherpa_onnx  # noqa: PLC0415  imported here so tests run without it

        path = model_path(folder)
        self.threads = threads or default_threads()
        self._rec = sherpa_onnx.OfflineRecognizer.from_transducer(
            encoder=os.path.join(path, "encoder.int8.onnx"),
            decoder=os.path.join(path, "decoder.int8.onnx"),
            joiner=os.path.join(path, "joiner.int8.onnx"),
            tokens=os.path.join(path, "tokens.txt"),
            num_threads=self.threads,
            model_type="nemo_transducer",
            decoding_method="greedy_search",
        )
        # the wall's microphone and the voice box (voicebox.py) share one model
        self._lock = threading.Lock()

    def words(self, audio, sample_rate=SAMPLE_RATE):
        """audio: float32 samples in -1..1 (16 kHz unless said). Returns the words, or ''."""
        with self._lock:
            stream = self._rec.create_stream()
            stream.accept_waveform(sample_rate, audio)
            self._rec.decode_stream(stream)
            return (stream.result.text or "").strip()


_shared = None
_shared_lock = threading.Lock()


def shared(folder):
    """The one Parakeet of this process, loaded the first time it's wanted:
    about 1 GB, so the microphone and the voice box never load two."""
    global _shared
    with _shared_lock:
        if _shared is None:
            _shared = Parakeet(folder)
        return _shared
