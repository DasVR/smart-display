# SDF Liquid Glass + Liquid Metal Shader (Single-Pass WebGL)

## What
A single WebGL fragment shader that simultaneously renders a **liquid metal background** (FBM + fresnel/specular lighting) and **true iOS-style liquid glass panels** via Signed Distance Fields (SDF), without any DOM→WebGL framebuffer capture.

## Why
Standard CSS `backdrop-filter` blur only frosts the background — it doesn't **refract** light through the glass or produce edge chromatic aberration. True Apple Liquid Glass requires optical effects:
- **Refraction** (lens distortion inside the panel)
- **Chromatic aberration** (color fringing at edges)

Libraries that do this by capturing the DOM into a framebuffer and re-rendering through WebGL cause frame drops on weak iGPUs due to sync overhead. The SDF approach avoids this entirely by computing panel geometry mathematically inside the shader.

## Architecture
- **Layer 1 (background)**: full-screen WebGL canvas at `z-index: 0`, `opacity: 0.18`, `mix-blend-mode: screen`
- **Layer 2 (DOM)**: actual UI panels with CSS `backdrop-filter: blur(26px) saturate(1.55)` — they provide the frosted substrate
- **Layer 3 (WebGL overlay)**: the shader computes SDF-based refraction + edge chromatic aberration where DOM panels exist, compositing on top of the raw background

The shader reads **live DOM panel bounding boxes** (`.glass-panel`, `.panel`) and passes them as `vec4 u_panels[8]` uniforms `[cx, cy, halfW, halfH]` in UV 0..1 space. A `MutationObserver` re-collects rects when the view changes.

## Technique Breakdown

### 1. Liquid Metal Background
Replace the original flat noise with a full lighting pass on the FBM field:

```glsl
// field gradient via finite differences -> cheap surface normals
vec3 fieldNormal(vec2 uv, float t, float bass) {
    float e = 4.0 / u_resolution.y; // ~1px screen-space
    float h  = fluid(uv, t, bass);
    float hx = fluid(uv + vec2(e, 0.0), t, bass);
    float hy = fluid(uv + vec2(0.0, e), t, bass);
    vec3 n = normalize(vec3(h - hx, h - hy, 0.6));
    return normalize(vec3(n.x, n.y, 1.0));
}
```

**Viscosity rule**: slow `u_time` by ~40% so the field feels heavy and molten:
- `q = fbm(uv + t * 0.07)` instead of `0.12`
- `r = fbm(... + 0.09 * t)` instead of `0.15`

**Color ramp**: deep violet valley → lavender wave body → near-white specular hot:
```glsl
vec3 col1 = vec3(0.012, 0.012, 0.040);   // base valley
vec3 col2 = vec3(0.18, 0.20, 0.40);      // wave body
vec3 col3 = vec3(0.92, 0.92, 1.0);       // specular hot point
```

**Lighting**:
- Diffuse from upper-left key light
- Blinn-Phong specular (`pow(max(dot(N, H), 0.0), 24.0)`)
- Fresnel: `pow(1.0 - abs(dot(n, V)), 3.0)` so edges pick up reflected light
- Bass glow toward center: `exp(-dist * 2.2) * u_bass`

### 2. SDF Rounded-Rect Panel Shape
```glsl
float sdRoundRect(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + vec2(r);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
```

Each DOM panel is converted to UV-space `[cx, cy, halfW, halfH]`. The shader loops over `u_panels[8]`, aspect-corrects, computes `sdRoundRect`, and tracks the closest panel.

### 3. Refraction (Inside the Glass)
When `sd < 0` (inside the panel), magnify the background by pulling the UV toward the panel center:
```glsl
vec2 toCenter = center - uv;
vec2 warp = uv + toCenter * 0.03;
vec3 refract = metal(warp, t, bass, ditherScale);
```

This produces a subtle lens magnification under the glass — the liquid appears to bend.

### 4. Edge-Only Chromatic Aberration
Near the panel border (`edge = clamp(best * 40.0 + 0.5, 0.0, 1.0)`), sample R/G/B with tiny radial offsets:
```glsl
vec2 dir = (uv - center) * aspect;
float rl = length(dir);
vec2 dirn = (rl > 0.0001) ? dir / rl : vec2(0.0);
vec2 off = dirn * 0.004 * edge;

vec3 r_ch = metal(uv + off * vec2(1.0, 0.0), ...);
vec3 g_ch = metal(uv, ...);
vec3 b_ch = metal(uv - off * vec2(1.0, 0.0), ...);
vec3 chroma = vec3(r_ch.r, g_ch.g, b_ch.b);
vec3 glass = mix(refract, chroma, edge * 0.85);
```

The center stays clear, the rim shimmers with color fringing — exactly how real optical glass behaves.

### 5. Panel Uniform Sync (JS side)
```js
// collect all .glass-panel / .panel rects in UV space
function collectPanels() {
    const els = document.querySelectorAll('.glass-panel, .panel');
    const c = Math.min(els.length, 8);
    for (let i = 0; i < c; i++) {
        const r = els[i].getBoundingClientRect();
        panelData[i * 4 + 0] = (r.left + r.width / 2) / window.innerWidth;
        panelData[i * 4 + 1] = (r.top + r.height / 2) / window.innerHeight;
        panelData[i * 4 + 2] = (r.width / 2) / window.innerWidth;
        panelData[i * 4 + 3] = (r.height / 2) / window.innerHeight;
    }
}
// re-collect when DOM changes (view switches, panels appear/disappear)
new MutationObserver(collectPanels).observe(document.querySelector('.display-root'), {
    subtree: true, childList: true
});
```

## Performance Notes
- **Single pass**: no DOM→WebGL framebuffer capture (the expensive part in other libraries)
- **Normals from finite differences**: only 3 `fluid()` calls per pixel, same octave count as original
- **DPR cap**: `Math.min(dpr, 1.5)` to save iGPU fill rate
- **`powerPreference: 'low-power'`** on context creation
- **Max 8 panels**: `uniform vec4 u_panels[8]` — enough for dashboard density without blowing uniform limits

## Gotchas
- `float` uniforms via `gl.uniform4fv(uPanelsLoc, panelData)` — the array stride is 4 floats, so `u_panels[0]` location works for the whole block
- Aspect correction matters: multiply panel UV coordinates by `vec2(u_resolution.x / u_resolution.y, 1.0)` before SDF evaluation or rectangles stretch on wide displays
- SDF border softness is controlled by the `clamp(-best * 40.0, 0.0, 1.0)` scale factor — higher multiplier = sharper edge
- The `sdRoundRect` radius should be small (e.g. `0.02 * u_resolution.y / min(u_resolution.x, u_resolution.y)`) so panels align with CSS `border-radius: 20px` approximately
- WebGL 1.0 does **not** support loop-unrolling from uniform index — use a hardcoded `for (int i = 0; i < 8; i++) { if (i >= u_panelCount) break; ... }` pattern

## Variations
- Increase `0.03` refraction strength for heavier lens distortion
- Swap `fluid()` time multiplier from `0.07` to `0.15` for lighter, more water-like motion
- Replace `bayerDither` with blue-noise dither texture if banding persists at very low opacity
- Add a second SDF layer (e.g. `u_island` for a Dynamic Island shape) with its own refraction/chroma

## Source of Truth
This technique was built for the DasVR/smart-display project (SvelteKit ambient dashboard on a Ryzen iGPU). The full shader source is in `AmbientShader.svelte` in that repo.
