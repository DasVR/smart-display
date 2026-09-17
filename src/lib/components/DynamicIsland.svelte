<script>
	import { fly, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { playChime } from '$lib/services/chime.js';
	import { chimeKindForEvent } from '$lib/chimeKind.js';
	import { compactSlots } from '$lib/islandLive.js';

	let {
		nowPlaying = null,
		events = [],
		activities = [],
		anchored = false,
		onMusicView = false
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

	// Queued notices expand through, then compact Live Activities
	// (now-playing, network) stay like iPhone's island.
	let activeEvent = $derived(events?.[0] ?? null);
	let slots = $derived(compactSlots(nowPlaying, activities, { onMusicView }));
	let mode = $derived.by(() => {
		if (activeEvent) return 'event';
		if (slots) return 'compact';
		return 'idle';
	});
	let isIdle = $derived(mode === 'idle');
	let isCompact = $derived(mode === 'compact');

	function modeLabel(next) {
		switch (next) {
			case 'event': {
				if (activeEvent?.source) return activeEvent.source;
				if (activeEvent?.kind === 'briefing') return 'Morning';
				const sev = activeEvent?.severity;
				if (sev === 'error') return 'Error';
				if (sev === 'warn') return 'Warning';
				if (sev === 'ok') return 'Recovered';
				return 'Notice';
			}
			case 'compact':
				return '';
			case 'idle':
				return '';
			default: {
				const _exhaustive = next;
				return _exhaustive;
			}
		}
	}

	function iconFor(m) {
		switch (m) {
			case 'event': {
				if (activeEvent?.kind === 'briefing') return 'bell';
				if (activeEvent?.kind === 'weather' || activeEvent?.kind === 'severe-weather') return 'weather';
				if (activeEvent?.kind === 'volume') return 'music';
				if (activeEvent?.kind === 'schedule') return 'bell';
				if (activeEvent?.kind === 'install') return 'info';
				if (activeEvent?.kind === 'update') return 'warn';
				if (activeEvent?.kind === 'done') return 'ok';
				const sev = activeEvent?.severity;
				if (sev === 'error') return 'error';
				if (sev === 'warn') return 'warn';
				if (sev === 'ok') return 'ok';
				return 'info';
			}
			default:
				return null;
		}
	}

	function slotIcon(slot) {
		if (!slot) return 'info';
		if (slot.kind === 'music') return 'music';
		if (slot.kind === 'network') return 'warn';
		if (slot.kind === 'stack') return slot.severity === 'warn' ? 'warn' : 'error';
		if (slot.kind === 'status') return null;
		if (slot.kind === 'eq') return null;
		const sev = slot.severity;
		if (sev === 'error') return 'error';
		if (sev === 'warn') return 'warn';
		if (sev === 'ok') return 'ok';
		return 'info';
	}

	function sevFor(m) {
		if (m === 'event') return activeEvent?.severity ?? 'info';
		if (m === 'compact') return slots?.leading?.severity ?? 'info';
		return 'info';
	}

	let lastChimeKey = null;
	$effect(() => {
		let key = null;
		let tone = 'info';
		if (mode === 'event') {
			key = `event:${activeEvent?.id}`;
			tone = chimeKindForEvent(activeEvent || {});
		} else if (mode === 'compact' && slots?.leading?.kind === 'music') {
			key = `music:${nowPlaying?.title}:${nowPlaying?.artist}`;
			tone = 'music';
		}
		if (key && key !== lastChimeKey) {
			const returning = lastChimeKey?.startsWith('event:') && key.startsWith('music:');
			if (!returning) playChime(tone);
		}
		lastChimeKey = key;
	});

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

	$effect(() => {
		mode;
		slots?.leading?.id;
		slots?.trailing?.id;
		slots?.leading?.title;
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
	{:else if kind === 'weather'}
		<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
			<path
				d="M7 16a4 4 0 0 1 .5-7.97A5.5 5.5 0 0 1 18 10a3.5 3.5 0 0 1 -.5 6.97"
				stroke="currentColor"
				stroke-width="1.8"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
			<path d="M9 19l-1 2m5-2l-1 2m5-2l-1 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
		</svg>
	{/if}
{/snippet}

{#snippet eqBars()}
	<span class="eq" class:still={reducedMotion} aria-hidden="true">
		<i></i><i></i><i></i><i></i>
	</span>
{/snippet}

{#snippet compactSide(slot, place)}
	{#if slot?.kind === 'eq'}
		{@render eqBars()}
	{:else if slot?.kind === 'status'}
		<span class="compact-status sev-{slot.severity}">{slot.title}</span>
	{:else if slot}
		<span class="compact-chip sev-{slot.severity}">
			<span class="compact-glyph" class:has-art={slot.kind === 'music' && !!slot.art}>
				{#if slot.kind === 'music' && slot.art}
					<img src={slot.art} alt="" class="art-thumb" onload={measure} />
				{:else}
					{@const glyph = slotIcon(slot)}
					{#if glyph}
						<span class="icon compact-icon">{@render icon(glyph)}</span>
					{/if}
				{/if}
			</span>
			{#if slot.title && (place === 'leading' || slot.kind !== 'music') && !slot.hideTitle}
				<span class="compact-title">{slot.title}</span>
			{/if}
		</span>
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
	{:else if m === 'compact'}
		<div class="compact" class:music-slim={slots?.leading?.hideTitle && slots?.trailing?.kind === 'eq'}>
			<div class="side leading">{@render compactSide(slots?.leading, 'leading')}</div>
			<span class="compact-gap" aria-hidden="true"></span>
			<div class="side trailing">{@render compactSide(slots?.trailing, 'trailing')}</div>
		</div>
	{:else}
		<div class="nub" aria-hidden="true"></div>
	{/if}
{/snippet}

<div class="island" class:anchored data-mode={mode}>
	<div
		class="island-pill"
		class:ready
		class:active={!isIdle}
		class:compact={isCompact}
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
		position: fixed;
		top: 0;
		left: 50%;
		transform: translateX(-50%);
		z-index: 30;
		pointer-events: none;
	}
	.island.anchored {
		position: relative;
		top: auto;
		left: auto;
		transform: none;
		z-index: auto;
	}
	.island-pill {
		position: relative;
		isolation: isolate;
		width: var(--pill-w, 7rem);
		height: var(--pill-h, 0.9rem);
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
	.island-pill.compact {
		border-radius: 0 0 1.35rem 1.35rem;
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
		max-width: min(56rem, 94vw);
		height: max-content;
		visibility: hidden;
		pointer-events: none;
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
		max-width: min(56rem, 94vw);
		padding: var(--space-4) var(--space-6);
		box-sizing: border-box;
		white-space: nowrap;
	}
	.compact {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.7rem;
		min-height: 3.45rem;
		min-width: 16.5rem;
		max-width: min(36rem, 86vw);
		padding: 0.4rem 0.75rem 0.5rem;
		box-sizing: border-box;
	}
	.compact.music-slim {
		min-width: 8.25rem;
		gap: 0.45rem;
		padding: 0.35rem 0.6rem 0.45rem;
	}
	.compact-gap {
		width: 0.85rem;
		height: 1.2rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--foreground) 7%, transparent);
		flex-shrink: 0;
	}
	.side {
		display: flex;
		align-items: center;
		min-width: 0;
	}
	.leading {
		justify-content: flex-start;
		flex: 1;
	}
	.trailing {
		justify-content: flex-end;
		flex-shrink: 0;
	}
	.compact-chip {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		min-width: 0;
		color: var(--brand);
	}
	.compact-glyph {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.35rem;
		height: 2.35rem;
		border-radius: 999px;
		flex-shrink: 0;
		overflow: hidden;
		background: color-mix(in srgb, currentColor 16%, transparent);
	}
	.compact-glyph.has-art {
		background: none;
	}
	.compact-icon {
		width: 1.2rem;
		height: 1.2rem;
	}
	.compact-title {
		font-family: var(--font-body);
		font-size: 1.2rem;
		font-weight: 600;
		letter-spacing: -0.02em;
		color: var(--foreground);
		max-width: 14ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.compact-status {
		font-family: var(--font-body);
		font-size: 1.05rem;
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--text-secondary);
		padding-right: 0.15rem;
	}
	.eq {
		display: flex;
		align-items: flex-end;
		gap: 0.18rem;
		height: 1.35rem;
		padding-right: 0.2rem;
	}
	.eq i {
		display: block;
		width: 0.22rem;
		border-radius: 999px;
		background: var(--ok);
		transform-origin: bottom center;
	}
	.eq i:nth-child(1) {
		height: 38%;
	}
	.eq i:nth-child(2) {
		height: 88%;
	}
	.eq i:nth-child(3) {
		height: 55%;
	}
	.eq i:nth-child(4) {
		height: 72%;
	}
	@media (prefers-reduced-motion: no-preference) {
		.eq:not(.still) i {
			animation: eq-bounce 0.72s ease-in-out infinite alternate;
		}
		.eq:not(.still) i:nth-child(2) {
			animation-delay: 0.12s;
		}
		.eq:not(.still) i:nth-child(3) {
			animation-delay: 0.24s;
		}
		.eq:not(.still) i:nth-child(4) {
			animation-delay: 0.36s;
		}
	}
	@keyframes eq-bounce {
		from {
			transform: scaleY(0.45);
		}
		to {
			transform: scaleY(1);
		}
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
	.sev-error .icon-badge,
	.compact-chip.sev-error,
	.compact-status.sev-error {
		color: var(--warn);
	}
	.sev-warn .kicker,
	.sev-warn .icon-badge,
	.compact-chip.sev-warn,
	.compact-status.sev-warn {
		color: var(--solve);
	}
	.sev-ok .kicker,
	.sev-ok .icon-badge,
	.compact-chip.sev-ok,
	.compact-status.sev-ok {
		color: var(--ok);
	}
	.sev-info .kicker,
	.sev-info .icon-badge,
	.compact-chip.sev-info {
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
