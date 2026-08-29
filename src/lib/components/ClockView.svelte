<script>
	import { onMount } from 'svelte';
	let time = new Date();
	let colonVisible = true;
	export let compact = false;
	let mounted = false;

	onMount(() => {
		mounted = true;
		const t1 = setInterval(() => { time = new Date(); }, 1000);
		const t2 = setInterval(() => { colonVisible = !colonVisible; }, 1000);
		return () => { clearInterval(t1); clearInterval(t2); };
	});

	$: h = String(time.getHours()).padStart(2, '0');
	$: m = String(time.getMinutes()).padStart(2, '0');
	$: month = time.toLocaleDateString('en-US', { month: 'long' });
	$: day = time.getDate();
	$: weekday = time.toLocaleDateString('en-US', { weekday: 'long' });
	$: ampm = time.getHours() >= 12 ? 'PM' : 'AM';
	$: dispH = time.getHours() % 12 || 12;
	$: seconds = String(time.getSeconds()).padStart(2, '0');
</script>

<div class="clock-view" class:mounted class:compact>
	<div class="clock-face">
		<div class="time-row">
			<span class="digit">{dispH}</span>
			<span class="colon" class:on={colonVisible}>:</span>
			<span class="digit">{m}</span>
			<span class="colon small" class:on={colonVisible}>:</span>
			<span class="digit small">{seconds}</span>
			<span class="ampm">{ampm}</span>
		</div>
		<div class="date-row">{weekday}, {month} {day}</div>
	</div>
</div>

<style>
	.clock-view {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		position: relative;
		opacity: 0;
		transform: scale(0.98);
		transition: opacity 0.7s var(--ease-standard), transform 0.9s var(--ease-standard);
	}
	.clock-view.mounted { opacity: 1; transform: scale(1); }

	.clock-face {
		text-align: center;
		position: relative;
		width: 100%;
		padding: 0 60px;
	}
	.time-row {
		font-family: var(--font-display);
		font-size: clamp(140px, 22vw, 340px);
	}
	.clock-view.compact .time-row {
		font-size: clamp(60px, 10vw, 140px);
	}
	.clock-view.compact .date-row {
		font-size: clamp(16px, 2vw, 24px);
		margin-top: 6px;
		font-weight: 700;
		letter-spacing: -0.04em;
		line-height: 1;
		display: flex;
		align-items: baseline;
		justify-content: center;
		gap: 0.04em;
		color: var(--text-primary);
	}
	.digit { color: var(--text-primary); }
	.digit.small { font-size: 0.55em; opacity: 0.7; }
	.colon {
		color: var(--text-secondary);
		font-weight: 300;
		opacity: 0.25;
		transition: opacity 0.3s;
	}
	.colon.on { opacity: 1; color: var(--accent); }
	.colon.small { font-size: 0.55em; }
	.ampm {
		font-size: 0.12em;
		font-weight: 500;
		color: var(--text-tertiary);
		margin-left: 0.3em;
		align-self: flex-start;
		margin-top: 0.5em;
	}
	.date-row {
		margin-top: 28px;
		font-size: clamp(28px, 3.6vw, 50px);
		font-weight: 400;
		color: var(--text-secondary);
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
</style>
