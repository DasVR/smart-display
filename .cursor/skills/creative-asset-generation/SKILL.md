---
name: creative-asset-generation
description: Generate logos, brand assets, and design systems from code.
version: 1.0.0
---

# Creative Asset Generation

Generate logos, icons, wordmarks, and color palettes from code instead of relying on external design tools. Also covers extracting exact colors from user-provided reference images, open-source design handoff, and **Penpot MCP remote design** (self-hosted Penpot driven via Model Context Protocol).

**Related skills:** See `penpot-design-mcp` for full API reference when designing directly in Penpot via MCP.

## When to Use

- User wants a logo, icon, or wordmark without opening Figma/Illustrator
- User shares an image and says "use these colors" — need exact extraction
- Building brand identity for an app/project where design assets must be version-controlled
- Need multiple color variants of the same mark quickly
- Working with **Penpot MCP** to build design systems remotely (no browser drag-and-drop)
- Need to move between programmatic asset generation and Penpot design system handoff

---

## 1. Programmatic Logo Generation (PIL)

### Core Technique: Alpha-Channel Glow

```python
from PIL import Image, ImageDraw, ImageFont, ImageFilter

def add_glow(img, color, radius=30, strength=0.45):
    """Soft glow behind opaque pixels — THE key effect."""
    alpha = img.split()[3]  # Extract alpha channel
    blurred = alpha.filter(ImageFilter.GaussianBlur(radius))
    glow_layer = Image.new("RGBA", img.size, color + (0,))
    glow_layer.putalpha(blurred.point(lambda p: int(p * strength)))
    return Image.alpha_composite(glow_layer, img)
```

### Geometric Monogram Workflow

1. **Define palette** from exact hex values (never eyeball)
2. **Build base tile** — rounded rectangle on transparent canvas
3. **Draw letterform** via polygon or text with a geometric font (DejaVu Sans Mono Bold is reliable)
4. **Add notches/cuts** — draw abyss-colored rectangles over the letterform
5. **Add scanlines** — horizontal lines at very low alpha
6. **Add glow** — `add_glow()` compositing
7. **Export variants:** icon (1024×1024), wordmark (1600×500), favicon (512×512)

### Common Primitives

**Rounded tile (app icon base):**
```python
def rounded_tile(size, radius, bg):
    img = Image.new("RGBA", (size, size), (0,0,0,0))
    ImageDraw.Draw(img).rounded_rectangle([0,0,size-1,size-1], radius=radius, fill=bg)
    return img
```

**Scanlines:**
```python
for y in range(0, height, step):
    draw.line([(0,y),(width,y)], fill=(255,255,255,alpha))
```

**Gradient fill via vertical strips (for multi-color effects):**
```python
for px in range(x1, x4):
    t = (px - x1) / (x4 - x1)
    color = lerp(color_a, color_b, t)
    draw.line([(px, y_top), (px, y_bottom)], fill=color)
```

### Raster-to-Pixel-Art SVG Conversion

When user wants a pixel-art raster image (logo, sprite, icon) converted to a clean SVG with transparent background:

See `references/raster-to-pixel-art-svg.md` for the full workflow.

Key takeaways:
- Match grid to the original art's visible pixel size (test 48×37, 56×43, 64×49)
- Threshold at 0.7 for clean cells; drop to 0.5 only if ring/line details are being lost
- Never use morphological closing/opening — it fills gaps between distinct pixel-art lines (e.g. concentric rings become blobs)
- Remove only 0-neighbor orphans and components < 4 cells
- Always add `shape-rendering="crispEdges"` to rects
- Merge horizontal runs per row to keep filesize small

### Font Selection

| Use | Font | Why |
|-----|------|-----|
| Monogram / wordmark | DejaVu Sans Mono Bold | Geometric, consistent, available on Linux |
| Terminal/code | JetBrains Mono | Already in user's design system |
| Fallback | Inter | Human-readable sans |

---

## 2. Color Palette Extraction from Reference Images

When user shares an image (logo, moodboard, screenshot):

```python
from PIL import Image
from collections import Counter

img = Image.open(path).convert("RGBA")
small = img.resize((120, 120))  # Downsample for speed

def bucket(c):
    return (c[0]//16*16, c[1]//16*16, c[2]//16*16)

counts = Counter(bucket(px) for px in small.getdata())
# counts.most_common(12) → dominant colors
```

### Sampling Strategy

- **Dominant bucketed colors** — top 12 by frequency (shows bg + primary + accents)
- **Grid sampling** — read pixels at 20%/40%/50%/60%/80% across height/width (catches edge/center variations)
- **Named mapping** — map extracted RGBs to semantic names: bg, primary, accent, secondary

### Pitfalls

- **JPEG compression** — sampled pixels may not match perceived color (use bucketed mode)
- **Screenshots with UI** — may include Discord chrome, window borders; ask user for a clean crop if needed
- **Gradients** — bucket sampling finds the midpoint; user may want start/end colors instead

