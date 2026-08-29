# Zinc / Carbon Dark Design System (Explee-Style)

A dark-mode, high-density CRM dashboard design system used by https://explee.com (AutoGTM). Different from the abyss/green terminal aesthetic — this is zinc/carbon with neon mint accents.

## Tokens

| Token | Hex | Usage |
|-------|-----|-------|
| bg-canvas | `#121316` / `#16171a` | Page background |
| bg-card | `#1d1e22` / `#222429` | Cards, panels |
| border | `#2d3036` | 1px solid dividers |
| text-primary | `#f3f4f6` | Headings, main text |
| text-muted | `#9ca3af` | Secondary labels |
| text-dim | `#6b7280` | Metadata, timestamps |
| accent-mint | `#10b981` / `#00f59b` | Primary buttons, active status, success metrics, pills |
| accent-gold | `#eab308` / `#f59e0b` | Hot badges, calendar alerts, warnings |
| accent-purple | `#8b5cf6` | RAG source highlighting, AI autopilot banners, "Why this lead fits" cards |

## Typography
- Font: Inter, Plus Jakarta Sans, Geist
- Scale: 11–12px labels, 13–14px body, 16px headings, 24–32px hero stats
- Line-height: Compact (1.2–1.4)

## Geometry
- Radius: 8px (rounded-lg) to 12px (rounded-xl)
- Density: High — minimal padding, tight rows (6–8px)
- Hover: `hover:bg-zinc-800/60`, subtle 150ms transitions

## Component Patterns

### Cards
```css
.card {
  background-color: #1d1e22;
  border: 1px solid #2d3036;
  border-radius: 10px;
}
```

### Pills
```css
.pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 500;
}
.pill-mint { background: rgba(16,185,129,0.12); color: #00f59b; }
.pill-gold { background: rgba(234,179,8,0.12); color: #f59e0b; }
.pill-purple { background: rgba(139,92,246,0.15); color: #8b5cf6; }
```

### Buttons
```css
.btn-primary {
  background: #10b981;
  color: #000;
  font-weight: 600;
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 13px;
}
.btn-ghost {
  background: transparent;
  color: #9ca3af;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 13px;
}
.btn-ghost:hover {
  background: rgba(255,255,255,0.05);
  color: #f3f4f6;
}
```

### Tables
High-density grid tables with sortable columns, status dots, and action menus:
```css
.table-row {
  display: grid;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid #2d3036;
  font-size: 13px;
}
.table-row:hover {
  background: rgba(34,36,41,0.5);
}
```

## Scrollbars
```css
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: #121316; }
::-webkit-scrollbar-thumb { background: #2d3036; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #3d4149; }
```

## When to Use This System
- Building CRM, sales intelligence, or GTM dashboards
- Replicating or exceeding https://explee.com
- High-information-density admin panels where every pixel counts
- AI-assisted workflows where the AI is a copilot, not the product

## When NOT to Use
- Consumer/marketing landing pages (use abyss/green terminal aesthetic instead)
- Mobile-first apps (this system is desktop-optimized)
- Apps needing playful/bouncy branding (this is corporate/tooling)
