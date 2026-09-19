import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	RADAR_THRESHOLDS,
	RADAR_FALLBACK_COLORS,
	RADAR_BAND_ALPHAS,
	RADAR_RAIN_PALETTE,
	CONTOUR_CHAIKIN_ITERATIONS,
	FIELD_MAX_ROWS,
	marchingSquares,
	chaikinSmooth,
	lerpFields,
	lerpColor,
	extractField,
	fieldGridSize,
	fieldExtent,
	nearestRadarColor,
	dbzToIntensity,
	rainFillAlpha,
	pruneRadarSpeckle,
	sizableContours,
	contourArea,
	RADAR_MIN_CLUSTER_CELLS,
	RADAR_MIN_LIGHT_CLUSTER_CELLS,
	RADAR_MIN_CONTOUR_AREA,
	RADAR_COLOR_MAX_DIST_SQ,
	placeFieldOnGrid
} from '../src/lib/radarVector.js';

function shoelaceArea(points) {
	let area = 0;
	for (let i = 0; i < points.length; i++) {
		const [x1, y1] = points[i];
		const [x2, y2] = points[(i + 1) % points.length];
		area += x1 * y2 - x2 * y1;
	}
	return Math.abs(area) / 2;
}

function makeSquareField(cols, rows, x0, y0, x1, y1) {
	const field = new Float32Array(cols * rows);
	for (let y = y0; y <= y1; y++) {
		for (let x = x0; x <= x1; x++) {
			field[y * cols + x] = 1;
		}
	}
	return field;
}

describe('marchingSquares', () => {
	it('traces a single closed contour around an interior block', () => {
		const cols = 12;
		const rows = 12;
		const field = makeSquareField(cols, rows, 4, 4, 7, 7);
		const polys = marchingSquares(field, cols, rows, 0.5);
		assert.equal(polys.length, 1);
		const area = shoelaceArea(polys[0]);
		// The block is 4x4 cells (3..8 edge-to-edge in grid units); allow
		// slack for interpolation landing mid-cell at the boundary.
		assert.ok(area > 10 && area < 20, `unexpected area ${area}`);
	});

	it('finds nothing when the field never reaches the threshold', () => {
		const cols = 8;
		const rows = 8;
		const field = new Float32Array(cols * rows);
		const polys = marchingSquares(field, cols, rows, 0.5);
		assert.equal(polys.length, 0);
	});

	it('finds nothing when the whole field is above the threshold', () => {
		const cols = 8;
		const rows = 8;
		const field = new Float32Array(cols * rows).fill(1);
		const polys = marchingSquares(field, cols, rows, 0.5);
		assert.equal(polys.length, 0);
	});

	it('traces two separate contours for two disjoint blocks', () => {
		const cols = 20;
		const rows = 10;
		const field = new Float32Array(cols * rows);
		for (let y = 2; y <= 5; y++) {
			for (let x = 2; x <= 5; x++) field[y * cols + x] = 1;
			for (let x = 12; x <= 15; x++) field[y * cols + x] = 1;
		}
		const polys = marchingSquares(field, cols, rows, 0.5);
		assert.equal(polys.length, 2);
	});

	it('places the contour by linear interpolation, not on the cell grid', () => {
		// A single row transitioning 0 -> 1 -> 0 has crossing points that
		// depend on the actual values, not just the cell index.
		const cols = 6;
		const rows = 3;
		const field = new Float32Array(cols * rows);
		// Middle row: 0, 0.2, 1, 1, 0.2, 0 -> threshold 0.5 crossings land
		// between columns 1-2 and 3-4, not exactly on integer grid lines.
		const mid = [0, 0.2, 1, 1, 0.2, 0];
		for (let x = 0; x < cols; x++) field[1 * cols + x] = mid[x];
		const polys = marchingSquares(field, cols, rows, 0.5);
		assert.equal(polys.length, 1);
		const xs = polys[0].map((p) => p[0]);
		const hasNonInteger = xs.some((x) => Math.abs(x - Math.round(x)) > 1e-6);
		assert.ok(hasNonInteger, 'expected interpolated (non-integer) crossing points');
	});
});

