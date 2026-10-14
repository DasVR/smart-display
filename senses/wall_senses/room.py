"""Where in the room someone is, from a camera up high that sees the whole room.

Two ways to know, both set up from the phone:

Spots. Lie on the bed and tap "remember: bed"; sit at the desk and tap
"remember: desk". Each spot keeps the outline the camera saw you in (where
in the picture, how big). From then on, whichever spot's outline is closest
is where you are. This works lying down, with your back turned, anything:
it doesn't need to know what a person looks like, only where they were.

The floor. Lay a sheet of printer paper flat on the floor, long edge toward
the camera. Its four corners and its known size give a map from the picture
to the floor in metres (a homography). A person's feet (the bottom middle
of their outline) then land on that map. Tell it how far the paper's near
edge is from the wall under the camera and it gives metres from the wall.

Everything here is arithmetic on numbers between 0 and 1 (positions in the
picture), so it is tested without a camera.
"""

import math

# width (long side) and depth (short side) in metres, long edge facing the camera
PAPER = {"letter": (0.2794, 0.2159), "a4": (0.297, 0.210)}


def order_quad(pts):
    """Four corners as top-left, top-right, bottom-right, bottom-left (image coords, y down)."""
    pts = [tuple(p) for p in pts]
    if len(pts) != 4:
        raise ValueError("need four corners")
    by_sum = sorted(pts, key=lambda p: p[0] + p[1])
    tl, br = by_sum[0], by_sum[-1]
    rest = [p for p in pts if p is not tl and p is not br]
    if len(rest) != 2:  # duplicate points
        rest = by_sum[1:3]
    tr, bl = sorted(rest, key=lambda p: p[1] - p[0])
    return [tl, tr, br, bl]


def _solve(a, b):
    """Gaussian elimination with partial pivoting; None when singular."""
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(m[r][c]))
        if abs(m[p][c]) < 1e-12:
            return None
        m[c], m[p] = m[p], m[c]
        for r in range(n):
            if r != c:
                f = m[r][c] / m[c][c]
                for k in range(c, n + 1):
                    m[r][k] -= f * m[c][k]
    return [m[i][n] / m[i][i] for i in range(n)]


def solve_homography(src, dst):
    """The 3x3 map (as 9 numbers, h33 = 1) taking four src points onto four dst points."""
    a, b = [], []
    for (x, y), (u, v) in zip(src, dst):
        a.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        b.append(u)
        a.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        b.append(v)
    h = _solve(a, b)
    return None if h is None else h + [1.0]


def apply_h(h, x, y):
    w = h[6] * x + h[7] * y + h[8]
    if abs(w) < 1e-9:
        return None
    return ((h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w)


def floor_map(quad, paper="letter"):
    """From the paper's corners in the picture (0..1 coords) to the floor in metres.

    The floor's origin is the middle of the paper's near edge (the one nearest
    the camera, lowest in the picture); x runs to the right as the camera sees
    it, y away from the camera.
    """
    long_m, short_m = PAPER.get(paper, PAPER["letter"])
    tl, tr, br, bl = order_quad(quad)
    dst = [(-long_m / 2, short_m), (long_m / 2, short_m), (long_m / 2, 0.0), (-long_m / 2, 0.0)]
    return solve_homography([tl, tr, br, bl], dst)


def feet(box):
    """Where a person meets the floor: the bottom middle of their outline (x, y, w, h)."""
    x, y, w, h = box[:4]
    return (x + w / 2.0, y + h)


def floor_position(h, box):
    """The person's spot on the floor in metres, or None when the map can't say."""
    if not h:
        return None
    p = apply_h(h, *feet(box))
    if p is None or not all(math.isfinite(v) for v in p):
        return None
    # behind the camera or absurdly far: the map is being stretched past its use
    if p[1] < -6 or p[1] > 15 or abs(p[0]) > 15:
        return None
    return p


def distance_from_wall(pos, wall_m):
    """Metres from the camera's wall to someone at `pos` on the floor map."""
    if pos is None or wall_m is None:
        return None
    x, y = pos
    d = math.hypot(x, wall_m + y)
    return round(d, 2) if 0.2 <= d <= 15 else None


def signature(box):
    """A spot's outline, from a box in 0..1 picture coords: centre and size."""
    x, y, w, h = box[:4]
    return [round(x + w / 2.0, 4), round(y + h / 2.0, 4), round(w, 4), round(h, 4)]


def zone_distance(a, b):
    """How unlike two outlines are: mostly where they are, partly how big."""
    return math.hypot(a[0] - b[0], a[1] - b[1]) + 0.5 * (abs(a[2] - b[2]) + abs(a[3] - b[3]))


def match_zone(sig, zones, limit=0.25):
    """The name of the remembered spot nearest this outline, or None if none is close."""
    best, best_d = None, limit
    for z in zones or []:
        s = z.get("sig") if isinstance(z, dict) else None
        if not s or len(s) != 4:
            continue
        d = zone_distance(sig, s)
        if d < best_d:
            best, best_d = z.get("name"), d
    return best


def average_signature(sigs):
    """The middle of several outlines (per number), ignoring the odd one out."""
    sigs = [s for s in sigs if s and len(s) == 4]
    if not sigs:
        return None
    out = []
    for i in range(4):
        col = sorted(s[i] for s in sigs)
        out.append(round(col[len(col) // 2], 4))
    return out


def posture(box, aspect=4 / 3):
    """'lying' when the outline is clearly wider than tall, else 'upright'.

    `box` is in 0..1 picture coords, so `aspect` (the picture's width over its
    height) turns it back into a real shape first.
    """
    _, _, w, h = box[:4]
    return "lying" if h > 0 and w * aspect > 1.15 * h else "upright"
