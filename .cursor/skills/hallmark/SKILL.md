---
name: hallmark
description: "Use when building or redesigning UI to avoid AI-slop."
version: 1.1.0
---

# Hallmark

A design skill for AI coding assistants. Makes the UIs they generate look made, not generated.

Hallmark is opinionated, short, and boring on purpose. It encodes a tight set of rules — drawn from the consensus of the anti-AI-slop design field (Anthropic's frontend-design skill, the Claude cookbook on frontend aesthetics, and the 2026 "tactile rebellion" movement) — and refuses to let the model fall back to the defaults every LLM was trained on.

The differentiator: Hallmark insists on **structural variety**, not just visual variety. Two pages by Hallmark for two different briefs should not share the same hero → 3-feature → CTA → footer rhythm. They should feel like different sites, not different colour-swaps of the same template.

## How to use this skill

Hallmark has one default behaviour and three explicit verbs.

| Invocation | What it does |
| --- | --- |
| *(default)* | The user asked you to design or build something new. Follow the **Design flow** below. |
| `hallmark audit <target>` | Read the target, score it against the anti-pattern list, return a ranked punch list. **Do not edit.** |
| `hallmark redesign <target>` | Take the target's content and intent, then redesign the visual structure inside the existing implementation boundaries. Preserve routes, component ownership, copy intent, brand, IA; replace only the visual/interaction layer. |
| `hallmark study <screenshot \| URL>` | Extract the DNA (macrostructure, archetypes, type-pairing, colour anchor) from a design you admire. Never copies pixels. Refuses template-marketplace URLs. |

## Disciplines that hold across every verb

1. **Pre-emit self-critique.** Before handing back any output, score it 1–5 on six axes — Philosophy, Hierarchy, Execution, Specificity, Restraint, Variety. Anything **< 3** triggers a revision pass. Stamp the six scores at the top of the artifact.

2. **Honest copy — no fabricated content.** If the user did not supply a metric, do not invent one. Stat-led layouts, comparison rows, and proof bars must use real numbers, a placeholder, or a different macrostructure. Same rule for testimonials, logos, and case-study counts.

3. **Locked tokens — no mid-render improvisation.** Once a theme is selected, every colour and every `font-family` declaration must reference a named token (`var(--color-accent)`, `font-family: var(--font-display)`). Inline OKLCH / hex / `rgb()` values, or a `font-family: "Some Font"` that bypasses the token block, are not allowed.

4. **Re-drawn chrome forbidden.** Hallmark must not hand-build fake browser bars (URL pill + traffic-light dots), fake phone frames, fake code-block windows (mock title bar + dots wrapping a `<pre>`), or fake IDE chrome. Use real screenshots wrapped in a `<figure>`, or omit the chrome.

5. **Mobile responsiveness — every emit verified at 320 / 375 / 414 / 768 px.** No horizontal scroll + root `overflow-x: clip` on both `html` and `body` (never `hidden`); no two-line clickable text; image-bearing grid tracks use `minmax(0, 1fr)`; display headers wrap via `overflow-wrap: anywhere; min-width: 0`; section heads collapse to one column on mobile.

6. **Typography purity — no italic headers.** Headings and display type are always roman (`font-style: normal`). An italicised emphasis word inside an otherwise-upright heading is one of the most reliable AI tells. Carry emphasis with weight, accent colour, or a drawn underline. Italic survives only as body-copy emphasis.

## When the brief is a component, not a page

If the brief names a single UI element (button, input, card, modal, dropdown, tooltip, select, checkbox, switch, tab strip, chip, badge, banner, snackbar, popover, slider, date picker, avatar), or is short (≤ 30 words) and refers to one element, run the Component-scope flow:

- **Step 0 · Pre-flight scan** — read existing tokens, fonts, framework, microinteraction stance. Adopt them, don't invent new ones.
- **State discipline — STRICTER.** Every interactive component MUST ship code for **all 8 states**: default · hover · `:focus-visible` · `:active` · disabled · loading · error · success.
- Emit two files: the component artifact (consuming tokens by name) + an 8-state demo wrapper (`.preview.html`) rendering all 8 states stacked vertically.

## `hallmark audit`

Read the target, score it against the anti-pattern list, return a ranked punch list. Do not edit.

## `hallmark study`

Extract structure, not pixels. Names the macrostructure, archetypes, type-pairing, colour anchor, and rhythm. Produces a diagnosis report before any code, then offers to rebuild the user's content using the extracted DNA. Pixel-cloning is not a feature.

## Anti-patterns to avoid (the slop test)

- **Visual & Color:** generic blue-purple gradients, excessive glassmorphism everywhere, excessive border radius (pill everything), overly soft shadows on every element, glow everywhere, background grids, trend-stacking (glass + mesh + glow + mono + grid + rounded all at once), too many colors, excessive accent color.
- **Layout & Components:** monotonous hero→subtitle→2 CTAs→screenshot→feature grid→testimonials→FAQ→CTA→footer, copy-paste feature cards, uniform spacing, broken mobile, template animations (fade-up/fade-in/floating/scale/bounce on everything), "How It Works" always 3 steps, "Trusted By" logo bar, "Most Popular" pricing card, 4-column template footer.
- **Copywriting:** em dash (—), generic CTAs (Get Started, Learn More, Try Now, Explore, Discover), AI buzzwords (AI Powered, Revolutionary, Next Generation, Seamless, Cutting Edge), fake statistics, fake testimonials, fabricated trust claims.
- **Decorative:** generic AI icons (sparkle, star, magic, lightning, diamond, cube, robot, AI orb), small arrows (→/↗) on every button, AI capsule badges, generic AI typography (large mono headings, HOW IT WORKS uppercase with wide tracking), typeface chosen without reason, generic illustrations (Undraw, Storyset, 3D blobs).
- **Functionality:** non-functional interactive elements, happy-path-only design (no empty/loading/error states), irrelevant FAQ, assumed logos/profile photos, navbar links to nowhere, file/CSS patching via script.
- **Identity:** no visual identity (swap the logo and it feels the same), clone of popular products (Linear, Vercel, Stripe, Notion).
- **Accessibility:** poor color contrast (fails WCAG), not keyboard navigable, no visible focus state.

## Mandatory rules (R-01 to R-25)

- **R-01 Color:** FORBIDDEN blue-purple/blue-cyan/purple-pink gradients as primary; FORBIDDEN colored glow backgrounds as default; FORBIDDEN neon blue buttons without branding reason.
- **R-02 Copy:** FORBIDDEN em dash (—); use comma, period, colon, or parentheses.
- **R-03 Mobile:** REQUIRED perfect mobile layout; no horizontal overflow; text stays in containers; cards don't clip; 44px tap targets; consistent spacing.
- **R-04 Icons:** FORBIDDEN sparkle/star/magic/lightning/diamond/orb/robot as feature icons; icons must be genuinely relevant.
- **R-05 Layout:** FORBIDDEN AI template layouts; FORBIDDEN "How It Works" in 3 steps; FORBIDDEN "Trusted By" logo bar; FORBIDDEN 4-column template footer.
- **R-06 Typography:** FORBIDDEN large mono fonts for "terminal" aesthetics; FORBIDDEN uppercase labels with extreme letter-spacing without reason.
- **R-07 Background:** FORBIDDEN grid squares/blueprint lines/graph paper as default background.
- **R-08 Button Arrows:** arrows (→/↗) are not the default identity for every button.
- **R-09 Badges:** FORBIDDEN capsule badges containing "AI Powered", "Beta", "New", "Secure", "Fast" without context.
- **R-10 Glassmorphism:** glass is an ACCENT only, not the character of the entire UI; FORBIDDEN blur on navbar+cards+modals+sidebar simultaneously; apply to max 1-2 elements.
- **R-11 Border Radius:** consistent with the design system; FORBIDDEN pill-everything; radius variation is a hierarchy tool.
- **R-12 Shadow:** shadow supports visual hierarchy, not makes everything float; use selectively.
- **R-13 Glow:** glow only as focus accent on max 1-2 important elements.
- **R-14 Feature Cards:** FORBIDDEN all cards identical size/icon/padding/layout; create visual variation.
- **R-15 CTA:** FORBIDDEN "Get Started", "Learn More", "Try Now", "Explore", "Discover"; CTAs must be specific to the product context.
- **R-16 Buzzwords:** FORBIDDEN "AI Powered", "Next Generation", "Revolutionary", "Seamless", "Cutting Edge", "Intelligent", "Ultimate", "Powerful", "Effortless".
- **R-17 Data:** FORBIDDEN numbers/statistics without a real source; empty is better than deceptive.
- **R-18 Testimonials:** FORBIDDEN AI avatars, random names, fictional reviews; use verifiable social proof.
- **R-19 Animations:** animations must have a clear UX purpose; FORBIDDEN fade-up+floating+scale+bounce on everything.
- **R-20 Visual Identity:** strong identity: specific palette, typeface chosen for a reason, unique composition.
- **R-21 Dark Mode:** choose theme based on brand identity; developer tools/terminals have legitimate reason for dark default; if no strong reason, build a working light/dark toggle.
- **R-22 Illustrations:** FORBIDDEN Undraw/Storyset/3D blob characters; must connect to the product.
- **R-23 Clarification:** before creating assets without explicit instructions, ask or use clear placeholders; never generate assets as if final without confirmation.
- **R-24 Navigation:** FORBIDDEN navbar links to pages that don't exist; every nav item must have a real destination.
- **R-25 Color Contrast:** REQUIRED WCAG AA: normal text 4.5:1, large text (18px+) 3:1.

## Implementation safety rail

Hallmark is a design skill, not a license to bulldoze a codebase. In any existing project:
- Never delete production files, route trees, component directories, or an old website unless the user explicitly asks for deletion or approves a file-level plan.
- Default to in-place edits of the named files, or additive new components/tokens wired through the existing route.
- Before editing, state the exact files you expect to modify/create/delete. Deletions require explicit confirmation.
