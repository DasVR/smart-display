#!/usr/bin/env python3
"""Draw the standby light for the boot splash: the 10 px warm-white dot and its
glow exactly as the browser draws them in static/boot.html and src/app.html,
as a PNG with alpha. Standard library only.  make-light.py <out.png>"""

import math
import struct
import sys
import zlib

R, G, B = 0xF4, 0xEF, 0xE6

# The glow as Chromium draws the CSS, measured from the light at full breath
# (the red channel, 0..244, every pixel out from the centre). Drawing the
# measured curve, rather than modelling how CSS blurs a shadow, makes the two
# match pixel for pixel. Re-measure if the CSS changes.
PROFILE = [
    244, 244, 244, 244, 225, 32, 30, 28, 27, 25, 23, 21, 19, 17, 15, 13, 11, 10, 9, 7,
    6, 5, 4, 3, 3, 3, 2, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2,
    2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0,
]
SIZE = 2 * len(PROFILE) + 1


def alpha_at(d):
    """Coverage at distance d from the centre, between the measured pixels."""
    i = int(d)
    if i + 1 >= len(PROFILE):
        return 0.0
    f = d - i
    return (PROFILE[i] * (1 - f) + PROFILE[i + 1] * f) / 244.0


def png(path):
    c = SIZE // 2
    rows = []
    for y in range(SIZE):
        row = bytearray([0])
        for x in range(SIZE):
            a = alpha_at(math.hypot(x - c, y - c))
            row += bytes((R, G, B, round(a * 255)))
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(chunk(b"IEND", b""))


if __name__ == "__main__":
    png(sys.argv[1] if len(sys.argv) > 1 else "light.png")
