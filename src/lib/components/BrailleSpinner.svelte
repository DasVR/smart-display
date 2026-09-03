<script>
	let { active = false } = $props();

	const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧'];
	let i = $state(0);

	$effect(() => {
		if (!active) return;
		const t = setInterval(() => {
			i = (i + 1) % FRAMES.length;
		}, 90);
		return () => clearInterval(t);
	});

	let glyph = $derived(active ? FRAMES[i] : '⠿');
</script>

<span class="spin" class:hot={active} aria-hidden="true">{glyph}</span>

<style>
	.spin {
		display: inline-block;
		width: 1.1em;
		font-family: var(--font-code);
		color: var(--text-tertiary);
		text-align: center;
	}
	.spin.hot {
		color: var(--ok);
	}
</style>
