precision highp float;
varying vec2 v_uv;
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_bass;

// ---------- noise ----------
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = rot * p * 2.0;
    a *= 0.5;
  }
  return v;
}

// ---------- fluid ----------
float fluid(vec2 uv, float t, float bass) {
  vec2 q = vec2(fbm(uv + t * 0.12), fbm(uv + vec2(5.2, 1.3) - t * 0.09));
  vec2 r = vec2(
    fbm(uv + 1.7 * q + vec2(1.7, 9.2) + 0.15 * t),
    fbm(uv + 1.7 * q + vec2(8.3, 2.8) - 0.12 * t)
  );
  float f = fbm(uv + 1.9 * r);
  vec2 q2 = vec2(fbm(uv * 0.5 + t * 0.05), fbm(uv * 0.5 + vec2(3.1, 7.7) - t * 0.04));
  float f2 = fbm(uv * 0.5 + 1.4 * q2);
  vec2 centered = uv - 0.5;
  float dist = length(centered);
  float ripple = sin(dist * 40.0 - t * 3.0) * exp(-dist * 4.0);
  f += ripple * bass * 0.6;
  return f * 0.7 + f2 * 0.3;
}

// ---------- 8x8 Bayer dither ----------
float bayer8(vec2 uv, float scale) {
  vec2 p = floor(mod(uv * scale, 8.0));
  // Inline all 64 cases (abbreviated for template)
  // Use a lookup table in production
  float b = 0.0;
  // ... (full 64-case chain goes here)
  return b / 64.0;
}

// ---------- matrix grid ----------
float grid(vec2 uv, float t) {
  vec2 g = fract(uv * 40.0);
  float line = smoothstep(0.0, 0.02, g.x) * smoothstep(0.0, 0.02, g.y);
  float fall = 0.5 + 0.5 * sin(t * 0.3 + uv.x * 3.0 + uv.y * 2.0);
  return (1.0 - line) * 0.04 * fall;
}

void main() {
  vec2 uv = v_uv;
  vec2 centered = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
  float t = u_time * 0.001;

  float f = fluid(uv, t, u_bass);

  vec3 col1 = vec3(0.015, 0.015, 0.04);
  vec3 col2 = vec3(0.22, 0.22, 0.45);
  vec3 col3 = vec3(0.55, 0.50, 0.70);
  vec3 color = mix(col1, col2, clamp(f * 0.7 + 0.2, 0.0, 1.0));
  color = mix(color, col3, clamp(u_bass * 0.35, 0.0, 1.0));

  // 8x8 Bayer dither
  float d = bayer8(uv, 80.0 + 40.0 * sin(t * 0.3));
  color = mix(color, color * 1.22, d * 0.40);

  // Matrix grid
  color += vec3(grid(uv, t)) * 0.7;

  // Vignette
  float vig = 1.0 - length(centered) * 0.6;
  color *= clamp(vig, 0.0, 1.0);

  gl_FragColor = vec4(color, 1.0);
}
