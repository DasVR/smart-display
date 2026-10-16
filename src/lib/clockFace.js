// The pieces every Clock face needs, on the wall's clock: the time in parts,
// the date line, and which weather glyph the words call for.
import { DISPLAY_TZ } from './atmosphere.js';

/** { h (0-23), m, s, h12 ('8'), mm ('04'), ss ('35'), ampm } in the wall's time zone. */
export function timeParts(date, timeZone = DISPLAY_TZ) {
	const p = Object.fromEntries(
		new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
			.formatToParts(date)
			.map((x) => [x.type, x.value])
	);
	const h = Number(p.hour) % 24;
	const m = Number(p.minute);
	const s = Number(p.second);
	return { h, m, s, h12: String(h % 12 || 12), mm: String(m).padStart(2, '0'), ss: String(s).padStart(2, '0'), ampm: h >= 12 ? 'PM' : 'AM' };
}

/** "Thursday, October 15" */
export function dateLine(date, timeZone = DISPLAY_TZ) {
	return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone });
}

/** sun, moon, sun-cloud, moon-cloud, cloud, rain, snow, storm or fog, from the forecast's words. */
export function skyFor(desc, hour) {
	const d = String(desc || '').toLowerCase();
	const night = hour < 6 || hour >= 19;
	if (/thunder|storm/.test(d)) return 'storm';
	if (/snow|sleet|flurr/.test(d)) return 'snow';
	if (/rain|shower|drizzle/.test(d)) return 'rain';
	if (/fog|mist|haze|smoke/.test(d)) return 'fog';
	if (/partly|mostly sunny|few|scattered/.test(d)) return night ? 'moon-cloud' : 'sun-cloud';
	if (/cloud|overcast/.test(d)) return 'cloud';
	return night ? 'moon' : 'sun';
}
