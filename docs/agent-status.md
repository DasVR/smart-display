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

Several sessions at once (two terminals, a web session, a cloud agent) are one
card per agent: whichever needs you, else the latest one working, with
"+2 more" on the card.

Answering a question still happens where the session runs. For Allow / Deny on
the wall itself, add the approval hook too ([`approvals.md`](approvals.md)).

## Quick setup

Ask Claude Code in this repo to "set up agent status" (the
[`agent-status-setup`](../.claude/skills/agent-status-setup/SKILL.md) skill
walks through all of the below), or run it yourself:

```bash
npm run agent-status -- --url http://wall.local:3000 [--token …] [--no-prompts]
npm run agent-status -- --check                  # is it reaching the wall?
npm run agent-status -- --repo ../my-app         # hooks into another repo, for its cloud sessions
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
