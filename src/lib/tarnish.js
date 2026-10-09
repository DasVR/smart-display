/**
 * How tarnished the liquid metal should look, from 0 (polished) to 1.
 *
 * Each overdue chore lets patina creep a little further in from the bottom-
 * left corner, more the longer it has been waiting, so the state of the
 * house reads from across the room without a word on screen. Marking it
 * done polishes the metal back (LiquidMetalCanvas sweeps a sheen across as
 * the patina recedes). Alerts never tarnish: they move on by themselves.
 */
import { taskStatus } from './tasks.js';

const PER_CHORE = 0.14; // a chore that just went overdue
const AGE_BONUS = 0.16; // extra once it has waited AGE_FULL_H
const AGE_FULL_H = 12;
const MAX = 0.75; // never swallow the whole screen

export function tarnishLevel(tasks, now = Date.now()) {
	if (!Array.isArray(tasks)) return 0;
	let level = 0;
	for (const t of tasks) {
		// recomputed here: the list's own `status` is only as fresh as its last broadcast
		if (t.kind !== 'chore' || taskStatus(t, now) !== 'overdue') continue;
		const hours = Math.max(0, (now - Date.parse(t.nextDue)) / 3600000) || 0;
		level += PER_CHORE + AGE_BONUS * Math.min(1, hours / AGE_FULL_H);
	}
	return Math.min(MAX, Math.round(level * 1000) / 1000);
}
