<!--
	Honest senses (src/lib/sensesSign.js): a small fixed sign in the corner
	that says whether the camera and microphone are on. It never animates,
	so it can't be mistaken for decoration, and it stays away entirely when
	both are off.
-->
<script>
	import { sensesSign, signVisible } from '$lib/sensesSign.js';

	let { senses = null } = $props();
	let sign = $derived(sensesSign(senses ?? {}));
</script>

{#if signVisible(sign) || sign.guest}
	<div class="sign" role="status" aria-label={sign.label + (sign.guest ? ' · Guest mode' : '')}>
		{#if sign.guest}<span class="guest">Guest</span>{/if}
		{#if sign.camera !== 'off' || sign.mic !== 'off'}
			<span class="icon" data-state={sign.camera} title={sign.label}>
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<rect x="3" y="7" width="13" height="10" rx="2.5" />
					<path d="M16 10.5l5-3v9l-5-3" />
					{#if sign.camera === 'off'}<path class="slash" d="M3 4l18 16" />{/if}
				</svg>
			</span>
			<span class="icon" data-state={sign.mic}>
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<rect x="9" y="3" width="6" height="11" rx="3" />
					<path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
					{#if sign.mic === 'off'}<path class="slash" d="M4 4l16 16" />{/if}
				</svg>
			</span>
		{/if}
		{#if sign.notes}<span class="notes">Taking notes</span>{/if}
	</div>
{/if}

<style>
	.sign {
		position: fixed;
		top: 1.1rem;
		right: 1.4rem;
		z-index: 40;
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.3rem 0.65rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--abyss) 70%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--foreground) 10%, transparent);
		font: 600 0.62rem var(--font-body);
		letter-spacing: 0.04em;
		color: var(--text-secondary);
		pointer-events: none;
		/* deliberately still: no transition, no animation */
		transition: none;
		animation: none;
	}
	.icon {
		display: grid;
		place-items: center;
	}
	svg {
		width: 0.95rem;
		height: 0.95rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.9;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.icon[data-state='on'] {
		color: var(--foreground);
	}
	.icon[data-state='hearing'] {
		color: var(--brand);
	}
	.icon[data-state='down'] {
		color: var(--warn);
	}
	.icon[data-state='off'] {
		color: var(--text-tertiary);
		opacity: 0.7;
	}
	.notes {
		color: var(--warn);
		text-transform: uppercase;
	}
	.guest {
		color: var(--brand);
		text-transform: uppercase;
	}
</style>
