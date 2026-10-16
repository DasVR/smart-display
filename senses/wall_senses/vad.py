"""When someone is talking: a loudness gate that learns the room.

Audio arrives as 30 ms frames of 16 kHz mono, 16-bit. Each frame's loudness
(RMS) is compared with a noise floor that follows the room slowly upward and
quickly downward, so a fan or a fridge is ignored and a voice is not. Speech
starts after a few loud frames in a row, and ends after a stretch of quiet
(the "hangover"), so the pauses between words don't cut a sentence in two.

Pure Python, no numpy, so it is tested without a microphone.
"""

import math
from array import array

SAMPLE_RATE = 16000
FRAME_MS = 30
FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS // 1000
FRAME_BYTES = FRAME_SAMPLES * 2


def rms(frame_bytes):
    """Loudness of one frame of little-endian 16-bit samples, 0 to 1."""
    samples = array("h")
    samples.frombytes(frame_bytes[: len(frame_bytes) - len(frame_bytes) % 2])
    if not samples:
        return 0.0
    total = 0
    for s in samples:
        total += s * s
    return math.sqrt(total / len(samples)) / 32768.0


def apply_gain(frame_bytes, gain, knee=24000):
    """Turn one frame of 16-bit samples up by `gain`, softly limited.

    A webcam microphone across the room hears a voice faintly; turning it up
    a lot would clip anything loud (a door, a laugh) into harsh noise. Above
    the knee the extra is squeezed to a quarter, and nothing passes 32767.
    """
    if gain == 1:
        return frame_bytes
    samples = array("h")
    samples.frombytes(frame_bytes[: len(frame_bytes) - len(frame_bytes) % 2])
    for i, s in enumerate(samples):
        v = s * gain
        a = -v if v < 0 else v
        if a > knee:
            a = knee + (a - knee) * 0.25
            if a > 32767:
                a = 32767
            v = -a if v < 0 else a
        samples[i] = int(v)
    return samples.tobytes()


class SpeechGate:
    """Feed it one frame's loudness at a time; it says when speech starts and ends.

    push() returns "start", "end", or None. While speaking, the caller keeps
    the frames; at "end" it hands them to the transcriber. A piece longer than
    max_seconds is cut there ("end") so music can't hold the gate open.
    """

    def __init__(
        self,
        ratio=3.2,
        min_level=0.006,
        start_frames=4,
        hangover_ms=700,
        min_speech_ms=300,
        max_seconds=15.0,
        pre_roll_ms=600,
    ):
        self.ratio = ratio
        self.min_level = min_level
        self.start_frames = start_frames
        self.hangover = max(1, hangover_ms // FRAME_MS)
        self.min_speech = max(1, min_speech_ms // FRAME_MS)
        self.max_frames = int(max_seconds * 1000 // FRAME_MS)
        self.pre_roll = max(0, pre_roll_ms // FRAME_MS)
        self.floor = None
        self.speaking = False
        self.loud_run = 0
        self.quiet_run = 0
        self.length = 0
        self.voiced = 0

    def threshold(self):
        return max(self.min_level, (self.floor or 0.0) * self.ratio)

    def _learn(self, level, rate=0.01):
        if self.floor is None:
            self.floor = level
        elif level < self.floor:
            # quiet comes back fast
            self.floor += (level - self.floor) * 0.2
        else:
            # noise creeps up slowly, so a voice doesn't become the floor
            self.floor += (level - self.floor) * rate

    def push(self, level):
        if self.floor is None:
            # the first frame is the room as it is
            self._learn(level)
        loud = level > self.threshold()
        if self.speaking or loud:
            # very slowly even while loud: a fan that comes on mid-sentence
            # becomes the floor in a few seconds instead of holding the gate open
            self._learn(level, 0.002)
        if not self.speaking:
            if not loud:
                self._learn(level)
                self.loud_run = 0
                return None
            self.loud_run += 1
            if self.loud_run >= self.start_frames:
                self.speaking = True
                self.length = self.loud_run
                self.voiced = self.loud_run
                self.quiet_run = 0
                return "start"
            return None

        self.length += 1
        if loud:
            self.voiced += 1
            self.quiet_run = 0
        else:
            self.quiet_run += 1
        if self.quiet_run >= self.hangover or self.length >= self.max_frames:
            self.speaking = False
            self.loud_run = 0
            return "end"
        return None

    def was_speech(self):
        """After "end": was there enough voice in it to bother the transcriber with?"""
        return self.voiced >= self.min_speech
