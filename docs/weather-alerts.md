# Weather alerts

The wall's watches and warnings come straight from the **National Weather
Service** (`api.weather.gov`). For a US address that's the most accurate source
there is: the same alerts that set off phone emergency alerts, NOAA Weather
Radio and the TV crawl, published within about a minute of being issued.

## Fast

- The server checks for alerts at home every **30 seconds**, and every **15
  seconds** while a watch or warning is up (`src/lib/server/nwsWatch.js`).
- It asks with the last answer's ETag, so an unchanged feed is a tiny `304`.
  The API caches for 5 seconds, so this is well within its rules.
- A change goes straight to the wall and the phone over `/ws`
  (`{ "type": "weather-alerts", "alerts": [...] }`). It doesn't wait for the
  5-minute forecast refresh.
- Worst case from NWS issuing a warning to the wall ringing: about a minute
  for NWS to publish, plus up to 15 to 30 seconds.

## Accurate

- **For this address, not the county.** It asks for the alerts at the wall's
  point (`?point=lat,lon`). Storm-based warnings (tornado, severe
  thunderstorm, flash flood) come with their own polygon, so a warning for the
  far end of the county that doesn't cover home doesn't ring.
- **Only real ones.** Test and exercise messages and cancellations are
  dropped.
- **No repeats.** When NWS updates a warning (extends it, upgrades it), the
  update replaces the original rather than appearing as a second alert. A
  warning that's already ringing, or that you already answered, carries on as
  it was.
- **Ended means gone.** An alert past its end time goes, and the ringing stops
  by itself when NWS ends or cancels a warning.
- **A failed check isn't "all clear".** If NWS can't be reached, the wall keeps
  the last list (each alert still ends on time) and marks it stale after five
  minutes.
- **Who's asking.** NWS asks every app to identify itself. The wall sends a
  `User-Agent`. To put your own contact in it, set `NWS_USER_AGENT` in the
  service's environment, e.g. `(my wall, me@example.com)`.

## What each alert does

Alerts are sorted by what they ask of you, using the alert's own severity,
urgency and certainty fields (`src/lib/nwsAlerts.js`):

| Tier | Examples | On the wall |
| --- | --- | --- |
| **Act now** | Tornado, Severe Thunderstorm, Flash Flood, Extreme Wind, Hurricane, Tropical Storm, Storm Surge and Tsunami Warnings; Flash Flood Emergency; Evacuation Immediate; Shelter in Place; anything NWS marks Extreme | Rings until answered, wakes the panel even at night, the edge glows, the ticker runs (see [attention.md](attention.md)) |
| **Be ready** | Every watch (Tornado, Hurricane, Flood…); the slower warnings (Flood, High Wind, Coastal Flood, Heat); Special Weather Statements | One ping on the island |
| **Heads up** | Advisories and statements: Rip Current, Heat Advisory, Beach Hazards, Wind Advisory | The Weather view only |

The Weather view labels each alert *Act now*, *Be ready* or *Heads up*.

Before this, the tier came from keywords in the alert's name. A Tornado
*Watch* rang the wall like a warning, a Severe Thunderstorm *Warning* got only
an island ping, and a Rip Current Statement could sit on the island all day.

## Outside the US

`api.weather.gov` only covers the US and its territories. Elsewhere you'd swap
in your national weather service's CAP feed in `src/lib/server/nwsWatch.js`;
everything after `normalizeNws` stays the same.
