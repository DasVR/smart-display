# Anti-Slop Rules

> Source: github.com/Rosmarinusofficinalispoloneck995/anti-slop
> Fetched: 2026-08-17

## Core Principle

Every visual decision must have a clear reason, improve the user experience, and build a unique product identity.

## Craftsmanship Standard

1. **Intentionality** — every decision has a reason you can articulate
2. **Functional Completeness** — every interactive element works or it does not exist
3. **Content-Driven Composition** — sections exist because content needs them, not because templates have them
4. **Resilience** — UI holds up in empty, loading, error, every breakpoint, and keyboard-only use
5. **Evidence Over Claims** — anything presented as fact is real and verifiable

## Key Forbidden Patterns

| Pattern | Fix |
|---------|-----|
| Blue-purple gradients as primary | Use brand palette (#050507 + #00d992) |
| Glassmorphism on everything | Max 1-2 glass elements |
| Glow on cards+buttons+badges+icons+bg+borders | Glow on 1-2 focus elements max |
| Pill-shaped everything (radius 999px) | Radius hierarchy: 6px badges, 8px controls, 12px panels, 10px windows |
| Generic AI icons (sparkle, star, magic, lightning, diamond, orb, robot) | Use relevant SVGs or none |
| "Get Started", "Learn More", "Try Now" | Specific CTAs: "Open Workstation", "Run Scan", "Read the Docs" |
| Em dash (—) in copy | Use comma, period, colon, or parentheses |
| Background grids/blueprints as default | Use texture only if it supports brand identity |
| Uppercase labels with extreme letter-spacing | Use sentence case with deliberate spacing |
| How It Works always 3 steps with round icons | Build around actual content needs |
| Trusted By logo bar below hero | Only if real logos and relevant |
| 4-column template footer | Build around actual navigation needs |
| Fake statistics without source | Display no numbers if no real data |
| Fake testimonials with AI avatars | Use no testimonials if none are real |

## Animation Rules

- Every animation must have a clear UX purpose
- FORBIDDEN: fade up + floating + scale + bounce on every element simultaneously
- Use animation to guide attention, not fill the page
- Respect prefers-reduced-motion

## Color Contrast

- Normal text: minimum 4.5:1
- Large text (18px+): minimum 3:1

## Dark Mode

- Developer tools have legitimate reason for dark default
- If no strong reason, build a working light/dark toggle that works in BOTH modes
- A theme toggle that breaks one mode is a defect

## Workstation Layout Patterns (Terminal-First)

When building pentest/security/developer workstations (not marketing sites):

**Density Rules (Cursor + Linear)**
| Surface | Padding | Line-height | Notes |
|---------|---------|-------------|-------|
| Sidebar rows | 6–8px vertical, 8–10px horizontal | 1.3 | Never exceed 10px vertical. Density beats breathing room. |
| Sidebar section header | 28px row height | 1 | All-caps micro-label. No extra margin below. |
| Finding / target card | 8px 10px | 1.35 | Compact but not crushed. |
| Terminal line | 6px vertical | 1.45 | Sacred. Do not increase. |
| Status bar | 0 12px horizontal, 26px height | 1 | Single-line, mono-heavy. |
| AI strip message | 6px 10px | 1.5 | More air than sidebar because prose is read linearly. |

**Typography rule for workstations:**
- **Sans (Inter)** = labels, headings, button text, human prose.
- **Mono (JetBrains Mono)** = hostnames, IPs, ports, timestamps, tool output, severity badges, file paths, status bar values, any number inside prose.
- When in doubt on a sidebar/status row, use mono.

**Spacing rule:**
- Use `gap` inside flex/grid, never margin stacks.
- 1px borders + 4–8px gaps create hierarchy better than 16px margins.
- Only modals, empty-state cards, and terminal host exceed 12px padding.

**Pitfall — Traffic lights on web:**
Traffic lights (red/yellow/green close-minimize-maximize dots) are native macOS window chrome. On web apps and cross-platform Tauri apps they feel fake and clutter the titlebar. **Only use traffic lights when building a true macOS-native app with `titleBarStyle: overlay` in Tauri.** Otherwise, keep the titlebar clean: engagement name centered/left, target + safety indicators right.

### Layout: Terminal is the Hero

Kill the "giant chat area as default view" anti-pattern. The canonical workstation layout:

```
┌─ Titlebar (engagement · target · YOLO/Safe) ───────────────────────────┐
├────────────┬──────────────────────────────────────────────┬────────────┤
│  Targets   │           Main Workspace                     │  Findings  │
│  + Scope   │  (Terminal default / Editor / Map / Report)  │  + Notes   │
│  + Creds   │                                              │  + Timeline│
│            ├──────────────────────────────────────────────┤            │
│            │  AI Strip (hidden/thin/expanded/pinned)        │            │
└────────────┴──────────────────────────────────────────────┴────────────┘
│ Status / Safety bar (mode · sandbox · last run · YOLO · version)    │
```

- Left sidebar = target tree, mini findings, severity counts, creds
- Center = terminal is default. Editor/Map/Report as alternate views.
- Right sidebar = findings cards with severity bars, scope, timeline
- Bottom = AI strip with 4 exact states (see below)
- Bottom-most = status/safety bar (always visible, pure Burp/Cursor energy)

### AI Strip — 4 Exact States

1. **Hidden** — height 0. Default when no recent Finn activity and not pinned.
2. **Thin collapsed bar** — height 26px. Shows last Finn status or thinking indicator. Auto-collapses after 8s inactivity.
3. **Expanded** — height 280px. Structured cards / terminal blocks. No chat bubbles. Cmd+J toggles.
4. **Pinned** — expanded stays open across routes. Cmd+Shift+J toggles pin. Survives session (localStorage).

State transitions: Hidden→Expanded (Cmd+J / high-signal update), Expanded→Hidden (Esc if not pinned), Expanded→Thin (auto 8s), Thin→Expanded (click / Cmd+J).

### Status / Safety Bar Spec

Always-visible bottom strip. Height 26px, font 11px mono for values + 10px sans labels, background `--glass-3`, border-top 1px.

Left cluster: connection dot+label, mode pill (`HUNT`/`CHAT`/`CODE`/`REPORT`), active target/scope.
Center cluster: last tool run status (`nmap ...` + exit code), sandbox status (`ready`/`running`/`dirty`).
Right cluster: YOLO toggle button with exact state, version/build info, quick settings gear.

### Empty / First-Run State

Not "Ask Finn anything". Show last engagement summary, scope, or clean "New Engagement" flow with target input + templates. Feels like opening Cursor or Linear on a new project.