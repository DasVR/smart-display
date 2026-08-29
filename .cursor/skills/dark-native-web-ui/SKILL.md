---
name: dark-native-web-ui
title: Dark Native Web UI Polish
description: Polish dark web apps to feel like native macOS apps.
version: 1.0.0
category: software-development
---

# Dark Native Web UI Polish

Trigger: `polish UI`, `make it feel native`, `macOS app feel`, `redesign frontend`, `anti-slop`, `spring physics`, `AAA quality`, `smooth animations`, `liquid glass`

## Why This Exists

Generic AI-generated UI looks like "slop" — same gradients, same pill-shaped everything, same glassmorphism on every element. This skill encodes the rules that separate premium dark terminal/cyberpunk UIs from generic AI output.

## Anti-Slop Rules (Mandatory)

Read the full ruleset from `references/anti-slop-rules.md`. Key constraints:

- **Glass is an accent, not the character.** Max 1-2 glass elements. Never blur navbar + cards + modals + sidebar simultaneously.
- **No excessive glow.** Glow on 1-2 focus elements max.
- **Border radius is hierarchy.** Don't pill everything. Mix sharp and rounded deliberately.
- **No generic AI icons.** Sparkle, star, magic, lightning, diamond, orb, robot are forbidden.
- **Purposeful animation.** Every animation guides attention or confirms interaction.
- **Mobile is not an afterthought.** No horizontal overflow, tap targets >= 44px.
- **WCAG AA contrast** for all text.
- **CTAs must be specific.** "Open Workstation" not "Get Started".

## Bookmark-Grounded Redesign (New)

When the user says "redesign based on my bookmarks, ignore all other design info," follow this pattern instead of generic inspo sites.

### The "AI Web App" Tells vs Native Mac Tool

These are specific patterns that read as "generic AI web app" rather than "native macOS tool":

| AI-Web-App Tell | Why It Reads Generic | Native Mac Fix |
|-----------------|---------------------|----------------|
| Chat-first home / "Ask anything" hero | Claude/HackerAI default posture | Terminal IS the product, AI is a pane you summon (Cursor + Linear) |
| Fake terminal chrome ($ prompts, green blocks) | Costume, not real PTY | Blocks wrap real output (Warp), never bash-session aesthetics |
| Rounded user pills + avatar columns | Consumer chatbot chips | Quiet dark UI, structured cards (Claude app) |
| Box shadows / generic gradients | AI-slop default design | 0 box shadows (chiefkeef.md rule), no generic gradients |
| 44px iPhone hit targets | iOS HIG leaking into desktop | 28px sidebar rows, density with calm (Linear) |
| Emoji empty states (⚡🔧) | Illustration-first mindset | Action-oriented empty states — "Add first target" (Folk) |
| Linear easing on all transitions | web default | Spring physics only — bouncy/smooth/window curves |
| Chat bubbles as AI strip | Claude transcript | Structured cards with meta headers, not user/assistant pills |
| Liquid metal / glass on everything | effects-as-wallpaper | ONE shared WebGL context, titlebar only |
| Generic "stats" and "metrics" | fake social proof | Only real data, never fabricated numbers |

### The Core Principle: Lock IA First, Then Spend Effects

**Top-tier Mac apps do the reverse of themed web apps:**
1. Lock the information architecture (Spaces, block terminal, palette, sidebars)
2. Then spend the motion/material budget on exactly THREE moments:
   - **One metal surface** — 40px titlebar, one shared WebGL context, NOT wallpaper
   - **One spring** — Space switch or palette animation
   - **One attention object** — pending approval block, live scan, or critical finding (pick ONE, not two pulsing greens)

### The 4-File System for Cursor

When building a bookmark-grounded redesign, write these 4 files as a system:

| File | Purpose | Key Sections |
|------|---------|-------------|
| `MASTER-REDESIGN.md` | Full IA source of truth | Verdict, bookmark design language, IA diagram, block terminal spec, liquid metal rules, code-gap table, phase order |
| `CURSOR-REDESIGN-PROMPT.md` | Drop-in build brief | Self-contained prompt with anti-slop rules, exact file-by-file fixes, verify commands |
| `DESIGN-TOKENS.md` | Locked token reference | Colors, glass tiers, spring curves, type, density, keyboard map, one-attention-object rule |
| `BOOKMARK-SPEC.md` | Sourcing ledger | Every decision traced to a specific bookmark URL + verified packages |

