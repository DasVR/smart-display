<script>
	import { isExtremeAlert, tickerText } from '$lib/nwsAlerts.js';
	import SevereTicker from './SevereTicker.svelte';

	let { data } = $props();

	let alerts = $derived(data?.alerts || []);
	let extremeCopy = $derived(tickerText(alerts.filter((a) => isExtremeAlert(a))));
	let pred = $derived(data?.prediction || {});
	let current = $derived(data?.current || {});
	let mesh = $derived(current.mesh || data?.mesh || {});

	let displayTemp = $derived.by(() => {
		const t = Number(current.temp);
		return Number.isFinite(t) ? Math.round(t) : '--';
	});
	let displayFeels = $derived.by(() => {
		const t = Number(current.feelsLike);
		return Number.isFinite(t) ? Math.round(t) : '--';
	});
	let displayHumidity = $derived.by(() => {
		const h = Number(current.humidity);
		return Number.isFinite(h) ? Math.round(h) : '--';
	});
	let displayPressure = $derived.by(() => {
		const p = Number(current.pressure);
		return Number.isFinite(p) ? Math.round(p) : '--';
	});

	let rainLine = $derived.by(() => {
		if (pred.etaMin != null && pred.etaMin <= 120 && (pred.approaching || pred.rain60min >= 0.2)) {
			if (pred.etaMin <= 5) return 'Rain arriving';
			return `Rain in ${pred.etaMin} min`;
		}
		return '';
	});

	let meshLine = $derived.by(() => {
		const n = Number(mesh.stationCount) || 0;
		if (n <= 0) return '';
		return n === 1 ? '1 nearby station' : `${n} nearby stations`;
	});
</script>

<div class="weather-view">
	{#if extremeCopy}
		<SevereTicker text={extremeCopy} />
	{/if}

	<div class="readout">
		<div class="big-temp">{displayTemp}°</div>
		<div class="desc">{current.desc ?? '--'}</div>
		<div class="feels">Feels {displayFeels}° · {displayHumidity}%</div>
		<div class="pressure">{displayPressure} hPa</div>
		{#if rainLine}
			<div class="rain-line">{rainLine}</div>
		{/if}
		{#if meshLine}
			<div class="mesh">{meshLine}</div>
		{/if}
	</div>

	{#if alerts.length > 0}
		<section class="alerts">
			{#each alerts as a}
				<div class="alert-card" class:extreme={isExtremeAlert(a)} data-severity={a.severity?.toLowerCase()}>
					<div class="alert-title">{a.event}</div>
					<div class="alert-sev">{a.severity}</div>
					<div class="alert-body">{a.headline}</div>
				</div>
			{/each}
		</section>
	{/if}
</div>

<style>
	.weather-view {
		height: 100%;
		width: 100%;
		min-height: 0;
		min-width: 0;
		padding: var(--space-5) var(--space-6);
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: var(--space-4);
		overflow: hidden;
		box-sizing: border-box;
	}
	.readout {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.15em;
		min-width: 0;
		max-width: 100%;
	}
	.big-temp {
		font-family: var(--font-display);
		font-size: clamp(64px, 6.2vw, 112px);
		font-weight: 700;
		line-height: 0.9;
		letter-spacing: -0.05em;
		color: var(--foreground);
	}
	.desc {
		font-family: var(--font-display);
		font-size: var(--text-xl);
		font-weight: 600;
		color: var(--brand);
		margin-top: var(--space-2);
	}
	.feels,
	.pressure {
		font-size: var(--text-base);
		color: var(--text-secondary);
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.pressure {
		color: var(--text-tertiary);
	}
	.rain-line {
		font-family: var(--font-display);
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--scan);
		margin-top: var(--space-1);
	}
	.mesh {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		margin-top: var(--space-1);
	}
	.alerts {
		flex-shrink: 1;
		min-height: 0;
		max-height: 30%;
		overflow: hidden;
	}
	.alert-card {
		padding: var(--space-3);
		border-radius: var(--radius-bezel-inner);
		background: color-mix(in srgb, var(--warn) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--warn) 30%, transparent);
		margin-bottom: var(--space-2);
	}
	.alert-card.extreme {
		background: color-mix(in srgb, var(--warn) 18%, transparent);
		border-color: color-mix(in srgb, var(--warn) 48%, transparent);
	}
	.alert-title {
		font-family: var(--font-display);
		font-size: var(--text-lg);
		font-weight: 700;
		color: var(--warn);
	}
	.alert-sev {
		font-size: var(--text-sm);
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		margin: var(--space-1) 0;
	}
	.alert-body {
		font-size: var(--text-sm);
		color: var(--text-secondary);
		line-height: 1.4;
	}
</style>
