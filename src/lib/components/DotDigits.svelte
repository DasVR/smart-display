<!--
	Text in a 5×7 dot-matrix font, drawn as round dots (the console look's
	clock). Digits, the colon, a space and the letters A, M and P.
-->
<script>
	let { text = '', dot = '0.18em', gap = '0.05em', color = 'currentColor', label = '' } = $props();

	// each glyph is 7 rows of 5 bits, top row first
	const FONT = {
		'0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
		'1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
		'2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
		'3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
		'4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
		'5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
		'6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
		'7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
		'8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
		'9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
		':': ['0', '0', '1', '0', '1', '0', '0'],
		' ': ['0', '0', '0', '0', '0', '0', '0'],
		A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
		M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
		P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000']
	};

	let glyphs = $derived([...String(text)].map((c) => FONT[c] || FONT[' ']));
</script>

<span class="dots" role={label ? 'img' : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : 'true'} style="--dot: {dot}; --gap: {gap}; --ink: {color}">
	{#each glyphs as rows, g (g)}
		<span class="glyph" style="--cols: {rows[0].length}">
			{#each rows as row, r (r)}
				{#each row.split('') as bit, c (c)}
					<i class:on={bit === '1'}></i>
				{/each}
			{/each}
		</span>
	{/each}
</span>

<style>
	.dots {
		display: inline-flex;
		gap: calc(var(--dot) + var(--gap) * 2);
		line-height: 0;
	}
	.glyph {
		display: grid;
		grid-template-columns: repeat(var(--cols), var(--dot));
		grid-auto-rows: var(--dot);
		gap: var(--gap);
	}
	i {
		border-radius: 50%;
	}
	i.on {
		background: var(--ink);
	}
</style>
