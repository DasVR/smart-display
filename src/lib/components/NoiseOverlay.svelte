<svg class="noise-overlay" xmlns="http://www.w3.org/2000/svg">
	<filter id="grain">
		<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="4" stitchTiles="stitch" />
		<feColorMatrix type="saturate" values="0" />
	</filter>
	<rect width="100%" height="100%" filter="url(#grain)" />
</svg>

<style>
	.noise-overlay {
		position: fixed;
		inset: 0;
		width: 100vw;
		height: 100vh;
		pointer-events: none;
		z-index: 1;
		opacity: 0.02;
		mix-blend-mode: overlay;
	}

	@media (prefers-reduced-motion: reduce) {
		.noise-overlay { opacity: 0.04; }
	}
</style>
