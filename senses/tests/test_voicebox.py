"""The voice box (voicebox.py): finding Phonon and its voices, reading and
writing WAVs, and its HTTP answers, with fake ears and a fake voice. The WAV
parts need numpy and are skipped where it isn't installed (CI's bare python)."""

import importlib.util
import io
import json
import os
import struct
import tempfile
import unittest
import urllib.error
import urllib.request
import wave

from wall_senses import voicebox

HAVE_NUMPY = importlib.util.find_spec("numpy") is not None


def wav(samples, rate=16000, channels=1):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(struct.pack(f"<{len(samples)}h", *samples))
    return buf.getvalue()


def models(with_phonon=True, voices=("Easton", "Harper")):
    d = tempfile.mkdtemp()
    if with_phonon:
        os.makedirs(os.path.join(d, "phonon-31m-en"))
        for f in voicebox.PHONON_FILES:
            open(os.path.join(d, "phonon-31m-en", f), "w").close()
    os.makedirs(os.path.join(d, "phonon-voices", "voices"))
    with open(os.path.join(d, "phonon-voices", "voices.jsonl"), "w") as f:
        for i, name in enumerate(voices):
            open(os.path.join(d, "phonon-voices", "voices", f"{i}.safetensors"), "w").close()
            f.write(json.dumps({"name": name, "filename": f"voices/{i}.safetensors", "language": "en", "description": name + " voice"}) + "\n")
        # another language, and one whose file never arrived: neither is offered
        f.write(json.dumps({"name": "Lea", "filename": "voices/9.safetensors", "language": "fr"}) + "\n")
        f.write(json.dumps({"name": "Gone", "filename": "voices/missing.safetensors", "language": "en"}) + "\n")
        f.write("not json\n")
    return d


class Finding(unittest.TestCase):
    def test_phonon_found_only_when_whole(self):
        d = models()
        self.assertTrue(voicebox.phonon_model(d).endswith("phonon-31m-en"))
        os.remove(os.path.join(d, "phonon-31m-en", "model.q8.gguf"))
        self.assertIsNone(voicebox.phonon_model(d))

    def test_the_larger_model_wins_when_both_are_there(self):
        d = models()
        os.makedirs(os.path.join(d, "phonon-40m-en"))
        for f in voicebox.PHONON_FILES:
            open(os.path.join(d, "phonon-40m-en", f), "w").close()
        self.assertTrue(voicebox.phonon_model(d).endswith("phonon-40m-en"))

    def test_voices_are_english_and_on_disk(self):
        names = [v["name"] for v in voicebox.read_voices(models())]
        self.assertEqual(names, ["Easton", "Harper"])
        self.assertEqual(voicebox.read_voices(tempfile.mkdtemp()), [])


@unittest.skipUnless(HAVE_NUMPY, "numpy is not installed here")
class Wavs(unittest.TestCase):
    def test_reads_mono_and_stereo(self):
        audio, rate = voicebox.decode_wav(wav([0, 16384, -16384, 0], rate=48000))
        self.assertEqual(rate, 48000)
        self.assertAlmostEqual(float(audio[1]), 0.5, places=3)
        stereo, _ = voicebox.decode_wav(wav([16384, 0, 16384, 0], channels=2))
        self.assertEqual(len(stereo), 2)
        self.assertAlmostEqual(float(stereo[0]), 0.25, places=3)

    def test_refuses_what_isnt_a_wav(self):
        with self.assertRaises(ValueError):
            voicebox.decode_wav(b"not a wav at all")

    def test_round_trip(self):
        import numpy as np

        out = voicebox.wav_bytes(np.array([0.0, 0.5, -2.0], dtype=np.float32), 24000)
        audio, rate = voicebox.decode_wav(out)
        self.assertEqual(rate, 24000)
        self.assertAlmostEqual(float(audio[1]), 0.5, places=3)
        self.assertAlmostEqual(float(audio[2]), -1.0, places=3)  # clipped, not wrapped

    def test_resampled_to_16k(self):
        import numpy as np

        same = np.ones(160, dtype=np.float32)
        self.assertIs(voicebox.to_16k(same, 16000), same)
        self.assertEqual(len(voicebox.to_16k(np.ones(480, dtype=np.float32), 48000)), 160)
        down = voicebox.to_16k(np.array([0, 0, 0, 1, 1, 1], dtype=np.float32), 48000)
        self.assertEqual(list(down), [0.0, 1.0])
        self.assertEqual(len(voicebox.to_16k(np.ones(2400, dtype=np.float32), 24000)), 1600)

    def test_quiet_is_brought_up_but_not_hiss(self):
        import numpy as np

        self.assertAlmostEqual(float(np.abs(voicebox.level(np.array([0.09], dtype=np.float32))).max()), 0.9, places=3)
        self.assertAlmostEqual(float(voicebox.level(np.array([0.001], dtype=np.float32))[0]), 0.02, places=4)


