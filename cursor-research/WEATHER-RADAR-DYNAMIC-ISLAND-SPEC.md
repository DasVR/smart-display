# Weather / Radar / Dynamic Island — Smart Display Spec

**Goal:** Add a new "weather" view to the smart display plus a persistent **liquid Dynamic Island** that surfaces alerts, weather changes, and incoming rain predictions. Use lusion.co's transition DNA for view-to-view morphing, not scrolling.

**Repo:** `/home/das/projects/smart-display/`
**Stack:** SvelteKit 5, Tailwind v4, custom WebGL shaders, Node WS server
**Skills to load in Cursor:** `kiosk-dashboard-development`, `dark-native-web-ui`, `hallmark`, `sveltekit-package-verification`, `project-repo-verification`

---

## 1. Lusion.co transition DNA (adapted for views)

Lusion uses these techniques:
- **persistent WebGL canvas** as the "soul" of the page; DOM views are layered glass panels over it
- **type-as-object**: big headlines split into individual spans/letters that can transform independently
- **scene transitions** driven by GSAP/Three.js timeline, not scroll
- **masked reveals**: sections slide in with clip-path / alpha masks
- **hover micro-interactions**: 3D tilt, magnetic pull, chromatic edge

### How we adapt this for smart-display
- Keep the existing `LiquidMetalCanvas` as the continuous background layer.
- View switches should **not** hard-cut. Instead:
  - Fade out incoming view's content pieces with staggered letter/word motion.
  - Crossfade the WebGL uniform palette between views (clock = abyss, school = deep violet, dev = cyan shift, music = warm pulse, weather = storm blue).
  - Use CSS clip-path and scale transforms on the view-pane glass panels.
- The view tabs themselves should feel physical: active tab expands, others compress, spring physics.

### Implementation notes
- Use `gsap` or Svelte 5 `spring` + custom transition functions.
- Prefer GPU transforms (`transform`, `opacity`, `clip-path`) over layout properties.
- All motion must honor `prefers-reduced-motion`.

---

## 2. Dynamic Island for smart display

The current `DynamicIsland.svelte` exists but only shows now-playing. We want a true **island system**:

### States
1. **idle** — compact pill with status dot + `[SYS_OK]` or `[BUSY]`
2. **notification/alert** — expands horizontally to show a headline + subline, then auto-collapses
3. **weather alert** — shows incoming rain warning with radar icon and ETA
4. **now playing** — existing music state
5. **voice/AI** — listening/thinking/speaking state with ThinkingOrbs animation

### Behavior
- Island sits top-center, z-index above all views.
- Transitions between states with spring width/height morphing.
- Alerts queue up; each shows for 8s then collapses unless user swipes/taps to dismiss.
- Persistent subtle border beam / inner glow when in non-idle state.
- Use `viewTransition` for content crossfade inside the pill.

### Tech
- Svelte 5 runes + spring store.
- `clip-path` or `border-radius` morphing for the pill shape.
- Use existing `ThinkingOrbs` for AI state.
- Use existing `BorderBeam` concept (or build a CSS-only edge highlight).

---

## 3. Weather view

### Data sources (free, no API key required unless noted)

| Source | Data | Endpoint |
|--------|------|----------|
| Open-Meteo | current, hourly forecast, precipitation probability | `https://api.open-meteo.com/v1/forecast?latitude=27.9097&longitude=-82.7873&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,showers,weather_code,cloud_cover,wind_speed_10m&hourly=precipitation_probability,precipitation,weather_code&timezone=America/New_York` |
| RainViewer | radar tile URLs + nowcast frames | `https://api.rainviewer.com/public/weather-maps.json` |
| NWS (US) | alerts for Pinellas County | `https://api.weather.gov/alerts/active?area=FL` or point `https://api.weather.gov/alerts/active?point=27.9097,-82.7873` |
| Ambient Weather (cloud) | backyard station live data | `https://rt.ambientweather.net/v1/devices?applicationKey=...&apiKey=...` — **requires user keys** |

### Largo, FL coordinates
- Lat: `27.9097`
- Lon: `-82.7873`

### Radar tile rendering
- RainViewer returns a list of `past` and `nowcast` frames. Each frame has a URL template:
  - `https://tilecache.rainviewer.com/v2/radar/{ts}/256/{z}/{x}/{y}/2/1_1.png`
- Use Leaflet or a custom canvas/WebGL map.
- **Kiosk constraint:** avoid heavy DOM maps. Prefer a single canvas overlay with tiles drawn via 2D context or WebGL.
- Apply dithering to the radar image using a Bayer matrix in a fragment shader (same pattern as existing dithered fluid shader).
- Colorize radar intensity using RainViewer's blue→green→yellow→red→purple table.

### View layout
- **Left 35%** — current conditions: temp, feels like, humidity, wind, weather icon, backyard station data if available.
- **Center 50%** — dithered radar map with animated past→nowcast frames.
- **Right 15%** — upcoming alerts / prediction cards.
- **Bottom strip** — hourly precipitation probability chart (simple SVG/Canvas).