### Package Verification Before Recommending

Always verify bookmark-derived packages exist before suggesting:
```bash
npm view cuelume        # returns metadata if real, error if not
npm view liquid-glass-svelte
```
If they don't exist, drop them or find the real name. Never recommend phantom packages.

### The North Star Posture

**Terminal is the soul.** Every other surface is a lens onto hosts, commands, and evidence.
**Spaces, not pages.** The user moves between objects in one window.
**Keyboard is the GUI.** If a mouse is required for a primary task, the IA is wrong.
**AI is contextual.** Hidden → thin → expanded → pinned. Never a destination.
**Density with calm.** Linear numbers. Inter for humans, JetBrains Mono for machines.
**Materials are honest.** Glass refracts content. Metal is the titlebar. Abyss is the work surface.
**One attention object.** Pending approval, live scan, or critical finding — pick ONE to pulse.

## Design Tokens (Established)

| Token | Value | Usage |
|-------|-------|-------|
| `--abyss` | `#050507` | Background |
| `--abyss-1` | `#0a0a0c` | Surface |
| `--abyss-2` | `#101014` | Elevated surface |
| `--accent` | `#00d992` | Primary accent |
| `--glass` | `rgba(255,255,255,0.03)` | Glass background |
| `--glass-border` | `rgba(255,255,255,0.06)` | Glass border |
| `--font-sans` | `Inter, -apple-system...` | UI text |
| `--font-mono` | `JetBrains Mono, SF Mono` | Code / mono |

## Workflow

### 1. Research Phase
- Pull reference apps: Cursor IDE, Linear, Raycast, Arc browser, Claude desktop, Perplexity
- Skim Apple's HIG for windows, sheets, sidebars
- Check Mobbin or Dribbble for real screenshots
- **Check 21st.dev** (`https://21st.dev`) for component inspo — 12,000+ hand-crafted React/Tailwind components, shaders, backgrounds, chat UIs. Translate React → Svelte 5, keep Tailwind, map to our tokens. See `references/21st-dev-catalog.md`.
- Read `references/anti-slop-rules.md`

#### Presenting Inspo for Review (User Preference)
When the user says "find inspo sites for me to review," present a **scored shortlist** (7–12 items), not a dump. For each:
- **URL** (live link)
- **Score** (1–10) with brief rationale
- **What to steal** (2–3 specific patterns)
- **Why it might not fit** (honest caveats: mobile issues, performance concerns, generic feel)
- **Effort to translate** to our stack

Keep entries concise. Let the user react with "nah" / "bet" / "that one's fire" before building.

### 2. Token Audit Phase
- Verify `app.css` has elevation tokens (`--elevation-1/2/3`)
- Verify spring easing curves (`--spring-bouncy`, `--spring-smooth`, `--spring-snappy`)
- Add `--radius-window` for window chrome (10px)
- Verify `prefers-reduced-motion` and `forced-colors` support

### 3. Component Polish Phase
For each component being redesigned, apply:

**Settings / Sheets**
- macOS sheet presentation (not centered modal)
- Traffic-light titlebar
- Left sidebar with pill selection
- Global search across all categories
- Grouped sections with rounded headers
- iOS-style switches + styled sliders
- kbd chips for shortcuts

**Sidebar / Navigation**
- SVG icons (not emoji)
- Pill active state with inner shadow
- Hover lift (`translateY(-1px)`)
- Raycast-style ⌘K trigger
- Spring collapse/expand

**Command Palette**
- Raycast layout: search icon, command icons, shortcut hints
- accent-12 pill selection
- Footer hint bar

**Chat / Composer**
- Centered glass composer (Claude-style)
- Mode pills + YOLO chip inside composer
- Quick-action chips when empty
- Compact user pills, full-width assistant rows
- Thread line / accent connector
- Streaming shimmer → text crossfade
- **Code blocks as artifact cards with language badge + copy**
- **Inline tool-call cards with approve/run/reject states**
- **Follow-up suggestion chips after replies**

