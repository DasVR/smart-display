<!--
	The mic key in the tab bar. Hold it and the voice sheet rises; let go and
	what you said goes to the wall. A ring fills around the key while you
	hold, so you can see the hold taking. A quick tap opens the sheet to type
	or tap-to-talk instead; the keyboard (Enter or Space) does the same.
	The gesture and the conversation live in src/lib/voiceSession.svelte.js.
-->
<script>
	import { voice, HOLD, pressDown, pressMoved, pressUp, pressCancelled, tap } from '$lib/voiceSession.svelte.js';

	let { el = $bindable(null) } = $props();

	function down(e) {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		e.currentTarget.setPointerCapture?.(e.pointerId);
		pressDown(e);
	}
	function up(e) {
		e.currentTarget.releasePointerCapture?.(e.pointerId);
		pressUp(e);
	}
	// a click with no pointer behind it is the keyboard (Enter, Space) or a screen reader
	function click(e) {
		if (e.detail === 0) tap();
	}

	let listening = $derived(voice.open && voice.phase === 'listening');
</script>

<button
	bind:this={el}
	class="key"
	class:pressing={voice.pressing}
	class:live={voice.open}
	class:listening
	type="button"
	aria-label="Talk to the display. Hold to speak, or tap to type."
	aria-haspopup="dialog"
	aria-expanded={voice.open}
	onpointerdown={down}
	onpointermove={pressMoved}
	onpointerup={up}
	onpointercancel={pressCancelled}
	onclick={click}
	oncontextmenu={(e) => e.preventDefault()}
	style:--hold="{HOLD.ms}ms"
>
	<span class="ring" aria-hidden="true"></span>
	<span class="face">
		<svg class="icon mic" viewBox="0 0 24 24" aria-hidden="true">
			<rect x="9" y="2.75" width="6" height="11" rx="3" />
			<path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
		</svg>
		<span class="icon bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
	</span>
</button>

<style>
	.key {
		--size: 4.1rem;
		position: relative;
		justify-self: center;
		align-self: center;
		width: var(--size);
		height: var(--size);
		margin: -0.8rem 0;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: none;
		color: var(--abyss);
		cursor: pointer;
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
		-webkit-tap-highlight-color: transparent;
		transition: transform 160ms var(--ease-standard);
	}
	.key:active,
	.key.pressing {
		transform: scale(0.93);
		transition-duration: 0ms;
	}
	.key:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 3px;
	}

	.face {
		position: absolute;
		inset: 0.48rem;
		display: grid;
		place-items: center;
		border-radius: 50%;
		background:
			radial-gradient(120% 120% at 30% 18%, color-mix(in srgb, white 55%, var(--brand)) 0%, var(--brand) 38%, color-mix(in srgb, var(--scan) 55%, var(--brand-30)) 100%);
		box-shadow: inset 0 1px 0 color-mix(in srgb, white 55%, transparent);
	}
	/* the glow is a gradient that reaches nothing at the key's own edge, so it never shows a box */
	.key::before {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: 50%;
		background: radial-gradient(circle, color-mix(in srgb, var(--brand) 46%, transparent) 40%, transparent 71%);
		opacity: 0.5;
		transition:
			opacity 220ms var(--ease-standard),
			transform 220ms var(--ease-standard);
	}
	.key.live::before,
	.key.pressing::before {
		opacity: 1;
		transform: scale(1.06);
	}

	.icon {
		grid-area: 1 / 1;
		width: 1.45rem;
		height: 1.45rem;
		transition:
			opacity 180ms var(--ease-standard),
			transform 180ms var(--ease-standard);
	}
	.mic {
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.bars {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.16rem;
		opacity: 0;
		transform: scale(0.6);
	}
	.bars i {
		display: block;
		width: 0.2rem;
		height: 0.4rem;
		border-radius: 999px;
		background: currentColor;
		transform-origin: center;
	}
	.key.listening .mic {
		opacity: 0;
		transform: scale(0.6);
	}
	.key.listening .bars {
		opacity: 1;
		transform: none;
	}
	.key.listening .bars i {
		animation: bar 900ms var(--ease-in-out) infinite alternate;
	}
	.bars i:nth-child(2) { animation-delay: -300ms; }
	.bars i:nth-child(3) { animation-delay: -620ms; }
	.bars i:nth-child(4) { animation-delay: -140ms; }
	@keyframes bar {
		from { transform: scaleY(0.5); }
		to { transform: scaleY(2.6); }
	}

	/* the hold ring: sweeps once around in the time a hold takes */
	.ring {
		position: absolute;
		inset: 0.14rem;
		border-radius: 50%;
		background: conic-gradient(var(--foreground) var(--sweep), transparent 0);
		-webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2px));
		mask: radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2px));
		opacity: 0;
		pointer-events: none;
	}
	.key.pressing:not(.live) .ring {
		opacity: 0.9;
		animation: charge var(--hold) linear forwards;
	}
	@property --sweep {
		syntax: '<angle>';
		inherits: false;
		initial-value: 0deg;
	}
	@keyframes charge {
		from { --sweep: 0deg; }
		to { --sweep: 360deg; }
	}

	@media (prefers-reduced-motion: reduce) {
		.key.listening .bars i {
			animation: none;
			transform: scaleY(1.8);
		}
	}
</style>
