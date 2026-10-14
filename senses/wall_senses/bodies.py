"""Finding whole people, and a sheet of paper on the floor, in one camera frame.

People: YOLOX-S from the OpenCV Model Zoo (Apache 2.0), run with OpenCV's
own dnn module, so nothing new to install. It finds a person in any pose and
from any side: lying down, back turned, seen from above. Only its "person"
class is kept; it does not know who anyone is.

Paper: the brightest clean four-cornered shape on the floor.

Frames come in and boxes go out; nothing is kept.
"""

import os

YOLOX_NAME = "object_detection_yolox_2022nov.onnx"
INPUT = 640
PERSON = 0


class PersonFinder:
    def __init__(self, path, score=0.35, nms=0.5):
        import cv2  # noqa: PLC0415
        import numpy as np  # noqa: PLC0415

        self.cv2, self.np = cv2, np
        self.net = cv2.dnn.readNet(path)
        self.score, self.nms = score, nms
        grids, strides = [], []
        for s in (8, 16, 32):
            n = INPUT // s
            xv, yv = np.meshgrid(np.arange(n), np.arange(n))
            grids.append(np.stack((xv, yv), 2).reshape(-1, 2))
            strides.append(np.full((n * n, 1), s))
        self.grids = np.concatenate(grids, 0).astype(np.float32)
        self.strides = np.concatenate(strides, 0).astype(np.float32)

    def find(self, frame_bgr):
        """People as (x, y, w, h, score) in the frame's own pixels."""
        cv2, np = self.cv2, self.np
        h, w = frame_bgr.shape[:2]
        ratio = min(INPUT / h, INPUT / w)
        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        resized = cv2.resize(rgb, (int(w * ratio), int(h * ratio)), interpolation=cv2.INTER_LINEAR)
        padded = np.full((INPUT, INPUT, 3), 114.0, np.float32)
        padded[: resized.shape[0], : resized.shape[1]] = resized
        self.net.setInput(np.transpose(padded, (2, 0, 1))[np.newaxis])
        out = self.net.forward(self.net.getUnconnectedOutLayersNames())[0][0]
        xy = (out[:, :2] + self.grids) * self.strides
        wh = np.exp(out[:, 2:4]) * self.strides
        scores = out[:, 4] * out[:, 5 + PERSON]
        keep = scores > self.score
        if not keep.any():
            return []
        xy, wh, scores = xy[keep], wh[keep], scores[keep]
        boxes = np.concatenate([xy - wh / 2, wh], 1) / ratio
        idx = cv2.dnn.NMSBoxes(boxes.tolist(), scores.tolist(), self.score, self.nms)
        found = []
        for i in np.array(idx).reshape(-1):
            x, y, bw, bh = boxes[i]
            x0, y0 = max(0.0, x), max(0.0, y)
            found.append((float(x0), float(y0), float(min(w, x + bw) - x0), float(min(h, y + bh) - y0), float(scores[i])))
        return found


def find_paper(frame_bgr):
    """The four corners (pixels) of a sheet of paper lying in view, or None.

    White paper is the brightest flat thing in most rooms: threshold the
    bright end, close small gaps, and keep the largest convex four-sided
    outline of a sensible size.
    """
    import cv2  # noqa: PLC0415
    import numpy as np  # noqa: PLC0415

    h, w = frame_bgr.shape[:2]
    gray = cv2.GaussianBlur(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY), (5, 5), 0)
    level, _ = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    _, bright = cv2.threshold(gray, max(level, np.percentile(gray, 90) - 10, 150), 255, cv2.THRESH_BINARY)
    bright = cv2.morphologyEx(bright, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    best, best_area = None, 0.0
    # as found, then pulled apart a little: paper touching another bright thing
    # (a white bedsheet, a lamp's pool of light) comes loose from it
    for mask in (bright, cv2.erode(bright, np.ones((7, 7), np.uint8))):
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for c in contours:
            area = cv2.contourArea(c)
            if area < 0.0004 * w * h or area > 0.25 * w * h:
                continue
            approx = cv2.approxPolyDP(c, 0.03 * cv2.arcLength(c, True), True)
            if len(approx) != 4 or not cv2.isContourConvex(approx):
                continue
            # a sheet fills its outline; a bright window frame or a lamp's glow doesn't
            if area / max(1.0, cv2.contourArea(cv2.convexHull(c))) < 0.9:
                continue
            if area > best_area:
                best, best_area = approx.reshape(4, 2).astype(float).tolist(), area
        if best:
            break
    return best


def yolox_path(model_dir):
    p = os.path.join(model_dir, YOLOX_NAME)
    return p if os.path.exists(p) else None
