<!--
	Bottom tab bar for the phone remote. Saved to an iPhone home screen the
	remote runs edge to edge, and anything along the top sits under the
	status bar or out of thumb reach, so navigation lives down here instead,
	floating above the home indicator like an iOS tab bar.
-->
<script>
	import { base } from '$app/paths';
	import RemoteApprovals from './RemoteApprovals.svelte';
	import VoiceKey from './VoiceKey.svelte';
	import VoiceSheet from './VoiceSheet.svelte';

	let keyEl = $state(null);

	let { active = 'control' } = $props();

	// base-relative so the tabs also work under the GitHub Pages sub-path
	const TABS = [
		{ id: 'control', label: 'Now', href: `${base}/remote` },
		{ id: 'tasks', label: 'Day', href: `${base}/remote/tasks` },
		{ id: 'night', label: 'Night', href: `${base}/remote#night` },
		{ id: 'stats', label: 'Home', href: `${base}/remote/stats` }
	];
	// the mic key sits in the middle: two tabs either side
	const left = TABS.slice(0, 2);
	const right = TABS.slice(2);
</script>

<RemoteApprovals />
<div class="edge-fade" aria-hidden="true"></div>
{#snippet tabs(list)}
	{#each list as tab (tab.id)}
		<a
			class="tab"
			class:active={active === tab.id}
			href={tab.href}
			aria-current={active === tab.id ? 'page' : undefined}
			data-sveltekit-noscroll
		>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				{#if tab.id === 'control'}
					<rect x="7" y="2.75" width="10" height="18.5" rx="3" />
					<circle cx="12" cy="8" r="1.6" />
					<path d="M10 13.5h4M10 16.5h4" />
				{:else if tab.id === 'night'}
					<path d="M19.5 14.2A7.5 7.5 0 0 1 9.8 4.5a7.5 7.5 0 1 0 9.7 9.7Z" />
				{:else if tab.id === 'tasks'}
					<path d="M9 6.5h11M9 12h11M9 17.5h11" />
					<path d="M3.5 6.5l1.3 1.3 2.2-2.6M3.5 12l1.3 1.3 2.2-2.6" />
					<circle cx="5" cy="17.5" r="1.2" />
				{:else}
					<path d="M4 20V13M10 20V6M16 20v-9M22 20H2" />
				{/if}
			</svg>
			<span>{tab.label}</span>
		</a>
	{/each}
{/snippet}

<nav class="tabbar" aria-label="Remote sections">
	{@render tabs(left)}
	<VoiceKey bind:el={keyEl} />
	{@render tabs(right)}
</nav>
<VoiceSheet returnFocus={keyEl} />

<style>
	.tabbar {
		position: fixed;
		z-index: 20;
		left: 50%;
		bottom: max(0.75rem, env(safe-area-inset-bottom));
		transform: translateX(-50%);
		width: min(calc(26rem - 2rem), calc(100vw - 1.5rem - env(safe-area-inset-left) - env(safe-area-inset-right)));
		display: grid;
		grid-template-columns: 1fr 1fr 4.1rem 1fr 1fr;
		padding: 0.3rem;
		border-radius: 999px;
		isolation: isolate;
	}
	/* The frosted glass is its own layer behind the buttons, not the nav itself,
	   so the mic key (which transforms and glows) is never a child of a blurred
	   element: lit from above, softly lifted off the page. */
	.tabbar::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		border-radius: inherit;
		background: color-mix(in srgb, var(--abyss-2) 78%, transparent);
		backdrop-filter: blur(22px) saturate(1.6);
		-webkit-backdrop-filter: blur(22px) saturate(1.6);
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, var(--foreground) 14%, transparent),
			inset 0 0 0 1px color-mix(in srgb, var(--foreground) 8%, transparent),
			0 12px 32px color-mix(in srgb, #000 55%, transparent);
	}
	/* Scroll-edge fade, like iOS: content dissolves into the page colour
	   before it slides under the bar, so it never fights the tab labels. */
	.edge-fade {
		position: fixed;
		z-index: 19;
		left: 0;
		right: 0;
		bottom: 0;
		height: calc(5.5rem + max(0.75rem, env(safe-area-inset-bottom)));
		background: linear-gradient(
			to bottom,
			transparent,
			color-mix(in srgb, var(--background) 85%, transparent) 45%,
			var(--background)
		);
		pointer-events: none;
	}
	.tab {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.15rem;
		min-height: 3.25rem;
		/* concentric with the bar: its radius minus the 0.3rem padding */
		border-radius: 999px;
		color: var(--text-tertiary);
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.01em;
		text-decoration: none;
		touch-action: manipulation;
		-webkit-touch-callout: none;
		transition-property: color, background-color, transform;
		transition-duration: 150ms, 150ms, 160ms;
		transition-timing-function: var(--spring-smooth);
	}
	.tab svg {
		width: 1.45rem;
		height: 1.45rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.tab.active {
		color: var(--foreground);
		background: color-mix(in srgb, var(--foreground) 11%, transparent);
	}
	.tab.active svg {
		color: var(--brand);
	}
	.tab:active {
		transform: scale(0.96);
	}
	.tab:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: -2px;
	}
	@media (prefers-reduced-transparency: reduce) {
		.tabbar::before {
			background: var(--abyss-2);
			backdrop-filter: none;
			-webkit-backdrop-filter: none;
		}
	}
</style>
