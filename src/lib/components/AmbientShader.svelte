<script>
	import LiquidMetalCanvas from '$lib/shaders/LiquidMetalCanvas.svelte';
	let { isLowPower = false } = $props();
</script>

<LiquidMetalCanvas {isLowPower} />
