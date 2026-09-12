<script>
	import { fly, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { playChime } from '$lib/services/chime.js';

	let {
		nowPlaying = null,
		notification = { visible: false, title: '', body: '', kind: 'info' },
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

	// Priority: a live system event (docker/network/agent/bluetooth) always
	// wins, then a one-off notification banner (morning/sleep triggers),
	// then now-playing. Persistent weather lives on the full-width rail, not
	// here, so a rain band cannot block Cursor-done or a phone connecting.
	let activeEvent = $derived(events?.[0] ?? null);
	let mode = $derived.by(() => {
		if (activeEvent) return 'event';
		if (notification?.visible) return 'alert';
		if (nowPlaying?.playing) return 'nowplaying';
		return 'idle';
	});
	let isIdle = $derived(mode === 'idle');

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
			case 'idle':
				return '';
			default: {
				const _exhaustive = next;
				return _exhaustive;
			}
		}
	}

	// Now-playing is handled separately in the template (album art vs. the
	// music note icon), so this only covers the modes that always show one
	// of the fixed SVG icons.
	function iconFor(m) {
		switch (m) {
			case 'event': {
				const sev = activeEvent?.severity;
				if (sev === 'error') return 'error';
				if (sev === 'warn') return 'warn';
				if (sev === 'ok') return 'ok';
				return 'info';
			}
			case 'alert':
				return notification?.kind === 'warn' ? 'warn' : 'bell';
			default:
				return null;
		}
	}

	function sevFor(m) {
		if (m === 'event') return activeEvent?.severity ?? 'info';
		if (m === 'alert') return notification?.kind === 'warn' ? 'warn' : 'info';
		if (m === 'nowplaying') return 'info';
		return 'info';
	}

	// A calm chime plays once each time the island actually opens with new
	// content — not on every unrelated re-render while it's already showing
	// something, and not twice for the same event. Tracked by a signature of
	// "what's currently being shown" so a second event replacing the first
	// (while the island never returns to idle) still gets its own chime.
	// Now-playing gets its own brighter "music" tone since it's good news
	// rather than a notice; everything else uses its severity tone.
	let lastChimeKey = null;
	$effect(() => {
		let key = null;
		if (mode === 'event') key = `event:${activeEvent?.id}`;
		else if (mode === 'nowplaying') key = `nowplaying:${nowPlaying?.title}:${nowPlaying?.artist}`;
		else if (mode === 'alert') key = `alert:${notification?.title}`;
		if (key && key !== lastChimeKey) {
			playChime(mode === 'nowplaying' ? 'music' : sevFor(mode));
		}
		lastChimeKey = key;
	});

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

	// A ResizeObserver only reports changes once the browser has actually
	// completed a layout/paint pass, which async content (like the album art
	// <img> below) can occasionally miss on its very first measurement. A
	// double rAF re-check right after each mode switch is a cheap guarantee
	// we're never left showing a stale (usually too-small) size.
	$effect(() => {
		mode;
		if (typeof window === 'undefined') return;
		const raf1 = requestAnimationFrame(() => requestAnimationFrame(measure));
		return () => cancelAnimationFrame(raf1);
	});
</script>

