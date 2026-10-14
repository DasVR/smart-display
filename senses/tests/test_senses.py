"""The parts of wall-senses that are arithmetic and words, no camera or mic needed.

    cd senses && python3 -m unittest discover -s tests
"""

import math
import struct
import unittest

from wall_senses.distance import Smoother, calibrate_focal, distance_m, focal_from_fov, scale_focal, summarize
from wall_senses.hearing import choose_source, route
from wall_senses.vad import FRAME_MS, FRAME_SAMPLES, SpeechGate, rms
from wall_senses.wake import is_noise, match_wake


class Distance(unittest.TestCase):
    def test_pinhole_round_trip(self):
        f = focal_from_fov(320, 70)
        # a 15 cm face 2 m away is f * 0.15 / 2 pixels wide, and back again
        w = f * 0.15 / 2.0
        self.assertAlmostEqual(distance_m(w, f), 2.0, places=6)

    def test_closer_is_wider(self):
        f = focal_from_fov(320)
        self.assertLess(distance_m(80, f), distance_m(40, f))

    def test_no_face_no_distance(self):
        self.assertIsNone(distance_m(0, 200))
        self.assertIsNone(distance_m(None, 200))

    def test_calibration_uses_the_median(self):
        # standing at 1 m: mostly 60 px, one slip at 200 px
        f = calibrate_focal([60, 61, 59, 200, 60], 1.0)
        self.assertAlmostEqual(f, 60 / 0.15, places=6)
        self.assertAlmostEqual(distance_m(60, f), 1.0, places=6)
        self.assertAlmostEqual(distance_m(30, f), 2.0, places=6)

    def test_calibration_needs_a_face(self):
        self.assertIsNone(calibrate_focal([], 1.0))
        self.assertIsNone(calibrate_focal([60], 0))

    def test_scale_focal(self):
        self.assertAlmostEqual(scale_focal(400, 320, 640), 800)
        self.assertEqual(scale_focal(None, 320, 640), None)

    def test_summary_is_numbers_and_unmirrored(self):
        f = focal_from_fov(320)
        # a face on the camera's left edge is on your right, facing the wall
        s = summarize([(0, 50, 40, 40), (200, 60, 20, 20)], 320, f)
        self.assertEqual(s["count"], 2)
        self.assertGreater(s["x"], 0.8)
        self.assertAlmostEqual(s["distance"], distance_m(40, f))
        self.assertEqual(set(s), {"count", "distance", "x", "faceWidth"})

    def test_summary_empty(self):
        self.assertEqual(summarize([], 320, 200)["count"], 0)

    def test_smoother_ignores_one_bad_frame(self):
        s = Smoother(window=5, ease=1.0)
        for v in (2.0, 2.0, 2.0, 9.0, 2.0):
            out = s.push(v)
        self.assertEqual(out, 2.0)


def frame(level):
    """One 30 ms frame of a square wave at roughly this RMS level (0 to 1)."""
    a = int(level * 32767)
    return b"".join(struct.pack("<h", a if i % 2 else -a) for i in range(FRAME_SAMPLES))


