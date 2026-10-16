/**
 * The wall's free voice: Piper voices, spoken on this machine through
 * sherpa-onnx (no account, no key, nothing leaves the wall).
 *
 * Voices are folders fetched by `npm run voice:piper` into
 * ~/.cache/wall-voice (PIPER_VOICES_DIR overrides), as sherpa-onnx packages
 * them: vits-piper-en_US-lessac-medium/{en_US-lessac-medium.onnx,
 * tokens.txt, espeak-ng-data/}. A voice loads once (about a second) and then
 * says a sentence in 0.15 to 0.3 s on two threads.
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PREFIX = 'vits-piper-';
/** The voice used when none is picked: American English, clear and neutral. */
export const DEFAULT_PIPER_VOICE = 'en_US-lessac-medium';

export function piperVoicesDir(env = process.env) {
	return String(env.PIPER_VOICES_DIR || '').trim() || path.join(os.homedir(), '.cache', 'wall-voice');
}

/** "en_US-lessac-medium" -> "Lessac (US English)" */
export function voiceLabel(name) {
	const m = /^([a-z]{2})_([A-Z]{2})-([a-z0-9_]+)-(x_low|low|medium|high)$/.exec(String(name || ''));
	if (!m) return String(name || '');
	const who = m[3].replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
	const where = { US: 'US', GB: 'British' }[m[2]] || m[2];
	return `${who} (${where} ${m[1] === 'en' ? 'English' : m[1]})`;
}

/** The voices on disk: [{ name, label }] (a folder counts once its model file is there). */
export function listPiperVoices(dir) {
	try {
		return readdirSync(dir)
			.filter((d) => d.startsWith(PREFIX))
			.map((d) => d.slice(PREFIX.length))
			.filter((name) => existsSync(path.join(dir, `${PREFIX}${name}`, `${name}.onnx`)))
			.sort()
			.map((name) => ({ name, label: voiceLabel(name) }));
	} catch {
		return [];
	}
}

/**
 * @param {object} o
 * @param {string} [o.dir] voices folder
 * @param {() => Promise<any>} [o.loadSherpa] how sherpa-onnx-node is loaded (tests pass a fake)
 */
export function createPiper({ dir = piperVoicesDir(), loadSherpa = () => import('sherpa-onnx-node'), log = console } = {}) {
	let loaded = null; // { name, tts, sherpa }
	let loading = null;

	function voices() {
		return listPiperVoices(dir);
	}

	async function engine(name) {
		if (loaded?.name === name) return loaded;
		if (loading) await loading.catch(() => {});
		if (loaded?.name === name) return loaded;
		loading = (async () => {
			const mod = await loadSherpa();
			const sherpa = mod.default || mod;
			const folder = path.join(dir, `${PREFIX}${name}`);
			const tts = new sherpa.OfflineTts({
				model: {
					vits: { model: path.join(folder, `${name}.onnx`), tokens: path.join(folder, 'tokens.txt'), dataDir: path.join(folder, 'espeak-ng-data') },
					numThreads: 2,
					provider: 'cpu'
				},
				maxNumSentences: 1
			});
			loaded = { name, tts, sherpa };
			log.info?.(`[voice] Piper ${name} loaded`);
			return loaded;
		})();
		try {
			return await loading;
		} finally {
			loading = null;
		}
	}

	/**
	 * Speak `text` into a .wav file. Resolves { ok: true } or { ok: false, error }:
	 * 'no-voice' (nothing fetched yet), 'no-engine' (sherpa-onnx-node missing),
	 * 'failed'. Never rejects.
	 */
	async function speak(text, file, voice = DEFAULT_PIPER_VOICE) {
		const have = voices();
		if (!have.length) return { ok: false, error: 'no-voice' };
		const name = have.some((v) => v.name === voice) ? voice : have.some((v) => v.name === DEFAULT_PIPER_VOICE) ? DEFAULT_PIPER_VOICE : have[0].name;
		let e;
		try {
			e = await engine(name);
		} catch (err) {
			log.warn?.(`[voice] Piper unavailable: ${err?.message || err}`);
			return { ok: false, error: 'no-engine' };
		}
		try {
			const audio = await e.tts.generateAsync({ text, sid: 0, speed: 1.0 });
			if (!audio?.samples?.length) return { ok: false, error: 'failed' };
			mkdirSync(path.dirname(file), { recursive: true });
			e.sherpa.writeWave(file, { samples: audio.samples, sampleRate: audio.sampleRate });
			return { ok: true, voice: name };
		} catch (err) {
			log.warn?.(`[voice] Piper failed: ${err?.message || err}`);
			return { ok: false, error: 'failed' };
		}
	}

	return { voices, speak, dir };
}
