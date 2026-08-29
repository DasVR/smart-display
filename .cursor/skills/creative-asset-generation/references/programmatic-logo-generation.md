# Programmatic Logo Generation — PIL Templates

Complete script templates for generating brand assets with Pillow.

---

## Template 1: Geometric Monogram with Glow

```python
#!/usr/bin/env python3
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

OUT = "logo"
os.makedirs(OUT, exist_ok=True)

ABYSS = (5, 5, 7)
ACCENT = (160, 130, 245)  # violet
CREAM = (232, 228, 220)

def rounded_tile(size, radius, bg):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle([0,0,size-1,size-1], radius=radius, fill=bg)
    return img

def add_glow(img, color, radius=30, strength=0.45):
    alpha = img.split()[3]
    blurred = alpha.filter(ImageFilter.GaussianBlur(radius))
    glow_layer = Image.new("RGBA", img.size, color + (0,))
    glow_layer.putalpha(blurred.point(lambda p: int(p * strength)))
    return Image.alpha_composite(glow_layer, img)

def add_scanlines(img, step=5, alpha=6):
    d = ImageDraw.Draw(img, "RGBA")
    W, H = img.size
    for y in range(0, H, step):
        d.line([(0,y),(W,y)], fill=(255,255,255,alpha))

# Build icon
S = 1024
icon = rounded_tile(S, 160, ABYSS)
add_scanlines(icon)
d = ImageDraw.Draw(icon, "RGBA")

# Draw N monogram
margin, bar_w = 160, 140
x1, x2 = margin, margin + bar_w
x3, x4 = S - margin - bar_w, S - margin
yt, yb = margin, S - margin

N_poly = [
    (x1, yt), (x2, yt), (x2, yb - int(bar_w*1.6)),
    (x3, yt), (x4, yt), (x4, yb), (x3, yb),
    (x3, yt + int(bar_w*1.6)), (x1, yb), (x1, yt)
]
d.polygon(N_poly, fill=ACCENT)

# Notches
notch = 90
notches = [
    (x1 + 40, yt + 60, notch),
    (x4 - 40 - notch, yb - 60 - notch, notch),
    ((x1+x2)//2 - notch//2, (yt+yb)//2 - notch//2, notch),
]
for nx, ny, nw in notches:
    d.rectangle([nx, ny, nx+nw, ny+nw], fill=ABYSS)

icon = add_glow(icon, ACCENT, radius=45, strength=0.5)
icon.save(f"{OUT}/icon.png")
```

---

## Template 2: Wordmark with Cursor

```python
# After the imports above
W, H = 1600, 500
wm = Image.new("RGBA", (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(wm, "RGBA")

font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
f = ImageFont.truetype(font_path, 320)

word = "NIL"
wb = d.textbbox((0, 0), word, font=f)
ww = wb[2] - wb[0]; wh = wb[3] - wb[1]
wx = (W - ww) // 2 - wb[0]
wy = (H - wh) // 2 - wb[1]

d.text((wx, wy), word, font=f, fill=CREAM)

# Cursor block
cw, ch = 140, 34
cx = wx + ww + 50
cy = wy + wh + 30
d.rounded_rectangle([cx, cy, cx+cw, cy+ch], radius=10, fill=ACCENT)

wm = add_glow(wm, ACCENT, radius=25, strength=0.3)
wm.save(f"{OUT}/wordmark.png")
```

---

## Template 3: Multi-Variant Generation

```python
PALETTES = {
    "violet": {"accent": (160, 130, 245), "name": "Violet"},
    "coral": {"accent": (235, 128, 108), "name": "Coral"},
    "amber": {"accent": (245, 166, 35), "name": "Amber"},
}

for key, pal in PALETTES.items():
    accent = pal["accent"]
    # ... build icon + wordmark with `accent`
    # icon.save(f"{OUT}/icon-{key}.png")
```

---

## Template 4: Gradient Cursor / Letterform

```python
def lerp(c1, c2, t):
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))

# Draw cursor as thin vertical strips with gradient
for i in range(cursor_w):
    t = i / cursor_w
    color = lerp(VIOLET, CORAL, t)
    d.rectangle([cx + i, cy, cx + i + 1, cy + cursor_h], fill=color)
```

---

## Template 5: Color Extraction from Reference Image

```python
from PIL import Image
from collections import Counter

def extract_palette(path, buckets=12):
    img = Image.open(path).convert("RGBA")
    small = img.resize((120, 120))
    
    def bucket(c):
        return (c[0]//16*16, c[1]//16*16, c[2]//16*16)
    
    cnt = Counter(bucket(c) for c in small.getdata())
    return cnt.most_common(buckets)

# Usage
for color, count in extract_palette("reference.png"):
    hex_color = f"#{color[0]:02x}{color[1]:02x}{color[2]:02x}"
    print(f"{hex_color}: {count} pixels")
```

---

## Key Techniques Summary

| Effect | Technique |
|--------|-----------|
| Glow | Alpha blur + compositing |
| Scanlines | Horizontal lines at low alpha |
| Gradient | Vertical strips with lerp |
| Notches | Draw abyss-colored rectangles |
| Multi-variant | Loop over palette dict |
| Color extraction | Bucketed Counter on downsampled image |
