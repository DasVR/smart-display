<script>
	let { opacity = 0.18 } = $props();
	const uid = `dot-${Math.random().toString(36).slice(2, 8)}`;
</script>

<svg class="dot-matrix" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="opacity: {opacity}">
	<defs>
		<pattern id={uid} width="8" height="8" patternUnits="userSpaceOnUse">
			<circle cx="1.2" cy="1.2" r="0.9" fill="currentColor" />
		</pattern>
	</defs>
	<rect width="100%" height="100%" fill="url(#{uid})" />
</svg>

<style>
	.dot-matrix {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		color: var(--foreground);
		z-index: 0;
	}
</style>
