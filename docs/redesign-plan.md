# Redesign plan

A plan for rebuilding Smart Display: architecture, organization, features
that replace other features, new features, the wall and phone UI, and motion.
Every phase ships on its own and leaves the wall working.

Written 2026-10-15 against `22930ab`.

**Status.** Breakthroughs 2 to 7 have a first version in the code: the
Ledger (as a read model over the hubs), intents (a registry over the
existing parser), the event log and `npm run replay`, the phone's Now pane,
surface profiles (a flag only) and the senses sign with a hand-only Guest
mode. See [`ledger-and-log.md`](ledger-and-log.md). Breakthrough 1 (layout
by distance) and the refactor phases are still to do.

---

## 1. Where it stands

The product is rich. The structure has fallen behind it.

| Symptom | Evidence | Cost |
| --- | --- | --- |
| The wall is one huge component | `src/routes/+page.svelte` is 1,991 lines, with 12 `$effect`s, 16 `setInterval`s across page and components, and every overlay inline | Every feature edits the same file. Regressions hide in it. |
| The server is one huge file | `src/ws-server.js` is 1,140 lines. It wires 12 hubs by hand, hand-routes ~37 `/api/*` paths and makes 41 `broadcast()` calls | Wiring order matters (`actionHub` "defined below and only called later"). Hard to test. |
| Two HTTP routers | 15 SvelteKit `src/routes/api/*` endpoints *and* hand routes in `ws-server.js` | You have to guess where a route lives. Some state belongs to Node, some to SvelteKit. |
| Untyped wire protocol | ~29 message `type`s (`tasks`, `notify`, `navigate`, `trigger`, `attention`…) as bare strings on both ends | A rename breaks things silently. No single list of what goes over the socket. |
| Four "time" systems | `taskHub`, `calendarFeed`, `dayLogHub` and `attentionHub` each model "a thing at a time", with `attentionTap()` gluing them | One fact (a chore came due) gets represented 3–4 times. |
| Four "command" systems | `wallActions.js` (489), `quickSay.js` (478), `actionHub.js` (414), `scripts/tasks-mcp.mjs` (273) | Each new command means touching voice, Siri, Action menu and MCP separately. |
| Three "demo" systems | `demo/staticDemo.js` (516), `musicDemo.js`, `lyricVoicesDemo.js` | The demo drifts from the real thing. |
| Five attention surfaces | Dynamic Island, `AttentionCard`, `ApprovalCard`, `EdgeGlow`, `SevereTicker` | Breaks DESIGN.md's own rule: "One Dynamic Island… owns every transient event". |
| Remote sprawl | 4 tabs (Remote, Night, Tasks, Stats) and 8 pages. Sounds, Senses, Shortcuts, Lyrics and Pair have no tab | Features you can't find don't exist. |
| Drift and dead code | DESIGN.md still lists "School". `goveeState`, `recentCommits` and `gitContext` stores are never read | Small, but it erodes trust in the docs. |

What to keep without question: the pure-logic-plus-`node --test` habit (64
test files), the hub factory pattern (`createXHub({ broadcast, dataDir })`),
the token discipline in `app.css`/DESIGN.md, the frame governor and glass
tiers, and the house rule that you can answer anything from the wall, the
phone, the Action button or your voice.

---

## 2. The reframe: creative breakthroughs

These drive the rest of the plan. Each was checked against "would you have
done this anyway?"

