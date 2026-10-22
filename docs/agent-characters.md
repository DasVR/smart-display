# The agents as pixel characters

Each coding agent has a little pixel character that stands on the top edge of
the wall's bottom bar, so you can see who's working from across the room.

| What the agent is doing | What its character does |
| --- | --- |
| working (its hooks, see [`agent-status.md`](agent-status.md), or `/api/notify` with `"event": "working"`) | sits turned to an open laptop and types, in bursts, with pauses to read and a blink |
| asking (an approval is waiting, see [`approvals.md`](approvals.md)) | shuts the laptop, stretches, stands and waves, with a pixel "?" over its head; a speech bubble beside it asks the question, with Allow and Deny |
| you said yes | crouches, springs with its arms over its head, hops, lands and winks, then back to work |
| you said no | looks down, its arms drop, it sinks a pixel; then back to work |
| needs you somewhere else (a session asking a question you answer where it runs, see [`agent-status.md`](agent-status.md)) | stands and waves with the "?", no bubble |
| done | climbs back down behind the bar |

On the **Agents** view every session has its own lane with its character
([`agent-status.md`](agent-status.md#the-agents-view)): large when it's the
only one, smaller as lanes are added, at the laptop while it works and
standing with the "?" when it needs you (Ollama keeps its orb). On that view
the bottom bar only shows characters with an Allow / Deny question, so the
bubble has somewhere to stand.

Characters climb in and out a pixel at a time. While any are on stage, the
footer makes a strip for them to stand in and the view above gives up the
room.

## The cast

- **Claude**: Clawd, Claude Code's mascot, decoded from the "Clawd opens a
  laptop" GIF. 12 × 8 pixels, two oranges (`#d06a4b`, and `#b55c41` for his
  side when he turns).
- **Cursor**: a little cube lit from above, with a text caret for one eye that
  blinks every 530 ms.
- **Gemini**: twins holding hands, one blue, one violet, with a twinkle above.
- **Hermes**: a little teal messenger in a gold winged helmet and gold
  sandals. The wing tips beat by colour (full, then half-toned into the dark,
  every 330 ms); sitting at the laptop the far wing stands up behind it, and
  when you say no the wings droop to its sides.

An approval from an agent without a character (Codex, say) is asked by
Clawd, with the agent's own name on the bubble. Ollama doesn't get one.

All four share five poses (stand, wind-up, stretch, sit, slump), so every
state works for all of them.

## How it's built

- [`src/lib/agentSprites.js`](../src/lib/agentSprites.js): the characters,
  their poses, the states as frame lists, and `renderFrame()`, which turns a
  frame into rectangles. Pure and tested (`tests/agent-sprites.test.mjs`).
- [`src/lib/agentStage.js`](../src/lib/agentStage.js): who's on stage and
  doing what, from the agent roster and pending approvals
  (`tests/agent-stage.test.mjs`).
- [`AgentCharacter.svelte`](../src/lib/components/AgentCharacter.svelte):
  one canvas. Give it a target (`work`, `ask`, `idle`) and it finds the way:
  sitting to standing goes through shutting the laptop, standing to work
  through opening it. A verdict (`yes`, `no`) plays in full before anything
  else.
- [`AgentStage.svelte`](../src/lib/components/AgentStage.svelte): the cast on
  the bar, the climb, and the question bubble. It replaces the wall's old
  Allow / Deny card; the phone keeps its own card.

The pixel-art rules come from the `pixel-art` skill in
[`.claude/skills/pixel-art`](../.claude/skills/pixel-art), so Claude sessions
on this repo follow them:

- **Whole pixels only.** Every art pixel is a whole number of device pixels,
  smoothing is off, and the canvas is shown at exactly its own size. A
  fractional stretch makes some pixels wider than others and blurs the edges.
- **Subpixel motion by colour.** A blink is half shut, shut, half open; a
  breath softens the top row before the sprite sinks; a keystroke fades the
  arm's bottom pixels, lifts them, fades them back and lands. Half-tone pixels
  make a 1-pixel move read as a smaller one.
- **Few frames, each one deliberate.** Every hold is a whole number of the
  GIF's 66 ms frames, with long holds where nothing moves.
- **Anticipation, action, follow-through.** Every big move starts with a lean
  or a crouch and ends with a settle. The lid has a smear frame as it swings,
  like the GIF's frame 13.

With reduced motion on, each character shows its resting pose and skips the
in-betweens. While the screen is asleep or off, they stop drawing.

## Adding a character

Add an entry to `CHARACTERS` in `agentSprites.js` with a palette, a `hand`
(the near arm's lowest row in the sit pose, for typing) and the five poses,
each 12 characters wide, and teach `characterFor()` its name. The tests check
the poses' widths and colours and that every state renders for it.
