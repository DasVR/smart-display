import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const SKIP =
	/^(lo|docker\d*|veth.*|br-.*|virbr.*|tailscale\d*|tun\d*|wg\d*|cni.*|flannel.*|cbr.*|vnet.*|zt.*)$/i;

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

export function patchAvahiServer(text = '', ifaces = []) {
	const list = (Array.isArray(ifaces) ? ifaces : [])
		.map((n) => String(n).trim())
		.filter(Boolean)
		.join(',');
	if (!list) return String(text);
	let out = String(text || '');
	if (!/\[server\]/i.test(out)) out = `[server]\n${out}`;
	if (/^[ \t]*#?[ \t]*allow-interfaces\s*=/m.test(out)) {
		out = out.replace(/^[ \t]*#?[ \t]*allow-interfaces\s*=.*$/m, `allow-interfaces=${list}`);
	} else {
		out = out.replace(/\[server\]/i, `[server]\nallow-interfaces=${list}`);
	}
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
	return pickLanInterfaces(netNames, parseDefaultDev(route));
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
	} else {
		console.error('usage: airplay-lan.mjs print | avahi <ifaces> [conf]');
		process.exit(2);
	}
}
