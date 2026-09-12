<!--
	Hallmark design scores
	Philosophy 4 · Hierarchy 5 · Execution 4 · Specificity 4 · Restraint 5 · Variety 4
	TV-style weather strip: a full-width bar, not a pill, muted terracotta for
	warnings and teal for incoming rain. Copy stays left so the Dynamic Island
	can still hang in the center.
-->
<script>
	import { playChime } from '$lib/services/chime.js';

	let { rail, onopen } = $props();

	let lastKey = null;
	$effect(() => {
		const key = rail ? `${rail.kind}:${rail.title}` : null;
		if (key && key !== lastKey) {
			playChime(rail.kind === 'warning' ? 'warn' : 'info');
		}
		lastKey = key;
	});

	function openWeather() {
		onopen?.();
	}
</script>

{#if rail}
	<button
		type="button"
		class="rail kind-{rail.kind}"
		data-kind={rail.kind}
		onclick={openWeather}
		aria-label="Open weather. {rail.title}"
	>
		<span class="mark" aria-hidden="true">
			{#if rail.kind === 'warning'}
				<svg viewBox="0 0 24 24" fill="none">
					<path
						d="M12 9v4m0 4h.01M10.29 3.86 2.11 18.05A1.5 1.5 0 0 0 3.5 20.5h17a1.5 1.5 0 0 0 1.39-2.45L13.71 3.86a1.5 1.5 0 0 0-2.42 0Z"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			{:else if rail.kind === 'rain'}
				<svg viewBox="0 0 24 24" fill="none">
					<path
						d="M7 16a4 4 0 0 1 .5-7.97A5.5 5.5 0 0 1 18 10a3.5 3.5 0 0 1-.5 6.97"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
					<path
						d="M9 19l-1 2m5-2l-1 2m5-2l-1 2"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
					/>
				</svg>
			{:else}
				<svg viewBox="0 0 24 24" fill="none">
					<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8" />
					<path d="M12 11v5m0-8h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
				</svg>
			{/if}
		</span>
		<span class="copy">
			<span class="kicker">{rail.kicker}</span>
			<span class="title">{rail.title}</span>
			{#if rail.body}
				<span class="body">{rail.body}</span>
			{/if}
		</span>
	</button>
{/if}

<style>
	.rail {
		appearance: none;
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 26;
		display: flex;
		align-items: center;
		gap: var(--space-4);
		min-height: 4.5rem;
		margin: 0;
		padding: var(--space-3) var(--space-6);
		padding-right: max(var(--space-6), calc(50vw - 10rem));
		border: 0;
		border-bottom: 2px solid transparent;
		border-radius: 0;
		text-align: left;
		cursor: pointer;
		color: var(--foreground);
		font-family: var(--font-body);
		box-sizing: border-box;
	}
	.rail:focus {
		outline: none;
	}
	.rail:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
	}
	.rail:active {
		filter: brightness(1.08);
	}
	.mark {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.75rem;
		height: 2.75rem;
		flex-shrink: 0;
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, currentColor 16%, transparent);
	}
	.mark svg {
		width: 1.55rem;
		height: 1.55rem;
		display: block;
	}
	.copy {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
		max-width: min(36rem, 42vw);
	}
	.kicker {
		font-size: var(--text-base);
		font-weight: 600;
		letter-spacing: -0.01em;
		color: color-mix(in srgb, currentColor 82%, var(--foreground));
	}
	.title {
		font-size: clamp(1.5rem, 2.4vw, 2rem);
		font-weight: 700;
		font-style: normal;
		letter-spacing: -0.03em;
		line-height: 1.15;
		overflow-wrap: anywhere;
	}
	.body {
		font-size: var(--text-lg);
		color: var(--text-secondary);
		line-height: 1.25;
		overflow-wrap: anywhere;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.kind-warning {
		color: var(--warn);
		background: color-mix(in srgb, var(--warn) 22%, var(--abyss));
		border-bottom-color: color-mix(in srgb, var(--warn) 48%, transparent);
	}
	.kind-watch {
		color: var(--solve);
		background: color-mix(in srgb, var(--solve) 20%, var(--abyss));
		border-bottom-color: color-mix(in srgb, var(--solve) 42%, transparent);
	}
	.kind-rain {
		color: var(--scan);
		background: color-mix(in srgb, var(--scan) 20%, var(--abyss));
		border-bottom-color: color-mix(in srgb, var(--scan) 42%, transparent);
	}
	.kind-warning .title,
	.kind-watch .title,
	.kind-rain .title {
		color: var(--foreground);
	}
	@media (hover: hover) {
		.rail:hover {
			filter: brightness(1.06);
		}
	}
	@media (max-width: 768px) {
		.rail {
			padding-right: var(--space-4);
			min-height: 3.75rem;
		}
		.copy {
			max-width: 100%;
		}
	}
</style>
