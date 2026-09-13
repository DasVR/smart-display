import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// Virtual / overlay ifaces. iOS will see Smart Display on these and then
// fail the AirPlay handshake because 172.x / fe80::veth is not on the LAN.
const SKIP =
	/^(lo|docker.*|veth.*|br-.*|virbr.*|tailscale.*|tun\d*|wg\d*|cni.*|flannel.*|cbr.*|vnet.*|zt.*)$/i;

export const AIRPLAY_UFW_RULES = [
	['5353/udp', 'mDNS'],
	['7000/tcp', 'AirPlay 2'],
	['319:320/udp', 'nqptp'],
	['5000/tcp', 'AirPlay audio'],
	['3689/tcp', 'AirPlay DAAP'],
	['6000:6009/udp', 'AirPlay timing'],
	['32768:60999/udp', 'AirPlay 2 ephemeral'],
	['32768:60999/tcp', 'AirPlay 2 ephemeral']
];

export function isLanIface(name = '') {
	return Boolean(name) && !SKIP.test(String(name));
}

export function pickLanInterfaces(names = [], defaultDev = '') {
	const out = [];
	const add = (n) => {
		const name = String(n || '').trim();
		if (!isLanIface(name) || out.includes(name)) return;
		out.push(name);
	};
	add(defaultDev);
	for (const n of names) add(n);
	return out;
}

export function parseDefaultDev(routeText = '') {
	const m = String(routeText).match(/\bdev\s+(\S+)/);
	return m ? m[1] : '';
}

function setAvahiKey(text, key, value) {
	const re = new RegExp(`^[ \\t]*#?[ \\t]*${key}\\s*=.*$`, 'm');
	if (re.test(text)) return text.replace(re, `${key}=${value}`);
	return text.replace(/\[server\]/i, `[server]\n${key}=${value}`);
}

export function patchAvahiServer(text = '', ifaces = []) {
	const list = (Array.isArray(ifaces) ? ifaces : [])
		.map((n) => String(n).trim())
		.filter(Boolean)
		.join(',');
	if (!list) return String(text);
	let out = String(text || '');
	if (!/\[server\]/i.test(out)) out = `[server]\n${out}`;
	out = setAvahiKey(out, 'allow-interfaces', list);
	// iOS prefers AAAA. A public IPv6 on Wi-Fi plus Docker fe80:: records
	// is a common "I can see it but it will not connect" shape.
	out = setAvahiKey(out, 'use-ipv4', 'yes');
	out = setAvahiKey(out, 'use-ipv6', 'no');
	return out;
}

export function listNetNames(dir = '/sys/class/net') {
	try {
		return readdirSync(dir);
	} catch {
		return [];
	}
}

export function discoverLanInterfaces({
	routeText,
	names
} = {}) {
	const route =
		routeText ??
		(() => {
			try {
				return execSync('ip -4 route show default', { encoding: 'utf8', timeout: 2000 });
			} catch {
				return '';
			}
		})();
	const netNames = names ?? listNetNames();
	const defaultDev = parseDefaultDev(route);
	if (isLanIface(defaultDev)) return [defaultDev];
	return pickLanInterfaces(netNames, '');
}

const isMain = process.argv[1] && process.argv[1].endsWith('airplay-lan.mjs');
if (isMain) {
	const cmd = process.argv[2] || 'print';
	if (cmd === 'print') {
		process.stdout.write(discoverLanInterfaces().join(',') + '\n');
	} else if (cmd === 'avahi') {
		const ifaces = (process.argv[3] || '').split(',').filter(Boolean);
		const file = process.argv[4] || '/etc/avahi/avahi-daemon.conf';
		const next = patchAvahiServer(readFileSync(file, 'utf8'), ifaces);
		writeFileSync(file, next);
	} else if (cmd === 'ufw') {
		for (const [spec, comment] of AIRPLAY_UFW_RULES) {
			process.stdout.write(`${spec}\t${comment}\n`);
		}
	} else {
		console.error('usage: airplay-lan.mjs print | avahi <ifaces> [conf] | ufw');
		process.exit(2);
	}
}
