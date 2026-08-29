# Design Audit Output Format

Use when the user asks for a UI/UX audit of a web app skeleton, redesign, or existing codebase.

## When to Produce an Audit

- Skeleton has components but no routes or layout yet.
- Dependencies don't install or don't build.
- Design tokens exist but haven't been battle-tested against the actual code.
- User wants "review this UI" or "audit my frontend."

## Output Structure

Write the audit as `AUDIT.md` in the project's frontend directory. Include:

1. **Executive Summary** — 3-4 sentences. Honest verdict: promising / needs work / broken.
2. **Build & Dependency Failures** — table of broken packages with fixes.
3. **Design System Issues** — token problems, missing layers, animation violations.
4. **Component-Level Issues** — per-component problems + fixes.
5. **IA / Layout Architecture** — what's missing vs. DESIGN.md spec.
6. **Recommended Fix Order** — phased (A→B→C→D) with hour estimates.
7. **Pre-Flight Checklist** — what "done" means for this project.

## Specific Learnings from NIL Frontend Audit (Aug 2026)

### Glass Token Anti-Pattern: Opaque Black on Black

```css
/* BAD — looks muddy, not luminous */
--glass-1: rgba(5, 5, 7, 0.45);
--glass-2: rgba(5, 5, 7, 0.55);

/* GOOD — tinted translucent colors */
--glass-1: rgba(69, 42, 132, 0.18);   /* violet tint, 32-40px blur */
--glass-2: rgba(169, 177, 240, 0.12); /* lavender tint, 24-28px blur */
--glass-3: rgba(254, 111, 105, 0.08); /* coral hint, 16-20px blur */
--glass-4: rgba(245, 242, 236, 0.06); /* cream hint, 12px blur */
```

Always pair with `backdrop-filter: blur(Npx) saturate(1.4) contrast(1.05)` and `::before` edge refraction.

### Linear Easing in Infinite Animations

`BorderBeam` used `animation: ... linear infinite` — violates spring-physics-only rule.

Fix: either use `--spring-smooth` for the spin, or better, make the beam state-machine driven (idle → thinking → streaming → done) rather than infinite.

### Lucide as Default Icon Set

`taste-skill` discourages `lucide-svelte` as the default. For NIL, better choices:
- `phosphor-svelte` (default)
- `@iconify/svelte` (if you want reicon / morphicons access)

Only keep Lucide if user explicitly asks or project already depends on it.

### Hover State Rerendering in Dock

Setting `hoveredIndex` state and applying inline `transform: scale()` to every item causes a re-render cascade. Use CSS `:hover` + sibling combinators, or `Motion` values outside React/Svelte render cycle.

### Missing Architecture Components

A terminal-first workstation requires these shell components even for an empty-state screen:
- `Sidebar.svelte` (left)
- `RightSidebar.svelte` (inspector)
- `Terminal.svelte` (center hero)
- `AiStrip.svelte` (bottom, 4 states, collapsed by default)
- `StatusBar.svelte` (very bottom, 26px)
- `CommandPalette.svelte` (modal, Cmd+K)
- `EmptyState.svelte` (new engagement flow)
- `ThinkingLogo.svelte` (4-state logo, not generic dots)

## Audit Pitfall: Don't Try to Fix During the Audit

If dependencies are broken, either:
- **Audit-only:** document bugs, deliver the doc.
- **Fix-first:** fix deps, verify build, THEN audit rendered output.

Mixing both loses coherence and produces a confused deliverable.
