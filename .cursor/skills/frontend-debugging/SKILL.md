---
title: Frontend Debugging
name: frontend-debugging
description: Debug browser-specific client-side crashes in React / Next.js, especially DOM-manipulating polyfills that kill React on mobile Safari.
category: software-development
triggers:
  - "client-side exception"
  - "application error"
  - "works on desktop crashes on mobile"
  - "menu opens then crashes"
  - "safari mobile bug"
  - "react crash after interaction"
---

# Frontend Debugging

Debugging browser-specific client-side crashes in React / Next.js applications, especially when a feature works on desktop but dies on mobile Safari or Chrome.

## 1. Recognize the Pattern

- "Application error: a client-side exception has occurred (see the browser console for more information)."
- Crash happens after a specific interaction (click hamburger, open modal, scroll trigger)
- Desktop is fine; mobile Safari or Chrome crashes
- Hydration passes, then dies at runtime

## 2. Prime Suspect: DOM-Manipulating Polyfills

Some npm packages patch browser APIs by **reparenting the entire DOM** or redefining `document.body`. React's reconciliation engine expects to own the DOM tree. When something else moves nodes around, React throws.

### Known Dangerous Package
- **`ios-vibrator-pro-max`** (haptics polyfill)
  - Creates a fake `<label>` element
  - Moves **all `document.body` children** into that label
  - Redefines `document.body` getter to return the label
  - Adds `display: contents !important` to the real body
  - Result: React mounts the mobile overlay into what it thinks is the body, but the polyfill has stolen the tree. Client-side exception.

### Rule of Thumb
Before importing any polyfill that patches browser globals (`navigator`, `document`, `window`), skim its `dist/` or `src/` in `node_modules/`. If it touches `document.body`, `document.head`, reparents nodes, or uses `MutationObserver` to move elements, it is **incompatible with React**.

### Fix
Remove the polyfill. Most APIs degrade gracefully:
- `navigator.vibrate` simply no-ops on iOS Safari without a polyfill
- Android handles it natively
- No need for a library that destroys your DOM to add haptics

## 3. Debugging Mobile Safari Without a Console

Mobile Safari has no dev console. Options:

1. **Mac + Safari Remote Debug** — connect iPhone, open Safari Develop menu, inspect the page. Best option if available.
2. **Read the source** — the crash is often reproducible by reading what a library does in `node_modules/<pkg>/dist/`. DOM reparenting is visible immediately.
3. **Browser stack reproduction** — use the browser tool with mobile viewport + `browser_console` to simulate taps and catch errors.
4. **Binary search** — comment out recent imports one by one until the crash stops.

## 4. Verification Checklist After Fix

1. `grep -r "suspect-lib" dist/` — confirm zero references in build output
2. Remove from `package.json`, run `npm install`
3. Rebuild: `npm run build`
4. Deploy to test environment
5. Hard-refresh mobile Safari and re-test the interaction

## References

- [references/ios-vibrator-pro-max-crash.md](references/ios-vibrator-pro-max-crash.md) — full reproduction recipe and polyfill source analysis from the session that discovered this.