describe('radar contour fidelity', () => {
	it('keeps enough intensity bands that RainViewer color steps stay distinct', () => {
		assert.ok(RADAR_THRESHOLDS.length >= 10);
		assert.equal(RADAR_FALLBACK_COLORS.length, RADAR_THRESHOLDS.length);
		assert.equal(RADAR_RAIN_PALETTE.length, RADAR_THRESHOLDS.length);
		for (let i = 1; i < RADAR_THRESHOLDS.length; i++) {
			assert.ok(RADAR_THRESHOLDS[i] > RADAR_THRESHOLDS[i - 1]);
			assert.ok(RADAR_RAIN_PALETTE[i].dbz > RADAR_RAIN_PALETTE[i - 1].dbz);
		}
	});

	it('uses at most one Chaikin pass so cells are not rounded into metaballs', () => {
		assert.ok(CONTOUR_CHAIKIN_ITERATIONS <= 1);
	});

	it('fills each rain type with slight transparency, heavier a bit more solid', () => {
		assert.equal(RADAR_BAND_ALPHAS.length, RADAR_THRESHOLDS.length);
		for (const a of RADAR_BAND_ALPHAS) {
			assert.ok(a >= 0.6 && a <= 0.9, `expected slight transparency, got ${a}`);
		}
		assert.ok(RADAR_BAND_ALPHAS[0] < RADAR_BAND_ALPHAS[RADAR_BAND_ALPHAS.length - 1]);
		assert.ok(rainFillAlpha(15) < rainFillAlpha(50));
	});
});

describe('chaikinSmooth', () => {
	it('returns the original polygon when asked for zero iterations', () => {
		const square = [
			[0, 0],
			[10, 0],
			[10, 10],
			[0, 10]
		];
		const none = chaikinSmooth(square, 0);
		assert.deepEqual(none, square);
	});

	it('roughly doubles the point count per iteration', () => {
		const square = [
			[0, 0],
			[10, 0],
			[10, 10],
			[0, 10]
		];
		const once = chaikinSmooth(square, 1);
		assert.equal(once.length, square.length * 2);
		const twice = chaikinSmooth(square, 2);
		assert.equal(twice.length, square.length * 4);
	});

	it('cuts corners inward, shrinking the enclosed area', () => {
		const square = [
			[0, 0],
			[10, 0],
			[10, 10],
			[0, 10]
		];
		const smoothed = chaikinSmooth(square, 3);
		const originalArea = shoelaceArea(square);
		const smoothedArea = shoelaceArea(smoothed);
		assert.ok(smoothedArea < originalArea, 'corner-cutting should shrink the area');
		assert.ok(smoothedArea > originalArea * 0.7, 'should not over-shrink after a few iterations');
	});
});

describe('lerpFields', () => {
	it('interpolates element-wise', () => {
		const a = new Float32Array([0, 0.2, 1]);
		const b = new Float32Array([1, 0.8, 0]);
		const close = (actual, expected) =>
			actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-6, `${v} ~= ${expected[i]}`));
		close(Array.from(lerpFields(a, b, 0)), [0, 0.2, 1]);
		close(Array.from(lerpFields(a, b, 1)), [1, 0.8, 0]);
		const mid = Array.from(lerpFields(a, b, 0.5));
		assert.ok(Math.abs(mid[0] - 0.5) < 1e-6);
		assert.ok(Math.abs(mid[1] - 0.5) < 1e-6);
		assert.ok(Math.abs(mid[2] - 0.5) < 1e-6);
	});
});

describe('lerpColor', () => {
	it('blends two rgb strings', () => {
		assert.equal(lerpColor('rgb(0, 0, 0)', 'rgb(255, 255, 255)', 0), 'rgb(0, 0, 0)');
		assert.equal(lerpColor('rgb(0, 0, 0)', 'rgb(255, 255, 255)', 1), 'rgb(255, 255, 255)');
		assert.equal(lerpColor('rgb(0, 0, 0)', 'rgb(200, 100, 0)', 0.5), 'rgb(100, 50, 0)');
	});
});

