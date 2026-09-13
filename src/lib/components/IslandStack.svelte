<script>
	import DynamicIsland from '$lib/components/DynamicIsland.svelte';
	import InstallOrb from '$lib/components/InstallOrb.svelte';

	let { nowPlaying = null, events = [], activities = [], progress = null } = $props();
</script>

<div class="stack">
	<svg width="0" height="0" aria-hidden="true">
		<defs>
			<filter id="island-goo" x="-80%" y="-80%" width="260%" height="260%">
				<feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur" />
				<feColorMatrix
					in="blur"
					mode="matrix"
					values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -8"
					result="goo"
				/>
				<feBlend in="SourceGraphic" in2="goo" />
			</filter>
		</defs>
	</svg>
	<DynamicIsland {nowPlaying} {events} {activities} anchored />
	<InstallOrb {progress} />
</div>

<style>
	.stack {
		position: fixed;
		top: 0;
		left: 50%;
		transform: translateX(-50%);
		z-index: 30;
		display: flex;
		flex-direction: column;
		align-items: center;
		pointer-events: none;
	}
	.stack :global(.island),
	.stack :global(.island.anchored) {
		z-index: 2;
	}
	.stack :global(.island-pill.active),
	.stack :global(.orb) {
		pointer-events: auto;
	}
</style>
