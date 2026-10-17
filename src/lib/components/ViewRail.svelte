<!--
	The wall's pages as one row you can thumb through, in place of the old
	arrows plus a pad of keys. The marker under the current page slides to
	the one you pick (transform only), and the row keeps the current page in
	view. Swiping the screen still turns the pages (the page handles that).
-->
<script>
	import { tick } from 'svelte';

	let { views = [], current = 'clock', disabled = false, onpick = () => {} } = $props();

	let rail = $state(null);
	let marker = $state({ x: 0, w: 0, ready: false });

	async function place() {
		await tick();
		const on = rail?.querySelector('[aria-selected="true"]');
		if (!on) return;
		marker = { x: on.offsetLeft, w: on.offsetWidth, ready: true };
		// keep the current page in view without yanking the row around
		const left = on.offsetLeft - rail.scrollLeft;
		const right = left + on.offsetWidth;
		if (left < 12 || right > rail.clientWidth - 12) rail.scrollTo({ left: on.offsetLeft - (rail.clientWidth - on.offsetWidth) / 2, behavior: 'smooth' });
	}

	$effect(() => {
		current;
		views;
		place();
	});

	function keydown(e) {
		const i = views.findIndex((v) => v.id === current);
		if (e.key === 'ArrowRight' && views[i + 1]) onpick(views[i + 1].id);
		else if (e.key === 'ArrowLeft' && views[i - 1]) onpick(views[i - 1].id);
		else return;
		e.preventDefault();
	}
</script>

<div class="rail" bind:this={rail} role="tablist" aria-label="Pages on the display" tabindex="-1" onkeydown={keydown}>
	<span class="marker" class:ready={marker.ready} style:width="{marker.w}px" style:transform="translateX({marker.x}px)" aria-hidden="true"></span>
	{#each views as v (v.id)}
		<button
			type="button"
			role="tab"
			class="chip"
			class:on={v.id === current}
			aria-selected={v.id === current}
			tabindex={v.id === current ? 0 : -1}
			{disabled}
			onclick={() => onpick(v.id)}
		>{v.label}</button>
	{/each}
</div>

<style>
	.rail {
		position: relative;
		display: flex;
		gap: var(--space-1);
		padding: 0.25rem;
		border-radius: 999px;
		border: 1px solid var(--hairline);
		background: var(--shell-fill);
		overflow-x: auto;
		scrollbar-width: none;
		scroll-snap-type: x proximity;
		overscroll-behavior-x: contain;
		touch-action: pan-x;
	}
	.rail::-webkit-scrollbar { display: none; }
	.marker {
		position: absolute;
		top: 0.25rem;
		bottom: 0.25rem;
		left: 0;
		border-radius: 999px;
		background: color-mix(in srgb, var(--foreground) 13%, transparent);
		box-shadow: inset 0 1px 0 color-mix(in srgb, var(--foreground) 16%, transparent);
		opacity: 0;
		pointer-events: none;
	}
	.marker.ready {
		opacity: 1;
		transition:
			transform 340ms var(--ease-fluid),
			width 340ms var(--ease-fluid);
	}
	.chip {
		position: relative;
		flex: 0 0 auto;
		min-height: 2.75rem;
		padding: 0 var(--space-4);
		scroll-snap-align: center;
		border: 0;
		border-radius: 999px;
		background: none;
		color: var(--text-tertiary);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 650;
		white-space: nowrap;
		cursor: pointer;
		touch-action: manipulation;
		transition: color 160ms var(--ease-standard), transform 120ms var(--ease-standard);
	}
	.chip.on { color: var(--foreground); }
	.chip:active { transform: scale(0.96); }
	.chip:disabled { opacity: 0.45; cursor: not-allowed; }
	.chip:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: -2px;
	}
	@media (prefers-reduced-motion: reduce) {
		.marker.ready { transition: none; }
	}
</style>
