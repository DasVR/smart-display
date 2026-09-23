<script>
	// Self-hosted variable fonts. The kiosk runs Chromium with its disk cache
	// off, so Google Fonts were re-downloaded on every boot and fell back to
	// system fonts whenever the network was down. Bundling them serves one
	// woff2 per family from the local server instead.
	import '@fontsource-variable/plus-jakarta-sans/wght.css';
	import '@fontsource-variable/fira-code/wght.css';

	let { children } = $props();
</script>

{@render children()}
