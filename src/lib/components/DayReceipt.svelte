<!--
	End-of-day receipt (src/lib/dayLog.js). When StandBy comes on at night,
	a strip of thermal paper prints out of the bottom of the screen with the
	day's tally, holds for a moment, then folds away. Tap it to put it away
	sooner. The paper is dimmed warm grey, not white, so it doesn't glare in
	a dark room.
-->
<script>
	import { onMount } from 'svelte';

	let { receipt, hold = 14000, onclose = null } = $props();

	let leaving = $state(false);
	const BARS = Array.from({ length: 38 }, (_, i) => 1 + ((i * 7 + 3) % 4));

	function close() {
		if (leaving) return;
		leaving = true;
		setTimeout(() => onclose?.(), 650);
	}

	onMount(() => {
		const t = setTimeout(close, hold);
		return () => clearTimeout(t);
	});
</script>

<button type="button" class="slot" class:leaving onclick={close} aria-label="Today's receipt. Tap to put it away.">
	<div class="paper" role="document">
		<p class="shop">SMART DISPLAY</p>
		<p class="center small">HOME · RECEIPT FOR THE DAY</p>
		<p class="center small">{receipt.dateText}</p>
		<hr />
		{#each receipt.lines as line, i (i)}
			<p class="line" class:sub={line.sub}>
				<span class="lbl">{line.sub ? '  ' : ''}{line.label}</span>
				<span class="dots" aria-hidden="true"></span>
				<span class="qty">{line.qty}</span>
			</p>
		{/each}
		<hr />
		<p class="line total">
			<span class="lbl">TOTAL</span>
			<span class="dots" aria-hidden="true"></span>
			<span class="qty">{receipt.total} THINGS</span>
		</p>
		<hr />
		<p class="center signoff">{receipt.signoff}</p>
		<div class="barcode" aria-hidden="true">
			{#each BARS as w, i (i)}<span style="width: {w}px"></span>{/each}
		</div>
		<p class="center small">THANK YOU · COME AGAIN TOMORROW</p>
	</div>
</button>

<style>
	.slot {
		position: relative;
		display: block;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		color: inherit;
		cursor: pointer;
		/* the "printer" mouth: paper is clipped where it emerges */
		overflow: hidden;
		filter: drop-shadow(0 24px 40px rgb(0 0 0 / 0.55));
	}
	.paper {
		--ink: #1d1b18;
		width: 22rem;
		padding: 1.6rem 1.4rem 2.2rem;
		background: linear-gradient(#cfc8b8, #c6bfae);
		color: var(--ink);
		font-family: var(--font-code);
		font-size: 0.95rem;
		line-height: 1.5;
		text-transform: uppercase;
		text-align: left;
		/* torn bottom edge: a zigzag of teeth */
		--tooth: 8px;
		mask:
			linear-gradient(#000 0 0) top / 100% calc(100% - var(--tooth)) no-repeat,
			conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) bottom / calc(2 * var(--tooth)) var(--tooth) repeat-x;
		-webkit-mask:
			linear-gradient(#000 0 0) top / 100% calc(100% - var(--tooth)) no-repeat,
			conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) bottom / calc(2 * var(--tooth)) var(--tooth) repeat-x;
		animation: print 1600ms steps(16, end) both;
	}
	@keyframes print {
		from {
			transform: translateY(100%);
		}
	}
	.leaving {
		animation: fold 600ms var(--spring-smooth) forwards;
	}
	@keyframes fold {
		to {
			transform: translateY(40%) scaleY(0.2) rotateX(70deg);
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.paper,
		.leaving {
			animation: none;
		}
	}
	p {
		margin: 0;
	}
	.shop {
		text-align: center;
		font-size: 1.35rem;
		font-weight: 700;
		letter-spacing: 0.18em;
	}
	.center {
		text-align: center;
	}
	.small {
		font-size: 0.78rem;
		opacity: 0.8;
	}
	hr {
		margin: 0.7rem 0;
		border: 0;
		border-top: 2px dashed color-mix(in srgb, var(--ink) 55%, transparent);
	}
	.line {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
	}
	.lbl {
		max-width: 70%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dots {
		flex: 1;
		border-bottom: 2px dotted color-mix(in srgb, var(--ink) 35%, transparent);
		transform: translateY(-0.3em);
	}
	.qty {
		font-weight: 700;
		white-space: nowrap;
	}
	.sub {
		font-size: 0.82rem;
		opacity: 0.78;
		text-transform: none;
	}
	.sub .lbl {
		padding-left: 1rem;
	}
	.sub .dots {
		visibility: hidden;
	}
	.total {
		font-size: 1.15rem;
		font-weight: 700;
	}
	.signoff {
		font-weight: 700;
		letter-spacing: 0.04em;
	}
	.barcode {
		display: flex;
		justify-content: center;
		gap: 2px;
		height: 2.6rem;
		margin: 1rem 0 0.5rem;
	}
	.barcode span {
		background: var(--ink);
	}
</style>
