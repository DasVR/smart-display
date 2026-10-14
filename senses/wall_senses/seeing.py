"""The webcam's eyes: is someone there, how far, and where across the room.

Frames are read a few times a second at a small size, looked at, and
dropped. Nothing is saved or sent: only the summary (how many faces, the
nearest one's distance and side, whether anything moved) leaves this file.

Face finding uses OpenCV's YuNet when its model file is present (the install
script fetches it), else the Haar cascade that ships inside OpenCV, which is
rougher but needs nothing extra. Neither knows who anyone is.
"""

import os
import threading
import time

from .distance import FACE_WIDTH_M, Tracker, focal_from_fov

DETECT_WIDTH = 320
DETECT_HEIGHT = 240
YUNET_NAME = "face_detection_yunet_2023mar.onnx"


def model_dir():
    return os.environ.get("WALL_SENSES_MODELS") or os.path.join(os.path.expanduser("~"), ".cache", "wall-senses")


class Eyes:
    def __init__(self, device=None, fps=5.0, hfov=70.0, log=print):
        self.device = device
        self.interval = 1.0 / max(0.5, fps)
        self.hfov = hfov
        self.log = log
        self.focal_px = None  # calibrated, at DETECT_WIDTH
        self.face_width_m = FACE_WIDTH_M
        self.state = {"ok": False, "count": 0, "distance": None, "x": None, "motion": 0.0, "detector": None}
        self.recent_widths = []
        self._track = Tracker()
        self._stop = threading.Event()
        self._thread = None
        self._lock = threading.Lock()

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

    def _detector(self, cv2):
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
        name, find = self._detector(cv2)
        self.log(f"eyes: camera open, faces by {name}")
        prev = None
        misses = 0
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
                small = cv2.resize(frame, (DETECT_WIDTH, DETECT_HEIGHT), interpolation=cv2.INTER_AREA)
                gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
                faces = find(small, gray)
                # how much of the picture changed: someone moving with their back turned
                tiny = cv2.resize(gray, (80, 60), interpolation=cv2.INTER_AREA)
                motion = 0.0
                if prev is not None:
                    diff = cv2.absdiff(tiny, prev)
                    motion = float((diff > 18).mean())
                prev = tiny
                del frame, small, gray  # nothing outlives the frame it came from
                self._update(name, faces, motion)
                wait = self.interval - (time.monotonic() - started)
                if wait > 0:
                    self._stop.wait(wait)
        finally:
            cap.release()

    def _update(self, name, faces, motion):
        focal = self.focal_px or focal_from_fov(DETECT_WIDTH, self.hfov)
        seen = self._track.update(faces, DETECT_WIDTH, focal, time.monotonic(), self.face_width_m)
        with self._lock:
            # every face seen counts for calibrating, steady or not
            for f in faces:
                if f and f[2] >= 14:
                    self.recent_widths = (self.recent_widths + [f[2]])[-60:]
            self.state = {
                "ok": True,
                "detector": name,
                "count": seen["count"],
                "distance": seen["distance"],
                "x": seen["x"],
                "motion": round(motion, 3),
                "calibrated": bool(self.focal_px),
            }
