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
	let uTimeLoc, uResLoc, uBassLoc, uPanelsLoc, uPanelCountLoc;

	// ---- DOM glass panel rects (read live, passed to shader as panels) ----
	// array of vec4: [cx, cy, halfW, halfH] in UV (0..1) space. synced to the DOM
	let panelData = new Float32Array(8 * 4);
	let panelCount = 0;

	function collectPanels() {
		// panels live in the current view; the shader bends the liquid behind them
		const els = document.querySelectorAll('.glass-panel, .panel');
		const c = Math.min(els.length, 8);
		panelCount = c;
		panelData.fill(0);
		for (let i = 0; i < c; i++) {
			const el = els[i];
			const r = el.getBoundingClientRect();
			// convert to UV 0..1 (same space as v_uv)
			panelData[i * 4 + 0] = r.left / window.innerWidth + (r.width / 2) / window.innerWidth;
			panelData[i * 4 + 1] = r.top / window.innerHeight + (r.height / 2) / window.innerHeight;
			panelData[i * 4 + 2] = (r.width / 2) / window.innerWidth;
			panelData[i * 4 + 3] = (r.height / 2) / window.innerHeight;
		}
	}

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
		uniform float u_bass;           // 0..1 smoothed bass energy
		uniform vec4 u_panels[8];       // [cx, cy, halfW, halfH] in UV space
		uniform int u_panelCount;

		// ---------- hash / noise / fbm ----------
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

		// ---------- LIQUID METAL field ----------
		// domain-warped FBM, slowed way down for heavy viscosity, plus a
		// fresnel-ish banding pass so the highs read as polished metal.
		float fluid(vec2 uv, float t, float bass) {
			// heavy, dense flow: base speed dropped ~40% vs the original
			vec2 q = vec2(fbm(uv + t * 0.07), fbm(uv + vec2(5.2, 1.3) - t * 0.055));
			vec2 r = vec2(
				fbm(uv + 1.7 * q + vec2(1.7, 9.2) + 0.09 * t),
				fbm(uv + 1.7 * q + vec2(8.3, 2.8) - 0.07 * t)
			);
			float f = fbm(uv + 1.9 * r);

			// second, slower large-scale layer for depth
			vec2 q2 = vec2(fbm(uv * 0.5 + t * 0.03), fbm(uv * 0.5 + vec2(3.1, 7.7) - t * 0.025));
			float f2 = fbm(uv * 0.5 + 1.4 * q2);

			// bass ripple from center
			vec2 centered = uv - 0.5;
			float dist = length(centered);
			float ripple = sin(dist * 40.0 - t * 1.8) * exp(-dist * 4.0);
			f += ripple * bass * 0.6;

			return f * 0.7 + f2 * 0.3;
		}

		// field gradient via finite differences -> cheap surface normals
		vec3 fieldNormal(vec2 uv, float t, float bass) {
			float e = 4.0 / u_resolution.y; // ~1px in screen space
			float h = fluid(uv, t, bass);
			float hx = fluid(uv + vec2(e, 0.0), t, bass);
			float hy = fluid(uv + vec2(0.0, e), t, bass);
			// convert height gradient to a normal; normalize-ish cheaply
			vec3 n = normalize(vec3(h - hx, h - hy, 0.6));
			return normalize(vec3(n.x, n.y, 1.0));
		}

		// ---------- rounded-rect SDF ----------
		float sdRoundRect(vec2 p, vec2 b, float r) {
			vec2 q = abs(p) - b + vec2(r);
			return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
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

		// sample the raw liquid metal background at a warped uv
		vec3 metal(vec2 uv, float t, float bass, float ditherScale) {
			float f = fluid(uv, t, bass);
			// normals + lighting: silver/chrome spec highlight on wave peaks,
			// deep shadow in the valleys
			vec3 n = fieldNormal(uv, t, bass);
			// key light from upper-left
			vec3 L = normalize(vec3(-0.6, -0.5, 0.62));
			float diff = max(dot(n, L), 0.0);
			// specular (Blinn-ish, cheap)
			vec3 V = vec3(0.0, 0.0, 1.0);
			vec3 H = normalize(L + V);
			float spec = pow(max(dot(n, H), 0.0), 24.0);

			// cool chrome ramp: deep violet base -> lavender sheen -> near-white hot
			vec3 col1 = vec3(0.012, 0.012, 0.040);   // base valley
			vec3 col2 = vec3(0.18, 0.20, 0.40);      // wave body
			vec3 col3 = vec3(0.92, 0.92, 1.0);       // specular hot point

			vec3 color = mix(col1, col2, clamp(f * 0.7 + 0.15, 0.0, 1.0));
			color += col2 * diff * 0.30;             // diffuse lift
			color += col3 * spec * (0.9 + 0.6 * u_bass); // specular catches light

			// fresnel: edges of the field pick up more reflected light (polished look)
			float fres = pow(1.0 - abs(dot(n, V)), 3.0);
			color += vec3(0.16, 0.18, 0.34) * fres * 0.5;

			// bass glow toward center
			vec2 centered = uv - 0.5;
			color += vec3(0.10, 0.12, 0.28) * exp(-length(centered) * 2.2) * u_bass * 0.5;

			// dither to kill banding in the gradients
			float d = bayerDither(uv * ditherScale, 8.0);
			color = mix(color, color * 1.16, d * 0.32);
			return color;
		}

		void main() {
			vec2 uv = v_uv;
			vec2 centered = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
			float t = u_time * 0.001; // seconds

			float ditherScale = 96.0 + 48.0 * sin(t * 0.4);
			vec3 base = metal(uv, t, u_bass, ditherScale);

			// ---------- LIQUID GLASS via SDF ----------
			// find the strongest enclosing panel; inside we magnify (refract)
			// the metal, at the edge we break R/G/B apart for chromatic fringing.
			vec3 glass = base;       // default: untouched background
			vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);
			float best = 1e9;
			vec2 center = vec2(-1.0);
			vec2 halfSize = vec2(-1.0);
			for (int i = 0; i < 8; i++) {
				if (i >= u_panelCount) break;
				vec4 p = u_panels[i];
				vec2 puv = (uv - vec2(p.x, p.y)) * aspect; // uv relative to panel center, aspect-corrected
				float d = sdRoundRect(puv, vec2(p.z, p.w) * aspect, 0.02 * u_resolution.y / min(u_resolution.x, u_resolution.y));
				if (d < best) { best = d; center = vec2(p.x, p.y); halfSize = vec2(p.z, p.w); }
			}

			float inside = clamp(-best * 40.0, 0.0, 1.0);      // 1 inside panel, 0 just outside
			float edge = clamp((best * 40.0 + 0.5), 0.0, 1.0);  // near 1 exactly on the border

			if (inside > 0.001) {
				// 1) refraction: magnify the metal behind the glass by pulling
				//    the sample toward the panel center (lens effect)
				vec2 toCenter = center - uv;
				vec2 warp = uv + toCenter * 0.03;
				vec3 refract = metal(warp, t, u_bass, ditherScale);

				// 2) edge-only chromatic aberration: sample 3 wavelengths with
				//    tiny radial offsets, strongest right at the border
				float fringe = edge;
				vec2 dir = (uv - center) * aspect;
				float rl = length(dir);
				vec2 dirn = (rl > 0.0001) ? dir / rl : vec2(0.0);
				vec2 off = dirn * 0.004 * fringe;

				vec3 r_ch = metal(uv + off * vec2(1.0, 0.0), t, u_bass, ditherScale);
				vec3 g_ch = metal(uv, t, u_bass, ditherScale);
				vec3 b_ch = metal(uv - off * vec2(1.0, 0.0), t, u_bass, ditherScale);

				// mix refracted body with the wavelength-split edge
				vec3 chroma = vec3(r_ch.r, g_ch.g, b_ch.b);
				glass = mix(refract, chroma, fringe * 0.85);

				// soft internal specular sweep near the top edge looks like glass
				float sweep = clamp(1.0 - abs(dirn.y) * 0.0 + 0.0, 0.0, 1.0);
				float topGlow = clamp(best * 10.0 + 0.5, 0.0, 1.0); // bright just at rim
				glass += vec3(0.5, 0.5, 0.6) * topGlow * 0.10;
			}

			vec3 color = glass;

			// vignette
			float vig = 1.0 - length(centered) * 0.5;
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
		uPanelsLoc = gl.getUniformLocation(program, 'u_panels[0]');
		uPanelCountLoc = gl.getUniformLocation(program, 'u_panelCount');

		collectPanels();
		resize();
		render();
	}

	function render() {
		if (destroyed) return;
		const elapsed = performance.now() - startTime;

		gl.uniform1f(uTimeLoc, elapsed);
		gl.uniform2f(uResLoc, canvas.width, canvas.height);
		gl.uniform1f(uBassLoc, bassLevel);
		gl.uniform1i(uPanelCountLoc, panelCount);
		gl.uniform4fv(uPanelsLoc, panelData);

		gl.drawArrays(gl.TRIANGLES, 0, 6);
		rafId = requestAnimationFrame(render);
	}

	function resize() {
		if (!canvas || !gl) return;
		const dpr = Math.min(window.devicePixelRatio || 1, 1.5); // cap DPR to save iGPU
		canvas.width = canvas.clientWidth * dpr;
		canvas.height = canvas.clientHeight * dpr;
		gl.viewport(0, 0, canvas.width, canvas.height);
		collectPanels();
	}

	// ---------- Web Audio: bass-reactive ----------
	function initAudio() {
		try {
			audioCtx = new (window.AudioContext || window.webkitAudioContext)();
			analyser = audioCtx.createAnalyser();
			analyser.fftSize = 256;
			analyser.smoothingTimeConstant = 0.8;
			audioData = new Uint8Array(analyser.frequencyBinCount);

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
			let sum = 0;
			const bins = Math.min(12, audioData.length);
			for (let i = 0; i < bins; i++) sum += audioData[i];
			const avg = sum / bins / 255;
			bassLevel += (avg - bassLevel) * 0.15;
		} else {
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
		// re-collect panels when the view changes (panels differ per view)
		const reobserve = () => collectPanels();
		const mo = new MutationObserver(reobserve);
		if (canvas) mo.observe(document.querySelector('.display-root'), { subtree: true, childList: true });
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
		opacity: 0.18;
		mix-blend-mode: screen;
	}
</style>
