<!--
	The Music deck's record. The current album sits in its sleeve; while the
	track plays, the record slides half out to the right and spins, its label
	cut from the album art. Tracks from earlier in the session lean away on
	either side like sleeves in a crate (after the vinyl crate on the
	spacehey-personal profile).
-->
<script>
	import { bassLevel } from '$lib/services/audioReactive.js';

	let { track = null, cards = [], playing = false } = $props();

	let artFailed = $state(false);
	let lastArtUrl = null;
	let pulse = $derived(playing ? 1 + $bassLevel * 0.035 : 1);
	let labelArt = $derived(track?.art && !artFailed ? track.art : '');

	$effect(() => {
		const art = track?.art;
		if (art !== lastArtUrl) {
			lastArtUrl = art;
			artFailed = false;
		}
	});
</script>

<div class="art-slot" class:playing style="--pulse: {pulse}">
	<div class="deck-stage" class:peeks={cards.length > 1}>
		<!-- The record sits behind the current sleeve; it slides out and spins
		     only while playing, so a paused track reads as "back in the sleeve". -->
		<div class="record" aria-hidden="true">
			<div class="vinyl">
				{#if labelArt}
					<img class="label" src={labelArt} alt="" />
				{:else}
					<span class="label blank"></span>
				{/if}
				<span class="spindle"></span>
			</div>
			<span class="sheen"></span>
		</div>
		{#each cards as card (card.key)}
			<div
				class="album-card"
				class:current={card.slot === 'current'}
				class:prev={card.slot === 'prev'}
				class:next={card.slot === 'next'}
				aria-hidden={card.slot !== 'current'}
			>
				{#if card.slot === 'current' && card.art && !artFailed}
					<img class="art-image" src={card.art} alt="" onerror={() => (artFailed = true)} />
				{:else if card.art && card.slot !== 'current'}
					<img class="art-image" src={card.art} alt="" />
				{:else}
					<div class="sleeve-blank"></div>
				{/if}
			</div>
		{/each}
	</div>
</div>

<style>
	.art-slot {
		min-width: 0;
		min-height: 0;
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		position: relative;
		perspective: 900px;
		perspective-origin: 50% 40%;
	}
	.deck-stage {
		--sleeve: min(72%, 34vh, 340px);
		position: relative;
		width: var(--sleeve);
		aspect-ratio: 1;
		display: grid;
		place-items: center;
		transform-style: preserve-3d;
		/* shift left while the record is out, so sleeve + record stay centred */
		transition: transform 700ms var(--spring-smooth);
	}
	.playing .deck-stage {
		transform: translateX(-17%);
	}

	/* ---- sleeves ---- */
	.album-card {
		grid-area: 1 / 1;
		width: 100%;
		aspect-ratio: 1;
		border-radius: var(--radius-sm);
		background: linear-gradient(160deg, var(--abyss-2) 0%, var(--abyss) 62%, color-mix(in srgb, var(--brand) 12%, var(--abyss)) 100%);
		overflow: hidden;
		position: relative;
		transform-origin: center center;
		box-shadow:
			0 0 0 1px color-mix(in srgb, var(--foreground) 9%, transparent),
			0 22px 44px -14px color-mix(in srgb, #000 75%, transparent);
	}
	.album-card.current {
		z-index: 3;
		transform: scale(var(--pulse, 1));
	}
	/* Earlier/later tracks lean away like sleeves in a crate. */
	.album-card.prev,
	.album-card.next {
		z-index: 0;
		filter: brightness(0.34) saturate(0.7);
		pointer-events: none;
	}
	.album-card.prev {
		transform: translateX(-58%) translateZ(-140px) rotateY(58deg);
	}
	.album-card.next {
		transform: translateX(96%) translateZ(-170px) rotateY(-58deg);
	}
	.art-image {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		/* 1px light outline for consistent image depth on a dark field */
		outline: 1px solid oklch(1 0 0 / 0.1);
		outline-offset: -1px;
	}
	.sleeve-blank {
		position: absolute;
		inset: 18%;
		border-radius: 50%;
		border: 1px solid var(--hairline);
		box-shadow: inset 0 0 0 1.4rem color-mix(in srgb, var(--foreground) 3%, transparent);
	}

	/* ---- the record ---- */
	.record {
		grid-area: 1 / 1;
		z-index: 2;
		width: 94%;
		aspect-ratio: 1;
		border-radius: 50%;
		position: relative;
		transform: translateX(0);
		transition: transform 700ms var(--spring-smooth);
		box-shadow: 0 18px 40px -12px color-mix(in srgb, #000 80%, transparent);
	}
	.playing .record {
		transform: translateX(46%);
	}
	.vinyl {
		position: absolute;
		inset: 0;
		border-radius: 50%;
		display: grid;
		place-items: center;
		/* pressed grooves: fine concentric rings over near-black */
		background:
			repeating-radial-gradient(
				circle at 50% 50%,
				color-mix(in srgb, var(--foreground) 5%, #080809) 0 1px,
				#080809 1px 3px
			);
	}
	.label {
		width: 36%;
		aspect-ratio: 1;
		border-radius: 50%;
		object-fit: cover;
		display: block;
		outline: 1px solid oklch(1 0 0 / 0.12);
	}
	.label.blank {
		background: var(--brand);
	}
	.spindle {
		position: absolute;
		width: 3.5%;
		aspect-ratio: 1;
		border-radius: 50%;
		background: var(--abyss);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--foreground) 25%, transparent);
	}
	/* light catching the grooves: stays put while the vinyl turns under it */
	.sheen {
		position: absolute;
		inset: 0;
		border-radius: 50%;
		background: conic-gradient(
			from 200deg,
			transparent 0 8%,
			color-mix(in srgb, var(--foreground) 10%, transparent) 14%,
			transparent 22% 58%,
			color-mix(in srgb, var(--foreground) 7%, transparent) 64%,
			transparent 72%
		);
		pointer-events: none;
	}
	@media (prefers-reduced-motion: no-preference) {
		.album-card {
			transition:
				transform 620ms var(--spring-smooth),
				filter 480ms var(--spring-smooth);
		}
		.vinyl {
			/* 33⅓ rpm is 1.8 s a turn; a slower turn reads calmer across a room */
			animation: spin 3.6s linear infinite;
			animation-play-state: paused;
		}
		.playing .vinyl {
			animation-play-state: running;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.deck-stage,
		.record {
			transition: none;
		}
	}
	/* Eco / frozen quality: hold the record still. */
	:global(.display-shell.eco) .vinyl,
	:global(.display-shell.frozen) .vinyl {
		animation-play-state: paused;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