---

## 3. Iterative Brand Identity Workflow

When user is iterating on logo/name:

1. **Propose 5+ names** — short, memorable, domain-available check optional
2. **Generate first logo set** — one name, one color direction
3. **User feedback** — collect specific feedback ("hate the green", "like the bottom left mark")
4. **Iterate variants** — new color palette, new geometric approach, multi-variant (amber/phosphor/coral/violet)
5. **User picks** — or provides reference image
6. **Extract exact palette** from reference, rebuild mark in that palette
7. **Finalize** — commit chosen assets, document palette in design tokens

**Never commit before user approves.** Keep all variants in a working directory until decision is locked.

---

## 4. Penpot MCP Remote Design (Self-Hosted)

When the user wants designs built directly in their self-hosted Penpot instance via MCP:

### Prerequisites
- Penpot MCP server must be running (e.g. `docker compose up` in `/opt/stacks/penpot`)
- User must open a Penpot file in browser and connect the MCP plugin (copies userToken)
- Store token in `/home/das/.penpot_mcp_token` (chmod 600) — do NOT store in memory
- Use helper: `/home/das/projects/finn-pentest-harness/cursor-research/penpot_mcp.py`

### CRITICAL Pitfall: Plugin appends to CURRENT ACTIVE PAGE
> **Everything created via `execute_code` lands on whatever page is currently active in the user's browser**, not the page you name in your code.

**Fix:** After building, move boards to correct pages using `targetPage.root.appendChild(board)`.

**Prevention:** Ask user to switch to the target page before executing, OR always move boards after creation.

### Workflow
1. Initialize session: `python3 penpot_mcp.py initialize`
2. Run `execute_code` with JS that creates shapes via `penpot.createBoard()`, `penpot.createRectangle()`, `penpot.createText()`
3. Move boards to correct pages
4. Build components: `penpot.library.local.createComponent([shapes])`
5. Build design tokens: `penpot.library.local.tokens.addSet({name:'NIL'})` then `.addToken({type:'color', name:'...', value:'#RRGGBB'})`

### Shape Creation API (quick ref)
- `board = penpot.createBoard(); board.name = '...'; board.resize(w,h); board.x = x; board.y = y`
- `rect = penpot.createRectangle(); rect.fills = [{fillColor:'#RRGGBB', fillOpacity:1}]`
- `text = penpot.createText('hello'); text.growType = 'auto-width'; text.fontFamily = 'Inter'; text.fontSize = 14`
- `parent.appendChild(child)` — adds to page tree
- `board.addFlexLayout()` then `board.flex` props for layout
- `shape.resize(width, height)` — width/height are READ-ONLY otherwise
- Colors must be uppercase hex: `#RRGGBB` (not `#rrggbb`)

**Full API:** See `penpot-design-mcp` skill for complete Penpot API reference.

---

## 5. File Organization

```
cursor-research/logo/
├── make_logo.py              # Generation script
├── nil-icon-gemini.png       # Chosen variant
├── nil-wordmark-gemini.png
└── ...
cursor-research/
├── LIBRARY-SPEC.md           # Linked libraries
├── PENPOT-SETUP.md           # Design workflow doc
└── penpot_mcp.py             # MCP client helper
```

### Page Structure (6 pages)

| Page | Content | Handoff Format |
|------|---------|---------------|
| `00 Tokens` | Color Styles, Text Styles, spacing, curves | CSS custom properties JSON |
| `01 Components` | Main Components with variants | Component code |
| `02 Layouts` | Key screens using instances | Page markup |
| `03 Flows` | Interaction flows with arrows | Sequence diagrams / state machines |
| `04 States` | Component state matrix | CSS classes / props table |
| `05 Specs` | Props, keyboard, ARIA, responsive | Documentation |

### Component Variants

Use Penpot Component Properties:
- **State**: default, hover, active, disabled, loading, error, success
- **Size**: sm, md, lg
- **Naming**: `btn/primary/default`

### Inspect Handoff

Penpot's Inspect panel shows: CSS, dimensions, colors, fonts. Use this to translate directly to code tokens.

---

## 5. File Organization

```
cursor-research/logo/
├── make_logo.py              # Generation script
├── nil-icon-gemini.png       # Chosen variant
├── nil-wordmark-gemini.png
├── nil-wordmark-gemini-preview.png
└── nil-monogram-gemini.png
cursor-research/
├── LIBRARY-SPEC.md           # Linked libraries
└── PENPOT-SETUP.md           # Design workflow doc
```

---

## References

- `references/programmatic-logo-generation.md` — Full PIL script templates (geometric monogram, wordmark, multi-variant, gradient cursor, color extraction)
- `references/penpot-workflow.md` — Step-by-step Penpot design system setup (6-page structure, component variants, inspect handoff)
