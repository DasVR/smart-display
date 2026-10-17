<!--
	When the panel is on, each day. The old pane showed all seven days with
	two time boxes, a menu and a row of copy buttons each, all at once. Now
	the pane opens on one sentence ("Off tonight at 10:30 PM"), two switches,
	and a week you read at a glance; tap a day to edit just that one.
	Saved through POST /api/display (src/lib/server/displaySchedule.js).
-->
<script>
	import { untrack } from 'svelte';
	import { slide } from 'svelte/transition';
	import { playChime } from '$lib/services/chime.js';

	let { display = null, hdmi = 'on', onfault = () => {} } = $props();

	const DAYS = [
		{ id: 0, short: 'Sun', name: 'Sunday' },
		{ id: 1, short: 'Mon', name: 'Monday' },
		{ id: 2, short: 'Tue', name: 'Tuesday' },
		{ id: 3, short: 'Wed', name: 'Wednesday' },
		{ id: 4, short: 'Thu', name: 'Thursday' },
		{ id: 5, short: 'Fri', name: 'Friday' },
		{ id: 6, short: 'Sat', name: 'Saturday' }
	];
	/** Monday first, the way a week reads */
	const ORDER = [1, 2, 3, 4, 5, 6, 0];
	const MODES = [
		{ id: 'times', label: 'Times' },
		{ id: 'on', label: 'On all day' },
		{ id: 'off', label: 'Off all day' }
	];

	let autoNights = $state(true);
	let wakeOnPhone = $state(true);
	let week = $state(Array.from({ length: 7 }, () => ({ mode: 'times', on: '06:00', off: '22:30' })));
	let nextChange = $state(null);
	let scheduleTz = $state('America/New_York');
	let hold = $state(null);
	let phone = $state({ after: '5:00' });
	let today = $state(new Date().getDay());
	let open = $state(-1); // the day being edited
	let saving = $state(false);

	const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	const panelIn = { duration: reduce ? 0 : 200 };

	$effect(() => {
		const t = setInterval(() => (today = new Date().getDay()), 60000);
		return () => clearInterval(t);
	});

	const clockValue = (value) => {
		const m = String(value ?? '')
			.trim()
			.match(/^(\d{1,2}):([0-5]\d)/);
		return m ? `${m[1].padStart(2, '0')}:${m[2]}` : String(value ?? '');
	};

	/** Take in a display message: from the page as it arrives, or the answer to a save. */
	function ingest(d) {
		if (!d) return;
		if (d.hold === 'on' || d.hold === 'off') hold = d.hold;
		else if ('hold' in d) hold = null;
		const s = d.schedule || {};
		if (typeof s.enabled === 'boolean') autoNights = s.enabled;
		if (typeof s.wakeOnPhone === 'boolean') wakeOnPhone = s.wakeOnPhone;
		if (Array.isArray(s.week) && s.week.length === 7) week = s.week.map((w) => ({ mode: w.mode, on: clockValue(w.on), off: clockValue(w.off) }));
		if (s.timeZone) scheduleTz = s.timeZone;
		if ('next' in d) nextChange = d.next;
		if (d.phone) phone = { ...phone, ...d.phone };
	}
	// the page hands over every display message as it arrives
	$effect(() => {
		const d = display;
		untrack(() => ingest(d));
	});

	async function post(body, done) {
		saving = true;
		try {
			const r = await fetch('/api/display', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
			ingest(await r.json());
			onfault('');
			playChime('schedule');
			return done;
		} catch {
			onfault('That setting didn’t save. The display didn’t answer.');
			return '';
		} finally {
			saving = false;
		}
	}

	const toggleAuto = () => {
		autoNights = !autoNights;
		playChime('tap');
		post({ enabled: autoNights, wakeOnPhone });
	};
	const toggleWake = () => {
		wakeOnPhone = !wakeOnPhone;
		playChime('tap');
		post({ enabled: autoNights, wakeOnPhone });
	};

	function setDay(day, patch) {
		const value = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, k === 'mode' ? v : clockValue(v)]));
		week = week.map((d, i) => (i === day ? { ...d, ...value } : d));
		post({ day, ...value });
	}
	function copyDay(from, to) {
		playChime('tap');
		post({ copyDay: from, to });
	}

	/** "10:30 PM" from "22:30" */
	function clock12(hhmm) {
		const [h, m] = String(hhmm).split(':').map(Number);
		return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
	}
	function rowText(w) {
		if (w.mode === 'on') return 'On all day';
		if (w.mode === 'off') return 'Off all day';
		return `${clock12(w.on)}  to  ${clock12(w.off)}`;
	}

	/** "Off tonight at 10:30 PM", "On tomorrow at 6 AM", "On Sat at 8 AM", on the display's clock. */
	let headline = $derived.by(() => {
		if (!autoNights) return 'Manual';
		if (!nextChange) return 'No changes this week';
		const at = new Date(nextChange.at);
		const day = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: scheduleTz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
		const time = new Intl.DateTimeFormat('en-US', { timeZone: scheduleTz, hour: 'numeric', minute: '2-digit' }).format(at).replace(':00', '');
		const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: scheduleTz, hour: 'numeric', hourCycle: 'h23' }).format(at));
		const when =
			day(at) === day(new Date()) ? (hour >= 17 ? 'tonight' : 'today')
			: day(at) === day(new Date(Date.now() + 86400000)) ? 'tomorrow'
			: new Intl.DateTimeFormat('en-US', { timeZone: scheduleTz, weekday: 'short' }).format(at);
		return `${nextChange.to === 'on' ? 'On' : 'Off'} ${when} at ${time}`;
	});
	let heldNote = $derived(autoNights && hold ? `Held ${hdmi} for now` : '');
