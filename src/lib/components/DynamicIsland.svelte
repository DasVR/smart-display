<script>
	import { fly, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';

	let {
		nowPlaying = null,
		notification = { visible: false, title: '', body: '', kind: 'info' },
		weatherData = null,
		events = []
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
		return reducedMotion ? { duration: 0 } : { y: -10, duration: 260, easing: cubicOut };
	}
	function outFade() {
		return reducedMotion ? { duration: 0 } : { duration: 140 };
	}

	// Priority: a live system event (docker/network/etc) always wins, then a
	// one-off notification banner (morning/sleep triggers), then weather,
	// then now-playing. Nothing else -> the island renders nothing at all.
	let activeEvent = $derived(events?.[0] ?? null);
	let mode = $derived.by(() => {
		if (activeEvent) return 'event';
		if (notification?.visible) return 'alert';
		if (weatherData?.alerts?.length) return 'weather';
		if (weatherData?.prediction?.rain60min >= 0.35) return 'weather';
		if (nowPlaying?.playing) return 'nowplaying';
		return 'idle';
	});
	let isIdle = $derived(mode === 'idle');

	let weatherWord = $derived.by(() => {
		const alerts = weatherData?.alerts || [];
		if (alerts.length) return 'Weather alert';
		const p = weatherData?.prediction || {};
		if (p.rain30min >= 0.6) return 'Rain in 30 min';
		if (p.rain60min >= 0.6) return 'Rain in an hour';
		if (p.rain120min >= 0.6) return 'Rain in 2 hours';
		return 'Clear skies';
	});

	function modeLabel(next) {
		switch (next) {
			case 'event': {
				const sev = activeEvent?.severity;
				if (sev === 'error') return 'Error';
				if (sev === 'warn') return 'Warning';
				if (sev === 'ok') return 'Recovered';
				return 'Notice';
			}
			case 'nowplaying':
				return 'Now playing';
			case 'alert':
				return notification?.kind === 'warn' ? 'Alert' : 'Notice';
			case 'weather':
				return weatherWord;
			case 'idle':
				return '';
			default: {
				const _exhaustive = next;
				return _exhaustive;
			}
		}
	}

	// The pill is one persistent capsule anchored to the top-center of the
	// screen (like the real iPhone Dynamic Island) that spring-resizes its
	// own bounds rather than being swapped out per mode. At idle it doesn't
	// disappear — it rests as a small tab hanging from the top edge, always
	// part of the screen's chrome, and grows downward from that same top
	// anchor when something needs to be shown. A hidden "ghost" copy of the
	// current content drives the target width/height via ResizeObserver,
	// independent of whatever is mid-crossfade in the visible layer on top.
	let ghostEl = $state(null);
	let pillSize = $state({ w: 0, h: 0 });
	let ready = $state(false);

	function measure() {
		if (!ghostEl) return;
		const r = ghostEl.getBoundingClientRect();
		if (!r.width || !r.height) return;
		const w = Math.round(r.width);
		const h = Math.round(r.height);
		if (w === Math.round(pillSize.w) && h === Math.round(pillSize.h)) return;
		pillSize = { w, h };
		if (!ready) ready = true;
	}

	$effect(() => {
		if (typeof window === 'undefined' || !ghostEl) return;
		const ro = new ResizeObserver(measure);
		ro.observe(ghostEl);
		measure();
		return () => ro.disconnect();
	});
</script>

{#snippet islandContent(m)}
	{#if m === 'event'}
		<div class="slip sev-{activeEvent?.severity ?? 'info'}">
			<div class="copy">
				<div class="kicker">{activeEvent?.source || modeLabel(m)}</div>
				<div class="title">{activeEvent?.title ?? ''}</div>
				{#if activeEvent?.body}<div class="sub">{activeEvent.body}</div>{/if}
			</div>
		</div>
	{:else if m === 'nowplaying'}
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
	{:else if m === 'weather'}
		<div class="chip weather">
			<span class="dot" aria-hidden="true"></span>
			<span class="word">{modeLabel(m)}</span>
		</div>
	{:else}
		<div class="nub" aria-hidden="true"></div>
	{/if}
{/snippet}

<div class="island" data-mode={mode}>
	<div
		class="island-pill"
		class:ready
		class:active={!isIdle}
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
	/* Fixed to the viewport, not the document flow, so its own resizing can
	   never push or cover anything else on the page — it's an overlay, like
	   the real thing sitting in the status bar. */
	.island {
		position: fixed;
		top: 0;
		left: 50%;
		transform: translateX(-50%);
		z-index: 30;
		pointer-events: none;
	}
	.island-pill {
		position: relative;
		isolation: isolate;
		width: var(--pill-w, 3rem);
		height: var(--pill-h, 0.4rem);
		border-radius: 0 0 999px 999px;
		background-color: var(--abyss);
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.4'/%3E%3C/svg%3E");
		background-blend-mode: overlay;
		background-size: 140px 140px;
		box-shadow:
			0 14px 34px color-mix(in srgb, var(--abyss) 65%, transparent),
			0 6px 18px color-mix(in srgb, var(--abyss) 40%, transparent);
		overflow: hidden;
		opacity: 0.5;
		pointer-events: none;
	}
	.island-pill.active {
		opacity: 1;
		pointer-events: auto;
		box-shadow:
			0 20px 46px color-mix(in srgb, var(--abyss) 78%, transparent),
			0 10px 26px color-mix(in srgb, var(--abyss) 55%, transparent);
	}
	@media (prefers-reduced-motion: no-preference) {
		.island-pill.ready {
			transition:
				width 480ms var(--spring-bouncy),
				height 480ms var(--spring-bouncy),
				opacity 260ms var(--spring-smooth),
				box-shadow 260ms var(--spring-smooth);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.island-pill.ready {
			transition: opacity 240ms var(--spring-smooth);
		}
	}
	.nub {
		width: 3rem;
		height: 0.4rem;
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
	.chip.weather {
		color: var(--warn);
	}
	.dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: currentColor;
		box-shadow: 0 0 10px color-mix(in srgb, currentColor 70%, transparent);
		flex-shrink: 0;
		transform-origin: center;
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
		border-left: 3px solid transparent;
	}
	.slip.sev-info {
		border-left-color: var(--brand);
	}
	.slip.sev-error {
		border-left-color: var(--warn);
	}
	.slip.sev-warn {
		border-left-color: var(--solve);
	}
	.slip.sev-ok {
		border-left-color: var(--ok);
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
	.sev-error .kicker {
		color: var(--warn);
	}
	.sev-warn .kicker {
		color: var(--solve);
	}
	.sev-ok .kicker {
		color: var(--ok);
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
