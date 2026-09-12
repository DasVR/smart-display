/** English ordinal suffix for a calendar day. */
export function ordinalSuffix(n) {
	const num = Number(n);
	if (!Number.isFinite(num)) return '';
	const v = Math.abs(Math.trunc(num)) % 100;
	if (v >= 11 && v <= 13) return 'th';
	switch (v % 10) {
		case 1:
			return 'st';
		case 2:
			return 'nd';
		case 3:
			return 'rd';
		default:
			return 'th';
	}
}

/** Header date when the clock face is not showing: "September 12th". */
export function shortDateline(month, dayNum) {
	if (!month) return '';
	return `${month} ${dayNum}${ordinalSuffix(dayNum)}`;
}