describe('extractField', () => {
	it('maps a pixel onto the matching rain type instead of using raw alpha', () => {
		const light = RADAR_RAIN_PALETTE[1];
		const imageData = {
			width: 2,
			height: 1,
			data: new Uint8ClampedArray([light.r, light.g, light.b, 255, 0, 0, 0, 0])
		};
		const field = extractField(imageData, undefined, undefined, { minCluster: 1 });
		assert.equal(field.cols, 2);
		assert.equal(field.rows, 1);
		assert.equal(field.alpha[1], 0);
		assert.ok(Math.abs(field.alpha[0] - dbzToIntensity(light.dbz)) < 1e-6);
		assert.equal(field.colors[1], `rgb(${light.r}, ${light.g}, ${light.b})`);
	});

	it('keeps light rain and heavy rain in separate color bands', () => {
		const light = RADAR_RAIN_PALETTE[1];
		const heavy = RADAR_RAIN_PALETTE[5];
		const imageData = {
			width: 2,
			height: 1,
			data: new Uint8ClampedArray([
				light.r,
				light.g,
				light.b,
				255,
				heavy.r,
				heavy.g,
				heavy.b,
				255
			])
		};
		const field = extractField(imageData, undefined, undefined, { minCluster: 1 });
		assert.equal(field.colors[1], `rgb(${light.r}, ${light.g}, ${light.b})`);
		assert.equal(field.colors[5], `rgb(${heavy.r}, ${heavy.g}, ${heavy.b})`);
		assert.notEqual(field.colors[1], field.colors[5]);
	});

	it('falls back to the given fallback color for an empty band', () => {
		const imageData = {
			width: 1,
			height: 1,
			data: new Uint8ClampedArray([10, 20, 30, 0])
		};
		const field = extractField(imageData, [0.5], ['rgb(1, 2, 3)']);
		assert.equal(field.colors[0], 'rgb(1, 2, 3)');
	});

	it('emits one sampled color and opacity per default intensity band', () => {
		const imageData = {
			width: 1,
			height: 1,
			data: new Uint8ClampedArray([10, 20, 30, 0])
		};
		const field = extractField(imageData);
		assert.equal(field.colors.length, RADAR_THRESHOLDS.length);
		assert.equal(field.opacities.length, RADAR_THRESHOLDS.length);
		assert.deepEqual(field.opacities, RADAR_BAND_ALPHAS);
	});
});

describe('nearestRadarColor', () => {
	it('snaps a cyan sample to light rain, not heavy yellow', () => {
		const light = RADAR_RAIN_PALETTE[1];
		const match = nearestRadarColor(light.r, light.g, light.b);
		assert.equal(match.dbz, 15);
		const yellow = nearestRadarColor(255, 238, 0);
		assert.equal(yellow.dbz, 35);
	});
});

describe('pruneRadarSpeckle', () => {
	it('clears isolated crumbs and keeps a real cell', () => {
		const cols = 20;
		const rows = 12;
		const field = new Float32Array(cols * rows);
		field[2 * cols + 2] = 0.4;
		field[2 * cols + 3] = 0.4;
		for (let y = 4; y <= 10; y++) {
			for (let x = 8; x <= 16; x++) field[y * cols + x] = 0.7;
		}
		pruneRadarSpeckle(field, cols, rows, 12);
		assert.equal(field[2 * cols + 2], 0);
		assert.equal(field[2 * cols + 3], 0);
		assert.ok(field[7 * cols + 12] > 0);
	});

	it('drops a 1-pixel rain return from extractField by default', () => {
		const light = RADAR_RAIN_PALETTE[1];
		const imageData = {
			width: 8,
			height: 8,
			data: new Uint8ClampedArray(8 * 8 * 4)
		};
		const i = (3 * 8 + 3) * 4;
		imageData.data[i] = light.r;
		imageData.data[i + 1] = light.g;
		imageData.data[i + 2] = light.b;
		imageData.data[i + 3] = 255;
		const field = extractField(imageData);
		assert.ok(RADAR_MIN_CLUSTER_CELLS >= 8);
		assert.equal(field.alpha[3 * 8 + 3], 0);
	});

	it('drops a medium cyan island with no core, keeps a small yellow core', () => {
		const light = RADAR_RAIN_PALETTE[1];
		const heavy = RADAR_RAIN_PALETTE[5];
		const W = 24;
		const H = 16;
		const data = new Uint8ClampedArray(W * H * 4);
		const put = (x, y, c) => {
			const o = (y * W + x) * 4;
			data[o] = c.r;
			data[o + 1] = c.g;
			data[o + 2] = c.b;
			data[o + 3] = 255;
		};
		for (let y = 1; y <= 6; y++) for (let x = 1; x <= 6; x++) put(x, y, light);
		for (let y = 9; y <= 13; y++) for (let x = 14; x <= 18; x++) put(x, y, heavy);
		const field = extractField({ width: W, height: H, data });
		assert.ok(RADAR_MIN_LIGHT_CLUSTER_CELLS > 36);
		assert.equal(field.alpha[3 * W + 3], 0);
		assert.ok(field.alpha[11 * W + 16] > 0);
	});

	it('ignores basemap gray that is not a palette stop', () => {
		const imageData = {
			width: 4,
			height: 4,
			data: new Uint8ClampedArray(4 * 4 * 4)
		};
		for (let i = 0; i < 16; i++) {
			const o = i * 4;
			imageData.data[o] = 80;
			imageData.data[o + 1] = 80;
			imageData.data[o + 2] = 80;
			imageData.data[o + 3] = 255;
		}
		const field = extractField(imageData, undefined, undefined, { minCluster: 1 });
		assert.ok(RADAR_COLOR_MAX_DIST_SQ > 0);
		assert.equal(field.alpha[0], 0);
	});
});

