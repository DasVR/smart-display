"""The parts of wall-senses that are arithmetic and words, no camera or mic needed.

    cd senses && python3 -m unittest discover -s tests
"""

import json
import math
import struct
import unittest

from wall_senses.distance import Smoother, Tracker, calibrate_focal, distance_m, focal_from_fov, scale_focal, summarize
from wall_senses.hearing import Ears, choose_source, route
from wall_senses.vad import FRAME_MS, FRAME_SAMPLES, SpeechGate, apply_gain, rms
from wall_senses import room
from wall_senses.diary import Diary
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


class Tracking(unittest.TestCase):
    F = 274.0  # focal px at 320 wide

    def test_one_missed_frame_does_not_drop_you(self):
        t = Tracker()
        face = [(140, 80, 40, 40)]
        out = [t.update(face, 320, self.F, i * 0.2) for i in range(5)]
        self.assertEqual(out[-1]["count"], 1)
        gap = t.update([], 320, self.F, 1.2)
        self.assertEqual(gap["count"], 1)
        self.assertAlmostEqual(gap["distance"], out[-1]["distance"])

    def test_gone_after_the_hold(self):
        t = Tracker(hold=1.5)
        for i in range(5):
            t.update([(140, 80, 40, 40)], 320, self.F, i * 0.2)
        self.assertEqual(t.update([], 320, self.F, 3.0)["count"], 0)

    def test_a_single_blip_is_not_someone(self):
        t = Tracker()
        self.assertEqual(t.update([(140, 80, 40, 40)], 320, self.F, 0)["count"], 0)
        self.assertEqual(t.update([], 320, self.F, 0.2)["count"], 0)
        self.assertEqual(t.update([(140, 80, 40, 40)], 320, self.F, 0.4)["count"], 0)

    def test_follows_the_same_person(self):
        t = Tracker()
        for i in range(4):
            t.update([(40, 80, 40, 40)], 320, self.F, i * 0.2)
        # someone bigger appears on the other side; we stay with the first
        out = t.update([(40, 80, 40, 40), (230, 70, 60, 60)], 320, self.F, 1.0)
        self.assertEqual(out["count"], 2)
        self.assertGreater(out["x"], 0.3)

    def test_tiny_faces_are_ignored(self):
        t = Tracker()
        for i in range(4):
            out = t.update([(10, 10, 8, 8)], 320, self.F, i * 0.2)
        self.assertEqual(out["count"], 0)


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


class Gain(unittest.TestCase):
    def test_quiet_voice_is_turned_up(self):
        self.assertAlmostEqual(rms(apply_gain(frame(0.01), 4)), 0.04, places=3)

    def test_loud_sounds_are_limited_not_wrapped(self):
        out = rms(apply_gain(frame(0.5), 8))
        self.assertLess(out, 1.0)
        self.assertGreater(out, 0.73)

    def test_unity_is_untouched(self):
        f = frame(0.2)
        self.assertEqual(apply_gain(f, 1), f)


