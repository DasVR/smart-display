"""The webcam's eyes: is someone there, where in the room, and how far.

Two ways of looking, chosen on the phone:

  body  (default) whole people, any pose: lying down, back turned, seen from
        a camera up high that takes in the whole room (YOLOX, bodies.py).
        Where you are comes from remembered spots and from a sheet of paper
        on the floor (room.py).
  face  faces only (YuNet, else OpenCV's Haar cascade), for a camera at
        face height that you look at; distance from face width.

Frames are read a few times a second, looked at, and dropped. Nothing is
saved or sent: only the summary leaves this file (how many people, where,
how far, lying or upright, whether anything moved, and outlines as numbers
between 0 and 1 so the phone can draw a diagram; never the picture).
"""

import os
import threading
import time

from . import room
from .bodies import PersonFinder, find_paper, yolox_path
from .distance import FACE_WIDTH_M, Tracker, focal_from_fov

DETECT_WIDTH = 320
DETECT_HEIGHT = 240
YUNET_NAME = "face_detection_yunet_2023mar.onnx"
BODY_EVERY = 0.4  # seconds between whole-body looks (each takes ~0.2 s of CPU)


def model_dir():
    return os.environ.get("WALL_SENSES_MODELS") or os.path.join(os.path.expanduser("~"), ".cache", "wall-senses")


