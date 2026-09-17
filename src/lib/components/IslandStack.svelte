<script>
	import { onMount } from 'svelte';
	import DynamicIsland from '$lib/components/DynamicIsland.svelte';
	import InstallOrb from '$lib/components/InstallOrb.svelte';

	let { nowPlaying = null, events = [], activities = [], progress = null, onMusicView = false } = $props();

	let stackEl = $state(null);
	let islandBox = $state({ w: 264, h: 55 });
	let orbBox = $state({ w: 211, h: 96 });
	let joined = $derived(Boolean(progress?.active));

	function measure() {
		if (!stackEl) return;
		const island = stackEl.querySelector('.island-pill');
		const orb = stackEl.querySelector('.orb .pill');
		if (island) {
			const r = island.getBoundingClientRect();
			if (r.width && r.height) islandBox = { w: r.width, h: r.height };
		}
		if (orb) {
			const r = orb.getBoundingClientRect();
			if (r.width && r.height) orbBox = { w: r.width, h: r.height };
		}
	}

	onMount(() => {
		measure();
		const ro = new ResizeObserver(() => measure());
		ro.observe(stackEl);
		return () => ro.disconnect();
	});

	$effect(() => {
		progress?.active;
		progress?.percent;
		progress?.current;
		queueMicrotask(measure);
	});
</script>

<div class="stack" class:joined bind:this={stackEl}>
	<svg width="0" height="0" aria-hidden="true">
		<defs>
			<filter id="island-goo" x="-80%" y="-80%" width="260%" height="260%">
				<feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur" />
				<feColorMatrix
					in="blur"
					mode="matrix"
					values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9"
					result="goo"
				/>
			</filter>
		</defs>
	</svg>
	{#if joined}
		<div class="goo" aria-hidden="true">
			<div class="blob island-blob" style="width: {islandBox.w}px; height: {islandBox.h}px"></div>
			<div class="blob neck"></div>
			<div class="blob orb-blob" style="width: {orbBox.w}px; height: {orbBox.h}px"></div>
		</div>
	{/if}
	<div class="fg">
		<DynamicIsland {nowPlaying} {events} {activities} {onMusicView} anchored />
		<InstallOrb {progress} />
	</div>
</div>

<style>
	.stack {
		position: fixed;
		top: 0;
		left: 50%;
		transform: translateX(-50%);
		z-index: 50;
		display: grid;
		justify-items: center;
		pointer-events: none;
	}
	.goo,
	.fg {
		grid-area: 1 / 1;
		display: flex;
		flex-direction: column;
		align-items: center;
	}
	.goo {
		z-index: 0;
		filter: url(#island-goo);
		pointer-events: none;
	}
	.fg {
		position: relative;
		z-index: 1;
	}
	.blob {
		background: var(--abyss);
		flex-shrink: 0;
	}
	.island-blob {
		border-radius: 0 0 1.35rem 1.35rem;
	}
	.neck {
		width: 3.4rem;
		height: 1.35rem;
		margin: -0.62rem 0;
		border-radius: 999px;
	}
	.orb-blob {
		margin-top: -0.9rem;
		border-radius: 1.2rem;
	}
	.stack :global(.island),
	.stack :global(.island.anchored) {
		z-index: 2;
	}
	.stack :global(.island-pill.active),
	.stack :global(.orb) {
		pointer-events: auto;
	}
	.stack.joined :global(.island-pill) {
		background-color: transparent;
		background-image: none;
		box-shadow: none;
	}
	.stack.joined :global(.orb .pill) {
		background-color: transparent;
		background-image: none;
		box-shadow: none;
	}
</style>
