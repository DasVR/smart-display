# wall-status

Shows what Claude Code (and Cursor) are doing on the smart-display wall, from
your computer or the cloud: each step from the hooks, and what the agent is
working on in its own words (`report_progress`), with progress and the pull
request.

## Claude Code

```
/plugin marketplace add dasvr/smart-display
/plugin install wall-status@smart-display
```

Then set `WALL_URL` (and `WALL_TOKEN` from anywhere but the wall) in the
environment Claude Code runs in. For Claude Code on the web, add them to the
environment's settings on claude.ai/code and allow the wall's host in its
network policy; to have every cloud session in a repository use the plugin,
put this in that repository's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": { "smart-display": { "source": { "source": "github", "repo": "dasvr/smart-display" } } },
  "enabledPlugins": { "wall-status@smart-display": true }
}
```

## Cursor (and Cursor's cloud agents)

Cursor reads hooks, MCP servers and rules from the repository, so:

```bash
npm run agent-status -- --repo ../my-app
```

copies `hooks/wall-status.mjs` and `hooks/wall-report.mjs` into it and adds
`.cursor/hooks.json`, `.cursor/mcp.json` and `.cursor/rules/wall-report.mdc`
(and the Claude Code equivalents). The files it writes are in `cursor/` here.

Everything: [docs/agent-status.md](../../docs/agent-status.md).
