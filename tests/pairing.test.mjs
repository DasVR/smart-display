import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPairing, isLocalAddress, cleanDeviceName, CODE_TTL_MS } from '../src/lib/server/pairing.js';

function setup(env = {}) {
	const dataDir = mkdtempSync(path.join(tmpdir(), 'pair-'));
	const clock = { now: Date.parse('2026-10-10T20:00:00Z') };
	const p = createPairing({ dataDir, now: () => clock.now, env });
	return { p, dataDir, clock };
}

test('a code from the wall buys one device token', () => {
	const { p, dataDir } = setup();
	const { code, expiresAt } = p.startCode();
	assert.match(code, /^\d{6}$/);
	assert.ok(expiresAt > Date.parse('2026-10-10T20:00:00Z'));
	const out = p.redeem(code.slice(0, 3) + ' ' + code.slice(3), "  Arriq's <b>iPhone</b>  ");
	assert.ok(out.token && out.token.length >= 40);
	assert.equal(out.device.name, "Arriq's iPhone");
	assert.equal(p.verify(out.token).id, out.device.id);
	assert.equal(p.verify('nope'), null);
	assert.equal(p.verify(''), null);
	// the code is single use
	assert.equal(p.redeem(code, 'Other').error, 'expired');
	// the token itself is never stored, only its hash
	const stored = readFileSync(path.join(dataDir, 'devices.json'), 'utf8');
	assert.equal(stored.includes(out.token), false);
	assert.match(stored, /"hash": "[a-f0-9]{64}"/);
});

test('codes run out after two minutes', () => {
	const { p, clock } = setup();
	const { code } = p.startCode();
	clock.now += CODE_TTL_MS + 1;
	assert.equal(p.redeem(code, 'Phone').error, 'expired');
});

test('five wrong guesses burn a code; ten across codes lock guessing for a while', () => {
	const { p, clock } = setup();
	let { code } = p.startCode();
	const wrong = code === '000000' ? '111111' : '000000';
	for (let i = 0; i < 4; i++) assert.equal(p.redeem(wrong, 'x').error, 'wrong-code');
	assert.equal(p.redeem(wrong, 'x').error, 'too-many-tries');
	assert.equal(p.redeem(code, 'x').error, 'expired', 'the burned code is gone');

	// a fresh code doesn't reset the overall budget
	({ code } = p.startCode());
	const wrong2 = code === '000000' ? '111111' : '000000';
	for (let i = 0; i < 4; i++) p.redeem(wrong2, 'x');
	({ code } = p.startCode());
	const wrong3 = code === '000000' ? '111111' : '000000';
	p.redeem(wrong3, 'x');
	assert.equal(p.redeem(code, 'x').error, 'too-many-tries', 'locked even with the right code');
	clock.now += 11 * 60000;
	({ code } = p.startCode());
	assert.ok(p.redeem(code, 'x').token, 'unlocked after ten minutes');
});

test('requiring pairing needs a paired phone, and the environment can always turn it off', () => {
	const { p } = setup();
	p.setRequired(true);
	assert.equal(p.required(), false, 'nobody paired yet: requiring would lock everyone out');
	const { code } = p.startCode();
	p.redeem(code, 'Phone');
	assert.equal(p.required(), true);

	const dataDir = mkdtempSync(path.join(tmpdir(), 'pair-'));
	const a = createPairing({ dataDir });
	a.setRequired(true);
	const c = a.startCode();
	a.redeem(c.code, 'Phone');
	const b = createPairing({ dataDir, env: { DISPLAY_REQUIRE_PAIRING: '0' } });
	assert.equal(b.required(), false);
	assert.equal(b.status().overriddenByEnv, true);
	assert.equal(b.status().requiredSetting, true);
});

test('revoking a phone stops its token working; renaming is cleaned', () => {
	const { p } = setup();
	const one = p.redeem(p.startCode().code, 'One');
	const two = p.redeem(p.startCode().code, 'Two');
	assert.equal(p.status().devices.length, 2);
	assert.equal(p.rename(two.device.id, '').name, 'Phone');
	assert.equal(p.revoke(one.device.id), true);
	assert.equal(p.revoke(one.device.id), false);
	assert.equal(p.verify(one.token), null);
	assert.ok(p.verify(two.token));
	assert.deepEqual(Object.keys(p.status().devices[0]).sort(), ['id', 'lastSeen', 'name', 'pairedAt'], 'no hashes leave the server');
});

test('the kiosk counts as local by loopback or by its own address', () => {
	assert.equal(isLocalAddress('127.0.0.1'), true);
	assert.equal(isLocalAddress('::1'), true);
	assert.equal(isLocalAddress('::ffff:127.0.0.1'), true);
	assert.equal(isLocalAddress('192.168.1.40', ['192.168.1.40', 'fe80::1']), true);
	assert.equal(isLocalAddress('::ffff:192.168.1.40', ['192.168.1.40']), true);
	assert.equal(isLocalAddress('192.168.1.77', ['192.168.1.40']), false);
	assert.equal(isLocalAddress('', []), false);
	assert.equal(isLocalAddress(undefined), false);
});

test('device names: short, plain, never empty', () => {
	assert.equal(cleanDeviceName('  Mom\u0007 \n phone '), 'Mom phone');
	assert.equal(cleanDeviceName('x'.repeat(50)).length, 32);
	assert.equal(cleanDeviceName(null), 'Phone');
});

test('nothing is written until someone pairs', () => {
	const { p, dataDir } = setup();
	p.startCode();
	assert.equal(existsSync(path.join(dataDir, 'devices.json')), false);
});
