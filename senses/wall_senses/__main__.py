"""wall-senses: the webcam's microphone and camera, for the wall.

    python -m wall_senses            run (the systemd unit does this)
    python -m wall_senses --list     the microphones and cameras it can see
    python -m wall_senses --check    what's installed and what's missing

It asks the wall's server (WALL_URL, default http://127.0.0.1:3000) what to
do every second and tells it what it sees and hears: how many people, how
far, where across the room, and the words said to the wall. Settings live on
the wall (the phone's Senses page); this process keeps none of its own.
"""

import argparse
import glob
import importlib.util
import signal
import sys
import threading
import time

from .diary import Diary
from .distance import calibrate_focal, scale_focal
from .hearing import Ears, list_sources
from .bodies import YOLOX_NAME
from .room import average_signature, floor_map, order_quad
from .seeing import DETECT_WIDTH, YUNET_NAME, Eyes, model_dir
from .wall import Wall

VERSION = 1
TICK = 0.25
HEARTBEAT = 1.0


def log(*parts):
    print("[senses]", *parts, flush=True)


def moved(a, b):
    """Worth telling the wall about straight away?"""
    if a.get("count") != b.get("count") or a.get("ok") != b.get("ok"):
        return True
    if a.get("zone") != b.get("zone") or a.get("posture") != b.get("posture"):
        return True
    da, db = a.get("distance"), b.get("distance")
    if (da is None) != (db is None) or (da is not None and abs(da - db) > 0.1):
        return True
    xa, xb = a.get("x"), b.get("x")
    if (xa is None) != (xb is None) or (xa is not None and abs(xa - xb) > 0.08):
        return True
    return False


