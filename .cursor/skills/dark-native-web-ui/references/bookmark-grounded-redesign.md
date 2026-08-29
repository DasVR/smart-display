# Bookmark-Grounded UI Redesign Workflow

> **Scope:** When a user says "full redesign, unbiased, based on my bookmarks, ignore all other design info."
> **Key insight:** AI agents default to generic "dark SaaS" or "AI web app" design language. This workflow forces a break from that default.

---

## The Signal: "Based on My Bookmarks"

When the user references their Twitter/X bookmarks (or any personal bookmark collection) as the source of truth for design, it means:
1. They have a specific aesthetic that generic AI doesn't know
2. Generic inspo sites (Dribbble, awwwards) will produce "slop"
3. The bookmarks ARE the design language, not a supplement

**Do NOT:** search generic design inspo sites. The bookmarks are the only source.

## Step 1: Find and Read the Bookmarks

Load the relevant persona/memory skill that contains bookmark data (e.g., `finn-persona-ops`). Read `references/bookmarks-arsenal.md` or equivalent.

**What to extract:**
- Core aesthetic effects (liquid metal, border beam, thinking orbs, dithering)
- Anti-slop rules (0 box shadows, no generic gradients, locked tokens)
- macOS app references (Cursor, Linear, Raycast, Warp, Arc, Claude)
- Verified component libraries (liquid-glass-svelte, cuelume, morphicons, swiftuijs/ui)
- Typography and motion bookmarks (Framer springs, Amicro micro-interactions)

## Step 2: Read Current UI State

Before redesigning, read the existing code:
1. `web/src/app.css` — existing tokens
2. `web/src/routes/app/+layout.svelte` — current shell layout
3. Key components showing "AI web app" tells (ChatPanel, AiStrip, EmptyState, Sidebar)

**Build a table of specific gaps:** file → problem → fix.

## Step 3: Identify "AI Web App" Tells

These specific patterns read as "generic AI web app" rather than "native macOS tool":

| Tell | Fix |
|------|-----|
| Chat-first home / "Ask anything" hero | Terminal IS the product (Cursor/Linear) |
| Fake terminal chrome ($ prompts, green blocks) | Warp blocks, real PTY, no costume |
| Rounded user pills + avatar columns | Claude app: quiet dark UI, structured cards |
| Box shadows / generic gradients | chiefkeef.md: 0 box shadows |
| 44px iPhone hit targets | Linear: 28px rows |
| Emoji empty states (⚡🔧) | Folk: action-oriented empty states |
| Linear easing on everything | spring curves (bouncy/smooth/window) |
| Chat bubbles as AI strip | Structured cards, not user/assistant pills |
| Liquid metal on everything | ONE shared WebGL context, titlebar only |
| Generic "stats" / fake metrics | Only real data |

## Step 4: Lock IA First, Then Spend Effects

Top-tier Mac apps lock the information architecture before applying effects:
1. **IA:** Spaces, block terminal, palette, sidebars
2. **Then spend motion/material on exactly THREE moments:**
   - One metal surface (titlebar only, one shared WebGL context)
   - One spring (Space switch or palette)
   - One attention object (pending approval block)

## Step 5: Write the 4-File System

Build these as a system for Cursor to consume:

| File | Purpose |
|------|---------|
| `MASTER-REDESIGN.md` | Full IA source of truth: verdict, bookmark design language, IA diagram, block terminal spec, liquid metal rules, code-gap table, phase order |
| `CURSOR-REDESIGN-PROMPT.md` | Drop-in self-contained build brief with anti-slop rules, exact file fixes, verify commands |
| `DESIGN-TOKENS.md` | Locked colors, glass tiers, spring curves, type, density, keyboard map, one-attention-object rule |
| `BOOKMARK-SPEC.md` | Sourcing ledger: every decision traced to a specific bookmark URL + verified packages |

## Step 6: Verify Packages

Before recommending bookmark-derived packages:
```bash
npm view cuelume        # returns metadata if real
npm view liquid-glass-svelte
```
If they don't exist, drop them or find the real name.

## Key Principles

1. **Terminal is the soul.** Every surface is a lens onto hosts, commands, and evidence.
2. **Spaces, not pages.** User moves between objects in one window.
3. **Keyboard is the GUI.** If a mouse is required for a primary task, IA is wrong.
4. **AI is contextual.** Hidden → thin → expanded → pinned. Never a destination.
5. **Density with calm.** Inter for humans, JetBrains Mono for machines.
6. **Materials are honest.** Metal = titlebar, Glass = overlaps, Abyss = surface.
7. **One attention object.** Pick ONE to pulse, not two greens.
8. **0 box shadows.** Use borders + glass, never drop-shadow.

## Anti-Patterns to Enforce

- Never say "Ask Finn anything" as empty state
- Never render user/assistant pills — use structured cards
- Never put liquid metal on more than the titlebar
- Never use emoji in empty states
- Never use 44px hit targets inside workstation
- Never use linear easing for UI motion
- Never create a second WebGL context
- Never put glass on solid abyss with no overlap
- Never recommend phantom packages without verifying
