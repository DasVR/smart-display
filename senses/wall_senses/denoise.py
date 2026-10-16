"""Cleaning a voice up before it is transcribed: less room noise, more voice.

Noise suppression (spectral gating). Between words the microphone hears only
the room: a fan, a fridge, the hum of a computer, hiss. Those quiet moments
teach a noise profile, the room's loudness at each pitch. In a piece of
speech, every pitch that is no louder than the room's noise there is turned
down; pitches well above it (the voice) pass. The mask is smoothed over time
and pitch so it doesn't warble ("musical noise").

Voice boost. Speech that matters for understanding sits between about 300 Hz
and 4 kHz. Below 90 Hz is only rumble (traffic, footsteps, the desk), so it
is cut, and the 1 to 4 kHz band, where consonants live and which distance
dulls first, is lifted.

numpy only, on 16 kHz mono float audio between -1 and 1.
"""

import numpy as np

RATE = 16000
N = 512  # 32 ms windows
HOP = 128
# how much of the room's noise to expect (a margin over the learned level), and
# how far down noise may be turned (0.15 = -16 dB; lower is cleaner but rougher)
STRENGTH = {"off": 0.0, "light": 1.2, "strong": 2.0}
FLOOR = {"off": 1.0, "light": 0.2, "strong": 0.1}


def _window():
    return np.hanning(N + 1)[:-1].astype(np.float32)


def stft(x):
    w = _window()
    pad = np.concatenate([np.zeros(N, np.float32), x.astype(np.float32), np.zeros(N, np.float32)])
    frames = 1 + (len(pad) - N) // HOP
    idx = np.arange(N)[None, :] + HOP * np.arange(frames)[:, None]
    return np.fft.rfft(pad[idx] * w, axis=1)


def istft(spec, length):
    w = _window()
    frames = spec.shape[0]
    out = np.zeros(N + HOP * (frames - 1), np.float32)
    norm = np.zeros_like(out)
    chunks = np.fft.irfft(spec, n=N, axis=1).astype(np.float32)
    for i in range(frames):
        out[i * HOP : i * HOP + N] += chunks[i] * w
        norm[i * HOP : i * HOP + N] += w * w
    out /= np.maximum(norm, 1e-6)
    return out[N : N + length]


class NoiseProfile:
    """The room's noise at each pitch, learned from audio with nobody talking."""

    def __init__(self, ease=0.05):
        self.ease = ease
        self.mag = None
        self.seconds = 0.0

    def learn(self, quiet):
        """Feed it audio (float, -1..1) that holds no speech."""
        if quiet is None or len(quiet) < N:
            return
        m = np.abs(stft(quiet)).mean(axis=0)
        if self.mag is None:
            self.mag = m
        else:
            # follows a room that changes (a fan turned on) within a minute or so
            self.mag = self.mag + (m - self.mag) * min(1.0, self.ease * len(quiet) / RATE * 4)
        self.seconds += len(quiet) / RATE

    def ready(self):
        return self.mag is not None and self.seconds >= 0.5


def _smooth(mask):
    """Average each mask value with its neighbours in time and pitch."""
    m = mask.copy()
    m[1:-1] = (mask[:-2] + mask[1:-1] * 2 + mask[2:]) / 4
    f = m.copy()
    f[:, 1:-1] = (m[:, :-2] + m[:, 1:-1] * 2 + m[:, 2:]) / 4
    return f


def wiener_gain(power, noise, floor=0.15, alpha=0.96):
    """Per pitch and moment, how much to keep (0..1): the "decision-directed"
    Wiener filter used in phones and hearing aids. The voice-to-noise ratio is
    estimated from this moment and the cleaned previous one together, so the
    gain changes smoothly instead of chirping."""
    frames = power.shape[0]
    gains = np.empty_like(power)
    prev = np.zeros(power.shape[1])
    for t in range(frames):
        post = power[t] / np.maximum(noise[0], 1e-12)
        prio = alpha * prev / np.maximum(noise[0], 1e-12) + (1 - alpha) * np.maximum(post - 1, 0)
        g = np.maximum(prio / (1 + prio), floor)
        gains[t] = g
        prev = (g**2) * power[t]
    return _smooth(gains)


def voice_eq(freqs):
    """Gain at each frequency: cut rumble under 90 Hz, lift 1 to 4 kHz by about 6 dB."""
    g = np.ones_like(freqs)
    g = np.where(freqs < 90, (freqs / 90.0) ** 2, g)
    lift = np.exp(-(((np.log2(np.maximum(freqs, 1)) - np.log2(2000)) / 1.0) ** 2))
    return g * (1 + 1.0 * lift)


def clean(audio, profile=None, strength="light", boost=True):
    """The piece with room noise turned down and the voice brought forward.

    Returns float audio the same length. Without a learned profile, noise
    suppression is skipped (it would have nothing to subtract) but the voice
    boost still applies.
    """
    a = np.asarray(audio, np.float32)
    if a.size < N:
        return a
    k = STRENGTH.get(strength, 0.0)
    gate = bool(k and profile is not None and profile.ready())
    if not gate and not boost:
        return a
    spec = stft(a)
    if gate:
        spec = spec * wiener_gain(np.abs(spec) ** 2, (profile.mag**2)[None, :] * k, floor=FLOOR[strength])
    if boost:
        spec = spec * voice_eq(np.fft.rfftfreq(N, 1 / RATE))[None, :]
    return istft(spec, len(a))
