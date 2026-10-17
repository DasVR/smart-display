/**
 * The voice orb: one fragment shader behind the voice sheet.
 *
 * A soft liquid orb on a rising aurora, drawn in the wall's own palette
 * (brand lavender, scan teal, solve gold, warn clay, read from the CSS
 * tokens). It follows the voice:
 *
 *   listening  the rim ripples with the level of your voice; the orb swells
 *   thinking   it draws in and swirls, warm gold
 *   speaking   it breathes out in time with the words, teal
 *   error      it dims to clay and goes still
 *
 * Everything is one pass, no textures; a few ordered-dither bits at the end
 * keep the gradients from banding on an OLED. The canvas draws at about
 * three quarters of its pixel size (it is all soft edges), pauses when
 * stopped, and the caller falls back to a CSS orb when WebGL isn't there.
 *
 *   const orb = createOrb(canvas);   // null without WebGL
 *   orb.setPhase('listening'); orb.setLevel(0.4); orb.start(); ... orb.destroy();
 */

import { followLevel } from '../voiceAgent.js';

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uLevel;
uniform vec4 uMix;      // listening, thinking, speaking, error
uniform vec2 uCenter;   // orb centre, 0..1 from bottom-left
uniform float uRise;    // 0..1, how far the sheet has come up (aurora fade-in)
uniform vec3 uBrand;
uniform vec3 uScan;
uniform vec3 uSolve;
uniform vec3 uWarn;

float hash(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}
float noise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
	           mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
	float v = 0.0, a = 0.5;
	for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
	return v;
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

