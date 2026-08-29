# macOS / SwiftUI Motion + Dithering Research Reference

> Session: Aug 13, 2026 — User wants portfolio v5 + pentest harness UI to feel like native macOS (Xcode, Swift) with dithering effects.

---

## Apple HIG Motion Principles (Source of Truth)

From https://developer.apple.com/design/human-interface-guidelines/motion:

1. **Add motion purposefully** — supporting the experience without overshadowing it. Gratuitous or excessive animation can distract and may make people feel disconnected or physically uncomfortable.
2. **Make motion optional** — Not everyone can or wants to experience motion. Supplement visual feedback with haptics and audio alternatives.
3. **Strive for realistic feedback motion** — motion that follows people's gestures and expectations. If someone reveals a view by sliding it down from the top, they don't expect to dismiss it by sliding it to the side.
4. **Aim for brevity and precision in feedback animations.**

### SwiftUI Spring Parameters
SwiftUI uses `response` (time to reach ~63% of target) + `dampingRatio` (oscillation control):
- `response: 0.3, dampingRatio: 0.6` = snappy UI feel
- `response: 0.5, dampingRatio: 0.8` = heavier, more deliberate
- `response: 0.15, dampingRatio: 0.4` = bouncy, playful

### Liquid Glass (iOS 26+)
Responds to direct touch with emphasis, trackpad = subdued. The user's site should follow this pattern: stronger motion on touch, subtler on desktop.

---

## Kinetics Library — 144 Spring Interactions

Source: https://github.com/ckissi/kinetics (446 stars)
Each effect ships with stiffness/damping readout + copy-paste CSS/React.

| Effect | Spring / Params | Use Case |
|--------|----------------|----------|
| Card Resize | `spring(320, 24)` | critically damped height |
| Magnetic Button | `magnet(0.35)` | cursor pull toward target |
| Number Counter | `spring(280, 18)` | digit bump/overshoot |
| Toast Overshoot | `overshoot(1.08)` | slides past rest |
| Tab Pill Glide | `glide(0.4s, custom)` | indicator measures width |
| Accordion | `spring(260, 28)` | max-height + chevron |
| Drag to Dismiss | `friction(0.92)` | pointer-tracked, threshold |
| Ripple | `decay(600ms)` | radial fade from click |
| Hold to Confirm | `hold(800ms)` | ring fills, early cancel |
| Rubber-band Slider | `rubber(0.32)` | stretches past ends |
| Push Button | `press(60ms)` | tactile depress, pure CSS |
| Like Burst | `burst(heart)` | toggle, pop, particle ring |
| Cursor Trail | `trail(0.35)` | chain of dots chasing pointer |
| PIN Input | `spring(360, 22)` | digit pop + auto-advance |
| Password Meter | `tween(score)` | segments fill + shift color |
| Pointer Tooltip | `lerp(0.18)` | eased cursor follow |
| Swipe to Reveal | `swipe(-96px)` | drag to expose actions |
| Rotary Knob | `rotate(0..270)` | drag circle, snap detents |
| Reorder List | `reorder(y-axis)` | spring reorder |

---

## Web Dithering Techniques

### Algorithm Comparison
| Algorithm | Style | Best For |
|-----------|-------|----------|
| **Ordered (Bayer)** | clean grid, predictable | hero overlays, subtle texture |
| **Floyd-Steinberg** | organic error diffusion | full image dithering |
| **Atkinson** | Apple Lisa/Mac classic | retro feel, less artifacts |
| **Blue Noise** | organic, no visible patterns | animated threshold shifts |
| **1-bit palettes** | C64, Game Boy, PICO-8, NES | decorative elements |

### Implementation Snippets

**CSS noise overlay (static, 3% opacity):**
```css
body::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: 50;
  pointer-events: none;
  opacity: 0.03;
  background-image: url("data:image/svg+xml,...feTurbulence...");
}
```

**8x8 Bayer threshold matrix:**
```typescript
const bayer8x8 = [
  [0,32,8,40,2,34,10,42],
  [48,16,56,24,50,18,58,26],
  [12,44,4,36,14,46,6,38],
  [60,28,52,20,62,30,54,22],
  [3,35,11,43,1,33,9,41],
  [51,19,59,27,49,17,57,25],
  [15,47,7,39,13,45,5,37],
  [63,31,55,23,61,29,53,21]
];
```

### Tools
- `ditherit-v3` (alexharris/ditherit-v3 on GitHub) — 11 algorithms, client-side
- `ascii-magic.com/styles/dither` — online tool with palettes
- `studio-ity.com/dither` — free online dithering with color control

---

## pro.beui.dev Patterns

From https://pro.beui.dev/ — premium React motion components:
- Block categories: Hero, Feature, Pricing, Testimonial, Stats, CTA, Footer, Step Form, Empty State, Agent Chat Input, Trust & Security, Announcement, Use Cases, How It Works, Image Gallery, Navbar, Newsletter, Contact, Integrations, Comparison, Team, FAQ
- Templates: Personal Website ($39), AI Workspace ($69), Analytics Landing
- All blocks live-rendered with motion

---

## Design Tokens for User's Projects

### Portfolio v5 (Arriq)
- Background: `#0a0a0a`
- Text: `#ffffff`
- Muted: `#a3a3a3` (neutral-400)
- Borders: `#262626` (neutral-900)
- Accent: white or subtle warm tone
- Fonts: Inter + JetBrains Mono (code/terminal vibe)
- Key elements: dot matrix text, numbered sections (01-04), cross/plus accents, project cards with stats

### Finn Pentest Harness
- Background: `#050507` (abyss)
- Accent: `#00d992` (neon green)
- Secondary: `#1a1a2e` (deep navy)
- Text: `#e0e0e0`
- Muted: `#666666`
- Fonts: JetBrains Mono + Inter
- Optional: CRT scanlines (toggleable), dithered noise overlays
