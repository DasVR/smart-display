<!--
	Phone: set up Siri, the Action button and Shortcuts to talk to the wall.
	Each recipe is a few Shortcuts actions pointed at /api/tasks/say, /brief
	or /next/done, with this display's address already filled in. The "Try a
	phrase" box at the bottom (thumb reach) sends a sentence over /ws so you
	can check how the wall hears it before wiring up Siri.
-->
<script>
	import '../../../app.css';
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import RemoteTabBar from '$lib/components/RemoteTabBar.svelte';

	let origin = $state('');
	let phrase = $state('');
	let reply = $state(null); // { ok, say }
	let copied = $state('');
	let open = $state('tell');
	let status = $state('connecting');
	let ws;
	let retry = 0;

	const RECIPES = [
		{
			id: 'tell',
			name: 'Tell the wall',
			say: '"Hey Siri, tell the wall" … "take out the bins every Monday and Thursday at 6pm"',
			path: '/api/tasks/say?format=text',
			steps: [
				'New shortcut, named <b>Tell the wall</b> (that name is what you say to Siri).',
				'Add <b>Dictate Text</b>.',
				'Add <b>Get Contents of URL</b>, paste the address below, then tap <b>Show More</b>: Method <b>POST</b>, Request Body <b>JSON</b>, add a Text field <code>text</code> set to <b>Dictated Text</b>.',
				'Add <b>Speak Text</b> with <b>Contents of URL</b>.'
			]
		},
		{
			id: 'brief',
			name: "What's on the wall",
			say: '"Hey Siri, what\'s on the wall?"',
			path: '/api/tasks/brief?format=text',
			steps: [
				"New shortcut, named <b>What's on the wall</b>.",
				'Add <b>Get Contents of URL</b> with the address below (GET is the default).',
				'Add <b>Speak Text</b> with <b>Contents of URL</b>.'
			]
		},
		{
			id: 'done',
			name: 'Action button: done',
			say: 'Press and hold the Action button: the most urgent chore is ticked off',
			path: '/api/tasks/next/done?format=text',
			steps: [
				'New shortcut, named <b>Wall done</b>.',
				'Add <b>Get Contents of URL</b> with the address below, Method <b>POST</b>.',
				'Add <b>Show Notification</b> with <b>Contents of URL</b> (or Speak Text).',
				'Settings → <b>Action Button</b> → Shortcut → <b>Wall done</b>. It also works as a Lock Screen or Control Center button.'
			]
		},
		{
			id: 'snooze',
			name: 'Snooze the top item',
			say: '"Hey Siri, wall snooze": pushes the most urgent item back an hour',
			path: '/api/tasks/next/snooze?format=text',
			steps: [
				'New shortcut, named <b>Wall snooze</b>.',
				'Add <b>Get Contents of URL</b> with the address below, Method <b>POST</b>. Optional: Request Body JSON, Number field <code>minutes</code>.',
				'Add <b>Show Notification</b> with <b>Contents of URL</b>.'
			]
		}
	];

	const EXAMPLES = [
		'remind me to leave for practice in 20 minutes',
		'take out the bins every Monday and Thursday at 6pm',
		'call the dentist tomorrow',
		'meds every day at 8:30am'
	];

	function url(path) {
		return `${origin}${path}`;
	}

	async function copy(text, id) {
		try {
			// the clipboard API needs https; the kiosk is plain http on the LAN
			if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
			else {
				const ta = document.createElement('textarea');
				ta.value = text;
				ta.setAttribute('readonly', '');
				ta.style.position = 'fixed';
				ta.style.opacity = '0';
				document.body.appendChild(ta);
				ta.select();
				ta.setSelectionRange(0, text.length);
				document.execCommand('copy');
				ta.remove();
			}
			copied = id;
			setTimeout(() => copied === id && (copied = ''), 1600);
		} catch {
			copied = '';
		}
	}

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
				if (msg.type === 'tasks-said') reply = { ok: msg.ok, say: msg.say };
			} catch {
				/* ignore */
			}
		};
	}

	function tryPhrase(e) {
		e?.preventDefault();
		if (!phrase.trim()) return;
		if (ws?.readyState !== 1) {
			reply = { ok: false, say: 'Not connected to the display.' };
			return;
		}
		ws.send(JSON.stringify({ type: 'tasks', op: 'say', text: phrase }));
		reply = null;
		phrase = '';
	}

	onMount(() => {
		origin = location.origin;
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
	<title>Siri &amp; Shortcuts</title>
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
	<meta name="theme-color" content="#07070b">
	<meta name="apple-mobile-web-app-capable" content="yes">
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
</svelte:head>

<div class="remote" role="region" aria-label="Siri and Shortcuts">
	<header class="bar">
		<a class="back" href="{base}/remote/tasks">
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
			Tasks
		</a>
	</header>

	<div class="intro">
		<h1>Siri &amp; Shortcuts</h1>
		<p class="note">
			Add chores by voice, hear what's waiting, and tick things off with the Action button. Each one is a short
			shortcut in Apple's <b>Shortcuts</b> app.
		</p>
		<a class="open-app" href="shortcuts://create-shortcut">Open Shortcuts</a>
	</div>

	<ul class="recipes">
		{#each RECIPES as r (r.id)}
			<li class:open={open === r.id}>
				<button class="head" type="button" aria-expanded={open === r.id} onclick={() => (open = open === r.id ? '' : r.id)}>
					<span class="name">{r.name}</span>
					<span class="say">{r.say}</span>
				</button>
				{#if open === r.id}
					<div class="detail">
						<ol>
							{#each r.steps as s, i (i)}
								<!-- eslint-disable-next-line svelte/no-at-html-tags -- static recipe text -->
								<li>{@html s}</li>
							{/each}
						</ol>
						<div class="url">
							<code>{url(r.path)}</code>
							<button type="button" onclick={() => copy(url(r.path), r.id)}>{copied === r.id ? 'Copied' : 'Copy'}</button>
						</div>
					</div>
				{/if}
			</li>
		{/each}
	</ul>

	<p class="note small">
		Locked the API with <code>npm run api-token</code>? In each <b>Get Contents of URL</b>, add a header
		<code>Authorization</code> = <code>Bearer</code> plus your token. Your phone needs to be on the same Wi-Fi as
		the display.
	</p>

	<form class="try" onsubmit={tryPhrase} aria-label="Try a phrase">
		<p class="kicker">
			Try a phrase
			<span class="status" class:connected={status === 'live'}>{status}</span>
		</p>
		{#if reply}
			<p class="reply" class:bad={!reply.ok} role="status">{reply.say}</p>
		{:else}
			<div class="chips">
				{#each EXAMPLES as ex (ex)}
					<button type="button" onclick={() => (phrase = ex)}>{ex}</button>
				{/each}
			</div>
		{/if}
		<div class="field">
			<input bind:value={phrase} placeholder="water the plants every Sunday" enterkeyhint="send" aria-label="Phrase" />
			<button class="send" type="submit" aria-label="Add it">
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
			</button>
		</div>
		<p class="note small">This really adds it, the same way Siri would.</p>
	</form>
</div>

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
			calc(4.6rem + max(0.75rem, env(safe-area-inset-bottom)) + var(--space-3))
			calc(env(safe-area-inset-left) + var(--space-5));
		box-sizing: border-box;
	}
	.bar {
		margin-bottom: auto;
	}
	.back {
		display: inline-flex;
		align-items: center;
		gap: 0.15rem;
		min-height: 2.75rem;
		color: var(--brand);
		font-weight: 600;
		text-decoration: none;
	}
	.back svg {
		width: 1.2rem;
		height: 1.2rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.25;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	h1 {
		margin: 0 0 var(--space-1);
		font-family: var(--font-display);
		font-size: var(--text-2xl);
		font-weight: 700;
		letter-spacing: -0.01em;
	}
	.note {
		margin: 0;
		font-size: var(--text-sm);
		line-height: 1.45;
		color: var(--text-tertiary);
	}
	.note b {
		color: var(--text-secondary);
	}
	.small {
		font-size: var(--text-xs, 0.78rem);
	}
	code {
		font-family: var(--font-code);
		font-size: 0.85em;
		color: var(--text-secondary);
		overflow-wrap: anywhere;
	}
	.open-app {
		display: inline-flex;
		align-items: center;
		min-height: 2.5rem;
		margin-top: var(--space-3);
		padding: 0 var(--space-4);
		border-radius: 999px;
		background: var(--shell-fill);
		box-shadow: inset 0 0 0 1px var(--hairline);
		color: var(--foreground);
		font-size: var(--text-sm);
		font-weight: 600;
		text-decoration: none;
	}
	.recipes {
		list-style: none;
		margin: 0;
		padding: 0;
		border-radius: var(--radius-md);
		background: var(--abyss-2);
		box-shadow: 0 0 0 1px var(--hairline);
	}
	.recipes > li + li {
		border-top: 1px solid var(--hairline);
	}
	.head {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.15rem;
		min-height: 3.5rem;
		padding: var(--space-3);
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		touch-action: manipulation;
	}
	.name {
		font-weight: 700;
	}
	.say {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		line-height: 1.35;
	}
	.open .name {
		color: var(--brand);
	}
	.detail {
		padding: 0 var(--space-3) var(--space-3);
	}
	ol {
		margin: 0 0 var(--space-3);
		padding-left: 1.2rem;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		font-size: var(--text-sm);
		line-height: 1.45;
		color: var(--text-secondary);
	}
	ol :global(b) {
		color: var(--foreground);
	}
	.url {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		background: var(--shell-fill);
		box-shadow: inset 0 0 0 1px var(--hairline);
	}
	.url code {
		flex: 1;
		min-width: 0;
		font-size: 0.78rem;
	}
	.url button,
	.chips button {
		flex: none;
		min-height: 2.5rem;
		padding: 0 var(--space-3);
		border: 0;
		border-radius: 999px;
		background: color-mix(in srgb, var(--foreground) 10%, transparent);
		color: var(--foreground);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		touch-action: manipulation;
	}
	.url button:active,
	.chips button:active,
	.send:active {
		transform: scale(0.96);
	}
	.try {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.kicker {
		display: flex;
		justify-content: space-between;
		margin: 0;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-tertiary);
	}
	.status {
		font-weight: 500;
	}
	.status.connected {
		color: var(--ok);
	}
	.chips {
		display: flex;
		gap: var(--space-2);
		overflow-x: auto;
		margin: 0 calc(-1 * var(--space-5));
		padding: 0 var(--space-5);
		scrollbar-width: none;
	}
	.chips button {
		white-space: nowrap;
		background: var(--shell-fill);
		box-shadow: inset 0 0 0 1px var(--hairline);
		color: var(--text-secondary);
		font-weight: 500;
	}
	.reply {
		margin: 0;
		padding: var(--space-3);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--ok) 14%, var(--abyss-2));
		font-size: var(--text-sm);
		line-height: 1.4;
	}
	.reply.bad {
		background: color-mix(in srgb, var(--warn) 14%, var(--abyss-2));
	}
	.field {
		display: flex;
		gap: var(--space-2);
	}
	input {
		flex: 1;
		min-width: 0;
		min-height: 3rem;
		padding: 0 var(--space-4);
		border-radius: 999px;
		border: 0;
		box-shadow: inset 0 0 0 1px var(--hairline);
		background: var(--shell-fill);
		color: var(--foreground);
		font: inherit;
		font-size: max(1rem, 16px);
		color-scheme: dark;
	}
	.send {
		flex: none;
		width: 3rem;
		height: 3rem;
		border: 0;
		border-radius: 50%;
		background: var(--brand);
		color: var(--abyss);
		display: grid;
		place-items: center;
		touch-action: manipulation;
	}
	.send svg {
		width: 1.3rem;
		height: 1.3rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
