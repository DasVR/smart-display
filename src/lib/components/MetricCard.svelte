<script>
	import Sparkline from '$lib/components/Sparkline.svelte';

	let {
		label = '',
		value = '—',
		unit = '',
		hint = '',
		points = [],
		tone = 'cyan'
	} = $props();

	const stroke = $derived.by(() => {
		switch (tone) {
			case 'cyan':
				return 'rgb(34, 211, 238)';
			case 'violet':
				return 'rgb(167, 139, 250)';
			case 'emerald':
				return 'rgb(52, 211, 153)';
			case 'amber':
				return 'rgb(251, 191, 36)';
			default: {
				const _exhaustive = tone;
				return 'rgb(34, 211, 238)';
			}
		}
	});
</script>

<article
	data-glass
	class="metric-card rounded-2xl border border-white/10 bg-slate-950/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
	data-tone={tone}
>
	<div class="metric-label text-xs uppercase tracking-widest text-slate-400 font-medium">{label}</div>
	<div class="metric-row">
		<div class="metric-value text-6xl font-bold tracking-tight text-white">
			{value}<span class="metric-unit">{unit}</span>
		</div>
		{#if hint}
			<div class="metric-hint">{hint}</div>
		{/if}
	</div>
	<Sparkline {points} color={stroke} />
</article>

<style>
	.metric-card {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 18px 20px 12px;
		border-radius: 1rem;
		background: rgba(2, 6, 23, 0.42);
		border: 1px solid rgba(255, 255, 255, 0.1);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.12),
			0 18px 40px rgba(0, 0, 0, 0.28);
		backdrop-filter: blur(16px) saturate(1.45);
		-webkit-backdrop-filter: blur(16px) saturate(1.45);
		overflow: hidden;
		min-height: 0;
	}
	.metric-card::before {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		pointer-events: none;
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.05), transparent 42%);
	}
	.metric-label {
		font-size: 13px;
		font-weight: 500;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: rgb(148, 163, 184);
	}
	.metric-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}
	.metric-value {
		font-size: clamp(2.4rem, 3.6vw, 3.75rem);
		font-weight: 700;
		letter-spacing: -0.04em;
		line-height: 1;
		color: #fff;
	}
	.metric-unit {
		margin-left: 6px;
		font-size: 0.38em;
		font-weight: 500;
		letter-spacing: 0.04em;
		color: rgb(148, 163, 184);
	}
	.metric-hint {
		font-family: var(--font-display);
		font-size: 14px;
		color: rgb(100, 116, 139);
		letter-spacing: 0.04em;
	}
</style>
