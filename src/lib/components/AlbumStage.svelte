<script>
	import { bassLevel } from '$lib/services/audioReactive.js';

	let { track = null, cards = [], playing = false } = $props();

	let artFailed = $state(false);
	let lastArtUrl = null;
	let pulse = $derived(playing ? 1 + $bassLevel * 0.045 : 1);

	$effect(() => {
		const art = track?.art;
		if (art !== lastArtUrl) {
			lastArtUrl = art;
			artFailed = false;
		}
	});
</script>

<div class="art-slot" class:playing style="--pulse: {pulse}">
	<div class="art-stage" class:peeks={cards.length > 1}>
		{#each cards as card (card.key)}
			<div
				class="album-card"
				class:current={card.slot === 'current'}
				class:prev={card.slot === 'prev'}
				class:next={card.slot === 'next'}
				class:playing={card.slot === 'current' && playing}
				aria-hidden={card.slot !== 'current'}
			>
				{#if card.slot === 'current' && card.art && !artFailed}
					<img class="art-image" src={card.art} alt="" onerror={() => (artFailed = true)} />
				{:else if card.art}
					<img class="art-image" src={card.art} alt="" />
				{:else if card.slot === 'current'}
					<div class="vinyl-groove"></div>
					<div class="center-label"></div>
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
		perspective: 980px;
	}
	.art-stage {
		position: relative;
		width: min(100%, 42vh, 420px);
		aspect-ratio: 1;
		max-height: 100%;
		display: grid;
		place-items: center;
		transform-style: preserve-3d;
	}
	:global(.with-lyrics) .art-stage {
		width: min(100%, 28vh, 280px);
	}
	.album-card {
		grid-area: 1 / 1;
		width: 100%;
		aspect-ratio: 1;
		border-radius: var(--radius-lg);
		border: 1px solid var(--hairline);
		background: linear-gradient(160deg, var(--abyss-2) 0%, var(--abyss) 62%, color-mix(in srgb, var(--brand) 12%, var(--abyss)) 100%);
		overflow: hidden;
		box-shadow: var(--elevation-2);
		transform-origin: center center;
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.album-card.prev,
	.album-card.next {
		z-index: 0;
		filter: brightness(0.38) saturate(0.78);
		pointer-events: none;
	}
	.album-card.prev {
		transform: translateX(-46%) rotateY(28deg) scale(0.78);
	}
	.album-card.next {
		transform: translateX(46%) rotateY(-28deg) scale(0.78);
	}
	.album-card.current {
		z-index: 2;
		box-shadow: var(--elevation-3);
		transform: scale(var(--pulse, 1));
		filter: none;
	}
	@media (prefers-reduced-motion: no-preference) {
		.album-card {
			transition:
				transform 620ms var(--spring-smooth),
				filter 480ms var(--spring-smooth),
				box-shadow 480ms var(--spring-smooth);
		}
		.album-card.current.playing {
			animation: art-drift 9s ease-in-out infinite;
		}
		.album-card.current.playing .vinyl-groove {
			animation: spin 8s linear infinite;
		}
	}
	@keyframes art-drift {
		0%, 100% { transform: scale(var(--pulse, 1)) translate3d(0, 0, 0) rotate(0deg); }
		50% { transform: scale(var(--pulse, 1)) translate3d(0, -4px, 0) rotate(0.6deg); }
	}
	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}
	.art-image {
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: center;
		display: block;
	}
	.vinyl-groove {
		position: absolute;
		inset: clamp(24px, 4vh, 48px);
		border-radius: 50%;
		border: 2px solid var(--hairline);
		box-shadow: inset 0 0 50px color-mix(in srgb, var(--background) 70%, transparent);
	}
	.vinyl-groove::before,
	.vinyl-groove::after {
		content: '';
		position: absolute;
		border-radius: 50%;
		border: 1px solid var(--hairline);
	}
	.vinyl-groove::before { inset: clamp(20px, 3vh, 36px); }
	.vinyl-groove::after { inset: clamp(48px, 7vh, 80px); }
	.center-label {
		width: clamp(56px, 8vh, 90px);
		height: clamp(56px, 8vh, 90px);
		border-radius: 50%;
		background: var(--abyss-2);
		border: 2px solid var(--hairline);
		z-index: 2;
	}
</style>
