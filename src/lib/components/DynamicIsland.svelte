<script>
	import { fly, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';

	let {
		nowPlaying = null,
		notification = { visible: false, title: '', body: '', kind: 'info' },
		gpuLowPower = false,
		ollamaStatus = 'idle',
		weatherData = null
	} = $props();

	let reducedMotion = $state(false);
	$effect(() => {
		if (typeof window === 'undefined') return;
		const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
		reducedMotion = mq.matches;
		const onChange = (e) => {
			reducedMotion = e.matches;
		};
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	});

	function inFly() {
		return reducedMotion ? { duration: 0 } : { y: -8, duration: 260, easing: cubicOut };
	}
	function outFade() {
		return reducedMotion ? { duration: 0 } : { duration: 140 };
	}

	let mode = $derived.by(() => {
		if (notification?.visible) return 'alert';
		if (weatherData?.alerts?.length) return 'weather';
		if (weatherData?.prediction?.rain60min >= 0.35) return 'weather';
		if (nowPlaying?.playing) return 'nowplaying';
		return 'idle';
	});

	let weatherWord = $derived.by(() => {
		const alerts = weatherData?.alerts || [];
		if (alerts.length) return 'Weather alert';
		const p = weatherData?.prediction || {};
		if (p.rain30min >= 0.6) return 'Rain in 30 min';
		if (p.rain60min >= 0.6) return 'Rain in an hour';
		if (p.rain120min >= 0.6) return 'Rain in 2 hours';
		return 'Clear skies';
	});

	let statusWord = $derived.by(() => {
		if (gpuLowPower) return 'Power saving';
		if (ollamaStatus === 'inferring') return 'Thinking';
		return 'All good';
	});

	function modeLabel(next) {
		switch (next) {
			case 'idle':
				return statusWord;
			case 'nowplaying':
				return 'Now playing';
			case 'alert':
				return notification?.kind === 'warn' ? 'Alert' : 'Notice';
			case 'weather':
				return weatherWord;
			default: {
				const _exhaustive = next;
				return _exhaustive;
			}
		}
	}

	// The pill is one persistent capsule that spring-morphs its own bounds
	// (like iOS's Dynamic Island) rather than being swapped out per mode.
	// A hidden "ghost" copy of the current content is measured to drive the
	// capsule's target width/height, independent of whatever is mid-crossfade
	// in the visible layer on top of it.
	let ghostEl = $state(null);
	let pillSize = $state({ w: 0, h: 0 });
	let ready = $state(false);
	let morphing = $state(false);
	let morphTimer = 0;

	function measure() {
		if (!ghostEl) return;
		const r = ghostEl.getBoundingClientRect();
		if (!r.width || !r.height) return;
		const w = Math.round(r.width);
		const h = Math.round(r.height);
		if (w === Math.round(pillSize.w) && h === Math.round(pillSize.h)) return;
		pillSize = { w, h };
		if (!ready) {
			ready = true;
			return;
		}
		if (!reducedMotion) {
			morphing = true;
			clearTimeout(morphTimer);
			morphTimer = setTimeout(() => {
				morphing = false;
			}, 560);
		}
	}

	$effect(() => {
		if (typeof window === 'undefined' || !ghostEl) return;
		const ro = new ResizeObserver(measure);
		ro.observe(ghostEl);
		measure();
		return () => {
			ro.disconnect();
			clearTimeout(morphTimer);
		};
	});
</script>

{#snippet islandContent(m)}
	{#if m === 'nowplaying'}
		<div class="slip">
			<div class="copy">
				<div class="kicker">{modeLabel(m)}</div>
				<div class="title">{nowPlaying?.title || 'Untitled'}</div>
				<div class="sub">{nowPlaying?.artist || ''}</div>
			</div>
		</div>
	{:else if m === 'alert'}
		<div class="slip">
			<div class="copy">
				<div class="kicker">{modeLabel(m)}</div>
				<div class="title">{notification.title}</div>
				<div class="sub">{notification.body}</div>
			</div>
		</div>
	{:else}
		<div
			class="chip"
			class:hot={gpuLowPower}
			class:busy={ollamaStatus === 'inferring'}
			class:weather={m === 'weather'}
		>
			<span class="dot" aria-hidden="true"></span>
			<span class="word">{modeLabel(m)}</span>
		</div>
	{/if}
{/snippet}

<svg width="0" height="0" style="position:absolute" aria-hidden="true">
	<defs>
		<filter id="island-goo" x="-60%" y="-60%" width="220%" height="220%">
			<feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
			<feColorMatrix
				in="blur"
				mode="matrix"
				values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -10"
				result="goo"
			/>
			<feBlend in="SourceGraphic" in2="goo" />
		</filter>
	</defs>
</svg>

<div class="island" data-mode={mode}>
	<div
		class="island-pill"
		class:ready
		class:morphing
		data-glass
		style="--pill-w: {pillSize.w}px; --pill-h: {pillSize.h}px"
	>
		<div class="island-ghost" bind:this={ghostEl} aria-hidden="true">
			{@render islandContent(mode)}
		</div>
		<div class="island-visible">
			{#key mode}
				<div in:fly={inFly()} out:fade={outFade()}>
					{@render islandContent(mode)}
				</div>
			{/key}
		</div>
	</div>
</div>

<style>
	.island {
		min-width: 0;
		flex-shrink: 0;
	}
	.island-pill {
		position: relative;
		isolation: isolate;
		width: var(--pill-w, auto);
		height: var(--pill-h, auto);
		border-radius: 999px;
		background: color-mix(in srgb, var(--abyss) 90%, transparent);
		border: 1px solid var(--glass-edge);
		border-top-color: var(--glass-specular);
		box-shadow:
			var(--glass-depth),
			0 6px 22px color-mix(in srgb, var(--abyss) 65%, transparent);
		backdrop-filter: blur(20px) saturate(1.3);
		-webkit-backdrop-filter: blur(20px) saturate(1.3);
		overflow: hidden;
		opacity: 0;
	}
	.island-pill.ready {
		opacity: 1;
	}
	.island-pill.morphing {
		filter: url(#island-goo);
	}
	@media (prefers-reduced-motion: no-preference) {
		.island-pill.ready {
			transition:
				width 560ms var(--spring-bouncy),
				height 560ms var(--spring-bouncy),
				opacity 240ms var(--spring-smooth);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.island-pill.ready {
			transition: opacity 240ms var(--spring-smooth);
		}
	}
	.island-ghost {
		position: absolute;
		top: 0;
		left: 0;
		width: max-content;
		height: max-content;
		visibility: hidden;
		pointer-events: none;
		white-space: nowrap;
	}
	.island-visible {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		overflow: hidden;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2.75rem;
		padding: 0 var(--space-5);
		color: var(--ok);
	}
	.dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--ok);
		box-shadow: 0 0 10px color-mix(in srgb, var(--ok) 70%, transparent);
		flex-shrink: 0;
		transform-origin: center;
	}
	.chip.busy .dot {
		background: var(--brand);
		box-shadow: 0 0 10px color-mix(in srgb, var(--brand) 70%, transparent);
	}
	.chip.hot,
	.chip.weather {
		color: var(--warn);
	}
	.chip.hot .dot,
	.chip.weather .dot {
		background: var(--warn);
		box-shadow: 0 0 10px color-mix(in srgb, var(--warn) 70%, transparent);
	}
	.word {
		font-family: var(--font-body);
		font-size: var(--text-lg);
		font-weight: 500;
		font-style: normal;
		line-height: 1;
		letter-spacing: -0.01em;
		white-space: nowrap;
	}
	.slip {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2.75rem;
		max-width: min(36rem, 100%);
		padding: var(--space-2) var(--space-5);
		box-sizing: border-box;
	}
	.copy {
		min-width: 0;
		flex: 1;
	}
	.kicker {
		font-family: var(--font-body);
		font-size: var(--text-sm);
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--text-tertiary);
	}
	.title {
		font-family: var(--font-body);
		font-size: var(--text-lg);
		font-weight: 600;
		font-style: normal;
		color: var(--foreground);
		letter-spacing: -0.02em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sub {
		font-size: var(--text-sm);
		color: var(--text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	@media (prefers-reduced-motion: no-preference) {
		.dot {
			animation: dot-breathe 3.2s var(--spring-smooth) infinite;
		}
		.chip.hot .dot,
		.chip.weather .dot {
			animation: yield-mark 1.8s var(--spring-smooth) infinite;
		}
	}
	@keyframes dot-breathe {
		0%,
		100% {
			transform: scale(1);
			opacity: 0.85;
		}
		50% {
			transform: scale(1.18);
			opacity: 1;
		}
	}

	@media (max-width: 414px) {
		.slip {
			max-width: 100%;
		}
		.word {
			font-size: var(--text-sm);
		}
	}
</style>