class Eyes:
    def __init__(self, device=None, fps=5.0, hfov=70.0, log=print):
        self.device = device
        self.interval = 1.0 / max(0.5, fps)
        self.hfov = hfov
        self.log = log
        self.look = "body"
        self.focal_px = None  # face mode, calibrated at DETECT_WIDTH
        self.face_width_m = FACE_WIDTH_M
        self.floor = None  # body mode: picture (0..1) to floor (metres) map
        self.wall_m = None  # how far the paper's near edge is from the camera's wall
        self.zones = []
        self.state = {"ok": False, "count": 0, "distance": None, "x": None, "motion": 0.0, "detector": None}
        self.recent_widths = []
        self.recent_sigs = []
        self.recent_quads = []
        self.want_paper = False
        self._track = Tracker()
        self._stop = threading.Event()
        self._thread = None
        self._lock = threading.Lock()

    # --- settings ----------------------------------------------------------

    def set_look(self, look):
        look = "face" if look == "face" else "body"
        if look != self.look:
            self.look = look
            # a person is held longer in body mode: lying still is still there
            self._track = Tracker(hold=1.5) if look == "face" else Tracker(hold=6.0)
            if self.running():
                self.stop()
                self.start()

    # --- lifecycle -------------------------------------------------------

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="eyes", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=3)
        self._thread = None
        with self._lock:
            self.state = {**self.state, "ok": False, "count": 0, "distance": None, "x": None, "motion": 0.0}

    def running(self):
        return bool(self._thread and self._thread.is_alive())

    def snapshot(self):
        with self._lock:
            return dict(self.state)

    def take_widths(self):
        """Face widths (px at DETECT_WIDTH) seen since the last call, for calibrating."""
        with self._lock:
            widths, self.recent_widths = self.recent_widths, []
        return widths

    def take_sigs(self):
        """Outlines of the person followed, since the last call, for remembering a spot."""
        with self._lock:
            sigs, self.recent_sigs = self.recent_sigs, []
        return sigs

    def take_quads(self):
        """Paper corners (0..1) found since the last call, for mapping the floor."""
        with self._lock:
            quads, self.recent_quads = self.recent_quads, []
        return quads

    # --- the loop --------------------------------------------------------

    def _open(self, cv2):
        dev = self.device if self.device not in (None, "") else 0
        if isinstance(dev, str) and dev.isdigit():
            dev = int(dev)
        cap = cv2.VideoCapture(dev, cv2.CAP_V4L2) if hasattr(cv2, "CAP_V4L2") else cv2.VideoCapture(dev)
        if not cap.isOpened():
            cap = cv2.VideoCapture(dev)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        return cap

    def _face_detector(self, cv2):
        path = os.path.join(model_dir(), YUNET_NAME)
        if os.path.exists(path) and hasattr(cv2, "FaceDetectorYN"):
            yunet = cv2.FaceDetectorYN.create(path, "", (DETECT_WIDTH, DETECT_HEIGHT), 0.6, 0.3, 20)

            def find(small, gray):
                _, faces = yunet.detect(small)
                return [] if faces is None else [tuple(float(v) for v in f[:4]) for f in faces]

            return "yunet", find
        cascade = cv2.CascadeClassifier(os.path.join(cv2.data.haarcascades, "haarcascade_frontalface_default.xml"))

        def find(small, gray):
            found = cascade.detectMultiScale(gray, scaleFactor=1.15, minNeighbors=5, minSize=(18, 18))
            return [tuple(float(v) for v in f) for f in found]

        return "haar", find

    def _body_detector(self):
        path = yolox_path(model_dir())
        if not path:
            self.log("eyes: the YOLOX model is missing (scripts/senses/install.sh); looking for faces instead")
            return None
        return PersonFinder(path)

    def _run(self):
        try:
            import cv2
        except ImportError:
            self.log("eyes: OpenCV is not installed (scripts/senses/install.sh)")
            return
        cap = self._open(cv2)
        if not cap.isOpened():
            self.log(f"eyes: no camera at {self.device or 0}")
            with self._lock:
                self.state = {**self.state, "ok": False, "error": "no-camera"}
            return
        bodies = self._body_detector() if self.look == "body" else None
        name, faces = ("yolox", None) if bodies else self._face_detector(cv2)
        self.log(f"eyes: camera open, looking for {'whole people' if bodies else 'faces'} ({name})")
        prev = None
        misses = 0
        last_body = 0.0
        try:
            while not self._stop.is_set():
                started = time.monotonic()
                ok, frame = cap.read()
                if not ok:
                    misses += 1
                    if misses > 20:
                        self.log("eyes: the camera stopped sending frames; reopening")
                        cap.release()
                        time.sleep(2)
                        cap = self._open(cv2)
                        misses = 0
                    time.sleep(0.2)
                    continue
                misses = 0
                fh, fw = frame.shape[:2]
                small = cv2.resize(frame, (DETECT_WIDTH, DETECT_HEIGHT), interpolation=cv2.INTER_AREA)
                gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
                # how much of the picture changed: someone moving, whichever way they face
                tiny = cv2.resize(gray, (80, 60), interpolation=cv2.INTER_AREA)
                motion = 0.0
                if prev is not None:
                    motion = float((cv2.absdiff(tiny, prev) > 18).mean())
                prev = tiny
                if self.want_paper:
                    quad = find_paper(frame)
                    if quad:
                        with self._lock:
                            self.recent_quads.append([[x / fw, y / fh] for x, y in quad])
                if bodies:
                    if started - last_body >= BODY_EVERY:
                        last_body = started
                        found = [(x / fw, y / fh, w / fw, h / fh) for x, y, w, h, _ in bodies.find(frame)]
                        self._update_body(found, motion, fw / fh)
                    else:
                        with self._lock:
                            self.state = {**self.state, "motion": round(motion, 3)}
                else:
                    self._update_face(name, faces(small, gray), motion)
                del frame, small, gray  # nothing outlives the frame it came from
                wait = self.interval - (time.monotonic() - started)
                if wait > 0:
                    self._stop.wait(wait)
        finally:
            cap.release()

    def _update_face(self, name, faces, motion):
        focal = self.focal_px or focal_from_fov(DETECT_WIDTH, self.hfov)
        seen = self._track.update(faces, DETECT_WIDTH, focal, time.monotonic(), self.face_width_m)
        with self._lock:
            # every face seen counts for calibrating, steady or not
            for f in faces:
                if f and f[2] >= 14:
                    self.recent_widths = (self.recent_widths + [f[2]])[-60:]
            self.state = {
                "ok": True,
                "look": "face",
                "detector": name,
                "count": seen["count"],
                "distance": seen["distance"],
                "x": seen["x"],
                "motion": round(motion, 3),
                "calibrated": bool(self.focal_px),
                "boxes": [[round(v / s, 3) for v, s in zip(f[:4], (DETECT_WIDTH, DETECT_HEIGHT) * 2)] for f in faces[:6]],
            }

    def _update_body(self, people, motion, aspect=4 / 3):
        floor, wall = self.floor, self.wall_m

        def measure(box):
            return room.distance_from_wall(room.floor_position(floor, box), wall)

        # boxes here are 0..1, so "frame width" is 1 and the smallest person kept is 3% of it
        seen = self._track.update(people, 1.0, 1.0, time.monotonic(), min_width_px=0.03, measure=measure if floor else (lambda b: None))
        box = seen["box"]
        zone = posture = pos = None
        if box:
            sig = room.signature(box)
            zone = room.match_zone(sig, self.zones)
            posture = room.posture(box, aspect)
            pos = room.floor_position(floor, box) if floor else None
        with self._lock:
            if box:
                self.recent_sigs = (self.recent_sigs + [room.signature(box)])[-40:]
            self.state = {
                "ok": True,
                "look": "body",
                "detector": "yolox",
                "count": seen["count"],
                # without a paper-mapped floor there are no metres, only spots
                "distance": seen["distance"] if floor else None,
                "x": seen["x"],
                "zone": zone,
                "posture": posture,
                "floor": [round(pos[0], 2), round(pos[1], 2)] if pos else None,
                "motion": round(motion, 3),
                "calibrated": bool(floor),
                "boxes": [[round(v, 3) for v in p[:4]] for p in people[:6]],
            }