describe('placeFieldOnGrid', () => {
	it('nearest-neighbor stamps a native field onto a coarser grid', () => {
		const src = {
			alpha: new Float32Array([0, 0.5, 0.5, 0]),
			cols: 2,
			rows: 2,
			colors: ['rgb(1, 2, 3)'],
			opacities: [0.7]
		};
		const placed = placeFieldOnGrid(src, 4, 4, 0, 0, 4, 4);
		assert.equal(placed.cols, 4);
		assert.equal(placed.rows, 4);
		assert.equal(placed.alpha[0], 0);
		assert.ok(placed.alpha[2] > 0);
		assert.equal(placed.alpha[1 * 4 + 0], 0);
		assert.ok(placed.alpha[2 * 4 + 0] > 0);
		assert.equal(placed.colors[0], 'rgb(1, 2, 3)');
	});

	it('leaves dest cells outside the dest rect dry', () => {
		const src = {
			alpha: new Float32Array([1]),
			cols: 1,
			rows: 1,
			colors: [],
			opacities: []
		};
		const placed = placeFieldOnGrid(src, 4, 4, 2, 2, 2, 2);
		assert.equal(placed.alpha[0], 0);
		assert.ok(placed.alpha[2 * 4 + 2] > 0);
	});
});

describe('sizableContours', () => {
	it('filters polygons below the area floor', () => {
		const tiny = [
			[0, 0],
			[1, 0],
			[1, 1],
			[0, 1]
		];
		const big = [
			[0, 0],
			[10, 0],
			[10, 10],
			[0, 10]
		];
		assert.ok(contourArea(tiny) < RADAR_MIN_CONTOUR_AREA);
		assert.deepEqual(sizableContours([tiny, big]), [big]);
	});
});

describe('fieldExtent', () => {
	it('reports min/max so a caller can tell "no coverage" from "total coverage"', () => {
		const empty = new Float32Array(16).fill(0);
		assert.deepEqual(fieldExtent(empty), { min: 0, max: 0 });

		const full = new Float32Array(16).fill(1);
		assert.deepEqual(fieldExtent(full), { min: 1, max: 1 });

		const mixed = new Float32Array([0, 0.4, 0.9, 0.2]);
		const extent = fieldExtent(mixed);
		assert.equal(extent.min, 0);
		assert.ok(Math.abs(extent.max - 0.9) < 1e-6);
	});

	it('flags whole-grid coverage as a case marchingSquares alone would miss', () => {
		// A field entirely above threshold has no boundary inside the grid -
		// marchingSquares correctly finds nothing to trace, but that's a
		// storm filling the whole view, not an empty one; fieldExtent is
		// what lets a caller distinguish the two and fill solid instead.
		const cols = 8;
		const rows = 8;
		const full = new Float32Array(cols * rows).fill(0.9);
		const polys = marchingSquares(full, cols, rows, 0.5);
		assert.equal(polys.length, 0);
		const extent = fieldExtent(full);
		assert.ok(extent.min >= 0.5, 'whole grid is above threshold');
	});
});

describe('fieldGridSize', () => {
	it('keeps cells roughly square for a wide bbox', () => {
		const { cols, rows } = fieldGridSize(2000, 1000, 72);
		assert.equal(cols, 72);
		assert.equal(rows, 36);
	});

	it('clamps rows into a sane range for extreme aspect ratios', () => {
		const wide = fieldGridSize(100000, 100, 72);
		assert.ok(wide.rows >= 24);
		const tall = fieldGridSize(100, 100000, 72);
		assert.ok(tall.rows <= FIELD_MAX_ROWS);
		assert.equal(FIELD_MAX_ROWS, 256);
	});

	it('keeps a 192-col square radar from clamping below native cell density', () => {
		const { cols, rows } = fieldGridSize(1600, 1600, 192);
		assert.equal(cols, 192);
		assert.equal(rows, 192);
	});

	it('defaults to a 192-col grid so city zoom samples near native rain pixels', () => {
		const { cols } = fieldGridSize(1600, 1200);
		assert.equal(cols, 192);
	});
});
