<script>
	let { time = new Date() } = $props();

	let colonOn = $derived(time.getSeconds() % 2 === 0);
	let dispH = $derived(time.getHours() % 12 || 12);
	let mm = $derived(String(time.getMinutes()).padStart(2, '0'));
	let ss = $derived(String(time.getSeconds()).padStart(2, '0'));
	let ampm = $derived(time.getHours() >= 12 ? 'PM' : 'AM');
	let weekday = $derived(time.toLocaleDateString('en-US', { weekday: 'long' }));
	let month = $derived(time.toLocaleDateString('en-US', { month: 'long' }));
	let day = $derived(time.getDate());
</script>

<div class="hero-clock">
	<div class="time">
		<span>{dispH}</span>
		<span class="colon" class:on={colonOn}>:</span>
		<span>{mm}</span>
		<span class="seconds">{ss}</span>
		<span class="ampm">{ampm}</span>
	</div>
	<div class="date">{weekday}, {month} {day}</div>
</div>

<style>
	.hero-clock {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.time {
		display: flex;
		align-items: baseline;
		font-weight: 300;
		font-size: clamp(3.4rem, 6.2vw, 6.2rem);
		letter-spacing: -0.05em;
		line-height: 0.95;
		color: #fff;
	}
	.colon {
		opacity: 0.25;
		transition: opacity 0.25s;
		margin: 0 2px;
	}
	.colon.on {
		opacity: 1;
		color: var(--accent);
	}
	.seconds {
		margin-left: 10px;
		font-size: 0.38em;
		font-weight: 400;
		letter-spacing: 0.04em;
		color: rgb(148, 163, 184);
		font-family: var(--font-display);
	}
	.ampm {
		margin-left: 8px;
		font-size: 0.22em;
		font-weight: 500;
		letter-spacing: 0.16em;
		color: rgb(100, 116, 139);
	}
	.date {
		font-size: clamp(1rem, 1.4vw, 1.35rem);
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: rgb(148, 163, 184);
		font-weight: 500;
	}
</style>
