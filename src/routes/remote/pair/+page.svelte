<!--
	Pair this phone with the wall (src/lib/server/pairing.js): ask the wall
	for a code, type it here, and the phone keeps a device token. Paired
	phones see the others, can remove any of them, and can require pairing.
-->
<script>
	import '../../../app.css';
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import RemoteTabBar from '$lib/components/RemoteTabBar.svelte';
	import { deviceToken, saveDeviceToken, wallSocketUrl } from '$lib/remoteAuth.js';

	let ws;
	let retry = 0;
	let status = $state('connecting');
	let you = $state(null);
	let local = $state(false);
	let info = $state(null); // { required, requiredSetting, overriddenByEnv, devices, codeActive }
	let requiredOnly = $state(false);
	let step = $state('idle'); // idle | code | done
	let name = $state('');
	let code = $state('');
	let message = $state('');
	let busy = $state(false);

	const ERRORS = {
		expired: 'That code ran out. Ask the wall for a new one.',
		'wrong-code': "That's not the code on the wall. Try again.",
		'too-many-tries': 'Too many wrong codes. Wait a few minutes, then ask for a new one.',
		'too-many-devices': 'The wall already has 24 phones. Remove one first.'
	};

	function send(msg) {
		if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'pair', ...msg }));
	}

	function connect() {
		ws = new WebSocket(wallSocketUrl());
		ws.onopen = () => {
			status = 'live';
			retry = 0;
			send({ op: 'status' });
		};
		ws.onclose = () => {
			status = 'offline';
			setTimeout(connect, Math.min(8000, 1000 * 2 ** retry++));
		};
		ws.onmessage = (e) => {
			try {
				const msg = JSON.parse(e.data);
				if (msg.type === 'pair-required') requiredOnly = true;
				if (msg.type !== 'pair') return;
				busy = false;
				if (msg.token) {
					saveDeviceToken(msg.token);
					you = msg.device;
					step = 'done';
					message = '';
					// reconnect with the token, then go back where we came from
					const next = new URLSearchParams(location.search).get('next');
					if (next && next.startsWith('/')) setTimeout(() => (location.href = next), 900);
					else reconnect();
					return;
				}
				if (msg.error === 'not-paired') {
					// a token the wall no longer knows: forget it
					if (deviceToken()) saveDeviceToken('');
					you = null;
					info = { required: Boolean(msg.status?.required), devices: [] };
					return;
				}
				if (msg.error) {
					message = ERRORS[msg.error] || 'Something went wrong.';
					if (msg.error !== 'wrong-code') step = 'idle';
					return;
				}
				if (msg.started) {
					step = 'code';
					message = '';
					return;
				}
				if (msg.status) {
					info = msg.status;
					you = msg.you ?? null;
					local = Boolean(msg.local);
				}
			} catch {
				/* ignore */
			}
		};
	}

	function reconnect() {
		if (ws) {
			ws.onclose = null;
			ws.close();
		}
		connect();
	}

	function askForCode() {
		busy = true;
		message = '';
		code = '';
		send({ op: 'start' });
	}

	function submitCode(e) {
		e?.preventDefault();
		const digits = code.replace(/\D/g, '');
		if (digits.length !== 6) {
			message = 'The code is six digits.';
			return;
		}
		busy = true;
		send({ op: 'redeem', code: digits, name: name.trim() || 'Phone' });
	}

	function cancel() {
		send({ op: 'cancel' });
		step = 'idle';
	}

	function unpairMe() {
		if (!you) return;
		send({ op: 'revoke', id: you.id });
		saveDeviceToken('');
		you = null;
		setTimeout(reconnect, 200);
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

	function ago(iso) {
		const ms = Date.now() - Date.parse(iso);
		if (!(ms >= 0)) return '';
		if (ms < 120000) return 'just now';
		if (ms < 3600000) return `${Math.round(ms / 60000)} min ago`;
		if (ms < 86400000) return `${Math.round(ms / 3600000)} h ago`;
		return `${Math.round(ms / 86400000)} days ago`;
	}
</script>

<svelte:head>
	<title>Pair this phone</title>
</svelte:head>

<div class="remote" role="region" aria-label="Pairing">
	<header class="bar">
		<h1>{you ? 'Phones' : 'Pair this phone'}</h1>
		<span class="status" class:live={status === 'live'}>{status === 'live' ? 'Connected' : status === 'offline' ? 'Offline' : 'Connecting'}</span>
	</header>

	{#if !you}
		<section class="card">
			{#if requiredOnly || info?.required}
				<p class="note warn">This wall only answers paired phones. Pair this one to use the remote.</p>
			{:else}
				<p class="note">Pairing tells the wall which phone is which. Nothing changes for other phones until someone turns on "Only paired phones".</p>
			{/if}

			{#if step === 'code'}
				<form class="stack" onsubmit={submitCode}>
					<label for="code">Type the code on the wall</label>
					<input
						id="code"
						class="code"
						inputmode="numeric"
						autocomplete="one-time-code"
						maxlength="7"
						placeholder="000 000"
						bind:value={code}
					/>
					<div class="row">
						<button type="button" class="ghost" onclick={cancel}>Cancel</button>
						<button type="submit" disabled={busy || status !== 'live'}>Pair</button>
					</div>
				</form>
			{:else}
				<div class="stack">
					<label for="name">Name this phone</label>
					<input id="name" type="text" maxlength="32" placeholder="Kitchen iPad" bind:value={name} />
					<button onclick={askForCode} disabled={busy || status !== 'live'}>Show a code on the wall</button>
				</div>
			{/if}
			{#if message}<p class="note warn" role="status">{message}</p>{/if}
		</section>
	{:else}
		<section class="card">
			<p class="note">{step === 'done' ? 'Paired. ' : ''}This phone is <strong>{you.name}</strong>.</p>
			<button class="ghost" onclick={unpairMe}>Unpair this phone</button>
		</section>

		{#if info}
			<section class="card" aria-labelledby="req-h">
				<h2 id="req-h">Only paired phones</h2>
				<label class="row">
					<span class="note">Phones that aren't paired can't see or control the wall. The wall's own screen always works.</span>
					<input type="checkbox" checked={info.requiredSetting} onchange={(e) => send({ op: 'require', on: e.currentTarget.checked })} />
				</label>
				{#if info.overriddenByEnv}
					<p class="note warn">Turned off on the display (DISPLAY_REQUIRE_PAIRING=0), so this switch has no effect.</p>
				{/if}
			</section>

			<section class="card" aria-labelledby="dev-h">
				<h2 id="dev-h">Paired phones</h2>
				<ul class="devices">
					{#each info.devices as d (d.id)}
						<li>
							<span>
								<strong>{d.name}</strong>{#if d.id === you?.id}<span class="me"> · this phone</span>{/if}
								<span class="note">Seen {ago(d.lastSeen)}</span>
							</span>
							{#if d.id !== you?.id}
								<button class="ghost small" onclick={() => send({ op: 'revoke', id: d.id })}>Remove</button>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}
		<a class="desk-link" href="{base}/remote">Back to the remote</a>
	{/if}
	{#if local}<p class="note">You're on the display itself.</p>{/if}
</div>

<RemoteTabBar active="stats" />

<style>
	:global(body) {
		background: var(--background);
		color: var(--foreground);
		font-family: var(--font-body);
		overflow-x: clip;
		-webkit-tap-highlight-color: transparent;
	}
	.remote {
		width: 100%;
		min-height: 100dvh;
		max-width: 22.5rem;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding:
			calc(env(safe-area-inset-top) + var(--space-3))
			calc(env(safe-area-inset-right) + var(--space-5))
			calc(4.6rem + max(0.75rem, env(safe-area-inset-bottom)) + var(--space-3))
			calc(env(safe-area-inset-left) + var(--space-5));
		box-sizing: border-box;
	}
	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 2.75rem;
	}
	h1 {
		margin: 0;
		font-size: var(--text-xl);
		font-weight: 700;
	}
	h2 {
		margin: 0;
		font-size: var(--text-lg);
		font-weight: 700;
	}
	.status {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}
	.status.live {
		color: var(--ok);
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-md);
		background: var(--abyss-2);
	}
	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}
	label {
		font-size: var(--text-sm);
		font-weight: 600;
	}
	input[type='text'],
	input.code {
		min-height: 2.75rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-sm);
		background: var(--abyss-1);
		color: var(--foreground);
		font: inherit;
	}
	input.code {
		min-height: 3.5rem;
		font-size: 1.8rem;
		font-weight: 700;
		letter-spacing: 0.3em;
		text-align: center;
	}
	input[type='checkbox'] {
		flex: none;
		width: 1.5rem;
		height: 1.5rem;
		accent-color: var(--brand);
	}
	button {
		min-height: 2.75rem;
		padding: 0 var(--space-4);
		border: 0;
		border-radius: 999px;
		background: var(--brand);
		color: var(--background);
		font: inherit;
		font-weight: 700;
	}
	button.ghost {
		background: transparent;
		color: var(--foreground);
		border: 1px solid var(--hairline);
	}
	button.small {
		min-height: 2.25rem;
		padding: 0 var(--space-3);
	}
	button:disabled {
		opacity: 0.45;
	}
	.note {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		line-height: 1.35;
	}
	.note.warn {
		color: var(--warn);
	}
	.devices {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.devices li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		min-height: 2.75rem;
	}
	.devices li > span {
		display: flex;
		flex-direction: column;
	}
	.me {
		color: var(--text-tertiary);
		font-weight: 400;
	}
	.desk-link {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		color: var(--brand);
		font-size: var(--text-sm);
		font-weight: 600;
		text-decoration: none;
	}
</style>
