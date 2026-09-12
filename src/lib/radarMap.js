/** Largo, FL — the kiosk's home point. */
export const LARGO_LAT = 27.9097;
export const LARGO_LON = -82.7873;

export const TILE_SIZE = 256;
/** RainViewer radar tiles are native only through z7; z8 is a placeholder image. */
export const RADAR_ZOOM = 7;

export const ESRI_DARK_BASE =
	'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile';

const MAX_LAT = 85.05112878;

/**
 * OSM / Web Mercator fractional tile coordinates at `zoom`.
 * Tile indices are `Math.floor(x)`, `Math.floor(y)`.
 */
export function lonLatToFractionalTile(lat, lon, zoom = RADAR_ZOOM) {
	const n = 2 ** zoom;
	const clampedLat = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
	const latRad = (clampedLat * Math.PI) / 180;
	const x = ((lon + 180) / 360) * n;
	const y =
		((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
	return { x, y, n };
}

/** Strip trailing slashes and a leftover `/256` size segment from a RainViewer path. */
export function normalizeRadarPath(path) {
	return String(path || '')
		.replace(/\/+$/, '')
		.replace(/\/256$/, '');
}

export function radarTileUrl(host, path, z, x, y) {
	const h = String(host || '').replace(/\/+$/, '');
	const p = normalizeRadarPath(path);
	return `${h}${p}/256/${z}/${x}/${y}/2/1_1.png`;
}

/** ESRI MapServer tiles are `{z}/{y}/{x}`, not OSM `{z}/{x}/{y}`. */
export function basemapTileUrl(z, x, y) {
	return `${ESRI_DARK_BASE}/${z}/${y}/${x}`;
}

/**
 * Integer tile range covering a circle of `radiusPx` canvas pixels around a
 * fractional tile coordinate, assuming 1 world pixel = 1 CSS pixel at TILE_SIZE.
 */
export function tilesCoveringRadius(fracX, fracY, radiusPx, zoom = RADAR_ZOOM) {
	const n = 2 ** zoom;
	const pad = radiusPx / TILE_SIZE;
	const x0 = Math.floor(fracX - pad);
	const x1 = Math.floor(fracX + pad);
	const y0 = Math.max(0, Math.floor(fracY - pad));
	const y1 = Math.min(n - 1, Math.floor(fracY + pad));
	const tiles = [];
	for (let ty = y0; ty <= y1; ty++) {
		for (let tx = x0; tx <= x1; tx++) {
			const wrappedX = ((tx % n) + n) % n;
			tiles.push({ tx, ty, wrappedX, wrappedY: ty });
		}
	}
	return { tiles, x0, x1, y0, y1 };
}

/** Index of the most recent observed (non-nowcast) frame; 0 if none. */
export function lastPastFrameIndex(frames) {
	let idx = 0;
	if (!frames?.length) return idx;
	for (let i = 0; i < frames.length; i++) {
		if (!frames[i].nowcast) idx = i;
	}
	return idx;
}
