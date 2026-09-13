import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	isLanIface,
	parseDefaultDev,
	patchAvahiServer,
	pickLanInterfaces
} from '../scripts/airplay-lan.mjs';

test('pickLanInterfaces keeps wifi/ethernet and drops docker veths', () => {
	assert.deepEqual(
		pickLanInterfaces(
			['lo', 'wlp3s0', 'docker0', 'veth27f6493', 'br-80074459e3d2', 'enp2s0', 'tailscale0'],
			'wlp3s0'
		),
		['wlp3s0', 'enp2s0']
	);
	assert.equal(isLanIface('wlp3s0'), true);
	assert.equal(isLanIface('veth0de4567'), false);
	assert.equal(isLanIface('docker0'), false);
});

test('parseDefaultDev reads the default-route device', () => {
	assert.equal(
		parseDefaultDev('default via 192.168.1.1 dev wlp3s0 proto dhcp src 192.168.1.99 metric 600'),
		'wlp3s0'
	);
	assert.equal(parseDefaultDev(''), '');
});

test('patchAvahiServer sets allow-interfaces in [server]', () => {
	const commented = `[server]\n#host-name=foo\n#allow-interfaces=eth0\n#deny-interfaces=eth1\n`;
	const patched = patchAvahiServer(commented, ['wlp3s0']);
	assert.match(patched, /^allow-interfaces=wlp3s0$/m);
	assert.doesNotMatch(patched, /^#allow-interfaces=/m);

	const missing = patchAvahiServer('[server]\nuse-ipv4=yes\n', ['wlp3s0', 'enp2s0']);
	assert.match(missing, /\[server\]\nallow-interfaces=wlp3s0,enp2s0/);
});
