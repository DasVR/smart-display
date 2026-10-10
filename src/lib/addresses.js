/**
 * The addresses this display answers on, for the phone's Siri & Shortcuts
 * page: home Wi-Fi (works only at home) and Tailscale (works anywhere your
 * phone is on Tailscale). Pure: takes os.networkInterfaces() so it can be
 * tested; ws-server.js sends the result over /ws when a phone asks.
 */

const SKIP_IFACE = /^(lo|docker|br-|veth|virbr|cni|flannel|kube|tun0$)/i;

export function isTailscaleIp(ip) {
	const [a, b] = String(ip).split('.').map(Number);
	return a === 100 && b >= 64 && b <= 127;
}

export function isPrivateIp(ip) {
	const [a, b] = String(ip).split('.').map(Number);
	return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

export function listAddresses(interfaces, port, hostname = '') {
	const found = [];
	for (const [name, list] of Object.entries(interfaces || {})) {
		if (SKIP_IFACE.test(name)) continue;
		for (const i of list || []) {
			if ((i.family !== 'IPv4' && i.family !== 4) || i.internal) continue;
			const label = isTailscaleIp(i.address) ? 'Tailscale' : isPrivateIp(i.address) ? 'Home Wi-Fi' : 'Other';
			found.push({ label, host: `${i.address}:${port}` });
		}
	}
	const rank = { 'Home Wi-Fi': 0, Tailscale: 1, Other: 2 };
	found.sort((a, b) => rank[a.label] - rank[b.label]);
	if (/^[a-z0-9-]+$/i.test(hostname)) found.push({ label: 'Name', host: `${hostname}.local:${port}` });
	return found.filter((a, i) => found.findIndex((b) => b.host === a.host) === i);
}
