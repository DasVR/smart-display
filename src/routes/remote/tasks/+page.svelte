<!--
	Phone: chores, little jobs and alerts. Everything you touch sits in the
	lower half (the + button, the sheet, each row's circle), so it works one-
	handed from the home-screen app. Talks to the display over /ws, the same
	socket as the rest of the remote; other platforms use /api/tasks.
-->
<script>
	import '../../../app.css';
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import RemoteTabBar from '$lib/components/RemoteTabBar.svelte';

	let tasks = $state([]);
	let status = $state('connecting');
	let error = $state('');
	let openId = $state('');
	let sheet = $state(false);
	let ws;
	let retry = 0;

	// add-sheet fields
	let kind = $state('chore');
	let title = $state('');
	let date = $state('');
	let time = $state('');
	let repeat = $state('none');
	let notes = $state('');

	const GROUPS = [
		{ id: 'waiting', label: 'Waiting', match: (t) => t.status === 'overdue' || t.status === 'due' },
		{ id: 'today', label: 'Today', match: (t) => t.status === 'today' },
		{ id: 'snoozed', label: 'Snoozed', match: (t) => t.status === 'snoozed' },
		{ id: 'upcoming', label: 'Coming up', match: (t) => t.status === 'upcoming' },
		{ id: 'done', label: 'Done', match: (t) => t.status === 'done' }
	];
	let groups = $derived(GROUPS.map((g) => ({ ...g, items: tasks.filter(g.match) })).filter((g) => g.items.length));

	function connect() {
		const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		ws = new WebSocket(`${proto}//${location.host}/ws`);
		ws.onopen = () => {
			status = 'live';
			retry = 0;
			ws.send(JSON.stringify({ type: 'hello', role: 'remote' }));
		};
		ws.onclose = () => {
			status = 'offline';
			setTimeout(connect, Math.min(8000, 1000 * 2 ** retry++));
		};
		ws.onmessage = (e) => {
			try {
				const msg = JSON.parse(e.data);
				if ((msg.type === 'init' || msg.type === 'tasks') && Array.isArray(msg.tasks)) tasks = msg.tasks;
				if (msg.type === 'tasks-error') error = msg.error;
			} catch {
				/* ignore */
			}
		};
	}

	function send(op, payload = {}) {
		error = '';
		if (ws?.readyState !== 1) {
			error = 'Not connected to the display';
			return false;
		}
		ws.send(JSON.stringify({ type: 'tasks', op, ...payload }));
		return true;
	}

	function pad(n) {
		return String(n).padStart(2, '0');
	}
	function openSheet() {
		const d = new Date(Date.now() + 60 * 60000);
		d.setMinutes(0, 0, 0);
		kind = 'chore';
		title = '';
		date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
		time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
		repeat = 'none';
		notes = '';
		sheet = true;
	}

	function repeatRule(choice, when) {
		if (choice === 'none') return null;
		if (choice === 'weekdays') return { freq: 'weekly', days: [1, 2, 3, 4, 5] };
		if (choice === 'weekly') return { freq: 'weekly', days: [when.getDay()] };
		if (choice === 'biweekly') return { freq: 'weekly', interval: 2, days: [when.getDay()] };
		return { freq: choice };
	}

	function save(e) {
		e.preventDefault();
		if (!title.trim()) {
			error = 'Give it a name first';
			return;
		}
		const when = new Date(`${date}T${time || '09:00'}`);
		if (Number.isNaN(when.getTime())) {
			error = 'Pick a date and time';
			return;
		}
		const ok = send('create', {
			task: { kind, title, notes, at: when.toISOString(), repeat: repeatRule(repeat, when), source: 'Remote' }
		});
		if (ok) sheet = false;
	}

	function whenText(t) {
		if (t.status === 'done') return t.lastDoneAt ? `done ${short(t.lastDoneAt)}` : 'done';
		if (t.status === 'snoozed') return `until ${short(t.snoozedUntil)}`;
		return short(t.nextDue);
	}
	function short(iso) {
		const d = new Date(iso);
		const today = new Date();
		const tomorrow = new Date(today);
		tomorrow.setDate(today.getDate() + 1);
		const tm = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
		if (d.toDateString() === today.toDateString()) return tm;
		if (d.toDateString() === tomorrow.toDateString()) return `tomorrow ${tm}`;
		return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} ${tm}`;
	}

	onMount(() => {
		connect();
		return () => {
			if (ws) {
				ws.onclose = null;
				ws.close();
			}
		};
	});
</script>

<svelte:head>
	<title>Display tasks</title>
	<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
	<meta name="theme-color" content="#07070b">
	<meta name="apple-mobile-web-app-capable" content="yes">
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
	<meta name="apple-mobile-web-app-title" content="Tasks">
</svelte:head>

<div class="remote" role="region" aria-label="Chores and alerts">
	<header class="bar">
		<div class="status" class:connected={status === 'live'}>
			<span class="dot"></span>
			<span>{status}</span>
		</div>
		<a class="siri" href="{base}/remote/shortcuts">Siri &amp; Shortcuts</a>
	</header>

	{#if !tasks.length}
		<div class="empty">
			<p class="empty-title">No chores or alerts yet</p>
			<p class="note">
				Add one with the + button, or <a href="{base}/remote/shortcuts">set up Siri</a> to add them by voice. Other
				apps can add them too through <code>/api/tasks</code>.
			</p>
		</div>
	{/if}

	{#each groups as g (g.id)}
		<section class="group" aria-label={g.label}>
			<p class="kicker">{g.label} <span class="count">{g.items.length}</span></p>
			<ul>
				{#each g.items as t (t.id)}
					<li class="row" data-status={t.status} data-kind={t.kind} class:open={openId === t.id}>
						<button
							class="mark"
							type="button"
							aria-label={t.kind === 'alert' ? `Dismiss ${t.title}` : `Mark ${t.title} done`}
							onclick={() => send('done', { id: t.id })}
							disabled={t.status === 'done'}
						>
							{#if t.status === 'done'}
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
							{:else if t.kind === 'alert'}
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6Z" /><path d="M10 19a2 2 0 0 0 4 0" /></svg>
							{/if}
						</button>
						<button class="body" type="button" onclick={() => (openId = openId === t.id ? '' : t.id)} aria-expanded={openId === t.id}>
							<span class="title">{t.title}</span>
							<span class="meta">
								<span class="num">{whenText(t)}</span>{#if t.repeat} · {t.repeatText}{/if}{#if t.source && t.source !== 'Remote'} · {t.source}{/if}
							</span>
						</button>
						{#if openId === t.id}
							<div class="actions">
								{#if t.notes}<p class="notes">{t.notes}</p>{/if}
								{#if t.status !== 'done'}
									<button type="button" onclick={() => send('snooze', { id: t.id, minutes: 60 })}>Snooze 1 h</button>
									<button type="button" onclick={() => send('snooze', { id: t.id, minutes: 24 * 60 })}>Tomorrow</button>
								{/if}
								<button type="button" class="danger" onclick={() => send('delete', { id: t.id })}>Delete</button>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/each}

	{#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

<button class="fab" type="button" aria-label="Add a chore or alert" onclick={openSheet}>
	<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
</button>

{#if sheet}
	<button class="scrim" type="button" aria-label="Close" onclick={() => (sheet = false)}></button>
	<form class="add-sheet" onsubmit={save} aria-label="New chore or alert">
		<div class="seg" role="radiogroup" aria-label="Kind">
			<button type="button" role="radio" aria-checked={kind === 'chore'} class:on={kind === 'chore'} onclick={() => (kind = 'chore')}>Chore</button>
			<button type="button" role="radio" aria-checked={kind === 'alert'} class:on={kind === 'alert'} onclick={() => (kind = 'alert')}>Alert</button>
		</div>
		<p class="hint">{kind === 'chore' ? 'Stays on the display until someone marks it done.' : 'Pops up at its time, then moves on by itself.'}</p>
		<label>
			<span>{kind === 'chore' ? 'What needs doing' : 'What to say'}</span>
			<!-- svelte-ignore a11y_autofocus -->
			<input bind:value={title} maxlength="120" placeholder={kind === 'chore' ? 'Take out the bins' : 'Leave for practice'} autofocus />
		</label>
		<div class="pair">
			<label><span>Day</span><input type="date" bind:value={date} /></label>
			<label><span>Time</span><input type="time" bind:value={time} /></label>
		</div>
		<label>
			<span>Repeat</span>
			<select bind:value={repeat}>
				<option value="none">Once</option>
				<option value="daily">Every day</option>
				<option value="weekdays">Weekdays</option>
				<option value="weekly">Every week, same day</option>
				<option value="biweekly">Every 2 weeks</option>
				<option value="monthly">Every month</option>
				<option value="hourly">Every hour</option>
			</select>
		</label>
		<label>
			<span>Notes</span>
			<input bind:value={notes} maxlength="500" placeholder="Optional" />
		</label>
		<button class="save" type="submit">Add {kind}</button>
	</form>
{/if}

<RemoteTabBar active="tasks" />

<style>
	:global(html, body) {
		margin: 0;
		background: var(--background);
		color: var(--foreground);
		font-family: var(--font-body);
		-webkit-tap-highlight-color: transparent;
	}
	.remote {
		width: 100%;
		min-height: 100dvh;
		max-width: 22.5rem;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		gap: var(--space-4);
		padding:
			calc(env(safe-area-inset-top) + var(--space-3))
			calc(env(safe-area-inset-right) + var(--space-5))
			calc(4.6rem + max(0.75rem, env(safe-area-inset-bottom)) + 4.5rem)
			calc(env(safe-area-inset-left) + var(--space-5));
		box-sizing: border-box;
	}
	.bar {
		margin-bottom: auto;
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.siri,
	.note a {
		color: var(--brand);
		font-weight: 600;
		text-decoration: none;
	}
	.siri {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		font-size: var(--text-sm);
	}
	.status {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2rem;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-tertiary);
	}
	.status.connected {
		color: var(--ok);
	}
	.dot {
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: currentColor;
	}
	.empty-title {
		margin: 0 0 var(--space-1);
		font-size: var(--text-lg);
		font-weight: 700;
	}
	.note,
	.error,
	.hint {
		margin: 0;
		font-size: var(--text-sm);
		line-height: 1.4;
		color: var(--text-tertiary);
	}
	.error {
		color: var(--warn);
	}
	code {
		font-family: var(--font-code);
		font-size: 0.85em;
	}
	.kicker {
		margin: 0 0 var(--space-1);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-tertiary);
	}
	.count {
		font-weight: 500;
		opacity: 0.7;
	}
	.group[aria-label='Waiting'] .kicker {
		color: var(--warn);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		border-radius: var(--radius-md);
		background: var(--abyss-2);
		box-shadow: 0 0 0 1px var(--hairline);
	}
	.row {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: center;
		column-gap: var(--space-3);
		padding: 0 var(--space-3);
	}
	.row + .row {
		border-top: 1px solid var(--hairline);
	}
	.mark {
		width: 1.75rem;
		height: 1.75rem;
		margin: 0.5rem 0;
		padding: 0;
		border-radius: 50%;
		border: 2px solid color-mix(in srgb, var(--foreground) 32%, transparent);
		background: transparent;
		color: var(--text-secondary);
		display: grid;
		place-items: center;
		touch-action: manipulation;
		transition-property: transform, background-color;
		transition-duration: 150ms;
	}
	/* a bigger invisible hit area than the 28px ring */
	.mark {
		position: relative;
	}
	.mark::after {
		content: '';
		position: absolute;
		inset: -0.5rem;
	}
	.mark:active {
		transform: scale(0.96);
		background: color-mix(in srgb, var(--ok) 30%, transparent);
	}
	.mark svg {
		width: 1rem;
		height: 1rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.row[data-kind='alert'] .mark {
		border-color: transparent;
		background: color-mix(in srgb, var(--foreground) 8%, transparent);
	}
	.row[data-status='overdue'] .mark,
	.row[data-status='due'] .mark {
		border-color: var(--warn);
		color: var(--warn);
	}
	.row[data-status='done'] .mark {
		border-color: var(--ok);
		color: var(--ok);
	}
	.body {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.1rem;
		min-width: 0;
		min-height: 3.25rem;
		justify-content: center;
		padding: var(--space-2) 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
	}
	.title {
		max-width: 100%;
		font-size: var(--text-base);
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.row[data-status='done'] .title {
		color: var(--text-tertiary);
		text-decoration: line-through;
	}
	.meta {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}
	.row[data-status='overdue'] .meta .num,
	.row[data-status='due'] .meta .num {
		color: var(--warn);
	}
	.actions {
		grid-column: 2;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		padding-bottom: var(--space-3);
	}
	.notes {
		flex-basis: 100%;
		margin: 0 0 var(--space-1);
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	.actions button {
		min-height: 2.5rem;
		padding: 0 var(--space-3);
		border-radius: 999px;
		border: 0;
		background: var(--shell-fill);
		box-shadow: inset 0 0 0 1px var(--hairline);
		color: var(--text-secondary);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		touch-action: manipulation;
	}
	.actions button:active {
		transform: scale(0.96);
	}
	.actions .danger {
		color: var(--warn);
	}

	/* + sits bottom-right above the tab bar: the easiest spot for a right thumb */
	.fab {
		position: fixed;
		z-index: 21;
		right: calc(env(safe-area-inset-right) + 1.25rem);
		bottom: calc(max(0.75rem, env(safe-area-inset-bottom)) + 4.6rem);
		width: 3.5rem;
		height: 3.5rem;
		border-radius: 50%;
		border: 0;
		background: var(--brand);
		color: var(--abyss);
		display: grid;
		place-items: center;
		box-shadow: 0 10px 28px color-mix(in srgb, #000 55%, transparent);
		touch-action: manipulation;
		transition: transform 150ms var(--spring-smooth);
	}
	.fab:active {
		transform: scale(0.96);
	}
	.fab svg {
		width: 1.5rem;
		height: 1.5rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.5;
		stroke-linecap: round;
	}
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 30;
		border: 0;
		background: color-mix(in srgb, #000 55%, transparent);
	}
	.add-sheet {
		position: fixed;
		z-index: 31;
		left: 0;
		right: 0;
		bottom: 0;
		max-width: 24rem;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-5) var(--space-5) calc(max(var(--space-5), env(safe-area-inset-bottom)) + var(--space-2));
		border-radius: 1.5rem 1.5rem 0 0;
		background: var(--abyss-2);
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, var(--foreground) 12%, transparent),
			0 -20px 50px color-mix(in srgb, #000 60%, transparent);
		animation: sheet-up 260ms var(--spring-smooth) both;
	}
	@keyframes sheet-up {
		from {
			transform: translateY(24px);
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.add-sheet {
			animation: none;
		}
	}
	.seg {
		display: grid;
		grid-template-columns: 1fr 1fr;
		padding: 0.25rem;
		border-radius: 999px;
		background: var(--shell-fill);
		box-shadow: inset 0 0 0 1px var(--hairline);
	}
	.seg button {
		min-height: 2.5rem;
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: var(--text-tertiary);
		font: inherit;
		font-weight: 600;
		transition-property: background-color, color;
		transition-duration: 150ms;
	}
	.seg button.on {
		background: color-mix(in srgb, var(--foreground) 12%, transparent);
		color: var(--foreground);
	}
	label {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-tertiary);
	}
	.pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-2);
	}
	input,
	select {
		width: 100%;
		box-sizing: border-box;
		min-height: 2.75rem;
		padding: 0 var(--space-3);
		border-radius: var(--radius-md);
		border: 0;
		box-shadow: inset 0 0 0 1px var(--hairline);
		background: var(--shell-fill);
		color: var(--foreground);
		font: inherit;
		/* 16px+ keeps iOS from zooming the page on focus */
		font-size: max(1rem, 16px);
		font-weight: 500;
		color-scheme: dark;
	}
	.save {
		min-height: 3rem;
		margin-top: var(--space-1);
		border: 0;
		border-radius: 999px;
		background: var(--brand);
		color: var(--abyss);
		font: inherit;
		font-weight: 700;
		touch-action: manipulation;
	}
	.save:active {
		transform: scale(0.96);
	}
</style>
