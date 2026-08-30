<script>
	/**
	 * Full-screen WebGL2 liquid-metal canvas.
	 * Internal resolution is locked at 1280×720 and upscaled with
	 * `image-rendering: pixelated`. Field UVs and the Bayer matrix both
	 * sample from a 4–8px snapped grid. Dither is mixed at 0.20 so it
	 * reads as a faint retro grain, not a high-contrast cell grid.
	 */
	import { onMount } from 'svelte';
	import { bassLevel as bassStore, startAudioReactive, setAudioPaused } from '$lib/services/audioReactive.js';

	let { isLowPower = false } = $props();

	const INTERNAL_W = 1280;
	const INTERNAL_H = 720;
	/** Virtual pixel block for Bayer + field sampling. Override with ?pixel=4..8 */
	const PIXEL_SIZE = 6;

	function readPixelSize() {
		if (typeof location === 'undefined') return PIXEL_SIZE;
		const n = Number(new URLSearchParams(location.search).get('pixel'));
		if (n >= 4 && n <= 8) return n;
		return PIXEL_SIZE;
	}

	let canvas = $state(null);
	let gl = null;
	let program = null;
	let buffer = null;
	let destroyed = false;
	let rafId = 0;
	let startTime = 0;
	let pauseAccum = 0;
	let pausedAt = 0;
	let frozen = false;
	let bass = 0.12;
	let unsubBass = null;
	let stopAudio = null;
	let panelTimer = 0;
	let mo = null;
	let resizeObs = null;

	let uTimeLoc;
	let uResLoc;
	let uBassLoc;
	let uPanelsLoc;
	let uPanelCountLoc;
	let uPixelSizeLoc;

	const panelData = new Float32Array(8 * 4);
	let panelCount = 0;

	const VERT_SRC = `#version 300 es
layout(location = 0) in vec2 a_position;
void main() {
	gl_Position = vec4(a_position, 0.0, 1.0);
}`;

	const FRAG_SRC = `#version 300 es
precision highp float;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform float u_bass;
uniform vec4 u_panels[8];
uniform int u_panelCount;
uniform float u_pixelSize;

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
	mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
	for (int i = 0; i < 4; i++) {
		v += a * noise(p);
		p = rot * p * 2.07;
		a *= 0.5;
	}
	return v;
}

float sdRoundRect(vec2 p, vec2 b, float r) {
	vec2 q = abs(p) - b + vec2(r);
	return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

const float BAYER8[64] = float[](
	0.0, 32.0, 8.0, 40.0, 2.0, 34.0, 10.0, 42.0,
	48.0, 16.0, 56.0, 24.0, 50.0, 18.0, 58.0, 26.0,
	12.0, 44.0, 4.0, 36.0, 14.0, 46.0, 6.0, 38.0,
	60.0, 28.0, 52.0, 20.0, 62.0, 30.0, 54.0, 22.0,
	3.0, 35.0, 11.0, 43.0, 1.0, 33.0, 9.0, 41.0,
	51.0, 19.0, 59.0, 27.0, 49.0, 17.0, 57.0, 25.0,
	15.0, 47.0, 7.0, 39.0, 13.0, 45.0, 5.0, 37.0,
	63.0, 31.0, 55.0, 23.0, 61.0, 29.0, 53.0, 21.0
);

float bayer8(vec2 cell) {
	int x = int(mod(cell.x, 8.0));
	int y = int(mod(cell.y, 8.0));
	return BAYER8[x + y * 8] / 64.0;
}

float fluid(vec2 uv, float t, float bass) {
	float ambient = 1.0 - smoothstep(0.26, 0.40, uv.y);

	vec2 q = vec2(
		fbm(uv * 1.15 + t * 0.055),
		fbm(uv * 1.15 + vec2(5.2, 1.3) - t * 0.042)
	);
	vec2 r = vec2(
		fbm(uv + 1.65 * q + vec2(1.7, 9.2) + 0.07 * t),
		fbm(uv + 1.65 * q + vec2(8.3, 2.8) - 0.055 * t)
	);
	float f = fbm(uv + 1.85 * r);

	vec2 q2 = vec2(
		fbm(uv * 0.45 + t * 0.022),
		fbm(uv * 0.45 + vec2(3.1, 7.7) - t * 0.018)
	);
	float f2 = fbm(uv * 0.45 + 1.35 * q2);

	vec2 turntable = vec2(0.5, 0.11);
	vec2 dlt = (uv - turntable) * vec2(1.0, 1.7);
	float dist = length(dlt);
	float ripple = sin(dist * 34.0 - t * 2.2) * exp(-dist * 3.0);
	f += ripple * bass * (0.35 + 0.9 * ambient);

	return (f * 0.68 + f2 * 0.32) * (0.78 + 0.45 * ambient);
}

vec3 fieldNormal(vec2 uv, float t, float bass) {
	float e = 3.0 / u_resolution.y;
	float h = fluid(uv, t, bass);
	float hx = fluid(uv + vec2(e, 0.0), t, bass);
	float hy = fluid(uv + vec2(0.0, e), t, bass);
	return normalize(vec3(h - hx, h - hy, 0.55));
}

vec3 metal(vec2 uv, float t, float bass) {
	float f = fluid(uv, t, bass);
	vec3 n = fieldNormal(uv, t, bass);
	vec3 L = normalize(vec3(-0.55, -0.42, 0.68));
	vec3 V = vec3(0.0, 0.0, 1.0);
	vec3 H = normalize(L + V);
	float diff = max(dot(n, L), 0.0);
	float spec = pow(max(dot(n, H), 0.0), 28.0);
	float fres = pow(1.0 - abs(dot(n, V)), 3.2);

	vec3 col1 = vec3(0.018, 0.020, 0.046);
	vec3 col2 = vec3(0.22, 0.24, 0.38);
	vec3 col3 = vec3(0.93, 0.94, 1.00);
	vec3 colLav = vec3(0.66, 0.70, 0.94);

	vec3 color = mix(col1, col2, clamp(f * 0.75 + 0.12, 0.0, 1.0));
	color = mix(color, colLav, clamp(f * 0.22, 0.0, 0.35));
	color += col2 * diff * 0.28;
	color += col3 * spec * (0.85 + 0.7 * bass);
	color += vec3(0.18, 0.20, 0.36) * fres * 0.55;

	float ambient = 1.0 - smoothstep(0.26, 0.40, uv.y);
	vec2 turntable = vec2(0.5, 0.11);
	float glow = exp(-length((uv - turntable) * vec2(1.0, 1.8)) * 2.4);
	color += vec3(0.12, 0.14, 0.32) * glow * bass * (0.4 + ambient);

	return color;
}

void main() {
	float cellSize = u_pixelSize >= 4.0 ? u_pixelSize : 6.0;
	vec2 pixelCoord = floor(gl_FragCoord.xy / cellSize);
	vec2 snappedFrag = (pixelCoord + 0.5) * cellSize;
	vec2 uv = snappedFrag / u_resolution;
	float t = u_time;
	vec3 base = metal(uv, t, u_bass);

	vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);
	float best = 1e9;
	vec2 center = vec2(0.5);
	for (int i = 0; i < 8; i++) {
		if (i >= u_panelCount) break;
		vec4 p = u_panels[i];
		vec2 puv = (uv - vec2(p.x, 1.0 - p.y)) * aspect;
		float radius = 0.018;
		float d = sdRoundRect(puv, vec2(p.z, p.w) * aspect, radius);
		if (d < best) {
			best = d;
			center = vec2(p.x, 1.0 - p.y);
		}
	}

	vec3 color = base;
	float inside = clamp(-best * 48.0, 0.0, 1.0);
	float edge = 1.0 - smoothstep(0.0, 0.035, abs(best));

	if (inside > 0.001) {
		vec2 toCenter = center - uv;
		vec2 warp = uv + toCenter * 0.045;
		vec3 refracted = metal(warp, t, u_bass);

		vec2 dir = (uv - center) * aspect;
		float rl = length(dir);
		vec2 dirn = rl > 0.0001 ? dir / rl : vec2(0.0);
		vec2 off = dirn * 0.0055 * edge;

		vec3 rCh = metal(uv + off, t, u_bass);
		vec3 gCh = refracted;
		vec3 bCh = metal(uv - off, t, u_bass);
		vec3 chroma = vec3(rCh.r, gCh.g, bCh.b);

		color = mix(refracted, chroma, edge * 0.9);
		color += vec3(0.55, 0.56, 0.68) * edge * 0.12;
		color *= mix(1.0, 0.78, inside * 0.35);
	}

	vec2 centered = (snappedFrag - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
	float vig = 1.0 - length(centered) * 0.42;
	color *= vig;

	float levels = 12.0;
	float dith = bayer8(pixelCoord) * 0.04;
	vec3 quantized = floor(color * levels + dith) / levels;
	color = mix(color, quantized, 0.20);

	fragColor = vec4(color, 1.0);
}`;

	function compileShader(ctx, type, source) {
		const shader = ctx.createShader(type);
		ctx.shaderSource(shader, source);
		ctx.compileShader(shader);
		if (!ctx.getShaderParameter(shader, ctx.COMPILE_STATUS)) {
			console.error('Shader compile error:', ctx.getShaderInfoLog(shader));
			ctx.deleteShader(shader);
			return null;
		}
		return shader;
	}

	function createProgram(ctx, vertSrc, fragSrc) {
		const vs = compileShader(ctx, ctx.VERTEX_SHADER, vertSrc);
		const fs = compileShader(ctx, ctx.FRAGMENT_SHADER, fragSrc);
		if (!vs || !fs) return null;
		const prog = ctx.createProgram();
		ctx.attachShader(prog, vs);
		ctx.attachShader(prog, fs);
		ctx.linkProgram(prog);
		ctx.deleteShader(vs);
		ctx.deleteShader(fs);
		if (!ctx.getProgramParameter(prog, ctx.LINK_STATUS)) {
			console.error('Program link error:', ctx.getProgramInfoLog(prog));
			ctx.deleteProgram(prog);
			return null;
		}
		return prog;
	}

	function collectPanels() {
		if (typeof document === 'undefined') return;
		const els = document.querySelectorAll('[data-glass]');
		const c = Math.min(els.length, 8);
		panelCount = c;
		panelData.fill(0);
		const vw = window.innerWidth || 1;
		const vh = window.innerHeight || 1;
		for (let i = 0; i < c; i++) {
			const r = els[i].getBoundingClientRect();
			panelData[i * 4 + 0] = (r.left + r.width * 0.5) / vw;
			panelData[i * 4 + 1] = (r.top + r.height * 0.5) / vh;
			panelData[i * 4 + 2] = r.width * 0.5 / vw;
			panelData[i * 4 + 3] = r.height * 0.5 / vh;
		}
	}

	function schedulePanels() {
		if (panelTimer) return;
		panelTimer = window.setTimeout(() => {
			panelTimer = 0;
			collectPanels();
		}, 80);
	}

	function elapsed() {
		const now = performance.now();
		const pausedSlice = frozen && pausedAt ? now - pausedAt : 0;
		return (now - startTime - pauseAccum - pausedSlice) / 1000;
	}

	function drawFrame() {
		if (!gl || !program || destroyed) return;
		gl.viewport(0, 0, INTERNAL_W, INTERNAL_H);
		gl.uniform1f(uTimeLoc, elapsed());
		gl.uniform2f(uResLoc, INTERNAL_W, INTERNAL_H);
		gl.uniform1f(uBassLoc, bass);
		gl.uniform1i(uPanelCountLoc, panelCount);
		gl.uniform4fv(uPanelsLoc, panelData);
		gl.uniform1f(uPixelSizeLoc, readPixelSize());
		gl.drawArrays(gl.TRIANGLES, 0, 6);
	}

	function loop() {
		if (destroyed || frozen) return;
		drawFrame();
		rafId = requestAnimationFrame(loop);
	}

	function freeze() {
		if (frozen) return;
		frozen = true;
		pausedAt = performance.now();
		if (rafId) {
			cancelAnimationFrame(rafId);
			rafId = 0;
		}
		drawFrame();
		setAudioPaused(true);
	}

	function resume() {
		if (!frozen) {
			if (!rafId && !destroyed) loop();
			return;
		}
		pauseAccum += performance.now() - pausedAt;
		pausedAt = 0;
		frozen = false;
		setAudioPaused(false);
		loop();
	}

	function initGL() {
		if (!canvas) return false;
		canvas.width = INTERNAL_W;
		canvas.height = INTERNAL_H;
		const glOpts = {
			alpha: false,
			antialias: false,
			depth: false,
			stencil: false,
			powerPreference: 'low-power',
			preserveDrawingBuffer: true
		};
		gl = canvas.getContext('webgl2', glOpts);
		if (!gl) {
			console.warn('WebGL2 unavailable, liquid metal canvas disabled');
			return false;
		}

		program = createProgram(gl, VERT_SRC, FRAG_SRC);
		if (!program) return false;

		buffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(
			gl.ARRAY_BUFFER,
			new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
			gl.STATIC_DRAW
		);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
		gl.useProgram(program);

		uTimeLoc = gl.getUniformLocation(program, 'u_time');
		uResLoc = gl.getUniformLocation(program, 'u_resolution');
		uBassLoc = gl.getUniformLocation(program, 'u_bass');
		uPanelsLoc = gl.getUniformLocation(program, 'u_panels[0]');
		uPanelCountLoc = gl.getUniformLocation(program, 'u_panelCount');
		uPixelSizeLoc = gl.getUniformLocation(program, 'u_pixelSize');

		gl.disable(gl.DEPTH_TEST);
		gl.disable(gl.BLEND);
		collectPanels();
		return true;
	}

	function dispose() {
		destroyed = true;
		frozen = true;
		if (rafId) cancelAnimationFrame(rafId);
		rafId = 0;
		if (panelTimer) clearTimeout(panelTimer);
		unsubBass?.();
		stopAudio?.();
		mo?.disconnect();
		resizeObs?.disconnect();
		window.removeEventListener('resize', schedulePanels);
		if (gl) {
			if (buffer) gl.deleteBuffer(buffer);
			if (program) gl.deleteProgram(program);
			const lose = gl.getExtension('WEBGL_lose_context');
			lose?.loseContext();
		}
		gl = null;
		program = null;
		buffer = null;
	}

	$effect(() => {
		if (!gl || destroyed) return;
		if (isLowPower) freeze();
		else resume();
	});

	onMount(() => {
		destroyed = false;
		startTime = performance.now();

		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
		if (reduce.matches && canvas) canvas.style.opacity = '0.45';

		const ok = initGL();
		unsubBass = bassStore.subscribe((v) => {
			bass = v;
		});
		stopAudio = startAudioReactive();

		window.addEventListener('resize', schedulePanels, { passive: true });
		const root = document.querySelector('.display-root') || document.body;
		mo = new MutationObserver(schedulePanels);
		mo.observe(root, { subtree: true, childList: true });
		resizeObs = new ResizeObserver(schedulePanels);
		resizeObs.observe(root);

		if (ok && !isLowPower && !reduce.matches) loop();
		else if (ok) drawFrame();

		return dispose;
	});
</script>

<canvas
	bind:this={canvas}
	id="liquid-metal"
	width={INTERNAL_W}
	height={INTERNAL_H}
	aria-hidden="true"
></canvas>

<style>
	canvas {
		position: fixed;
		inset: 0;
		width: 100vw;
		height: 100vh;
		pointer-events: none;
		z-index: 0;
		image-rendering: pixelated;
		image-rendering: crisp-edges;
		background: var(--background);
	}
</style>
