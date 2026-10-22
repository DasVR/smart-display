---
name: agent-status-setup
description: Set up live agent status on the smart display, so its Agents view and pixel characters show what Claude Code and Cursor are doing (working, needs you, finished), on this computer and in the cloud. Use when the user asks to connect Claude Code or Cursor to the wall, set up agent status, "make the wall show my agents", hook up Claude Code on the web or Cursor cloud agents, add the hooks to another repo, check why the wall isn't showing an agent, or remove it again.
---

# Set up agent status on the wall

The wall learns what agents are doing from their own hooks: each step of a
session runs `hooks/wall-status.mjs`, which posts a few fields to the wall's
`POST /api/agents/hook`. `scripts/setup-agent-status.mjs`
(`npm run agent-status`) does every file edit. Use it and don't hand-edit the
settings files: it merges with what's there, never doubles up, and can undo
itself. Background for anything unclear: `docs/agent-status.md`.

Work through the steps in order. Ask only what you can't find out. Tell the
user in plain words what you changed and what's left for them.

## 1. Find the wall

Try these in order, and use the first that answers
(`npm run agent-status -- --check --url <candidate>`):

1. a URL the user gave
2. `WALL_URL` or `DISPLAY_HOST` in the environment
3. one already saved: `~/.config/smart-display/wall-status.json` (`url`)
4. `http://localhost:3000`, if this machine is the wall (this checkout has a
   `data/` folder and `src/ws-server.js` is running)

If none answers, ask the user for the wall's address (`http://<name or IP>:3000`;
the phone's Settings page is served from it). The check's message says what
went wrong: unreachable, wants a token, or too old (update the wall to master
and restart it).

## 2. The token

- On the wall itself the script finds `data/api-token` on its own.
- From another computer: if the check says it needs a token, ask the user to
  run `npm run api-token` on the wall (or read `data/api-token` there) and give
  it to you. Pass it with `--token`. Never print the token back, put it in a
  commit, or write it anywhere else; the script stores it in
  `~/.config/smart-display/wall-status.json`, readable only by the user.
- If the wall has no token, none is needed, but say once that anyone on the
  network can then post to it, and that `npm run api-token` on the wall locks
  it.

## 3. Ask two things (one question each, with a default)

- **Show what you type on the wall?** Default yes: the card shows the start of
  the prompt. No adds `--no-prompts`, so it only says "Thinking". Mention that
  Guest mode hides the Agents view anyway.
- **Which tools?** Default: both, if both are installed (`~/.claude` and
  `~/.cursor` exist). Otherwise only the one that is (`--only claude` or
  `--only cursor`).

## 4. Install on this computer

Show the plan first, then do it:

```bash
npm run agent-status -- --url <wall> [--token <token>] [--no-prompts] [--only claude|cursor] --dry-run
npm run agent-status -- --url <wall> [--token <token>] [--no-prompts] [--only claude|cursor]
```

It copies the hook script to `~/.config/smart-display/`, so moving this
checkout won't break it. It adds hooks to `~/.claude/settings.json` and
`~/.cursor/hooks.json`, and checks the wall. If a settings file isn't valid
JSON, it stops and leaves the file alone: show the user the error, and fix the
file only if they want you to.

## 5. Prove it on the wall

Send one fake run through the installed script, and ask the user to look at
the wall (the Claude card goes to working, then finished, with a chime):

```bash
S=~/.config/smart-display/wall-status.mjs
echo '{"hook_event_name":"UserPromptSubmit","session_id":"setup-test","cwd":"'"$PWD"'","prompt":"Testing the wall"}' | node "$S" claude
sleep 4
echo '{"hook_event_name":"Stop","session_id":"setup-test"}' | node "$S" claude
echo '{"hook_event_name":"SessionEnd","session_id":"setup-test"}' | node "$S" claude
```

For Cursor, the same with `"conversation_id"`, `beforeSubmitPrompt` /
`stop` / `sessionEnd`, and `cursor`. `curl -s <wall>/api/agents/sessions`
(with `-H "Authorization: Bearer <token>"` if needed) shows what the wall
knows. Then: open sessions keep their old hooks until restarted, so restart
Claude Code and Cursor.

## 6. The cloud (only if they use it; ask)

**Claude Code on the web** runs only the hooks in the repository's own
`.claude/settings.json`, never `~/.claude`. Three things, and the user has to
do the last two:

1. Hooks in each repo they use in the cloud. This repo has them. For another:
   `npm run agent-status -- --repo <path to that repo>` (the hooks, plus the
   `report_progress` tool, its skill and its Cursor rule, so the agents say
   what they're working on), then commit what it
   wrote there (`hooks/wall-status.mjs`, `.claude/settings.json`,
   `.cursor/hooks.json`). Don't push to their repos without asking.
2. The wall reachable from the internet, by an `https://` address: Tailscale
   Funnel (`tailscale funnel 3000`) or a Cloudflare Tunnel, set up on the wall.
   Make sure the wall has a token first (step 2), because the hook endpoint is
   then public.
3. In the cloud environment's settings on claude.ai/code: add the environment
   variables `WALL_URL=<the https address>` and `WALL_TOKEN=<token>`, and allow
   the tunnel's host in the network policy. If you're running in a cloud
   session yourself, read the environment docs (`read_documentation`) and point
   the user to the right settings page rather than guessing.

**Cursor cloud agents** come from Cursor's API, so the wall needs nothing
from the internet. On the wall, with a key from Cursor Dashboard → API Keys:

```bash
npm run agent-status -- --cursor-key <key>   # empty string removes it
```

The wall picks it up within a minute; the key is stored in `data/cursor-api-key`,
readable only by the wall's user. If you're not on the wall, give the user that
command to run there.

For Claude Code, the `wall-status` plugin is the other way in
(`/plugin marketplace add dasvr/smart-display`, then
`/plugin install wall-status@smart-display`; `plugins/wall-status/README.md`
has the repo setting that turns it on for every cloud session there).

## Undo

```bash
npm run agent-status -- --uninstall [--only claude|cursor]
npm run agent-status -- --repo <path> --uninstall
```

It removes only what it added; everything else in the settings stays.

## When it isn't showing

- `npm run agent-status -- --check`: reachable? token?
- Is the session new? Hooks load when a session starts.
- Run the step 5 test. If the test works but real sessions don't show, check
  that `~/.claude/settings.json` has `wall-status.mjs` under `hooks` (and that
  a project setting doesn't turn hooks off).
- In the cloud: `WALL_URL` set in the environment, its host allowed by the
  network policy, and the hooks committed in that repo.
- A session that went quiet for 15 minutes stops showing as working, by design.
