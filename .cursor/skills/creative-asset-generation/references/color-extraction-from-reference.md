# Color Extraction from User Reference Images

When the user provides an image (logo, moodboard, screenshot) and says "use these colors" or "I like this color palette":

## Exact Extraction Workflow

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

def sample_grid(path):
    img = Image.open(path).convert("RGBA")
    w, h = img.size
    samples = []
    for fy in [0.2, 0.4, 0.5, 0.6, 0.8]:
        for fx in [0.2, 0.4, 0.5, 0.6, 0.8]:
            c = img.getpixel((int(w*fx), int(h*fy)))
            samples.append(f"#{c[0]:02x}{c[1]:02x}{c[2]:02x}")
    return samples

# Usage: extract_palette("user-reference.png") → [(r,g,b), count], ...
```

## Mapping Extracted Colors to Semantic Tokens

| Bucketed Color (freq) | Likely Role | Action |
|-----------------------|-------------|--------|
| Most frequent (~30%) | Background | `bg` |
| Second (~8-10%) | Primary mark | `primary` |
| Light accent (~3%) | Light accent | `accent-light` |
| Warm accent (~1%) | Warm accent | `accent-warm` |

## Full Workflow

1. User shares image → save to working dir (e.g., `.hermes/images/`)
2. Run `extract_palette()` + `sample_grid()` → get exact colors
3. Map to semantic names (bg, primary, accent-light, accent-warm)
4. Rebuild geometric mark using exact extracted values
5. Generate: icon + wordmark + monogram + preview
6. Show preview on cream bg (if light) or abyss bg (if dark)
7. **Never commit before user picks.** Keep all variants in working dir.

## Real Example: Gemini Logo Palette

Extracted from `dashboard_20260824_140229_7626a509_Gemini_Generated_Image_lk7vp8lk7vp8lk7v.jpg`:

| Role | Hex | RGB |
|------|-----|-----|
| `bg` (cream) | `#f5f2ec` | (245, 242, 236) |
| `primary` (deep violet) | `#452a84` | (69, 42, 132) |
| `accent-light` (lavender) | `#a9b1f0` | (169, 177, 240) |
| `accent-warm` (coral) | `#fe6f69` | (254, 111, 105) |

This became the final NIL brand palette.

## Multi-Variant Generation (Before User Locks)

When user hasn't picked a color yet, generate 4-5 options:

```python
PALETTES = {
    "violet":   {"accent": (160, 130, 245), "name": "Violet"},
    "coral":    {"accent": (235, 128, 108), "name": "Coral"},
    "amber":    {"accent": (245, 166, 35),  "name": "Amber"},
    "phosphor": {"accent": (220, 235, 245), "name": "Phosphor"},
}
```

Generate `icon-{key}.png`, `wordmark-{key}.png`, `wordmark-preview-{key}.png` for each.
