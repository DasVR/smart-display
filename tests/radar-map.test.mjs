import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	LARGO_LAT,
	LARGO_LON,
	TILE_SIZE,
	lonLatToFractionalTile,
	tilesCoveringRect
} from '../src/lib/radarMap.js';

describe('radar tile coverage', () => {
	it('pads one extra tile past the rectangle so east and south edges fill', () => {
		const frac = lonLatToFractionalTile(LARGO_LAT, LARGO_LON, 11);
		const halfW = 400;
		const halfH = 200;
		const rect = tilesCoveringRect(frac.x, frac.y, halfW, halfH, 11);
		const eastEdge = frac.x + halfW / TILE_SIZE;
		const southEdge = frac.y + halfH / TILE_SIZE;
		assert.ok(rect.x0 <= Math.floor(frac.x - halfW / TILE_SIZE) - 1);
		assert.ok(rect.x1 >= Math.floor(eastEdge) + 1);
		assert.ok(rect.y1 >= Math.floor(southEdge) + 1);
		assert.ok(rect.tiles.length >= 4);
	});
});
