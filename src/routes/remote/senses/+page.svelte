<!--
	Phone page for the wall's senses: the webcam's microphone and camera.
	Turn each on or off, see what the wall sees right now (how many people,
	how far, which side), teach it distances by standing a metre away, choose
	how it wakes ("hey wall"), and take notes: start and stop them here or by
	voice, watch the lines arrive, and read the saved ones.

	The webcam itself is read by a local process on the display (senses/);
	pictures and sound never leave it. See docs/senses.md.
-->
<script>
	import '../../../app.css';
	import { wallSocketUrl, followPairing } from '$lib/remoteAuth.js';
	import { onMount } from 'svelte';
	import RemoteTabBar from '$lib/components/RemoteTabBar.svelte';
	import { WHISPER_MODELS, WAKE_MODELS, describeDistance } from '$lib/senses.js';

	let ws;
	let retry = 0;
	let poll;
	let status = $state('connecting');
	let s = $state(null);
	let presence = $state(null);
	let listening = $state('idle');
	let message = $state('');
	let failed = $state(false);
	let meters = $state(1);
	let wakeText = $state('');
	let transcripts = $state([]);
	let open = $state(null); // { name, text }
	let liveLines = $state([]);

	const RESULTS = {
		'not-paired': 'Only a paired phone can change this. Pair this phone under Stats → Phones.',
		'camera-off': "The camera isn't on, or the webcam process isn't running on the display.",
		'bad-distance': 'Stand somewhere between 30 cm and 5 m away.',
		'mic-off': 'Turn the microphone on first.',
		'no-face': "It couldn't see a face. Face the wall, in good light, and try again.",
		timeout: "The webcam process didn't answer. Is it running?",
		failed: 'That didn\'t work. Try again.',
		'not-found': 'That file has gone.'
	};

	const MODEL_NOTES = {
		'tiny.en': 'fastest, rougher',
		'base.en': 'a good balance',
		'small.en': 'most accurate, slower',
		tiny: 'any language, fastest',
		base: 'any language',
		small: 'any language, slower'
	};

	function send(msg) {
		if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'senses', ...msg }));
	}

	function take(snapshot) {
		if (!snapshot) return;
		s = snapshot;
		presence = snapshot.presence;
		liveLines = snapshot.notes?.lines || [];
		if (!wakeText) wakeText = snapshot.settings.wakeWords.join(', ');
	}

	function result(r) {
		if (!r) return;
		failed = !r.ok;
		if (!r.ok) message = RESULTS[r.error] || 'Something went wrong.';
		else if (r.op === 'calibrate') message = `Stand ${describeDistance(meters)} from the wall, facing it, for three seconds…`;
		else if (r.op === 'notes-stop') {
			message = r.saved ? 'Saved.' : 'Stopped. Nothing was said.';
			send({ op: 'transcripts' });
		} else message = '';
	}

	function connect() {
		ws = new WebSocket(wallSocketUrl());
		ws.onopen = () => {
			status = 'live';
			retry = 0;
			ws.send(JSON.stringify({ type: 'hello', role: 'remote' }));
			send({ op: 'get' });
			send({ op: 'transcripts' });
		};
		ws.onclose = () => {
			status = 'offline';
			setTimeout(connect, Math.min(8000, 1000 * 2 ** retry++));
		};
		ws.onmessage = (e) => {
			try {
				const msg = JSON.parse(e.data);
				if (followPairing(msg)) return;
				if (msg.type === 'senses-reply') {
					take(msg.senses);
					result(msg.result);
					if (msg.transcripts) transcripts = msg.transcripts;
					if (msg.transcript) open = msg.transcript;
				}
				if (msg.type === 'senses') {
					const wasCalibrating = s?.calibrating;
					take(msg);
					if (wasCalibrating && !msg.calibrating && msg.calibrated) {
						failed = !msg.calibrated.ok;
						message = msg.calibrated.ok ? 'Calibrated. Distances should now be right for you.' : RESULTS[msg.calibrated.error] || 'That didn\'t work.';
					}
				}
				if (msg.type === 'presence') presence = msg;
				if (msg.type === 'listening') listening = msg.state;
				if (msg.type === 'transcript' && msg.line) liveLines = [...liveLines, msg.line].slice(-30);
				if (msg.type === 'transcript' && !msg.on) send({ op: 'transcripts' });
			} catch {
				/* ignore */
			}
		};
	}

	function patch(p) {
		send({ op: 'set', patch: p });
	}

	function saveWake(e) {
		e?.preventDefault();
		patch({ wakeWords: wakeText });
	}

	function calibrate() {
		failed = false;
		send({ op: 'calibrate', meters: Number(meters) });
	}

	function notes(on) {
		failed = false;
		message = '';
		if (on) liveLines = [];
		send({ op: on ? 'notes-start' : 'notes-stop' });
	}

	function readTranscript(name) {
		if (open?.name === name) return (open = null);
		send({ op: 'transcript', name });
	}

	function copy(text) {
		navigator.clipboard?.writeText(text).then(
			() => (message = 'Copied.'),
			() => (message = "Couldn't copy; select the text instead.")
		);
	}

	onMount(() => {
		connect();
		// the level meter and the readout move; ask for them while the page is open
		poll = setInterval(() => document.visibilityState === 'visible' && send({ op: 'get' }), 1500);
		return () => {
			clearInterval(poll);
			if (ws) {
				ws.onclose = null;
				ws.close();
			}
		};
	});

	let side = $derived(presence?.x == null ? '' : presence.x < -0.25 ? 'on the left' : presence.x > 0.25 ? 'on the right' : 'in the middle');
	let level = $derived(Math.min(100, Math.round(Math.sqrt(s?.mic?.level || 0) * 260)));
	let hearing = $derived(s?.mic?.state && s.mic.state !== 'idle' ? s.mic.state : listening);
	let fileName = (n) => n.replace(/\.txt$/, '').replace(/T(\d\d)-(\d\d).*/, ' $1:$2');
