<script>
	import { onMount } from 'svelte';

	let time = new Date();
	let colonVisible = true;
	let mounted = false;

	onMount(() => {
		mounted = true;
		const t1 = setInterval(() => { time = new Date(); }, 1000);
		const t2 = setInterval(() => { colonVisible = !colonVisible; }, 1000);
		return () => { clearInterval(t1); clearInterval(t2); };
	});

	$: h = String(time.getHours()).padStart(2,'0');
	$: m = String(time.getMinutes()).padStart(2,'0');
	$: month = time.toLocaleDateString('en-US', { month: 'long' });
	$: day = time.getDate();
	$: weekday = time.toLocaleDateString('en-US', { weekday: 'long' });
	$: ampm = time.getHours() >= 12 ? 'PM' : 'AM';
	$: dispH = time.getHours() % 12 || 12;
</script>

<div class="clock-view" class:mounted>
	<div class="glow-backdrop"></div>
	<div class="clock-face">
		<div class="time-row">
			<span class="digit">{dispH}</span>
			<span class="colon" class:on={colonVisible}>:</span>
			<span class="digit">{m}</span>
			<span class="ampm">{ampm}</span>
		</div>
		<div class="date-row">{weekday}, {month} {day}</div>
	</div>
	<div class="hint">wake up, twin.</div>
</div>

<style>
	.clock-view {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		position: relative;
		opacity: 0;
		transform: scale(0.96);
		transition: opacity 0.6s cubic-bezier(0.22,1,0.36,1), transform 0.8s cubic-bezier(0.22,1,0.36,1);
	}
	.clock-view.mounted { opacity: 1; transform: scale(1); }

	.glow-backdrop {
		position: absolute;
		width: 600px; height: 600px;
		border-radius: 50%;
		background: radial-gradient(circle, rgba(69,42,132,0.15) 0%, transparent 70%);
		filter: blur(80px);
		animation: breathe 6s ease-in-out infinite;
	}
	@keyframes breathe {
		0%, 100% { transform: scale(1); opacity: 0.6; }
		50% { transform: scale(1.1); opacity: 1; }
	}

	.clock-face {
		text-align: center;
		position: relative;
		z-index: 2;
	}
	.time-row {
		font-family: 'JetBrains Mono', monospace;
		font-size: clamp(96px, 18vw, 240px);
		font-weight: 700;
		letter-spacing: -0.04em;
		line-height: 1;
		color: #f5f2ec;
		display: flex;
		align-items: baseline;
		justify-content: center;
		gap: 0.05em;
	}
	.digit {
		background: linear-gradient(180deg, #ffffff 0%, #a9b1f0 100%);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}
	.colon {
		color: rgba(255,255,255,0.3);
		font-weight: 300;
		transition: opacity 0.3s;
		opacity: 0.2;
	}
	.colon.on { opacity: 1; color: #00d992; text-shadow: 0 0 20px #00d99240; }
	.ampm {
		font-size: 0.18em;
		font-weight: 500;
		color: rgba(255,255,255,0.3);
		margin-left: 0.3em;
		align-self: flex-start;
		margin-top: 0.4em;
	}
	.date-row {
		font-size: clamp(18px, 2.5vw, 32px);
		font-weight: 300;
		color: rgba(255,255,255,0.4);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		margin-top: 16px;
	}
	.hint {
		position: absolute;
		bottom: 120px;
		font-size: 14px;
		color: rgba(255,255,255,0.12);
		font-family: 'JetBrains Mono', monospace;
		letter-spacing: 0.15em;
		text-transform: lowercase;
		animation: fadePulse 4s ease-in-out infinite;
	}
	@keyframes fadePulse {
		0%, 100% { opacity: 0.08; }
		50% { opacity: 0.2; }
	}
</style>
