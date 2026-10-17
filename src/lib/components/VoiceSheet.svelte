<!--
	The voice sheet: rises from the bottom when the mic key is held (or
	tapped) and carries the conversation with the wall. The orb is one shader
	(src/lib/shaders/voiceOrb.js) behind everything; what you said, then what
	the wall answered, sit under it. Drag the top down to put it away.
	Without WebGL (or with reduced motion) a CSS orb stands in.
-->
<script>
	import { onMount, tick } from 'svelte';
	import { createOrb } from '$lib/shaders/voiceOrb.js';
	import { phaseLine, SUGGESTIONS } from '$lib/voiceAgent.js';
	import { voice, meter, close, tap, sendTyped, sendSuggestion, setMode, keepOpen, MODE_LABELS } from '$lib/voiceSession.svelte.js';

	let { returnFocus = null } = $props();

	let panel = $state(null);
	let stage = $state(null);
	let canvas = $state(null);
	let input = $state(null);
	let orb = null;
	let fallback = $state(false);
	let reduced = $state(false);
	let closeTimer = 0;
	let wasOpen = false;

	let line = $derived(phaseLine(voice.phase, { cancel: voice.cancel, latched: voice.latched, hasText: Boolean(voice.heard) }));
	let idleBlank = $derived(voice.phase === 'idle' && !voice.said && !voice.reply && !voice.heard && !voice.failed);
	let listening = $derived(voice.phase === 'listening');

	onMount(() => {
		reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
		orb = canvas ? createOrb(canvas) : null;
		if (!orb) {
			fallback = true;
			return;
		}
		orb.setLevelSource(() => meter.level);
		orb.setStill(reduced);
		const fit = () => {
			if (!panel || !canvas) return;
			const w = panel.clientWidth;
			const h = panel.clientHeight;
			orb.resize(w, h, window.devicePixelRatio || 1);
			// the orb sits in the stage row; tell the shader where
			const p = panel.getBoundingClientRect();
			const s = stage?.getBoundingClientRect();
			if (s) orb.setCenter((s.left - p.left + s.width / 2) / p.width, 1 - (s.top - p.top + s.height / 2) / p.height);
		};
		const ro = new ResizeObserver(fit);
		ro.observe(panel);
		if (stage) ro.observe(stage);
		fit();
		return () => {
			ro.disconnect();
			orb?.destroy();
		};
	});

	$effect(() => {
		orb?.setPhase(voice.phase === 'idle' ? 'listening' : voice.phase);
	});

	$effect(() => {
		clearTimeout(closeTimer);
		if (voice.open) {
			orb?.setRise(1);
			orb?.start();
			wasOpen = true;
			tick().then(() => {
				// no on-screen keyboard unless there's no other way to talk
				if (voice.blocker) input?.focus({ preventScroll: true });
			});
		} else {
			orb?.setRise(0);
			// keep drawing until the sheet has left, then stop spending battery
			closeTimer = setTimeout(() => orb?.stop(), 520);
			if (wasOpen) returnFocus?.focus?.({ preventScroll: true });
		}
		return () => clearTimeout(closeTimer);
	});

	/* ---------- drag the top down to dismiss ---------- */

	let drag = null;
	function dragStart(e) {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		drag = { y: e.clientY, t: performance.now(), dy: 0, id: e.pointerId };
		e.currentTarget.setPointerCapture?.(e.pointerId);
		panel.style.transition = 'none';
		keepOpen();
	}
	function dragMove(e) {
		if (!drag || e.pointerId !== drag.id) return;
		const dy = e.clientY - drag.y;
		// down follows the finger; up is resisted
		drag.dy = dy > 0 ? dy : dy / 6;
		panel.style.transform = `translateY(${drag.dy}px)`;
	}
	function dragEnd(e) {
		if (!drag || e.pointerId !== drag.id) return;
		const v = drag.dy / Math.max(1, performance.now() - drag.t);
		const away = drag.dy > 110 || v > 0.55;
		drag = null;
		panel.style.transition = '';
		panel.style.transform = '';
		if (away) close();
	}

	function keydown(e) {
		if (e.key === 'Escape' && voice.open) close();
	}

	function submit(e) {
		e.preventDefault();
		sendTyped();
	}
