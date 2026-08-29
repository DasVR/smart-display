/* ============================================
   Smart Display - Ambient Shader (WebGL)
   GPU-light: single full-screen quad, one fragment shader.
   Dither flow + subtle color shift. Respects reduced-motion.
   ============================================ */

<script>
  import { onMount, onDestroy } from 'svelte';

  let canvas;
  let gl;
  let program;
  let startTime = performance.now();
  let rafId;
  let destroyed = false;

  const VERT_SRC = `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
      v_uv = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const FRAG_SRC = `
    precision highp float;
    varying vec2 v_uv;
    uniform float u_time;
    uniform vec2 u_resolution;

    // Bayer 8x8 ordered dither matrix
    const mat2 bayer2 = mat2(0.0, 0.5, 0.75, 0.25);
    const mat4 bayer4 = mat4(
      0.0, 0.5, 0.125, 0.625,
      0.75, 0.25, 0.875, 0.375,
      0.1875, 0.6875, 0.0625, 0.5625,
      0.9375, 0.4375, 0.8125, 0.3125
    );
    const mat8 bayer8 = mat8(
      0.0/63.0, 32.0/63.0,  8.0/63.0, 40.0/63.0,  2.0/63.0, 34.0/63.0, 10.0/63.0, 42.0/63.0,
      48.0/63.0, 16.0/63.0, 56.0/63.0, 24.0/63.0, 50.0/63.0, 18.0/63.0, 58.0/63.0, 26.0/63.0,
      12.0/63.0, 44.0/63.0,  4.0/63.0, 36.0/63.0, 14.0/63.0, 46.0/63.0,  6.0/63.0, 38.0/63.0,
      60.0/63.0, 28.0/63.0, 52.0/63.0, 20.0/63.0, 62.0/63.0, 30.0/63.0, 54.0/63.0, 22.0/63.0,
      3.0/63.0, 35.0/63.0, 11.0/63.0, 43.0/63.0,  1.0/63.0, 33.0/63.0,  9.0/63.0, 41.0/63.0,
      51.0/63.0, 19.0/63.0, 59.0/63.0, 27.0/63.0, 49.0/63.0, 17.0/63.0, 57.0/63.0, 25.0/63.0,
      15.0/63.0, 47.0/63.0,  7.0/63.0, 39.0/63.0, 13.0/63.0, 45.0/63.0,  5.0/63.0, 37.0/63.0,
      63.0/63.0, 31.0/63.0, 55.0/63.0, 23.0/63.0, 61.0/63.0, 29.0/63.0, 53.0/63.0, 21.0/63.0
    );

    float bayerDither(vec2 uv, float scale) {
      vec2 p = uv * scale;
      vec2 ip = floor(p);
      vec2 fp = fract(p);
      float pattern = 0.0;
      
      if (scale <= 8.0) {
        pattern = bayer8[int(ip.y)%8][int(ip.x)%8];
      } else if (scale <= 4.0) {
        pattern = bayer4[int(ip.y)%4][int(ip.x)%4];
      } else {
        pattern = bayer2[int(ip.y)%2][int(ip.x)%2];
      }
      
      return step(fp.x + fp.y, pattern);
    }

    // cheap noise
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f); // smoothstep
      return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
        f.y
      );
    }

    float fbm(vec2 p, int octaves) {
      float value = 0.0;
      float amplitude = 0.5;
      for (int i = 0; i < 5; i++) {
        if (i >= octaves) break;
        value += amplitude * noise(p);
        p *= 2.0;
        amplitude *= 0.5;
      }
      return value;
    }

    void main() {
      vec2 uv = v_uv;
      vec2 centered = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
      
      // slow moving noise field
      float t = u_time * 0.03;
      float n = fbm(centered * 1.5 + vec2(t * 0.1, t * 0.07), 3);
      
      // color shift: abyss -> lavender subtle gradient
      vec3 col1 = vec3(0.02, 0.02, 0.05);  // abyss
      vec3 col2 = vec3(0.25, 0.25, 0.45);  // lavender tint
      vec3 color = mix(col1, col2, n * 0.5 + 0.3);
      
      // ordered dither overlay (animated threshold)
      float ditherScale = 128.0 + 64.0 * sin(t * 0.5);
      float dither = bayerDither(uv * ditherScale, 8.0);
      color = mix(color, color * 1.15, dither * 0.4);
      
      // subtle vignette
      float vignette = 1.0 - length(centered) * 0.6;
      color *= vignette;
      
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function createProgram(gl, vertSrc, fragSrc) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(prog));
      return null;
    }
    return prog;
  }

  function initGL() {
    if (!canvas) return;
    gl = canvas.getContext('webgl', { alpha: true, antialias: false });
    if (!gl) return;

    program = createProgram(gl, VERT_SRC, FRAG_SRC);
    if (!program) return;

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1,  -1, 1,
      -1,  1,  1, -1,   1, 1
    ]), gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.useProgram(program);
    gl.viewport(0, 0, canvas.width, canvas.height);

    render();
  }

  function render() {
    if (destroyed) return;
    const now = performance.now();
    const elapsed = now - startTime;

    gl.uniform1f(gl.getUniformLocation(program, 'u_time'), elapsed);
    gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    rafId = requestAnimationFrame(render);
  }

  function resize() {
    if (!canvas || !gl) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  onMount(() => {
    // check reduced motion
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mediaQuery.matches) {
      canvas.style.display = 'none';
      return;
    }
    initGL();
    window.addEventListener('resize', resize);
  });

  onDestroy(() => {
    destroyed = true;
    if (rafId) cancelAnimationFrame(rafId);
    if (gl && program) gl.deleteProgram(program);
    window.removeEventListener('resize', resize);
  });
</script>

<canvas id="shader-canvas" bind:this={canvas}></canvas>

<style>
  canvas {
    position: fixed;
    top: 0; left: 0;
    width: 100vw;
    height: 100vh;
    pointer-events: none;
    z-index: 0;
    opacity: 0.04;
    mix-blend-mode: screen;
  }
</style>
