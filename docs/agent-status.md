# Seeing what Claude Code and Cursor are doing

The wall shows each coding agent's status as it happens, on your laptop or in
the cloud:

| The session | On the wall |
| --- | --- |
| you sent a prompt, tools are running | its character sits at the laptop and types; the card shows the tool (`Bash: npm test`) and what you asked |
| it's asking you something (permission, a question) | the character stands with a "?"; the card says **Needs you** and what it's asking |
| the turn is over | **Finished**, with what you asked; a chime and a toast like `/api/notify` |
| it stopped on an error | **Stopped**, with the error |
| it went quiet for 15 minutes without finishing (a closed laptop, a reclaimed container) | it stops counting as working, without a "finished" toast |

## The Agents view

Every session is its own **lane**: two Claude Code terminals, a Claude Code
web session and a Cursor cloud agent are four lanes, with Hermes and Ollama
when they're at it. Each lane is one line of who and where
(`Claude Code  smart-display · cloud  24m`), a **headline** (what the agent
says it's doing, else what you asked), the **step** it's on in plain words
(`Running npm test`), and a dithered progress bar when it knows how far along
it is (`3 of 6`). A lane that needs you is tinted and goes first; working
lanes keep their order (longest-running first); finished ones stay dimmed for
30 minutes.

It always fits the screen, with no scrolling: one lane gets the whole stage,
two or three stack, four to six go in two columns, and anything past six is
counted on the summary line ("2 more not shown"). Beside the lanes are the
box's CPU and RAM as two dithered bars that dissolve between levels; nothing
else about the machine. Code: `src/lib/agentBoard.js` (tests
`tests/agent-board.test.mjs`), `src/lib/components/AgentsHub.svelte`,
`src/lib/components/DitherMeter.svelte`. `/?demo=agents&lanes=1…8` shows each
layout with made-up sessions.

The roster (the island, the bottom bar's characters) still has one entry per
agent: whichever session needs you, else the latest one working.

## Saying what it's doing

The hooks say *that* a session is working and which tool is running. Two
things say *what* it's working on:

- **Claude Code's to-do list.** When it plans with TodoWrite, the wall reads
  the current item as the step and counts the done ones (`3 of 6`). Nothing
  to set up.
- **The report tool.** [`hooks/wall-report.mjs`](../hooks/wall-report.mjs) is
  an MCP server with one tool, `report_progress` (`summary`, `step`, `done`,
  `total`, `phase`, `link`), and also works from a shell:

  ```bash
  node hooks/wall-report.mjs "Fix the flaky weather test" --step "Reproducing it" --done 1 --total 4
  node hooks/wall-report.mjs --phase done --link https://github.com/…/pull/9
  ```

  The `wall-report` skill (Claude Code, [`.claude/skills/wall-report`](../.claude/skills/wall-report/SKILL.md))
  and rule (Cursor, [`.cursor/rules/wall-report.mdc`](../.cursor/rules/wall-report.mdc))
  tell the agent when to call it: at the start of a task, at milestones, when
  it needs you, and when it's done, with the pull request. This repo's
  `.mcp.json` and `.cursor/mcp.json` register it. It finds its session from
  a note the hooks leave (or `WALL_SESSION_ID`), and never fails the agent's
  work: with no wall set up it just says so.

## The plugin (Claude Code) and the kit (Cursor)

[`plugins/wall-status`](../plugins/wall-status/README.md) packs all of it, the
hooks, the report tool and the skill, as a Claude Code plugin:

```
/plugin marketplace add dasvr/smart-display
/plugin install wall-status@smart-display
```

For every cloud session in another repository, add to its `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": { "smart-display": { "source": { "source": "github", "repo": "dasvr/smart-display" } } },
  "enabledPlugins": { "wall-status@smart-display": true }
}
```

Cursor has no plugins, but reads hooks, MCP servers and rules from the
repository, so `npm run agent-status -- --repo ../my-app` copies the same kit
into it (and the Claude Code equivalents, so either works there). Either way,
the cloud environment still needs `WALL_URL` / `WALL_TOKEN` and the wall
reachable (below).

Answering a question still happens where the session runs. For Allow / Deny on
the wall itself, add the approval hook too ([`approvals.md`](approvals.md)).

## Quick setup

The wall serves this same setup as a page: `http://<wall>:3000/connect` (plain
markdown for an agent at `/connect.md`), with its address already filled in.

Ask Claude Code in this repo to "set up agent status" (the
[`agent-status-setup`](../.claude/skills/agent-status-setup/SKILL.md) skill
walks through all of the below), or run it yourself:

```bash
npm run agent-status -- --url http://wall.local:3000 [--token …] [--no-prompts]
npm run agent-status -- --check                  # is it reaching the wall?
npm run agent-status -- --repo ../my-app         # hooks, report tool, skill and rule into another repo
npm run agent-status -- --cursor-key <key>       # on the wall: follow Cursor's cloud agents
npm run agent-status -- --uninstall              # take it all out again
```

On your computer it copies the hook script to `~/.config/smart-display/`,
saves the wall's address and token beside it in `wall-status.json` (readable
only by you), and adds the hooks to `~/.claude/settings.json` and
`~/.cursor/hooks.json`. It keeps everything already in those files, running
it again changes nothing, and `--uninstall` takes out only what it added. The
sections below are what it does, if you'd rather do it by hand.

## How it works

Both tools run **hooks** at each step of a session and hand them the step as
JSON. [`hooks/wall-status.mjs`](../hooks/wall-status.mjs) forwards a few fields
of it (the step, the session id, the folder, the tool and its command or file,
what you typed) to `POST /api/agents/hook`. It never sends tool output, file
contents or transcripts. It always exits 0 within 3 seconds, so it can't hold up
or block the agent, and with no `WALL_URL` set it does nothing.

| Setting | |
| --- | --- |
| `WALL_URL` | the wall, e.g. `http://wall.local:3000`, or your tunnel's `https://` address for cloud sessions |
| `WALL_TOKEN` | the wall's API token (`data/api-token`, or `DISPLAY_API_TOKEN`). Needed from anywhere but the wall itself |
| `WALL_SEND_PROMPT=0` | keep what you typed off the wall; the card just says "Thinking" |
| `WALL_REMOTE=1` | mark sessions as cloud ones. Claude Code on the web is spotted by itself (`CLAUDE_CODE_REMOTE`) |

Without those variables, the script reads `~/.config/smart-display/wall-status.json`
(`{ "url", "token", "sendPrompt" }`). Where both are set, the environment wins.

The server reads the steps in [`src/lib/agentHooks.js`](../src/lib/agentHooks.js)
and keeps the sessions in
[`src/lib/server/agentStatusHub.js`](../src/lib/server/agentStatusHub.js)
(tests: `tests/agent-hooks.test.mjs`).

## Claude Code on your computer

Add to `~/.claude/settings.json` (all your projects), with your paths:

```json
{
  "env": { "WALL_URL": "http://wall.local:3000", "WALL_TOKEN": "…" },
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node /path/to/smart-display/hooks/wall-status.mjs claude", "async": true, "timeout": 5 }] }],
    "PreToolUse":       [{ "hooks": [{ "type": "command", "command": "node /path/to/smart-display/hooks/wall-status.mjs claude", "async": true, "timeout": 5 }] }],
    "Notification":     [{ "hooks": [{ "type": "command", "command": "node /path/to/smart-display/hooks/wall-status.mjs claude", "async": true, "timeout": 5 }] }],
    "Stop":             [{ "hooks": [{ "type": "command", "command": "node /path/to/smart-display/hooks/wall-status.mjs claude", "async": true, "timeout": 5 }] }],
    "StopFailure":      [{ "hooks": [{ "type": "command", "command": "node /path/to/smart-display/hooks/wall-status.mjs claude", "async": true, "timeout": 5 }] }],
    "SessionEnd":       [{ "hooks": [{ "type": "command", "command": "node /path/to/smart-display/hooks/wall-status.mjs claude", "async": true, "timeout": 5 }] }]
  }
}
```

`async` runs the hook in the background, so nothing waits on the wall.
Claude Code can also POST a hook's JSON itself (`"type": "http"`), with no
script. That works too (`"url": "http://wall.local:3000/api/agents/hook?agent=claude"`),
but it sends the whole step, tool output included.

## Claude Code on the web

There's no public API that lists your claude.ai/code sessions or their state
yet ([anthropics/claude-code#35607](https://github.com/anthropics/claude-code/issues/35607)
asks for one), so the sessions tell the wall themselves, through the same hooks:

1. **The hooks have to be in the repository.** Cloud sessions run the hooks
   in the repo's `.claude/settings.json` (and plugins and managed settings),
   not your own `~/.claude/settings.json`. This repo already has them
   ([`.claude/settings.json`](../.claude/settings.json)). For another repo,
   copy that block and `hooks/wall-status.mjs` into it, pointing the command at
   `"$CLAUDE_PROJECT_DIR"/hooks/wall-status.mjs`.
2. **The wall has to be reachable from the internet.** A
   [Tailscale Funnel](https://tailscale.com/kb/1223/funnel) or a
   [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
   to port 3000 gives it an `https://` address. The hook endpoint needs the
   token from outside, so only your sessions can post.
3. **Tell the cloud environment where the wall is.** In the environment's
   settings on claude.ai/code, add `WALL_URL` (the tunnel's address) and
   `WALL_TOKEN` as environment variables, and allow the tunnel's host in the
   network policy, or the request is refused.

Cloud sessions show "cloud" on their card.

Another way, not built here: Claude Code's OpenTelemetry export
(`CLAUDE_CODE_ENABLE_TELEMETRY=1` with an OTLP logs endpoint) also works in
cloud sessions and carries `ccr.session.id`, but it reports usage (prompts,
tool results, API calls), not "waiting for you", and needs a collector.

## Cursor on your computer

Cursor's hooks run commands (there's no HTTP type). For every project, put this
in `~/.cursor/hooks.json`, with your path, and set `WALL_URL` / `WALL_TOKEN`
in the environment Cursor starts with:

```json
{
  "version": 1,
  "hooks": {
    "beforeSubmitPrompt":  [{ "command": "node /path/to/smart-display/hooks/wall-status.mjs cursor" }],
    "afterShellExecution": [{ "command": "node /path/to/smart-display/hooks/wall-status.mjs cursor" }],
    "afterFileEdit":       [{ "command": "node /path/to/smart-display/hooks/wall-status.mjs cursor" }],
    "afterAgentResponse":  [{ "command": "node /path/to/smart-display/hooks/wall-status.mjs cursor" }],
    "stop":                [{ "command": "node /path/to/smart-display/hooks/wall-status.mjs cursor" }],
    "sessionEnd":          [{ "command": "node /path/to/smart-display/hooks/wall-status.mjs cursor" }]
  }
}
```

This repo's own [`.cursor/hooks.json`](../.cursor/hooks.json) does the same for
work on the wall. `stop` carries `completed`, `aborted` or `error`, so a
failed run shows as **Stopped**. Cursor waits on `beforeSubmitPrompt`'s answer;
the script always lets the prompt through at once.

## Cursor's cloud agents

Give the wall a Cursor API key (Cursor Dashboard → API Keys; a user or
service-account key): `npm run agent-status -- --cursor-key <key>` on the wall
saves it to `data/cursor-api-key`, or set `CURSOR_API_KEY` in its environment.
The wall then asks Cursor's
[Cloud Agents API](https://cursor.com/docs/cloud-agent/api/endpoints)
(`GET /v1/agents`) every minute. An agent that's `ACTIVE` is working, `IDLE`
has finished; archived ones are left out. Each shows its name on the card,
marked "cloud". Hooks in a repo's `.cursor/hooks.json` also run in cloud
agents, if the wall is reachable from there (see the tunnel above).

## Privacy

- Only the fields above leave the machine, and `WALL_SEND_PROMPT=0` keeps
  your prompts off too.
- Sessions live in memory only; the wall forgets them 6 hours after their
  last step.
- Guest mode hides the Agents view and the questions' details.

## API

```
POST /api/agents/hook?agent=claude|cursor[&remote=1]
     body: the hook's JSON. Local, or Authorization: Bearer <token>.
     → { ok: true, read: "working" | "waiting" | "done" | "error" | "ended" | null }
     A report: { "hook_event_name": "WallReport", "session_id", "summary", "step",
     "done", "total", "phase", "link" } (hooks/wall-report.mjs sends it)

GET  /api/agents/sessions
     → { sessions: [...], agents: { claude: {...}, cursor: {...} }, cursorCloud }
```

`agent` can be left out: the shape of the JSON tells Claude Code
(`session_id`, `PascalCase` events) from Cursor (`conversation_id`,
`camelCase` events). `X-Wall-Remote: true` works in place of `remote=1`.
The older `POST /api/notify` with `"event": "working" | "done"`
([`notify-endpoint.md`](notify-endpoint.md)) still works.

## Sources

- Claude Code hooks: https://code.claude.com/docs/en/hooks
- Claude Code monitoring (OpenTelemetry): https://code.claude.com/docs/en/monitoring-usage
- Claude Code on the web: https://code.claude.com/docs/en/claude-code-on-the-web
- Cursor hooks: https://cursor.com/docs/hooks
- Cursor Cloud Agents API: https://cursor.com/docs/cloud-agent/api/endpoints
