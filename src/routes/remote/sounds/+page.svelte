<!--
	Phone page for the wall's voice and its sound library: turn the voice on
	or off, set quiet hours, see today's ElevenLabs usage, say something on
	the wall, and audition every sound (on the phone itself).
-->
<script>
	import '../../../app.css';
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import RemoteTabBar from '$lib/components/RemoteTabBar.svelte';
	import { SOUND_LIBRARY } from '$lib/sounds/library.js';
	import { playChime, primeAudio } from '$lib/services/chime.js';

	let ws;
	let retry = 0;
	let status = $state('connecting');
	let settings = $state(null);
	let phrase = $state('');
	let reply = $state('');
	let have = $state(new Set());
	let playingName = $state('');

	const groups = [...new Set(SOUND_LIBRARY.map((s) => s.group))].map((g) => ({
		name: g,
		sounds: SOUND_LIBRARY.filter((s) => s.group === g)
	}));

	const SILENT = {
		off: 'The voice is off, so it was only shown.',
		'quiet-hours': 'Quiet hours, so it was only shown.',
		'no-key': 'No ElevenLabs key on the display yet, so it was only shown.',
		'bad-key': 'ElevenLabs refused the key. It was only shown.',
		'daily-limit': "Today's voice budget is spent, so it was only shown.",
		'rate-limited': 'ElevenLabs is busy. It was only shown.',
		'tts-failed': "ElevenLabs didn't answer. It was only shown."
	};

	function send(msg) {
		if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'voice', ...msg }));
	}

	function connect() {
		const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		ws = new WebSocket(`${proto}//${location.host}/ws`);
		ws.onopen = () => {
			status = 'live';
			retry = 0;
			ws.send(JSON.stringify({ type: 'hello', role: 'remote' }));
			send({ op: 'get' });
		};
		ws.onclose = () => {
			status = 'offline';
			setTimeout(connect, Math.min(8000, 1000 * 2 ** retry++));
		};
		ws.onmessage = (e) => {
			try {
				const msg = JSON.parse(e.data);
				if (msg.type !== 'voice') return;
				if (msg.settings) settings = msg.settings;
				if (msg.said) {
					if (!msg.said.ok) reply = 'Nothing to say.';
					else if (msg.said.spoken) reply = 'Said on the wall.';
					else reply = SILENT[msg.said.silent] || 'Shown on the wall.';
				}
			} catch {
				/* ignore */
			}
		};
	}

	function patch(p) {
		send({ op: 'set', patch: p });
	}

	function sayIt(e) {
		e?.preventDefault();
		if (!phrase.trim()) return;
		reply = 'Sending…';
		send({ op: 'say', text: phrase });
		phrase = '';
	}

	function audition(name) {
		primeAudio();
		playChime(name);
		playingName = name;
		setTimeout(() => playingName === name && (playingName = ''), 900);
	}

	onMount(() => {
		connect();
		fetch(`${base}/sounds/index.json`, { cache: 'no-cache' })
			.then((r) => (r.ok ? r.json() : { sounds: {} }))
			.then((d) => (have = new Set(Object.keys(d.sounds || {}))))
			.catch(() => {});
		return () => {
			if (ws) {
				ws.onclose = null;
				ws.close();
			}
		};
	});

	let used = $derived(settings ? Math.min(100, Math.round((settings.charsToday / Math.max(1, settings.dailyChars)) * 100)) : 0);
</script>

<svelte:head>
	<title>Sounds & voice</title>
</svelte:head>

