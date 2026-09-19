import { LOAD_THRESHOLDS } from './displayLoad.js';

/** The host sidebar only comes out when the box is actually under load,
 *  a watched service is down, or the caller forced a peek. */
export function hostPeekNeeded({
	cpu = 0,
	ramPct = 0,
	quality = 'full',
	services = [],
	error = false,
	force = false
} = {}) {
	if (force) return true;
	if (error) return true;
	if (quality === 'eco' || quality === 'frozen') return true;
	if (Number(cpu) >= LOAD_THRESHOLDS.ecoCpu) return true;
	if (Number(ramPct) >= LOAD_THRESHOLDS.ecoRam) return true;
	if ((services || []).some((s) => s && !s.status)) return true;
	return false;
}
