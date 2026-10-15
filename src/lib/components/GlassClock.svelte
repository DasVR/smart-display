<!--
	The Clock page in the halftone look: two frosted glass cards over the
	painting. Left, the date and a big cream clock whose digits roll, with a
	dotted shadow printed under them and the seconds and AM/PM to the side.
	Right, today's list (what's late in orange) beside the weather and the
	sun's times.
-->
<script>
	import RollingDigit from './RollingDigit.svelte';
	import { DISPLAY_TZ, fmtSunTime } from '$lib/atmosphere.js';
	import { isLate, nextWhen, taskWhen, todayOpen } from '$lib/todayList.js';

	let { time = new Date(), tasks = [], atm = null, temp = '--', desc = '', ondone = null } = $props();

	const LIST_MAX = 4;

	function parts(d) {
		const p = Object.fromEntries(
			new Intl.DateTimeFormat('en-US', { timeZone: DISPLAY_TZ, hour: 'numeric', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
				.formatToParts(d)
				.map((x) => [x.type, x.value])
		);
		return { h: Number(p.hour) % 24, m: Number(p.minute), s: Number(p.second) };
	}

	let t = $derived(parts(time));
	let h12 = $derived(String(t.h % 12 || 12));
	let mm = $derived(String(t.m).padStart(2, '0'));
	let ss = $derived(String(t.s).padStart(2, '0'));
	let ampm = $derived(t.h >= 12 ? 'PM' : 'AM');
	let dateLine = $derived(time.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: DISPLAY_TZ }));

	let nowMs = $derived(time.getTime());
	let open = $derived(todayOpen(tasks, nowMs));
	let shown = $derived(open.slice(0, LIST_MAX));
	let more = $derived(Math.max(0, open.length - shown.length));
	let next = $derived(tasks.find((x) => x.status === 'upcoming') || null);

	/** A weather glyph from the words: sun, moon, cloud, rain, snow, storm or fog. */
	let sky = $derived.by(() => {
		const d = String(desc || '').toLowerCase();
		const night = t.h < 6 || t.h >= 19;
		if (/thunder|storm/.test(d)) return 'storm';
		if (/snow|sleet|flurr/.test(d)) return 'snow';
		if (/rain|shower|drizzle/.test(d)) return 'rain';
		if (/fog|mist|haze|smoke/.test(d)) return 'fog';
		if (/partly|mostly sunny|few|scattered/.test(d)) return night ? 'moon-cloud' : 'sun-cloud';
		if (/cloud|overcast/.test(d)) return 'cloud';
		return night ? 'moon' : 'sun';
	});
</script>

