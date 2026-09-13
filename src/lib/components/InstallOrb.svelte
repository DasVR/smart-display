<!--
	Hallmark design scores
	Philosophy 4 · Hierarchy 5 · Execution 4 · Specificity 5 · Restraint 4 · Variety 5
	Satellite to the Dynamic Island: smaller abyss pill, matrix beads, progress.
-->
<script>
	import { fly, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import DotMatrix from '$lib/components/DotMatrix.svelte';
	import { installBeads } from '$lib/hostUpgradeModel.js';

	let { progress = null } = $props();

	let active = $derived(Boolean(progress?.active));
	let percent = $derived(Number(progress?.percent));
	let indeterminate = $derived(active && !(percent >= 0));
	let beads = $derived(installBeads(percent, progress?.total || 0));
	let label = $derived(progress?.current || progress?.lastCompleted || '');
	let count = $derived.by(() => {
		const total = Number(progress?.total) || 0;
		const done = Number(progress?.done) || 0;
		if (total > 0) return `${done}/${total}`;
		if (percent >= 0) return `${Math.round(percent)}%`;
		return '';
	});
	let barWidth = $derived(indeterminate ? 36 : Math.max(0, Math.min(100, percent || 0)));
</script>

{#if active}
	<div
		class="orb"
		class:ok={progress?.phase === 'done'}
		class:err={progress?.phase === 'error'}
		class:busy={indeterminate}
		in:fly={{ y: -8, duration: 320, easing: cubicOut }}
		out:fade={{ duration: 180 }}
		role="status"
		aria-live="polite"
		aria-label={progress?.title || 'Installing'}
	>
		<div class="neck" aria-hidden="true"></div>
		<div class="pill">
			<DotMatrix opacity={0.2} />
			<div class="row">
				<span class="kicker">{progress?.title || 'Installing packages'}</span>
				{#if count}
					<span class="count">{count}</span>
				{/if}
			</div>
			<div class="beads" aria-hidden="true">
				{#each beads as on, i (i)}
					<i class:on></i>
				{/each}
			</div>
			<div class="track" class:pulse={indeterminate}>
				<span class="fill" style="width: {barWidth}%"></span>
			</div>
			{#key label}
				<p class="current">{label || 'Working'}</p>
			{/key}
		</div>
	</div>
{/if}

<style>
	.orb {
		position: relative;
		margin-top: -0.35rem;
		z-index: 0;
		pointer-events: none;
		display: flex;
		flex-direction: column;
		align-items: center;
	}
	.neck {
		width: 2.6rem;
		height: 1.05rem;
		margin-bottom: -0.45rem;
		background: var(--abyss);
		filter: url(#island-goo);
	}
	.pill {
		position: relative;
		isolation: isolate;
		width: 13.2rem;
		max-width: min(13.2rem, 72vw);
		padding: 0.42rem 0.8rem 0.48rem;
		border-radius: 1.15rem;
		background-color: var(--abyss);
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.4'/%3E%3C/svg%3E");
		background-blend-mode: overlay;
		background-size: 140px 140px;
		box-shadow:
			0 10px 24px color-mix(in srgb, var(--abyss) 70%, transparent),
			0 4px 12px color-mix(in srgb, var(--abyss) 40%, transparent);
		overflow: hidden;
		color: var(--foreground);
	}
	.row {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.kicker {
		margin: 0;
		font-family: var(--font-body);
		font-size: 0.92rem;
		font-weight: 600;
		letter-spacing: -0.02em;
		color: var(--brand);
	}
	.ok .kicker {
		color: var(--ok);
	}
	.err .kicker {
		color: var(--warn);
	}
	.count {
		font-family: var(--font-code);
		font-size: 0.72rem;
		font-weight: 500;
		color: var(--text-tertiary);
	}
	.beads {
		position: relative;
		z-index: 1;
		display: flex;
		gap: 0.18rem;
		margin-top: 0.32rem;
	}
	.beads i {
		width: 0.38rem;
		height: 0.38rem;
		border-radius: 50%;
		background: color-mix(in srgb, var(--foreground) 14%, transparent);
		flex: 1;
		max-width: 0.42rem;
	}
	.beads i.on {
		background: var(--scan);
	}
	.ok .beads i.on {
		background: var(--ok);
	}
	.track {
		position: relative;
		z-index: 1;
		height: 0.22rem;
		margin-top: 0.38rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--foreground) 12%, transparent);
		overflow: hidden;
	}
	.fill {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--scan);
	}
	.ok .fill {
		background: var(--ok);
	}
	.err .fill {
		background: var(--warn);
	}
	@media (prefers-reduced-motion: no-preference) {
		.fill {
			transition: width 280ms var(--spring-smooth);
		}
		.track.pulse .fill {
			animation: orb-pulse 1.1s var(--spring-smooth) infinite;
		}
	}
	@keyframes orb-pulse {
		from {
			margin-left: 0;
		}
		to {
			margin-left: 64%;
		}
	}
	.current {
		position: relative;
		z-index: 1;
		margin: 0.28rem 0 0;
		font-family: var(--font-code);
		font-size: 0.74rem;
		font-weight: 500;
		letter-spacing: -0.01em;
		color: var(--text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