class Senses:
    def __init__(self, wall):
        self.wall = wall
        # the last 30 s of decisions, numbers and words, for "that was wrong" reports
        self.diary = Diary()
        self.eyes = Eyes(log=self.note)
        self.ears = Ears(on_heard=self.heard, log=self.note, on_decision=self.diary.add)
        self.settings = {}
        self.calibrating = None
        self.last_sent = {}
        self.last_post = 0.0
        self.reported = None

    def note(self, *parts):
        log(*parts)
        self.diary.add("log", text=" ".join(str(p) for p in parts)[:300])

    def heard(self, kind, text):
        self.diary.add("said", what=kind, text=text)
        self.wall.post("/api/senses/heard", {"kind": kind, "text": text})

    def apply(self, s):
        if not isinstance(s, dict):
            return
        old, self.settings = self.settings, s
        # the camera
        if s.get("camera"):
            if old.get("cameraDevice") != s.get("cameraDevice") and self.eyes.running():
                self.eyes.stop()
            self.eyes.device = s.get("cameraDevice") or None
            self.eyes.hfov = float(s.get("hfov") or 70)
            self.eyes.face_width_m = float(s.get("faceWidth") or 0.15)
            self.eyes.focal_px = scale_focal(s.get("focalPx"), s.get("focalWidth"), DETECT_WIDTH) if s.get("focalPx") else None
            self.eyes.zones = s.get("zones") or []
            self.eyes.floor = s.get("floorMap") or None
            self.eyes.wall_m = s.get("paperWall")
            self.eyes.set_look(s.get("look") or "body")
            if not self.eyes.running():
                self.eyes.start()
        elif self.eyes.running():
            self.eyes.stop()
            log("eyes: camera off")
        # the microphone
        restart = self.ears.configure(s)
        if s.get("mic"):
            if restart and self.ears.running():
                self.ears.stop()
            if not self.ears.running():
                self.ears.start()
        elif self.ears.running():
            self.ears.stop()
            log("ears: microphone off")

    def calibrate(self, job):
        """A job from the phone: 'face' (stand `meters` away), 'zone' (remember
        where you are as `name`) or 'paper' (find the sheet on the floor)."""
        if self.calibrating:
            return
        self.calibrating = job.get("id")
        kind = job.get("kind") or "face"

        def run():
            body = {"id": job.get("id"), "kind": kind}
            try:
                if kind == "zone":
                    self.eyes.take_sigs()
                    time.sleep(3.0)
                    sig = average_signature(self.eyes.take_sigs())
                    body.update({"name": job.get("name"), "sig": sig} if sig else {"error": "no-person"})
                elif kind == "paper":
                    self.eyes.take_quads()
                    self.eyes.want_paper = True
                    time.sleep(3.0)
                    self.eyes.want_paper = False
                    quads = self.eyes.take_quads()
                    if len(quads) < 3:
                        body["error"] = "no-paper"
                    else:
                        # the middle reading of each corner, after putting them in the same order
                        ordered = [order_quad(q) for q in quads]
                        quad = [[sorted(q[i][k] for q in ordered)[len(ordered) // 2] for k in (0, 1)] for i in range(4)]
                        fmap = floor_map(quad, job.get("paper") or "letter")
                        body.update({"quad": quad, "floorMap": fmap} if fmap else {"error": "no-paper"})
                else:
                    self.eyes.take_widths()
                    time.sleep(2.5)
                    widths = self.eyes.take_widths()
                    focal = calibrate_focal(widths, float(job.get("meters") or 1), self.eyes.face_width_m)
                    body["samples"] = len(widths)
                    if focal:
                        body.update({"focalPx": round(focal, 2), "focalWidth": DETECT_WIDTH})
                    else:
                        body["error"] = "no-face"
                self.wall.post("/api/senses/calibrated", body)
            finally:
                self.eyes.want_paper = False
                self.calibrating = None

        threading.Thread(target=run, daemon=True).start()

    def tick(self):
        cam = self.eyes.snapshot() if self.settings.get("camera") else {"ok": False}
        mic = self.ears.snapshot() if self.settings.get("mic") else {"ok": False}
        now = time.monotonic()
        if not moved(cam, self.last_sent) and now - self.last_post < HEARTBEAT:
            return
        reply = self.wall.post("/api/senses/state", {"version": VERSION, "camera": cam, "mic": mic})
        self.last_post = now
        self.last_sent = cam
        self.diary.add("camera", **{k: v for k, v in cam.items() if k != "device"})
        if mic.get("state") not in (None, "idle", "listening") or mic.get("error"):
            self.diary.add("mic", state=mic.get("state"), error=mic.get("error"), level=mic.get("level"))
        if not reply:
            return
        if reply.get("settings") != self.settings:
            self.apply(reply.get("settings"))
        if reply.get("hushMs"):
            self.ears.hush(reply["hushMs"] / 1000.0)
        self.ears.notes = bool(reply.get("notes"))
        if reply.get("calibrate"):
            self.calibrate(reply["calibrate"])
        if reply.get("report"):
            self.report(reply["report"])

    def report(self, report_id):
        """The phone said "that was wrong": send the last 30 s of decisions."""
        if report_id == self.reported:
            return
        self.reported = report_id
        rows = self.diary.rows()
        threading.Thread(target=lambda: self.wall.post("/api/senses/report", {"id": report_id, "rows": rows}), daemon=True).start()

    def close(self):
        self.eyes.stop()
        self.ears.stop()


def check():
    rows = [
        ("numpy", "numpy"),
        ("OpenCV (camera)", "cv2"),
        ("faster-whisper (transcription)", "faster_whisper"),
        ("openWakeWord (optional)", "openwakeword"),
    ]
    for label, mod in rows:
        print(f"  {'ok ' if importlib.util.find_spec(mod) else '-- '} {label}")
    import os

    yunet = os.path.join(model_dir(), YUNET_NAME)
    print(f"  {'ok ' if os.path.exists(yunet) else '-- '} YuNet face model ({yunet})")
    yolox = os.path.join(model_dir(), YOLOX_NAME)
    print(f"  {'ok ' if os.path.exists(yolox) else '-- '} YOLOX whole-body model ({yolox})")
    return 0


def list_devices():
    print("microphones (PipeWire sources):")
    for line in list_sources():
        cols = line.split("\t")
        if len(cols) > 1 and not cols[1].endswith(".monitor"):
            print("  ", cols[1])
    print("cameras:")
    for dev in sorted(glob.glob("/dev/video*")):
        print("  ", dev)
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="wall_senses")
    ap.add_argument("--list", action="store_true", help="list microphones and cameras")
    ap.add_argument("--check", action="store_true", help="show what is installed")
    args = ap.parse_args(argv)
    if args.list:
        return list_devices()
    if args.check:
        return check()

    senses = Senses(Wall())
    stopping = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stopping.set())
    signal.signal(signal.SIGINT, lambda *_: stopping.set())
    log(f"talking to {senses.wall.url}")
    try:
        while not stopping.is_set():
            senses.tick()
            stopping.wait(TICK)
    finally:
        senses.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
