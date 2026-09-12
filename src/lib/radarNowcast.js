/** Sample RainViewer tiles around Largo. Tiny getImageData patch, not a full-canvas read. */

import {
	LARGO_LAT,
	LARGO_LON,
	RADAR_ZOOM,
	homeTilePixel,
	lastPastFrameIndex,
	radarTileUrl
} from './radarMap.js';
import { samplePatchIntensity } from './rainModel.js';

const PATCH = 4;
const tileCache = new Map();

function loadTile(url) {
	if (typeof Image === 'undefined') return Promise.resolve(null);
	if (tileCache.has(url)) return tileCache.get(url);
	const p = new Promise((resolve) => {
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = () => resolve(img);
		img.onerror = () => resolve(null);
		img.src = url;
	});
	tileCache.set(url, p);
	return p;
}

function pickFrames(frames) {
	if (!frames?.length) return [];
	const lastPast = lastPastFrameIndex(frames);
	const out = [frames[lastPast]];
	const nowcast = frames.filter((f) => f.nowcast);
	const step = nowcast.length > 6 ? 2 : 1;
	for (let i = 0; i < nowcast.length; i += step) out.push(nowcast[i]);
	if (nowcast.length && out[out.length - 1] !== nowcast[nowcast.length - 1]) {
		out.push(nowcast[nowcast.length - 1]);
	}
	return out;
}

function intensityOf(img, px, py) {
	if (!img || typeof document === 'undefined') return 0;
	const c = document.createElement('canvas');
	c.width = img.width;
	c.height = img.height;
	const ctx = c.getContext('2d', { willReadFrequently: true });
	if (!ctx) return 0;
	ctx.drawImage(img, 0, 0);
	const x0 = Math.max(0, px - PATCH);
	const y0 = Math.max(0, py - PATCH);
	const w = Math.min(img.width - x0, PATCH * 2 + 1);
	const h = Math.min(img.height - y0, PATCH * 2 + 1);
	if (w < 1 || h < 1) return 0;
	const data = ctx.getImageData(x0, y0, w, h);
	return samplePatchIntensity(data.data, w, h);
}

/**
 * Fetch the home z7 tile for the latest past frame plus a few nowcast frames
 * and return `{ ts, intensity, nowcast }[]` for the rain model.
 */
export async function sampleRadarNowcast(rad) {
	const host = rad?.host;
	const frames = rad?.frames || [];
	if (!host || !frames.length) return [];
	const lat = Number.isFinite(rad.lat) ? rad.lat : LARGO_LAT;
	const lon = Number.isFinite(rad.lon) ? rad.lon : LARGO_LON;
	const home = homeTilePixel(lat, lon, RADAR_ZOOM);
	const picked = pickFrames(frames);
	const samples = [];
	await Promise.all(
		picked.map(async (frame) => {
			const url = radarTileUrl(host, frame.urlTemplate, RADAR_ZOOM, home.wrappedX, home.ty);
			const img = await loadTile(url);
			samples.push({
				ts: frame.ts,
				nowcast: Boolean(frame.nowcast),
				intensity: Number(intensityOf(img, home.px, home.py).toFixed(3))
			});
		})
	);
	samples.sort((a, b) => a.ts - b.ts);
	return samples;
}