class Room(unittest.TestCase):
    def test_homography_maps_the_paper_corners(self):
        # a letter sheet seen from above at an angle: the far edge looks shorter
        quad = [(0.45, 0.60), (0.57, 0.60), (0.60, 0.68), (0.42, 0.68)]
        h = room.floor_map(quad, "letter")
        near_mid = room.apply_h(h, 0.51, 0.68)
        self.assertAlmostEqual(near_mid[0], 0.0, places=6)
        self.assertAlmostEqual(near_mid[1], 0.0, places=6)
        far_right = room.apply_h(h, 0.57, 0.60)
        self.assertAlmostEqual(far_right[0], 0.2794 / 2, places=6)
        self.assertAlmostEqual(far_right[1], 0.2159, places=6)

    def test_corner_order_does_not_matter(self):
        quad = [(0.45, 0.60), (0.57, 0.60), (0.60, 0.68), (0.42, 0.68)]
        a = room.floor_map(quad)
        b = room.floor_map(list(reversed(quad)))
        self.assertTrue(all(abs(p - q) < 1e-9 for p, q in zip(a, b)))

    def test_farther_up_the_picture_is_farther_away(self):
        quad = [(0.45, 0.60), (0.57, 0.60), (0.60, 0.68), (0.42, 0.68)]
        h = room.floor_map(quad)
        near = room.floor_position(h, (0.45, 0.5, 0.1, 0.25))   # feet at y 0.75
        far = room.floor_position(h, (0.45, 0.3, 0.1, 0.25))    # feet at y 0.55
        self.assertLess(near[1], 0)
        self.assertGreater(far[1], 0)
        self.assertGreater(room.distance_from_wall(far, 2.0), room.distance_from_wall(near, 2.0))

    def test_no_wall_distance_no_metres(self):
        self.assertIsNone(room.distance_from_wall((0, 1), None))

    def test_spots(self):
        zones = [{"name": "bed", "sig": [0.25, 0.7, 0.4, 0.2]}, {"name": "desk", "sig": [0.75, 0.5, 0.15, 0.4]}]
        self.assertEqual(room.match_zone([0.27, 0.68, 0.38, 0.22], zones), "bed")
        self.assertEqual(room.match_zone([0.74, 0.52, 0.16, 0.38], zones), "desk")
        self.assertIsNone(room.match_zone([0.5, 0.1, 0.1, 0.1], zones))
        self.assertIsNone(room.match_zone([0.5, 0.5, 0.1, 0.1], []))

    def test_average_signature_ignores_a_stray(self):
        sigs = [[0.25, 0.7, 0.4, 0.2]] * 6 + [[0.9, 0.1, 0.05, 0.05]]
        self.assertEqual(room.average_signature(sigs), [0.25, 0.7, 0.4, 0.2])
        self.assertIsNone(room.average_signature([]))

    def test_posture(self):
        self.assertEqual(room.posture((0, 0, 0.4, 0.2)), "lying")
        self.assertEqual(room.posture((0, 0, 0.1, 0.4)), "upright")
        # square in 0..1 coords is wide in a 4:3 picture
        self.assertEqual(room.posture((0, 0, 0.42, 0.42), 640 / 480), "lying")
        self.assertEqual(room.posture((0, 0, 0.42, 0.42), 1.0), "upright")


class Wake(unittest.TestCase):
    def test_commands(self):
        self.assertEqual(match_wake("Hey wall, pause the music."), "pause the music")
        self.assertEqual(match_wake("Okay wall what's the weather?"), "what's the weather?")
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
        # the cleaned microphone wins, unless one is named in settings
        cleaned = lines + ["9\twall_mic\tPipeWire\tfloat32le 1ch 48000Hz\tRUNNING"]
        self.assertEqual(choose_source(cleaned), "wall_mic")
        self.assertEqual(choose_source(cleaned, "pci-0000"), "alsa_input.pci-0000_00_1f.3.analog-stereo")



class DiaryKeeps30Seconds(unittest.TestCase):
    def test_old_rows_fall_off_and_rows_fit(self):
        t = [1000.0]
        d = Diary(seconds=30, clock=lambda: t[0])
        d.add("camera", count=1, zone="bed")
        t[0] += 20
        d.add("heard", text="hey wall what time is it", routed="command")
        t[0] += 15
        rows = d.rows()
        self.assertEqual([r["kind"] for r in rows], ["heard"])
        for i in range(500):
            d.add("log", text="x" * 200)
        self.assertLessEqual(len(json.dumps(d.rows(max_bytes=5000))), 5000)


if __name__ == "__main__":
    unittest.main()


class ParakeetWake(unittest.TestCase):
    """What Parakeet actually wrote for spoken wake phrases (docs/senses.md)."""

    def test_heard_word_for_word(self):
        self.assertEqual(match_wake("Hey wall pause the music."), "pause the music")
        self.assertEqual(match_wake("Okay wall set a timer for 10 minutes."), "set a timer for 10 minutes")

    def test_a_quick_bare_hey_wall(self):
        self.assertEqual(match_wake("K Wal"), "")
        self.assertEqual(match_wake("Hay wall, what time is it?"), "what time is it?")

    def test_wall_its_run_together(self):
        self.assertEqual(match_wake("Hey wallets way too loud in here."), "way too loud in here")

    def test_k_alone_is_not_a_wake(self):
        self.assertIsNone(match_wake("K, that's fine"))
        self.assertIsNone(match_wake("Kay walked in"))


class Stt(unittest.TestCase):
    def test_model_ready_needs_every_file(self):
        import os
        import tempfile

        from wall_senses.stt import MODEL_FILES, model_path, model_ready

        with tempfile.TemporaryDirectory() as d:
            self.assertFalse(model_ready(d))
            os.makedirs(model_path(d))
            for f in MODEL_FILES[:-1]:
                open(os.path.join(model_path(d), f), "w").close()
            self.assertFalse(model_ready(d))
            open(os.path.join(model_path(d), MODEL_FILES[-1]), "w").close()
            self.assertTrue(model_ready(d))

    def test_two_threads_unless_told(self):
        import os

        from wall_senses.stt import default_threads

        os.environ.pop("WALL_SENSES_THREADS", None)
        self.assertLessEqual(default_threads(), 2)
        os.environ["WALL_SENSES_THREADS"] = "3"
        try:
            self.assertEqual(default_threads(), 3)
        finally:
            del os.environ["WALL_SENSES_THREADS"]

