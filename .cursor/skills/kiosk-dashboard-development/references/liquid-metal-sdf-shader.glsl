// Full liquid metal + SDF liquid glass fragment shader (GLSL ES 1.0)
// Designed for a single full-screen quad. iGPU-safe.

precision highp float;
varying vec2 v_uv;
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_bass;
uniform vec4 u_panels[8];
uniform int u_panelCount;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p = rot * p * 2.0;
        a *= 0.5;
    }
    return v;
}

float fluid(vec2 uv, float t, float bass) {
    vec2 q = vec2(fbm(uv + t * 0.07), fbm(uv + vec2(5.2, 1.3) - t * 0.055));
    vec2 r = vec2(
        fbm(uv + 1.7 * q + vec2(1.7, 9.2) + 0.09 * t),
        fbm(uv + 1.7 * q + vec2(8.3, 2.8) - 0.07 * t)
    );
    float f = fbm(uv + 1.9 * r);
    vec2 q2 = vec2(fbm(uv * 0.5 + t * 0.03), fbm(uv * 0.5 + vec2(3.1, 7.7) - t * 0.025));
    float f2 = fbm(uv * 0.5 + 1.4 * q2);
    vec2 centered = uv - 0.5;
    float dist = length(centered);
    float ripple = sin(dist * 40.0 - t * 1.8) * exp(-dist * 4.0);
    f += ripple * bass * 0.6;
    return f * 0.7 + f2 * 0.3;
}

vec3 fieldNormal(vec2 uv, float t, float bass) {
    float e = 4.0 / u_resolution.y;
    float h = fluid(uv, t, bass);
    float hx = fluid(uv + vec2(e, 0.0), t, bass);
    float hy = fluid(uv + vec2(0.0, e), t, bass);
    vec3 n = normalize(vec3(h - hx, h - hy, 0.6));
    return normalize(vec3(n.x, n.y, 1.0));
}

float sdRoundRect(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + vec2(r);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

const mat4 bayer4 = mat4(
    0.0/16.0,  8.0/16.0,  2.0/16.0, 10.0/16.0,
    12.0/16.0,  4.0/16.0, 14.0/16.0,  6.0/16.0,
    3.0/16.0, 11.0/16.0,  1.0/16.0,  9.0/16.0,
    15.0/16.0,  7.0/16.0, 13.0/16.0,  5.0/16.0
);
float bayerDither(vec2 uv, float scale) {
    vec2 p = uv * scale;
    vec2 ip = floor(p);
    return bayer4[int(ip.y) % 4][int(ip.x) % 4];
}

vec3 metal(vec2 uv, float t, float bass, float ditherScale) {
    float f = fluid(uv, t, bass);
    vec3 n = fieldNormal(uv, t, bass);
    vec3 L = normalize(vec3(-0.6, -0.5, 0.62));
    float diff = max(dot(n, L), 0.0);
    vec3 V = vec3(0.0, 0.0, 1.0);
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(n, H), 0.0), 24.0);
    vec3 col1 = vec3(0.012, 0.012, 0.040);
    vec3 col2 = vec3(0.18, 0.20, 0.40);
    vec3 col3 = vec3(0.92, 0.92, 1.0);
    vec3 color = mix(col1, col2, clamp(f * 0.7 + 0.15, 0.0, 1.0));
    color += col2 * diff * 0.30;
    color += col3 * spec * (0.9 + 0.6 * u_bass);
    float fres = pow(1.0 - abs(dot(n, V)), 3.0);
    color += vec3(0.16, 0.18, 0.34) * fres * 0.5;
    vec2 centered = uv - 0.5;
    color += vec3(0.10, 0.12, 0.28) * exp(-length(centered) * 2.2) * u_bass * 0.5;
    float d = bayerDither(uv * ditherScale, 8.0);
    color = mix(color, color * 1.16, d * 0.32);
    return color;
}

void main() {
    vec2 uv = v_uv;
    vec2 centered = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    float t = u_time * 0.001;
    float ditherScale = 96.0 + 48.0 * sin(t * 0.4);
    vec3 base = metal(uv, t, u_bass, ditherScale);
    vec3 glass = base;
    vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);
    float best = 1e9;
    vec2 center = vec2(-1.0);
    vec2 halfSize = vec2(-1.0);
    for (int i = 0; i < 8; i++) {
        if (i >= u_panelCount) break;
        vec4 p = u_panels[i];
        vec2 puv = (uv - vec2(p.x, p.y)) * aspect;
        float d = sdRoundRect(puv, vec2(p.z, p.w) * aspect, 0.02 * u_resolution.y / min(u_resolution.x, u_resolution.y));
        if (d < best) { best = d; center = vec2(p.x, p.y); halfSize = vec2(p.z, p.w); }
    }
    float inside = clamp(-best * 40.0, 0.0, 1.0);
    float edge = clamp((best * 40.0 + 0.5), 0.0, 1.0);
    if (inside > 0.001) {
        vec2 toCenter = center - uv;
        vec2 warp = uv + toCenter * 0.03;
        vec3 refract = metal(warp, t, u_bass, ditherScale);
        float fringe = edge;
        vec2 dir = (uv - center) * aspect;
        float rl = length(dir);
        vec2 dirn = (rl > 0.0001) ? dir / rl : vec2(0.0);
        vec2 off = dirn * 0.004 * fringe;
        vec3 r_ch = metal(uv + off * vec2(1.0, 0.0), t, u_bass, ditherScale);
        vec3 g_ch = metal(uv, t, u_bass, ditherScale);
        vec3 b_ch = metal(uv - off * vec2(1.0, 0.0), t, u_bass, ditherScale);
        vec3 chroma = vec3(r_ch.r, g_ch.g, b_ch.b);
        glass = mix(refract, chroma, fringe * 0.85);
        float topGlow = clamp(best * 10.0 + 0.5, 0.0, 1.0);
        glass += vec3(0.5, 0.5, 0.6) * topGlow * 0.10;
    }
    vec3 color = glass;
    float vig = 1.0 - length(centered) * 0.5;
    color *= vig;
    gl_FragColor = vec4(color, 1.0);
}
