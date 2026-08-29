---
name: ui-ux-pro-max
description: "Use when designing, building, or reviewing UI for quality."
version: 1.0.0
---

# UI/UX Pro Max - Design Intelligence

Searchable local UI/UX guidance: 79 searchable styles (50 active), 192 product palettes and exact reasoning profiles, 74 font pairings, 119 UX guidelines, 105 curated icons, 17 GSAP presets, 25 chart types, and 22 technology stacks.

## When to Apply

Use this Skill when the task involves **UI structure, visual design decisions, interaction patterns, or user experience quality control**: designing new pages, creating/refactoring UI components, choosing color/typography/spacing/layout systems, reviewing UI for UX/accessibility/consistency, implementing navigation/animation/responsive behavior, or improving perceived quality and usability.

Skip it for pure backend logic, API/database design, non-visual performance work, infrastructure/DevOps, or non-visual scripts — unless the task changes how something **looks, feels, moves, or is interacted with**.

## Rule Categories by Priority

*Follow priority 1→10 to decide which category to focus on first.*

| Priority | Category | Impact | Key Checks (Must Have) | Anti-Patterns (Avoid) |
|----------|----------|--------|------------------------|------------------------|
| 1 | Accessibility | CRITICAL | Contrast 4.5:1, Alt text, Keyboard nav, Aria-labels | Removing focus rings, Icon-only buttons without labels |
| 2 | Touch & Interaction | CRITICAL | Min size 44×44px, 8px+ spacing, Loading feedback | Reliance on hover only, Instant state changes (0ms) |
| 3 | Performance | HIGH | WebP/AVIF, Lazy loading, Reserve space (CLS < 0.1) | Layout thrashing, Cumulative Layout Shift |
| 4 | Style Selection | HIGH | Match product type, Consistency, SVG icons (no emoji) | Mixing flat & skeuomorphic randomly, Emoji as icons |
| 5 | Layout & Responsive | HIGH | Mobile-first breakpoints, Viewport meta, No horizontal scroll | Horizontal scroll, Fixed px container widths, Disable zoom |
| 6 | Typography & Color | MEDIUM | Base 16px, Line-height 1.5, Semantic color tokens | Text < 12px body, Gray-on-gray, Raw hex in components |
| 7 | Animation | MEDIUM | Context-aware timing, Motion conveys meaning, Spatial continuity | One duration for every transition, Animating width/height, No reduced-motion |
| 8 | Forms & Feedback | MEDIUM | Visible labels, Error near field, Helper text, Progressive disclosure | Placeholder-only label, Errors only at top, Overwhelm upfront |
| 9 | Navigation Patterns | HIGH | Predictable back, Bottom nav ≤5, Deep linking | Overloaded nav, Broken back behavior, No deep links |
| 10 | Charts & Data | LOW | Legends, Tooltips, Accessible colors | Relying on color alone to convey meaning |

## Workflow

### Step 1: Analyze User Requirements

Extract from the user request:
- **Product type**: SaaS, e-commerce, portfolio, dashboard, entertainment, tool, productivity, or hybrid
- **Target audience & context**: age group, usage context
- **Style keywords**: playful, vibrant, minimal, dark mode, content-first, immersive, etc.
- **Stack**: detect from the project — check `package.json` deps (react/next/vue/svelte/nuxt), `pubspec.yaml` (Flutter), `*.xcodeproj`/`Package.swift` (SwiftUI), `composer.json` (Laravel), or React Native markers. **Never assume a stack.**

### Step 2: Generate Design System (REQUIRED for new pages/projects)

Aggregate product/style/color/landing/typography matches, apply reasoning rules, and return pattern, style, colors, typography, effects, and anti-patterns to avoid.

### Step 3: Apply Stack-Specific Guidance

For Svelte/SvelteKit specifically:
- Use Svelte 5 runes ($state, $derived, $effect) for reactivity.
- Scoped component styles; use CSS custom properties for theming.
- Use svelte-motion for spring physics animations.
- Respect prefers-reduced-motion.
- Ensure no horizontal overflow on mobile.

## Key Anti-Patterns (from the 119 UX guidelines)

- **Accessibility:** removing focus rings, icon-only buttons without labels, gray-on-gray text, text < 12px body.
- **Touch:** reliance on hover only, instant state changes (0ms), tap targets < 44px.
- **Performance:** layout thrashing, cumulative layout shift, no lazy loading.
- **Style:** mixing flat & skeuomorphic randomly, emoji as icons, raw hex in components.
- **Layout:** horizontal scroll, fixed px container widths, disabling zoom.
- **Typography:** text < 12px body, gray-on-gray, raw hex in components.
- **Animation:** one duration for every transition, animating width/height, no reduced-motion.
- **Forms:** placeholder-only label, errors only at top, overwhelming upfront.
- **Navigation:** overloaded nav, broken back behavior, no deep links.
- **Charts:** relying on color alone to convey meaning.

## Pre-Delivery Checklist

Before shipping any UI:
1. All text meets WCAG AA contrast (4.5:1 normal, 3:1 large).
2. All interactive elements have visible focus states.
3. All tap targets ≥ 44px.
4. No horizontal overflow at 320/375/414/768px.
5. All animations respect prefers-reduced-motion.
6. SVG icons used, not emoji.
7. Semantic color tokens used, not raw hex in components.
8. Empty, loading, and error states exist for all data views.
9. Keyboard navigation works throughout.
10. No fabricated metrics, testimonials, or trust claims.
