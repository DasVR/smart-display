import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	RADAR_THRESHOLDS,
	RADAR_FALLBACK_COLORS,
	CONTOUR_CHAIKIN_ITERATIONS,
	FIELD_MAX_ROWS,
	marchingSquares,
	chaikinSmooth,
	lerpFields,
	lerpColor,
	extractField,
	fieldGridSize,
	fieldExtent
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
		for (let i = 1; i < RADAR_THRESHOLDS.length; i++) {
			assert.ok(RADAR_THRESHOLDS[i] > RADAR_THRESHOLDS[i - 1]);
		}
	});

	it('uses at most one Chaikin pass so cells are not rounded into metaballs', () => {
		assert.ok(CONTOUR_CHAIKIN_ITERATIONS <= 1);
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
	it('reads alpha directly and averages real pixel color per band', () => {
		// 2 pixels: one fully opaque red (should land in the top band), one
		// fully transparent (below every threshold).
		const imageData = {
			width: 2,
			height: 1,
			data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0])
		};
		const field = extractField(imageData, [0.1, 0.9]);
		assert.equal(field.cols, 2);
		assert.equal(field.rows, 1);
		assert.deepEqual(Array.from(field.alpha), [1, 0]);
		assert.equal(field.colors[1], 'rgb(255, 0, 0)');
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

	it('emits one sampled color per default intensity band', () => {
		const imageData = {
			width: 1,
			height: 1,
			data: new Uint8ClampedArray([10, 20, 30, 0])
		};
		const field = extractField(imageData);
		assert.equal(field.colors.length, RADAR_THRESHOLDS.length);
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