<div class="glass-clock">
	<section class="card time-card" aria-label="Time and date">
		<p class="date">{dateLine}</p>
		<div class="clock" aria-label="{h12}:{mm} {ampm}">
			<span class="stack" aria-hidden="true">
				<!-- the printed shadow: the same digits in dots, offset down and right -->
				<span class="digits shadow">
					{#each h12.split('') as d, i (`s${h12.length}-${i}`)}<RollingDigit digit={+d} />{/each}<span class="colon">:</span><RollingDigit digit={+mm[0]} /><RollingDigit digit={+mm[1]} />
				</span>
				<span class="digits">
					{#each h12.split('') as d, i (`h${h12.length}-${i}`)}<RollingDigit digit={+d} />{/each}<span class="colon">:</span><RollingDigit digit={+mm[0]} /><RollingDigit digit={+mm[1]} />
				</span>
			</span>
			<span class="side" aria-hidden="true">
				<span class="secs"><RollingDigit digit={+ss[0]} /><RollingDigit digit={+ss[1]} /></span>
				<span class="ampm">{ampm}</span>
			</span>
		</div>
	</section>

	<section class="card info-card" aria-label="Today and the weather">
		<div class="today">
			<p class="k">Today</p>
			{#if shown.length}
				<ul>
					{#each shown as item (item.id)}
						<li class:late={isLate(item)}>
							<button
								class="mark"
								type="button"
								aria-label={item.kind === 'alert' ? `Dismiss ${item.title}` : `Mark ${item.title} done`}
								onclick={() => ondone?.(item.id)}
								disabled={!ondone}
							></button>
							<span class="title">{item.title}</span>
							<span class="when tnum">{taskWhen(item, nowMs)}</span>
						</li>
					{/each}
				</ul>
				{#if more}<p class="more">+{more} more</p>{/if}
			{:else}
				<p class="clear">Nothing waiting{next ? '' : ' today'}.</p>
			{/if}
			{#if next}
				<p class="next">Next · {next.title} <span class="tnum">{nextWhen(next)}</span></p>
			{/if}
		</div>
		<div class="rule" aria-hidden="true"></div>
		<div class="weather">
			<p class="k">Weather</p>
			<div class="temp-row">
				<span class="temp tnum">{temp}°</span>
				<svg class="sky" viewBox="0 0 48 48" aria-hidden="true" data-sky={sky}>
					{#if sky === 'sun' || sky === 'sun-cloud'}
						<g class="ray">
							<circle cx={sky === 'sun' ? 24 : 31} cy={sky === 'sun' ? 24 : 16} r="7" />
							{#each Array(8) as _, i (i)}
								<line x1={sky === 'sun' ? 24 : 31} y1={sky === 'sun' ? 11 : 4} x2={sky === 'sun' ? 24 : 31} y2={sky === 'sun' ? 14 : 6.5} transform="rotate({i * 45} {sky === 'sun' ? 24 : 31} {sky === 'sun' ? 24 : 16})" />
							{/each}
						</g>
					{/if}
					{#if sky === 'moon' || sky === 'moon-cloud'}
						<path class="ray" d={sky === 'moon' ? 'M30 10a14 14 0 1 0 8 25 12 12 0 0 1-8-25Z' : 'M33 6a9 9 0 1 0 6 16 8 8 0 0 1-6-16Z'} />
					{/if}
					{#if sky !== 'sun' && sky !== 'moon'}
						<path class="cloud" d="M14 38h22a8 8 0 0 0 0-16 11 11 0 0 0-21-2 8 8 0 0 0-1 18Z" />
					{/if}
					{#if sky === 'rain' || sky === 'storm'}
						<g class="ray"><line x1="18" y1="41" x2="16" y2="46" /><line x1="26" y1="41" x2="24" y2="46" /><line x1="34" y1="41" x2="32" y2="46" /></g>
					{/if}
					{#if sky === 'snow'}
						<g class="ray"><circle cx="17" cy="44" r="1.5" /><circle cx="25" cy="45" r="1.5" /><circle cx="33" cy="44" r="1.5" /></g>
					{/if}
				</svg>
			</div>
			<p class="desc">{desc && desc !== '--' ? desc : ''}</p>
			{#if atm}
				<dl class="sun">
					<div><dt>Sunrise</dt><dd class="tnum">{fmtSunTime(atm.sunrise)}</dd></div>
					<div><dt>Sunset</dt><dd class="tnum">{fmtSunTime(atm.sunset)}</dd></div>
				</dl>
			{/if}
		</div>
	</section>
</div>

<style>
	.glass-clock {
		--paper: #f3eee4;
		--late: #ffab52;
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: clamp(1.5rem, 3vw, 3rem);
		width: min(100%, 92rem);
		margin: 0 auto;
		align-items: stretch;
		color: var(--paper);
	}
	.card {
		position: relative;
		border-radius: 2.25rem;
		padding: clamp(1.5rem, 2.4vw, 2.5rem) clamp(1.75rem, 2.8vw, 3rem);
		background: linear-gradient(160deg, color-mix(in srgb, #3a3632 86%, transparent), color-mix(in srgb, #23201d 90%, transparent));
		backdrop-filter: blur(22px) saturate(1.1);
		-webkit-backdrop-filter: blur(22px) saturate(1.1);
		border: 1px solid color-mix(in srgb, #fff 16%, transparent);
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, #fff 18%, transparent),
			0 30px 60px -20px color-mix(in srgb, #000 55%, transparent);
		pointer-events: auto;
	}
	.time-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
	}
	.date {
		margin: 0;
		font-size: clamp(1.6rem, 2.4vw, 2.6rem);
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.clock {
		position: relative;
		display: flex;
		align-items: flex-start;
		font-size: clamp(7rem, 13.5vw, 15rem);
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
		position: relative;
		display: flex;
		align-items: center;
		color: var(--paper);
	}
	/* rolling digits sit in equal boxes; pull them together like set type */
	.digits :global(.roll) {
		margin: 0 -0.035em;
	}
	.colon {
		padding: 0 0.02em;
		transform: translateY(-0.06em);
	}
	/* the dotted shadow, printed a little down and to the right */
	.digits.shadow {
		color: #0d0c0b;
		transform: translate(0.045em, 0.06em);
		-webkit-mask-image: radial-gradient(circle, #000 1.5px, transparent 1.9px);
		mask-image: radial-gradient(circle, #000 1.5px, transparent 1.9px);
		-webkit-mask-size: 5px 5px;
		mask-size: 5px 5px;
	}
	.side {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.08em;
		margin-left: 0.12em;
		padding-top: 0.1em;
	}
	.secs {
		display: flex;
		font-size: 0.34em;
		font-weight: 700;
	}
	.ampm {
		font-size: 0.2em;
		font-weight: 800;
		letter-spacing: 0.04em;
		padding: 0.18em 0.42em;
		border-radius: 0.4em;
		background: var(--paper);
		color: #1c1a17;
	}
	.info-card {
		display: grid;
		grid-template-columns: minmax(0, 1.45fr) 1px minmax(0, 1fr);
		gap: clamp(1.25rem, 2vw, 2.25rem);
	}
	.rule {
		background: color-mix(in srgb, var(--paper) 22%, transparent);
	}
	.k {
		margin: 0 0 0.9rem;
		font-size: clamp(0.95rem, 1.2vw, 1.25rem);
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--paper) 72%, transparent);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: clamp(0.7rem, 1.1vw, 1.1rem);
	}
	li {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		grid-template-rows: auto auto;
		column-gap: 0.8rem;
		align-items: center;
		font-size: clamp(1.15rem, 1.55vw, 1.65rem);
		line-height: 1.2;
	}
	.mark {
		grid-row: 1 / span 2;
		align-self: start;
		margin-top: 0.12em;
		width: 1em;
		height: 1em;
		border-radius: 50%;
		border: 2px solid color-mix(in srgb, var(--paper) 70%, transparent);
		background: transparent;
		padding: 0;
		cursor: pointer;
	}
	li.late .mark {
		border: none;
		background: var(--late);
	}
	.title {
		font-weight: 600;
	}
	.when {
		font-size: 0.82em;
		color: color-mix(in srgb, var(--paper) 72%, transparent);
	}
	li.late .when {
		color: var(--late);
	}
	.more,
	.next,
	.clear {
		margin: 0.9rem 0 0;
		font-size: clamp(0.95rem, 1.2vw, 1.25rem);
		color: color-mix(in srgb, var(--paper) 70%, transparent);
	}
	.temp-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.temp {
		font-size: clamp(4rem, 6.5vw, 7rem);
		font-weight: 800;
		line-height: 1;
		letter-spacing: -0.04em;
	}
	.sky {
		width: clamp(3rem, 4.6vw, 5rem);
		height: auto;
		fill: none;
		stroke: var(--paper);
		stroke-width: 2.4;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.sky .ray circle,
	.sky path.ray {
		fill: var(--late);
		stroke: none;
	}
	.sky .ray line {
		stroke: var(--late);
	}
	.sky .cloud {
		fill: color-mix(in srgb, #2a2724 80%, transparent);
	}
	.desc {
		margin: 0.4rem 0 1.2rem;
		font-size: clamp(1.4rem, 2vw, 2.1rem);
		font-weight: 600;
	}
	.sun {
		display: flex;
		gap: 1.75rem;
		margin: 0;
	}
	.sun dt {
		font-size: clamp(0.9rem, 1.1vw, 1.15rem);
		color: color-mix(in srgb, var(--paper) 70%, transparent);
	}
	.sun dd {
		margin: 0;
		font-size: clamp(1.15rem, 1.5vw, 1.55rem);
		font-weight: 600;
	}
	.tnum {
		font-variant-numeric: tabular-nums;
	}
	@media (max-width: 900px) {
		.glass-clock {
			grid-template-columns: 1fr;
		}
	}
</style>
