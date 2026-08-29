# Explee-Style Zinc/Carbon Design System

Captured from user-provided spec for LeadVine v2 rebuild. This is an alternative dark-native UI flavor distinct from the abyss/#00d992 pentest harness aesthetic.

## Color Tokens

| Token | Hex | Usage |
|-------|-----|-------|
| bg-canvas | `#121316` / `#16171a` | Page background |
| bg-card | `#1d1e22` / `#222429` | Cards, panels |
| border | `#2d3036` | 1px dividers |
| text-primary | `#f3f4f6` | Headings, main text |
| text-muted | `#9ca3af` | Secondary labels |
| text-dim | `#6b7280` | Metadata |
| accent-mint | `#10b981` / `#00f59b` | Active status, primary buttons, success metrics |
| accent-gold | `#eab308` / `#f59e0b` | Hot badges, calendar alerts |
| accent-purple | `#8b5cf6` | RAG highlights, AI autopilot banners |

## Typography
- Font: Inter, Plus Jakarta Sans, Geist
- Size: 12px labels, 14px body, 16px headings, 24-32px hero stats
- Line-height: Compact (1.2-1.4)

## Geometry
- Radius: 8px (rounded-lg) to 12px (rounded-xl)
- Density: High — minimal padding, tight rows
- Hover: `hover:bg-zinc-800/60`, subtle transitions

## Key Component Patterns

### Notice Banners
- Gold calendar CTA banner with icon
- Budget slider card ($15 default)
- Status card with real-time counters + quick actions

### Campaigns Table
- Active campaign counter pill
- "Autopilot is running" toggle switch
- Columns: CAMPAIGN, STATUS (dot + daily rate), SENT, REPLY RATE, INTERESTED, STAGE, COST/LEAD, SPENT, DAILY CAP
- Hot badges (`Hot · 1`)
- Total summary row

### Performance Metrics Grid
- 4-column grid: SENT, REPLY RATE, INTERESTED LEADS, SPENT
- Big stat + percentage sub-label + mini turquoise sparkline/area chart
- Day ticks: Sat, Mon, Wed, Fri

### Split-Pane Inbox
- Sub-tabs: Needs reply, Got reply (N), Sent (N) + filter dropdowns
- Master-detail layout
- Thread cards: avatar initials, name, domain, timestamp, campaign pill, urgency badges (Hot, Out of Office)
- Reply composer: rich textarea, variable tags, Cmd+Enter send
- Slide-over lead data sidebar: company profile, "Why this lead fits" AI card (purple), team notes

### Email Template Builder
- Flow breadcrumb: First email → Follow-ups → Replies
- Two-column: Instructions (textarea + prompt tags) | Live Preview (recipient simulation pills + stacked card preview)
- Interactive RAG tooltips: dashed green/purple underlines → hover reveals AI justification + source

## CSS Implementation

```css
@theme {
  --color-bg-canvas: #121316;
  --color-bg-canvas-alt: #16171a;
  --color-bg-card: #1d1e22;
  --color-bg-card-hover: #222429;
  --color-border-default: #2d3036;
  --color-text-primary: #f3f4f6;
  --color-text-muted: #9ca3af;
  --color-text-dim: #6b7280;
  --color-accent-mint: #10b981;
  --color-accent-mint-bright: #00f59b;
  --color-accent-gold: #eab308;
  --color-accent-gold-bright: #f59e0b;
  --color-accent-purple: #8b5cf6;
  --color-accent-purple-soft: rgba(139, 92, 246, 0.15);
}
```

## When to Use This vs Abyss/Green

| Use Explee Zinc/Carbon | Use Abyss/#00d992 |
|------------------------|-------------------|
| CRM, dashboard, data-heavy apps | Terminal-first, security tools, pentest harness |
| B2B SaaS, sales tools, outreach | Hacking, coding, CLI-focused workspaces |
| Need gold/warning accents alongside success | Single accent (#00d992) is the brand |
| High-density tables and metrics | Spatial layouts, 3D, immersive experiences |

## Workflow for Building From User Design Specs

When user provides a detailed external design spec (like the Explee message.txt):

1. **Parse immediately** — extract colors, typography, layout structure, components
2. **Write DESIGN.md** in the project repo with the full extracted spec
3. **Build CSS tokens first** — get the theme system working before any components
4. **Scaffold shell components** — sidebar, layout, page shells with nav routing
5. **Build one view end-to-end** — dashboard with real data shapes, not placeholders
6. **Add remaining views** — inbox, templates, project docs
7. **Verify build passes** before pushing

## Pitfall: Don't Wait for Screenshots

The user said they'd send screenshots but didn't — yet the text spec was detailed enough to build from. When a user provides a comprehensive text design spec, start building immediately rather than blocking on screenshots. The spec already contains all tokens, layout descriptions, and component shapes needed to scaffold.
