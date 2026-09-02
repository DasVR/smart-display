<script>
	let { data } = $props();

	function fmtTime(iso) {
		if (!iso) return '--';
		const d = new Date(iso);
		return d.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
	}

	function fmtDay(iso) {
		if (!iso) return '';
		const d = new Date(iso);
		const today = new Date();
		if (d.toDateString() === today.toDateString()) return 'Today';
		const tomorrow = new Date(today);
		tomorrow.setDate(today.getDate() + 1);
		if (d.toDateString() === tomorrow.toDateString()) return 'Tmrw';
		return d.toLocaleDateString('en-US', { weekday: 'short' });
	}

	function nextPrecipHours(hourly) {
		if (!hourly?.length) return [];
		const now = new Date();
		return hourly
			.filter((h) => new Date(h.time) >= now)
			.slice(0, 12)
			.map((h) => ({
				label: fmtTime(h.time),
				prob: h.precipitation_probability ?? 0,
				temp: h.temp,
				desc: h.weather_code
			}));
	}

	let precipHours = $derived(nextPrecipHours(data?.hourly));
	let alerts = $derived(data?.alerts || []);
	let pred = $derived(data?.prediction || { rain30min: 0, rain60min: 0, rain120min: 0 });
	let current = $derived(data?.current || {});

	function rainClass(score) {
		if (score >= 0.6) return 'high';
		if (score >= 0.35) return 'med';
		return 'low';
	}
</script>

<div class="weather-view">
	<header class="weather-header">
		<div class="left">
			<div class="big-temp">{current.temp ?? '--'}°</div>
			<div class="condition">
				<div class="desc">{current.desc ?? '--'}</div>
				<div class="feels">Feels like {current.feelsLike ?? '--'}° · Humidity {current.humidity ?? '--'}%</div>
			</div>
		</div>
		<div class="meta">
			<div class="meta-row"><span class="label">Wind</span> {current.windSpeed ?? '--'} mph · {current.windDirection ?? '--'}°</div>
			<div class="meta-row"><span class="label">Pressure</span> {current.pressure ?? '--'} hPa</div>
			<div class="meta-row"><span class="label">Clouds</span> {current.cloudCover ?? '--'}%</div>
		</div>
	</header>

	<section class="predictions">
		{#each [{ label: '30 min', val: pred.rain30min }, { label: '60 min', val: pred.rain60min }, { label: '120 min', val: pred.rain120min }] as p}
			<div class="pred-card {rainClass(p.val)}">
				<span class="pred-label">{p.label}</span>
				<span class="pred-val">{Math.round(p.val * 100)}%</span>
				<span class="pred-word">{p.val >= 0.6 ? 'likely' : p.val >= 0.35 ? 'maybe' : 'clear'}</span>
			</div>
		{/each}
	</section>

	<section class="chart-block">
		<h3 class="section-title">12h Precipitation Probability</h3>
		{#if precipHours.length > 0}
			<div class="chart" aria-hidden="true">
				{#each precipHours as h}
					<div class="bar-wrap">
						<div class="bar" class:warn={h.prob >= 60} class:med={h.prob >= 30 && h.prob < 60} style="height: {Math.max(8, Math.min(100, h.prob))}%"></div>
						<span class="bar-label">{h.label}</span>
					</div>
				{/each}
			</div>
		{:else}
			<div class="empty">No forecast data</div>
		{/if}
	</section>

	{#if alerts.length > 0}
		<section class="alerts">
			<h3 class="section-title">NWS Alerts</h3>
			{#each alerts as a}
				<div class="alert-card" data-severity={a.severity?.toLowerCase()}>
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
		padding: var(--space-7);
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		overflow-y: auto;
		box-sizing: border-box;
	}
	.weather-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: var(--space-6);
		flex-shrink: 0;
	}
	.left {
		display: flex;
		align-items: flex-end;
		gap: var(--space-5);
	}
	.big-temp {
		font-family: var(--font-display);
		font-size: clamp(64px, 7vw, 120px);
		font-weight: 700;
		line-height: 0.9;
		letter-spacing: -0.04em;
		color: var(--foreground);
	}
	.condition {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding-bottom: var(--space-2);
	}
	.desc {
		font-family: var(--font-display);
		font-size: var(--text-2xl);
		font-weight: 600;
		color: var(--brand);
	}
	.feels {
		font-size: var(--text-lg);
		color: var(--text-secondary);
	}
	.meta {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		text-align: right;
		font-size: var(--text-lg);
		color: var(--text-secondary);
	}
	.meta-row .label {
		color: var(--text-tertiary);
		margin-right: var(--space-2);
	}
	.predictions {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--space-4);
		flex-shrink: 0;
	}
	.pred-card {
		padding: var(--space-4);
		border-radius: var(--radius-bezel-inner);
		background: var(--shell-fill);
		border: 1px solid var(--hairline);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.pred-card.high {
		border-color: color-mix(in srgb, var(--warn) 40%, transparent);
	}
	.pred-card.med {
		border-color: color-mix(in srgb, var(--brand) 40%, transparent);
	}
	.pred-label {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}
	.pred-val {
		font-family: var(--font-display);
		font-size: var(--text-3xl);
		font-weight: 700;
		color: var(--foreground);
	}
	.pred-card.high .pred-val {
		color: var(--warn);
	}
	.pred-card.med .pred-val {
		color: var(--brand);
	}
	.pred-word {
		font-size: var(--text-sm);
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.section-title {
		margin: 0 0 var(--space-3) 0;
		font-family: var(--font-display);
		font-size: var(--text-lg);
		color: var(--text-tertiary);
		font-weight: 600;
	}
	.chart-block {
		flex-shrink: 0;
	}
	.chart {
		display: flex;
		align-items: flex-end;
		gap: var(--space-2);
		height: 120px;
		padding-bottom: var(--space-6);
		border-bottom: 1px solid var(--hairline);
	}
	.bar-wrap {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-1);
		min-width: 0;
	}
	.bar {
		width: 100%;
		min-height: 4px;
		border-radius: var(--radius-sm);
		background: linear-gradient(180deg, var(--brand) 0%, color-mix(in srgb, var(--brand) 30%, transparent) 100%);
		transition: height 0.4s var(--ease-fluid);
	}
	.bar-label {
		font-size: var(--text-xs);
		color: var(--text-tertiary);
		white-space: nowrap;
	}
	.bar.warn {
		background: linear-gradient(180deg, var(--warn) 0%, color-mix(in srgb, var(--warn) 30%, transparent) 100%);
	}
	.bar.med {
		background: linear-gradient(180deg, var(--brand) 0%, color-mix(in srgb, var(--brand) 30%, transparent) 100%);
	}
	.alerts {
		flex-shrink: 0;
	}
	.empty {
		font-size: var(--text-lg);
		color: var(--text-tertiary);
	}
	.alert-card {
		padding: var(--space-4);
		border-radius: var(--radius-bezel-inner);
		background: color-mix(in srgb, var(--warn) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--warn) 30%, transparent);
		margin-bottom: var(--space-3);
	}
	.alert-title {
		font-family: var(--font-display);
		font-size: var(--text-xl);
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
		font-size: var(--text-base);
		color: var(--text-secondary);
		line-height: 1.4;
	}
	@media (max-width: 768px) {
		.weather-header {
			flex-direction: column;
			align-items: flex-start;
		}
		.meta {
			text-align: left;
		}
		.predictions {
			grid-template-columns: 1fr;
		}
	}
</style>
