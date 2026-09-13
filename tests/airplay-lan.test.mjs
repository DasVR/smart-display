import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	AIRPLAY_UFW_RULES,
	discoverLanInterfaces,
	isLanIface,
	parseDefaultDev,
	patchAvahiServer,
	pickLanInterfaces
} from '../scripts/airplay-lan.mjs';

test('pickLanInterfaces keeps wifi/ethernet and drops docker veths', () => {
	assert.deepEqual(
		pickLanInterfaces(
			['lo', 'wlp3s0', 'docker0', 'docker_gwbridge', 'veth27f6493', 'br-80074459e3d2', 'enp2s0', 'tailscale0'],
			'wlp3s0'
		),
		['wlp3s0', 'enp2s0']
	);
	assert.equal(isLanIface('wlp3s0'), true);
	assert.equal(isLanIface('veth0de4567'), false);
	assert.equal(isLanIface('docker0'), false);
	assert.equal(isLanIface('docker_gwbridge'), false);
});

test('discoverLanInterfaces prefers the default-route iface only', () => {
	assert.deepEqual(
		discoverLanInterfaces({
			routeText: 'default via 192.168.1.1 dev wlp3s0 proto dhcp src 192.168.1.99 metric 600',
			names: ['lo', 'wlp3s0', 'enp2s0', 'docker0']
		}),
		['wlp3s0']
	);
	assert.deepEqual(
		discoverLanInterfaces({
			routeText: '',
			names: ['lo', 'wlp3s0', 'docker0']
		}),
		['wlp3s0']
	);
});

test('parseDefaultDev reads the default-route device', () => {
	assert.equal(
		parseDefaultDev('default via 192.168.1.1 dev wlp3s0 proto dhcp src 192.168.1.99 metric 600'),
		'wlp3s0'
	);
	assert.equal(parseDefaultDev(''), '');
});

test('patchAvahiServer pins LAN ifaces and turns off IPv6 mDNS', () => {
	const commented = `[server]\n#host-name=foo\n#allow-interfaces=eth0\n#deny-interfaces=eth1\n#use-ipv4=yes\n#use-ipv6=yes\n`;
	const patched = patchAvahiServer(commented, ['wlp3s0']);
	assert.match(patched, /^allow-interfaces=wlp3s0$/m);
	assert.match(patched, /^use-ipv4=yes$/m);
	assert.match(patched, /^use-ipv6=no$/m);
	assert.doesNotMatch(patched, /^#allow-interfaces=/m);
	assert.doesNotMatch(patched, /^#use-ipv6=/m);

	const missing = patchAvahiServer('[server]\nuse-ipv4=yes\n', ['wlp3s0', 'enp2s0']);
	assert.match(missing, /^allow-interfaces=wlp3s0,enp2s0$/m);
	assert.match(missing, /^use-ipv6=no$/m);
	assert.match(missing, /^use-ipv4=yes$/m);
});

test('AirPlay ufw rules include the real ephemeral range, not 3278:3289', () => {
	const specs = AIRPLAY_UFW_RULES.map(([spec]) => spec);
	assert.ok(specs.includes('32768:60999/udp'));
	assert.ok(specs.includes('32768:60999/tcp'));
	assert.ok(specs.includes('7000/tcp'));
	assert.ok(specs.includes('319:320/udp'));
	assert.equal(specs.some((s) => s.includes('3278:3289')), false);

	const setup = readFileSync(new URL('../scripts/airplay-setup.sh', import.meta.url), 'utf8');
	assert.match(setup, /airplay-lan\.mjs" ufw/);
	assert.match(setup, /ufw delete allow 3278:3289\/udp/);
});
