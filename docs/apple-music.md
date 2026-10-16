# Apple Music on the wall

"Hey wall, play Bohemian Rhapsody." "Play some jazz." "Put on my workout
playlist." The wall plays Apple Music itself, through its own speakers, with
no phone involved. Lyrics, the record deck and the island pick it up like any
other music.

It is a slim, headless take on what Cider does: Apple's own web player
(MusicKit, on music.apple.com) running in Google Chrome with no window,
driven by voice instead of a mouse.

## What you can say

| You say | It plays |
| --- | --- |
| play bohemian rhapsody / play blinding lights by the weeknd | the best match: a song, album, artist or playlist |
| play taylor swift / play songs by queen | that artist's top songs, shuffled |
| play the album rumours / play abbey road album | the album |
| play the chill vibes playlist | an Apple Music playlist |
| play my workout playlist | a playlist from your library (else the catalog) |
| play some jazz / play lofi music | a station or playlist for that genre |
| play jazz radio | that station |
| play something / play some music | whatever you played last |
| pause / play / next song / previous song | the usual, sent to Apple Music while it's what's playing |

"Play" on its own, "play the music" and "resume" still just resume.
"Play with the dog at 5" is still a chore. See
[voice-commands.md](voice-commands.md).

When your phone starts AirPlay or Bluetooth music, the phone wins: the
wall's player pauses and the phone's song shows.

## Sound quality, honestly

- **The stream is 256 kbps AAC.** That is the best any Apple Music player on
  Linux gets, Cider included. Apple's lossless and hi-res lossless use
  FairPlay, which only runs on Apple's own devices, so a browser (or Cider,
  Sidra, Music Assistant) can't decrypt them.
- **Lossless is still available through AirPlay.** Play from an iPhone, iPad
  or Mac to the wall: AirPlay carries Apple Lossless at CD quality
  (16-bit/44.1 kHz) to shairport-sync. That route is unchanged.
- **The enhancer** (on by default) is the wall's own small Web Audio chain
  (`src/lib/server/appleMusicEnhancer.js`), in the spirit of Cider's Audio Lab
  but not its code. It gives back some of the air and weight an AAC encoder
  trims: low shelf +1.5 dB at 105 Hz, a −0.8 dB dip at 2.8 kHz, high shelf
  +2 dB at 9.5 kHz, with 2 dB of headroom and a limiter at −1 dBFS so nothing
  clips. Off is a clean bypass.

  If protected audio ever comes through it silent, the player notices
  (six seconds of silence while playing), turns the enhancer off, restarts,
  and carries on from the same second.

## Set up

### 1. Google Chrome

Apple Music streams are Widevine-protected AAC. Only Google's Chrome build
has Widevine and the AAC decoder. Open Chromium, Ubuntu's snap Chromium and
`chrome-headless-shell` have neither, and fail Apple's DRM check (measured,
see below).

```bash
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo apt install ./google-chrome-stable_current_amd64.deb
```

The wall looks in `/opt/google/chrome/chrome`, `/usr/bin/google-chrome-stable`
and `/usr/bin/google-chrome`; `APPLE_MUSIC_CHROME` points elsewhere. It is
separate from the kiosk's own browser and never shows on screen.

### 2. Sign in, once

```bash
npm run apple-music:login
```

It opens music.apple.com headless and starts Apple's sign-in. Sign in from
your laptop through Chrome's remote inspector:

1. `ssh -L 9222:127.0.0.1:9222 <the wall>`
2. On the laptop, open `chrome://inspect/#devices`, **Configure…**, add
   `localhost:9222`.
3. Click **inspect** on the Apple sign-in page (`authorize.music.apple.com`)
   and sign in, 2FA code
   included.

On a machine with a desktop, `npm run apple-music:login -- --headed` opens a
real window instead. The sign-in lives in `data/apple-music-profile`
(gitignored). Apple asks for it again about every six months; run this again
then. The script asks the server to close its own player first, since they
share the profile.

### 3. Storefront

`APPLE_MUSIC_STOREFRONT` (default `us`) is used until you're signed in; after
that your account's storefront is.

## How slim it is

Chrome starts on the first "play", takes about 6 seconds the first time, and
closes itself after 20 minutes without music. While it runs:

| Measured on music.apple.com | Widevine | AAC | Memory (PSS) |
| --- | --- | --- | --- |
| Open Chromium, `--headless` | no | no | n/a |
| `chrome-headless-shell` | no | no | n/a |
| Google Chrome, headless, stock | yes | yes | ~540 MB |
| Google Chrome, headless, the wall's flags | yes | yes | ~480 MB |

The flags: no GPU process, low-end-device mode, one renderer, no site
isolation, no extensions, images and fonts never downloaded, a capped JS
heap. Most of what's left is Chrome itself: a bare page with only MusicKit
measured ~463 MB against ~476 MB for Apple's full web app, so the wall keeps
Apple's app (it stays signed in and tracks Apple's changes for free).

**Going lower.** [vibez](https://github.com/simonepelosi/vibez) (MIT, Go) has
an open pull request for a browserless backend: Chrome's Widevine library
loaded directly, decrypted AAC into GStreamer, about 15 MB by its author's
count. It isn't merged and can't seek yet. When it lands, it can replace
Chrome here behind the same `play` / `control` / `track` interface.

Other routes looked at: Cider 1 (AGPL, archived) and Cider 2 (closed, paid),
[Sidra](https://github.com/wimpysworld/sidra) (CastLabs Electron, a desktop
window), and Music Assistant (needs copied Widevine keys). All of them play
the same 256 kbps stream.

## API

Same Bearer token as `/api/tasks`.

| | |
| --- | --- |
| `GET /api/apple-music` | `{ chrome, running, signedIn, enhance, enhancer, nowPlaying }` |
| `POST /api/apple-music` | `{ enhance: true \| false }` |
| `POST /api/apple-music/play` | `{ text: "some jazz" }` or `{ term, kind }` → `{ ok, say }` |
| `POST /api/apple-music/control` | `{ action: "pause" \| "play" \| "next" \| "previous" }` |
| `POST /api/apple-music/release` | close the player (the login script uses it) |

Code: `src/lib/musicRequest.js` (understanding "play …" and choosing the
result), `src/lib/server/appleMusic.js` (the player),
`src/lib/server/appleMusicEnhancer.js` (the enhancer),
`scripts/apple-music-login.mjs`; tests in `tests/music-request.test.mjs` and
`tests/apple-music.test.mjs`.