---

## 4. Local ML rain prediction

**Goal:** Predict "will it rain in 30 / 60 / 120 minutes?" using local data only.

### Features (all free)
- Recent Open-Meteo hourly precipitation probability (next 12 hours).
- Recent radar frame intensity trend at Largo (extract from RainViewer tiles).
- Backyard station: pressure trend, temp/humidity trend, wind gusts (Ambient Weather cloud or local).
- Weather.gov alerts currently active.

### Model choice
Given weak iGPU and CPU-only constraint, use a small **scikit-learn GradientBoostingRegressor** or **XGBoost CPU** (if deps allow). Do NOT use TimesFM — it is overkill and heavy for this.

Pipeline:
1. Poll Open-Meteo every 15 min, store in `~/.hermes/weather-history.jsonl`.
2. Poll RainViewer and compute mean radar intensity in a 15km radius around Largo every 10 min.
3. Train/refresh a small model every 6 hours on the last 7 days of data.
4. Output rain probability at 30, 60, 120 min.
5. If probability > threshold (e.g., 65%), trigger a Dynamic Island alert.

### Simpler fallback (build this first)
Before ML, implement a rule-based predictor:
- If Open-Meteo precipitation probability in the next hour > 70% → alert.
- If radar intensity trend is increasing over last 3 frames → alert.
- If NWS alert active for Pinellas → alert.

Then swap the predictor module for the sklearn model later without touching UI.

---

## 5. Backend additions

Add `/api/weather` endpoint in `src/routes/api/weather/+server.js`:

```js
export async function GET() {
  return json({
    current: { temp, feelsLike, humidity, wind, condition, icon },
    hourly: [...],
    radar: { frames: [{ ts, urlTemplate, nowcast: bool }], bounds, colorScheme },
    alerts: [...],
    prediction: { rain30min: 0.42, rain60min: 0.71, rain120min: 0.85, source: 'rule' },
    station: { temp, humidity, pressure, wind, rainRate, battery } // null if no keys
  });
}
```

Add `/api/weather/predict` (POST) for explicit model refresh/training, callable from cron.

Ambient Weather integration goes in `src/lib/server/hostData.js`:
- Read `AMBIENT_APPLICATION_KEY` and `AMBIENT_API_KEY` from `process.env` or `/home/das/.ambient_keys.json`.
- If keys missing, return `station: null` without crashing.

---

## 6. Frontend additions

### New files
- `src/lib/components/WeatherView.svelte` — full weather/radar view.
- `src/lib/components/RadarCanvas.svelte` — dithered radar tile compositor.
- `src/lib/components/DynamicIsland.svelte` — rewrite existing to support island states.
- `src/lib/components/PrecipChart.svelte` — tiny SVG precipitation probability chart.
- `src/lib/components/WeatherIcon.svelte` — WMO code → SVG icon.

### Store updates (`src/lib/stores.js`)
```js
export const weather = writable({ temp: '--', desc: '--' }); // already exists, expand
export const weatherDetail = writable(null);
export const weatherAlerts = writable([]);
export const rainPrediction = writable(null);
export const islandQueue = writable([]);
export const islandState = writable('idle');
```

### View system
Add `weather` to `viewNames` in `stores.js` and to the view tab list in `+page.svelte`.

---

## 7. Styling rules

- ONE accent family per view. Weather = storm blue `#4a90d9`, rain warning = coral `#fe6f69`.
- No emoji. Use SVG weather icons.
- Glass panels max 2 on screen. Radar map is full canvas; overlays use 1px translucent borders.
- All text uses existing fonts: JetBrains Mono display, Inter body.
- Dither everything: radar, background shift for weather view, alert icons.
- Spring physics for island expansion and tab switching.

---

## 8. Build / test / deploy

1. `npm run build` must pass with zero warnings.
2. `node --check` on any new server files.
3. `git commit -A && git push`.
4. `sudo systemctl restart smart-display-server smart-display-kiosk`.
5. Verify via CDP screenshot if kiosk not visible: `curl -s http://localhost:9222/json/list`.

---

## 9. Blockers / needs user

- **Ambient Weather API key** — log into https://ambientweather.net/account, create an Application Key and API Key, then give them to Finn so the backyard station can feed the model.
- If the station supports local upload, we can redirect it to our own endpoint instead of relying on Ambient's cloud. Ask only if cloud keys are not available.

---

## 10. Cursor task order

1. **Dynamic Island v2** — rewrite to support states, queue, weather alerts. Keep existing now-playing.
2. **WeatherView + RadarCanvas** — Open-Meteo + RainViewer, dithered canvas, responsive layout.
3. **API endpoint + polling** — backend fetches every 5-15 min, stores history.
4. **Rule-based predictor + alerts** — island triggers for rain coming.
5. **ML predictor** — replace rule module with sklearn model training on history.
6. **Ambient Weather integration** — once keys provided.
7. **Polish** — lusion-style view transitions, reduced motion, final build.
