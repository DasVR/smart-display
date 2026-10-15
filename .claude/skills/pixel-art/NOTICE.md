# Where this skill comes from

`pixel-art` is copied unchanged from
[omer-metin/skills-for-antigravity](https://github.com/omer-metin/skills-for-antigravity/tree/HEAD/skills/pixel-art)
(`skills/pixel-art/`), licensed under the Apache License 2.0 (see `LICENSE`).

It's here so Claude sessions on this repo use it when working on the wall's
pixel characters (`src/lib/agentSprites.js`, `src/lib/components/AgentCharacter.svelte`).
The rules this project leans on most:

- integer scaling only, with `imageSmoothingEnabled = false` and `image-rendering: pixelated`
- subpixel animation by colour shifting (half-tone pixels), not by moving pixels
- few frames, each one deliberate, with anticipation and follow-through
- one consistent light source; no pillow shading