</script>

<svelte:head>
	<title>Senses</title>
</svelte:head>

<div class="remote" role="region" aria-label="Microphone and camera">
	<header class="bar">
		<h1>Senses</h1>
		<span class="status" class:live={status === 'live'}>{status === 'live' ? 'Connected' : status === 'offline' ? 'Offline' : 'Connecting'}</span>
	</header>

	{#if !s}
		<p class="note">Reading the display…</p>
	{:else}
		{#if !s.online}
			<section class="card">
				<h2>Webcam process not running</h2>
				<p class="note">
					The wall reads the webcam with a small program on the display. Install it once with
					<code>scripts/senses/install.sh</code> on the display (see docs/senses.md). Settings here are kept until it starts.
				</p>
			</section>
		{/if}

		<section class="card" aria-labelledby="mic-h">
			<h2 id="mic-h">Microphone</h2>
			<label class="row">
				<span>Listen for "{s.settings.wakeMode === 'phrase' ? s.settings.wakeWords[0] : s.settings.wakeModel.replace('_', ' ')}"</span>
				<input type="checkbox" checked={s.settings.mic} onchange={(e) => patch({ mic: e.currentTarget.checked })} />
			</label>
			{#if s.settings.mic && s.online}
				<div class="meter" aria-label="Microphone level"><span style:width="{level}%"></span></div>
				<p class="note">
					{#if s.mic?.error === 'no-whisper'}
						Whisper isn't installed on the display. Run the install script again.
					{:else if s.mic?.error === 'no-model'}
						Whisper {s.settings.model} isn't on the display yet. Fetch it there with
						<code>scripts/senses/install.sh --models {s.settings.model}</code>.
					{:else if s.mic?.error === 'no-parec'}
						PipeWire's <code>parec</code> is missing on the display.
					{:else if !s.mic?.ok}
						Starting…
					{:else if hearing === 'thinking'}
						Working out what you said…
					{:else if hearing === 'listening'}
						Listening for what you want…
					{:else}
						Hearing through {s.mic.device?.replace(/^alsa_input\./, '') || 'the default microphone'}.
					{/if}
				</p>
			{/if}
			<p class="note">
				Say "{s.settings.wakeWords[0]}" and then anything you'd tell the wall by Siri: "{s.settings.wakeWords[0]}, set a timer for ten
				minutes", "… what's the weather", "… pause the music". The answer is spoken. Nothing is recorded; only the words reach the wall.
			</p>
			<label class="row">
				<span>Show what it heard</span>
				<input type="checkbox" checked={s.settings.captions} onchange={(e) => patch({ captions: e.currentTarget.checked })} />
			</label>
		</section>

		<section class="card" aria-labelledby="notes-h">
			<h2 id="notes-h">Notes</h2>
			<p class="note">
				While notes are on, everything said near the wall is written down, and a red mark shows on the wall. Say "{s.settings.wakeWords[0]},
				take notes" and "… stop taking notes", or use the button. They stop by themselves after {s.settings.notesMinutes} quiet minutes.
			</p>
			{#if s.notes.on}
				<button type="button" class="stop" onclick={() => notes(false)}>Stop and save</button>
			{:else}
				<button type="button" onclick={() => notes(true)} disabled={!s.settings.mic || status !== 'live'}>Start taking notes</button>
			{/if}
			{#if s.notes.on || liveLines.length}
				<ol class="lines" aria-live="polite">
					{#each liveLines as line (line.id)}
						<li>{line.text}</li>
					{:else}
						<li class="note">Listening…</li>
					{/each}
				</ol>
			{/if}
			{#if transcripts.length}
				<h3>Saved</h3>
				<ul class="files">
					{#each transcripts as name (name)}
						<li>
							<button type="button" class="ghost file" onclick={() => readTranscript(name)} aria-expanded={open?.name === name}>{fileName(name)}</button>
							{#if open?.name === name}
								<pre class="transcript">{open.text}</pre>
								<button type="button" class="ghost small" onclick={() => copy(open.text)}>Copy</button>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="card" aria-labelledby="cam-h">
			<h2 id="cam-h">Camera</h2>
			<label class="row">
				<span>See who's at the wall</span>
				<input type="checkbox" checked={s.settings.camera} onchange={(e) => patch({ camera: e.currentTarget.checked })} />
			</label>
			{#if s.settings.camera && s.online}
				<p class="readout" aria-live="polite">
					{#if !presence?.camera}
						Starting…
					{:else if !presence.count}
						Nobody in view{presence.motion > 0.02 ? ' (something moved)' : ''}
					{:else}
						{presence.count === 1 ? 'One person' : `${presence.count} people`}, {describeDistance(presence.distance)} away, {side}
					{/if}
				</p>
			{/if}
			<p class="note">
				It finds faces, not who they are, a few times a second, and keeps no pictures: the wall only gets how many, how far, and which side.
			</p>
			<label class="level">
				<span>At the wall</span>
				<input
					type="range"
					min="0.5"
					max="4"
					step="0.1"
					value={s.settings.nearMeters}
					onchange={(e) => patch({ nearMeters: Number(e.currentTarget.value) })}
					aria-label="Closer than this counts as at the wall"
				/>
				<span class="pct">{describeDistance(s.settings.nearMeters)}</span>
			</label>
			<label class="row">
				<span>Turn the screen on when someone walks up</span>
				<input type="checkbox" checked={s.settings.wakePanel} onchange={(e) => patch({ wakePanel: e.currentTarget.checked })} />
			</label>

			<h3>Distance</h3>
			<p class="note">
				{s.settings.focalPx
					? 'Calibrated to your face.'
					: 'Guessed from a typical webcam. For true distances, stand a measured distance away, face the wall, and tap Measure.'}
			</p>
			<div class="say">
				<select bind:value={meters} aria-label="How far away you are standing">
					<option value={0.5}>50 cm away</option>
					<option value={1}>1 m away</option>
					<option value={1.5}>1.5 m away</option>
					<option value={2}>2 m away</option>
				</select>
				<button type="button" onclick={calibrate} disabled={!s.settings.camera || !s.online || s.calibrating}>{s.calibrating ? 'Measuring…' : 'Measure'}</button>
			</div>
			{#if s.settings.focalPx}
				<button type="button" class="ghost small" onclick={() => patch({ focalPx: null })}>Forget calibration</button>
			{/if}
		</section>

		{#if message}<p class="note" class:warn={failed} role="status">{message}</p>{/if}

		<section class="card" aria-labelledby="wake-h">
			<h2 id="wake-h">Waking it</h2>
			<label class="row">
				<span>How</span>
				<select value={s.settings.wakeMode} onchange={(e) => patch({ wakeMode: e.currentTarget.value })}>
					<option value="phrase">A phrase</option>
					<option value="openwakeword">A wake word</option>
				</select>
			</label>
			{#if s.settings.wakeMode === 'phrase'}
				<form class="say" onsubmit={saveWake}>
					<input bind:value={wakeText} aria-label="Wake phrases, separated by commas" autocapitalize="off" />
					<button type="submit" disabled={status !== 'live'}>Save</button>
				</form>
				<p class="note">Phrases, separated by commas. Two words work best ("hey wall"); one common word wakes it by accident.</p>
			{:else}
				<label class="row">
					<span>Wake word</span>
					<select value={s.settings.wakeModel} onchange={(e) => patch({ wakeModel: e.currentTarget.value })}>
						{#each WAKE_MODELS as m (m)}<option value={m}>{m.replace('_', ' ')}</option>{/each}
					</select>
				</label>
				<p class="note">
					A small always-on model hears the wake word and Whisper starts after it. Better while music plays. Needs openWakeWord on the display
					(the install script's <code>--wake-word</code>).
				</p>
			{/if}
			<label class="row">
				<span>Whisper</span>
				<select value={s.settings.model} onchange={(e) => patch({ model: e.currentTarget.value })}>
					{#each WHISPER_MODELS as m (m)}<option value={m}>{m}</option>{/each}
				</select>
			</label>
			<p class="note">Whisper {s.settings.model}: {MODEL_NOTES[s.settings.model]}. Others need fetching on the display first (<code>install.sh --models</code>).</p>
		</section>
	{/if}
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
		flex: none;
		width: 1.5rem;
		height: 1.5rem;
		accent-color: var(--brand);
	}
	.level {
		display: grid;
		grid-template-columns: 6rem minmax(0, 1fr) 3.5rem;
		white-space: nowrap;
		align-items: center;
		gap: var(--space-2);
		min-height: 2.75rem;
	}
	.level input[type='range'] {
		width: 100%;
		accent-color: var(--brand);
	}
	.level .pct {
		text-align: right;
		font-variant-numeric: tabular-nums;
		color: var(--text-tertiary);
		font-size: var(--text-sm);
	}
	.say {
		display: flex;
		gap: var(--space-2);
	}
	.say input,
	select {
		min-height: 2.75rem;
		padding: 0 var(--space-2);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-sm);
		background: var(--abyss-1);
		color: var(--foreground);
		font: inherit;
	}
	.say input,
	.say select {
		flex: 1;
		min-width: 0;
	}
	.row select {
		max-width: 12rem;
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
	button.stop {
		background: var(--error, #ff5a4e);
	}
	button.ghost {
		background: transparent;
		color: var(--foreground);
		border: 1px solid var(--hairline);
	}
	button.small {
		min-height: 2.25rem;
		align-self: flex-start;
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
	code {
		font-size: 0.9em;
	}
	.readout {
		margin: 0;
		font-size: var(--text-lg);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
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
		transition: width 0.3s;
	}
	.lines {
		margin: 0;
		padding: var(--space-2) var(--space-3);
		max-height: 14rem;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		border-radius: var(--radius-sm);
		background: var(--abyss-1);
		list-style: none;
		font-size: var(--text-sm);
		line-height: 1.4;
	}
	.files {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.file {
		width: 100%;
		text-align: left;
		font-weight: 500;
	}
	.transcript {
		margin: var(--space-2) 0;
		padding: var(--space-2);
		max-height: 18rem;
		overflow: auto;
		white-space: pre-wrap;
		border-radius: var(--radius-sm);
		background: var(--abyss-1);
		font: inherit;
		font-size: var(--text-sm);
	}
</style>
