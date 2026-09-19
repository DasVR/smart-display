<!--
	Phone lyrics desk: which file is on screen, word clocks, and a switch
	for community vs Qwen without dumping the kiosk remote.
-->
<script>
	import '../../../app.css';
	import { onMount } from 'svelte';

	let data = $state(null);
	let status = $state('reading');
	let error = $state('');
	let busy = $state('');
	let openSource = $state('');
	const demo = typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo');
	const lyricsUrl = demo ? '/api/lyrics?demo=1' : '/api/lyrics';

	function clock(sec) {
		const t = Math.max(0, Number(sec) || 0);
		const m = Math.floor(t / 60);
		const s = Math.floor(t % 60);
		const frac = Math.floor((t % 1) * 10);
		return `${m}:${String(s).padStart(2, '0')}.${frac}`;
	}

	function engineHint(engine) {
		if (!engine?.engine) return 'no aligner';
		const bits = [engine.engine];
		if (engine.device) bits.push(engine.device);
		if (engine.whisperModel) bits.push(engine.whisperModel);
		if (engine.alignModel) bits.push(String(engine.alignModel).split('/').pop());
		if (engine.separate) bits.push('vocals');
		if (engine.precise) bits.push('frame-accurate');
		const list = Array.isArray(engine.available) ? engine.available.join(', ') : engine.engine;
		return `${bits.join(' · ')} · ${list}`;
	}

	async function refresh(signal) {
		try {
			const r = await fetch(lyricsUrl, { signal });
			if (!r.ok) throw new Error(`lyrics ${r.status}`);
			data = await r.json();
			status = data.track ? 'live' : 'idle';
			error = '';
			if (!openSource && data.displaySource) openSource = data.displaySource;
		} catch (e) {
			if (e?.name === 'AbortError') return;
			status = 'error';
			error = e.message || 'could not reach the kiosk';
		}
	}

	async function act(action, source) {
		busy = `${action}:${source || ''}`;
		try {
			const r = await fetch(lyricsUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action, source, demo })
			});
			const next = await r.json();
			if (!r.ok || next.ok === false) throw new Error(next.error || `lyrics ${r.status}`);
			data = next;
			status = next.track ? 'live' : 'idle';
			if (source) openSource = source;
		} catch (e) {
			error = e.message || 'action failed';
		} finally {
			busy = '';
		}
	}

	onMount(() => {
		const ac = new AbortController();
		refresh(ac.signal);
		const tick = setInterval(() => refresh(ac.signal), 2500);
		return () => {
			ac.abort();
			clearInterval(tick);
		};
	});
</script>

<svelte:head>
	<title>Lyrics desk</title>
	<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
	<meta name="theme-color" content="#07070b">
	<meta name="apple-mobile-web-app-capable" content="yes">
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
	<meta name="apple-mobile-web-app-title" content="Lyrics">
	<link rel="manifest" href="/manifest.webmanifest">
</svelte:head>

