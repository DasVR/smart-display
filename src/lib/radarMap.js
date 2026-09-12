/** 1706 Adams Cir S, Largo FL — parcel centroid from City of Largo GIS. */
export const LARGO_LAT = 27.90218731;
export const LARGO_LON = -82.7694744;

export const TILE_SIZE = 256;
/** RainViewer radar tiles are native only through z7; z8 is a placeholder image. */
export const RADAR_ZOOM = 7;
/** ESRI dark basemap zoom for the settled city view (streets, not the state). */
export const BASE_ZOOM = 11;

/** Ground radius shown after the intro zoom (Largo + nearest neighbors). */
export const CITY_GROUND_M = 14000;
/** Ground radius at intro start (Tampa Bay, then we push in). */
export const INTRO_GROUND_M = 38000;
/** Widest adaptive ground radius. Deliberately kept inside INTRO_GROUND_M
 *  rather than past it: those tiles are already fetched for the intro
 *  animation, so widening out to catch an approaching system costs a CSS
 *  zoom, not the extra basemap tiles a genuinely wider fetch would need
 *  (the tile count grows with the square of the radius — going much past
 *  the intro bound turned a several-tile fetch into hundreds). */
export const STORM_GROUND_M = 34000;

/** RainViewer serves the same tile cell at 256px or 512px — 512 is a real
 *  sharper raster for identical coverage, not just upscaling. */
export const RADAR_TILE_PX = 512;

export const ESRI_DARK_BASE =
	'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile';

const MAX_LAT = 85.05112878;
const EARTH_PX_Z0 = 156543.03392;

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

export function metersPerPixel(lat, zoom) {
	return (EARTH_PX_Z0 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/** CSS pixels per world pixel so `groundMeters` fills `radiusPx`. */
export function scaleForGroundRadius(radiusPx, lat, zoom, groundMeters) {
	const worldPx = groundMeters / metersPerPixel(lat, zoom);
	if (!worldPx) return 1;
	return radiusPx / worldPx;
}

export function radarDrawSize(baseZoom = BASE_ZOOM) {
	return TILE_SIZE * 2 ** (baseZoom - RADAR_ZOOM);
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
	return `${h}${p}/${RADAR_TILE_PX}/${z}/${x}/${y}/2/1_1.png`;
}

/** ESRI MapServer tiles are `{z}/{y}/{x}`, not OSM `{z}/{x}/{y}`. */
export function basemapTileUrl(z, x, y) {
	return `${ESRI_DARK_BASE}/${z}/${y}/${x}`;
}

/**
 * Integer tile range covering an axis-aligned rectangle of `halfWpx` × `halfHpx`
 * world pixels around a fractional tile coordinate.
 */
export function tilesCoveringRect(fracX, fracY, halfWpx, halfHpx, zoom = RADAR_ZOOM) {
	const n = 2 ** zoom;
	const padX = halfWpx / TILE_SIZE;
	const padY = halfHpx / TILE_SIZE;
	const x0 = Math.floor(fracX - padX);
	const x1 = Math.floor(fracX + padX);
	const y0 = Math.max(0, Math.floor(fracY - padY));
	const y1 = Math.min(n - 1, Math.floor(fracY + padY));
	const tiles = [];
	for (let ty = y0; ty <= y1; ty++) {
		for (let tx = x0; tx <= x1; tx++) {
			const wrappedX = ((tx % n) + n) % n;
			tiles.push({ tx, ty, wrappedX, wrappedY: ty });
		}
	}
	return { tiles, x0, x1, y0, y1 };
}

/**
 * Integer tile range covering a circle of `radiusPx` world pixels around a
 * fractional tile coordinate, assuming TILE_SIZE world pixels per tile.
 */
export function tilesCoveringRadius(fracX, fracY, radiusPx, zoom = RADAR_ZOOM) {
	return tilesCoveringRect(fracX, fracY, radiusPx, radiusPx, zoom);
}

/** Pixel inside the home z-tile for a lat/lon (RainViewer / OSM). */
export function homeTilePixel(lat, lon, zoom = RADAR_ZOOM) {
	const frac = lonLatToFractionalTile(lat, lon, zoom);
	const n = 2 ** zoom;
	const tx = Math.floor(frac.x);
	const ty = Math.floor(frac.y);
	const px = Math.floor((frac.x - tx) * TILE_SIZE);
	const py = Math.floor((frac.y - ty) * TILE_SIZE);
	const wrappedX = ((tx % n) + n) % n;
	return { tx, ty, px, py, n, wrappedX };
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
