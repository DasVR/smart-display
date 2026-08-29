# iOS Vibrator Pro Max — Client-Side Exception Root Cause

## Error Manifestation
- Mobile Safari (iPhone) only
- Opening the hamburger menu → "Application error: a client-side exception has occurred"
- Desktop Chrome / browser stack reproduced the click fine
- User could not access Safari console (mobile has none)

## Discovery Path
1. Read `src/lib/haptics.ts` — saw `import "ios-vibrator-pro-max"` polyfill
2. Inspected polyfill source at `node_modules/ios-vibrator-pro-max/dist/polyfill.js`
3. Found the DOM hijacking immediately

## Polyfill Behavior (Why It Breaks React)

```js
// polyfill.js excerpt
function initPolyfill() {
    // ...
    for (const child of [...document.body.childNodes]) {
        if (ignoredElements.has(child)) continue;
        rootTrigger.label.appendChild(child);  // <-- MOVED OUT OF BODY
        if (child.nodeType === Node.ELEMENT_NODE) {
            handleAddElement(child);
        }
    }

    const reparentObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (!ignoredElements.has(node)) {
                    rootTrigger.label.appendChild(node);  // <-- KEEPS STEALING
                }
            }
        }
    });
    reparentObserver.observe(body, { childList: true });

    Object.defineProperty(document, "body", {
        get() { return rootTrigger.label; }  // <-- REDEFINED
    });
}
```

The polyfill:
1. Creates a fake `<label>` element
2. Moves ALL `document.body` children INTO that label
3. Replaces `document.body` getter so JS sees the label as the body
4. Adds `display: contents !important` to the real body
5. Watches `MutationObserver` to keep stealing new nodes

React mounts its portal / overlay into `document.body`. The polyfill intercepts that mount and reparents it into the label. React's reconciliation sees the DOM has been tampered with and throws a client-side exception.

## Fix Applied

Removed the polyfill import entirely. `navigator.vibrate` degrades gracefully: it no-ops on iOS Safari natively, and works on Android without any library.

**Before:**
```ts
import "ios-vibrator-pro-max";
export function triggerHaptic(pattern: number | number[] = 10): void {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  queueMicrotask(() => { navigator.vibrate(pattern); });
}
```

**After:**
```ts
export function triggerHaptic(pattern: number | number[] = 10): void {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  navigator.vibrate(pattern);
}
```

## Verification
- `grep -r "ios-vibrator-pro-max" dist/` → no references
- Removed from `package.json`, `npm install` to purge
- Rebuilt: `npm run build` — clean
- Deployed: `docker cp` to nginx container
- Pending: user hard-refresh and re-test on mobile Safari

## Generalizable Lesson
Any npm package that patches `document.body`, `document.head`, or uses `MutationObserver` to reparent the entire DOM is **incompatible with React**. Read the polyfill source before importing.