void main() {
	vec2 frag = gl_FragCoord.xy;
	float m = min(uRes.x, uRes.y);
	vec2 uv = frag / uRes;
	vec2 p = (frag - uCenter * uRes) / m;
	float r = length(p);
	float a = atan(p.y, p.x);

	float listen = uMix.x, think = uMix.y, speak = uMix.z, err = uMix.w;
	float active = clamp(listen + speak, 0.0, 1.0);
	float t = uTime;

	// speech energy: the real level while listening, a soft pulse while speaking
	float talk = uLevel;
	float lvl = mix(talk, 0.35 + 0.25 * sin(t * 7.0) * sin(t * 3.1), speak * 0.7);

	// the orb's edge: a circle pushed around by noise that moves faster with the voice
	float spin = mix(0.35, 1.7, think);
	vec2 dir = vec2(cos(a), sin(a));
	float wob = fbm(dir * 1.6 + vec2(t * 0.35 * spin, -t * 0.27)) - 0.5;
	float R = 0.215
		+ 0.045 * lvl
		+ 0.012 * sin(t * 1.3)
		- 0.05 * think
		- 0.035 * err;
	R += wob * (0.05 + 0.13 * lvl) * (1.0 - err * 0.8);
	float d = r - R;

	// inside: two warped noise fields mixed through the palette
	vec2 q = p * rot(t * 0.12 * spin) * 3.0;
	float w1 = fbm(q + vec2(t * 0.20, 0.0) + 2.0 * fbm(q * 0.8 - t * 0.1));
	float w2 = fbm(q * 1.3 + 4.0 - vec2(0.0, t * 0.17 * spin));
	vec3 base = mix(uBrand, uScan, smoothstep(0.25, 0.75, w1));
	base = mix(base, uSolve, smoothstep(0.55, 0.9, w2) * (0.25 + 0.55 * think));
	base = mix(base, uScan, speak * 0.45);
	base = mix(base, uSolve, think * 0.7);
	base = mix(base, uWarn * 0.7, err);
	float body = smoothstep(0.012, -0.012, d);

	// a lit rim and a soft highlight so it reads as glass, not a flat disc
	float rim = smoothstep(-0.07, 0.0, d) * body;
	vec2 hl = (p - vec2(-0.07, 0.085)) / 0.11;
	float spec = exp(-dot(hl, hl)) * 0.55;
	vec3 col = base * (0.62 + 0.55 * (1.0 - r / max(R, 0.01)));
	col += rim * 0.42 * mix(uBrand, vec3(1.0), 0.55 - 0.3 * think);
	col += spec * body * (1.0 - 0.5 * think);
	col *= mix(1.0, 0.55, err);

	// outside: bloom around the orb, strongest with the voice
	float bloomK = mix(5.5, 3.2, lvl);
	float bloom = exp(-max(d, 0.0) * bloomK) * (0.34 + 0.4 * lvl) * (1.0 - body);
	vec3 bloomCol = mix(mix(uBrand, uScan, 0.4 + 0.3 * sin(a * 2.0 + t * 0.6)), uSolve, think * 0.7);
	bloomCol = mix(bloomCol, uWarn, err);

	// the aurora under the sheet: slow bands rising from the bottom edge
	float band = fbm(vec2(uv.x * 2.2 + t * 0.05, uv.y * 1.6 - t * 0.06));
	float aur = smoothstep(0.62, 0.0, uv.y) * smoothstep(0.25, 0.8, band) * 0.5 * uRise;
	aur *= 0.55 + 0.45 * active + 0.25 * lvl;
	vec3 aurCol = mix(uBrand, uScan, uv.x * 0.8 + 0.1 * sin(t * 0.2));
	aurCol = mix(aurCol, uSolve, think * 0.6);
	aurCol = mix(aurCol, uWarn, err);

	vec3 rgb = col * body + bloomCol * bloom + aurCol * aur;
	float alpha = clamp(body + bloom + aur, 0.0, 1.0);

	// ordered dither, one 8-bit step wide
	float dith = (hash(frag + fract(t)) - 0.5) / 255.0;
	gl_FragColor = vec4(rgb + dith * alpha, alpha);
}
`;

/** '#a9b1f0' or 'rgb(…)' → [r, g, b] in 0..1 */
export function parseColor(text, fallback = [0.66, 0.69, 0.94]) {
	const s = String(text || '').trim();
	let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
	if (m) {
		const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
		return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
	}
	m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(s);
	if (m) return [m[1], m[2], m[3]].map((n) => Number(n) / 255);
	return fallback;
}

const PHASE_INDEX = { listening: 0, thinking: 1, speaking: 2, error: 3 };

function compile(gl, type, src) {
	const sh = gl.createShader(type);
	gl.shaderSource(sh, src);
	gl.compileShader(sh);
	if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
		const log = gl.getShaderInfoLog(sh);
		gl.deleteShader(sh);
		throw new Error(log || 'shader failed');
	}
	return sh;
}

export function createOrb(canvas, { scale = 0.75 } = {}) {
	let gl;
	try {
		gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'low-power' });
		if (!gl) return null;
	} catch {
		return null;
	}

	let program;
	try {
		program = gl.createProgram();
		gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
		gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
	} catch {
		return null;
	}
	gl.useProgram(program);

	const buf = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, buf);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
	const aPos = gl.getAttribLocation(program, 'aPos');
	gl.enableVertexAttribArray(aPos);
	gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

	const U = Object.fromEntries(['uRes', 'uTime', 'uLevel', 'uMix', 'uCenter', 'uRise', 'uBrand', 'uScan', 'uSolve', 'uWarn'].map((n) => [n, gl.getUniformLocation(program, n)]));

	const css = getComputedStyle(document.documentElement);
	const token = (name) => parseColor(css.getPropertyValue(name));
	gl.uniform3fv(U.uBrand, token('--brand'));
	gl.uniform3fv(U.uScan, token('--scan'));
	gl.uniform3fv(U.uSolve, token('--solve'));
	gl.uniform3fv(U.uWarn, token('--warn'));
	gl.clearColor(0, 0, 0, 0);

	let raf = 0;
	let running = false;
	let last = 0;
	let time = 0;
	let level = 0;
	let targetLevel = 0;
	let rise = 0;
	let targetRise = 0;
	let center = [0.5, 0.58];
	const mix = [1, 0, 0, 0];
	let phase = 'listening';
	let width = 1;
	let height = 1;
	let still = false;
	let levelSource = null;

	function resize(w, h, dpr = 1) {
		const k = Math.min(dpr, 2) * scale;
		width = Math.max(2, Math.round(w * k));
		height = Math.max(2, Math.round(h * k));
		if (canvas.width !== width || canvas.height !== height) {
			canvas.width = width;
			canvas.height = height;
		}
		gl.viewport(0, 0, width, height);
		draw();
	}

	function draw() {
		gl.clear(gl.COLOR_BUFFER_BIT);
		gl.uniform2f(U.uRes, width, height);
		gl.uniform1f(U.uTime, time);
		gl.uniform1f(U.uLevel, level);
		gl.uniform4f(U.uMix, mix[0], mix[1], mix[2], mix[3]);
		gl.uniform2f(U.uCenter, center[0], center[1]);
		gl.uniform1f(U.uRise, rise);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
	}

	function frame(now) {
		raf = requestAnimationFrame(frame);
		const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
		last = now;
		time += still ? 0 : dt;
		if (levelSource) targetLevel = Math.max(targetLevel, levelSource());
		level = followLevel(level, targetLevel, dt);
		// the target decays on its own so a one-off pulse (a word) rings out
		targetLevel *= Math.exp(-dt * 4.5);
		rise += (targetRise - rise) * (1 - Math.exp(-dt * 5));
		const want = PHASE_INDEX[phase] ?? 0;
		for (let i = 0; i < 4; i++) mix[i] += ((i === want ? 1 : 0) - mix[i]) * (1 - Math.exp(-dt * 7));
		draw();
	}

	return {
		resize,
		setPhase(p) {
			phase = p in PHASE_INDEX ? p : 'listening';
		},
		/** 0..1; held while the source keeps sending, ringing out after */
		setLevel(v) {
			targetLevel = Math.max(targetLevel * 0.6, Math.max(0, Math.min(1, v)));
		},
		/** a function read every frame for the live level (the mic meter) */
		setLevelSource(fn) {
			levelSource = fn;
		},
		setRise(v) {
			targetRise = v;
		},
		/** where the orb sits, as a share of the canvas from its bottom-left */
		setCenter(x, y) {
			center = [x, y];
		},
		/** reduced motion: draw frames but hold the clock */
		setStill(v) {
			still = Boolean(v);
		},
		start() {
			if (running) return;
			running = true;
			last = performance.now();
			raf = requestAnimationFrame(frame);
		},
		stop() {
			running = false;
			cancelAnimationFrame(raf);
		},
		destroy() {
			running = false;
			cancelAnimationFrame(raf);
			gl.getExtension('WEBGL_lose_context')?.loseContext();
		}
	};
}