class FollowUp(unittest.TestCase):
    def test_listen_for_opens_the_ears_without_a_wake_phrase(self):
        ears = Ears(on_heard=lambda *a: None, log=lambda *a: None)
        self.assertFalse(ears.listening())
        ears.listen_for(5)
        self.assertTrue(ears.listening())
        # an answer while listening is a command, no "hey wall" needed
        self.assertEqual(route("yes please", None, False, ears.listening()), ("command", "yes please"))

    def test_listen_for_never_shortens_a_window(self):
        ears = Ears(on_heard=lambda *a: None, log=lambda *a: None)
        ears.listen_for(10)
        until = ears.await_until
        ears.listen_for(1)
        self.assertEqual(ears.await_until, until)


class FailuresShow(unittest.TestCase):
    def run_pieces(self, ears, pieces):
        import threading
        import time

        for p in pieces:
            ears._pieces.put((p, True))
        t = threading.Thread(target=ears._transcribe_loop, daemon=True)
        t.start()
        deadline = time.monotonic() + 2
        while not ears._pieces.empty() and time.monotonic() < deadline:
            time.sleep(0.01)
        time.sleep(0.05)
        ears._stop.set()
        t.join(1)

    def test_a_failure_is_reported_then_cleared(self):
        ears = Ears(on_heard=lambda *a: None, log=lambda *a: None)
        calls = []

        def words(_audio):
            calls.append(1)
            if len(calls) == 1:
                raise RuntimeError("bad audio")
            return "pause the music"

        ears._words = words
        self.run_pieces(ears, [b"\x00\x00" * 1600])
        self.assertEqual(ears.snapshot()["error"], "failed")
        self.assertIn("bad audio", ears.snapshot()["detail"])
        self.assertFalse(ears.snapshot()["ok"])
        ears._stop.clear()
        self.run_pieces(ears, [b"\x00\x00" * 1600])
        self.assertIsNone(ears.snapshot()["error"])
        self.assertIsNone(ears.snapshot()["detail"])


class Sources(unittest.TestCase):
    LONG = """Source #48
	State: SUSPENDED
	Name: alsa_output.pci-0000_e5_00.6.analog-stereo.monitor
	Description: Monitor of Family 17h/19h HD Audio Controller Analog Stereo
Source #49
	State: RUNNING
	Name: alsa_input.usb-046d_0821_EDE53AA0-00.analog-stereo
	Description: HD Webcam C910 Analog Stereo
Source #50
	Name: alsa_input.pci-0000_e5_00.6.analog-stereo
	Description: Family 17h/19h HD Audio Controller Analog Stereo
""".splitlines()

    def test_names_and_labels_without_monitors(self):
        from wall_senses.hearing import describe_sources

        self.assertEqual(
            describe_sources(self.LONG),
            [
                {"name": "alsa_input.usb-046d_0821_EDE53AA0-00.analog-stereo", "label": "HD Webcam C910 Analog Stereo"},
                {"name": "alsa_input.pci-0000_e5_00.6.analog-stereo", "label": "Family 17h/19h HD Audio Controller Analog Stereo"},
            ],
        )

    def test_the_webcam_wins_by_default_and_a_choice_wins_over_it(self):
        short = [
            "49\talsa_input.usb-046d_0821_EDE53AA0-00.analog-stereo\tPipeWire\ts16le 2ch 48000Hz\tRUNNING",
            "50\talsa_input.pci-0000_e5_00.6.analog-stereo\tPipeWire\ts16le 2ch 48000Hz\tSUSPENDED",
        ]
        self.assertEqual(choose_source(short), "alsa_input.usb-046d_0821_EDE53AA0-00.analog-stereo")
        self.assertEqual(choose_source(short, "alsa_input.pci-0000_e5_00.6.analog-stereo"), "alsa_input.pci-0000_e5_00.6.analog-stereo")


class KeepsQuestionMarks(unittest.TestCase):
    def test_question_mark_stays_full_stop_goes(self):
        self.assertEqual(match_wake("Hey wall what time is it?"), "what time is it?")
        self.assertEqual(match_wake("Hey wall pause the music."), "pause the music")
        self.assertEqual(route("Is it going to rain?", None, False, True), ("command", "Is it going to rain?"))
        self.assertEqual(route("Yes, please.", None, False, True), ("command", "Yes, please"))
