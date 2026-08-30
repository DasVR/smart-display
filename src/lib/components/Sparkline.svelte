<script>
	let { points = [], height = 24 } = $props();

	const uid = `spark-${Math.random().toString(36).slice(2, 9)}`;
	const W = 200;
	const H = 56;

	function smoothPath(pts) {
		if (!pts.length) return { line: '', area: '' };
		const max = Math.max(...pts, 1);
		const min = Math.min(...pts, 0);
		const span = Math.max(max - min, 1);
		const step = pts.length === 1 ? 0 : W / (pts.length - 1);
		const coords = pts.map((v, i) => {
			const x = i * step;
			const y = H - ((v - min) / span) * (H - 6) - 3;
			return [x, y];
		});

		if (coords.length === 1) {
			const [x, y] = coords[0];
			return {
				line: `M 0 ${y} L ${W} ${y}`,
				area: `M 0 ${H} L 0 ${y} L ${W} ${y} L ${W} ${H} Z`
			};
		}

		let line = `M ${coords[0][0].toFixed(1)} ${coords[0][1].toFixed(1)}`;
		for (let i = 0; i < coords.length - 1; i++) {
			const p0 = coords[i === 0 ? i : i - 1];
			const p1 = coords[i];
			const p2 = coords[i + 1];
			const p3 = coords[i + 2] || p2;
			const c1x = p1[0] + (p2[0] - p0[0]) / 6;
			const c1y = p1[1] + (p2[1] - p0[1]) / 6;
			const c2x = p2[0] - (p3[0] - p1[0]) / 6;
			const c2y = p2[1] - (p3[1] - p1[1]) / 6;
			line += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
		}
		const last = coords[coords.length - 1];
		const area = `${line} L ${last[0].toFixed(1)} ${H} L 0 ${H} Z`;
		return { line, area };
	}

	let paths = $derived(smoothPath(points));
</script>

<svg
	class="sparkline"
	style="--spark-h: {height}px"
	viewBox="0 0 {W} {H}"
	preserveAspectRatio="none"
	aria-hidden="true"
>
	<defs>
		<linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
			<stop offset="0%" stop-color="currentColor" stop-opacity="0.28" />
			<stop offset="100%" stop-color="currentColor" stop-opacity="0" />
		</linearGradient>
	</defs>
	<path d={paths.area} fill="url(#{uid})" />
	<path d={paths.line} fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
</svg>

<style>
	.sparkline {
		width: 100%;
		height: var(--spark-h, 24px);
		display: block;
		overflow: visible;
		color: var(--brand);
	}
</style>