<div class="remote" role="region" aria-label="Lyrics desk">
	<header class="bar">
		<a class="back" href="/remote">Remote</a>
		<div class="status" class:connected={status === 'live'} class:error={status === 'error'}>
			<span class="dot"></span>
			<span>{status}</span>
		</div>
	</header>

	{#if error && !data}
		<p class="note">{error}</p>
	{:else if !data}
		<p class="note">Reading the box</p>
	{:else if !data.track}
		<p class="note">Nothing playing. Start a song on the kiosk, then pick a provider here.</p>
	{:else}
		<section class="card" aria-label="Now playing">
			<p class="kicker">On screen</p>
			<p class="name">{data.track.title}</p>
			<p class="meta">{data.track.artist}{#if data.track.album} · {data.track.album}{/if}</p>
			<p class="meta">
				{clock(data.track.position)} / {clock(data.track.duration)}
				· showing {data.displaySource || 'nothing'}
			</p>
			<p class="hint" class:ok={data.engine?.precise} class:warn={data.inFlight}>
				{engineHint(data.engine)}{#if data.inFlight} · aligning{/if}
			</p>
			{#if data.canonical}
				<p class="hint">
					Aligner text: {data.canonical.label}
					· {data.canonical.lineCount} lines
				</p>
			{/if}
			{#if data.providers.some((p) => p.collapsed && p.id !== data.displaySource)}
				<p class="hint warn">Qwen clocks collapsed. Community is on screen until you pin the aligner.</p>
			{/if}
			{#if data.pick?.pinned}
				<p class="hint">Pinned main: {data.pick.displaySource}</p>
			{/if}
			{#if data.pick?.cacheSource}
				<p class="hint">Cached: {data.pick.cacheSource}</p>
			{/if}
			<div class="actions">
				<button type="button" class="ghost" disabled={Boolean(busy)} onclick={() => act('realign')}>
					Realign
				</button>
				{#if data.pick}
					<button type="button" class="ghost" disabled={Boolean(busy)} onclick={() => act('unpin')}>
						Clear pick
					</button>
				{/if}
			</div>
		</section>

		{#each data.providers as provider (provider.id)}
			<section class="card" class:active={provider.id === data.displaySource} aria-label={provider.label}>
				<p class="kicker">{provider.kind === 'align' ? 'Aligner' : 'Community'}</p>
				<p class="name">{provider.label}</p>
				<p class="meta">
					{provider.lineCount} lines
					{#if provider.wordLevel} · word clocks{/if}
					{#if provider.precise} · precise{/if}
					{#if provider.collapsed} · clocks collapsed{/if}
					{#if provider.id === data.displaySource} · showing{/if}
					{#if data.pick?.pinned && data.pick.displaySource === provider.id} · main{/if}
					{#if data.pick?.cacheSource === provider.id} · cache{/if}
				</p>
				{#if provider.collapsed}
					<p class="hint warn">Whole lines share a handful of timestamps, so karaoke stacks and clips. Keep community as main unless you want this anyway.</p>
				{/if}
				<div class="actions">
					<button
						type="button"
						disabled={Boolean(busy) || provider.id === data.displaySource}
						onclick={() => act('display', provider.id)}
					>
						Show
					</button>
					<button
						type="button"
						class="ghost"
						disabled={Boolean(busy)}
						onclick={() => act('pin', provider.id)}
					>
						Keep as main
					</button>
					<button
						type="button"
						class="ghost"
						disabled={Boolean(busy)}
						onclick={() => act('cache', provider.id)}
					>
						Save to cache
					</button>
					<button
						type="button"
						class="ghost"
						onclick={() => (openSource = openSource === provider.id ? '' : provider.id)}
					>
						{openSource === provider.id ? 'Hide times' : 'Times'}
					</button>
				</div>
				{#if openSource === provider.id}
					<ol class="times">
						{#each provider.lines as line, i (`${line.time}:${i}`)}
							<li>
								<span class="t">{clock(line.time)}</span>
								<span class="lyric">
									{line.text}
									{#if line.words?.length}
										<span class="words">
											{#each line.words as word, wi (`${word.time}:${wi}`)}
												<span>{clock(word.time)} {word.text}</span>
											{/each}
										</span>
									{/if}
								</span>
							</li>
						{/each}
					</ol>
				{/if}
			</section>
		{/each}

		{#if !data.providers.length}
			<p class="note">No lyric files for this track yet. Play from the start to let Qwen align, or wait for the community lookup.</p>
		{/if}

		{#if error}
			<p class="note">{error}</p>
		{/if}
	{/if}
</div>

<style>
	:global(html, body) {
		margin: 0;
		padding: 0;
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
		padding: var(--space-4) var(--space-5) max(var(--space-6), env(safe-area-inset-bottom));
		box-sizing: border-box;
	}
	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.back,
	.status {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2.75rem;
		margin: 0;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-tertiary);
		text-decoration: none;
	}
	.back:hover { color: var(--foreground); }
	.status.connected { color: var(--ok); }
	.status.error { color: var(--warn); }
	.dot {
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: var(--text-tertiary);
		flex: 0 0 auto;
	}
	.status.connected .dot { background: var(--ok); }
	.status.error .dot { background: var(--warn); }
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--foreground) 4%, transparent);
	}
	.card.active {
		border-color: color-mix(in srgb, var(--brand) 45%, var(--hairline));
	}
	.kicker {
		margin: 0;
		font-size: 0.68rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--text-tertiary);
	}
	.name {
		margin: 0;
		font-size: 1.15rem;
		font-weight: 650;
		letter-spacing: -0.03em;
	}
	.meta,
	.hint,
	.note {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
		overflow-wrap: anywhere;
	}
	.hint.ok { color: var(--ok); }
	.hint.warn { color: var(--warn); }
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.2rem;
	}
	button {
		min-height: 2.4rem;
		padding: 0 0.8rem;
		border-radius: 999px;
		border: 1px solid var(--hairline);
		background: var(--accent-soft);
		color: var(--foreground);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
	}
	button.ghost {
		background: transparent;
		color: var(--text-secondary);
	}
	button:disabled {
		opacity: 0.45;
	}
	.times {
		margin: 0.4rem 0 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.28rem;
		max-height: 18rem;
		overflow: auto;
	}
	.times li {
		display: grid;
		grid-template-columns: 3.6rem minmax(0, 1fr);
		gap: 0.5rem;
		font-size: 0.82rem;
		line-height: 1.35;
	}
	.t {
		font-variant-numeric: tabular-nums;
		color: var(--text-tertiary);
	}
	.lyric {
		overflow-wrap: anywhere;
	}
	.words {
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem 0.55rem;
		margin-top: 0.18rem;
		font-size: 0.72rem;
		color: var(--text-tertiary);
		font-variant-numeric: tabular-nums;
	}
</style>
