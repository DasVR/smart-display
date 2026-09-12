<!--
	Hallmark design scores
	Philosophy 4 · Hierarchy 4 · Execution 4 · Specificity 5 · Restraint 5 · Variety 4
	Trough chips for live health: downed services, recoveries, container drops.
	Replaces sun / wind / radar in the bottom bar so the island can stay a nub.
-->
<script>
	import { islandActivities } from '$lib/stores.js';
	import { dockChips } from '$lib/islandLive.js';

	let chips = $derived(dockChips($islandActivities));

	function kicker(chip) {
		if (chip.kind === 'stack') return 'Status';
		if (chip.kind === 'containers') return 'Containers';
		if (chip.kind === 'network') return 'Network';
		return chip.title || 'Status';
	}

	function value(chip) {
		if (chip.kind === 'stack') return chip.title;
		return chip.body || '';
	}
</script>

{#if chips.length}
	<div class="status-dock" aria-label="System status">
		{#each chips as chip (chip.id)}
			<div class="chip sev-{chip.severity}">
				<span class="k">{kicker(chip)}</span>
				<span class="v">{value(chip)}</span>
			</div>
		{/each}
	</div>
{/if}

<style>
	.status-dock {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-2);
		min-width: 0;
		pointer-events: none;
	}
	.chip {
		display: flex;
		flex-direction: row;
		align-items: baseline;
		gap: var(--space-2);
		min-width: 0;
		padding: var(--space-1) var(--space-3);
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
		font-size: var(--text-base);
		font-weight: 600;
		letter-spacing: -0.02em;
		color: var(--text-secondary);
		white-space: nowrap;
	}
	.sev-error .k,
	.sev-error .v {
		color: var(--warn);
	}
	.sev-warn .k,
	.sev-warn .v {
		color: var(--solve);
	}
	.sev-ok .k,
	.sev-ok .v {
		color: var(--ok);
	}
</style>
