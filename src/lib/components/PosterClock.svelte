<!--
	The Clock page as a poster: the time huge across the painting with nothing
	behind it but a dotted shadow, and three small glass tiles underneath (the
	date and sun, the weather, today's first three things). In the depth look
	the painting's darkest dots are printed back over the numerals (the page
	lays HalftoneArt `over` on top), so trees and branches seem to stand in
	front of the time.
-->
<script>
	import RollingDigit from './RollingDigit.svelte';
	import WeatherGlyph from './WeatherGlyph.svelte';
	import { fmtSunTime } from '$lib/atmosphere.js';
	import { dateLine, skyFor, timeParts } from '$lib/clockFace.js';
	import { isLate, taskWhen, todayOpen } from '$lib/todayList.js';

	let { time = new Date(), tasks = [], atm = null, temp = '--', desc = '', ondone = null, depth = false } = $props();

	let t = $derived(timeParts(time));
	let nowMs = $derived(time.getTime());
	let shown = $derived(todayOpen(tasks, nowMs).slice(0, 3));
</script>

<div class="poster" class:depth>
	<div class="clock" aria-label="{t.h12}:{t.mm} {t.ampm}">
		<span class="stack" aria-hidden="true">
			<span class="digits shadow">
				{#each t.h12.split('') as d, i (`s${t.h12.length}-${i}`)}<RollingDigit digit={+d} />{/each}<span class="colon">:</span><RollingDigit digit={+t.mm[0]} /><RollingDigit digit={+t.mm[1]} />
			</span>
			<span class="digits face">
				{#each t.h12.split('') as d, i (`f${t.h12.length}-${i}`)}<RollingDigit digit={+d} />{/each}<span class="colon">:</span><RollingDigit digit={+t.mm[0]} /><RollingDigit digit={+t.mm[1]} />
			</span>
		</span>
		<span class="side" aria-hidden="true">
			<span class="secs"><RollingDigit digit={+t.ss[0]} /><RollingDigit digit={+t.ss[1]} /></span>
			<span class="ampm">{t.ampm}</span>
		</span>
	</div>

	<div class="tiles">
		<section class="tile" aria-label="Date and sun">
			<p class="big">{dateLine(time).replace(', ', ',\n')}</p>
			{#if atm}<p class="small">↑ {fmtSunTime(atm.sunrise)}  ↓ {fmtSunTime(atm.sunset)}</p>{/if}
		</section>
		<section class="tile" aria-label="Weather">
			<div class="temp-row"><WeatherGlyph sky={skyFor(desc, t.h)} size="2.8rem" /><span class="temp">{temp}°</span></div>
			<p class="small strong">{desc && desc !== '--' ? desc : ''}</p>
		</section>
		<section class="tile wide" aria-label="Today">
			<p class="k">Today</p>
			{#if shown.length}
				<ul>
					{#each shown as item (item.id)}
						<li class:late={isLate(item)}>
							<button class="mark" type="button" aria-label={item.kind === 'alert' ? `Dismiss ${item.title}` : `Mark ${item.title} done`} onclick={() => ondone?.(item.id)} disabled={!ondone}></button>
							<span class="title">{item.title}</span>
							<span class="when">{taskWhen(item, nowMs)}</span>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="small">Nothing waiting.</p>
			{/if}
		</section>
	</div>
</div>

<style>
	.poster {
		--cream: #f6f0e3;
		--ink: #15130f;
		--late: #ffab52;
		--glyph-ink: var(--cream);
		--glyph-warm: var(--late);
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: space-between;
		padding-bottom: 0.5rem;
	}
	.clock {
		display: flex;
		align-items: flex-start;
		margin-top: clamp(0rem, 2vh, 2rem);
		font-size: clamp(9rem, 21vw, 25rem);
		font-weight: 800;
		line-height: 0.92;
		letter-spacing: -0.04em;
		font-variant-numeric: tabular-nums;
		pointer-events: none;
	}
	.stack {
		display: grid;
	}
	.digits {
		grid-area: 1 / 1;
		display: flex;
		align-items: center;
	}
	.digits :global(.roll) {
		margin: 0 -0.04em;
	}
	.colon {
		padding: 0 0.01em;
		transform: translateY(-0.06em);
	}
	.face {
		color: var(--cream);
		-webkit-text-stroke: 0.022em var(--ink);
		paint-order: stroke fill;
	}
	.shadow {
		color: var(--ink);
		transform: translate(0.04em, 0.05em);
		-webkit-mask-image: radial-gradient(circle, #000 2px, transparent 2.5px);
		mask-image: radial-gradient(circle, #000 2px, transparent 2.5px);
		-webkit-mask-size: 7px 7px;
		mask-size: 7px 7px;
	}
	/* depth: a thinner outline; the painting's dots printed over it do the rest */
	.depth .face {
		-webkit-text-stroke-width: 0.012em;
	}
	.side {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.12em;
		margin-left: 0.1em;
		padding-top: 0.1em;
	}
	.secs {
		display: flex;
		font-size: 0.3em;
		color: var(--cream);
		-webkit-text-stroke: 0.06em var(--ink);
		paint-order: stroke fill;
	}
	.ampm {
		font-size: 0.15em;
		font-weight: 800;
		letter-spacing: 0.05em;
		padding: 0.2em 0.5em;
		border-radius: 999px;
		background: var(--cream);
		color: var(--ink);
		box-shadow: 0 0 0 0.1em var(--ink);
	}
	.tiles {
		position: relative;
		z-index: 2;
		display: grid;
		grid-template-columns: 1fr 1fr 2.2fr;
		gap: 1.25rem;
		width: min(100%, 78rem);
		color: var(--cream);
	}
	.tile {
		padding: 1.1rem 1.4rem;
		border-radius: 1.6rem;
		background: linear-gradient(160deg, color-mix(in srgb, #3a3632 90%, transparent), color-mix(in srgb, #1f1c19 94%, transparent));
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, #fff 16%, transparent),
			0 20px 40px -18px color-mix(in srgb, #000 60%, transparent);
		pointer-events: auto;
	}
	.big {
		margin: 0 0 0.35rem;
		white-space: pre-line;
		font-size: clamp(1.3rem, 1.75vw, 1.9rem);
		font-weight: 700;
		line-height: 1.15;
	}
	.small {
		margin: 0.3rem 0 0;
		font-size: clamp(1rem, 1.25vw, 1.3rem);
		color: color-mix(in srgb, var(--cream) 75%, transparent);
		font-variant-numeric: tabular-nums;
	}
	.strong {
		color: var(--cream);
		font-weight: 600;
	}
	.temp-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.temp {
		font-size: clamp(2.6rem, 3.6vw, 3.8rem);
		font-weight: 800;
		line-height: 1;
	}
	.k {
		margin: 0 0 0.4rem;
		font-size: 0.95rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--cream) 70%, transparent);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	li {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.6rem;
		font-size: clamp(1.05rem, 1.35vw, 1.45rem);
	}
	.mark {
		width: 0.9em;
		height: 0.9em;
		padding: 0;
		border-radius: 50%;
		border: 2px solid color-mix(in srgb, var(--cream) 75%, transparent);
		background: transparent;
		cursor: pointer;
	}
	li.late .mark {
		border: none;
		background: var(--late);
	}
	.title {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.when {
		font-variant-numeric: tabular-nums;
		color: color-mix(in srgb, var(--cream) 70%, transparent);
	}
	li.late .when {
		color: var(--late);
	}
</style>
