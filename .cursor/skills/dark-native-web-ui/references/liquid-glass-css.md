# Liquid Glass CSS

> CSS-only liquid glass effect inspired by Apple iOS 26 / macOS Tahoe / visionOS
> Technique: CSS-Tricks "Getting Clarity on Apple's Liquid Glass" + LogRocket Blog

## Core Technique

Liquid glass uses a **stacked approach** with SVG filters + backdrop-filter:

1. **Base layer**: content behind the glass
2. **Blur layer**: `backdrop-filter: blur()`
3. **Distortion layer**: SVG `feTurbulence` + `feDisplacementMap`
4. **Highlight layer**: subtle inner shadow / specular highlight

## Minimal Implementation

```html
<!-- Put this in your root layout once -->
<defs>
  <svg style="position:absolute;width:0;height:0;" aria-hidden="true">
    <filter id="liquid-glass" x="-20%" y="-20%" width="140%" height="140%">
      <feTurbulence type="fractalNoise" baseFrequency="0.015" numOctaves="2" result="noise"/>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="8" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  </svg>
</defs>
```

```css
.liquid-glass {
  position: relative;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-panel, 12px);
  backdrop-filter: blur(40px) saturate(1.4);
  -webkit-backdrop-filter: blur(40px) saturate(1.4);
  /* Subtle inner highlight */
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.1),
    inset 0 -1px 1px rgba(0, 0, 0, 0.1),
    0 8px 32px rgba(0, 0, 0, 0.3);
  overflow: hidden;
}

/* Optional: apply distortion filter to a child pseudo-element */
.liquid-glass::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  filter: url(#liquid-glass);
  pointer-events: none;
  opacity: 0.15;
}
```

## Usage Rules

- Apply to **1 hero element maximum** (e.g., landing page hero card)
- Never on functional panels, modals, or sidebars
- The distortion is subtle — 15% opacity max
- Use sparingly; this is a visual flourish, not a system surface

## Performance

- `backdrop-filter` is GPU-accelerated but expensive when overused
- SVG filters are CPU-intensive — only use on 1 element
- Safari handles this well; Chrome may drop frames if overused
- Always test on target hardware

## Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  .liquid-glass::before {
    display: none;
  }
}
```

## Forced Colors

```css
@media (forced-colors: active) {
  .liquid-glass {
    background: Canvas;
    border: 1px solid CanvasText;
    backdrop-filter: none;
    box-shadow: none;
  }
}
```
