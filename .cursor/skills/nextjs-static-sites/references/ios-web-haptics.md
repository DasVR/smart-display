# iOS Web Haptics — Full Implementation Reference

## The Problem

iOS Safari has **never supported `navigator.vibrate()`** natively. The Web Vibration API is not implemented.

Historically, developers used a checkbox-toggle hack: create a hidden `<input type="checkbox">`, then programmatically toggle `input.checked = !input.checked` to trigger the Taptic Engine. This worked until **iOS 26.5**, when Apple patched programmatic toggling. The Taptic Engine now only fires on **genuine user interaction** with an actual iOS switch element.

## The Working Solution: `ios-vibrator-pro-max` Polyfill

Sam Denty's `ios-vibrator-pro-max` is a side-effect polyfill that intercepts `navigator.vibrate()` calls and triggers haptics on iOS Safari using the same switch-overlay technique under the hood, but **automatically** — no per-component overlay code needed.

```bash
npm install ios-vibrator-pro-max
```

```typescript
// src/lib/haptics.ts — client-only, import once
"use client";

// This polyfill makes navigator.vibrate() work on iOS Safari automatically
import "ios-vibrator-pro-max";

export function triggerHaptic(
  pattern: number | number[] = 10
): void {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  navigator.vibrate(pattern);
}

export const HapticPatterns = {
  light: 8,                       // nav links, small buttons
  medium: 12,                     // CTAs, form submits
  heavy: [10, 30, 10],            // major actions
  double: [8, 40, 8],             // menu toggle
  success: [10, 20, 10, 20, 10],  // form submitted
  error: [50, 30, 50],            // validation failed
  selection: 5,                   // picking from list
  toggle: [6, 20, 6],             // switch on/off
} as const;

/** Higher-order handler: wraps any click with haptic */
export function withHaptic<T extends HTMLElement>(
  handler?: (e: React.MouseEvent<T>) => void,
  pattern: number | number[] = HapticPatterns.light
): (e: React.MouseEvent<T>) => void {
  return (e) => {
    triggerHaptic(pattern);
    handler?.(e);
  };
}
```

### Platform Detection (for conditional UI, not for haptics)

```typescript
export function isIOSSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return (
    /iPhone|iPad|iPod/.test(ua) &&
    /WebKit/.test(ua) &&
    !/(CriOS|FxiOS|OPiOS|mercury)/.test(ua)
  );
}

export function isAndroid(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/.test(navigator.userAgent);
}

export function supportsHaptics(): boolean {
  if (typeof window === "undefined") return false;
  return isIOSSafari() || (isAndroid() && "vibrate" in navigator);
}
```

## Usage in Components

Just call `triggerHaptic()` in click handlers. The polyfill handles iOS, Android, and desktop.

```tsx
// SiteNav.tsx — no overlays, no refs, just call the function
import { triggerHaptic, HapticPatterns } from "@/lib/haptics";

<button
  onClick={() => {
    triggerHaptic(HapticPatterns.medium);
    setIsOpen((v) => !v);
  }}
>
  Menu
</button>

<Link
  href="/work"
  onClick={() => triggerHaptic(HapticPatterns.light)}
>
  Work
</Link>
```

## Why This Beats Hand-Rolled Overlays

| approach | code per element | maintenance | iOS support | Android |
|----------|-----------------|-------------|-------------|---------|
| Manual overlay | ~50 lines each | high | yes | manual |
| Polyfill | 1 line | zero | yes | auto |

The manual overlay approach (creating `<input type="checkbox" switch>` elements inside useEffect and wiring change handlers) is **deprecated** in this project. It was the only viable approach before `ios-vibrator-pro-max` existed, but the polyfill now handles:
- Overlay creation automatically
- Event interception
- Forwarding clicks to the real element
- Cleanup on unmount
- Android fallback via native `navigator.vibrate()`

## Pitfalls

1. **The import MUST be client-side only.** The polyfill touches `document` during initialization. In Next.js, import it in a `"use client"` file, not in a server component or `layout.tsx`.
2. **Import once.** Multiple imports are harmless but redundant. Best practice: import in your single `haptics.ts` utility file and use `triggerHaptic()` everywhere else.
3. **Do NOT call `navigator.vibrate()` during SSR.** The polyfill patches `navigator` at import time, but the call itself should be guarded by `typeof navigator !== "undefined"`.
4. **No platform checks at call sites.** With the polyfill, `triggerHaptic()` works everywhere. Do not litter components with `if (isIOSSafari())` at the click handler level.
5. **Haptic duration >1000ms.** The polyfill can block the main thread to extend the trusted event grant. For long patterns, import `enableMainThreadBlocking` from the lib (see below).
6. **Testing on simulator.** iOS Simulator does NOT emulate the Taptic Engine. Always test on real hardware.

## Advanced: Main Thread Blocking

For vibration patterns longer than 1000ms total, the click event grant expires. Enable blocking:

```typescript
import { enableMainThreadBlocking } from "ios-vibrator-pro-max";

enableMainThreadBlocking(true);
navigator.vibrate(2000); // works even past 1s
```

## Advanced: Debug Mode

```typescript
import { enableDebugMode } from "ios-vibrator-pro-max";

enableDebugMode(true); // visual indicators for overlays
```

## Advanced: Background Popups

```typescript
import { enableBackgroundPopup } from "ios-vibrator-pro-max";

enableBackgroundPopup(true); // allows vibration when tab is backgrounded
```

## Debugging

If haptics don't fire:
1. Check iOS version: Settings → General → About → Software Version
2. Safari DevTools → Console: look for polyfill errors (debug mode helps)
3. Test on a real device. Simulator does NOT emulate Taptic Engine.
4. Check "System Haptics" in Settings → Accessibility → Touch. Must be ON.
5. Verify the polyfill imported correctly: `typeof navigator.vibrate === "function"` should be true after the import.

## When Manual Overlay Is Still Relevant

Only if the polyfill's automatic wrapping conflicts with your specific DOM structure (e.g., SVG hit areas, canvas overlays, or highly dynamic portals). In that rare case, fall back to the manual approach from pre-polyfill sessions, but document why.

## Sources

- `ios-vibrator-pro-max` by Sam Denty: https://github.com/samdenty/ios-vibrator-pro-max
- npm: https://www.npmjs.com/package/ios-vibrator-pro-max
- Docs: https://vibrator.dev/
