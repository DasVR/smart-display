<!-- A small weather drawing: sun, moon, cloud, rain, snow or storm (src/lib/clockFace.js skyFor). Colors come from --glyph-ink and --glyph-warm. -->
<script>
	let { sky = 'sun', size = '4rem' } = $props();
	let cx = $derived(sky === 'sun' ? 24 : 31);
	let cy = $derived(sky === 'sun' ? 24 : 16);
</script>

<svg class="glyph" viewBox="0 0 48 48" style="width: {size}" aria-hidden="true">
	{#if sky === 'sun' || sky === 'sun-cloud'}
		<g class="warm">
			<circle cx={cx} cy={cy} r="7" />
			{#each Array(8) as _, i (i)}
				<line x1={cx} y1={cy - 13} x2={cx} y2={cy - 10} transform="rotate({i * 45} {cx} {cy})" />
			{/each}
		</g>
	{/if}
	{#if sky === 'moon' || sky === 'moon-cloud'}
		<path class="warm" d={sky === 'moon' ? 'M30 10a14 14 0 1 0 8 25 12 12 0 0 1-8-25Z' : 'M33 6a9 9 0 1 0 6 16 8 8 0 0 1-6-16Z'} />
	{/if}
	{#if sky !== 'sun' && sky !== 'moon'}
		<path class="cloud" d="M14 38h22a8 8 0 0 0 0-16 11 11 0 0 0-21-2 8 8 0 0 0-1 18Z" />
	{/if}
	{#if sky === 'rain' || sky === 'storm'}
		<g class="warm"><line x1="18" y1="41" x2="16" y2="46" /><line x1="26" y1="41" x2="24" y2="46" /><line x1="34" y1="41" x2="32" y2="46" /></g>
	{/if}
	{#if sky === 'snow'}
		<g class="warm"><circle cx="17" cy="44" r="1.5" /><circle cx="25" cy="45" r="1.5" /><circle cx="33" cy="44" r="1.5" /></g>
	{/if}
</svg>

<style>
	.glyph {
		height: auto;
		flex: none;
		fill: none;
		stroke: var(--glyph-ink, currentColor);
		stroke-width: 2.4;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.warm circle,
	path.warm {
		fill: var(--glyph-warm, #ffab52);
		stroke: none;
	}
	.warm line {
		stroke: var(--glyph-warm, #ffab52);
	}
	.cloud {
		fill: var(--glyph-cloud, transparent);
	}
</style>
