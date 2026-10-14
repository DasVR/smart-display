# When the panel is on

The wall turns its panel on and off by itself, on its own schedule for **each
day of the week**. Set it from the phone: **Night** tab (`/remote#night`) →
**Schedule**.

## Each day

Every day has one of three settings, picked from the menu at the end of its
row:

| Setting | What happens |
| --- | --- |
| **Times** | On at the first time, off at the second |
| **On all day** | On from midnight to midnight |
| **Off all day** | Off from midnight to midnight |

An off time earlier than the on time means **after midnight**: Friday
8:00 AM to 1:00 AM stays on until 1 AM Saturday morning. That late night
belongs to Friday, so Saturday's own on time still counts.

**Copying.** Tap a day's name to pick it, then **Copy … to Weekdays**,
**Weekend** or **Every day**. Today's name is brighter.

The header shows what happens next: "Off tonight at 10:30 PM", "On tomorrow at
6 AM", "On Sat at 8 AM". When you've turned the panel on or off by hand, it
also says so ("Held on").

## Accurate

- **It checks what the panel *should* be, not just the moment it changes.**
  About every 15 seconds the server works out whether the panel should be on
  right now and corrects it if not. A restart, a missed check, the kiosk being
  busy at 10:30 sharp, or a daylight-saving jump can't leave it in the wrong
  state. It catches up on the next check.
- **On the wall's clock** (`America/New_York` unless you set `timeZone`, or
  `DISPLAY_TZ`), not the server's.
- **Daylight saving.** On the night the clocks spring forward, an on time of
  2:30 AM (which never happens) is treated as passed at 3:00. On the night they
  fall back, 1:00 to 2:00 AM happens twice, so an on or off time inside that
  hour happens twice too (off at 1:30, briefly on again at 1:00, off again at
  1:30). Times outside that hour aren't affected.

## Turning it on or off by hand

The power button on the phone, "goodnight" / "good morning" to Siri, or the
Action button **hold** the panel that way until the schedule next changes its
mind. Then the schedule takes over again. Editing the schedule keeps your
hold. Switching **Auto schedule** off turns the panel on and leaves it to you;
switching it back on follows the schedule straight away.

The wall can also turn itself on for something that needs you (a timer, a
warning; see [attention.md](attention.md)) and back off afterwards. **Morning
wake** turns it on early, with the morning briefing, when you get up: the
webcam sees you go from lying down to upright ([senses.md](senses.md)), or
Home Assistant sends the `phone_wake` webhook. Only in the off time, after
5 AM, and before that day's on time (or before noon on a day that's off all
day). The schedule field is still called `wakeOnPhone`, so old files keep it.

Bluetooth proximity wake is gone: the webcam sees who's in the room (walking
in turns the panel on, never at night), so the wall no longer asks a phone
for its signal strength every 8 seconds. An old schedule file's
`wakeOnProximity`, `proximityDevice` and `proximityMeters` drop off the next
time it's saved.

## API

`GET /api/display` returns `{ hdmi, schedule, quiet, next, hold, … }`. `next`
is `{ at, to: 'on' | 'off' }`, or `null` when nothing changes this week.
`schedule.week` is seven days, Sunday first:

```json
{ "mode": "times", "on": "06:00", "off": "22:30" }
```

`POST /api/display` takes any of:

| Body | Does |
| --- | --- |
| `{ "day": "fri", "on": "08:00", "off": "01:00" }` | one day (name or 0–6; any of `mode`, `on`, `off`) |
| `{ "day": 0, "mode": "off" }` | Sunday off all day |
| `{ "copyDay": 1, "to": "weekdays" }` | copy Monday to Mon–Fri (`weekend`, `all`, or a list of days) |
| `{ "week": [ …seven days… ] }` | the whole week |
| `{ "enabled": false }` | pause the schedule |
| `{ "offAt": "22:30", "onAt": "06:00", "days": [5, 6] }` | the old single window, still understood: it sets every day |

## Settings from before

The old schedule (one off time and one on time, for the nights you picked)
is converted to the week the first time it loads. A picked night goes off at
the off time and back on at the next morning's on time; a night you didn't
pick stays on straight through. Nothing to redo. The same goes for the
`DISPLAY_OFF_AT`, `DISPLAY_ON_AT` and `DISPLAY_SCHEDULE_DAYS` environment
variables. `DISPLAY_WEEK` (the week as JSON) sets it per day from the
environment.
