# Agent approvals: Allow / Deny from the wall

When a coding agent stops to ask "may I run this?", the wall raises a big
card with the command and two buttons, and the phone remote shows the same
card above its tab bar. The first tap answers. If nobody answers before it
expires, the agent asks in its own terminal as usual. The wall can save you
a trip, but it can never leave a run stuck.

## Claude Code

`hooks/display-approve.mjs` is a `PermissionRequest` hook, which fires at
exactly the moment Claude Code would otherwise stop and ask you. In
`.claude/settings.json`:

```json
{
  "hooks": {
    "PermissionRequest": [{
      "hooks": [{
        "type": "command",
        "command": "DISPLAY_HOST=http://<display-host>:3000 node /path/to/smart-display/hooks/display-approve.mjs",
        "timeout": 120
      }]
    }]
  }
}
```

| Env | Default | |
| --- | --- | --- |
| `DISPLAY_HOST` | `http://localhost:3000` | where the display lives |
| `DISPLAY_API_TOKEN` | | if you ran `npm run api-token` |
| `DISPLAY_SOURCE` | `Claude Code` | the name on the card |
| `DISPLAY_APPROVAL_TIMEOUT` | `110` | seconds; keep it under the hook's `timeout` |

If the display answers, the hook prints Claude Code's allow or deny
decision. If it times out or the display can't be reached, it prints
nothing and Claude Code falls back to asking in the terminal. It also works
as a `PreToolUse` hook, where it answers with `permissionDecision`.

## Any other agent: the API

Same auth as `/api/tasks`: open on the LAN until you set a token.

| Method | Path | Body | |
| --- | --- | --- | --- |
| POST | `/api/approvals` | `{ source, title?, tool?, detail?, cwd?, timeout? }` | Ask. Add `?wait=1` to hold the request open until it's decided |
| GET | `/api/approvals` | | Pending requests |
| GET | `/api/approvals/:id` | | One request. `?wait=1` long-polls for the decision |
| POST | `/api/approvals/:id` | `{ "decision": "allow" \| "deny" }` | Answer it |
| DELETE | `/api/approvals/:id` | | Withdraw it (you answered in the terminal) |

- `timeout` is in seconds, 15 to 900, and defaults to 180.
- An answer looks like `{ id, status, decision, decidedBy }`.
  - `status` is `pending`, `allow`, `deny`, `timeout` or `withdrawn`.
  - `decision` is only set for `allow` and `deny`.
- If the caller hangs up while waiting with `?wait=1`, the request is
  withdrawn and the card goes away.

```bash
# ask, and wait up to 2 minutes for a tap
curl -s -X POST 'http://<display-host>:3000/api/approvals?wait=1' \
  -H 'Content-Type: application/json' \
  -d '{"source":"Hermes","title":"Deploy to prod?","detail":"fly deploy --app web","timeout":120}'
```

## Security

Approving a command from the wall is as strong as whoever can reach the wall.

- The kiosk and the phone remote answer over the `/ws` socket, which, like
  the rest of this server, trusts the LAN.
- Set a token (`npm run api-token`) so that other machines on the network
  can't answer through the HTTP API either.
- Use this only on a home network you trust, and keep your agents' own
  allow and deny rules for anything destructive.
- Requests are kept in memory only, and settled ones are dropped after 10
  minutes.
