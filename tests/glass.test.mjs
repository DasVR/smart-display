import test from 'node:test';
import assert from 'node:assert/strict';
import { sdRoundRect, bezelHeight, bezelSlope, displacementPixels, lensKey } from '../src/lib/glass/displacement.js';
import { createFrameGovernor, effectiveGlassTier, GLASS_TIERS } from '../src/lib/glass/frameGovernor.js';

const px = (data, w, x, y) => {
	const i = (y * w + x) * 4;
	return [data[i], data[i + 1], data[i + 2], data[i + 3]];
};

test('rounded-rect SDF: negative inside, zero on the edge, positive outside', () => {
	assert.ok(sdRoundRect(0, 0, 50, 20, 8) < 0);
	assert.ok(Math.abs(sdRoundRect(50, 0, 50, 20, 8)) < 1e-9);
	assert.ok(sdRoundRect(60, 0, 50, 20, 8) > 0);
	// the corner is rounded: the box corner itself is outside
	assert.ok(sdRoundRect(50, 20, 50, 20, 8) > 0);
});

test('bezel is a convex lip: height climbs to 1, slope falls to 0', () => {
	assert.equal(bezelHeight(0), 0);
	assert.equal(bezelHeight(1), 1);
	assert.ok(bezelHeight(0.2) > 0.2, 'convex, so above the straight line');
	assert.equal(bezelSlope(0), 1);
	assert.equal(bezelSlope(1), 0);
	let prev = Infinity;
	for (let t = 0; t <= 1; t += 0.1) {
		const s = bezelSlope(t);
		assert.ok(s <= prev + 1e-9, `slope keeps falling at t=${t.toFixed(1)}`);
		prev = s;
	}
});

test('displacement map: neutral in the middle, bends inward at the rim', () => {
	const w = 120;
	const h = 60;
	const data = displacementPixels(w, h, { radius: 12, bezel: 14 });
	assert.equal(data.length, w * h * 4);
	assert.deepEqual(px(data, w, 60, 30), [128, 128, 128, 255], 'flat top shows the backdrop as is');
	const [rRight] = px(data, w, w - 1, 30);
	const [rLeft] = px(data, w, 0, 30);
	assert.ok(rRight < 56, `right rim samples from further in, to the left (R=${rRight})`);
	assert.ok(rLeft > 200, `left rim samples from further in, to the right (R=${rLeft})`);
	const [, gTop] = px(data, w, 60, 0);
	const [, gBottom] = px(data, w, 60, h - 1);
	assert.ok(gTop > 200 && gBottom < 56, 'top and bottom rims bend vertically, inward');
	// the corner pixel outside the rounded shape is untouched
	assert.deepEqual(px(data, w, 0, 0).slice(0, 2), [128, 128]);
});

test('displacement map survives tiny and odd sizes', () => {
	assert.equal(displacementPixels(3, 3, { radius: 40, bezel: 40 }).length, 36);
	assert.equal(displacementPixels(0.4, 7.6).length, 1 * 8 * 4);
	assert.equal(lensKey(120.4, 59.6, 12, 14), '120x60r12b14');
});

test('frame governor steps down when frames slip and climbs back slowly', () => {
	const gov = createFrameGovernor({ downAfterMs: 1000, upAfterMs: 3000 });
	assert.equal(gov.tier, 'refract');
	for (let i = 0; i < 120; i++) gov.sample(16.7);
	assert.equal(gov.tier, 'refract', 'healthy 60fps stays on the best tier');
	// the smoothed frame time takes a few frames to cross the line, then
	// a second of slipping drops a tier
	for (let i = 0; i < 35; i++) gov.sample(40);
	assert.equal(gov.tier, 'blur', 'about a second of 25fps drops a tier');
	for (let i = 0; i < 20; i++) gov.sample(40);
	assert.equal(gov.tier, 'flat');
	for (let i = 0; i < 60; i++) gov.sample(40);
	assert.equal(gov.tier, 'flat', 'never below the last tier');
	for (let i = 0; i < 100; i++) gov.sample(16.7);
	assert.equal(gov.tier, 'flat', 'one good second is not enough to climb');
	for (let i = 0; i < 200; i++) gov.sample(16.7);
	assert.equal(gov.tier, 'blur');
});

test('frame governor ignores hidden-tab gaps and junk samples', () => {
	const gov = createFrameGovernor({ downAfterMs: 500 });
	for (let i = 0; i < 20; i++) gov.sample(5000);
	gov.sample(NaN);
	gov.sample(-3);
	assert.equal(gov.tier, 'refract');
	assert.ok(Math.abs(gov.frameMs - 1000 / 60) < 0.01);
});

test('glass tier is capped by the load arbiter', () => {
	assert.deepEqual(GLASS_TIERS, ['refract', 'blur', 'flat']);
	assert.equal(effectiveGlassTier('refract', 'full'), 'refract');
	assert.equal(effectiveGlassTier('refract', 'eco'), 'blur');
	assert.equal(effectiveGlassTier('flat', 'eco'), 'flat');
	assert.equal(effectiveGlassTier('refract', 'frozen'), 'flat');
	assert.equal(effectiveGlassTier('bogus', 'full'), 'blur');
});