> 💡 **CREATIVE BREAKTHROUGHS**
>
> **1. Responsive design by metres, not pixels.** The wall already knows
> how far away you are (`senses` distance and presence). Replace "which tab
> is showing" with *how close you are*: at 4 m you get the poster clock and
> one sentence; at 2 m the panels fade in; at arm's length you get controls
> and detail.
> *Why it works:* a wall panel's real breakpoint is the reader's distance.
> The data is already there, and nothing else uses it for layout.
> *Risk:* layout flicker at a threshold. Use hysteresis (enter at 1.8 m,
> leave at 2.4 m) and a 1.5 s dwell.
>
> **2. One Ledger instead of four time systems.** Tasks, calendar items, the
> day log, attention and weather alerts are all *entries on one timeline*
> with a status. The **past** is the Day Receipt, **now** is attention, and
> **soon** is the departure board and Today list. One store, many views.
> *Why it works:* it removes `attentionTap()` glue, duplicate
> representations and the order-of-wiring bugs. "Undo" becomes "revert the
> last ledger entry".
> *Risk:* migrating `data/*.json`. Write a one-shot importer and keep the
> old files read-only for a release.
>
> **3. Intents are the API.** Every module declares
> `intent({ id, phrases, params, run, confirm })` once. The voice grammar,
> Siri/`/api/tasks/say`, the Action button menu, MCP tools, phone buttons
> and the Shortcuts recipe page are all *generated* from that registry.
> *Why it works:* four ~450-line command systems become one, and the
> shortcuts docs can't go stale.
> *Risk:* fuzzy matching quality. Keep `quickSay`'s parser as the phrase
> engine behind the registry. Replace its plumbing, not its brain.
>
> **4. The demo is a recording.** Make the server's broadcast stream an
> append-only event log (`data/log/*.ndjson`). The static demo, test
> fixtures and bug reports all become *replays of a real day*.
> *Why it works:* it deletes three hand-written demo systems, and a
> reported bug arrives as a file you can replay to reproduce it.
> *Risk:* privacy in logs. Redact titles and transcripts on export, and
> never log raw audio.
>
> **5. The phone is the back of the wall, not a remote.** Drop the
> control-panel layout. The phone's home pane *mirrors whatever the wall
> shows right now* with that scene's controls under it (music → transport;
> attention → Got it / Later; weather → radar scrub). Settings move to a
> single "Home" tab.
> *Why it works:* there's zero navigation for the common case. You look at
> the wall, the phone already shows the matching controls.
>
> **6. Surfaces, not "the kiosk".** Make the client declare a *surface
> profile* (`{ size, distance, gpu: 'full'|'lite'|'none', input:
> 'touch'|'none', ink: false }`). The 1920×1080 wall, the phone, a future
> kitchen tablet or e-ink frame all subscribe to the same room state and
> render what their profile allows.
> *Why it works:* `glassTier`/`frameGovernor` already do half of this. Making
> it first-class turns "add a second screen" from a fork into a config.
>
> **7. Honest senses.** A camera and mic on a wall need a *visible* state:
> a small, fixed, never-animated glyph shows camera/mic on, off or hearing,
> and **Guest mode** hides calendar titles, agents and transcripts. It is
> turned on by hand from the phone, never automatically.
> *Why it works:* it's the feature that's missing, and it's what makes
> people trust the other features in a shared room.

---

## 3. Target architecture

```
                 ┌──────────── surfaces (thin clients) ────────────┐
                 │ wall 1920×1080 · phone · (tablet / e-ink later) │
                 └───────────────▲───────────────┬─────────────────┘
                     room state  │  snapshot +   │ intents
                     (typed)     │  patches      ▼
┌──────────────────────── Node server (src/server) ─────────────────────────┐
│ gateway/   ws + http router (ONE table)  · auth/pairing · surface profiles │
│ bus/       typed events → event log (ndjson) → projections                 │
│ intents/   registry → voice · Siri · Action menu · MCP · phone buttons     │
│ modules/   ledger · music · weather · agents · host · senses · voice ·     │
│            sounds · display · lyrics          (each: state + intents)      │
│ adapters/  playerctl · AirPlay · BT · HA · Ollama · NWS · Google · 11Labs  │
└────────────────────────────────────────────────────────────────────────────┘
          python senses (unchanged process) ──HTTP──▶ modules/senses
```

### 3.1 The module contract

Every feature is one folder, and you can test it without the server:

```js
// src/server/modules/weather/index.js
export default defineModule({
  id: 'weather',
  state: () => ({ now: null, alerts: [], nowcast: null }),   // slice of room state
  start({ bus, adapters, log }) { /* polls, subscriptions */ },
  intents: [
    intent({ id: 'weather.say', phrases: ['will it rain', 'weather'], run: ... }),
  ],
  routes: [ route('GET', '/api/weather', ...) ],               // optional HTTP
});
```

On the client it mirrors as `src/lib/modules/weather/` with
`store.js` (one derived slice of room state), `Scene.svelte` (wall),
`Controls.svelte` (phone) and `Glance.svelte` (the far-distance one-liner).

### 3.2 Room state over the wire

- One message on connect: `{ t: 'snapshot', v, state }`. After that:
  `{ t: 'patch', v, slice, ops }` (JSON-patch-ish, per module slice).
- A versioned schema lives in `src/protocol/` and is shared by server and
  client. A contract test fails when either side sends an undeclared type.
- This replaces the ~29 ad-hoc message types and most client polling. The
  `fetch('/api/weather')`, `/api/calendar` and `/api/day` polling on the
  page becomes subscriptions.

