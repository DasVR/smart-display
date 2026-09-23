<script>
	// Self-hosted variable fonts. The kiosk runs Chromium with its disk cache
	// off, so Google Fonts were re-downloaded on every boot and fell back to
	// system fonts whenever the network was down. Bundling them serves one
	// woff2 per family from the local server instead.
	import '@fontsource-variable/plus-jakarta-sans/wght.css';
	import '@fontsource-variable/fira-code/wght.css';
	import { installStaticDemo } from '$lib/demo/staticDemo.js';
	import DemoPanel from '$lib/demo/DemoPanel.svelte';

	// GitHub Pages build only: stand in for the kiosk server with canned data.
	// Vite inlines the flag, so the kiosk build drops this branch entirely.
	const staticDemo = import.meta.env.VITE_STATIC_DEMO === '1';
	if (staticDemo) installStaticDemo();

	let { children } = $props();
</script>

{@render children()}

{#if staticDemo}
	<DemoPanel />
{/if}
