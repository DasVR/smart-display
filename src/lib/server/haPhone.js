export function isSensorOn(state) {
	if (!state) return false;
	const value = String(state.state ?? '').toLowerCase();
	return value === 'on' || value === 'home' || value === 'unlocked';
}

export function becameOn(prev, next) {
	return !isSensorOn(prev) && isSensorOn(next);
}

function looksInteractive(entityId) {
	return /(?:^|_)(?:interactive|screen_on|android_screen)(?:_|$)/.test(entityId.replace(/^binary_sensor\./, ''));
}

export function pickPhoneWakeSensor(states = [], env = process.env) {
	const list = Array.isArray(states) ? states : [];
	const override = String(env.HA_PHONE_ENTITY || '').trim();
	if (override) {
		return list.find((item) => item.entity_id === override) || { entity_id: override, state: 'unknown' };
	}
	const sensors = list.filter(
		(item) =>
			typeof item?.entity_id === 'string' &&
			item.entity_id.startsWith('binary_sensor.') &&
			looksInteractive(item.entity_id)
	);
	sensors.sort((a, b) => a.entity_id.localeCompare(b.entity_id));
	return sensors[0] || null;
}

export function describePhoneSensor(sensor) {
	if (!sensor?.entity_id) return { entity: '', label: '', on: false };
	const label =
		sensor.attributes?.friendly_name ||
		sensor.entity_id.replace(/^binary_sensor\./, '').replace(/_/g, ' ');
	return { entity: sensor.entity_id, label, on: isSensorOn(sensor) };
}