### 3.3 One router, static client

Move every `/api/*` handler into the Node gateway (that's where the state
lives), and build the client with `adapter-static`. You already ship a static
build for the demo, so the wall and the demo become the same artifact with a
different data source (live socket vs. log replay). *Check first:* any
`src/routes/api/*` endpoint that depends on SvelteKit `load` or hooks.

### 3.4 Proposed tree

```
src/
  protocol/            schema.js, version, contract tests
  server/
    main.js            ~80 lines: build bus, load modules, start gateway
    gateway/           http.js (route table), ws.js, auth.js, surfaces.js
    bus/               bus.js, eventLog.js, replay.js
    intents/           registry.js, phrases.js (quickSay engine), exporters/{mcp,actionMenu,shortcuts}.js
    modules/<id>/      index.js + pure logic files
    adapters/          playerctl.js, airplay.js, bluetooth.js, ha.js, ollama.js, nws.js, google.js, elevenlabs.js
  lib/
    design/            tokens.css, motion.css, motion.js
    surface/           profile.js, distance.js (hysteresis), governor (from glass/)
    modules/<id>/      store.js, Scene.svelte, Controls.svelte, Glance.svelte
    shell/             WallShell.svelte, SceneHost.svelte, AttentionLayer.svelte, Field.svelte
    ui/                shared primitives (Chip, Sheet, Trough, Meter, RollingDigit…)
  routes/
    +page.svelte       <WallShell/>  (target: < 150 lines)
    remote/+page.svelte <PhoneShell/>
tests/                 mirrors src/server/modules and src/lib/modules
```

---

## 4. Replacement features

| Today | Replaced by | Why |
| --- | --- | --- |
| `taskHub` + `calendarFeed` + `dayLogHub` + `attentionHub` + `attentionTap` | **Ledger** module with projections: `today`, `due`, `attention`, `receipt`, `departures` | One fact, one record. |
| `wallActions` + `quickSay` + `actionHub` + `tasks-mcp` | **Intent registry** with exporters | Declare a command once and it shows up everywhere. |
| `staticDemo` + `musicDemo` + `lyricVoicesDemo` | **Log replay** of recorded fixture days (`fixtures/days/*.ndjson`) | The demo is the real thing. |
| Island + AttentionCard + ApprovalCard + EdgeGlow + SevereTicker | **One AttentionLayer**, three tiers (below) | Restores the single-owner rule. |
| Five-tab carousel as the primary navigation | **Scenes** chosen by context (Smart Stack, already in `smartStack.js`) plus **distance tiers**. Swipe and voice still work. | Nobody should have to pick a tab on a wall. |
| Remote: 4 tabs + 5 orphan pages | **Phone: 3 tabs**: *Now* (mirror + controls), *Day* (ledger), *Home* (everything else) | Every page reachable in two taps or fewer. |
| Polling (`setInterval` fetches) | Room-state patches | Fewer timers, instant updates, less CPU on the kiosk. |
| Two routers | One gateway route table | One place to look. |

### Attention tiers (one layer, one queue)

| Tier | Example | Wall | Sound | Ends |
| --- | --- | --- | --- | --- |
| **Ambient** | now playing, install progress, volume | Island compact | none | on its own |
| **Notice** | agent finished, chore due soon | Island expanded, 9 s | chime once | timeout |
| **Calling** | timer done, approval, act-now NWS warning | Island **morphs into** the centre card. Edge glow on, panel wakes | rings, louder each time | ack from anywhere |

The severe ticker becomes the *Calling* card's persistent footer for weather.
`ApprovalCard` becomes a Calling item with two actions.

---

## 5. New features

In priority order. Each one is small once the spine exists.

1. **Distance tiers** (breakthrough 1). `Glance / Read / Touch` layouts per
   scene, driven by `presence.distance` with hysteresis. When the camera is
   off, the wall falls back to time-of-day defaults.
2. **Guest mode and the senses glyph** (breakthrough 7).
3. **Morning / Leaving / Home / Night scenes.** These already exist as
   Shortcuts events (`/api/action/event/*`). Give them first-class wall
   scenes that compose the ledger, weather and departures.
4. **Replay and "what happened"**: scrub back through today on the phone
   ("why did the wall ring at 3:12?"). Comes almost free with the event log.
5. **Surface profiles** (breakthrough 6). Ship a `lite` profile first for a
   second, cheaper tablet.
