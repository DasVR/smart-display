<script>
	import { spectrum } from '$lib/services/audioReactive.js';

	let {
		time = new Date(),
		weather = { temp: '--', desc: '--' },
		nowPlaying = null,
		notification = { visible: false, title: '', body: '', kind: 'info' },
		gpuLowPower = false,
		ollamaStatus = 'idle'
	} = $props();

	let hh = $derived(String(time.getHours() % 12 || 12));
	let mm = $derived(String(time.getMinutes()).padStart(2, '0'));
	let ampm = $derived(time.getHours() >= 12 ? 'PM' : 'AM');

	let mode = $derived.by(() => {
		if (notification?.visible) return 'alert';
		if (nowPlaying?.playing) return 'nowplaying';
		return 'idle';
	});

	let bins = $derived(($spectrum || []).slice(0, 10));

	function modeLabel(next) {
		switch (next) {
			case 'idle':
				return 'hermes';
			case 'nowplaying':
				return 'now playing';
			case 'alert':
				return notification?.kind || 'alert';
			default: {
				const _exhaustive = next;
				return _exhaustive;
			}
		}
	}
</script>

<svg width="0" height="0" class="defs" aria-hidden="true">
	<filter id="island-gooey">
		<feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur" />
		<feColorMatrix
			in="blur"
			mode="matrix"
			values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -11"
			result="goo"
		/>
		<feComposite in="SourceGraphic" in2="goo" operator="atop" />
	</filter>
</svg>

<div class="island-anchor" data-mode={mode}>
	<div class="gooey">
		<div class="blob drip" class:on={mode === 'alert'}></div>
		<div class="blob pill" class:nowplaying={mode === 'nowplaying'} class:alert={mode === 'alert'}>
			{#if mode === 'nowplaying'}
				<div class="art" aria-hidden="true"></div>
				<div class="copy">
					<div class="kicker">{modeLabel(mode)}</div>
					<div class="title">{nowPlaying?.title || 'Unknown'}</div>
					<div class="sub">{nowPlaying?.artist || ''}</div>
				</div>
				<div class="mini-vis" aria-hidden="true">
					{#each bins as h, i (i)}
						<span style="height: {Math.max(12, h * 100)}%"></span>
					{/each}
				</div>
			{:else if mode === 'alert'}
				<div class="orb alert-orb"></div>
				<div class="copy">
					<div class="kicker">{modeLabel(mode)}</div>
					<div class="title">{notification.title}</div>
					<div class="sub">{notification.body}</div>
				</div>
			{:else}
				<div class="orb hermes" class:yield={gpuLowPower}></div>
				<div class="copy compact">
					<div class="title clock">{hh}:{mm} <em>{ampm}</em></div>
					<div class="sub">{weather?.temp}° · {weather?.desc}</div>
				</div>
				<div class="status">
					<span class="chip" class:hot={gpuLowPower}>{gpuLowPower ? 'YIELD' : 'LIVE'}</span>
					<span class="chip dim">{ollamaStatus === 'inferring' ? 'LLM' : 'HERMES'}</span>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.defs {
		position: absolute;
		width: 0;
		height: 0;
		overflow: hidden;
	}
	.island-anchor {
		display: flex;
		justify-content: center;
		pointer-events: none;
	}
	.gooey {
		filter: url(#island-gooey);
		display: flex;
		flex-direction: column-reverse;
		align-items: center;
	}
	.blob {
		background: rgba(10, 14, 28, 0.82);
		border: 1px solid rgba(255, 255, 255, 0.12);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.14),
			0 16px 40px rgba(0, 0, 0, 0.35);
	}
	.pill {
		display: flex;
		align-items: center;
		gap: 14px;
		min-height: 56px;
		padding: 10px 18px 10px 12px;
		border-radius: 999px;
		min-width: 280px;
		max-width: 620px;
		transition:
			min-width 0.55s cubic-bezier(0.16, 1, 0.3, 1),
			padding 0.55s cubic-bezier(0.16, 1, 0.3, 1),
			border-radius 0.45s ease;
	}
	.pill.nowplaying {
		min-width: 520px;
		border-radius: 28px;
	}
	.pill.alert {
		min-width: 420px;
		border-radius: 28px;
	}
	.drip {
		width: 84px;
		height: 18px;
		border-radius: 999px;
		margin-top: -10px;
		transform: scaleY(0.2);
		opacity: 0;
		transition: transform 0.5s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.35s ease;
	}
	.drip.on {
		opacity: 1;
		transform: scaleY(1);
	}
	.orb {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.hermes {
		background:
			radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.9), rgba(169, 177, 240, 0.2) 38%, rgba(80, 90, 180, 0.9));
		box-shadow: 0 0 16px rgba(169, 177, 240, 0.85);
		animation: pulse 2.8s ease-in-out infinite;
	}
	.hermes.yield {
		background:
			radial-gradient(circle at 35% 30%, rgba(255, 230, 180, 0.95), rgba(251, 191, 36, 0.2) 40%, rgba(180, 90, 20, 0.9));
		box-shadow: 0 0 16px rgba(251, 191, 36, 0.8);
		animation: pulse 1.2s ease-in-out infinite;
	}
	.alert-orb {
		background: radial-gradient(circle at 35% 30%, #fff, #fca5a5 45%, #7f1d1d);
		box-shadow: 0 0 16px rgba(252, 165, 165, 0.8);
	}
	.art {
		width: 40px;
		height: 40px;
		border-radius: 10px;
		background: linear-gradient(135deg, #c4b5fd, #67e8f9);
		flex-shrink: 0;
	}
	.copy {
		min-width: 0;
		flex: 1;
	}
	.copy.compact .title {
		font-size: 22px;
	}
	.kicker {
		font-size: 10px;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: rgb(148, 163, 184);
		font-weight: 500;
	}
	.title {
		font-size: 18px;
		font-weight: 600;
		color: #fff;
		letter-spacing: -0.02em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.title.clock em {
		font-style: normal;
		font-size: 0.55em;
		font-weight: 500;
		color: rgb(148, 163, 184);
		margin-left: 4px;
	}
	.sub {
		font-size: 13px;
		color: rgb(148, 163, 184);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.status {
		display: flex;
		gap: 6px;
		flex-shrink: 0;
	}
	.chip {
		font-family: var(--font-display);
		font-size: 10px;
		letter-spacing: 0.14em;
		padding: 4px 8px;
		border-radius: 999px;
		border: 1px solid rgba(52, 211, 153, 0.35);
		color: rgb(52, 211, 153);
	}
	.chip.hot {
		border-color: rgba(251, 191, 36, 0.5);
		color: rgb(251, 191, 36);
	}
	.chip.dim {
		border-color: rgba(255, 255, 255, 0.12);
		color: rgb(148, 163, 184);
	}
	.mini-vis {
		display: flex;
		align-items: flex-end;
		gap: 3px;
		height: 28px;
		width: 72px;
		flex-shrink: 0;
	}
	.mini-vis span {
		flex: 1;
		border-radius: 999px;
		background: linear-gradient(180deg, #67e8f9, rgba(103, 232, 249, 0.2));
	}
	@keyframes pulse {
		0%,
		100% {
			transform: scale(1);
			filter: brightness(1);
		}
		50% {
			transform: scale(1.08);
			filter: brightness(1.25);
		}
	}
</style>
