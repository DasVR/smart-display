# Pairing phones

Pair a phone with the wall the way you'd pair an Apple TV remote: the wall
shows a six-digit code, and you type it on the phone. The phone keeps a
device token after that, so the wall knows which phone is which. Later,
"remind me" can mean you.

Phone: **Home → Phones** (`/remote/pair`).

## Pair a phone

1. On the phone, open **Home → Phones**, give the phone a name, and tap
   **Show a code on the wall**.
2. The wall shows the code for two minutes.
3. Type it on the phone. The wall says "<name> is paired".

## Only paired phones

Pairing changes nothing for other phones until a paired phone turns on
**Only paired phones**. From then on, a phone that isn't paired:

- gets no tasks, approvals, music or anything else over `/ws`;
- can't control the wall;
- is sent to the pair page instead.

Phones already connected that aren't paired are disconnected the moment
you turn it on.

The wall's own screen always works, whether it opens the page by
`localhost` or by one of its own addresses. You can't lock the kiosk out
of itself.

From the same page you can see every paired phone, when it was last seen,
and remove any of them. A removed phone stops working at once.

## If you lose every phone

On the kiosk, either:

- set `DISPLAY_REQUIRE_PAIRING=0` in the service's environment and restart
  it (the switch is then ignored), or
- delete `data/pairing.json`.

The wall's screen can still start pairing a new phone in the meantime.

## How it's kept safe

- A code works once and for two minutes, and only the wall's screen ever
  receives it.
- Five wrong guesses use up a code. Ten wrong guesses in ten minutes, across
  all codes, block pairing for ten minutes.
- Tokens are 32 random bytes. `data/devices.json` keeps only their
  SHA-256, and it is gitignored and written owner-only.
- A phone sends its token as `?token=` on the `/ws` URL. Use the
  Tailscale address away from home, so it stays inside your tailnet.

## What it doesn't cover yet

Pairing guards `/ws`, which is what the phone remote uses. The HTTP API
(`/api/tasks`, `/api/action`, `/api/voice`) is guarded by the API token
from `npm run api-token` instead, as before; see
[siri-shortcuts.md](siri-shortcuts.md).

If you put a reverse proxy in front of the wall (`tailscale serve`, nginx,
Caddy), every connection arrives from the proxy on the same machine and
looks like the wall's own screen, so "Only paired phones" can't tell
phones apart. Connect straight to the wall's port instead.