6. **Intent playground** on the phone: type a phrase and see which intent
   matched, its params and its confidence. It doubles as the Shortcuts page.
7. **Agent workbench scene.** Agents take the Agents scene only while an
   agent is active or waiting. Host stats move to Home → System.

Deliberately **not** added: more views, more sound packs or more shader
effects before the spine is in. Each one adds to the problem in section 1.

---

## 6. UI changes

### 6.1 Wall

- **Shell:** keep the mast / stage / trough frame and the token system.
  `WallShell` owns layout only. `SceneHost` owns which scene shows.
  `AttentionLayer` owns everything transient. `Field` owns the shader.
- **Hierarchy by distance:** each scene defines three densities. Type
  scale: `Glance` uses display sizes only (≥ 3rem at 22px root),
  `Read` adds body text, and `Touch` adds controls at ≥ 2.75rem hit targets.
- **The field speaks a little:** tarnish (overdue) already works. Add one
  more channel at most: a slow ripple while the wall's voice speaks, which
  replaces the voice EdgeGlow. The field stays atmosphere: it never carries
  anything you must act on.
- **One accent per scene.** The palette keeps `brand`. Semantic `ok/warn`
  appear only inside the AttentionLayer, so colour means something again.
- **Calendar:** the seven-day timetable becomes a ledger projection, with
  homework, chores and events in one lane system.
- **Music:** keep the record deck. It's the signature moment. Move the
  lyric engine behind the module boundary so the view is only a renderer.

### 6.2 Phone

- **Now:** a live mini-wall (a scaled scene thumbnail) on top, that scene's
  controls under it, and Calling items pinned above both.
- **Day:** the ledger: today, upcoming, done. Add with one text field (it's
  an intent, so "every Monday 6pm" works here as well).
- **Home:** Display schedule · Voice & volume · Sounds · Senses & privacy ·
  Pairing · Shortcuts & intents · System (stats, updates) · Lyrics tools.
