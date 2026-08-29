<script>
	import { onMount, onDestroy } from 'svelte';

	let canvas;
	let gl;
	let program;
	let startTime = performance.now();
	let rafId;
	let destroyed = false;

	// ---- Web Audio state ----
	let audioCtx = null;
	let analyser = null;
	let audioData = null;
	let bassLevel = 0; // smoothed 0..1
	let audioEnabled = false;

	// ---- uniforms ----
	let uTimeLoc, uResLoc, uBassLoc;

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
		uniform float u_bass;   // 0..1 smoothed bass energy

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

		// ---------- domain-warped fluid field ----------
		// returns a smooth 0..1 "liquid" value that flows and ripples
		float fluid(vec2 uv, float t, float bass) {
			// slow base flow
			vec2 q = vec2(fbm(uv + t * 0.12), fbm(uv + vec2(5.2, 1.3) - t * 0.09));
			// domain warp (the "liquid metal" feel)
			vec2 r = vec2(
				fbm(uv + 1.7 * q + vec2(1.7, 9.2) + 0.15 * t),
				fbm(uv + 1.7 * q + vec2(8.3, 2.8) - 0.12 * t)
			);
			float f = fbm(uv + 1.9 * r);

			// bass ripple: radial wave from center, amplitude = bass
			vec2 centered = uv - 0.5;
			float dist = length(centered);
			float ripple = sin(dist * 40.0 - t * 3.0) * exp(-dist * 4.0);
			f += ripple * bass * 0.6;

			return f;
		}

		// ---------- Bayer 4x4 ordered dither (valid GLSL ES 1.0) ----------
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

		void main() {
			vec2 uv = v_uv;
			vec2 centered = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
			float t = u_time * 0.001; // seconds

			// fluid field (bass-reactive)
			float f = fluid(uv, t, u_bass);

			// color: abyss -> lavender, bass brightens toward center
			vec3 col1 = vec3(0.02, 0.02, 0.05);
			vec3 col2 = vec3(0.30, 0.30, 0.55);
			vec3 color = mix(col1, col2, clamp(f * 0.6 + 0.25 + u_bass * 0.15, 0.0, 1.0));

			// dither post-process baked into fragment step
			float ditherScale = 96.0 + 48.0 * sin(t * 0.4);
			float d = bayerDither(uv * ditherScale, 8.0);
			color = mix(color, color * 1.18, d * 0.35);

			// vignette
			float vig = 1.0 - length(centered) * 0.55;
			color *= vig;

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
		gl = canvas.getContext('webgl', { alpha: true, antialias: false, powerPreference: 'low-power' });
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
		uTimeLoc = gl.getUniformLocation(program, 'u_time');
		uResLoc = gl.getUniformLocation(program, 'u_resolution');
		uBassLoc = gl.getUniformLocation(program, 'u_bass');

		resize();
		render();
	}

	function render() {
		if (destroyed) return;
		const elapsed = performance.now() - startTime;

		gl.uniform1f(uTimeLoc, elapsed);
		gl.uniform2f(uResLoc, canvas.width, canvas.height);
		gl.uniform1f(uBassLoc, bassLevel);
		gl.drawArrays(gl.TRIANGLES, 0, 6);

		rafId = requestAnimationFrame(render);
	}

	function resize() {
		if (!canvas || !gl) return;
		const dpr = Math.min(window.devicePixelRatio || 1, 1.5); // cap DPR to save iGPU
		canvas.width = canvas.clientWidth * dpr;
		canvas.height = canvas.clientHeight * dpr;
		gl.viewport(0, 0, canvas.width, canvas.height);
	}

	// ---------- Web Audio: bass-reactive ----------
	function initAudio() {
		try {
			audioCtx = new (window.AudioContext || window.webkitAudioContext)();
			analyser = audioCtx.createAnalyser();
			analyser.fftSize = 256;
			analyser.smoothingTimeConstant = 0.8;
			audioData = new Uint8Array(analyser.frequencyBinCount);

			// create a silent source so the analyser has data even before real audio
			const source = audioCtx.createBufferSource();
			const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate, audioCtx.sampleRate);
			source.buffer = buffer;
			source.loop = true;
			source.connect(analyser);
			source.start();

			audioEnabled = true;
		} catch (e) {
			console.warn('Web Audio unavailable:', e);
			audioEnabled = false;
		}
	}

	function pollBass() {
		if (destroyed) return;
		if (audioEnabled && analyser && audioData) {
			analyser.getByteFrequencyData(audioData);
			// average the low bins (sub-bass + bass, roughly 0-120Hz of 256-bin FFT)
			let sum = 0;
			const bins = Math.min(12, audioData.length);
			for (let i = 0; i < bins; i++) sum += audioData[i];
			const avg = sum / bins / 255; // 0..1
			// smooth toward target
			bassLevel += (avg - bassLevel) * 0.15;
		} else {
			// no audio: gentle idle breathing so it's never dead
			bassLevel = 0.15 + 0.1 * Math.sin(performance.now() * 0.0004);
		}
		requestAnimationFrame(pollBass);
	}

	onMount(() => {
		const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
		if (mediaQuery.matches) {
			canvas.style.display = 'none';
			return;
		}
		initGL();
		initAudio();
		pollBass();
		window.addEventListener('resize', resize);
	});

	onDestroy(() => {
		destroyed = true;
		if (rafId) cancelAnimationFrame(rafId);
		if (gl && program) gl.deleteProgram(program);
		if (audioCtx) audioCtx.close();
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
		opacity: 0.05;
		mix-blend-mode: screen;
	}
</style>
