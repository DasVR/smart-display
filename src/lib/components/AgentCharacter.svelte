<!--
	One agent as a pixel character (src/lib/agentSprites.js), on one canvas.

	Tell it where to be (`target`: work | ask | idle) and, after an answer, how
	it took it (`verdict`: yes | no, with a `verdictKey` that changes per
	answer). It finds the way there: sitting at the laptop to standing goes
	through "close" (lid shut, stretch, land), standing to work through
	"open". One-off states play once; loops keep going.

	Pixel-perfect: each art pixel is a whole number of device pixels, smoothing
	off, and the canvas is shown at exactly its own size, never stretched.
	Reduced motion shows each state's resting frame and skips the in-betweens.
-->
<script>
	import { onMount } from 'svelte';
	import { GRID, STATES, framesFor, pathTo, pixelScale, renderFrame } from '$lib/agentSprites.js';

	let { character = 'claude', target = 'work', verdict = null, verdictKey = 0, size = 176, paused = false, label = '' } = $props();

	let canvas = $state(null);
	let px = 1;
	let current = 'idle';
	let queue = [];
	let frames = [];
	let i = 0;
	let until = 0;
	let raf = 0;
	let lastVerdictKey = 0;
	const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

	function fit() {
		if (!canvas) return;
		const dpr = window.devicePixelRatio || 1;
		px = pixelScale(size, dpr);
		canvas.width = GRID.W * px;
		canvas.height = GRID.H * px;
		canvas.style.width = `${(GRID.W * px) / dpr}px`;
		canvas.style.height = `${(GRID.H * px) / dpr}px`;
		paint(performance.now());
	}

	function start(state, now = performance.now()) {
		current = state;
		frames = framesFor(character, state);
		i = reduce ? Math.max(0, frames.length - 1) : 0;
		until = now + (frames[i]?.ms ?? 0);
	}

	/** Head for `state` through whatever has to happen first. */
	function go(state) {
		const path = pathTo(current, state);
		queue = reduce ? [] : path.slice(1);
		start(reduce ? path.at(-1) : path[0]);
	}

	function paint(t) {
		if (!canvas || !frames.length) return;
		const ctx = canvas.getContext('2d');
		ctx.imageSmoothingEnabled = false;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		for (const p of renderFrame(character, frames[i], t)) {
			ctx.globalAlpha = p.alpha ?? 1;
			ctx.fillStyle = p.color;
			ctx.fillRect(p.x * px, p.y * px, px, px);
		}
		ctx.globalAlpha = 1;
	}

	function tick(t) {
		raf = requestAnimationFrame(tick);
		if (paused || !frames.length) return;
		if (!reduce && t >= until) {
			if (i < frames.length - 1) {
				i += 1;
				until = t + frames[i].ms;
			} else if (queue.length) {
				start(queue.shift(), t);
			} else if (STATES[current]?.loop) {
				i = 0;
				until = t + frames[0].ms;
			} else {
				// a one-off that ended without a next step: head back to where we're meant to be
				if (current !== target) go(target);
				else until = t + 1e9;
			}
		}
		paint(t);
	}

	// where it should be
	$effect(() => {
		const want = target;
		if (verdictKey && verdictKey !== lastVerdictKey) return; // a verdict plays first, below
		// a hop or a slump is never cut short: the new target waits for it
		if (current === 'yes' || current === 'no') {
			queue = reduce ? [] : pathTo(current, want);
			return;
		}
		if (want !== current && !queue.includes(want)) go(want);
	});
	// how it took an answer: play it, then carry on to the target
	$effect(() => {
		if (!verdictKey || verdictKey === lastVerdictKey || !verdict) return;
		lastVerdictKey = verdictKey;
		const after = pathTo(verdict, target);
		queue = reduce ? [] : after.filter((s) => s !== verdict);
		start(reduce ? target : verdict);
	});
	// the character or the size changed: redraw at the new scale
	$effect(() => {
		character;
		size;
		frames = framesFor(character, current);
		i = Math.min(i, Math.max(0, frames.length - 1));
		fit();
	});

	onMount(() => {
		start(target === 'work' ? 'work' : target);
		fit();
		raf = requestAnimationFrame(tick);
		const onResize = () => fit();
		window.addEventListener('resize', onResize);
		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener('resize', onResize);
		};
	});
</script>

<canvas bind:this={canvas} class="agent-character" aria-label={label}>{label}</canvas>

<style>
	.agent-character {
		display: block;
		image-rendering: pixelated;
		image-rendering: crisp-edges;
	}
</style>