- **Confirm in place:** a button turns into its result ("Sent ✓", "Snoozed
  till 7") and then reverts. No corner toasts for things you just tapped.

---

## 7. Motion system

The wall is read from across a room, and the phone is held in a hand. These
rules apply the `ui-animation` guidance to both.

### 7.1 Tokens (`src/lib/design/motion.css`)

```css
:root {
  --ease-enter: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-move:  cubic-bezier(0.25, 1, 0.5, 1);
  --ease-onscreen: cubic-bezier(0.645, 0.045, 0.355, 1);
  --ease-expo:  cubic-bezier(0.19, 1, 0.22, 1);

  --dur-press: 120ms;   /* phone taps */
  --dur-quick: 180ms;   /* island compact ↔ notice, chips */
  --dur-panel: 280ms;   /* phone sheets, density tier changes */
  --dur-scene: 420ms;   /* full-screen scene change (distance-scaled) */
  --dur-ambient: 1200ms;/* field-level shifts, only for rare ambient changes */
}
@media (prefers-reduced-motion: reduce) {
  :root { --dur-scene: 0ms; --dur-panel: 120ms; --dur-ambient: 0ms; }
}
```

There's one more gate: `glassTier === 'flat'` or the frame governor
throttling sets `data-motion="lite"` on `<html>`. In lite mode, spatial
travel turns into opacity crossfades and nothing loops.

### 7.2 Where motion earns its place

| Moment | Frequency | Motion | Purpose |
| --- | --- | --- | --- |
| Scene change (swipe / voice / Smart Stack) | several per hour | Slide in swipe order (`KIOSK_VIEWS` direction), `--dur-scene`, `--ease-move`; shared mast stays put | orientation |
| Distance tier change | often | Content *unfolds in place*. Panels scale from 0.96 + fade, `--dur-panel`; no stagger on the container *and* children | continuity |
| Island → Calling card | rare | **Container morph**: the island pill grows into the centre card (emerges from its trigger), with the edge glow on the same curve and duration | attention, continuity |
| Calling ack | rare | Card collapses back into the island, then the island settles. Exit faster than enter | closure |
| Chore done on wall | daily | The row strikes through and the tarnish polishes back (already designed) | delight (rare) |
| Day Receipt | nightly | Prints like a receipt, ≤ 1000ms: the one place for personality | delight |
| Clock digits | every minute | `RollingDigit` stays, but short (≤ 250ms) | feedback |
| Phone taps | constant | `:active` scale(0.97) at 0ms, `touch-action: manipulation`, result swaps in place | feedback |
| Phone sheets (Home sub-pages) | often | Slide from the right, `--ease-move`, back swipe follows the finger (no easing while dragging) | orientation |

### 7.3 Rules carried into review

- Only `transform`, `opacity` and (sparingly) `filter` animate. No
  `transition: all`. Grep for both in CI (a 10-line script in `tests/`).
- Interruptible state changes use transitions, not keyframes. The island
  in particular must retarget mid-morph when a new event arrives.
- Never start a scene transition and a heavy fetch or shader re-init in the
  same tick. Start the motion, wait one frame, then do the work.
- Pause loops off-screen and while the panel is off (`hdmiOff`). The shader
  already respects the governor; the island and EdgeGlow loops must too.
- Mute theme and tier switches: `[data-motion-switching] * { transition: none !important }`.

---

## 8. Roadmap

Each step is one PR, ships green, and leaves the wall usable.

### Phase 0: Guardrails (1 week)
1. **Screenshot harness.** Playwright with the preinstalled Chromium
   renders all five views at 1920×1080 and the phone at 390×844 from the
   static demo. The baselines get committed.
2. **Protocol inventory.** Write down every current WS `type` and its payload
   in `src/protocol/legacy.js`, with a test that fails on an unknown type in
   `ws-server.js` or the clients.
3. **Clean-up.** Delete the dead stores, fix the DESIGN.md "School" drift,
   and move `src/lib/atmosphere.test.js` into `tests/`.

### Phase 1: Server spine (2 weeks)
4. `src/server/bus` + `gateway` (one route table). Move hand routes over
   unchanged and keep `ws-server.js` as a shim that imports `main.js`.
5. Move the SvelteKit `api/*` endpoints into the gateway, then switch the
   client to `adapter-static`.
6. Convert each hub into a module, one per PR, starting with the
   low-risk ones: `display`, `volume`, `weather`, `host`. Last: `senses`,
   `voice`.
7. Snapshot + patch room state alongside the legacy messages (dual-send).
   Clients migrate slice by slice, then the legacy messages are removed.

### Phase 2: Ledger and intents (2 weeks)
8. Ledger module, importer from `data/*.json`, projections. `attentionHub`
   becomes a projection.
9. Intent registry, with `quickSay` as the phrase engine. Exporters for
   the Action menu, MCP and the Shortcuts page. Delete the old command paths.
10. Event log + replay. Rebuild the static demo from a recorded fixture
    day and delete the three demo modules.

### Phase 3: Wall shell (2 weeks)
11. Split `+page.svelte` into `WallShell`, `SceneHost`, `AttentionLayer` and
    `Field`, with no visual change (the screenshot diff must stay empty).
12. Motion tokens + `data-motion` gating. Rework the scene transitions.
13. AttentionLayer tiers. Merge in ApprovalCard, SevereTicker and the voice
    EdgeGlow. Add the island → card container morph.
14. Distance tiers (`Glance/Read/Touch`) for Clock and Weather first.

### Phase 4: Phone (1–2 weeks)
15. Phone shell with Now / Day / Home. Move the existing pages under Home
    unchanged.
16. Now pane: scene mirror and contextual controls. Confirm in place.
17. Day pane on the ledger. Intent playground.

### Phase 5: New capabilities (ongoing)
18. Guest mode and the senses glyph. 19. Scenes for morning, leaving, home
and night. 20. Today replay on the phone. 21. A `lite` surface profile for
a second screen.

**Definition of done for every PR:** `npm test` green, the screenshot diff
reviewed, no new `setInterval` in components (subscribe to state instead),
and no new WS `type` outside `src/protocol/`.

---

## 9. Risks and open questions

- **Static adapter switch.** Confirm that no `src/routes/api/*` endpoint
  depends on SvelteKit server features before step 5.
- **Data migration.** The ledger importer must be idempotent, and the old
  files stay read-only for one release so you can roll back.
- **Distance tiers on a wall with a record player in front.** The webcam
  may read someone at the deck as "near". Calibrate per spot (the senses
  already support spots) before turning tiers on by default.
- **Event log size and privacy.** Rotate daily, keep 14 days, and redact on
  export. Transcripts are opt-in.
- **Decided (2026-10-15):**
  1. Agents become little characters (Claude, Cursor, Gemini) that rise
     from the bottom edge with their question, instead of a view you have to
     be on. The design variants are being chosen; the Agents view stays
     until then.
  2. Guest mode never turns on by itself. It's a switch on the phone.
  3. No second screen planned. Surface profiles stay a flag.
