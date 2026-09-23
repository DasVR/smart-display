---
version: alpha
name: Smart Display
description: A dark, glassy kiosk read from across the room. A liquid-metal field moves behind it, and a single Dynamic Island carries anything that needs attention.
colors:
  abyss: "#07070b"
  abyss-1: "#0c0c12"
  abyss-2: "#12121a"
  abyss-3: "#181822"
  gray-05: "#1c1c24"
  gray-10: "#2a2a34"
  gray-40: "#8a8a96"
  gray-70: "#c6c6d0"
  gray-95: "#f2f2f6"
  brand: "#a9b1f0"
  brand-deep: "#6e76b8"
  ok: "#5d9d7e"
  warn: "#c9847a"
  scan: "#6ec8c4"
  solve: "#c9a36a"
  background: "{colors.abyss}"
  foreground: "{colors.gray-95}"
  text-secondary: "{colors.gray-70}"
  text-tertiary: "{colors.gray-40}"
typography:
  display-clock:
    fontFamily: Plus Jakarta Sans Variable
    fontSize: 12.75rem
    fontWeight: 500
    lineHeight: 1
  view-title:
    fontFamily: Plus Jakarta Sans Variable
    fontSize: 3.75rem
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.04em"
  dateline:
    fontFamily: Plus Jakarta Sans Variable
    fontSize: 1.5rem
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  body:
    fontFamily: Plus Jakarta Sans Variable
    fontSize: 1.125rem
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: Plus Jakarta Sans Variable
    fontSize: 0.875rem
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.04em"
  numeric:
    fontFamily: Fira Code Variable
    fontSize: 1rem
    fontWeight: 500
    lineHeight: 1.2
    fontFeature: "tnum"
rounded:
  sm: 0.375rem
  md: 0.75rem
  lg: 1.25rem
  bezel: 2.25rem
  pill: 999px
spacing:
  "1": 0.25rem
  "2": 0.5rem
  "3": 0.75rem
  "4": 1rem
  "5": 1.25rem
  "6": 1.5rem
  "8": 2rem
  floor-clearance: 4.5rem
components:
  view-tab:
    textColor: "{colors.text-tertiary}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    height: 2.75rem
  view-tab-active:
    textColor: "{colors.foreground}"
    rounded: "{rounded.pill}"
  sheet:
    backgroundColor: "{colors.abyss}"
    rounded: "{rounded.lg}"
  trough:
    backgroundColor: "{colors.abyss-1}"
    rounded: "{rounded.md}"
    height: 6rem
  island-pill:
    backgroundColor: "{colors.abyss}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.pill}"
  chip:
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: 0.5rem 0.75rem
---

# Smart Display design system

The source of truth is the `:root` block in `src/app.css`. This file explains
why those values are what they are. If the two disagree, the CSS wins and
this file needs updating.

**Units.** The kiosk sets `html { font-size: 22px }`, so `1rem` is 22px on
the panel. Below 768px wide (the phone remote) it drops to 16px. Every size
here is in rem so both targets scale from that one root value.

## Overview

The screen is a 1920×1080 panel people read from across the room, often
with a record player sitting in front of its lower edge. Three layers:

1. **Field.** A single WebGL liquid-metal shader
   (`src/lib/shaders/LiquidMetalCanvas.svelte`). It reacts to weather
   (sun, rain, wind, cloud) and holds the dithered, molten look. It is
   atmosphere, never content.
2. **Content.** Five views (Clock, School, Agents, Music, Weather) inside
   a fixed shell: a top mast, the main stage, and a bottom trough.
3. **Attention.** One Dynamic Island, top-center, owns every transient
   event: notifications, now playing, installs, severe weather. Nothing
   else on screen pulses for attention.

## Colors

- **Abyss (`#07070b` → `#181822`).** Four near-black steps, slightly blue.
  Surfaces go up one step for each level of nesting.
- **Gray ramp.** `gray-95` for primary text, `gray-70` for secondary,
  `gray-40` for tertiary and labels. Borders are `foreground` mixed at
  9–10% (`--hairline`, `--border`), never a solid gray.
- **Brand lavender (`#a9b1f0`).** The one accent: the active tab indicator,
  the clock colon, focus rings, and the night-phase kicker.
- **Status hues.** Each is muted to sit on the dark field without glowing:
  `ok` sage (connected, done), `warn` clay (offline, failed), `scan` teal
  (rain, live radar), `solve` amber (dusk, in progress). Only one per element.
- **Glows** (`--glow-*`) are the same hues at 55%, used only as the
  soft radial wash behind a sheet (`--sheet-glow`).

## Typography

- **Plus Jakarta Sans Variable** for everything a person reads.
  **Fira Code Variable** for machine values: times, percentages, SHAs,
  branch names. Use it through the `.num` class, which also turns on
  tabular numerals so digits don't jitter as they tick.