<div class="remote" role="region" aria-label="Sounds and voice">
	<header class="bar">
		<h1>Sounds &amp; voice</h1>
		<span class="status" class:live={status === 'live'}>{status === 'live' ? 'Connected' : status === 'offline' ? 'Offline' : 'Connecting'}</span>
	</header>

	<section class="card" aria-labelledby="voice-h">
		<h2 id="voice-h">The wall's voice</h2>
		{#if !settings}
			<p class="note">Reading the display…</p>
		{:else}
			<label class="row">
				<span>Speak out loud</span>
				<input type="checkbox" checked={settings.enabled} onchange={(e) => patch({ enabled: e.currentTarget.checked })} />
			</label>
			{#if !settings.hasKey}
				<p class="note warn">
					No ElevenLabs key on the display. Put it in <code>data/elevenlabs-key</code> on the kiosk. Until then the wall
					shows what it would say.
				</p>
			{/if}
			<div class="row">
				<span>Quiet from</span>
				<span class="times">
					<input type="time" value={settings.quietStart} onchange={(e) => patch({ quietStart: e.currentTarget.value })} aria-label="Quiet hours start" />
					<span>to</span>
					<input type="time" value={settings.quietEnd} onchange={(e) => patch({ quietEnd: e.currentTarget.value })} aria-label="Quiet hours end" />
				</span>
			</div>
			<p class="note">
				{settings.quietNow ? 'Quiet now: the wall shows things but stays silent.' : 'Not quiet hours.'}
			</p>
			<div class="usage" aria-label="Today's voice use">
				<div class="meter"><span style="width: {used}%"></span></div>
				<p class="note">
					{settings.charsToday.toLocaleString()} of {settings.dailyChars.toLocaleString()} characters today. Phrases it has
					said before are free.
				</p>
			</div>
			<form class="say" onsubmit={sayIt}>
				<input type="text" bind:value={phrase} placeholder="Dinner is ready" maxlength="280" aria-label="Say on the wall" />
				<button type="submit" disabled={!phrase.trim() || status !== 'live'}>Say it</button>
			</form>
			{#if reply}<p class="note" role="status">{reply}</p>{/if}
			<p class="note">From Siri: "tell the wall" … "announce dinner is ready".</p>
		{/if}
	</section>

	<section class="card" aria-labelledby="lib-h">
		<h2 id="lib-h">Sound library</h2>
		<p class="note">
			Plays on this phone. {have.size} of {SOUND_LIBRARY.length} recorded; the rest use the built-in taps until
			<code>npm run sounds:generate</code> makes them.
		</p>
		{#each groups as g (g.name)}
			<h3>{g.name}</h3>
			<ul class="sounds">
				{#each g.sounds as s (s.name)}
					<li>
						<button class="sound" class:playing={playingName === s.name} onclick={() => audition(s.name)}>
							<span class="name">{s.name}</span>
							<span class="tag" class:made={have.has(s.name)}>{have.has(s.name) ? 'recorded' : 'stand-in'}</span>
						</button>
						<p class="prompt">{s.prompt.replace(/, close-miked.*$/, '')}</p>
					</li>
				{/each}
			</ul>
		{/each}
	</section>
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
		gap: var(--space-3);
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
	h3 {
		margin: var(--space-2) 0 0;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-tertiary);
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
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		min-height: 2.75rem;
	}
	.row input[type='checkbox'] {
		width: 1.5rem;
		height: 1.5rem;
		accent-color: var(--brand);
	}
	.times {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}
	input[type='time'],
	.say input {
		min-height: 2.75rem;
		padding: 0 var(--space-2);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-sm);
		background: var(--abyss-1);
		color: var(--foreground);
		font: inherit;
	}
	.say {
		display: flex;
		gap: var(--space-2);
	}
	.say input {
		flex: 1;
		min-width: 0;
	}
	button {
		min-height: 2.75rem;
		padding: 0 var(--space-3);
		border: 0;
		border-radius: 999px;
		background: var(--brand);
		color: var(--background);
		font: inherit;
		font-weight: 700;
	}
	button:disabled {
		opacity: 0.45;
	}
	.note {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		line-height: 1.35;
		overflow-wrap: anywhere;
	}
	.note.warn {
		color: var(--warn);
	}
	.meter {
		height: 0.4rem;
		border-radius: 999px;
		background: var(--abyss-1);
		overflow: hidden;
	}
	.meter span {
		display: block;
		height: 100%;
		background: var(--brand);
	}
	.usage {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.sounds {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.sound {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		background: var(--abyss-1);
		color: var(--foreground);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-sm);
		font-weight: 600;
		transition: border-color 0.2s;
	}
	.sound.playing {
		border-color: var(--brand);
	}
	.tag {
		font-size: var(--text-xs, 0.75rem);
		font-weight: 600;
		color: var(--text-tertiary);
	}
	.tag.made {
		color: var(--ok);
	}
	.prompt {
		margin: var(--space-1, 0.25rem) 0 0;
		font-size: var(--text-xs, 0.75rem);
		color: var(--text-tertiary);
		line-height: 1.35;
	}
	code {
		font-family: var(--font-mono, monospace);
		font-size: 0.9em;
	}
</style>
