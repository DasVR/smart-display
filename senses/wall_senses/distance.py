"""How far away someone is, from how wide their face looks to the webcam.

A pinhole camera: an object W metres wide at distance d shows up w pixels
wide, with w = f * W / d, where f is the lens's focal length in pixels. So
d = f * W / w. Faces are close enough to one width (about 15 cm for the box a
face detector draws) that this works to within roughly 10 to 15 percent.

f comes from the webcam's field of view until you calibrate: stand a known
distance away (1 m is easy) and the wall measures your face, which also
soaks up the difference between your face and the average one.

Nothing here touches the camera; it is all arithmetic, so it is tested
without one.
"""

import math
from collections import deque

# The box a face detector draws around an adult face, cheek to cheek.
FACE_WIDTH_M = 0.15
# Most webcams see 60 to 80 degrees across; 70 is a fair guess until calibrated.
DEFAULT_HFOV_DEG = 70.0


def focal_from_fov(frame_width_px, hfov_deg=DEFAULT_HFOV_DEG):
    """Focal length in pixels for a frame this wide and a lens this wide."""
    return (frame_width_px / 2.0) / math.tan(math.radians(hfov_deg) / 2.0)


def distance_m(face_width_px, focal_px, face_width_m=FACE_WIDTH_M):
    """Metres from the camera to a face this many pixels wide."""
    if not face_width_px or face_width_px <= 0 or not focal_px:
        return None
    return focal_px * face_width_m / face_width_px


def calibrate_focal(face_widths_px, meters, face_width_m=FACE_WIDTH_M):
    """The focal length that puts these face widths at `meters`.

    Takes the median, so a frame where the detector slipped doesn't count.
    """
    widths = sorted(w for w in face_widths_px if w and w > 0)
    if not widths or not meters or meters <= 0:
        return None
    mid = len(widths) // 2
    median = widths[mid] if len(widths) % 2 else (widths[mid - 1] + widths[mid]) / 2.0
    return median * meters / face_width_m


def scale_focal(focal_px, calibrated_width_px, frame_width_px):
    """A focal length measured at one frame width, used at another."""
    if not focal_px or not calibrated_width_px:
        return focal_px
    return focal_px * frame_width_px / calibrated_width_px


class Smoother:
    """Median of the last few readings, then an easing toward it.

    The median throws out a single bad frame; the easing keeps the number on
    the wall from shivering while you stand still.
    """

    def __init__(self, window=5, ease=0.35):
        self.window = deque(maxlen=window)
        self.ease = ease
        self.value = None

    def push(self, reading):
        if reading is None:
            return self.value
        self.window.append(reading)
        ordered = sorted(self.window)
        median = ordered[len(ordered) // 2]
        if self.value is None:
            self.value = median
        else:
            self.value += (median - self.value) * self.ease
        return self.value

    def reset(self):
        self.window.clear()
        self.value = None


def summarize(faces, frame_width_px, focal_px, face_width_m=FACE_WIDTH_M):
    """What the wall is told about one frame: numbers only.

    faces: (x, y, w, h) boxes in pixels. Returns count, the distance to the
    nearest face, where it is across the frame (-1 left to 1 right, as you
    face the wall, so the camera's mirror image is undone), and its width.
    """
    boxes = [f for f in faces if f and f[2] > 0]
    if not boxes:
        return {"count": 0, "distance": None, "x": None, "faceWidth": None}
    nearest = max(boxes, key=lambda b: b[2])
    x, _, w, _ = nearest[:4]
    centre = (x + w / 2.0) / frame_width_px
    return {
        "count": len(boxes),
        "distance": distance_m(w, focal_px, face_width_m),
        # the camera looks out of the wall, so its left is your right
        "x": round(max(-1.0, min(1.0, 1.0 - 2.0 * centre)), 3),
        "faceWidth": w,
    }


class Tracker:
    """Keeps hold of one person from frame to frame, so the wall doesn't flicker.

    A face detector misses now and then (a turned head, a blink of bad light),
    and with two people it may find either first. So:
      - someone counts as there only after `appear` frames in a row with a face,
        and as gone only after `hold` seconds without one (the last numbers are
        kept meanwhile);
      - the face followed is the one nearest where the last one was;
      - distance and side are both smoothed.
    """

    def __init__(self, appear=2, hold=1.5, ease_x=0.3):
        self.appear = appear
        self.hold = hold
        self.ease_x = ease_x
        self.dist = Smoother(window=7, ease=0.3)
        self.reset()

    def reset(self):
        self.seen_run = 0
        self.present = False
        self.last_seen = None
        self.centre = None
        self.x = None
        self.count = 0
        self.dist.reset()

    def _pick(self, boxes):
        if self.centre is None or len(boxes) == 1:
            return max(boxes, key=lambda b: b[2])
        cx, cy = self.centre
        return min(boxes, key=lambda b: (b[0] + b[2] / 2 - cx) ** 2 + (b[1] + b[3] / 2 - cy) ** 2)

    def update(self, faces, frame_width_px, focal_px, now, face_width_m=FACE_WIDTH_M, min_width_px=14):
        boxes = [f for f in faces if f and f[2] >= min_width_px]
        if boxes:
            self.seen_run += 1
            self.last_seen = now
            box = self._pick(boxes)
            x, y, w, h = box[:4]
            self.centre = (x + w / 2.0, y + h / 2.0)
            side = max(-1.0, min(1.0, 1.0 - 2.0 * (x + w / 2.0) / frame_width_px))
            self.x = side if self.x is None else self.x + (side - self.x) * self.ease_x
            self.dist.push(distance_m(w, focal_px, face_width_m))
            if self.seen_run >= self.appear:
                self.present = True
            if self.present:
                self.count = len(boxes)
        else:
            self.seen_run = 0
            if not self.present:
                self.reset()  # a one-frame blip that never became someone
            elif self.last_seen is not None and now - self.last_seen > self.hold:
                self.reset()
        if not self.present:
            return {"count": 0, "distance": None, "x": None}
        return {
            "count": max(1, self.count),
            "distance": round(self.dist.value, 2) if self.dist.value else None,
            "x": round(self.x, 3) if self.x is not None else None,
        }
