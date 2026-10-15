# The wall's look

Two looks, switched on the phone (**Display → Look**) or for a preview with
`?look=halftone|classic&art=almond|magpie|poppies|starry` on the wall's URL.

- **Halftone** (the default): a public-domain painting printed in dots fills
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