</script>

<div class="night" ontouchstart={(e) => e.stopPropagation()} ontouchend={(e) => e.stopPropagation()}>
	<header>
		<p class="eyebrow">Display schedule</p>
		<h1>{#key headline}<span>{headline}</span>{/key}</h1>
		{#if heldNote}<p class="held">{heldNote}</p>{/if}
	</header>

	<div class="switches">
		<button type="button" role="switch" aria-checked={autoNights} class="switch" onclick={toggleAuto}>
			<span class="label"><b>Follow the schedule</b><small>Panel turns on and off by itself</small></span>
			<span class="knob" aria-hidden="true"></span>
		</button>
		<button type="button" role="switch" aria-checked={wakeOnPhone} class="switch" onclick={toggleWake}>
			<span class="label"><b>Wake when I get up</b><small>After {phone.after || '5:00'}, the webcam sees you stand and the panel turns on with the briefing</small></span>
			<span class="knob" aria-hidden="true"></span>
		</button>
	</div>

	<section class="week" class:off={!autoNights} aria-label="When the panel is on, each day">
		{#each ORDER as d (d)}
			{@const w = week[d]}
			{@const expanded = open === d}
			<div class="day" class:today={d === today} class:expanded>
				<button type="button" class="row" aria-expanded={expanded} aria-controls="day-{d}" disabled={!autoNights} onclick={() => ((open = expanded ? -1 : d), playChime('tap'))}>
					<span class="name">{DAYS[d].short}</span>
					<span class="times num" class:dim={w.mode === 'off'}>{rowText(w)}</span>
					<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
				</button>
				{#if expanded}
					<div class="edit" id="day-{d}" transition:slide={panelIn}>
						<div class="modes" role="radiogroup" aria-label="{DAYS[d].name}">
							{#each MODES as m (m.id)}
								<button type="button" role="radio" aria-checked={w.mode === m.id} class:on={w.mode === m.id} onclick={() => setDay(d, { mode: m.id })}>{m.label}</button>
							{/each}
						</div>
						{#if w.mode === 'times'}
							<div class="times-edit">
								<label>On<input type="time" value={w.on} onchange={(e) => setDay(d, { on: e.currentTarget.value })} /></label>
								<label>Off<input type="time" value={w.off} onchange={(e) => setDay(d, { off: e.currentTarget.value })} /></label>
							</div>
						{/if}
						<div class="copy">
							<span>Copy {DAYS[d].short} to</span>
							<button type="button" onclick={() => copyDay(d, 'weekdays')}>Weekdays</button>
							<button type="button" onclick={() => copyDay(d, 'weekend')}>Weekend</button>
							<button type="button" onclick={() => copyDay(d, 'all')}>Every day</button>
						</div>
					</div>
				{/if}
			</div>
		{/each}
	</section>

	<p class="note">An off time earlier than the on time means after midnight: Fri 8 AM to 1 AM stays on until 1 AM Saturday.</p>
</div>

<style>
	.night {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.eyebrow {
		margin: 0;
		font-size: var(--text-sm);
		font-weight: 650;
		color: var(--text-tertiary);
	}
	h1 {
		margin: var(--space-1) 0 0;
		font-size: 2rem;
		font-weight: 700;
		letter-spacing: -0.035em;
		line-height: 1.1;
	}
	h1 span { display: inline-block; animation: swap 280ms var(--ease-enter) both; }
	@keyframes swap {
		from { opacity: 0; transform: translateY(6px); filter: blur(2px); }
	}
	.held {
		margin: var(--space-2) 0 0;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--warn);
	}

	.switches {
		display: flex;
		flex-direction: column;
		border-radius: var(--radius-md);
		border: 1px solid var(--hairline);
		background: var(--abyss-2);
		overflow: hidden;
	}
	.switch {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		min-height: 4rem;
		padding: var(--space-3) var(--space-4);
		border: 0;
		background: none;
		color: var(--foreground);
		font: inherit;
		text-align: left;
		cursor: pointer;
		touch-action: manipulation;
	}
	.switch + .switch { border-top: 1px solid var(--hairline); }
	.label { flex: 1; display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
	.label b { font-size: var(--text-base); font-weight: 650; }
	.label small { font-size: 0.8rem; line-height: 1.35; color: var(--text-tertiary); }
	.knob {
		position: relative;
		flex: none;
		width: 3rem;
		height: 1.8rem;
		border-radius: 999px;
		background: var(--shell-fill);
		box-shadow: inset 0 0 0 1px var(--hairline);
		transition: background-color 200ms var(--ease-standard);
	}
	.knob::after {
		content: '';
		position: absolute;
		top: 0.2rem;
		left: 0.2rem;
		width: 1.4rem;
		height: 1.4rem;
		border-radius: 50%;
		background: var(--text-secondary);
		transition: transform 240ms var(--ease-fluid), background-color 200ms var(--ease-standard);
	}
	.switch[aria-checked='true'] .knob { background: color-mix(in srgb, var(--ok) 55%, transparent); }
	.switch[aria-checked='true'] .knob::after { transform: translateX(1.2rem); background: var(--foreground); }
	.switch:active .knob::after { transform: scaleX(1.12); }
	.switch[aria-checked='true']:active .knob::after { transform: translateX(1.2rem) scaleX(1.12); }
	.switch:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }

	.week {
		display: flex;
		flex-direction: column;
		border-radius: var(--radius-md);
		border: 1px solid var(--hairline);
		background: var(--abyss-2);
		overflow: hidden;
		transition: opacity 200ms var(--ease-standard);
	}
	.week.off { opacity: 0.45; }
	.day + .day { border-top: 1px solid var(--hairline); }
	.row {
		display: grid;
		grid-template-columns: 3rem 1fr 1.25rem;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		min-height: 3.25rem;
		padding: 0 var(--space-4);
		border: 0;
		background: none;
		color: var(--text-secondary);
		font: inherit;
		text-align: left;
		cursor: pointer;
		touch-action: manipulation;
	}
	.row:disabled { cursor: not-allowed; }
	.name { font-size: var(--text-base); font-weight: 700; }
	.day.today .name { color: var(--brand); }
	.day.today .row { color: var(--foreground); }
	.times { font-size: var(--text-sm); font-weight: 600; white-space: pre; }
	.times.dim { color: var(--text-tertiary); }
	.chev {
		width: 1.1rem;
		height: 1.1rem;
		fill: none;
		stroke: var(--text-tertiary);
		stroke-width: 2.2;
		stroke-linecap: round;
		stroke-linejoin: round;
		transition: transform 240ms var(--ease-fluid);
	}
	.expanded .chev { transform: rotate(180deg); }
	.row:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }

	.edit {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: 0 var(--space-4) var(--space-4);
	}
	.modes {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.2rem;
		padding: 0.2rem;
		border-radius: 999px;
		background: var(--shell-fill);
	}
	.modes button {
		min-height: 2.5rem;
		border: 0;
		border-radius: 999px;
		background: none;
		color: var(--text-tertiary);
		font: inherit;
		font-size: 0.8rem;
		font-weight: 650;
		cursor: pointer;
		touch-action: manipulation;
		transition: color 150ms var(--ease-standard), background-color 150ms var(--ease-standard);
	}
	.modes button.on { background: color-mix(in srgb, var(--foreground) 13%, transparent); color: var(--foreground); }
	.times-edit { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
	.times-edit label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.8rem;
		font-weight: 650;
		color: var(--text-tertiary);
	}
	.times-edit input {
		min-width: 0;
		min-height: 3rem;
		padding: 0 var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid var(--hairline);
		background: var(--shell-fill);
		color: var(--foreground);
		font: inherit;
		font-size: 1rem;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
		color-scheme: dark;
	}
	.times-edit input:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
	.copy {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		font-size: 0.8rem;
		color: var(--text-tertiary);
	}
	.copy span { margin-right: var(--space-1); }
	.copy button {
		min-height: 2.25rem;
		padding: 0 var(--space-3);
		border-radius: 999px;
		border: 1px solid var(--hairline);
		background: var(--shell-fill);
		color: var(--text-secondary);
		font: inherit;
		font-weight: 650;
		cursor: pointer;
		touch-action: manipulation;
	}
	.copy button:active { transform: scale(0.97); }
	.note {
		margin: 0;
		font-size: 0.8rem;
		line-height: 1.4;
		color: var(--text-tertiary);
	}
</style>