class FakeVoice:
    def __init__(self, ready=True):
        self._ready = ready
        self.said = []

    def ready(self):
        return self._ready

    def model(self):
        return "phonon-31m-en" if self._ready else ""

    def speak(self, text, voice=None, duration_delta=None):
        self.said.append((text, voice, duration_delta))
        return b"RIFFfake", 1.25


class Http(unittest.TestCase):
    def setUp(self):
        os.environ["WALL_VOICEBOX_PORT"] = "0"
        self.box = voicebox.VoiceBox(folder=models(), log=lambda *a: None)
        self.box.voice = FakeVoice()
        self.box.transcribe = lambda data: "what time is it?" if data.startswith(b"RIFF") else (_ for _ in ()).throw(ValueError("bad"))
        self.assertTrue(self.box.start())
        self.url = "http://127.0.0.1:%d" % self.box._server.server_address[1]

    def tearDown(self):
        self.box.stop()
        os.environ.pop("WALL_VOICEBOX_PORT", None)

    def call(self, path, body=None):
        req = urllib.request.Request(self.url + path, data=body, method="POST" if body is not None else "GET")
        try:
            with urllib.request.urlopen(req, timeout=5) as res:
                return res.status, res.headers, res.read()
        except urllib.error.HTTPError as e:
            return e.code, e.headers, e.read()

    def test_health(self):
        status, _, body = self.call("/health")
        data = json.loads(body)
        self.assertEqual(status, 200)
        self.assertTrue(data["tts"])
        self.assertEqual([v["name"] for v in data["voices"]], ["Easton", "Harper"])

    def test_transcribe(self):
        status, _, body = self.call("/transcribe", b"RIFF....")
        self.assertEqual((status, json.loads(body)["text"]), (200, "what time is it?"))
        status, _, body = self.call("/transcribe", b"garbage")
        self.assertEqual((status, json.loads(body)["error"]), (415, "bad-audio"))

    def test_speech(self):
        status, headers, body = self.call("/speech", json.dumps({"text": "  Hello   there ", "voice": "harper"}).encode())
        self.assertEqual((status, body, headers["Content-Type"], headers["X-Duration-Ms"]), (200, b"RIFFfake", "audio/wav", "1250"))
        self.assertEqual(self.box.voice.said, [("Hello there", "harper", None)])
        self.assertEqual(self.call("/speech", b"{}")[0], 400)

    def test_speech_pace_per_request(self):
        self.call("/speech", json.dumps({"text": "hi", "duration_delta": 0.2}).encode())
        self.assertEqual(self.box.voice.said[-1], ("hi", None, 0.2))
        self.call("/speech", json.dumps({"text": "hi", "duration_delta": 9}).encode())
        self.assertEqual(self.box.voice.said[-1][2], 0.5, "clamped where speech stays reliable")
        self.call("/speech", json.dumps({"text": "hi", "duration_delta": -9}).encode())
        self.assertEqual(self.box.voice.said[-1][2], -0.5)
        self.call("/speech", json.dumps({"text": "hi", "duration_delta": "loud"}).encode())
        self.assertIsNone(self.box.voice.said[-1][2], "not a number: the env pace applies")

    def test_speech_without_phonon(self):
        self.box.voice = FakeVoice(ready=False)
        status, _, body = self.call("/speech", json.dumps({"text": "hi"}).encode())
        self.assertEqual((status, json.loads(body)["error"]), (503, "no-voice"))

    def test_unknown_paths(self):
        self.assertEqual(self.call("/nope")[0], 404)
        self.assertEqual(self.call("/nope", b"x")[0], 404)


