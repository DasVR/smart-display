# Dashboard Mobile Safari Crash Fix — July 29, 2026

## Problem
Opening the navigation menu on Mobile Safari at `test.dasdev.net/dashboard` threw:
"Application error: a client-side exception has occurred"

Desktop Chrome with forced mobile viewport (375x812) did NOT reproduce.

## Root Cause
`ios-vibrator-pro-max` haptics polyfill in `src/lib/haptics.ts`.

This polyfill:
1. Creates a fake `<label>` element
2. Moves ALL `document.body` children into that label
3. Redefines `document.body` to return the label
4. Adds `display: contents !important` to the real body

React's reconciliation expects to own the DOM tree. When the polyfill reparents nodes, React's mobile overlay mount fails with a client-side exception.

## Fix
1. Removed `import "ios-vibrator-pro-max"` from `src/lib/haptics.ts`
2. Replaced `triggerHaptic` with a simple native `navigator.vibrate()` call (no-ops silently on iOS Safari, works on Android)
3. Removed `ios-vibrator-pro-max` from `package.json`
4. Ran `npm install` to clean up
5. Rebuilt with `npm run build`
6. Verified zero references in build output: `grep -r "ios-vibrator-pro-max" dist/` → nothing
7. Deployed to `arriq-portfolio-v2:80` container

## Files Changed
- `src/lib/haptics.ts` — gutted polyfill import, simplified to native API
- `package.json` — removed dependency
- Built output in `dist/` — verified clean

## Lesson
DOM-manipulating polyfills are incompatible with React. Before importing any polyfill that patches browser globals, check if it touches `document.body` or reparents nodes. If so, skip it — most APIs degrade gracefully without a polyfill.