- Both fonts are self-hosted through `@fontsource-variable` and imported
  in `src/routes/+layout.svelte`. The kiosk runs Chromium with its disk
  cache off, so a CDN font would be downloaded again on every boot, and the
  screen would fall back to system fonts whenever the network was down.
- Large display sizes use negative tracking (−0.025em to −0.04em).
  Uppercase labels get +0.04em.
- Headings use `text-wrap: balance`.

## Layout

- **Shell.** A three-row grid: `auto / minmax(0, 1fr) / auto`, with
  `2rem` side gutters.
- **Top mast.** Also a three-column grid: `nav | island slot (25rem) |
  status`. The island is `position: fixed`, so it takes no layout space.
  The middle column reserves room for it, which keeps the tabs and date
  from sliding underneath it. Below 1600px wide the island gets its own
  band and the nav and status share the row beneath it.
- **Status cluster.** Right-aligned, two lines: time and date on top,
  temperature and conditions underneath. It dims to 32% while the island
  is showing something.
- **Bottom trough.** A 6rem glass strip with the audio waveform, the
  connection state, and (on every view except Clock) the Sun, Wind and
  Radar chips. The Clock view already shows those chips at full size
  under the clock, so the trough drops them there rather than repeat them.
- **Floor clearance.** `--floor-clearance: 4.5rem` lifts the trough clear
  of anything standing in front of the panel's lower edge.
- **Spacing** is a 4px-based scale (`--space-1` … `--space-8`).

## Elevation & Depth

Depth comes from translucency and light, not drop shadows:

- **Glass field** (`.glass-field`): 46% abyss fill, a 32px backdrop blur,
  a specular top edge, and an inset lower shade. Only the trough uses it.
  The governor removes the blur in `eco`, `frozen` and `sleep` modes.
- **Sheet** (`.sheet`): a hairline border, a faint radial glow in the
  view's hue, and one slow specular band sweeping across it. The sweep
  animates `transform` only, so the compositor can move it without
  repainting.
- **Island**: pure abyss with a deep, soft shadow. It is the only element
  that floats above everything.

## Shapes

- Radii step up with size: `sm` (8px on the panel) for tags, `md` (16.5px)
  for chips and the trough, `lg` (27.5px) for sheets, and pills (999px) for
  tabs and the island.
- Nested radii are concentric: inner radius = outer radius − inset.
  `.glass-field::before` computes `calc(var(--radius-md) - var(--space-2))`.

## Components

- **View tabs.** Text-only pills. A single sliding indicator moves between
  them on a bouncy spring, with a brief SVG goo filter only while it
  moves. Pressing scales the tab to `0.96`.
- **Dynamic Island.** It sizes itself from a hidden copy of its own
  content (the "ghost") and rounds that measurement up, so a title never
  gets an ellipsis from a sub-pixel shortfall. Titles are capped at 17ch.
- **Chips** (`BoardWidgets`). An uppercase label over a semibold value.
  The compact variant puts both on one line for the trough.
- **Week timetable.** Seven columns, with today's column wider and
  tinted. When the week is empty, the header says "Clear this week" and
  today's column says "Nothing due".

## Motion

| Token | Value | Use |
| --- | --- | --- |
| `--dur-fast` | 150ms | color and opacity on high-frequency states |
| `--dur-base` | 220ms | small state changes |
| `--dur-pane` | 680ms | view pane enter |
| `--spring-smooth` | `cubic-bezier(0.22, 1, 0.36, 1)` | default ease-out |
| `--spring-bouncy` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | the tab indicator and island size |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | ambient loops |

Rules:

- For anything that loops forever, animate only `transform` or `opacity`.
  A looping `box-shadow`, `background-position` or SVG filter repaints the
  full 1080p frame on every tick, which is too much for the kiosk's iGPU.
- Name the exact properties in `transition-property`, never `all`.
- Everything respects `prefers-reduced-motion` (a global rule in
  `app.css` shortens durations) and `prefers-reduced-transparency`.
- The load governor (`src/lib/displayLoad.js`) moves the display through
  `full → eco → frozen`. In eco and frozen, the backdrop blur and the sheet
  sweep stop.

## Do's and Don'ts

- **Do** put new transient information in the island, not in a new
  pulsing element.
- **Do** show only real data. When there is none, say so plainly ("Nothing
  due", "Nothing playing") instead of inventing a placeholder.
- **Do** check the top mast at 1920×1080 with the island expanded before
  shipping a change to the header.
- **Don't** add another glass surface. The trough is the only one;
  sheets are tinted, not blurred.
- **Don't** put `filter: blur()` on large elements to soften something.
  Use a radial gradient that already fades to transparent.
- **Don't** load fonts or scripts from a CDN. The kiosk has to boot
  offline.
