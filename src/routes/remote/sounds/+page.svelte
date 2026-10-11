<!--
	Phone page for the wall's voice and its sound library: turn the voice on
	or off, set quiet hours, see today's ElevenLabs usage, say something on
	the wall, audition every sound (on the phone itself), and make new ones:
	describe a sound and the wall generates it with ElevenLabs, or fill in a
	built-in stand-in with one tap.
-->
<script>
	import '../../../app.css';
	import { wallSocketUrl, followPairing } from '$lib/remoteAuth.js';
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import RemoteTabBar from '$lib/components/RemoteTabBar.svelte';
	import { SOUND_LIBRARY } from '$lib/sounds/library.js';
	import { SOUND_IDEAS } from '$lib/sounds/custom.js';
	import { playChime, playCustom, primeAudio, reloadCustomSounds } from '$lib/services/chime.js';

	let ws;
	let retry = 0;
	let status = $state('connecting');
	let settings = $state(null);
	let phrase = $state('');
	let reply = $state('');
	let have = $state(new Set());
	let playingName = $state('');
	let keyInput = $state('');
	let keyBusy = $state(false);
	let keyMessage = $state('');
	let keyFailed = $state(false);
	let keyEditing = $state(false);
	// sounds made on the wall: the list, what's being made, and a queue for "make the missing ones"
	let lib = $state({ sounds: {}, assign: {}, max: 24, secondsToday: 0, dailySeconds: 90, hasKey: true });
	let idea = $state('');
	let length = $state('auto');
	let making = $state('');
	let makeMessage = $state('');
	let makeFailed = $state(false);
	let queue = [];

	const KEY_RESULTS = {
		'bad-format': "That doesn't look like an ElevenLabs key. Copy it again from elevenlabs.io → Developers → API Keys.",
		invalid: 'ElevenLabs says that key is not valid. Nothing was saved.',
		'not-paired': 'Only a paired phone can change the key. Pair this phone under Stats → Phones.',
		unwritable: "The display couldn't save the key."
	};

	const groups = [...new Set(SOUND_LIBRARY.map((s) => s.group))].map((g) => ({
		name: g,
		sounds: SOUND_LIBRARY.filter((s) => s.group === g)
	}));

	const LENGTHS = { auto: undefined, short: 0.8, medium: 2, long: 4 };

	const MAKE_RESULTS = {
		'no-key': 'Add your ElevenLabs key above first; the wall needs it to make sounds.',
		empty: 'Describe a sound first, like "a doorbell".',
		'too-many': 'That is the most sounds the wall keeps. Delete one first.',
		'daily-limit': "Today's sound budget is used up. Try again tomorrow.",
		'rate-limited': 'ElevenLabs is busy. Try again in a minute.',
		'bad-key': 'ElevenLabs refused the key.',
		failed: "ElevenLabs didn't make that one. Try again, or describe it differently.",
		'not-paired': 'Only a paired phone can make sounds. Pair this phone under Stats → Phones.',
		'unknown-kind': 'The wall does not know that sound.',
		'not-found': 'That sound has gone.'
	};

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
		ws = new WebSocket(wallSocketUrl());
		ws.onopen = () => {
			status = 'live';
			retry = 0;
			ws.send(JSON.stringify({ type: 'hello', role: 'remote' }));
			send({ op: 'get' });
			sendSounds({ op: 'get' });
		};
		ws.onclose = () => {
			status = 'offline';
			setTimeout(connect, Math.min(8000, 1000 * 2 ** retry++));
		};
		ws.onmessage = (e) => {
			try {
				const msg = JSON.parse(e.data);
				if (followPairing(msg)) return;
				if (msg.type === 'sounds-changed') {
					reloadCustomSounds();
					return;
				}
				if (msg.type === 'sounds') return heardSounds(msg);
				if (msg.type !== 'voice') return;
				if (msg.settings) settings = msg.settings;
				if (msg.keyResult) {
					keyBusy = false;
					const r = msg.keyResult;
					keyFailed = !r.ok;
					if (!r.ok) keyMessage = KEY_RESULTS[r.error] || 'Something went wrong.';
					else if (r.verified === true) keyMessage = 'Saved. ElevenLabs accepted the key.';
					else if (r.verified === false) keyMessage = "Saved. ElevenLabs couldn't confirm it (a restricted key, or offline); try Say it below.";
					else keyMessage = 'Key removed. The wall shows words without speaking them.';
					if (r.ok) keyEditing = false;
				}
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

	function sendSounds(msg) {
		if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'sounds', ...msg }));
	}

	function heardSounds(msg) {
		if (msg.library) lib = msg.library;
		const r = msg.result;
		if (!r) return;
		if (r.op === 'generate') {
			making = '';
			if (r.ok) {
				makeFailed = false;
				makeMessage = r.assigned ? `Made "${r.assigned}". It plays on the wall now.` : `Made "${r.sound?.idea || r.name}". Tap it below to hear it.`;
				reloadCustomSounds().then(() => (r.assigned ? playChime(r.assigned) : playCustom(r.name)));
				if (!r.assigned) idea = '';
				// the next of "make the missing ones"
				const next = queue.shift();
				if (next) makeLibrary(next);
			} else {
				queue = [];
				makeFailed = true;
				makeMessage = MAKE_RESULTS[r.error] || 'Something went wrong.';
			}
		} else if (!r.ok) {
			makeFailed = true;
			makeMessage = MAKE_RESULTS[r.error] || 'Something went wrong.';
		}
	}

	function makeIdea(e) {
		e?.preventDefault();
		const text = idea.trim();
		if (!text || making) return;
		primeAudio();
		making = text;
		makeFailed = false;
		makeMessage = 'Making it… this takes a few seconds.';
		sendSounds({ op: 'generate', idea: text, seconds: LENGTHS[length] });
	}

	function makeLibrary(kind) {
		if (making && making !== kind) return;
		primeAudio();
		making = kind;
		makeFailed = false;
		makeMessage = `Making "${kind}"…`;
		sendSounds({ op: 'generate', kind });
	}

	function makeMissing() {
		queue = missing.map((s) => s.name);
		const first = queue.shift();
		if (first) makeLibrary(first);
	}

	function assignTo(kind, name) {
		sendSounds({ op: 'assign', kind, name: name || null });
	}

	function forget(name) {
		sendSounds({ op: 'delete', name });
	}

	function playMade(name) {
		primeAudio();
		playCustom(name);
		playingName = `custom:${name}`;
		setTimeout(() => playingName === `custom:${name}` && (playingName = ''), 900);
	}

	/** Made here from an older version of the library's prompt (the library changed since). */
	function oldStyle(entry) {
		const made = lib.sounds[`lib-${entry.name}`];
		return Boolean(made && lib.assign[entry.name] === `lib-${entry.name}` && made.prompt && made.prompt !== entry.prompt);
	}

	function usedFor(name) {
		return Object.entries(lib.assign)
			.filter(([, n]) => n === name)
			.map(([kind]) => kind);
	}

	function saveKey(e) {
		e?.preventDefault();
		const k = keyInput.trim();
		if (!k) return;
		keyBusy = true;
		keyFailed = false;
		keyMessage = 'Checking with ElevenLabs…';
		send({ op: 'key', key: k });
		// don't keep the key in the page any longer than needed
		keyInput = '';
	}

	function forgetKey() {
		keyBusy = true;
		send({ op: 'forget-key' });
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

	// a sound counts as recorded when the repo has its file; otherwise it's a stand-in until one is made here
	// stand-ins, plus sounds made here from an older version of the library's prompts
	let missing = $derived(SOUND_LIBRARY.filter((s) => (!have.has(s.name) && !lib.assign[s.name]) || oldStyle(s)));
	let anyOld = $derived(SOUND_LIBRARY.some((s) => oldStyle(s)));
	let madeList = $derived(Object.entries(lib.sounds).sort((a, b) => (b[1].made || 0) - (a[1].made || 0)));
	let budget = $derived(Math.min(100, Math.round((lib.secondsToday / Math.max(1, lib.dailySeconds)) * 100)));

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
			<div class="key" aria-labelledby="key-h">
				<h3 id="key-h">ElevenLabs key</h3>
				{#if settings.keySource === 'env' && !keyEditing}
					<p class="note">Set on the display itself ({settings.keyHint}). Change it there.</p>
				{:else if settings.hasKey && !keyEditing}
					<div class="row wrap">
						<span class="note">Saved on the display ({settings.keyHint})</span>
						<span class="key-actions">
							<button type="button" class="ghost small" onclick={() => ((keyEditing = true), (keyMessage = ''))}>Replace</button>
							<button type="button" class="ghost small" onclick={forgetKey} disabled={keyBusy}>Remove</button>
						</span>
					</div>
				{:else}
					<form class="say" onsubmit={saveKey}>
						<input
							type="password"
							bind:value={keyInput}
							placeholder="sk_…"
							autocomplete="off"
							autocapitalize="off"
							spellcheck="false"
							aria-label="ElevenLabs API key"
						/>
						<button type="submit" disabled={!keyInput.trim() || keyBusy || status !== 'live'}>Save</button>
					</form>
					<p class="note">
						From elevenlabs.io → Developers → API Keys. It's kept only on the display and never shown again. Until it's set
						the wall shows what it would say.
					</p>
					{#if keyEditing}
						<button type="button" class="ghost small" onclick={() => (keyEditing = false)}>Cancel</button>
					{/if}
				{/if}
				{#if keyMessage}<p class="note" class:warn={keyFailed} role="status">{keyMessage}</p>{/if}
			</div>
			<div class="quiet">
				<span>Quiet hours</span>
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

	<section class="card" aria-labelledby="make-h">
		<h2 id="make-h">Make a sound</h2>
		<form class="say" onsubmit={makeIdea}>
			<input type="text" bind:value={idea} placeholder="a doorbell" maxlength="140" aria-label="Describe a sound" />
			<button type="submit" disabled={!idea.trim() || !!making || status !== 'live'}>{making && making === idea.trim() ? 'Making…' : 'Make'}</button>
		</form>
		<div class="chips" aria-label="Ideas">
			{#each SOUND_IDEAS as ex (ex)}
				<button type="button" class="chip" onclick={() => (idea = ex)}>{ex}</button>
			{/each}
		</div>
		<label class="row">
			<span>Length</span>
			<select bind:value={length} aria-label="Length">
				<option value="auto">Let the wall pick</option>
				<option value="short">Short tap</option>
				<option value="medium">About 2 seconds</option>
				<option value="long">Long, 4 seconds</option>
			</select>
		</label>
		{#if makeMessage}<p class="note" class:warn={makeFailed} role="status">{makeMessage}</p>{/if}
		<p class="note">
			The wall makes it once with ElevenLabs, in the same soft, creamy desk style as the rest, and keeps it. Start with "!" to
			send exactly what you typed. {lib.secondsToday.toFixed(0)} of {lib.dailySeconds} seconds made today.
		</p>
		<div class="meter" aria-hidden="true"><span style="width: {budget}%"></span></div>

		{#if madeList.length}
			<h3>Made on the wall ({madeList.length} of {lib.max})</h3>
			<ul class="sounds">
				{#each madeList as [name, s] (name)}
					<li>
						<div class="made">
							<button class="sound" class:playing={playingName === `custom:${name}`} onclick={() => playMade(name)}>
								<span class="name">{s.idea}</span>
								<span class="tag made">{s.seconds}s</span>
							</button>
							<button type="button" class="ghost small" onclick={() => forget(name)} aria-label="Delete {s.idea}">Delete</button>
						</div>
						<label class="use">
							<span class="prompt">Play it for</span>
							<select
								value={usedFor(name)[0] || ''}
								onchange={(e) => {
									const kind = e.currentTarget.value;
									for (const k of usedFor(name)) if (k !== kind) assignTo(k, null);
									if (kind) assignTo(kind, name);
								}}
								aria-label="Use {s.idea} for"
							>
								<option value="">Nothing yet</option>
								{#each groups as g (g.name)}
									<optgroup label={g.name}>
										{#each g.sounds as opt (opt.name)}
											<option value={opt.name}>{opt.name}</option>
										{/each}
									</optgroup>
								{/each}
							</select>
						</label>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="card" aria-labelledby="lib-h">
		<h2 id="lib-h">Sound library</h2>
		<p class="note">
			Plays on this phone. {have.size} of {SOUND_LIBRARY.length} recorded; the rest use the built-in taps until they're
			made here (or with <code>npm run sounds:generate</code>).
		</p>
		{#if missing.length}
			<button type="button" class="ghost" disabled={!!making || status !== 'live'} onclick={makeMissing}>
				{anyOld ? `Make ${missing.length} in the new style` : `Make the ${missing.length} missing ${missing.length === 1 ? 'sound' : 'sounds'}`}
			</button>
		{/if}
		{#each groups as g (g.name)}
			<h3>{g.name}</h3>
			<ul class="sounds">
				{#each g.sounds as s (s.name)}
					<li>
						<button class="sound" class:playing={playingName === s.name} onclick={() => audition(s.name)}>
							<span class="name">{s.name}</span>
							<span class="tag" class:made={(have.has(s.name) || lib.assign[s.name]) && !oldStyle(s)}>
								{oldStyle(s) ? 'old style' : lib.assign[s.name] ? 'made here' : have.has(s.name) ? 'recorded' : 'stand-in'}
							</span>
						</button>
						{#if !have.has(s.name) || oldStyle(s)}
							<button type="button" class="ghost small remake" disabled={!!making || status !== 'live'} onclick={() => makeLibrary(s.name)}>
								{making === s.name ? 'Making…' : oldStyle(s) ? 'Remake in the new style' : lib.assign[s.name] ? 'Make another take' : 'Make this sound'}
							</button>
						{/if}
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
	.quiet {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.times {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.times input {
		flex: 1;
		min-width: 0;
	}
	/* desktop Chromium's clock icon crowds the time on a phone-width page */
	.times input::-webkit-calendar-picker-indicator {
		display: none;
	}
	.row.wrap {
		flex-wrap: wrap;
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
	button.ghost {
		background: transparent;
		color: var(--foreground);
		border: 1px solid var(--hairline);
	}
	button.small {
		min-height: 2.25rem;
		padding: 0 var(--space-3);
		align-self: flex-start;
	}
	.key {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.key-actions {
		display: inline-flex;
		gap: var(--space-2);
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
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.chip {
		min-height: 2.25rem;
		padding: 0 var(--space-3);
		background: var(--abyss-1);
		color: var(--foreground);
		border: 1px solid var(--hairline);
		font-weight: 500;
		font-size: var(--text-sm);
	}
	select {
		min-height: 2.75rem;
		max-width: 12rem;
		padding: 0 var(--space-2);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-sm);
		background: var(--abyss-1);
		color: var(--foreground);
		font: inherit;
	}
	.made {
		display: flex;
		gap: var(--space-2);
		align-items: center;
	}
	.made .sound {
		flex: 1;
		min-width: 0;
	}
	.made .name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.use {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		margin-top: var(--space-1, 0.25rem);
	}
	.remake {
		display: block;
		min-height: 2rem;
		margin-top: var(--space-1, 0.25rem);
		font-size: var(--text-xs, 0.75rem);
	}
	code {
		font-family: var(--font-mono, monospace);
		font-size: 0.9em;
	}
</style>
