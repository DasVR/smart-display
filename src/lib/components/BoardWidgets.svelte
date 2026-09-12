<!--
	Hallmark design scores
	Philosophy 4 · Hierarchy 4 · Execution 4 · Specificity 5 · Restraint 5 · Variety 4
	Sun, wind, and next-rain chips for the clock face.
-->
<script>
	import { fmtSunTime } from '$lib/atmosphere.js';

	let { atm, prediction = null, compact = false } = $props();

	let rainLabel = $derived.by(() => {
		const p = prediction || {};
		if (p.etaMin != null && p.etaMin <= 120 && (p.approaching || p.rain60min >= 0.2)) {
			if (p.etaMin <= 5) return 'Rain now';
			return `Rain ${p.etaMin} min`;
		}
		if ((p.rain60min ?? 0) >= 0.55) return 'Rain likely';
		return 'Dry hour';
	});
	let rainHot = $derived.by(() => {
		const p = prediction || {};
		return Boolean(p.approaching) || (p.rain60min ?? 0) >= 0.55;
	});
	let windLabel = $derived.by(() => {
		if (!atm) return '--';
		const spd = Number(atm.windSpeed);
		const mph = Number.isFinite(spd) ? Math.round(spd) : '--';
		if (!atm.compass || atm.compass === '--') return `${mph} mph`;
		return `${atm.compass} ${mph} mph`;
	});
</script>

{#if atm}
	<div class="widgets" class:compact>
		<div class="chip">
			<span class="k">Sun</span>
			<span class="v">{fmtSunTime(atm.sunrise)} / {fmtSunTime(atm.sunset)}</span>
		</div>
		<div class="chip">
			<span class="k">Wind</span>
			<span class="v">{windLabel}</span>
		</div>
		<div class="chip" class:hot={rainHot}>
			<span class="k">Radar</span>
			<span class="v">{rainLabel}</span>
		</div>
	</div>
{/if}

<style>
	.widgets {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		min-width: 0;
		pointer-events: none;
	}
	.chip {
		display: flex;
		flex-direction: column;
		gap: 0.1em;
		min-width: 0;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--foreground) 5%, transparent);
		border: 1px solid var(--hairline);
	}
	.k {
		font-size: var(--text-sm);
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-tertiary);
	}
	.v {
		font-family: var(--font-body);
		font-size: var(--text-lg);
		font-weight: 600;
		letter-spacing: -0.02em;
		color: var(--foreground);
		white-space: nowrap;
	}
	.chip.hot .k,
	.chip.hot .v {
		color: var(--scan);
	}
	.compact .chip {
		flex-direction: row;
		align-items: baseline;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-3);
		background: transparent;
		border: 0;
	}
	.compact .v {
		font-size: var(--text-base);
		color: var(--text-secondary);
	}
</style>
