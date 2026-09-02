<script>
	import { onMount } from 'svelte';
	let audioCtx;
	let analyser;
	let data;
	let bars = new Array(24).fill(0);

	onMount(() => {
		try {
			audioCtx = new (window.AudioContext || window.webkitAudioContext)();
			analyser = audioCtx.createAnalyser();
			analyser.fftSize = 64;
			analyser.smoothingTimeConstant = 0.85;
			data = new Uint8Array(analyser.frequencyBinCount);
			const source = audioCtx.createBufferSource();
			const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate, audioCtx.sampleRate);
			source.buffer = buffer;
			source.loop = true;
			source.connect(analyser);
			source.start();
		} catch (e) { console.warn('audio zone', e); }

		let raf;
		function loop() {
			if (analyser && data) {
				analyser.getByteFrequencyData(data);
				bars = bars.map((_, i) => {
					const v = data[i % data.length] / 255;
					return v * 0.7 + 0.08; // min idle height
				});
			} else {
				const t = Date.now() * 0.001;
				bars = bars.map((_, i) => 0.12 + 0.08 * Math.sin(t + i * 0.5));
			}
			raf = requestAnimationFrame(loop);
		}
		loop();
		return () => cancelAnimationFrame(raf);
	});
</script>

<div class="audio-zone">
	<div class="bar-strip">
		{#each bars as h, i}
			<div class="bar" style="--h: {h}"></div>
		{/each}
	</div>
	<div class="zone-label">audio-reactive ambient zone</div>
</div>

<style>
	.audio-zone {
		width: min(80vw, 1200px);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
	}
	.bar-strip {
		display: flex;
		align-items: flex-end;
		justify-content: center;
		gap: clamp(4px, 0.6vw, 12px);
		height: clamp(80px, 14vh, 160px);
		width: 100%;
	}
	.bar {
		flex: 1;
		max-width: 24px;
		height: calc(var(--h) * 100%);
		background: linear-gradient(180deg, rgba(169,177,240,0.7) 0%, rgba(169,177,240,0.15) 100%);
		border-radius: 999px;
		transition: height 0.08s linear;
		box-shadow: 0 0 12px rgba(169,177,240,0.15);
	}
	.zone-label {
		font-family: var(--font-display);
		font-size: 14px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--text-tertiary);
	}
</style>
