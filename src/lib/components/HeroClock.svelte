<script>
	let { time = new Date() } = $props();

	function estParts(d) {
		const s = new Date(d).toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false });
		const [datePart, timePart] = s.split(', ');
		const [h, m, sPart] = timePart.split(':');
		const sec = sPart.split(' ')[0]; // handle any AM/PM if hour12 changes
		return { h: parseInt(h, 10), m: parseInt(m, 10), sec: parseInt(sec, 10) };
	}

	let est = $derived(estParts(time));
	let colonOn = $derived(est.sec % 2 === 0);
	let dispH = $derived(est.h % 12 || 12);
	let mm = $derived(String(est.m).padStart(2, '0'));
	let ss = $derived(String(est.sec).padStart(2, '0'));
	let ampm = $derived(est.h >= 12 ? 'PM' : 'AM');
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
		font-weight: 800;
		font-size: clamp(var(--text-7xl), 8vw, var(--text-8xl));
		letter-spacing: -0.04em;
		line-height: 0.88;
		color: var(--foreground);
		font-family: var(--font-display);
		font-style: normal;
		font-variant-numeric: tabular-nums;
		min-width: 0;
		white-space: nowrap;
	}
	.colon {
		opacity: 0.28;
		transform: scale(1);
		transform-origin: center 58%;
		margin: 0 0.125rem;
		font-style: normal;
		transition:
			opacity 420ms var(--spring-smooth),
			transform 420ms var(--spring-snappy),
			color 420ms var(--spring-smooth);
	}
	.colon.on {
		opacity: 1;
		transform: scale(1.04);
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
		font-size: 0.28em;
		font-weight: 700;
		color: var(--text-tertiary);
	}
</style>
