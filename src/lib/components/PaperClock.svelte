<!--
	The Clock page as printed paper cards across the top of the painting,
	which keeps the lower half of the screen to itself. 'paper': cream cards
	with a dotted shadow, the clock in cream outlined in ink. 'riso': the same
	cards printed in two inks (teal and tangerine), the clock in solid ink with
	the second ink a few pixels off-register.
-->
<script>
	import RollingDigit from './RollingDigit.svelte';
	import WeatherGlyph from './WeatherGlyph.svelte';
	import { fmtSunTime } from '$lib/atmosphere.js';
	import { dateLine, skyFor, timeParts } from '$lib/clockFace.js';
	import { isLate, nextWhen, taskWhen, todayOpen } from '$lib/todayList.js';

	let { time = new Date(), tasks = [], atm = null, temp = '--', desc = '', ondone = null, mode = 'paper' } = $props();

	let t = $derived(timeParts(time));
	let nowMs = $derived(time.getTime());
	let open = $derived(todayOpen(tasks, nowMs));
	let shown = $derived(open.slice(0, 4));
	let next = $derived(tasks.find((x) => x.status === 'upcoming') || null);
</script>

<div class="paper-clock" data-mode={mode}>
	<section class="card time" aria-label="Time and date">
		<p class="date">{dateLine(time)}</p>
		<div class="clock" aria-label="{t.h12}:{t.mm} {t.ampm}">
			<span class="stack" aria-hidden="true">
				<span class="digits under">
					{#each t.h12.split('') as d, i (`u${t.h12.length}-${i}`)}<RollingDigit digit={+d} />{/each}<span class="colon">:</span><RollingDigit digit={+t.mm[0]} /><RollingDigit digit={+t.mm[1]} />
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
	</section>

	<section class="card info" aria-label="Today and the weather">
		<div class="today">
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
				<p class="quiet">Nothing waiting.</p>
			{/if}
			{#if next}<p class="quiet">Next · {next.title} {nextWhen(next)}</p>{/if}
		</div>
		<div class="weather">
			<p class="k">Weather</p>
			<div class="temp-row"><span class="temp">{temp}°</span><WeatherGlyph sky={skyFor(desc, t.h)} size="clamp(2.6rem, 3.8vw, 4.2rem)" /></div>
			<p class="desc">{desc && desc !== '--' ? desc : ''}</p>
			{#if atm}
				<p class="sun"><span>Rise {fmtSunTime(atm.sunrise)}</span><span>Set {fmtSunTime(atm.sunset)}</span></p>
			{/if}
		</div>
	</section>
</div>

<style>
	.paper-clock {
		--paper: #f4efe6;
		--ink: #1c1a17;
		--accent: #d9481c;
		--muted: #6b655c;
		--glyph-ink: var(--ink);
		--glyph-warm: var(--accent);
		align-self: start;
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
		gap: clamp(1.5rem, 2.6vw, 2.75rem);
		width: min(100%, 100rem);
		margin: clamp(0.5rem, 2vh, 2rem) auto 0;
		color: var(--ink);
	}
	.paper-clock[data-mode='riso'] {
		--paper: #f3ede2;
		--ink: #0b5f66;
		--accent: #ff6b3d;
		--muted: #3e7c80;
	}
	.card {
		position: relative;
		padding: clamp(1.4rem, 2.2vw, 2.4rem) clamp(1.6rem, 2.6vw, 2.8rem);
		background: var(--paper);
		border-radius: 0.75rem;
		pointer-events: auto;
		/* a printed shadow: a block of dots, down and to the right */
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--ink) 18%, transparent);
	}
	.card::before {
		content: '';
		position: absolute;
		inset: 0;
		transform: translate(0.9rem, 0.9rem);
		z-index: -1;
		border-radius: inherit;
		background-image: radial-gradient(circle, var(--ink) 1.6px, transparent 2px);
		background-size: 6px 6px;
	}
	[data-mode='riso'] .card {
		box-shadow: none;
		border: 3px solid var(--ink);
		border-radius: 1.25rem;
	}
	[data-mode='riso'] .card::before {
		background-image: radial-gradient(circle, var(--accent) 1.7px, transparent 2.1px);
	}
	.date {
		margin: 0;
		font-size: clamp(1.5rem, 2.2vw, 2.4rem);
		font-weight: 700;
		letter-spacing: -0.01em;
	}
	.clock {
		display: flex;
		align-items: flex-start;
		font-size: clamp(6.5rem, 12vw, 13.5rem);
		font-weight: 800;
		line-height: 1;
		letter-spacing: -0.03em;
		font-variant-numeric: tabular-nums;
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
		margin: 0 -0.035em;
	}
	.colon {
		padding: 0 0.02em;
		transform: translateY(-0.06em);
	}
	/* paper: a cream face outlined in ink over a dotted shadow */
	.face {
		color: var(--paper);
		-webkit-text-stroke: 0.035em var(--ink);
		paint-order: stroke fill;
	}
	.under {
		color: var(--ink);
		transform: translate(0.05em, 0.065em);
		-webkit-mask-image: radial-gradient(circle, #000 1.5px, transparent 1.9px);
		mask-image: radial-gradient(circle, #000 1.5px, transparent 1.9px);
		-webkit-mask-size: 5px 5px;
		mask-size: 5px 5px;
	}
	/* riso: solid ink, the second ink a little off-register under it */
	[data-mode='riso'] .face {
		color: var(--ink);
		-webkit-text-stroke: 0;
		mix-blend-mode: multiply;
	}
	[data-mode='riso'] .under {
		color: var(--accent);
		transform: translate(0.03em, 0.025em);
		-webkit-mask-image: none;
		mask-image: none;
		mix-blend-mode: multiply;
	}
	.side {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.1em;
		margin-left: 0.14em;
		padding-top: 0.12em;
	}
	.secs {
		display: flex;
		font-size: 0.32em;
		font-weight: 700;
	}
	.ampm {
		font-size: 0.19em;
		font-weight: 800;
		letter-spacing: 0.05em;
		padding: 0.16em 0.4em;
		border: 0.12em solid var(--ink);
		border-radius: 0.35em;
	}
	[data-mode='riso'] .ampm {
		border: none;
		background: var(--accent);
		color: var(--paper);
		border-radius: 999px;
		padding: 0.2em 0.55em;
	}
	.info {
		display: grid;
		grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
		gap: clamp(1.25rem, 2vw, 2.25rem);
	}
	.weather {
		padding-left: clamp(1.25rem, 2vw, 2.25rem);
		border-left: 2px solid color-mix(in srgb, var(--ink) 30%, transparent);
	}
	.k {
		margin: 0 0 0.8rem;
		font-size: clamp(0.95rem, 1.15vw, 1.2rem);
		font-weight: 800;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	li {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.75rem;
		padding: 0.45rem 0.6rem;
		margin: 0 -0.6rem;
		border-radius: 0.6rem;
		font-size: clamp(1.1rem, 1.5vw, 1.6rem);
	}
	li.late {
		background: color-mix(in srgb, var(--accent) 22%, transparent);
	}
	.mark {
		width: 0.95em;
		height: 0.95em;
		padding: 0;
		border-radius: 0.2em;
		border: 2.5px solid var(--ink);
		background: transparent;
		cursor: pointer;
	}
	[data-mode='riso'] .mark {
		border-radius: 50%;
	}
	li.late .mark {
		background: var(--accent);
		border-color: var(--accent);
	}
	.title {
		font-weight: 600;
	}
	.when {
		font-variant-numeric: tabular-nums;
		color: var(--muted);
		font-size: 0.9em;
	}
	li.late .when {
		color: var(--accent);
		font-weight: 700;
	}
	.quiet {
		margin: 0.7rem 0 0;
		color: var(--muted);
		font-size: clamp(0.95rem, 1.15vw, 1.2rem);
	}
	.temp-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.temp {
		font-size: clamp(3.5rem, 5.6vw, 6.2rem);
		font-weight: 800;
		line-height: 1;
		letter-spacing: -0.04em;
	}
	.desc {
		margin: 0.3rem 0 0.9rem;
		font-size: clamp(1.3rem, 1.8vw, 1.9rem);
		font-weight: 600;
	}
	.sun {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		margin: 0;
		font-size: clamp(1rem, 1.3vw, 1.35rem);
		font-variant-numeric: tabular-nums;
		color: var(--muted);
	}
	@media (max-width: 900px) {
		.paper-clock,
		.info {
			grid-template-columns: 1fr;
		}
	}
</style>
