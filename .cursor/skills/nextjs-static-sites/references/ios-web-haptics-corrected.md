# iOS Web Haptics — Corrected Reference (Post-iOS 27)

## What Actually Works

**Manual `<input type="checkbox" switch>` overlays are the ONLY reliable way to trigger Taptic Engine on iOS Safari (tested on iOS 27).**

The `ios-vibrator-pro-max` polyfill by Sam Denty wraps the entire `<body>` in a `<label>` element and redefines `document.body`. This breaks React's event system and hydration. It does NOT work in Next.js App Router. Do not use it.

## The Correct Implementation

Create a `<span>` wrapper that holds an invisible iOS switch input. When the user taps it, the native Taptic Engine fires automatically via the `change` event. The `onActivate` callback then handles your actual navigation/action.

```typescript
// src/lib/haptics.ts
"use client";

export const HapticPatterns = {
  light: 8,
  medium: 12,
  heavy: [10, 30, 10] as number[],
  double: [8, 40, 8] as number[],
  success: [10, 20, 10, 20, 10] as number[],
  error: [50, 30, 50] as number[],
  selection: 5,
  toggle: [6, 20, 6] as number[],
} as const;

/** Vibration API for Android only (iOS uses overlays, not this) */
export function triggerHaptic(pattern: number | number[] = 10): void {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(pattern);
  }
}
```

```tsx
// Wrap any clickable element with haptic feedback
function HapticTap({
  children,
  onTap,
  className,
}: {
  children: React.ReactNode;
  onTap?: () => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const target = containerRef.current;
    if (!target) return;
    if (!isIOSSafari()) return;

    const computed = getComputedStyle(target);
    if (computed.position === "static") {
      target.style.position = "relative";
    }

    const switchEl = document.createElement("input");
    switchEl.type = "checkbox";
    switchEl.setAttribute("switch", "");
    switchEl.setAttribute("aria-hidden", "true");
    switchEl.tabIndex = -1;

    Object.assign(switchEl.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      margin: "0",
      opacity: "0.01",
      cursor: "pointer",
      zIndex: "9999",
      WebkitTapHighlightColor: "transparent",
      pointerEvents: "auto",
    });

    target.appendChild(switchEl);

    const handleChange = () => {
      switchEl.checked = false;
      onTap?.();
    };

    switchEl.addEventListener("change", handleChange);

    return () => {
      switchEl.removeEventListener("change", handleChange);
      switchEl.remove();
    };
  }, [onTap]);

  return (
    <span ref={containerRef} className={className}>
      {children}
    </span>
  );
}
```

## Usage

```tsx
<HapticTap onTap={() => { /* nav, toggle, etc */ }}>
  <Link href="/work">Work</Link>
</HapticTap>

<HapticTap onTap={toggleMenu}>
  <button aria-label="Menu"><Hamburger /></button>
</HapticTap>
```

## Key Details

- `opacity: "0.01"` (NOT 0) — iOS sometimes ignores fully transparent inputs
- `pointerEvents: "auto"` — ensures the switch is tappable even inside containers with `pointer-events: none`
- `zIndex: "9999"` — sits above the wrapped element
- `WebkitTapHighlightColor: "transparent"` — removes blue iOS tap flash
- `tabIndex: -1` — removes from tab order
- Reset `switchEl.checked = false` in `handleChange` so it can fire again on next tap

## What Does NOT Work

### `navigator.vibrate()` on iOS Safari
Never supported natively. Do not call it directly for iOS.

### `ios-vibrator-pro-max` Polyfill in Next.js
Breaks React by wrapping `<body>` in a `<label>` and redefining `document.body`. Causes hydration mismatches, event system conflicts, and fails to trigger haptics. Do not use.

### Deferring with `queueMicrotask()`
Does NOT solve the trusted event grant problem. The polyfill needs the actual click event to bubble to `window`, but by the time it fires, the grant has expired. This was attempted in this session and confirmed not to work.

### Programmatic Checkbox Toggling
Setting `input.checked = !input.checked` via JavaScript does NOT trigger haptics on iOS 26.5+. Apple patched this. Only genuine user taps on a switch element work.

## Platform Detection

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
```

## Testing

- iOS Simulator does NOT emulate the Taptic Engine. Always test on real hardware.
- Settings → Accessibility → Touch → System Haptics must be ON.
- If using Next.js static export, deploy to a real URL and test from Safari (not localhost).

## Sources

- Original checkbox hack discovered by Sam Denty
- iOS 26.5 patched programmatic toggling
- iOS 27: manual switch overlay confirmed working
