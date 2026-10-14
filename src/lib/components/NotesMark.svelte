<!--
	A small mark at the bottom of the wall while it is taking notes through the
	webcam's microphone, the way a recording light is: you should never have to
	wonder whether it's writing down what you say. "Hey wall, stop taking notes"
	(or the phone) ends it.
-->
<script>
	let { lines = 0, since = null } = $props();

	let now = $state(Date.now());
	$effect(() => {
		const t = setInterval(() => (now = Date.now()), 15000);
		return () => clearInterval(t);
	});
	let minutes = $derived(since ? Math.max(0, Math.floor((now - Date.parse(since)) / 60000)) : 0);
</script>

<div class="notes-mark" role="status" aria-live="polite">
	<span class="dot" aria-hidden="true"></span>
	<span class="label">Taking notes</span>
	<span class="meta">{lines} {lines === 1 ? 'line' : 'lines'}{minutes ? ` · ${minutes} min` : ''}</span>
</div>

<style>
	.notes-mark {
		position: fixed;
		z-index: 40;
		left: 50%;
		bottom: 2.2rem;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 0.8rem;
		padding: 0.7rem 1.4rem 0.7rem 1.1rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--abyss-1) 86%, transparent);
		box-shadow: 0 12px 40px color-mix(in srgb, var(--abyss) 50%, transparent);
		font-size: 1.35rem;
		color: var(--foreground);
		pointer-events: none;
	}
	.dot {
		width: 0.85rem;
		height: 0.85rem;
		border-radius: 50%;
		background: #ff5a4e;
		box-shadow: 0 0 0.9rem #ff5a4e;
		animation: breathe 2.4s ease-in-out infinite;
	}
	.label {
		font-weight: 600;
	}
	.meta {
		color: var(--text-tertiary);
		font-variant-numeric: tabular-nums;
	}
	@keyframes breathe {
		50% {
			opacity: 0.45;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.dot {
			animation: none;
		}
	}
</style>
