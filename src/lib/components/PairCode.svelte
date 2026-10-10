<script>
	// The six-digit code a phone types to pair, shown big enough to read from
	// the couch, with the time it has left. Only the kiosk ever receives it.
	import { fade, scale } from 'svelte/transition';

	/** @type {{ code: string, expiresAt: number }} */
	let { code, expiresAt } = $props();

	let now = $state(Date.now());
	$effect(() => {
		const t = setInterval(() => (now = Date.now()), 500);
		return () => clearInterval(t);
	});
	let left = $derived(Math.max(0, Math.ceil((expiresAt - now) / 1000)));
	let digits = $derived(String(code).split(''));
</script>

<div class="pair-scrim" transition:fade={{ duration: 220 }}>
	<div class="pair chrome-ring" role="dialog" aria-labelledby="pair-title" transition:scale={{ start: 0.96, duration: 260 }}>
		<p class="kicker" id="pair-title">Pair a phone</p>
		<p class="code num" aria-label="Code {digits.join(' ')}">
			{#each digits as d, i (i)}
				<span class="digit">{d}</span>
				{#if i === 2}<span class="gap" aria-hidden="true"></span>{/if}
			{/each}
		</p>
		<p class="hint">Type this on the phone. {left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left` : 'Expired'}</p>
	</div>
</div>

<style>
	.pair-scrim {
		position: fixed;
		inset: 0;
		z-index: 55;
		display: grid;
		place-items: center;
		background: color-mix(in srgb, var(--abyss) 72%, transparent);
	}
	.pair {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.25rem;
		padding: 2.5rem 3.5rem;
		border-radius: 2rem;
		background: var(--abyss-1);
		box-shadow: 0 30px 80px color-mix(in srgb, var(--abyss) 60%, transparent);
	}
	.kicker {
		margin: 0;
		font-size: 1.6rem;
		font-weight: 600;
		color: var(--text-tertiary);
	}
	.code {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin: 0;
	}
	.digit {
		display: grid;
		place-items: center;
		width: 5.5rem;
		height: 7rem;
		border-radius: 1rem;
		background: var(--abyss-2);
		border: 1px solid var(--hairline);
		font-size: 4.6rem;
		font-weight: 700;
		color: var(--foreground);
	}
	.gap {
		width: 1.2rem;
	}
	.hint {
		margin: 0;
		font-size: 1.4rem;
		color: var(--text-secondary, var(--text-tertiary));
	}
</style>
