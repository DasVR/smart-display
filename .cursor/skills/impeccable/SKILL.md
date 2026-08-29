---
name: impeccable
description: |
  Comprehensive frontend design framework by Paul Bakaus. Prevents generic AI-average UI defaults by establishing a shared design vocabulary with 23 operational commands (polish, bolder, animate, quieter, critique, etc.) and 7 reference playbooks covering typography, color science, motion physics, and responsive layouts. Use for NIL and all premium UI builds.
triggers:
  - "impeccable"
  - "design framework"
  - "polish this UI"
  - "bolder"
  - "quieter"
  - "critique my design"
---

# Impeccable Design Framework

This skill wraps the open-source **impeccable** repository by Paul Bakaus. The canonical rule files are bundled as references:

- `AGENTS.md` — agent operational commands and vocabulary
- `DESIGN.md` — full design system reference
- `CLAUDE.md` — Claude-specific integration notes
- `PRODUCT.md` — product principles
- `README.md` — project overview

## Operational Commands

Use these verbs during UI work for NIL:

- `polish` — refine spacing, type, color, motion without changing structure
- `bolder` — increase contrast, weight, or visual drama
- `quieter` — reduce noise, soften, remove ornament
- `animate` — add or improve motion (honor `prefers-reduced-motion`)
- `structure` — fix layout hierarchy and reading order
- `critique` — audit against the playbooks and report issues before fixing
- `systematize` — extract tokens/components into a repeatable design system

## NIL-specific notes

- Tokens are locked: violet `#452a84`, lavender `#a9b1f0`, coral `#fe6f69`, cream `#f5f2ec`, abyss `#050507`
- Spring physics only; no linear easing
- Glass is an accent, not a blanket
- Density rules: 28px rows, 1px borders, 4-8px gaps
- Terminal-first layout: left targets tree, center conversation, right inspector, bottom AI strip
