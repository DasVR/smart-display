<!--
	The Clock page as a piece of hardware (Teenage Engineering, Braun): no
	painting, off-white plastic, the time in round dot-matrix numerals with the
	seconds and AM/PM in signal orange, small monospaced labels, and today's
	list in a ruled box where what's late is a solid orange bar.
-->
<script>
	import DotDigits from './DotDigits.svelte';
	import WeatherGlyph from './WeatherGlyph.svelte';
	import { fmtSunTime } from '$lib/atmosphere.js';
	import { dateLine, skyFor, timeParts } from '$lib/clockFace.js';
	import { isLate, taskWhen, todayOpen } from '$lib/todayList.js';

	let { time = new Date(), tasks = [], atm = null, temp = '--', desc = '', ondone = null } = $props();

	let t = $derived(timeParts(time));
	let nowMs = $derived(time.getTime());
	let shown = $derived(todayOpen(tasks, nowMs).slice(0, 4));
	let stamp = $derived(time.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'America/New_York' }).replaceAll('/', '.'));

	// how far through the daylight we are, 0..1, for the little sun track
	let dayFrac = $derived.by(() => {
		const rise = Date.parse(atm?.sunrise || '');
		const set = Date.parse(atm?.sunset || '');
		if (!rise || !set || set <= rise) return null;
		return Math.max(0, Math.min(1, (nowMs - rise) / (set - rise)));
	});
</script>

<div class="console">
	<section class="left" aria-label="Time and date">
		<p class="rule-line"><span>{dateLine(time)}</span><span class="dim">{stamp}</span></p>
		<div class="time">
			<DotDigits text="{t.h12}:{t.mm}" dot="clamp(1.1rem, 1.85vw, 2.15rem)" gap="0.32rem" color="#141414" label="{t.h12}:{t.mm} {t.ampm}" />
			<div class="side">
				<DotDigits text={t.ss} dot="clamp(0.55rem, 0.85vw, 1rem)" gap="0.16rem" color="#ff4f12" />
				<span class="ampm">{t.ampm}</span>
			</div>
		</div>
		<div class="wx">
			<span class="temp">{temp}°</span>
			<span class="desc">{desc && desc !== '--' ? desc : ''}</span>
			<WeatherGlyph sky={skyFor(desc, t.h)} size="clamp(2.4rem, 3.4vw, 3.8rem)" />
		</div>
		{#if atm}
			<div class="sun">
				<span>▲ {fmtSunTime(atm.sunrise)}</span>
				<span class="track" aria-hidden="true"><i style="left: {(dayFrac ?? 0) * 100}%" class:off={dayFrac == null}></i></span>
				<span>▼ {fmtSunTime(atm.sunset)}</span>
			</div>
		{/if}
	</section>

	<section class="box" aria-label="Today">
		<header><span>TODAY · {time.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }).toUpperCase()}</span><span class="dim">{String(shown.length).padStart(2, '0')}</span></header>
		{#if shown.length}
			<ol>
				{#each shown as item, i (item.id)}
					<li class:late={isLate(item)}>
						<button class="mark" type="button" aria-label={item.kind === 'alert' ? `Dismiss ${item.title}` : `Mark ${item.title} done`} onclick={() => ondone?.(item.id)} disabled={!ondone}></button>
						<span class="title">{item.title}</span>
						<span class="when">{taskWhen(item, nowMs)}</span>
						<span class="n">{String(i + 1).padStart(2, '0')}</span>
					</li>
				{/each}
			</ol>
		{:else}
			<p class="empty">NOTHING WAITING</p>
		{/if}
	</section>
</div>

<style>
	.console {
		--ink: #141414;
		--orange: #ff4f12;
		--glyph-ink: var(--ink);
		--glyph-warm: var(--orange);
		align-self: start;
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: clamp(2rem, 4vw, 4rem);
		width: min(100%, 100rem);
		margin: clamp(1rem, 3vh, 3rem) auto 0;
		color: var(--ink);
		font-family: var(--font-code);
	}
	.dim {
		color: #8a8a86;
	}
	.rule-line {
		display: flex;
		justify-content: space-between;
		margin: 0 0 1.5rem;
		padding-bottom: 0.6rem;
		border-bottom: 2px dotted var(--ink);
		font-size: clamp(1.2rem, 1.6vw, 1.75rem);
	}
	.time {
		display: flex;
		align-items: flex-start;
		gap: clamp(1rem, 1.6vw, 1.8rem);
	}
	.side {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}
	.ampm {
		padding: 0.35rem 0.9rem;
		background: var(--orange);
		color: #fff;
		font-size: clamp(1.8rem, 2.6vw, 3rem);
		font-weight: 600;
		letter-spacing: 0.05em;
	}
	.wx {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-top: 2rem;
	}
	.temp {
		font-size: clamp(2.6rem, 3.8vw, 4.2rem);
		font-weight: 600;
	}
	.desc {
		font-size: clamp(1.4rem, 2vw, 2.2rem);
	}
	.sun {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 1rem;
		margin-top: 1rem;
		font-size: clamp(1.1rem, 1.5vw, 1.6rem);
	}
	.track {
		position: relative;
		height: 2px;
		background-image: radial-gradient(circle, var(--ink) 1px, transparent 1.4px);
		background-size: 8px 2px;
	}
	.track i {
		position: absolute;
		top: -6px;
		width: 14px;
		height: 14px;
		margin-left: -7px;
		border-radius: 50%;
		background: var(--orange);
	}
	.track i.off {
		display: none;
	}
	.box {
		border: 3px solid var(--ink);
		border-radius: 0.5rem;
		background: #f4f4f1;
		pointer-events: auto;
	}
	.box header {
		display: flex;
		justify-content: space-between;
		padding: 0.8rem 1.1rem;
		border-bottom: 3px solid var(--ink);
		font-size: clamp(1.1rem, 1.45vw, 1.55rem);
	}
	ol {
		list-style: none;
		margin: 0;
		padding: 0.6rem;
	}
	li {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto auto;
		align-items: center;
		gap: 0.9rem;
		padding: 1rem 0.8rem;
		border-bottom: 2px dotted #b9b9b4;
		font-size: clamp(1.15rem, 1.55vw, 1.65rem);
		text-transform: uppercase;
	}
	li:last-child {
		border-bottom: none;
	}
	li.late {
		background: var(--orange);
		color: #fff;
		border-bottom-color: transparent;
	}
	.mark {
		width: 1.1em;
		height: 1.1em;
		padding: 0;
		border-radius: 50%;
		border: 2.5px solid currentColor;
		background: transparent;
		cursor: pointer;
	}
	li.late .mark {
		background: var(--ink);
		border-color: var(--ink);
	}
	.title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.when {
		text-transform: none;
	}
	.n {
		font-size: 0.65em;
		opacity: 0.6;
	}
	.empty {
		padding: 2rem 1.1rem;
		margin: 0;
		color: #8a8a86;
	}
	@media (max-width: 900px) {
		.console {
			grid-template-columns: 1fr;
		}
	}
</style>
