<!--
	Volume as one row: mute, a fat slider you can drag anywhere on, and the
	percentage. The fill is a transform (scaleX) so dragging never lays out.
-->
<script>
	let { volume = 0.6, muted = false, error = '', onvolume = () => {}, onmute = () => {} } = $props();

	let shown = $derived(muted ? 0 : volume);
</script>

<section class="strip" aria-label="Volume" ontouchstart={(e) => e.stopPropagation()} ontouchend={(e) => e.stopPropagation()}>
	<button class="mute" class:muted type="button" aria-pressed={muted} aria-label={muted ? 'Unmute' : 'Mute'} onclick={onmute}>
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M4 9v6h4l5 5V4L8 9H4z" />
			{#if muted}
				<path d="M16 9l5 6M21 9l-5 6" />
			{:else}
				<path d="M16.5 8.5a5 5 0 0 1 0 7" />
				<path d="M19 6a8.5 8.5 0 0 1 0 12" />
			{/if}
		</svg>
	</button>
	<div class="track">
		<span class="fill" style:transform="scaleX({shown})" aria-hidden="true"></span>
		<input
			type="range"
			min="0"
			max="1"
			step="0.01"
			value={volume}
			aria-label="Volume"
			aria-valuetext="{Math.round(shown * 100)} percent"
			oninput={(e) => onvolume(Number(e.currentTarget.value))}
		/>
	</div>
	<span class="pct num">{Math.round(shown * 100)}</span>
</section>
{#if error}<p class="note" role="status">{error}</p>{/if}

<style>
	.strip {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		touch-action: manipulation;
	}
	.mute {
		flex: none;
		width: 2.75rem;
		height: 2.75rem;
		display: grid;
		place-items: center;
		border-radius: 50%;
		border: 1px solid var(--hairline);
		background: var(--shell-fill);
		color: var(--foreground);
		cursor: pointer;
		touch-action: manipulation;
		transition: transform 120ms var(--ease-standard), color 160ms var(--ease-standard), border-color 160ms var(--ease-standard);
	}
	.mute:active { transform: scale(0.94); }
	.mute.muted {
		color: var(--warn);
		border-color: color-mix(in srgb, var(--warn) 40%, transparent);
	}
	.mute svg {
		width: 1.25rem;
		height: 1.25rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.9;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.mute:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }

	.track {
		position: relative;
		flex: 1;
		height: 2.75rem;
		display: grid;
		align-items: center;
	}
	.track::before,
	.fill {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		height: 0.7rem;
		border-radius: 999px;
	}
	.track::before {
		background: var(--shell-fill);
		box-shadow: inset 0 0 0 1px var(--hairline);
	}
	.fill {
		background: linear-gradient(90deg, var(--brand-30), var(--brand));
		transform-origin: left center;
		/* follows the finger while dragging; settles when the wall answers */
		transition: transform 90ms linear;
	}
	.track input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		margin: 0;
		opacity: 0;
		cursor: pointer;
		touch-action: none;
	}
	.track:has(input:focus-visible) .fill { outline: 2px solid var(--brand); outline-offset: 3px; }
	.pct {
		flex: none;
		min-width: 2.6ch;
		text-align: right;
		font-size: var(--text-sm);
		font-weight: 700;
		color: var(--text-secondary);
	}
	.note {
		margin: var(--space-2) 0 0;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}
</style>