{#snippet icon(kind)}
	{#if kind === 'ok'}
		<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
			<path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
		</svg>
	{:else if kind === 'warn'}
		<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
			<path
				d="M12 9v4m0 4h.01M10.29 3.86 2.11 18.05A1.5 1.5 0 0 0 3.5 20.5h17a1.5 1.5 0 0 0 1.39-2.45L13.71 3.86a1.5 1.5 0 0 0-2.42 0Z"
				stroke="currentColor"
				stroke-width="1.8"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	{:else if kind === 'error'}
		<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
			<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8" />
			<path d="M9 9l6 6m0-6l-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
		</svg>
	{:else if kind === 'info'}
		<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
			<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8" />
			<path d="M12 11v5m0-8h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
		</svg>
	{:else if kind === 'music'}
		<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
			<path d="M9 18V5l11-2v13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
			<circle cx="7" cy="18" r="2.5" stroke="currentColor" stroke-width="1.8" />
			<circle cx="18" cy="16" r="2.5" stroke="currentColor" stroke-width="1.8" />
		</svg>
	{:else if kind === 'bell'}
		<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
			<path d="M6 8a6 6 0 1 1 12 0c0 3.5 1 5 2 6H4c1-1 2-2.5 2-6Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
			<path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
		</svg>
	{/if}
{/snippet}

{#snippet islandContent(m)}
	{#if m === 'event'}
		<div class="slip sev-{sevFor(m)}">
			<span class="icon-badge"><span class="icon">{@render icon(iconFor(m))}</span></span>
			<div class="copy">
				<div class="kicker">{activeEvent?.source || modeLabel(m)}</div>
				<div class="title">{activeEvent?.title ?? ''}</div>
				{#if activeEvent?.body}<div class="sub">{activeEvent.body}</div>{/if}
			</div>
		</div>
	{:else if m === 'nowplaying'}
		<div class="slip sev-info">
			<span class="icon-badge" class:has-art={!!nowPlaying?.art}>
				{#if nowPlaying?.art}
					<img src={nowPlaying.art} alt="" class="art-thumb" onload={measure} />
				{:else}
					<span class="icon">{@render icon('music')}</span>
				{/if}
			</span>
			<div class="copy">
				<div class="kicker">{modeLabel(m)}</div>
				<div class="title">{nowPlaying?.title || 'Untitled'}</div>
				<div class="sub">{nowPlaying?.artist || ''}</div>
			</div>
		</div>
	{:else if m === 'alert'}
		<div class="slip sev-{sevFor(m)}">
			<span class="icon-badge"><span class="icon">{@render icon(iconFor(m))}</span></span>
			<div class="copy">
				<div class="kicker">{modeLabel(m)}</div>
				<div class="title">{notification.title}</div>
				<div class="sub">{notification.body}</div>
			</div>
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
		width: var(--pill-w, 7rem);
		height: var(--pill-h, 0.9rem);
		/* A small rounded pill at rest, like the real thing's idle capsule —
		   but once it opens it settles into a modest, consistent corner
		   radius instead of scaling up to a full stadium shape, so a wide or
		   tall expanded card reads as a boxy rounded rectangle rather than a
		   giant pill. Top stays flat either way, flush with the screen edge. */
		border-radius: 0 0 999px 999px;
		background-color: var(--abyss);
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.4'/%3E%3C/svg%3E");
		background-blend-mode: overlay;
		background-size: 140px 140px;
		box-shadow:
			0 14px 34px color-mix(in srgb, var(--abyss) 65%, transparent),
			0 6px 18px color-mix(in srgb, var(--abyss) 40%, transparent);
		overflow: hidden;
		opacity: 0.72;
		pointer-events: none;
	}
	.island-pill.active {
		opacity: 1;
		pointer-events: auto;
		border-radius: 0 0 1.75rem 1.75rem;
		box-shadow:
			0 20px 46px color-mix(in srgb, var(--abyss) 78%, transparent),
			0 10px 26px color-mix(in srgb, var(--abyss) 55%, transparent);
	}
	@media (prefers-reduced-motion: no-preference) {
		.island-pill.ready {
			transition:
				width 480ms var(--spring-bouncy),
				height 480ms var(--spring-bouncy),
				border-radius 480ms var(--spring-bouncy),
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
		width: 7rem;
		height: 0.9rem;
	}
	.island-ghost {
		position: absolute;
		top: 0;
		left: 0;
		width: max-content;
		max-width: min(48rem, 90vw);
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
	.slip {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		min-height: 6rem;
		max-width: min(48rem, 90vw);
		padding: var(--space-4) var(--space-6);
		box-sizing: border-box;
	}
	.icon-badge {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 4rem;
		height: 4rem;
		border-radius: 0.9rem;
		flex-shrink: 0;
		overflow: hidden;
		color: var(--brand);
		background: color-mix(in srgb, currentColor 16%, transparent);
	}
	.icon-badge.has-art {
		background: none;
	}
	.icon {
		width: 2.1rem;
		height: 2.1rem;
		display: block;
	}
	.icon :global(svg) {
		width: 100%;
		height: 100%;
	}
	.art-thumb {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.copy {
		min-width: 0;
		flex: 1;
	}
	.kicker {
		font-family: var(--font-body);
		font-size: var(--text-lg);
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--text-tertiary);
	}
	.sev-error .kicker,
	.sev-error .icon-badge {
		color: var(--warn);
	}
	.sev-warn .kicker,
	.sev-warn .icon-badge {
		color: var(--solve);
	}
	.sev-ok .kicker,
	.sev-ok .icon-badge {
		color: var(--ok);
	}
	.sev-info .kicker,
	.sev-info .icon-badge {
		color: var(--brand);
	}
	.title {
		font-family: var(--font-body);
		font-size: 2rem;
		font-weight: 600;
		font-style: normal;
		color: var(--foreground);
		letter-spacing: -0.03em;
		line-height: 1.15;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sub {
		font-size: var(--text-lg);
		color: var(--text-secondary);
		line-height: 1.25;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	@media (max-width: 414px) {
		.slip {
			max-width: 100%;
		}
	}
</style>
