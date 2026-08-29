---
name: design-system
description: "Use when creating design tokens or component specs."
version: 1.0.0
---

# Design System

Token architecture, component specifications, systematic design, slide generation.

## When to Use

- Design token creation
- Component state definitions
- CSS variable systems
- Spacing/typography scales
- Design-to-code handoff
- Tailwind theme configuration
- Slide/presentation generation

## Token Architecture

### Three-Layer Structure

```
Primitive (raw values)
       ↓
Semantic (purpose aliases)
       ↓
Component (component-specific)
```

**Example:**
```css
/* Primitive */
--color-blue-600: #2563EB;

/* Semantic */
--color-primary: var(--color-blue-600);

/* Component */
--button-bg: var(--color-primary);
```

## Quick Start

**Generate tokens:**
```bash
node scripts/generate-tokens.cjs --config tokens.json -o tokens.css
```

**Validate usage:**
```bash
node scripts/validate-tokens.cjs --dir src/
```

## Component Spec Pattern

Each component spec defines:
- **States:** default, hover, focus, active, disabled, loading, error, success
- **Variants:** primary, secondary, ghost, danger, outline
- **Sizes:** sm, md, lg
- **Tokens consumed:** which semantic/component tokens it references

## Token Naming Conventions

- **Primitive:** `--color-{hue}-{shade}` (e.g. `--color-blue-600`)
- **Semantic:** `--color-{role}` (e.g. `--color-primary`, `--color-danger`)
- **Component:** `--{component}-{property}` (e.g. `--button-bg`, `--card-radius`)

## Spacing Scale

Use a base unit (e.g. 4px) and multiply: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.

## Typography Scale

Define display, heading, body, caption, mono. Each with size, weight, line-height, letter-spacing.

## Accessibility

- All text meets WCAG AA contrast (4.5:1 normal, 3:1 large).
- Focus states visible on all interactive elements.
- Reduced-motion respected.
