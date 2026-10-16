<!--
	Phone page for the wall's senses: the webcam's microphone and camera.
	Turn each on or off, see what the wall sees right now (a diagram of the
	outlines it finds, which spot you're in, lying or upright, how far), teach
	it the room (remember spots like "bed" and "desk"; map the floor from a
	sheet of printer paper), turn the microphone up for distance, choose
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
	import { WAKE_MODELS, AWAY_CHOICES, EXIT_SIDES, EXIT_SECONDS, describeDistance } from '$lib/senses.js';
	import { KIOSK_VIEWS, kioskViewLabel } from '$lib/kioskViews.js';

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
	let reports = $state([]);
	let openReport = $state(null); // { name, text }
	let wrongNote = $state('');
	let open = $state(null); // { name, text }
	let liveLines = $state([]);
	let spotName = $state('');
	let paperSize = $state('letter');
	let wallMeters = $state('');

	const RESULTS = {
		'not-paired': 'Only a paired phone can change this. Pair this phone under Home → Phones.',
		'camera-off': "The camera isn't on, or the webcam process isn't running on the display.",
		'bad-distance': 'Stand somewhere between 30 cm and 5 m away.',
		'mic-off': 'Turn the microphone on first.',
		'no-face': "It couldn't see a face. Face the wall, in good light, and try again.",
		'no-person': "It couldn't see you. Make sure you're in the picture (check the diagram) and try again.",
		'no-paper': "It couldn't find the paper. Lay it flat in the open, away from other white things, with the lights on, and try again.",
		'no-name': 'Give the spot a name first, like "bed" or "desk".',
		'too-many-zones': 'That is the most spots it keeps. Forget one first.',
		timeout: "The webcam process didn't answer. Is it running?",
		failed: 'That didn\'t work. Try again.',
		'not-found': 'That file has gone.'
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
		else if (r.op === 'remember') message = 'Stay just as you are for three seconds…';
		else if (r.op === 'report') message = 'Collecting the last 30 seconds…';
		else if (r.op === 'find-paper') message = 'Looking for the paper. Keep out of its way for three seconds…';
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
			send({ op: 'reports' });
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
					if (msg.reports) reports = msg.reports;
					if (msg.report) openReport = msg.report;
				}
				if (msg.type === 'senses') {
					const wasCalibrating = s?.calibrating;
					const wasReporting = s?.reporting;
					take(msg);
					if (wasReporting && !msg.reporting && msg.reported) {
						failed = !msg.reported.ok;
						message = !msg.reported.ok
							? "Couldn't save the report."
							: msg.reported.error
								? "Saved, but the webcam process didn't answer: only the wall's side is in it."
								: 'Saved: the last 30 seconds of what it saw and heard, in numbers and words.';
						wrongNote = '';
						send({ op: 'reports' });
					}
					if (wasCalibrating && !msg.calibrating && msg.calibrated) {
						failed = !msg.calibrated.ok;
						const c = msg.calibrated;
						message = !c.ok
							? RESULTS[c.error] || "That didn't work."
							: c.kind === 'zone'
								? `Remembered "${c.name}".`
								: c.kind === 'paper'
									? msg.settings.paperWall != null
										? 'Floor mapped. Distances are now in metres from the wall.'
										: 'Floor mapped. Add how far the paper was from the wall to get metres from the wall.'
									: 'Calibrated. Distances should now be right for you.';
						if (c.ok && c.kind === 'zone') spotName = '';
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

	/** One spot's rule: the page it shows when you settle there, and whether lying there at night turns the screen off. */
	function setPlace(name, change) {
		const places = { ...(s.settings.places || {}) };
		places[name] = { view: '', lieOff: false, ...places[name], ...change };
		patch({ places });
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

	function remember(e) {
		e?.preventDefault();
		failed = false;
		send({ op: 'remember', name: spotName.trim() });
	}

	function findPaper() {
		failed = false;
		send({ op: 'find-paper', paper: paperSize, wallMeters: wallMeters === '' ? null : Number(wallMeters) });
	}

	function notes(on) {
		failed = false;
		message = '';
		if (on) liveLines = [];
		send({ op: on ? 'notes-start' : 'notes-stop' });
	}

	function reportWrong(e) {
		e?.preventDefault();
		send({ op: 'report', note: wrongNote });
	}

	function readReport(name) {
		if (openReport?.name === name) return (openReport = null);
		send({ op: 'report-read', name });
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

	let body = $derived(s?.settings?.look !== 'face');
	let boxes = $derived(s?.camera?.boxes || []);
	let quad = $derived(s?.settings?.floorQuad ? s.settings.floorQuad.map(([x, y]) => `${x * 160},${y * 90}`).join(' ') : '');
	let side = $derived(presence?.x == null ? '' : presence.x < -0.25 ? 'on the left' : presence.x > 0.25 ? 'on the right' : 'in the middle');
	let level = $derived(Math.min(100, Math.round(Math.sqrt(s?.mic?.level || 0) * 260)));
	let hearing = $derived(s?.mic?.state && s.mic.state !== 'idle' ? s.mic.state : listening);
	let fileName = (n) => n.replace(/^report-/, '').replace(/\.(txt|json)$/, '').replace(/T(\d\d)-(\d\d).*/, ' $1:$2');
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

		<section class="card" aria-labelledby="privacy-h">
			<h2 id="privacy-h">Privacy</h2>
			<label class="row">
				<span>Guest mode</span>
				<input type="checkbox" checked={s.settings.guest} onchange={(e) => patch({ guest: e.currentTarget.checked })} />
			</label>
			<p class="note">
				For when you have company. Calendar titles on the wall read "Busy", agents are hidden, approval cards don't show the
				command, and what the microphone heard isn't captioned. It stays on until you turn it off here; nothing turns it on by
				itself.
			</p>
			<p class="note">
				Whenever the camera or microphone is on, the wall shows a small sign in its top-right corner so anyone in the room can see.
				It never moves, and it turns amber if either one has stopped answering.
			</p>
		</section>

		<section class="card" aria-labelledby="mic-h">
			<h2 id="mic-h">Microphone</h2>
			<label class="row">
				<span>Listen for "{s.settings.wakeMode === 'phrase' ? s.settings.wakeWords[0] : s.settings.wakeModel.replace('_', ' ')}"</span>
				<input type="checkbox" checked={s.settings.mic} onchange={(e) => patch({ mic: e.currentTarget.checked })} />
			</label>
			{#if s.settings.mic && s.online}
				<div class="meter" aria-label="Microphone level"><span style:width="{level}%"></span></div>
				<p class="note">
					{#if s.mic?.error === 'no-sherpa'}
						The speech recogniser isn't installed on the display. Run <code>scripts/senses/install.sh</code> there again.
					{:else if s.mic?.error === 'no-model'}
						The Parakeet speech model isn't on the display yet. Fetch it there with <code>scripts/senses/install.sh</code>.
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
			<label class="level">
				<span>Turn up</span>
				<input
					type="range"
					min="1"
					max="10"
					step="0.5"
					value={s.settings.micGain}
					onchange={(e) => patch({ micGain: Number(e.currentTarget.value) })}
					aria-label="How much the microphone is turned up"
				/>
				<span class="pct">{s.settings.micGain}×</span>
			</label>
			<p class="note">
				For a webcam across the room, turn it up until the meter moves well when you talk at normal volume from where you usually are. Every
				phrase is also levelled before it's read, so a quiet voice comes through as clearly as a close one.
			</p>
			<label class="row">
				<span>Hear me from</span>
				<select value={s.settings.hearFrom} onchange={(e) => patch({ hearFrom: e.currentTarget.value })}>
					<option value="room">Across the room</option>
					<option value="near">Close by</option>
				</select>
			</label>
			<label class="row">
				<span>Noise suppression</span>
				<select value={s.settings.noiseSuppress} onchange={(e) => patch({ noiseSuppress: e.currentTarget.value })}>
					<option value="off">Off</option>
					<option value="light">Light</option>
					<option value="strong">Strong</option>
				</select>
			</label>
			<label class="row">
				<span>Voice boost</span>
				<input type="checkbox" checked={s.settings.voiceBoost} onchange={(e) => patch({ voiceBoost: e.currentTarget.checked })} />
			</label>
			<p class="note">
				Noise suppression learns the room's steady sounds (a fan, a hum, hiss) while nobody talks and takes them out of what it hears. Voice
				boost cuts low rumble and brings the speech band forward.
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
				<span>See who's in the room</span>
				<input type="checkbox" checked={s.settings.camera} onchange={(e) => patch({ camera: e.currentTarget.checked })} />
			</label>
			<label class="row">
				<span>Look for</span>
				<select value={s.settings.look} onchange={(e) => patch({ look: e.currentTarget.value })}>
					<option value="body">Whole people</option>
					<option value="face">Faces</option>
				</select>
			</label>
			<p class="note">
				{body
					? 'For a camera up high that sees the room: finds people in any pose, lying down or with their back turned.'
					: 'For a camera at face height that you look at.'}
				It never knows who anyone is, and keeps no pictures: the wall only gets numbers.
			</p>
			{#if s.settings.camera && s.online}
				<p class="readout" aria-live="polite">
					{#if !presence?.camera}
						Starting…
					{:else if !presence.count}
						Nobody in view{presence.motion > 0.02 ? ' (something moved)' : ''}
					{:else}
						{presence.count === 1 ? 'One person' : `${presence.count} people`}{presence.zone ? `, at the ${presence.zone}` : ''}{presence.posture === 'lying'
							? ', lying down'
							: ''}{presence.distance != null ? `, ${describeDistance(presence.distance)} away` : ''}{!body || !presence.zone ? `, ${side}` : ''}
					{/if}
				</p>
				<figure class="diagram">
					<svg viewBox="0 0 160 90" role="img" aria-label="What the camera finds: an outline for each person{quad ? ' and the paper' : ''}">
						<rect x="0.5" y="0.5" width="159" height="89" rx="3" class="frame"></rect>
						{#if quad}<polygon points={quad} class="paper"></polygon>{/if}
						{#each boxes as b, i (i)}
							<rect x={b[0] * 160} y={b[1] * 90} width={b[2] * 160} height={b[3] * 90} rx="1.5" class="person"></rect>
						{/each}
					</svg>
					<figcaption class="note">What the camera finds, drawn as outlines. Not a picture: no picture ever leaves the display.</figcaption>
				</figure>
			{/if}

			{#if body}
				<h3>Spots in the room</h3>
				<p class="note">
					Go to a spot the way you usually are there (lying in bed, sitting at the desk), name it, and tap Remember. It learns where you are in the
					picture there, so it can say "at the desk" even with your back turned.
				</p>
				{#if s.settings.zones.length}
					<ul class="files">
						{#each s.settings.zones as z (z.name)}
							<li class="spot">
								<div class="row">
									<span>{z.name}{presence?.zone === z.name ? ' · you are here' : ''}</span>
									<button type="button" class="ghost small" onclick={() => send({ op: 'forget-zone', name: z.name })}>Forget</button>
								</div>
								<label class="row">
									<span>Settle here to show</span>
									<select value={s.settings.places?.[z.name]?.view || ''} onchange={(e) => setPlace(z.name, { view: e.currentTarget.value })}>
										<option value="">Nothing (stay put)</option>
										{#each KIOSK_VIEWS as v (v)}
											<option value={v}>{kioskViewLabel(v)}</option>
										{/each}
									</select>
								</label>
								<label class="row">
									<span>Lying here at night turns the screen off</span>
									<input type="checkbox" checked={s.settings.places?.[z.name]?.lieOff || false} onchange={(e) => setPlace(z.name, { lieOff: e.currentTarget.checked })} />
								</label>
							</li>
						{/each}
					</ul>
				{/if}
				{#if s.settings.zones.length}
					<p class="note">
						A spot's page comes up after you've been there about ten seconds, and not for two minutes after you pick a page yourself. Lying
						down in a "screen off" spot during quiet hours turns the screen off after a minute; getting up is the morning wake.
					</p>
				{/if}
				<form class="say" onsubmit={remember}>
					<input bind:value={spotName} placeholder="bed, desk, door…" aria-label="Name of this spot" maxlength="24" />
					<button type="submit" disabled={!spotName.trim() || !s.settings.camera || !s.online || s.calibrating}>{s.calibrating ? 'Hold still…' : 'Remember'}</button>
				</form>

				<h3>Distance, from a sheet of paper</h3>
				<p class="note">
					Lay one sheet of printer paper flat on the floor where the camera can see it, in the open, long edge toward the camera. Measure how far
					its near edge is from the wall under the camera, then tap Find the paper and keep out of the way for three seconds. You can pick it up
					afterwards.
				</p>
				<div class="say">
					<select bind:value={paperSize} aria-label="Paper size">
						<option value="letter">Letter</option>
						<option value="a4">A4</option>
					</select>
					<input type="number" min="0" max="10" step="0.05" bind:value={wallMeters} placeholder="metres from wall" aria-label="How far the paper's near edge is from the wall, in metres" />
				</div>
				<button type="button" onclick={findPaper} disabled={!s.settings.camera || !s.online || s.calibrating}>{s.calibrating ? 'Looking…' : 'Find the paper'}</button>
				{#if s.settings.floorMap}
					<p class="note">
						Floor mapped{s.settings.paperWall != null ? `, ${describeDistance(s.settings.paperWall)} from the wall` : ' (no wall distance yet: positions only)'}.
					</p>
					<button type="button" class="ghost small" onclick={() => patch({ floorMap: null })}>Forget the floor</button>
				{/if}
			{/if}

			<label class="level">
				<span>Near</span>
				<input
					type="range"
					min="0.5"
					max="4"
					step="0.1"
					value={s.settings.nearMeters}
					onchange={(e) => patch({ nearMeters: Number(e.currentTarget.value) })}
					aria-label="Closer than this counts as near the wall"
				/>
				<span class="pct">{describeDistance(s.settings.nearMeters)}</span>
			</label>
			<label class="row">
				<span>{body && !s.settings.floorMap ? 'Turn the screen on when someone comes in' : 'Turn the screen on when someone comes near'}</span>
				<input type="checkbox" checked={s.settings.wakePanel} onchange={(e) => patch({ wakePanel: e.currentTarget.checked })} />
			</label>
			<label class="row">
				<span>Nobody in the room: screen off after</span>
				<select value={String(s.settings.awayMinutes || 0)} onchange={(e) => patch({ awayMinutes: Number(e.currentTarget.value) })}>
					{#each AWAY_CHOICES as m (m)}
						<option value={String(m)}>{m ? `${m} min` : 'Never'}</option>
					{/each}
				</select>
			</label>
			<label class="row">
				<span>Walk out of the picture on the</span>
				<select value={s.settings.exitSide || 'off'} onchange={(e) => patch({ exitSide: e.currentTarget.value })}>
					{#each EXIT_SIDES as side (side)}
						<option value={side}>{{ off: 'Off', left: 'Left side', right: 'Right side', either: 'Either side' }[side]}</option>
					{/each}
				</select>
			</label>
			{#if s.settings.exitSide && s.settings.exitSide !== 'off'}
				<label class="row">
					<span>…and the screen goes off after</span>
					<select value={String(s.settings.exitSeconds || 20)} onchange={(e) => patch({ exitSeconds: Number(e.currentTarget.value) })}>
						{#each EXIT_SECONDS as sec (sec)}
							<option value={String(sec)}>{sec < 60 ? `${sec} s` : `${sec / 60} min`}</option>
						{/each}
					</select>
				</label>
				<p class="note">Left and right as you face the wall. Pick the side the door is on. If the camera just loses you in the middle of the room, it waits for the timer above instead.</p>
			{/if}
			<label class="row">
				<span>Screen back on when you come back</span>
				<input type="checkbox" checked={s.settings.wakeOnReturn !== false} onchange={(e) => patch({ wakeOnReturn: e.currentTarget.checked })} />
			</label>

			{#if !body}
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
			{/if}
		</section>

		{#if message}<p class="note" class:warn={failed} role="status">{message}</p>{/if}

		<section class="card" aria-labelledby="wrong-h">
			<h2 id="wrong-h">That was wrong</h2>
			<p class="note">
				Did it miss you, see you in the wrong spot, mishear you, or turn the screen off at the wrong time? Tap this right away. It keeps the last 30
				seconds of what it decided (counts, spots, distances, the words it heard; never a picture or a sound) so the cause can be found.
			</p>
			<form class="say" onsubmit={reportWrong}>
				<input bind:value={wrongNote} placeholder="what went wrong (optional)" aria-label="What went wrong" maxlength="300" />
				<button type="submit" disabled={status !== 'live' || s.reporting}>{s.reporting ? 'Saving…' : 'That was wrong'}</button>
			</form>
			{#if reports.length}
				<h3>Reports</h3>
				<ul class="files">
					{#each reports as name (name)}
						<li>
							<button type="button" class="ghost file" onclick={() => readReport(name)} aria-expanded={openReport?.name === name}>{fileName(name)}</button>
							{#if openReport?.name === name}
								<pre class="transcript">{openReport.text}</pre>
								<button type="button" class="ghost small" onclick={() => copy(openReport.text)}>Copy</button>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>

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
					A small always-on model hears the wake word and the transcriber starts after it. Better while music plays. Needs openWakeWord on the display
					(the install script's <code>--wake-word</code>).
				</p>
			{/if}
			<p class="note">Speech is turned into words on the display by NVIDIA's Parakeet (English), in under half a second. Nothing leaves it.</p>
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
	.spot {
		display: flex;
		flex-direction: column;
		padding-bottom: var(--space-2);
		border-bottom: 1px solid var(--hairline);
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
	.diagram {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.diagram svg {
		width: 100%;
		height: auto;
		display: block;
	}
	.diagram .frame {
		fill: var(--abyss-1);
		stroke: var(--hairline);
		stroke-width: 1;
	}
	.diagram .person {
		fill: none;
		stroke: var(--brand);
		stroke-width: 1.2;
	}
	.diagram .paper {
		fill: var(--foreground);
		opacity: 0.5;
	}
	.say input[type='number'] {
		min-height: 2.75rem;
		padding: 0 var(--space-2);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-sm);
		background: var(--abyss-1);
		color: var(--foreground);
		font: inherit;
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
