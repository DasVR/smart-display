# Raster-to-Pixel-Art SVG Conversion

Convert a raster image (especially pixel art logos, icons, or game sprites) into a clean, transparent-background SVG composed of perfectly even grid-aligned rects.

## Workflow

1. **Load image**, convert to RGB, detect foreground vs background
2. **Find content bounds** — crop to the actual art, removing excess canvas
3. **Pick grid size** that matches the underlying pixel art resolution
   - Too fine (e.g. 128×128 on a 64×64 sprite) → every anti-aliased edge becomes a partial cell → noisy specks
   - Too coarse (e.g. 20×20) → loses all detail, becomes a blob
   - **Rule of thumb:** cell size should be roughly equal to the visible "pixel" size in the original
4. **Majority-vote downsample** each grid cell: `cell_mean > threshold`
5. **Threshold selection**:
   - `0.7` for strong, clean cells (best for removing anti-aliasing noise)
   - `0.5` if thin ring/line details are being lost
   - **Never go below 0.45** — brings back too much JPEG/anti-alias noise
6. **Cleanup** — remove ONLY:
   - Cells with **0 neighbors** (true orphans)
   - Connected components **smaller than 4 cells**
   - **Do NOT use morphological closing/opening** — binary_closing fills gaps between distinct pixel-art lines (e.g. concentric rings become solid blobs)
7. **Export SVG** with `<rect>` elements merged horizontally per row for compactness
8. **Add `shape-rendering="crispEdges"`** to every rect — prevents browser anti-aliasing from blurring pixel edges

## Pitfalls

| Pitfall | Why It Happens | Fix |
|---------|---------------|-----|
| Outer rings disappear | Threshold too strict (0.6+) on thin arcs | Drop to 0.5, then cleanup specks manually |
| Blobby solid shape | Used `binary_closing` or `binary_fill_holes` | Never use morphological ops on pixel art. Remove ops entirely. |
| Stray single pixels everywhere | Threshold too loose (0.45) or grid too fine | Raise threshold to 0.7; increase component-minimum to 4 cells |
| N shape destroyed | Grid too coarse (e.g. 40×31) | Match grid to actual art resolution (test 48×37, 56×43, 64×49) |
| Filesize 10MB+ | One `<rect>` per pixel with no merging | Merge horizontal runs per row before SVG write |
| Rings look jagged/staircase | Original anti-aliased edges misaligned to grid | Blur source slightly (`GaussianBlur(radius=1.5)`) before thresholding to round edges into cleaner arcs |

## Reference Script Pattern

```python
from PIL import Image, ImageDraw
import numpy as np
from scipy.ndimage import label

img = Image.open(path).convert("RGB")
arr = np.array(img, dtype=np.float32)
bg = arr[0, 0]

# Foreground mask: dark and distinct from background
fg_mask = ((arr[:,:,0] < 140) & (arr[:,:,1] < 140) & (arr[:,:,2] < 140) &
           (np.linalg.norm(arr - bg, axis=2) > 25))

# Content bounds
ys, xs = np.where(fg_mask)
min_x, max_x = xs.min(), xs.max()
min_y, max_y = ys.min(), ys.max()
content_w = max_x - min_x + 1
content_h = max_y - min_y + 1

# Grid — adjust to match original pixel art resolution
grid_w, grid_h = 64, 49
cell_w = content_w / grid_w
cell_h = content_h / grid_h

small = np.zeros((grid_h, grid_w), dtype=float)
for gy in range(grid_h):
    y0 = min_y + int(round(gy * cell_h))
    y1 = min_y + int(round((gy+1) * cell_h))
    for gx in range(grid_w):
        x0 = min_x + int(round(gx * cell_w))
        x1 = min_x + int(round((gx+1) * cell_w))
        patch = fg_mask[y0:y1, x0:x1]
        if patch.size > 0:
            small[gy, gx] = patch.mean()

# Threshold and cleanup
clean = small >= 0.7

# Remove orphan cells (0 neighbors)
for gy in range(grid_h):
    for gx in range(grid_w):
        if not clean[gy, gx]: continue
        neighbors = sum(1 for dy in [-1,0,1] for dx in [-1,0,1]
                       if not(dy==0 and dx==0) and 0<=gy+dy<grid_h and 0<=gx+dx<grid_w and clean[gy+dy,gx+dx])
        if neighbors == 0:
            clean[gy, gx] = False

# Remove tiny components (<4 cells)
labeled, num = label(clean)
for i in range(1, num+1):
    if (labeled == i).sum() < 4:
        clean[labeled == i] = False

# Build SVG with horizontal rect merging
fg_hex = "#494840"
cell_size = 16
svg_w = grid_w * cell_size
svg_h = grid_h * cell_size

rects = []
for gy in range(grid_h):
    gx = 0
    while gx < grid_w:
        if clean[gy, gx]:
            start = gx
            while gx < grid_w and clean[gy, gx]:
                gx += 1
            rects.append((start * cell_size, gy * cell_size, (gx - start) * cell_size, cell_size))
        else:
            gx += 1

svg_lines = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {svg_w} {svg_h}" width="{svg_w}" height="{svg_h}">']
svg_lines.append('<rect width="100%" height="100%" fill="none"/>')
for x, y, rw, rh in rects:
    svg_lines.append(f'<rect x="{x}" y="{y}" width="{rw}" height="{rh}" fill="{fg_hex}" shape-rendering="crispEdges"/>')
svg_lines.append('</svg>')
```

## Verification

After generating SVG, rasterize back to PNG (PIL `ImageDraw`) and visually inspect:
- Rings intact?
- No orphan pixels in white space?
- N/letterform shape preserved?
- Edges are crisp (not anti-aliased)?

If rings are lost → lower threshold by 0.05, retry.
If specks remain → raise threshold by 0.05 or increase component-minimum.
