<script>
	// One odometer-style digit: a strip of stacked 0-9 glyphs that only ever
	// rolls forward (never snaps backward), like a mechanical flip counter.
	// On first mount it spins up through a couple of extra cycles before
	// landing on the real value; after that each change rolls the shortest
	// forward distance (e.g. 9 -> 0 rolls through, it doesn't reverse).
	let { digit = 0, spinCycles = 2 } = $props();

	const CYCLE = 10;
	const RESET_AT = 40; // roll forward this far before silently rewinding a full cycle
	const STRIP_CYCLES = 6; // rendered digit spans; comfortably covers RESET_AT + a spin-up + wrap slack
	const STRIP = STRIP_CYCLES * CYCLE;
	const cells = Array.from({ length: STRIP }, (_, i) => i % CYCLE);

	let reducedMotion = $state(false);
	$effect(() => {
		if (typeof window === 'undefined') return;
		const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
		reducedMotion = mq.matches;
		const onChange = (e) => {
			reducedMotion = e.matches;
		};
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	});

	let pos = $state(0);
	let ready = $state(false);
	let longRoll = $state(false);
	let didMount = false;
	let prevDigit = null;
	let longRollTimer = 0;

	function afterPaint(fn) {
		requestAnimationFrame(() => requestAnimationFrame(fn));
	}

	$effect(() => {
		const d = digit;

		if (!didMount) {
			didMount = true;
			prevDigit = d;
			pos = d;
			if (reducedMotion) {
				ready = false;
				return;
			}
			afterPaint(() => {
				longRoll = true;
				ready = true;
				pos = spinCycles * CYCLE + d;
				clearTimeout(longRollTimer);
				longRollTimer = setTimeout(() => {
					longRoll = false;
				}, 1150);
			});
			return;
		}

		if (d === prevDigit) return;
		const steps = ((d - prevDigit + CYCLE) % CYCLE) || CYCLE;
		prevDigit = d;

		if (reducedMotion) {
			ready = false;
			longRoll = false;
			pos = d;
			return;
		}

		longRoll = false;
		if (pos + steps >= RESET_AT) {
			const settled = pos % CYCLE;
			ready = false;
			pos = settled;
			afterPaint(() => {
				ready = true;
				pos = settled + steps;
			});
		} else {
			ready = true;
			pos = pos + steps;
		}
	});
</script>

<span class="roll" class:ready class:long={longRoll}>
	<span class="track" style="transform: translateY(calc(-1 * {pos} * var(--dh)))">
		{#each cells as n}
			<span class="cell">{n}</span>
		{/each}
	</span>
</span>

<style>
	.roll {
		--dh: 1em;
		position: relative;
		display: inline-block;
		width: 1ch;
		height: var(--dh);
		overflow: hidden;
		vertical-align: baseline;
	}
	.track {
		display: block;
	}
	.roll.ready .track {
		transition: transform 480ms var(--spring-bouncy);
	}
	.roll.ready.long .track {
		transition: transform 1100ms cubic-bezier(0.16, 1, 0.3, 1);
	}
	.cell {
		display: block;
		height: var(--dh);
		line-height: var(--dh);
		text-align: center;
	}
</style>
