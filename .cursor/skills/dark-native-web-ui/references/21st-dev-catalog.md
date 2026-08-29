# 21st.dev — Component Catalog for Bookmark-Grounded Design

**URL:** `https://21st.dev`

## What It Is
A community marketplace of **12,000+ hand-crafted React + Tailwind CSS components**, templates, shadcn themes, icons, shaders, gradients, and animated backgrounds. Built by real design engineers. Published in a copy-paste format that slots into Cursor / Claude Code / v0 / Lovable workflows.

## Why Use It Instead of Generic AI Inspo
- **Proven patterns** from actual design engineers, not generated guesses
- **Copy-prompt workflow** — grab a component, paste the prompt into your AI agent, agent rebuilds it in YOUR stack
- **Own the code** — components are copied into your repo, not imported as a dependency
- **Mix-and-match** — pick the best shell from one author, best shader from another, best chat UI from a third

## Top Categories for Our Stack (Dark Terminal / macOS Native)

| Category | Count | Best For |
|----------|-------|----------|
| **Shader** | 267+ | Fluid gradients, warping meshes, animated noise, dithered color fields |
| **Background** | 365+ | Aurora, mesh gradients, particles, grid/dot patterns, noise textures |
| **Mesh Gradient** | 66+ | Stripe-style gradient-shaders, dreamy washes |
| **Fluid** | 77+ | Flowing ribbons, liquid motion, warp effects |
| **AI Chat** | 248+ | Chat UI patterns, message cards, streaming indicators |
| **Scroll Animation** | 205+ | Scroll reveals, parallax, expansion effects |
| **Animated** | 16+ | Hero sections, text effects, buttons, cards |
| **SVG Filter** | 34+ | Animated glow cards, gooey blobs, glass buttons, noise patterns |
| **WebGL** | 397+ | GPU effects, Stripe-style shaders, neural noise |
| **Cursor** | 152+ | Custom cursors, fluid magnetic cursors, pixel trails |

## Notable Components Found (Curated)

### Liquid Metal / Shaders
| Component | Author | URL | Use |
|-----------|--------|-----|-----|
| `metal-fx` | @Jakubantalik | 21st.dev/@Jakubantalik/components/metal-fx | Titlebar liquid metal |
| `metal-fx/silver` | @Jakubantalik | 21st.dev/@Jakubantalik/components/metal-fx/silver | Silver variant |
| `grain-gradient-hero-section` | @chowlol202 | 21st.dev/@chowlol202/components/grain-gradient-hero-section | Grain + gradient hero |
| `silk-shader` | @fafaieefafaiee | 21st.dev/@fafaieefafaiee/components/silk-shader | Smooth silk flow |
| `blue-noise` | @kingleonardjr19 | 21st.dev/@kingleonardjr19/components/blue-noise | Dark noise texture |

### Dithering / Noise
| Component | Author | URL | Use |
|-----------|--------|-----|-----|
| `dithering` | @paper-design | 21st.dev/@paper-design/components/dithering | Exact dithering effect |
| `neuro-noise` | @paper-design | 21st.dev/@paper-design/components/neuro-noise | Dark neural noise |
| `halftone-dots` | @paper-design | 21st.dev/@paper-design/components/halftone-dots-round-and-square | Retro halftone |
| `neon-dither` | @moazamtrade | 21st.dev/@moazamtrade/components/neon-dither | Neon + dither combo |
| `hero-dithering-card` | @moazamtrade | 21st.dev/@moazamtrade/components/hero-dithering-card | Card with dither |

### Backgrounds / Atmosphere
| Component | Author | URL | Use |
|-----------|--------|-----|-----|
| `stripe-like-gradient-shader` | @meerbahadin10 | 21st.dev/@meerbahadin10/components/stripe-like-gradient-shader | Stripe-style mesh |
| `aurora-flow` | @ruixen.ui | 21st.dev/@ruixen.ui/components/aurora-flow | Aurora background |
| `abstract-plasma` | @serafimcloud | 21st.dev/@serafimcloud/components/abstract-plasma | Moody plasma |
| `electric-aura` | @serafimcloud | 21st.dev/@serafimcloud/components/electric-aura | Electric glow |
| `molten-pillars` | @serafimcloud | 21st.dev/@serafimcloud/components/molten-pillars | Pillar effect |
| `neural-noise` | @designali-in | 21st.dev/@designali-in/components/neural-noise | Subtle neural pattern |
| `warp` | @designali-in | 21st.dev/@designali-in/components/warp | Warp distortion |
| `simplex` | @designali-in | 21st.dev/@designali-in/components/simplex | Simplex noise |

### Chat / AI Interfaces
| Component | Author | URL | Use |
|-----------|--------|-----|-----|
| `ai-chat` | @beratberkayg | 21st.dev/@beratberkayg/components/ai-chat | Chat interface |
| `ia-siri-chat` | @botsnew354 | 21st.dev/@botsnew354/components/ia-siri-chat | Siri-style bubbles |
| `siri-wave` | @40973894 | 21st.dev/@40973894/components/siri-wave | Voice activity wave |
| `voice-powered-orb` | @isaiahbjork | 21st.dev/@isaiahbjork/components/voice-powered-orb | Voice orb indicator |
| `gradient-orb` | @uicapsule | 21st.dev/@uicapsule/components/gradient-orb | Status orb |

### Shell / Layout
| Component | Author | URL | Use |
|-----------|--------|-----|-----|
| `velaris` | @amanshakya307 | 21st.dev/@amanshakya307/components/velaris | Dashboard shell |
| `auralis` | @amanshakya307 | 21st.dev/@amanshakya307/components/auralis | Shell variant |
| `animated-drawer` | @arihantcodes | 21st.dev/@arihantcodes/components/animated-drawer | Spring drawer |
| `display-cards` | @Codehagen | 21st.dev/@Codehagen/components/display-cards | Feature cards |

## Translation Strategy: React → SvelteKit

21st components are React + Tailwind. For our SvelteKit stack:

1. **Copy the component prompt/source** from 21st.dev
2. **Translate React hooks → Svelte 5 runes**:
   - `useState` → `$state`
   - `useEffect` → `$effect`
   - `useRef` → `$state` or action binding
   - Props → `$props()`
3. **Keep Tailwind classes** but map to our design tokens:
   - Replace arbitrary colors with `--abyss`, `--green`, `--glass-*`
   - Replace generic shadows/borders with glass system
4. **Replace React-only primitives**:
   - `useMotionValue` / Framer Motion → `svelte-motion` or CSS spring curves
   - `radix-ui` → `bits-ui` (headless primitives)
   - `shadcn/ui` → `shadcn-svelte`
5. **WebGL/Three.js shaders** need minimal change — just mount point (`<canvas bind:this={canvas}>` in Svelte)

## Verification

Always verify packages exist before recommending:
```bash
npm view cuelume          # 2KB UI sounds
npm view liquid-glass-svelte   # SVG displacement glass
npm view morphicons        # Icon morphing
npm view svelte-motion     # Framer Motion for Svelte 5
```

If phantom, drop it or find the real name.

## Research Workflow

When the user says "research UI inspo":
1. Check 21st.dev first (largest curated catalog)
2. Cross-reference with user's Twitter bookmarks
3. Score each candidate 1–10
4. Present scored shortlist with URLs
5. Let user react before building
