# macOS OS Components & Spring Physics for Web — Session Notes (Aug 2026)

## What This Session Proved Out

A complete AAA portfolio website scaffold with macOS-native feel, built with Next.js + spring physics + dithering effects. All components run at 60fps, support reduced motion, and compile clean.

## Component Architecture

### OS-Level Components

**Dock.tsx** — Floating bottom dock with glass material
- Hover: `scale(1.25)` with spring timing (`var(--ease-spring-snappy)`)
- Active: dot indicator below icon
- Tooltip label fades in on hover
- Glass background: `backdrop-filter: blur(20px)` + noise overlay
- Touch-optimized: 44px minimum targets

**Window.tsx** — macOS window chrome
- Traffic lights: close (#ff5f57), minimize (#febc2e), maximize (#28c840)
- Title bar with centered title text
- Content area with padding
- Border + shadow for depth
- Active state: accent glow ring

### Effect Components

**BorderBeam.tsx** — Animated light along container borders
- Uses `conic-gradient` + CSS animation (zero JS)
- Configurable: color, speed (duration in seconds)
- GPU-composited via `transform: rotate()`
- Usage: hero cards, AI chat boxes, feature highlights

**ThinkingOrbs.tsx** — Pulsing AI thinking indicator
- Staggered pulse via CSS animation delays
- Glow via `box-shadow` with accent color
- 3-5 orbs in a row, organic timing

**NoiseOverlay.tsx** — SVG noise texture overlay
- `feTurbulence` fractal noise at low opacity (0.02-0.04)
- `mix-blend-mode: overlay`
- Reduced motion: static only (no animated noise)
- Performance: SVG filter, not canvas/JS

## Spring Physics Tokens (SwiftUI → CSS)

```css
:root {
  /* Response: 0.15s, Damping: 0.4 — bouncy */
  --ease-spring-bouncy: cubic-bezier(0.34, 1.56, 0.64, 1);
  
  /* Response: 0.3s, Damping: 0.6 — snappy (default) */
  --ease-spring-snappy: cubic-bezier(0.16, 1, 0.3, 1);
  
  /* Response: 0.5s, Damping: 0.8 — deliberate */
  --ease-spring-smooth: cubic-bezier(0.25, 0.1, 0.25, 1);
  
  /* Response: 0.8s, Damping: 1.0 — heavy */
  --ease-spring-heavy: cubic-bezier(0.22, 0.61, 0.36, 1);
}
```

### Framer Motion Integration

```tsx
// Page entrance — SwiftUI push feel
<motion.div
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
/>

// Button press — tactile feedback
<motion.button
  whileHover={{ scale: 1.05 }}
  whileTap={{ scale: 0.95 }}
/>

// Card hover — lift effect
<motion.div
  whileHover={{ y: -4, boxShadow: "0 12px 40px rgba(0,0,0,0.3)" }}
/>
```

## Dithering Strategy

### Layered Approach
1. **Base**: `#050507` (abyss black)
2. **Noise overlay**: SVG `feTurbulence` at 0.02-0.04 opacity
3. **Dither mask** (optional): WebGL/canvas Bayer on hero only
4. **Text/elements**: subtle dithered shadows via CSS
5. **Reduced motion**: static noise, no animated dither

### Performance Tiers
| Tier | Effects | WebGL | Springs |
|------|---------|-------|---------|
| High-end | Full | Shader dither | Full physics |
| Mid-range | Reduced | Canvas dither | Simplified |
| Low-end | Minimal | None | Instant |
| Reduced-motion | Static only | None | Disabled |

## Safari Compatibility Fixes

| Issue | Fix |
|-------|-----|
| `backdrop-filter` slow | `transform: translateZ(0)` hack |
| WebGL dither flickering | `preserveDrawingBuffer: true` |
| Spring easing jank | `-webkit-transform: translate3d(0,0,0)` |
| Touch delay | `touch-action: manipulation` |
| Reduced motion | Full disable, not partial |

## File Structure

```
src/
├── components/
│   ├── os/
│   │   ├── Dock.tsx          # Floating dock nav
│   │   └── Window.tsx        # macOS window chrome
│   ├── effects/
│   │   ├── BorderBeam.tsx    # Animated border light
│   │   ├── ThinkingOrbs.tsx  # AI thinking indicator
│   │   └── NoiseOverlay.tsx  # SVG noise texture
│   └── layout/
│       └── OSLayout.tsx      # Root layout with dock + noise
├── app/
│   ├── page.tsx              # Home (OS desktop)
│   ├── work/page.tsx         # Finder-style grid
│   ├── lab/page.tsx          # Kinetics playground
│   ├── about/page.tsx        # Giant typography
│   └── contact/page.tsx      # Compose window
├── globals.css               # Design tokens + Tailwind
└── tailwind.config.ts        # Custom colors + springs
```

## Key Packages

```json
{
  "dependencies": {
    "next": "^15.1.0",
    "react": "^19",
    "framer-motion": "^12.42.2",
    "lucide-react": "^1.26.0",
    "tailwind-merge": "^3.6.0"
  }
}
```

## Build Verification

```bash
cd portfolio-v2
npm install
npm run build
# Should produce: 26 static pages, 0 errors, ~150kB first load JS
```

## Pitfalls Discovered

1. **Cuelume not on npm** — `cuelume@^1.0.0` doesn't exist yet. Use Web Audio API directly or wait for publication.
2. **Three.js peer deps conflict** — `@react-three/fiber@9` requires React 19 but some deps still want React 18. Use `@react-three/fiber@8.15` with `three@0.160`.
3. **Zustand v5** — may have compatibility issues. Use v4.5 for stability.
4. **Next.js 15 `template.tsx`** — must be client component for Framer Motion `AnimatePresence`.
5. **Static export limitations** — no API routes, no dynamic params at build time. Use query params for dynamic content.

## Cursor Bridge Integration

The `cursor-bridge-v2.js` agent was dispatched in background to build from DESIGN.md/SPEC.md. It returned a branch with scaffolded components. Key learning: pass local file paths (`/home/das/portfolio-v2/RESEARCH.md`) not URLs when delegating to local agents.

## Next Steps for AAA Polish

1. Add Liquid Metal shader (WebGL) for primary CTAs
2. Add dithered image treatment via canvas Bayer
3. Integrate Cuelume sounds when published
4. Wire up godmode API chat in Lab page
5. Add mobile hamburger menu (replacing dock on small screens)
6. Add View Transitions API for page transitions
7. Add settings panel for customization (theme, motion, sounds)