class Pace(unittest.TestCase):
    def test_request_delta(self):
        self.assertIsNone(voicebox.request_delta(None))
        self.assertIsNone(voicebox.request_delta(True))
        self.assertIsNone(voicebox.request_delta("soon"), "not a number: the env pace applies")
        self.assertEqual(voicebox.request_delta(0.2), 0.2)
        self.assertEqual(voicebox.request_delta("0.2"), 0.2)
        self.assertEqual(voicebox.request_delta(9), 0.5, "clamped where speech stays reliable")
        self.assertEqual(voicebox.request_delta(-9), -0.5)

    def test_env_delta(self):
        old = os.environ.get("WALL_VOICE_DURATION_DELTA")
        try:
            os.environ.pop("WALL_VOICE_DURATION_DELTA", None)
            self.assertEqual(voicebox.duration_delta_env(), 0.0)
            os.environ["WALL_VOICE_DURATION_DELTA"] = "0.2"
            self.assertEqual(voicebox.duration_delta_env(), 0.2)
            os.environ["WALL_VOICE_DURATION_DELTA"] = "9"
            self.assertEqual(voicebox.duration_delta_env(), 0.5)
            os.environ["WALL_VOICE_DURATION_DELTA"] = "soon"
            self.assertEqual(voicebox.duration_delta_env(), 0.0)
        finally:
            if old is None:
                os.environ.pop("WALL_VOICE_DURATION_DELTA", None)
            else:
                os.environ["WALL_VOICE_DURATION_DELTA"] = old


class Lexicon(unittest.TestCase):
    def setUp(self):
        voicebox._lexicon.update({"path": None, "mtime": None, "rules": []})
        self._old_lex = os.environ.pop("WALL_VOICE_LEXICON", None)

    def tearDown(self):
        if self._old_lex is None:
            os.environ.pop("WALL_VOICE_LEXICON", None)
        else:
            os.environ["WALL_VOICE_LEXICON"] = self._old_lex
        voicebox._lexicon.update({"path": None, "mtime": None, "rules": []})

    def lex(self, data, ns=(1, 2)):
        path = os.path.join(tempfile.mkdtemp(), "lexicon.json")
        with open(path, "w") as f:
            json.dump(data, f)
        os.utime(path, ns=ns)
        os.environ["WALL_VOICE_LEXICON"] = path
        return path

    def test_no_file_means_nothing_said(self):
        os.environ["WALL_VOICE_LEXICON"] = os.path.join(tempfile.mkdtemp(), "absent.json")
        self.assertEqual(voicebox.load_lexicon(lambda *a: None), [])

    def test_acronyms_whole_word_then_rewrites(self):
        self.lex({
            "acronyms": {"API": "A P I"},
            "rewrites": [
                {"pattern": "\\bgo\\b", "replace": "went"},
                {"pattern": "\\bgo\\b", "replace": "\\1"},  # no group 1: skipped, never fails a speech
            ],
        })
        rules = voicebox.load_lexicon(lambda *a: None)
        # "API's" matches (' ends the word), "APIs" does not (plurals need their own entry)
        self.assertEqual(voicebox.speakable("The API's APIs go API.", rules), "The A P I's APIs went A P I.")

    def test_re_read_the_moment_it_changes(self):
        path = self.lex({"acronyms": {"API": "A P I"}})
        quiet = lambda *a: None
        self.assertEqual(voicebox.speakable("the API", voicebox.load_lexicon(quiet)), "the A P I")
        with open(path, "w") as f:
            json.dump({"acronyms": {"API": "Application Programming Interface"}}, f)
        os.utime(path, ns=(3, 4))
        self.assertEqual(voicebox.speakable("the API", voicebox.load_lexicon(quiet)), "the Application Programming Interface")

    def test_a_broken_save_keeps_the_last_good_copy(self):
        path = self.lex({"acronyms": {"API": "A P I"}})
        logs = []
        log = lambda *a: logs.append(a)
        self.assertEqual(voicebox.speakable("the API", voicebox.load_lexicon(log)), "the A P I")
        with open(path, "w") as f:
            f.write("{ nope")
        os.utime(path, ns=(3, 4))
        self.assertEqual(voicebox.speakable("the API", voicebox.load_lexicon(log)), "the A P I")
        self.assertTrue(logs, "a broken lexicon says so (not what was said)")
        # fixed again: the new copy speaks
        with open(path, "w") as f:
            json.dump({"acronyms": {"API": "ay pee eye"}}, f)
        os.utime(path, ns=(5, 6))
        self.assertEqual(voicebox.speakable("the API", voicebox.load_lexicon(log)), "the ay pee eye")


if __name__ == "__main__":
    unittest.main()
