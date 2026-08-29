# NIL Design System Tokens & Reference-First Workflow

> Captured from session where user provided screenshots of @pengsonal's reference-first method and @nurijanian's skills.sh tier list.

## Canonical NIL Colors (LOCKED — user explicitly rejected green)

| Token | Hex | Usage |
|-------|-----|-------|
| `--abyss` | `#050507` | Background |
| `--abyss-1` | `#0a0a0c` | Surface |
| `--abyss-2` | `#0a0a0e` | Elevated surface |
| `--abyss-3` | `#101016` | Card background |
| `--abyss-4` | `#16161d` | Panel / sidebar |
| `--violet` | `#452a84` | Primary accent (monogram, active states) |
| `--violet-light` | `#a9b1f0` | Secondary accent (glow, highlights) |
| `--coral` | `#fe6f69` | Tertiary accent (thinking orbs, warnings) |
| `--cream` | `#f5f2ec` | Done state, high-contrast text |
| `--text` | `#e8e8e6` | Primary text |
| `--text-dim` | `#9a9a94` | Secondary text |
| `--text-faint` | `#55554f` | Tertiary / disabled text |
| `--danger` | `#ff5c5c` | Errors, YOLO indicator |
| `--warning` | `#ffb454` | Warnings |
| `--info` | `#5cb8ff` | Info / links |

**Note:** Legacy `--green #00d992` is NOT part of the NIL brand. User explicitly rejected green for this product. Use violet/coral/cream instead.

## Glass Tiers

| Class | Blur | Opacity | Usage |
|-------|------|---------|-------|
| `.glass-1` | 32-40px | 0.45 | Modals, large surfaces |
| `.glass-2` | 24-28px | 0.55 | Cards, panels |
| `.glass-3` | 16-20px | 0.65 | Inputs, buttons |
| `.glass-4` | 12px | 0.72 | Small controls, badges |

Edge refraction highlight via `::before` gradient + `mask-composite`.

## Spring Curves

| Name | CSS | Usage |
|------|-----|-------|
| `--spring-bouncy` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Playful: hover, badges, toasts |
| `--spring-smooth` | `cubic-bezier(0.22, 1, 0.36, 1)` | UI: panels, layout shifts |
| `--spring-window` | `cubic-bezier(0.32, 0.72, 0, 1)` | Windows, sheets, modals |
| `--spring-snappy` | `cubic-bezier(0.25, 0.9, 0.25, 1)` | Quick: buttons, toggles |

## Typography

| Role | Font | Usage |
|------|------|-------|
| Machine / data | JetBrains Mono | Code, terminal, status bar, structured blocks |
| Human / prose | Inter | UI labels, descriptions, chat |

## Reference-First Workflow (Pengsonal Method)

> "I'm not a designer, so instead of asking AI to invent the whole UI, I give it good references and let it build with them like Lego."

**Core principle:** Never ask agents to invent UI from scratch.

1. **Give the agent reference resources** (see list below)
2. **Let it inspect the components**
3. **Pick what fits the project**

### Reference Resources
- `beautifului.dev` — curated beautiful UI
- `beui.dev` — component patterns
- `rareui.com` — rare/unique UI patterns
- `transitions.dev` — motion/transition references
- `ui.shadcn.com` — shadcn/ui official
- `ui-skills.com` — skill-based UI components
- `coss.com/ui` — component gallery
- `designsystemchecklist.com` — design system audit
- `reui.io/components` — React UI components
- `emilkowal.ski/ui/you-dont-need-javascript` — CSS-only patterns

### MCP-Enabled Reference Servers
- `mobbin.com/mcp` — mobile design patterns
- `canvasui.dev` — design canvas
- `60fps.design/mcp` — 60fps motion patterns
- `recent.design` — latest designs
- `collectui.com` — curated UI

## Anti-Slop Skills (skills.sh)

Install as MCP skill packs so agents get guardrails automatically:

| Skill | Stars | Purpose |
|-------|-------|---------|
| ui-ux-pro-max | 120,460 | Design tokens, palettes, fonts, UX guidelines |
| taste-skill | 79,935 | Anti-slop frontend framework (13 skills) |
| impeccable | 62,115 | Design skills for AI agents |
| humanizer | 37,537 | Strip AI-isms |
| hallmark | 26,835 | Avoid AI slop UI patterns |
| stop-slop | 16,300 | Explicit anti-slop enforcement |

## Thinking Logo System

The NIL blocky N monogram = agent state indicator (4 states):

| State | Visual |
|-------|--------|
| **Idle** | Static N, violet on abyss |
| **Thinking** | N notches breathe + 2-3 ThinkingOrbs orbit (coral + lavender) |
| **Streaming** | Orbs converge into N, glow + BorderBeam sweeps edge |
| **Done** | N snaps to cream, soft pulse |

Component: `ThinkingLogo.svelte` — wraps `ThinkingOrbs.svelte` + N monogram SVG.
`prefers-reduced-motion` = static N only.

## Liquid/Gooey Effects

```bash
npm i liquid-gooey
```

For liquid glass / gooey morphing effects. Used sparingly — titlebar or thinking indicator only.

## Dither / Noise

- `dither-kit` (tripwire.sh) — zero-dep canvas dithering for charts
- CSS `feTurbulence` noise overlay at 3% opacity for abyss backgrounds
- Optional animated "living dither" on images

## Related
- `references/anti-slop-rules.md` — Full anti-slop rule set
- `references/bookmark-grounded-redesign.md` — Bookmark-first redesign methodology
- `references/liquid-glass-css.md` — CSS liquid glass implementation
