# Talk to the wall from the phone

The same conversation as "Hey Display", on the phone. Hold the **mic key** in
the middle of the remote's tab bar and a sheet slides up with the listening
orb. Say it, let go, and it goes to the wall the way a sentence said to its
microphone does; the answer comes back on the sheet.

| Gesture | Does |
| --- | --- |
| **Hold** the mic key | The key's ring fills (about 0.2 s), the sheet rises and it listens. Let go to send. |
| Hold, then **slide left** | "Release to cancel": the sentence is thrown away. |
| **Tap** the mic key | Opens the sheet latched: it listens, sends after a pause, and stays open. |
| Drag the sheet **down** (or tap outside, or Esc) | Puts it away. |
| Type in the box | The same, without a microphone. |

It is one conversation with the wall's: commands ("pause"), things to add
("remind me…"), answers to what the wall just asked, and everything else goes
to the assistant ([`assistant.md`](assistant.md)). When the answer is a
question ("When should I remind you?") the phone starts listening again by
itself.

**Answer on** picks where the reply is read: this phone (default), the wall's
speaker (through the wall's voice, [`voice.md`](voice.md)), or text only. The
choice is remembered on the phone.

## What it needs

- **A secure address.** Phones only let a page use the microphone over
  `https://` (or `localhost`). On a plain `http://100.x.x.x:3000` address the
  sheet still works, but only by typing, and says so. Give the wall an https
  address on your tailnet:

  ```bash
  tailscale serve --bg 3000
  ```

  then open `https://<machine>.<tailnet>.ts.net/remote` on the phone. The
  remote's socket follows the page to `wss://` by itself.
- **The browser's speech recogniser** (`SpeechRecognition`): Safari on iPhone
  and Chrome on Android have it. It is the phone's own, so what you say is
  transcribed by your phone's vendor, not by the wall.
- Allow the microphone for the site the first time.

## How it's built

| | |
| --- | --- |
| `src/lib/voiceAgent.js` | Pure: the press gesture (hold, tap, slide to cancel), the phase machine, level smoothing, the "why voice can't run here" text. Tests in `tests/voice-agent.test.mjs`. |
| `src/lib/voiceSession.svelte.js` | One conversation: listens, sends `{ type: 'tasks', op: 'say' }` over its own small socket (so it works from every remote page), reads or speaks the answer. |
| `src/lib/services/listen.js` | The recogniser, a mic level meter for the orb (not on iPhone, where sharing the mic breaks recognition; the orb follows the words instead), and reading the answer aloud. |
| `src/lib/shaders/voiceOrb.js` | The orb: one fragment shader, drawn at 75% of pixel size, dithered, in the wall's palette read from the CSS tokens. Listening swells with your voice, thinking draws in and turns gold, speaking breathes teal, errors dim to clay. No WebGL: a CSS orb stands in. |
| `src/lib/components/VoiceKey.svelte`, `VoiceSheet.svelte` | The key (with its hold ring) and the sheet. |

Motion: the sheet and its scrim share one curve (`--ease-fluid`), come up in
460 ms and leave in 260 ms; everything is `transform` and `opacity`. With
reduced motion the sheet fades instead, and the orb holds still.
