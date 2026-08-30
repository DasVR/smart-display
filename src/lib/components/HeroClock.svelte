<script>
	let { time = new Date() } = $props();

	let colonOn = $derived(time.getSeconds() % 2 === 0);
	let dispH = $derived(time.getHours() % 12 || 12);
	let mm = $derived(String(time.getMinutes()).padStart(2, '0'));
	let ss = $derived(String(time.getSeconds()).padStart(2, '0'));
	let ampm = $derived(time.getHours() >= 12 ? 'PM' : 'AM');
</script>

<div class="hero-clock">
	<div class="time">
		<span class="num hour">{dispH}</span>
		<span class="colon" class:on={colonOn}>:</span>
		<span class="num">{mm}</span>
		<span class="seconds num">{ss}</span>
		<span class="ampm">{ampm}</span>
	</div>
</div>

<style>
	.hero-clock {
		min-width: 0;
		font-family: var(--font-display);
	}
	.time {
		display: flex;
		align-items: baseline;
		font-weight: 300;
		font-size: clamp(3.4rem, 7vw, 7rem);
		letter-spacing: -0.055em;
		line-height: 0.9;
		color: var(--foreground);
		font-family: var(--font-display);
		font-style: normal;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.colon {
		opacity: 0.28;
		transition: opacity 0.25s var(--ease-standard);
		margin: 0 2px;
		font-style: normal;
	}
	.colon.on {
		opacity: 1;
		color: var(--brand);
	}
	.seconds {
		margin-left: var(--space-2);
		font-size: 0.34em;
		font-weight: 400;
		color: var(--text-tertiary);
	}
	.ampm {
		margin-left: var(--space-2);
		font-size: 0.2em;
		font-weight: 500;
		color: var(--text-tertiary);
	}
</style>