class Gate(unittest.TestCase):
    def test_rms(self):
        self.assertAlmostEqual(rms(frame(0.5)), 0.5, places=3)
        self.assertEqual(rms(b""), 0.0)

    def run_levels(self, gate, levels):
        return [e for e in (gate.push(v) for v in levels) if e]

    def test_speech_starts_and_ends(self):
        g = SpeechGate(hangover_ms=300)
        quiet = [0.002] * 30
        speech = [0.08] * 40
        events = self.run_levels(g, quiet + speech + quiet)
        self.assertEqual(events, ["start", "end"])
        self.assertTrue(g.was_speech())

    def test_a_click_is_not_speech(self):
        g = SpeechGate()
        self.assertEqual(self.run_levels(g, [0.002] * 30 + [0.2, 0.2] + [0.002] * 30), [])

    def test_pauses_between_words_dont_split(self):
        g = SpeechGate(hangover_ms=600)
        word = [0.08] * 10
        gap = [0.002] * (300 // FRAME_MS)
        events = self.run_levels(g, [0.002] * 20 + word + gap + word + gap + word + [0.002] * 40)
        self.assertEqual(events, ["start", "end"])

    def test_steady_noise_becomes_the_floor(self):
        g = SpeechGate()
        self.run_levels(g, [0.03] * 400)
        self.assertGreater(g.threshold(), 0.03)

    def test_music_is_cut_at_max_length(self):
        g = SpeechGate(max_seconds=1.0)
        events = self.run_levels(g, [0.002] * 20 + [0.1] * int(3000 / FRAME_MS))
        self.assertIn("end", events)


class Wake(unittest.TestCase):
    def test_commands(self):
        self.assertEqual(match_wake("Hey wall, pause the music."), "pause the music")
        self.assertEqual(match_wake("Okay wall what's the weather?"), "what's the weather")
        self.assertEqual(match_wake("OK, wall. Set a timer for 10 minutes."), "Set a timer for 10 minutes")
        self.assertEqual(match_wake("Hey Wall remind me at 5:30 p.m. to call mom"), "remind me at 5:30 p.m. to call mom")

    def test_mishearings_after_hey(self):
        self.assertEqual(match_wake("Hey well, what time is it"), "what time is it")
        self.assertEqual(match_wake("Um, hey wall, done"), "done")
        self.assertEqual(match_wake("Hey, wow, set a timer for 10 minutes."), "set a timer for 10 minutes")

    def test_not_for_the_wall(self):
        self.assertIsNone(match_wake("Well, I think the wall looks nice"))
        self.assertIsNone(match_wake("The wall is blue"))
        self.assertIsNone(match_wake("hey walter"))

    def test_bare_wake(self):
        self.assertEqual(match_wake("Hey wall."), "")

    def test_custom_wake(self):
        self.assertEqual(match_wake("Computer, lights", ["computer"]), "lights")
        self.assertIsNone(match_wake("Hey wall lights", ["computer"]))

    def test_noise(self):
        self.assertTrue(is_noise("Thank you."))
        self.assertTrue(is_noise("[Music]"))
        self.assertTrue(is_noise("♪ la la ♪"))
        self.assertFalse(is_noise("Thank you for the reminder about the bins"))


class Routing(unittest.TestCase):
    def test_route(self):
        self.assertEqual(route("Hey wall, pause.", None, False, False), ("command", "pause"))
        self.assertEqual(route("Hey wall.", None, False, False), ("wake", ""))
        self.assertEqual(route("pause the music.", None, False, True), ("command", "pause the music"))
        self.assertEqual(route("We should paint the hall.", None, True, False), ("note", "We should paint the hall."))
        self.assertIsNone(route("We should paint the hall.", None, False, False))
        self.assertIsNone(route("Thank you.", None, True, False))
        # in notes, "hey wall, stop taking notes" is still a command
        self.assertEqual(route("Hey wall, stop taking notes", None, True, False), ("command", "stop taking notes"))

    def test_choose_source(self):
        lines = [
            "0\talsa_output.pci-0000_00_1f.3.analog-stereo.monitor\tPipeWire\ts32le 2ch 48000Hz\tSUSPENDED",
            "1\talsa_input.pci-0000_00_1f.3.analog-stereo\tPipeWire\ts32le 2ch 48000Hz\tSUSPENDED",
            "2\talsa_input.usb-046d_HD_Pro_Webcam_C920-02.analog-stereo\tPipeWire\ts16le 2ch 32000Hz\tRUNNING",
        ]
        self.assertEqual(choose_source(lines), "alsa_input.usb-046d_HD_Pro_Webcam_C920-02.analog-stereo")
        self.assertEqual(choose_source(lines, "pci-0000"), "alsa_input.pci-0000_00_1f.3.analog-stereo")
        self.assertEqual(choose_source(lines[:2]), "@DEFAULT_SOURCE@")
        self.assertEqual(choose_source([]), "@DEFAULT_SOURCE@")


if __name__ == "__main__":
    unittest.main()