</script>

<svelte:window onkeydown={keydown} />

<div class="voice" class:open={voice.open} class:reduced inert={!voice.open} aria-hidden={!voice.open}>
	<div class="scrim" onpointerdown={close} role="presentation"></div>

	<section
		bind:this={panel}
		class="panel"
		class:listening
		class:thinking={voice.phase === 'thinking'}
		class:speaking={voice.phase === 'speaking'}
		class:error={voice.phase === 'error'}
		role="dialog"
		aria-modal="true"
		aria-label="Voice assistant"
		onpointerdown={keepOpen}
	>
		<canvas bind:this={canvas} class="orb" aria-hidden="true"></canvas>

		<header class="head" onpointerdown={dragStart} onpointermove={dragMove} onpointerup={dragEnd} onpointercancel={dragEnd}>
			<span class="grab" aria-hidden="true"></span>
			<p class="line" aria-live="polite">{#key line}<span>{line}</span>{/key}</p>
			<button class="x" type="button" aria-label="Close" onpointerdown={(e) => e.stopPropagation()} onclick={close}>
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
			</button>
		</header>

		<div bind:this={stage} class="stage">
			{#if fallback}<span class="css-orb" aria-hidden="true"></span>{/if}
		</div>

		<div class="talk" aria-live="polite">
			{#if voice.heard}
				<p class="heard">{voice.heard}</p>
			{:else if voice.said}
				<p class="said">{voice.said}</p>
			{/if}
			{#if voice.reply}
				{#key voice.reply}<p class="reply">{voice.reply}</p>{/key}
			{:else if voice.failed}
				<p class="fail" role="alert">{voice.failed}</p>
			{/if}
			{#if idleBlank}
				<ul class="chips" aria-label="Things to try">
					{#each SUGGESTIONS as s, i (s)}
						<li style:--i={i}><button type="button" onclick={() => sendSuggestion(s)}>{s}</button></li>
					{/each}
				</ul>
			{/if}
			{#if voice.blocker}
				<p class="note">{voice.blocker}</p>
			{/if}
		</div>

		<footer class="foot">
			<form class="type" onsubmit={submit}>
				<input
					bind:this={input}
					bind:value={voice.typed}
					type="text"
					inputmode="text"
					enterkeyhint="send"
					autocomplete="off"
					autocapitalize="sentences"
					placeholder="Or type to the display"
					aria-label="Type to the display"
				/>
				{#if voice.typed.trim()}
					<button class="send" type="submit" aria-label="Send">
						<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
					</button>
				{:else if !voice.blocker}
					<button class="send mic" type="button" class:on={listening} aria-label={listening ? 'Stop listening' : 'Start listening'} onclick={tap}>
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<rect x="9" y="2.75" width="6" height="11" rx="3" />
							<path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
						</svg>
					</button>
				{/if}
			</form>
			<div class="modes" role="radiogroup" aria-label="Where the answer is read">
				<span>Answer on</span>
				{#each Object.entries(MODE_LABELS) as [id, label] (id)}
					<button type="button" role="radio" aria-checked={voice.mode === id} class:on={voice.mode === id} onclick={() => setMode(id)}>{label}</button>
				{/each}
			</div>
		</footer>
	</section>
</div>

<style>
	.voice {
		position: fixed;
		inset: 0;
		z-index: 40;
		pointer-events: none;
		visibility: hidden;
		transition: visibility 0s linear 300ms;
	}
	.voice.open {
		pointer-events: auto;
		visibility: visible;
		transition-delay: 0s;
	}

	.scrim {
		position: absolute;
		inset: 0;
		background: color-mix(in srgb, var(--abyss) 62%, transparent);
		opacity: 0;
		transition: opacity 260ms var(--ease-fluid);
	}
	.voice.open .scrim {
		opacity: 1;
		transition-duration: 460ms;
	}

	.panel {
		--pad: var(--space-5);
		position: absolute;
		left: 50%;
		bottom: 0;
		width: min(100%, 26rem);
		height: min(84dvh, 42rem);
		margin-left: calc(min(100%, 26rem) / -2);
		display: grid;
		grid-template-rows: auto minmax(11rem, 1fr) auto auto;
		border-radius: 2rem 2rem 0 0;
		border: 1px solid var(--hairline);
		border-bottom: 0;
		background: color-mix(in srgb, var(--abyss-1) 90%, transparent);
		backdrop-filter: blur(26px) saturate(1.4);
		-webkit-backdrop-filter: blur(26px) saturate(1.4);
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, var(--foreground) 14%, transparent),
			0 -24px 60px color-mix(in srgb, var(--abyss) 80%, transparent);
		overflow: hidden;
		transform: translateY(104%);
		/* leaves quickly and quietly */
		transition: transform 260ms var(--ease-fluid);
		will-change: transform;
		padding-bottom: max(var(--space-3), env(safe-area-inset-bottom));
	}
	.voice.open .panel {
		transform: none;
		transition-duration: 460ms;
	}

	.orb {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}

	.head {
		position: relative;
		display: grid;
		grid-template-columns: 2.75rem 1fr 2.75rem;
		align-items: center;
		padding: var(--space-2) var(--pad) 0;
		min-height: 3.5rem;
		touch-action: none;
		cursor: grab;
	}
	.grab {
		position: absolute;
		top: 0.5rem;
		left: 50%;
		width: 2.4rem;
		height: 0.28rem;
		margin-left: -1.2rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--foreground) 24%, transparent);
	}
	.line {
		grid-column: 2;
		margin: var(--space-3) 0 0;
		text-align: center;
		font-size: var(--text-sm);
		font-weight: 700;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
	}
	.line span {
		display: inline-block;
		animation: swap 240ms var(--ease-enter) both;
	}
	@keyframes swap {
		from { opacity: 0; transform: translateY(5px); filter: blur(2px); }
	}
	.x {
		grid-column: 3;
		justify-self: end;
		width: 2.75rem;
		height: 2.75rem;
		margin-top: var(--space-3);
		display: grid;
		place-items: center;
		border: 0;
		border-radius: 50%;
		background: var(--shell-fill);
		color: var(--text-secondary);
		cursor: pointer;
		touch-action: manipulation;
		transition: transform 120ms var(--ease-standard), background-color 150ms var(--ease-standard);
	}
	.x:active { transform: scale(0.94); }
	.x svg {
		width: 1.1rem;
		height: 1.1rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.2;
		stroke-linecap: round;
	}

	.stage { position: relative; min-height: 0; }

	.talk {
		position: relative;
		max-height: 38dvh;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 0 var(--pad) var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		text-align: center;
		scrollbar-width: none;
		mask-image: linear-gradient(to bottom, transparent 0, #000 0.6rem, #000 calc(100% - 0.6rem), transparent 100%);
	}
	.talk::-webkit-scrollbar { display: none; }
	.talk p { margin: 0; text-wrap: balance; overflow-wrap: anywhere; }
	.heard {
		font-size: var(--text-2xl);
		font-weight: 650;
		line-height: 1.22;
		letter-spacing: -0.02em;
		color: var(--foreground);
	}
	.said {
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--text-tertiary);
	}
	.reply {
		font-size: var(--text-xl);
		font-weight: 600;
		line-height: 1.3;
		letter-spacing: -0.015em;
		color: var(--foreground);
		animation: arrive 340ms var(--ease-enter) both;
	}
	@keyframes arrive {
		from { opacity: 0; transform: translateY(8px); filter: blur(3px); }
	}
	.fail {
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--warn);
	}
	.note {
		font-size: var(--text-sm);
		line-height: 1.4;
		color: var(--text-tertiary);
	}

	.chips {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-2);
	}
	.chips li { animation: arrive 320ms var(--ease-enter) both; animation-delay: calc(var(--i) * 45ms + 120ms); }
	.chips button {
		min-height: 2.75rem;
		padding: 0 var(--space-4);
		border-radius: 999px;
		border: 1px solid var(--hairline);
		background: var(--shell-fill);
		color: var(--text-secondary);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
		touch-action: manipulation;
		transition: transform 120ms var(--ease-standard), background-color 150ms var(--ease-standard);
	}
	.chips button:active { transform: scale(0.97); }

	.foot {
		position: relative;
		display: grid;
		gap: var(--space-3);
		padding: 0 var(--pad);
	}
	.type {
		position: relative;
		display: flex;
		align-items: center;
	}
	.type input {
		flex: 1;
		min-width: 0;
		min-height: 3.25rem;
		padding: 0 3.6rem 0 var(--space-4);
		border-radius: 999px;
		border: 1px solid var(--hairline);
		background: color-mix(in srgb, var(--abyss) 55%, transparent);
		color: var(--foreground);
		font: inherit;
		font-size: 1rem; /* 16px: iOS doesn't zoom the page on focus */
		-webkit-user-select: text;
		user-select: text;
	}
	.type input::placeholder { color: var(--text-tertiary); }
	.type input:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}
	.send {
		position: absolute;
		right: 0.3rem;
		width: 2.65rem;
		height: 2.65rem;
		display: grid;
		place-items: center;
		border: 0;
		border-radius: 50%;
		background: var(--brand);
		color: var(--abyss);
		cursor: pointer;
		touch-action: manipulation;
		transition: transform 120ms var(--ease-standard), background-color 180ms var(--ease-standard);
	}
	.send:active { transform: scale(0.93); }
	.send svg {
		width: 1.25rem;
		height: 1.25rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.send.mic { background: var(--shell-fill); color: var(--foreground); }
	.send.mic.on { background: var(--brand); color: var(--abyss); }

	.modes {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-wrap: wrap;
		gap: var(--space-1);
		font-size: 0.8rem;
		color: var(--text-tertiary);
	}
	.modes span { margin-right: var(--space-1); }
	.modes button {
		min-height: 2.25rem;
		padding: 0 var(--space-3);
		border-radius: 999px;
		border: 1px solid transparent;
		background: transparent;
		color: var(--text-tertiary);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
		touch-action: manipulation;
		transition: color 150ms var(--ease-standard), background-color 150ms var(--ease-standard);
	}
	.modes button.on {
		color: var(--foreground);
		background: var(--shell-fill);
		border-color: var(--hairline);
	}

	/* no WebGL: a CSS orb stands in, tinted by phase */
	.css-orb {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 9rem;
		height: 9rem;
		margin: -4.5rem 0 0 -4.5rem;
		border-radius: 50%;
		background: radial-gradient(circle at 34% 28%, color-mix(in srgb, white 60%, var(--brand)), var(--brand) 40%, var(--scan) 100%);
		box-shadow: 0 0 60px color-mix(in srgb, var(--brand) 55%, transparent);
		animation: breathe 3.2s var(--ease-in-out) infinite alternate;
	}
	.thinking .css-orb { background: radial-gradient(circle at 34% 28%, white, var(--solve) 60%, var(--brand)); animation-duration: 1.1s; }
	.error .css-orb { background: var(--warn); opacity: 0.5; animation: none; box-shadow: none; }
	@keyframes breathe {
		from { transform: scale(0.94); }
		to { transform: scale(1.06); }
	}

	@media (prefers-reduced-motion: reduce) {
		.panel {
			transform: none;
			opacity: 0;
			transition: opacity 160ms linear !important;
		}
		.voice.open .panel { opacity: 1; }
		.scrim { transition: opacity 160ms linear !important; }
		.css-orb { animation: none; }
		.reply, .chips li, .line span { animation-duration: 0.01ms; }
	}
	@media (prefers-reduced-transparency: reduce) {
		.panel {
			background: var(--abyss-1);
			backdrop-filter: none;
			-webkit-backdrop-filter: none;
		}
	}
</style>
