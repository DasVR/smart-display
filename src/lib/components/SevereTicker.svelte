<!--
	Hallmark design scores
	Philosophy 4 · Hierarchy 5 · Execution 4 · Specificity 5 · Restraint 5 · Variety 4
	Full-width extreme NWS bar. Copy rolls; reduced motion holds still.
-->
<script>
	let { text = '' } = $props();
</script>

{#if text}
	<div class="ticker" role="status" aria-live="assertive">
		<div class="label">Extreme</div>
		<div class="viewport">
			<div class="track">
				<span class="copy">{text}</span>
			</div>
		</div>
	</div>
{/if}

<style>
	.ticker {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: center;
		gap: var(--space-4);
		width: 100%;
		min-width: 0;
		margin-top: var(--space-3);
		padding: var(--space-2) 0 var(--space-2) var(--space-4);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--warn) 16%, var(--abyss));
		border: 1px solid color-mix(in srgb, var(--warn) 42%, transparent);
		box-shadow: 0 0 28px color-mix(in srgb, var(--warn) 18%, transparent);
		overflow: hidden;
		box-sizing: border-box;
	}
	.label {
		font-family: var(--font-body);
		font-size: var(--text-sm);
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--warn);
		flex-shrink: 0;
	}
	.viewport {
		min-width: 0;
		overflow: hidden;
		mask-image: linear-gradient(90deg, transparent, #000 1.25rem, #000 calc(100% - 1.5rem), transparent);
	}
	.track {
		display: inline-flex;
		width: max-content;
		padding-left: 100%;
		will-change: transform;
	}
	.copy {
		font-family: var(--font-body);
		font-size: var(--text-lg);
		font-weight: 600;
		letter-spacing: -0.02em;
		color: var(--foreground);
		white-space: nowrap;
		padding-block: var(--space-1);
		padding-right: 4rem;
	}
	@media (prefers-reduced-motion: no-preference) {
		.track {
			animation: roll 22s linear infinite;
		}
	}
	@keyframes roll {
		from {
			transform: translateX(0);
		}
		to {
			transform: translateX(-100%);
		}
	}
</style>
