<!--
	Hallmark design scores
	Philosophy 5 · Hierarchy 5 · Execution 5 · Specificity 4 · Restraint 4 · Variety 5
	Moody-ambient IA: the liquid-metal field is cursor-reactive and carries the
	dithered, molten identity; glass now refracts through every view sheet
	(school/weather), not just the trough, with a single sheened+liquid-
	distorted hero surface active at a time. Nav uses one sliding indicator,
	not a static per-tab pill.
-->
<script>
	import '../app.css';
	import { onMount } from 'svelte';
	import { currentView, displayMode, weather, weatherDetail, rainPrediction, nowPlaying, wsStatus, islandQueue, islandActivities, installProgress, agentRoster, pushIslandEvent, setIslandActivity, clearIslandActivity } from '$lib/stores.js';
	import { gpuLowPowerMode, displayQuality, ollamaStatus, toggleGpuLowPower, startOllamaArbiter } from '$lib/services/ollamaArbiter.js';
	import { startSystemWatch } from '$lib/services/systemWatch.js';
	import { primeAudio, playChime } from '$lib/services/chime.js';
	import { chimeKindForEvent } from '$lib/chimeKind.js';
	import {
		applyNotifyToRoster,
		applyOllamaHint,
		demoRoster,
		isAgentStatusEvent,
		workingIslandActivity
	} from '$lib/agentRoster.js';
	import { KIOSK_VIEWS, canonicalizeKioskView, kioskViewLabel } from '$lib/kioskViews.js';
	import { decideSmartStack, isStandBy } from '$lib/smartStack.js';
	import { applyNowPlayingFrame, startNowPlayingPolling } from '$lib/services/nowPlayingSync.js';
	import { applyAudioFrame } from '$lib/services/audioReactive.js';
	import { atmosphereFromWeather, phaseKicker } from '$lib/atmosphere.js';
	import { sampleRadarNowcast } from '$lib/radarNowcast.js';
	import { mergeRadarPrediction } from '$lib/rainModel.js';
	import { islandWeatherSlip, splitNwsAlerts, tickerText } from '$lib/nwsAlerts.js';
	import { shortDateline } from '$lib/dateline.js';
	import { DEMO_START_SEC, demoNowPlaying } from '$lib/musicDemo.js';
	import { voiceDemoNowPlaying } from '$lib/lyricVoicesDemo.js';
	import {
		EMPTY_INSTALL_PROGRESS,
		applyUpgradeEvent,
		beginInstallProgress,
		finishInstallProgress,
		islandActivityForProgress
	} from '$lib/hostUpgradeModel.js';
	import LiquidMetalCanvas from '$lib/shaders/LiquidMetalCanvas.svelte';
	import IslandStack from '$lib/components/IslandStack.svelte';
	import SevereTicker from '$lib/components/SevereTicker.svelte';
	import BoardWidgets from '$lib/components/BoardWidgets.svelte';
	import HeroClock from '$lib/components/HeroClock.svelte';
	import SchoolHub from '$lib/components/SchoolHub.svelte';
	import AgentsHub from '$lib/components/AgentsHub.svelte';
	import MusicView from '$lib/components/MusicView.svelte';
	import WeatherView from '$lib/components/WeatherView.svelte';
	import RadarCanvas from '$lib/components/RadarCanvas.svelte';
	import AmbientDeck from '$lib/components/AmbientDeck.svelte';
	import NoiseOverlay from '$lib/components/NoiseOverlay.svelte';

	let ws;
	let reconnectTimer;
	let hadDroppedConnection = false;
	let time = $state(new Date());
	let weatherData = $state(null);
	let weatherLoading = $state(true);
	let mode = $state('normal');
	let hdmiOff = $state(false);
	let navEl = $state(null);
	let tabRefs = $state([]);
	let indicator = $state({ left: 0, right: 0, top: 0, width: 0, height: 0, dir: 'right', ready: false });
	let indicatorMorphing = $state(false);
	let indicatorMorphTimer = 0;
	// Plain (non-reactive) shadow of the indicator's last position. updateIndicator
	// both reads and writes this to detect movement; using $state for that read
	// would make the enclosing $effect depend on its own write and loop forever.
	let lastIndicatorPos = { left: 0, top: 0, width: 0, dir: 'right', set: false };
	// Same idea for the view-swap chime below: plain, not $state, so reading
	// it in the effect that reacts to $currentView doesn't create a
	// self-triggering loop.
	let lastViewIdx = -1;
	// `?demo=music` pins the Music view. The kiosk websocket init/navigate
	// payload would otherwise snap back to Clock as soon as /ws connects.
	let lockDemoView = false;
	if (typeof window !== 'undefined') {
		const demo = new URLSearchParams(window.location.search).get('demo');
		if (demo === 'music' || demo === 'voices') {
			lockDemoView = true;
			currentView.set('music');
		}
		if (demo === 'agents') {
			lockDemoView = true;
			currentView.set('agents');
			agentRoster.set(demoRoster());
		}
	}

	const VIEWS = KIOSK_VIEWS;

	// Last human touch/key/remote input. Smart Stack and StandBy both key off
	// how long the room has left the display alone.
	let lastInput = $state(Date.now());
	let autoFrom = null;
	let autoSetView = '';
	let wasPlaying = false;
	function markInput() {
		lastInput = Date.now();
		autoFrom = null;
	}

	function selectView(v, { auto = false } = {}) {
		const next = canonicalizeKioskView(v);
		if (!VIEWS.includes(next) || $currentView === next) return;
		if (!auto) markInput();
		autoSetView = auto ? next : '';
		currentView.set(next);
		if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'navigate', view: next }));
	}

	// Which way the last view change went, so the incoming pane slides in
	// from the side you moved toward (shortest way round the tab strip).
	let navDir = $state('next');

	// Swipe / drag between views. The stage follows the finger with a
	// rubber band, then commits past 18% of the width or a quick flick.
	let drag = $state({ active: false, dx: 0 });
	let dragStart = null;
	function onStageDown(e) {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		// leave controls with their own gestures alone (the Music seek bar is a
		// role="slider" div, not an <input>)
		if (e.target.closest('button, a, input, select, textarea, [role="slider"], [role="scrollbar"], [data-no-swipe]')) return;
		dragStart = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, locked: false };
	}
	function onStageMove(e) {
		if (!dragStart || e.pointerId !== dragStart.id) return;
		const dx = e.clientX - dragStart.x;
		const dy = e.clientY - dragStart.y;
		if (!dragStart.locked) {
			if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
			if (Math.abs(dy) > Math.abs(dx)) {
				dragStart = null;
				return;
			}
			dragStart.locked = true;
			e.currentTarget.setPointerCapture?.(e.pointerId);
		}
		// rubber band: near 1:1 at first, then more resistance the further it goes
		const reach = (window.innerWidth || 1) * 0.22;
		drag = { active: true, dx: (reach * dx) / (reach + Math.abs(dx)) };
	}
	function onStageUp(e) {
		if (!dragStart || e.pointerId !== dragStart.id) return;
		const dx = e.clientX - dragStart.x;
		const dt = Math.max(1, performance.now() - dragStart.t);
		const locked = dragStart.locked;
		dragStart = null;
		drag = { active: false, dx: 0 };
		if (!locked) return;
		const flick = Math.abs(dx) / dt > 0.6;
		if (Math.abs(dx) < (window.innerWidth || 1) * 0.18 && !flick) return;
		let idx = VIEWS.indexOf($currentView);
		if (idx < 0) idx = 0;
		const n = VIEWS.length;
		selectView(VIEWS[dx < 0 ? (idx + 1) % n : (idx - 1 + n) % n]);
	}

	function updateIndicator() {
		const idx = VIEWS.indexOf($currentView);
		const btn = tabRefs[idx];
		if (!btn || !navEl) return;
		const navRect = navEl.getBoundingClientRect();
		const btnRect = btn.getBoundingClientRect();
		const left = btnRect.left - navRect.left;
		// Track the row too: on a phone the tabs wrap to two lines, and an
		// indicator pinned to the nav's full height spanned both of them.
		const top = btnRect.top - navRect.top;
		const width = btnRect.width;
		const height = btnRect.height;
		const right = navRect.width - left - width;
		const moved =
			lastIndicatorPos.set &&
			(left !== lastIndicatorPos.left || top !== lastIndicatorPos.top || width !== lastIndicatorPos.width);
		// read the previous direction from the plain shadow, never from
		// `indicator` itself: this runs inside an effect that writes it
		const dir =
			!lastIndicatorPos.set || left === lastIndicatorPos.left
				? lastIndicatorPos.dir
				: left > lastIndicatorPos.left
					? 'right'
					: 'left';
		lastIndicatorPos = { left, top, width, dir, set: true };
		indicator = { left, right, top, width, height, dir, ready: true };
		if (moved && typeof window !== 'undefined') {
			const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
			if (!reduced) {
				indicatorMorphing = true;
				clearTimeout(indicatorMorphTimer);
				indicatorMorphTimer = setTimeout(() => {
					indicatorMorphing = false;
				}, 380);
			}
		}
	}

	function applyDisplay(display) {
		if (!display) return;
		if (display.hdmi === 'off') {
			hdmiOff = true;
			if (mode !== 'sleep') {
				mode = 'sleep';
				displayMode.set('sleep');
			}
		}
		if (display.hdmi === 'on') {
			hdmiOff = false;
			if (mode === 'sleep') {
				mode = 'normal';
				displayMode.set('normal');
			}
		}
	}

	let lastVolumeKey = '';
	function announceVolume(msg) {
		if (!msg || typeof msg.volume !== 'number') return;
		const pct = msg.muted ? 0 : Math.round(msg.volume * 100);
		const key = msg.muted ? 'mute' : `v${pct}`;
		if (key === lastVolumeKey) return;
		lastVolumeKey = key;
		pushIslandEvent({
			title: msg.muted ? 'Muted' : `Volume ${pct}%`,
			body: '',
			severity: 'info',
			ttl: 2500,
			source: 'Volume',
			kind: 'volume',
			muted: Boolean(msg.muted)
		});
	}

	function connect() {
		const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		ws = new WebSocket(`${proto}//${location.host}/ws`);
		ws.onopen = () => {
			clearIslandActivity('network');
			if (hadDroppedConnection) {
				pushIslandEvent({ title: 'Network restored', body: 'Reconnected', severity: 'ok', ttl: 4000 });
			}
			hadDroppedConnection = false;
			wsStatus.set('connected');
		};
		ws.onclose = () => {
			setIslandActivity('network', {
				kind: 'network',
				title: 'Network',
				body: 'Retrying',
				severity: 'warn'
			});
			if (!hadDroppedConnection) {
				pushIslandEvent({ title: 'Network issue', body: 'Lost connection, retrying', severity: 'warn', ttl: 8000 });
			}
			hadDroppedConnection = true;
			wsStatus.set('disconnected');
			reconnectTimer = setTimeout(connect, 2000);
		};
		ws.onmessage = (e) => {
			try {
				const msg = JSON.parse(e.data);
				if (msg.type === 'navigate') {
					const view = canonicalizeKioskView(msg.view);
					// our own Smart Stack move echoes back from the server; only a
					// navigate we didn't send counts as someone using the remote
					if (view === autoSetView) autoSetView = '';
					else markInput();
					if (!lockDemoView && view && view !== $currentView) currentView.set(view);
				}
				if (msg.type === 'notify') {
					const ev = {
						title: msg.title || 'Notice',
						body: msg.body || '',
						severity: msg.severity || 'info',
						ttl: msg.ttl || 9000,
						source: msg.source || '',
						kind: msg.kind || 'notice',
						muted: Boolean(msg.muted)
					};
					pushIslandEvent(ev);
					agentRoster.update((r) => applyNotifyToRoster(r, ev));
					if (isAgentStatusEvent(ev)) playChime(chimeKindForEvent(ev));
				}
				if (msg.type === 'agents' && Array.isArray(msg.agents) && !lockDemoView) {
					agentRoster.set(msg.agents);
				}
				if (msg.type === 'volume') {
					announceVolume(msg);
				}
				if (msg.type === 'trigger' && msg.event === 'morning') {
					mode = 'morning';
					displayMode.set('morning');
					pushIslandEvent({
						title: 'Good morning',
						body: 'Briefing ready. Check due work.',
						severity: 'info',
						ttl: 8000,
						source: 'Display',
						kind: 'briefing'
					});
					currentView.set(msg.view || 'school');
				}
				if (msg.type === 'installProgress') {
					installProgress.set(msg);
				}
				if (msg.type === 'audioSpectrum') {
					applyAudioFrame(msg);
				}
				if (msg.type === 'init') {
					const view = canonicalizeKioskView(msg.view);
					if (msg.view && !lockDemoView && view !== $currentView) currentView.set(view);
					applyDisplay(msg.display);
					if (msg.installProgress) installProgress.set(msg.installProgress);
					if (Array.isArray(msg.agents) && !lockDemoView) agentRoster.set(msg.agents);
					if (msg.power) {
						window.dispatchEvent(new CustomEvent('power-state', { detail: msg.power }));
					}
					if (msg.load) {
						window.dispatchEvent(new CustomEvent('display-load', { detail: msg.load }));
					}
					if (msg.nowPlaying) applyNowPlayingFrame(msg.nowPlaying);
				}
				if (msg.type === 'nowPlaying') {
					applyNowPlayingFrame(msg);
				}
				if (msg.type === 'load') {
					window.dispatchEvent(new CustomEvent('display-load', { detail: msg }));
				}
				if (msg.type === 'display') {
					applyDisplay(msg);
				}
				if (msg.type === 'trigger' && msg.event === 'sleep') {
					mode = 'sleep';
					displayMode.set('sleep');
					pushIslandEvent({
						title: 'Sleep mode',
						body: 'Panel off for the night. See you tomorrow.',
						severity: 'info',
						ttl: 4000,
						source: 'Display'
					});
				}
				if (msg.type === 'trigger' && msg.event === 'normal') {
					mode = 'normal';
					displayMode.set('normal');
					pushIslandEvent({
						title: 'Normal mode',
						body: 'Resuming full display.',
						severity: 'info',
						ttl: 3000,
						source: 'Display'
					});
				}
				if (msg.type === 'trigger' && msg.event === 'hdmi_off') {
					hdmiOff = true;
				}
				if (msg.type === 'trigger' && msg.event === 'hdmi_on') {
					hdmiOff = false;
					if (mode === 'sleep') {
						mode = 'normal';
						displayMode.set('normal');
					}
				}
				if (msg.type === 'power') {
					window.dispatchEvent(new CustomEvent('power-state', { detail: msg.state }));
				}
			} catch {
				/* ignore malformed frames */
			}
		};
	}

	let lastIslandPing = '';
	let lastTickerPing = '';
	let lastExtremePing = '';
	let tickerPulse = $state('');
	let tickerPulseTimer = 0;

	function maybePingWeather(data) {
		if (!data) return;
		const { extreme } = splitNwsAlerts(data.alerts);
		const extremeKey = extreme.length ? extreme.map((a) => a.event).join('|') : '';
		if (extremeKey && extremeKey !== lastExtremePing) {
			lastExtremePing = extremeKey;
			const top = extreme[0];
			pushIslandEvent({
				title: top.event || 'Severe weather',
				body: String(top.headline || '').replace(/\s+/g, ' ').trim(),
				severity: 'error',
				ttl: 14000,
				source: 'Extreme Alert',
				kind: 'severe-weather'
			});
		} else if (!extremeKey) {
			lastExtremePing = '';
		}
		const roll = tickerText(extreme);
		if (roll) {
			const key = `x:${extremeKey}`;
			if (key !== lastTickerPing) {
				lastTickerPing = key;
				tickerPulse = roll;
				clearTimeout(tickerPulseTimer);
				tickerPulseTimer = setTimeout(() => {
					tickerPulse = '';
				}, 22000);
			}
		} else {
			lastTickerPing = '';
			tickerPulse = '';
		}
		const slip = islandWeatherSlip(data);
		if (!slip.active) {
			lastIslandPing = '';
			return;
		}
		if (slip.chimeKey === lastIslandPing) return;
		lastIslandPing = slip.chimeKey;
		pushIslandEvent({
			title: slip.title,
			body: [slip.sub, slip.extra].filter(Boolean).join(' · '),
			severity: slip.severity,
			ttl: 12000,
			source: slip.kicker,
			kind: 'weather'
		});
	}

	async function fetchWeather() {
		weatherLoading = true;
		try {
			const r = await fetch('/api/weather?hours=48');
			weatherData = await r.json();
			try {
				const samples = await sampleRadarNowcast(weatherData?.rad);
				if (samples.length) {
					weatherData = {
						...weatherData,
						radarNowcast: samples,
						prediction: mergeRadarPrediction(weatherData.prediction, samples)
					};
				}
			} catch {
				/* nowcast sample is optional */
			}
			const cur = weatherData?.current || {};
			const t = Number(cur.temp);
			weather.set({
				temp: Number.isFinite(t) ? Math.round(t) : (cur.temp ?? '--'),
				desc: cur.desc ?? '--'
			});
			weatherDetail.set(weatherData);
			rainPrediction.set(
				weatherData?.prediction || { rain30min: 0, rain60min: 0, rain120min: 0, source: 'forecast' }
			);
			weatherLoading = false;
		} catch {
			weatherLoading = false;
		}
	}

	function handleKey(e) {
		markInput();
		if (e.altKey && (e.key === 'y' || e.key === 'Y')) {
			toggleGpuLowPower();
			return;
		}
		let idx = VIEWS.indexOf($currentView);
		if (idx === -1) idx = 0;
		if (e.key === 'ArrowRight') {
			selectView(VIEWS[(idx + 1) % VIEWS.length]);
		}
		if (e.key === 'ArrowLeft') {
			selectView(VIEWS[(idx - 1 + VIEWS.length) % VIEWS.length]);
		}
	}

	onMount(() => {
		const preview = new URLSearchParams(window.location.search);
		const islandPreview = preview.get('island');
		const demoKind = preview.get('demo');
		const musicDemo = islandPreview === 'music' || demoKind === 'music' || demoKind === 'voices';
		if (demoKind === 'music' || demoKind === 'voices') {
			lockDemoView = true;
			currentView.set('music');
		}
		if (demoKind === 'agents') {
			lockDemoView = true;
			currentView.set('agents');
			agentRoster.set(demoRoster());
		}
		connect();
		fetchWeather();
		const stopSystemWatch = startSystemWatch();
		const stopGovernor = startOllamaArbiter();
		const clock = setInterval(() => {
			time = new Date();
			smartStackTick();
		}, 1000);
		window.addEventListener('pointerdown', markInput, { passive: true });
		const stopMusicPoll = musicDemo ? () => {} : startNowPlayingPolling(2000);
		const wx = setInterval(fetchWeather, 300000);
		window.addEventListener('keydown', handleKey);
		window.addEventListener('resize', updateIndicator, { passive: true });
		// Browsers block audio until a real user gesture; a touch/click/key on
		// the kiosk unlocks it so island-event and agent-finish chimes can play afterward.
		window.addEventListener('pointerdown', primeAudio, { once: true });
		window.addEventListener('keydown', primeAudio, { once: true });
		updateIndicator();
		if (preview.get('wx') === 'notify') {
			const ev = {
				title: 'Cursor finished',
				body: 'Radar island layout is ready',
				severity: 'ok',
				ttl: 12000,
				source: 'Cursor',
				kind: 'done'
			};
			pushIslandEvent(ev);
			agentRoster.update((r) => applyNotifyToRoster(r, ev));
		}
		let demoLyricsPoll = 0;
		if (demoKind === 'voices') {
			currentView.set('music');
			const t = Number(preview.get('t'));
			nowPlaying.set(
				voiceDemoNowPlaying(undefined, {
					position: Number.isFinite(t) ? t : 1.6,
					freeze: preview.get('freeze') === '1'
				})
			);
		} else if (musicDemo) {
			if (preview.get('demo') === 'music') currentView.set('music');
			const t = Number(preview.get('t'));
			nowPlaying.set(
				demoNowPlaying(undefined, {
					position: Number.isFinite(t) ? t : DEMO_START_SEC,
					freeze: preview.get('freeze') === '1',
					lyricsPending: true
				})
			);
			const pullDemoLyrics = async () => {
				try {
					const r = await fetch('/api/nowplaying?demo=music');
					if (!r.ok) return false;
					const data = await r.json();
					nowPlaying.update((cur) => {
						if (!cur) return cur;
						return {
							...cur,
							lyrics: data.lyrics ?? cur.lyrics,
							lyricsPending: Boolean(data.lyricsPending)
						};
					});
					return !data.lyricsPending;
				} catch {
					return false;
				}
			};
			pullDemoLyrics();
			demoLyricsPoll = setInterval(async () => {
				if (await pullDemoLyrics()) {
					clearInterval(demoLyricsPoll);
					demoLyricsPoll = 0;
				}
			}, 400);
		}
		let installDemo = 0;
		if (islandPreview === 'install') {
			const pkgs = ['curl', 'linux-generic', 'libc6', 'ca-certificates', 'fwupd'];
			let state = beginInstallProgress({ phase: 'packages', total: pkgs.length });
			installProgress.set(state);
			let i = 0;
			installDemo = setInterval(() => {
				if (i < pkgs.length) {
					state = applyUpgradeEvent(state, { kind: 'complete', pkg: pkgs[i] });
					installProgress.set(state);
					i += 1;
					return;
				}
				clearInterval(installDemo);
				installProgress.set(finishInstallProgress(state));
				setTimeout(() => {
					installProgress.set({ ...EMPTY_INSTALL_PROGRESS });
					clearIslandActivity('update');
				}, 1800);
			}, 700);
		}
		return () => {
			clearInterval(clock);
			stopMusicPoll();
			clearInterval(wx);
			clearInterval(demoLyricsPoll);
			clearInterval(installDemo);
			clearTimeout(reconnectTimer);
			stopSystemWatch();
			stopGovernor();
			window.removeEventListener('keydown', handleKey);
			window.removeEventListener('resize', updateIndicator);
			window.removeEventListener('pointerdown', primeAudio);
			window.removeEventListener('pointerdown', markInput);
			window.removeEventListener('keydown', primeAudio);
			ws?.close();
		};
	});

	let weekday = $derived(time.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' }));
	let month = $derived(time.toLocaleDateString('en-US', { month: 'long', timeZone: 'America/New_York' }));
	let dayNum = $derived(new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })).getDate());
	let shortDate = $derived(shortDateline(month, dayNum));
	let clockLabel = $derived(
		time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
	);
	let atm = $derived(atmosphereFromWeather(time.getTime(), weatherData));

	function smartStackTick() {
		if (lockDemoView) return;
		const playing = Boolean($nowPlaying?.playing);
		const move = decideSmartStack({
			view: $currentView,
			now: Date.now(),
			lastInput,
			playing,
			wasPlaying,
			autoFrom
		});
		wasPlaying = playing;
		if (!move) return;
		autoFrom = move.autoFrom;
		selectView(move.view, { auto: true });
	}

	// `?standby=1` previews StandBy without waiting for night and idle time
	const standbyPreview =
		typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('standby') === '1';
	let standby = $derived(
		(standbyPreview && $currentView === 'clock') ||
			isStandBy({ view: $currentView, phase: atm.phase, now: time.getTime(), lastInput, mode })
	);
	let clockKicker = $derived(phaseKicker(atm.phase, weekday));

	const VIEW_TITLES = {
		school: 'Due Work',
		music: 'Music',
		weather: 'Weather'
	};
	let viewTitle = $derived(VIEW_TITLES[$currentView] ?? '');

	function viewLabel(name) {
		return kioskViewLabel(name);
	}

	function weatherFromQuery() {
		if (typeof window === 'undefined') return null;
		const wx = new URLSearchParams(window.location.search).get('wx');
		if (wx === 'warning') {
			return {
				alerts: [
					{
						event: 'Tornado Warning',
						severity: 'Extreme',
						headline: 'Tornado Warning for Pinellas including Largo until 4:15 PM EDT'
					}
				]
			};
		}
		if (wx === 'watch') {
			return {
				alerts: [{ event: 'Tornado Watch', severity: 'Moderate', headline: 'Watch until 8 PM EDT' }]
			};
		}
		if (wx === 'rain') {
			return { alerts: [], prediction: { rain30min: 0.72, rain60min: 0.8, rain120min: 0.2, approaching: true, etaMin: 18, source: 'nowcast+forecast' } };
		}
		if (wx === 'advisory') {
			return {
				alerts: [{ event: 'Heat Advisory', severity: 'Moderate', headline: 'Until 7 PM EDT' }]
			};
		}
		if (wx === 'hurricane') {
			return {
				alerts: [
					{
						event: 'Hurricane Warning',
						severity: 'Extreme',
						headline: 'Hurricane Warning for coastal Pinellas including Largo'
					}
				]
			};
		}
		if (wx === 'notify') {
			return { notify: true };
		}
		return null;
	}

	let wxForIsland = $derived.by(() => {
		const override = weatherFromQuery();
		if (!override || override.notify) return weatherData;
		return { ...(weatherData || {}), ...override };
	});
	let islandActive = $derived(
		$islandQueue.length > 0 ||
			$nowPlaying?.playing ||
			$islandActivities.length > 0 ||
			Boolean($installProgress?.active)
	);
	let showChromeTicker = $derived(Boolean(tickerPulse) && $currentView !== 'weather');

	$effect(() => {
		const activity = islandActivityForProgress($installProgress);
		if (activity) setIslandActivity('update', activity);
		else if (!$installProgress?.active) {
			const list = $islandActivities;
			if (list.some((a) => a.id === 'update' && a.kind === 'install')) {
				clearIslandActivity('update');
			}
		}
	});

	$effect(() => {
		const activity = workingIslandActivity($agentRoster);
		if (activity) setIslandActivity('agents', activity);
		else clearIslandActivity('agents');
	});

	$effect(() => {
		agentRoster.update((r) => applyOllamaHint(r, $ollamaStatus));
	});

	$effect(() => {
		wxForIsland;
		if (typeof window === 'undefined') return;
		maybePingWeather(wxForIsland);
	});

	$effect(() => {
		const idx = VIEWS.indexOf($currentView);
		updateIndicator();
		if (idx !== -1 && lastViewIdx !== -1 && idx !== lastViewIdx) {
			// Shortest path around the tab strip decides the chime's direction,
			// so wrapping from the last tab to the first (or back) still reads
			// as "forward"/"backward" rather than the raw index jump.
			const n = VIEWS.length;
			const forwardDist = (idx - lastViewIdx + n) % n;
			navDir = forwardDist <= n / 2 ? 'next' : 'prev';
			playChime(navDir === 'next' ? 'swap-next' : 'swap-prev');
			// ripple the liquid metal out from the tab that just took focus
			const r = tabRefs[idx]?.getBoundingClientRect();
			if (r) {
				window.dispatchEvent(
					new CustomEvent('liquid-impulse', { detail: { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
				);
			}
		}
		lastViewIdx = idx;
	});
</script>

<svelte:head>
	<title>Smart Display</title>
</svelte:head>

<a class="skip" href="#main-stage">Skip to view</a>

<div class="display-shell" class:standby class:sleep={mode === 'sleep'} class:hdmi-off={hdmiOff} class:eco={$displayQuality === 'eco'} class:frozen={$displayQuality === 'frozen' || $gpuLowPowerMode}>
	<LiquidMetalCanvas
		isLowPower={$gpuLowPowerMode || mode === 'sleep' || hdmiOff}
		quality={$displayQuality}
		sun={atm.sun}
		twilight={atm.twilight}
		rain={atm.rain}
		wind={atm.wind}
		cloud={atm.cloud}
		windDir={atm.windRad}
	/>

	{#if $currentView === 'music' && $nowPlaying?.art && ($nowPlaying?.playing || $nowPlaying?.paused || $nowPlaying?.title)}
		{#key $nowPlaying.art}
			<div
				class="music-ambient"
				style="background-image: linear-gradient(color-mix(in srgb, var(--abyss) 80%, transparent), color-mix(in srgb, var(--abyss) 80%, transparent)), url({$nowPlaying.art})"
				aria-hidden="true"
			></div>
		{/key}
	{/if}

	<IslandStack
		nowPlaying={$nowPlaying}
		events={$islandQueue}
		activities={$islandActivities}
		progress={$installProgress}
		onMusicView={$currentView === 'music'}
	/>

	<div
		class="display-root"
		class:morning={mode === 'morning'}
		class:sleep={mode === 'sleep'}
		class:wx-rain={atm.rain >= 0.35}
		class:standby
		data-phase={atm.phase}
		data-dir={navDir}
	>
		<header class="zone top">
			<div class="top-row">
				<nav class="view-strip" aria-label="Views" bind:this={navEl}>
					<span
						class="tab-indicator"
						class:ready={indicator.ready}
						class:morphing={indicatorMorphing}
						data-dir={indicator.dir}
						style="--ind-left: {indicator.left}px; --ind-right: {indicator.right}px; --ind-top: {indicator.top}px; --ind-height: {indicator.height}px"
						aria-hidden="true"
					></span>
					{#each VIEWS as v, i (v)}
						<button
							class="view-tab"
							class:active={$currentView === v}
							onclick={() => selectView(v)}
							aria-current={$currentView === v ? 'page' : undefined}
							bind:this={tabRefs[i]}
						>
							<span class="view-tab-label">{viewLabel(v)}</span>
						</button>
					{/each}
				</nav>
				<span class="island-slot" aria-hidden="true"></span>
				<div class="status-cluster" class:receded={islandActive}>
					<p class="dateline">
						{#if $currentView !== 'clock'}
							<span class="time num">{clockLabel}</span>
						{/if}
						{shortDate}
					</p>
					<p class="wxline">
						{#if weatherLoading}
							<span class="skeleton inline"></span>
						{:else if $weather.temp !== '--'}
							<span class="num">{$weather.temp}°</span>
							{$weather.desc}
						{/if}
					</p>
				</div>
			</div>
			{#if showChromeTicker}
				<SevereTicker text={tickerPulse} />
			{/if}
			{#if $currentView !== 'clock' && $currentView !== 'music' && $currentView !== 'weather' && $currentView !== 'agents'}
				<h1 class="view-title">{viewTitle}</h1>
			{/if}
		</header>

		<main
			id="main-stage"
			class="zone center"
			class:dragging={drag.active}
			style="--drag-x: {drag.dx}px"
			onpointerdown={onStageDown}
			onpointermove={onStageMove}
			onpointerup={onStageUp}
			onpointercancel={onStageUp}
		>
			{#if $currentView === 'clock'}
				<section class="view-pane clock-pane">
					<div class="clock-credits">
						<p class="clock-kicker">{clockKicker}</p>
						<HeroClock {time} size="poster" />
						<BoardWidgets {atm} prediction={wxForIsland?.prediction || weatherData?.prediction} />
					</div>
				</section>
			{:else if $currentView === 'school'}
				<section class="view-pane sheet school-pane" data-glass>
					<SchoolHub />
				</section>
			{:else if $currentView === 'agents'}
				<section class="view-pane agents-pane">
					<AgentsHub />
				</section>
			{:else if $currentView === 'music'}
				<section class="view-pane music-pane">
					<MusicView />
				</section>
			{:else if $currentView === 'weather'}
				<section class="view-pane sheet weather-pane" data-glass>
					<div class="radar-bleed">
						<RadarCanvas data={weatherData} paused={$displayQuality !== 'full' || mode === 'sleep'} />
					</div>
					<div class="weather-trough">
						<WeatherView data={wxForIsland || weatherData} />
					</div>
				</section>
			{/if}
		</main>

		<footer class="zone bottom">
			<div class="equator" aria-hidden="true">
				{#each Array(16) as _, i (i)}
					<span>+</span>
				{/each}
			</div>
			<div class="trough glass-field" data-glass>
				<AmbientDeck
					{atm}
					prediction={wxForIsland?.prediction || weatherData?.prediction}
					showWidgets={$currentView !== 'clock'}
				/>
			</div>
		</footer>
	</div>

	{#if $displayQuality === 'full' && mode !== 'sleep'}
		<NoiseOverlay />
	{/if}
</div>

<style>
	.skip {
		position: absolute;
		left: var(--space-4);
		top: var(--space-4);
		z-index: 40;
		transform: translateY(-160%);
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-md);
		background: var(--foreground);
		color: var(--abyss);
		font-family: var(--font-body);
		font-weight: 600;
		text-decoration: none;
	}
	.skip:focus {
		transform: none;
	}
	.display-shell {
		width: 100vw;
		height: 100dvh;
		min-height: 100dvh;
		overflow-x: clip;
		overflow-y: hidden;
		position: relative;
		background: var(--background);
	}
	.display-shell.eco :global(.glass-field),
	.display-shell.frozen :global(.glass-field),
	.display-shell.sleep :global(.glass-field) {
		backdrop-filter: none;
		-webkit-backdrop-filter: none;
	}
	.display-shell.eco .music-ambient,
	.display-shell.frozen .music-ambient {
		filter: none;
		opacity: 0.35;
	}
	/* The whole screen picks up the now-playing album art as a soft, glowing
	   backdrop - every pane is transparent over the liquid-metal canvas
	   already, so this just takes that canvas's place while music plays,
	   the way Apple Music/Cider tint their whole now-playing screen. */
	.music-ambient {
		position: fixed;
		inset: -18%;
		z-index: 1;
		background-size: cover;
		background-position: center;
		filter: blur(42px) saturate(1.25) brightness(0.65);
		transform: translateZ(0);
		pointer-events: none;
	}
	@media (prefers-reduced-motion: no-preference) {
		.music-ambient {
			animation:
				ambient-in 900ms var(--spring-smooth) both,
				ambient-ken 28s ease-in-out infinite alternate;
		}
	}
	@keyframes ambient-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	@keyframes ambient-ken {
		from {
			transform: translate3d(-2%, -1%, 0) scale(1.04);
		}
		to {
			transform: translate3d(3%, 2%, 0) scale(1.14);
		}
	}
	.display-root {
		position: relative;
		z-index: 10;
		width: 100%;
		height: 100%;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr) auto;
		color: var(--text-primary);
		font-family: var(--font-body);
		min-width: 0;
	}
	.zone {
		width: 100%;
		padding: 0 var(--space-8);
		box-sizing: border-box;
		min-width: 0;
	}
	.top {
		height: auto;
		min-height: 0;
		padding-top: var(--space-8);
		padding-bottom: var(--space-4);
		overflow: visible;
	}
	/* Nav and the date/weather line share one row, at the same Y, with the
	   date/weather pushed hard to the right edge — the Dynamic Island lives
	   independently of this row now (fixed, top-center), so this is free to
	   just be a plain left/right split. */
	/* Three columns: nav | island slot | status. The middle column reserves
	   the resting Dynamic Island's footprint (it is position: fixed, so it
	   takes no space on its own), which keeps the tabs and the date line
	   from sliding underneath it at 1920px. Expanded notifications still
	   grow past the slot; the status cluster recedes while they do. */
	.top-row {
		--island-slot: 25rem;
		display: grid;
		grid-template-columns: minmax(0, 1fr) var(--island-slot) minmax(0, 1fr);
		align-items: center;
		gap: var(--space-4);
		width: 100%;
		min-width: 0;
	}
	.island-slot {
		grid-column: 2;
	}
	.status-cluster {
		grid-column: 3;
		justify-self: end;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: var(--space-1);
		min-width: 0;
		text-align: right;
		transition: opacity 320ms var(--spring-smooth);
	}
	.status-cluster.receded {
		opacity: 0.32;
	}
	.dateline,
	.wxline {
		margin: 0;
		font-family: var(--font-body);
		letter-spacing: -0.025em;
		overflow-wrap: anywhere;
		min-width: 0;
		line-height: 1.15;
	}
	.dateline {
		font-size: var(--text-2xl);
		font-weight: 600;
		color: var(--text-secondary);
	}
	.wxline {
		font-size: var(--text-xl);
		font-weight: 500;
		color: var(--text-tertiary);
	}
	.wxline .num {
		margin-right: var(--space-1);
		font-weight: 600;
		color: var(--text-secondary);
	}
	.display-root.wx-rain .wxline {
		color: var(--scan);
	}
	.view-title {
		margin: var(--space-6) 0 0;
		font-family: var(--font-body);
		font-size: clamp(2.25rem, 4.4vw, 3.75rem);
		font-weight: 700;
		font-style: normal;
		letter-spacing: -0.04em;
		line-height: 1;
		color: var(--foreground);
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.dateline .time {
		margin-right: var(--space-3);
		padding-right: var(--space-3);
		border-right: 1px solid var(--hairline);
		color: var(--foreground);
	}
	.view-strip {
		position: relative;
		grid-column: 1;
		display: flex;
		align-items: stretch;
		width: max-content;
		max-width: 100%;
		gap: 0;
		padding: 0;
		min-width: 0;
		border: 0;
		border-radius: 0;
		background: none;
		box-shadow: none;
		box-sizing: border-box;
	}
	/* Liquid-glass lens under the active tab. Its two edges move on
	   different clocks: the leading edge races ahead and the trailing edge
	   follows, so the lens stretches toward the new tab and then settles,
	   like the iOS 26 tab bar. While travelling it also thins a little
	   (the .morphing class) the way a drop does in motion. */
	.tab-indicator {
		position: absolute;
		top: var(--ind-top, 0);
		left: var(--ind-left, 0);
		right: var(--ind-right, 100%);
		height: var(--ind-height, 100%);
		border-radius: 999px;
		background:
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--foreground) 16%, transparent),
				color-mix(in srgb, var(--foreground) 4%, transparent) 55%,
				color-mix(in srgb, var(--brand) 12%, transparent)
			);
		backdrop-filter: blur(6px) saturate(1.8) brightness(1.15);
		-webkit-backdrop-filter: blur(6px) saturate(1.8) brightness(1.15);
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, var(--foreground) 38%, transparent),
			inset 0 -1px 0 color-mix(in srgb, var(--foreground) 10%, transparent),
			inset 0 0 0 1px color-mix(in srgb, var(--foreground) 10%, transparent),
			0 6px 18px color-mix(in srgb, var(--abyss) 45%, transparent),
			0 0 22px color-mix(in srgb, var(--brand) 18%, transparent);
		opacity: 0;
		pointer-events: none;
		z-index: 0;
		transform-origin: center;
	}
	/* specular glint riding the top of the lens */
	.tab-indicator::after {
		content: '';
		position: absolute;
		inset: 1px 18% auto;
		height: 38%;
		border-radius: 999px;
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--foreground) 28%, transparent),
			transparent
		);
		pointer-events: none;
	}
	.tab-indicator.ready {
		opacity: 1;
		transition-property: left, right, top, height, transform, opacity;
		transition-timing-function: var(--spring-bouncy), var(--spring-bouncy), var(--spring-bouncy), var(--spring-bouncy), var(--spring-smooth), var(--spring-smooth);
		transition-duration: 560ms, 320ms, 480ms, 480ms, 260ms, 240ms;
	}
	.tab-indicator.ready[data-dir='left'] {
		transition-duration: 320ms, 560ms, 480ms, 480ms, 260ms, 240ms;
	}
	.tab-indicator.morphing {
		transform: scaleY(0.86);
	}
	/* press anywhere on the strip squeezes the lens, like touching glass */
	.view-strip:has(.view-tab:active) .tab-indicator {
		transform: scale(0.96, 0.9);
		transition-duration: 560ms, 320ms, 480ms, 480ms, 120ms, 240ms;
	}
	@media (prefers-reduced-motion: reduce) {
		.tab-indicator.ready,
		.tab-indicator.ready[data-dir='left'] {
			transition: opacity 240ms var(--spring-smooth);
		}
		.tab-indicator.morphing {
			transform: none;
		}
	}
	@media (prefers-reduced-transparency: reduce) {
		.tab-indicator {
			backdrop-filter: none;
			-webkit-backdrop-filter: none;
			background: color-mix(in srgb, var(--brand) 22%, var(--abyss-2));
		}
	}
	.view-tab {
		position: relative;
		z-index: 1;
		appearance: none;
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		border: 1px solid transparent;
		border-radius: 999px;
		background: transparent;
		color: var(--text-tertiary);
		font-family: var(--font-body);
		font-size: var(--text-lg);
		font-weight: 500;
		letter-spacing: -0.01em;
		text-transform: none;
		padding: var(--space-2) var(--space-4);
		cursor: pointer;
		white-space: nowrap;
		transition-property: color, transform;
		transition-duration: 150ms, 320ms;
		transition-timing-function: var(--spring-smooth), var(--spring-bouncy);
	}
	.view-tab:hover {
		color: var(--text-secondary);
	}
	.view-tab:active {
		transform: scale(0.96);
		transition-duration: 90ms;
	}
	.view-tab.active {
		color: var(--foreground);
	}
	.view-tab-label {
		display: inline-block;
	}
	.center {
		min-height: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		padding-top: var(--space-6);
		padding-bottom: var(--space-6);
	}
	.display-root:has(.weather-pane) .center {
		padding-top: var(--space-2);
		padding-bottom: var(--space-2);
	}
	.view-pane {
		position: relative;
		overflow: hidden;
		min-width: 0;
		min-height: 0;
	}
	/* Swipe follows the finger; on release it springs back (or the new
	   pane takes over). No transform at rest, so nothing is promoted to its
	   own layer while the stage is idle. */
	.center {
		touch-action: pan-y;
	}
	.center.dragging {
		transform: translate3d(var(--drag-x, 0px), 0, 0);
		cursor: grabbing;
		user-select: none;
	}
	@media (prefers-reduced-motion: no-preference) {
		.view-pane {
			animation: pane-in-next var(--dur-pane) var(--spring-smooth) both;
		}
		.display-root[data-dir='prev'] .view-pane {
			animation-name: pane-in-prev;
		}
		.view-tab:hover:not(.active):not(:active) {
			transform: translateY(-1px);
		}
	}
	/* Direction-aware page transition: the new view slides in from the side
	   you moved toward, sharpening out of a light blur. */
	@keyframes pane-in-next {
		from {
			opacity: 0;
			transform: translate3d(3.5%, 0, 0) scale(0.985);
			filter: blur(8px);
		}
		55% {
			filter: blur(0);
		}
		to {
			opacity: 1;
			transform: none;
			filter: none;
		}
	}
	@keyframes pane-in-prev {
		from {
			opacity: 0;
			transform: translate3d(-3.5%, 0, 0) scale(0.985);
			filter: blur(8px);
		}
		55% {
			filter: blur(0);
		}
		to {
			opacity: 1;
			transform: none;
			filter: none;
		}
	}
	.clock-pane {
		min-height: 0;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		align-items: flex-start;
		pointer-events: none;
	}
	.music-pane {
		min-height: 0;
		display: flex;
		flex-direction: column;
		justify-content: stretch;
		align-items: stretch;
		pointer-events: auto;
		animation: none;
	}
	.music-pane :global(.music-view) {
		flex: 1;
		min-height: 0;
		width: 100%;
	}
	.clock-credits {
		min-width: 0;
		max-width: min(96%, 46rem);
		padding: 0 0 var(--space-2);
	}
	.clock-credits :global(.widgets) {
		margin-top: var(--space-4);
	}
	.clock-kicker {
		margin: 0 0 var(--space-2);
		font-family: var(--font-body);
		font-size: var(--text-xl);
		font-weight: 500;
		letter-spacing: -0.02em;
		color: var(--text-tertiary);
	}
	.display-root[data-phase='dawn'] .clock-kicker {
		color: var(--ok);
	}
	.display-root[data-phase='dusk'] .clock-kicker {
		color: var(--solve);
	}
	.display-root[data-phase='night'] .clock-kicker {
		color: var(--brand);
	}
	.school-pane {
		--sheet-glow: radial-gradient(
			44rem 26rem at 8% -6%,
			var(--glow-brand),
			transparent 70%
		);
	}
	.display-root:has(.agents-pane) .center {
		padding-top: var(--space-2);
		padding-bottom: var(--space-2);
	}
	.agents-pane {
		min-height: 0;
		height: 100%;
		display: flex;
		flex-direction: column;
		background: transparent;
	}
	.weather-pane {
		min-height: 0;
		background: color-mix(in srgb, var(--abyss) 8%, transparent);
		--sheet-glow: radial-gradient(
			44rem 26rem at 50% -8%,
			var(--glow-scan),
			transparent 70%
		);
	}
	.radar-bleed {
		position: absolute;
		inset: 0;
		z-index: 0;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		border-radius: inherit;
	}
	.weather-trough {
		position: relative;
		z-index: 1;
		margin-left: auto;
		width: min(22rem, 32%);
		height: 100%;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		background: linear-gradient(
			90deg,
			transparent,
			color-mix(in srgb, var(--abyss) 18%, transparent) 24%,
			color-mix(in srgb, var(--abyss) 46%, transparent) 72%
		);
	}
	.bottom {
		height: auto;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: var(--space-3);
		/* Lifted well clear of the screen's bottom edge so the equator ticks
		   and the ambient trough (waveform, connection status) stay visible
		   above physical objects — a record player, a stand lip — sitting in
		   front of the panel. */
		padding-bottom: calc(var(--space-8) + var(--floor-clearance));
	}
	.equator {
		display: flex;
		justify-content: space-between;
		align-items: center;
		width: 100%;
		padding: 0 var(--space-1);
		font-family: var(--font-code);
		font-size: var(--text-sm);
		line-height: 1;
		color: color-mix(in srgb, var(--foreground) 22%, transparent);
		pointer-events: none;
		user-select: none;
	}
	.trough {
		width: 100%;
		height: 6rem;
		min-width: 0;
		border-radius: var(--radius-md);
	}
	.trough.glass-field::before {
		display: none;
	}
	/* StandBy night: an idle clock after dark goes red and quiet, like an
	   iPhone on its side at night. Red keeps the room dark-adapted; the
	   chrome fades out so only the time is left. */
	.display-root {
		transition: opacity 1.2s var(--spring-smooth);
	}
	.display-root.standby {
		--foreground: #ff5b4d;
		--text-primary: #ff5b4d;
		--text-secondary: color-mix(in srgb, #ff5b4d 72%, var(--abyss));
		--text-tertiary: color-mix(in srgb, #ff5b4d 48%, var(--abyss));
		--brand: #c2382e;
		--ok: #c2382e;
		--solve: #c2382e;
	}
	.display-root.standby .top,
	.display-root.standby .bottom,
	.display-root.standby :global(.widgets) {
		opacity: 0;
		transition: opacity 1.6s var(--spring-smooth);
	}
	.display-root .top,
	.display-root .bottom {
		transition: opacity 600ms var(--spring-smooth);
	}
	.display-shell::after {
		content: '';
		position: fixed;
		inset: 0;
		z-index: 5;
		background: #000;
		opacity: 0;
		pointer-events: none;
		transition: opacity 1.6s var(--spring-smooth);
	}
	.display-shell.standby::after {
		opacity: 0.62;
	}
	/* the island stays readable in StandBy but stops glowing at the room */
	.display-shell :global(.stack) {
		transition: opacity 1.6s var(--spring-smooth);
	}
	.display-shell.standby :global(.stack) {
		opacity: 0.38;
	}
	.sleep .display-root {
		opacity: 0.15;
		filter: grayscale(0.85);
		transition: opacity 1.2s var(--spring-smooth), filter 1.2s var(--spring-smooth);
	}
	.display-shell.hdmi-off .display-root {
		opacity: 0;
		transition: opacity 2.5s var(--spring-smooth);
	}
	.display-shell.hdmi-off {
		background: var(--background);
	}
	/* Morning briefing: a soft green edge glow that breathes. The shadow is
	   painted once on a pseudo-element and only its opacity animates, so the
	   compositor handles it. Animating box-shadow directly repainted the
	   whole 1920x1080 root every frame for as long as morning mode lasted. */
	.display-root.morning::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		pointer-events: none;
		box-shadow: inset 0 0 120px color-mix(in srgb, var(--ok) 8%, transparent);
		opacity: 0;
		animation: morning-glow 8s var(--ease-in-out) infinite alternate;
	}
	@keyframes morning-glow {
		to { opacity: 1; }
	}
	/* Hold the glass sheen still whenever the governor has dropped quality. */
	.display-shell.eco :global(.sheet)::after,
	.display-shell.frozen :global(.sheet)::after,
	.display-shell.sleep :global(.sheet)::after {
		animation: none;
		will-change: auto;
	}

	/* Below 1600px the five tabs no longer fit left of the island slot, so
	   the island gets its own band and the nav and status share the row
	   underneath it. */
	@media (max-width: 1599px) {
		.top-row {
			grid-template-columns: minmax(0, 1fr) auto;
			padding-top: 3rem;
		}
		.island-slot {
			display: none;
		}
		.status-cluster {
			grid-column: 2;
		}
	}

	@media (max-aspect-ratio: 4/3) {
		.top-row {
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: start;
		}
		.island-slot {
			display: none;
		}
		.status-cluster {
			grid-column: 2;
		}
		.weather-trough {
			width: 100%;
			height: auto;
			max-height: 48%;
			margin-left: 0;
			margin-top: auto;
			border-left: 0;
			border-top: 1px solid var(--hairline);
			background: linear-gradient(
				0deg,
				color-mix(in srgb, var(--abyss) 86%, transparent) 55%,
				transparent
			);
		}
	}

	@media (max-width: 768px) {
		.display-shell {
			height: auto;
			min-height: 100dvh;
			overflow-y: visible;
		}
		.display-root {
			height: auto;
			min-height: 100dvh;
			grid-template-rows: auto auto auto;
		}
		.zone {
			padding-inline: var(--space-4);
		}
		.top {
			padding-top: var(--space-4);
		}
		.top-row {
			grid-template-columns: minmax(0, 1fr);
			/* the fixed island covers the top ~3.5rem on a phone */
			padding-top: 3.5rem;
		}
		.island-slot {
			display: none;
		}
		.status-cluster {
			grid-column: 1;
			justify-self: start;
			align-items: flex-start;
			text-align: left;
		}
		.view-strip {
			grid-column: 1;
			width: 100%;
			flex-wrap: wrap;
			gap: var(--space-2);
			border-radius: 0;
		}
		.center {
			height: auto;
			min-height: 0;
			padding-top: var(--space-4);
			padding-bottom: var(--space-4);
		}
		.view-pane {
			min-height: 420px;
			width: 100%;
		}
		.clock-pane {
			justify-content: flex-start;
			min-height: 14rem;
		}
		.music-pane {
			justify-content: stretch;
			min-height: 14rem;
		}
		.clock-credits {
			max-width: 100%;
		}
		/* the chips wrap onto extra lines at phone width; let the trough
		   grow to hold them instead of spilling out the bottom */
		.trough {
			height: auto;
			min-height: 6rem;
		}
		.bottom {
			min-height: 0;
			padding-bottom: calc(var(--space-6) + max(var(--floor-clearance) * 0.5, env(safe-area-inset-bottom)));
		}
	}
</style>
