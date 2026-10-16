# The wall's look

Switched on the phone (**Display → Look**) or for a preview with
`?look=halftone|paper|poster|depth|riso|console|classic&art=almond|magpie|poppies|starry`
on the wall's URL. Each dresses the Clock page differently; the other pages
share the halftone chrome for now.

| Look | Clock page |
| --- | --- |
| Glass (`halftone`) | two graphite glass cards over the painting in dots (`GlassClock.svelte`) |
| Paper | cream paper cards across the top with dotted shadows, the painting below (`PaperClock.svelte`) |
| Poster | the time huge across the painting, three small glass tiles underneath (`PosterClock.svelte`) |
| Depth (default) | dark: the painting in pale dots on near-black (`HalftoneArt` `invert`), the time huge with the painting's deepest shadows printed back over it (`over`), smoked liquid-glass tiles, and dot shadows cast away from the sun (they drift over the day) |
| Riso | paper cards and the painting in two inks, teal and tangerine, off-register |
| Console | no painting: off-white hardware, dot-matrix time (`DotDigits.svelte`), signal orange, page keys (`ConsoleClock.svelte`) |
| Classic | the liquid-metal wall from before |

- **Halftone**: a public-domain painting printed in dots fills
  the screen (`HalftoneArt.svelte`, drawn once to a canvas, so it costs
  nothing while it's up). Pages sit on warm graphite glass. The Clock page has
  two cards (`GlassClock.svelte`): the date and a big cream clock with rolling
  digits, a dotted shadow, seconds and an AM/PM pill, and the Today list beside
  the weather and sunrise/sunset. The tabs are one pill at the bottom; the
  island stays at the top. **By the hour** picks the painting: Almond
  Blossom in the morning, Poppy Field by day, The Magpie in the evening, The
  Starry Night at night. StandBy keeps its own night face.
- **Classic**: the liquid-metal wall from before.

The setting lives in `data/look.json` (gitignored) and reaches the wall with
the `display` message. The paintings are in `static/art/` (all public domain:
Van Gogh, Monet).