**Anti-pattern (user-corrected):** "Terminal-style blocks" in a design doc means structured cards with subtle meta headers (name + model tag), rounded corners, and clean typography — NOT literal terminal chrome ($ prompts, bordered code panes, green-tinted blocks). The user explicitly rejected fake terminal aesthetics. Assistant output should feel like Cursor/Linear structured cards, not a bash session.

**Window Chrome**
- Traffic-light close/minimize/maximize
- Draggable region (`-webkit-app-region: drag`)
- Page name + context in titlebar
- Glass accent, not full blur

**Dock (desktop-wide nav)**
- macOS-style bottom bar
- 28px SVG icons with hover labels
- Active dot indicator
- Spring scale on hover (1.1x)
- Hidden below 1024px viewport

### 4. Animation Phase

**Use svelte-motion** (Framer Motion for Svelte 5):
- Install: `npm install svelte-motion`
- Spring layout animations for panels/sidebars
- AnimatePresence for enter/exit of modals/sheets
- Gestures: hover, tap for buttons

**CSS Spring Easings** (native, no library):
```css
--spring-bouncy: cubic-bezier(0.34, 1.56, 0.64, 1);
--spring-smooth: cubic-bezier(0.22, 1.0, 0.36, 1.0);
--spring-snappy: cubic-bezier(0.25, 0.8, 0.25, 1.0);
```

**Liquid Glass Accent** (CSS-Tricks pattern):
- SVG `feTurbulence` + `feDisplacementMap` filter
- Applied to 1 hero element max
- See `references/liquid-glass-css.md`

### 5. Verification Phase
- `npm run check` — must pass for touched files
- `npm run build` — must produce clean output
- Check mobile: 320px–768px viewport, no overflow
- Check reduced-motion: all animations fall back to `ease` or instant
- Check focus rings: visible on every interactive element

## Pitfalls

| Pitfall | Why It Happens | Fix |
|---------|---------------|-----|
| Concurrent subagent corruption | Multiple AI agents (Cursor + Finn + others) touching the same repo simultaneously | Before any write, `git status` to detect unexpected modifications from sibling agents. If another agent left broken syntax (e.g. mangled braces, duplicate function stubs), read the file, diagnose, and repair before your own build. Verify with `node --check` or syntax linter. |
| Glass on everything | AI defaults to backdrop-filter everywhere | Pick 1-2 glass elements max |
| Pill-shaped everything | Border radius defaults to `999px` | Use radius hierarchy: 6px badges, 8px controls, 12px panels, 10px windows |
| Glow overdose | Accent glow on all interactive elements | Glow on primary CTA + one focus element only |
| Generic CTAs | "Get Started", "Learn More" | Make specific: "Open Workstation", "Run Scan" |
| Mobile as afterthought | Desktop-first without breakpoint testing | Test 320px before declaring done |
| Animation without purpose | Fade-up on every element | Animate to guide attention |
| svelte-motion bloat | Importing full library for one animation | Use scoped imports |
| Liquid glass everywhere | AI applies it globally | Hero-only accent |

## Tools

- **Anti-slop rules**: `references/anti-slop-rules.md` — 36 enforceable design rules
- **Animation library**: `svelte-motion` (Framer Motion for Svelte 5)
- **Liquid glass CSS**: `references/liquid-glass-css.md`
- **Design reference apps**: Cursor IDE, Linear, Raycast, Arc browser, Claude desktop, Perplexity
- **Screenshot research**: Mobbin, Dribbble
- **Source of truth**: Apple HIG (macOS windows, sheets, sidebars)

## References

- `references/anti-slop-rules.md` — Full 36-rule anti-slop design filter
- `references/liquid-glass-css.md` — CSS/SVG liquid glass technique
- `references/svelte-motion-patterns.md` — Common svelte-motion patterns for Svelte 5
- `references/21st-dev-catalog.md` — Curated 21st.dev component marketplace with React→SvelteKit translation notes
- `references/bookmark-grounded-redesign.md` — Full bookmark-grounded redesign system
- `references/nil-design-system-tokens.md` — NIL-specific tokens, glass tiers, thinking logo system, anti-slop skills (captured from user session)
- `references/sdf-liquid-glass-shader.md` — SDF-driven single-pass liquid metal + true iOS liquid glass (refraction + edge chromatic aberration, no framebuffer capture, iGPU-safe)
