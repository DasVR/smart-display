"""Noise suppression and voice boost (denoise.py). Needs numpy, which the
webcam process's venv has; skipped where it isn't installed (CI's bare python)."""

import importlib.util
import unittest

HAVE_NUMPY = importlib.util.find_spec("numpy") is not None


@unittest.skipUnless(HAVE_NUMPY, "numpy is not installed here")
class Denoise(unittest.TestCase):
    def setUp(self):
        import numpy as np

        from wall_senses import denoise

        self.np, self.d = np, denoise
        self.rng = np.random.default_rng(1)

    def noise(self, seconds, level=0.02):
        return (self.rng.normal(0, level, int(16000 * seconds))).astype(self.np.float32)

    def db(self, a):
        return 10 * self.np.log10((a.astype(self.np.float64) ** 2).mean() + 1e-20)

    def test_room_noise_is_turned_down(self):
        prof = self.d.NoiseProfile()
        prof.learn(self.noise(2))
        self.assertTrue(prof.ready())
        out = self.d.clean(self.noise(2), prof, "light", boost=False)
        self.assertLess(self.db(out), self.db(self.noise(2)) - 8)

    def test_a_voice_above_the_noise_comes_through(self):
        np = self.np
        prof = self.d.NoiseProfile()
        prof.learn(self.noise(2))
        t = np.arange(32000) / 16000
        tone = (0.2 * np.sin(2 * np.pi * 1000 * t)).astype(np.float32)
        out = self.d.clean(tone + self.noise(2), prof, "strong", boost=False)
        self.assertGreater(self.db(out), self.db(tone) - 2)

    def test_nothing_learned_nothing_subtracted(self):
        a = self.noise(1)
        out = self.d.clean(a, self.d.NoiseProfile(), "light", boost=False)
        self.assertTrue(self.np.allclose(out, a))

    def test_round_trip_is_transparent(self):
        a = self.noise(1, 0.2)
        self.assertLess(float(self.np.abs(self.d.istft(self.d.stft(a), len(a)) - a).max()), 1e-4)

    def test_voice_boost_cuts_rumble_and_lifts_speech(self):
        g = self.d.voice_eq(self.np.array([40.0, 300.0, 2000.0]))
        self.assertLess(g[0], 0.3)
        self.assertAlmostEqual(g[1], 1.0, delta=0.15)
        self.assertGreater(g[2], 1.8)


if __name__ == "__main__":
    unittest.main()
