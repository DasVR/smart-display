<script>
	import RollingDigit from './RollingDigit.svelte';

	let { time = new Date(), size = 'masthead' } = $props();

	function estParts(d) {
		const s = new Date(d).toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false });
		const [, timePart] = s.split(', ');
		const [h, m, sPart] = timePart.split(':');
		const sec = sPart.split(' ')[0];
		return { h: parseInt(h, 10), m: parseInt(m, 10), sec: parseInt(sec, 10) };
	}

	let est = $derived(estParts(time));
	let colonOn = $derived(est.sec % 2 === 0);
	let hh = $derived(String(est.h % 12 || 12).padStart(2, '0'));
	let mm = $derived(String(est.m).padStart(2, '0'));
	let ss = $derived(String(est.sec).padStart(2, '0'));
	let ampm = $derived(est.h >= 12 ? 'PM' : 'AM');
</script>

<div class="hero-clock" data-size={size}>
	<div class="time" aria-label="{hh}:{mm} {ampm}">
		<div class="pair">
			<span class="hour"><RollingDigit digit={+hh[0]} /><RollingDigit digit={+hh[1]} /></span>
			<span class="colon" class:on={colonOn}>:</span>
			<span class="minute"><RollingDigit digit={+mm[0]} /><RollingDigit digit={+mm[1]} /></span>
		</div>
		<div class="trail">
			<span class="seconds"><RollingDigit digit={+ss[0]} /><RollingDigit digit={+ss[1]} /></span>
			<span class="ampm">{ampm}</span>
		</div>
	</div>
</div>

<style>
	.hero-clock {
		min-width: 0;
		font-family: var(--font-display);
	}
	.time {
		display: flex;
		align-items: center;
		font-weight: 500;
		font-size: clamp(2.75rem, 6vw, 5rem);
		letter-spacing: 0;
		line-height: 1;
		color: var(--foreground);
		font-family: var(--font-display);
		font-style: normal;
		font-variant-numeric: tabular-nums;
		min-width: 0;
		white-space: nowrap;
	}
	.hero-clock[data-size='poster'] .time {
		font-size: clamp(5.5rem, 18vw, 12.75rem);
		font-weight: 500;
	}
	.pair {
		display: grid;
		grid-template-columns: 2ch auto 2ch;
		align-items: center;
		column-gap: 0;
	}
	.hour,
	.minute {
		display: flex;
		justify-content: center;
		align-items: center;
		width: 2ch;
		line-height: 1;
		transform: translateY(0.08em);
	}
	.colon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 0.42em;
		height: 1em;
		line-height: 1;
		opacity: 0.28;
		transform: scale(1);
		transform-origin: center center;
		margin: 0;
		font-style: normal;
		color: var(--text-secondary);
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
	.trail {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		gap: 0.12em;
		margin-left: 0.28em;
		line-height: 1;
	}
	.seconds {
		font-size: 0.28em;
		font-weight: 500;
		color: var(--text-tertiary);
		font-variant-numeric: tabular-nums;
		letter-spacing: normal;
		display: flex;
	}
	.ampm {
		font-size: 0.22em;
		font-weight: 600;
		color: var(--text-tertiary);
		letter-spacing: normal;
	}

	@media (max-width: 414px) {
		.hero-clock[data-size='poster'] .time {
			font-size: clamp(2.75rem, 18vw, 4.75rem);
		}
	}
</style>
