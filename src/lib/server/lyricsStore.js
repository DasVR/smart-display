import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

// node:sqlite ships with Node 22.5+ (unflagged since 22.13). Loaded through
// createRequire so a Node that predates it still boots the server: the store
// then degrades to the same in-memory behavior lyrics.js had before the DB
// existed, and says so once on stderr.
const require = createRequire(import.meta.url);
let DatabaseSync = null;
{
	// Requiring node:sqlite prints "SQLite is an experimental feature" on
	// every boot. The API surface used here (DatabaseSync/prepare/run/get)
	// has been stable since 22.5, so swallow that one warning only.
	const emitWarning = process.emitWarning;
	process.emitWarning = (warning, ...rest) => {
		const type = typeof rest[0] === 'string' ? rest[0] : rest[0]?.type;
		if (type === 'ExperimentalWarning' && /sqlite/i.test(String(warning))) return;
		return emitWarning.call(process, warning, ...rest);
	};
	try {
		({ DatabaseSync } = require('node:sqlite'));
	} catch {
		DatabaseSync = null;
	} finally {
		process.emitWarning = emitWarning;
	}
}

export const LYRICS_DB_SCHEMA_VERSION = 2;

const SCHEMA = `
	PRAGMA journal_mode = WAL;
	PRAGMA synchronous = NORMAL;
	CREATE TABLE IF NOT EXISTS lyrics (
		key TEXT PRIMARY KEY,
		artist TEXT NOT NULL,
		title TEXT NOT NULL,
		album TEXT NOT NULL DEFAULT '',
		duration INTEGER NOT NULL DEFAULT 0,
		source TEXT,
		word_level INTEGER NOT NULL DEFAULT 0,
		lines TEXT,
		plain TEXT,
		fetched_at INTEGER NOT NULL,
		ttl INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS lyrics_track ON lyrics (artist, title);
	CREATE TABLE IF NOT EXISTS alignments (
		fingerprint TEXT PRIMARY KEY,
		artist TEXT NOT NULL DEFAULT '',
		title TEXT NOT NULL DEFAULT '',
		duration INTEGER NOT NULL DEFAULT 0,
		engine TEXT NOT NULL,
		precise INTEGER NOT NULL DEFAULT 0,
		lines TEXT NOT NULL,
		created_at INTEGER NOT NULL
	);
	CREATE TABLE IF NOT EXISTS lyric_picks (
		key TEXT PRIMARY KEY,
		artist TEXT NOT NULL DEFAULT '',
		title TEXT NOT NULL DEFAULT '',
		album TEXT NOT NULL DEFAULT '',
		duration INTEGER NOT NULL DEFAULT 0,
		display_source TEXT,
		cache_source TEXT,
		pinned INTEGER NOT NULL DEFAULT 0,
		updated_at INTEGER NOT NULL
	);
	CREATE TABLE IF NOT EXISTS meta (
		key TEXT PRIMARY KEY,
		value TEXT
	);
`;

let db = null;
let dbPath = null;
let warnedNoSqlite = false;
let legacyImported = false;

export function lyricsDbPath() {
	return process.env.LYRICS_DB_PATH || path.join(process.cwd(), 'data', 'lyrics.db');
}

export function lyricsDbAvailable() {
	return Boolean(DatabaseSync);
}

function legacyAlignmentDir() {
	return process.env.FORCED_ALIGN_CACHE_DIR || path.join(process.cwd(), 'data', 'forced-align-cache');
}

function open() {
	const wanted = lyricsDbPath();
	if (db && dbPath === wanted) return db;
	if (!DatabaseSync) {
		if (!warnedNoSqlite) {
			warnedNoSqlite = true;
			console.warn('lyrics db: node:sqlite unavailable on this Node; lyrics cache is memory-only');
		}
		return null;
	}
	if (db) {
		try {
			db.close();
		} catch {
			/* already closed */
		}
		db = null;
		legacyImported = false;
	}
	try {
		mkdirSync(path.dirname(wanted), { recursive: true });
		const next = new DatabaseSync(wanted);
		next.exec(SCHEMA);
		next
			.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
			.run('schema', String(LYRICS_DB_SCHEMA_VERSION));
		db = next;
		dbPath = wanted;
		importLegacyAlignments(next);
		return db;
	} catch (error) {
		console.error('lyrics db open failed:', error.message);
		db = null;
		dbPath = null;
		return null;
	}
}

/** One-shot import of the pre-DB `data/forced-align-cache/<fp>.json`
 *  files so an upgrade keeps every alignment the kiosk already computed.
 *  Files stay on disk; the DB is simply the copy that gets read. */
function importLegacyAlignments(handle) {
	if (legacyImported) return;
	legacyImported = true;
	const dir = legacyAlignmentDir();
	if (!existsSync(dir)) return;
	let names = [];
	try {
		names = readdirSync(dir).filter((name) => name.endsWith('.json'));
	} catch {
		return;
	}
	if (!names.length) return;
	const exists = handle.prepare('SELECT 1 FROM alignments WHERE fingerprint = ?');
	const insert = handle.prepare(
		'INSERT OR IGNORE INTO alignments (fingerprint, engine, precise, lines, created_at) VALUES (?, ?, ?, ?, ?)'
	);
	let imported = 0;
	for (const name of names) {
		const fp = name.slice(0, -5);
		if (exists.get(fp)) continue;
		try {
			const data = JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
			if (!Array.isArray(data?.lines) || !data.lines.length) continue;
			insert.run(fp, data.engine || 'legacy', 0, JSON.stringify(data.lines), Date.now());
			imported += 1;
		} catch {
			/* skip a corrupt file */
		}
	}
	if (imported) console.log(`lyrics db: imported ${imported} legacy alignment file(s)`);
}

function parseJson(text) {
	if (text == null) return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/** Cached lyric lookup for a normalized `key`, or null when absent/expired.
 *  Expired rows are left in place; the next write replaces them. */
export function getLyricsRow(key) {
	const handle = open();
	if (!handle) return null;
	try {
		const row = handle
			.prepare(
				'SELECT artist, title, album, duration, source, word_level, lines, plain, fetched_at, ttl FROM lyrics WHERE key = ?'
			)
			.get(key);
		if (!row) return null;
		const fetchedAt = Number(row.fetched_at);
		const ttl = Number(row.ttl);
		if (Date.now() - fetchedAt >= ttl) return null;
		return {
			artist: row.artist,
			title: row.title,
			album: row.album,
			duration: Number(row.duration) || 0,
			source: row.source || null,
			wordLevel: Boolean(row.word_level),
			lines: parseJson(row.lines),
			plainText: row.plain || null,
			fetchedAt,
			ttl
		};
	} catch (error) {
		console.error('lyrics db read failed:', error.message);
		return null;
	}
}

export function putLyricsRow(key, entry) {
	const handle = open();
	if (!handle) return false;
	try {
		handle
			.prepare(
				`INSERT OR REPLACE INTO lyrics
					(key, artist, title, album, duration, source, word_level, lines, plain, fetched_at, ttl)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				key,
				String(entry.artist || ''),
				String(entry.title || ''),
				String(entry.album || ''),
				Math.round(Number(entry.duration) || 0),
				entry.source || null,
				entry.wordLevel ? 1 : 0,
				entry.lines ? JSON.stringify(entry.lines) : null,
				entry.plainText || null,
				Number(entry.fetchedAt) || Date.now(),
				Number(entry.ttl) || 0
			);
		return true;
	} catch (error) {
		console.error('lyrics db write failed:', error.message);
		return false;
	}
}

/** `{ lines, engine, precise, createdAt }` for a track fingerprint, or null. */
export function getAlignmentRow(fingerprint) {
	const handle = open();
	if (!handle) return null;
	try {
		const row = handle
			.prepare('SELECT engine, precise, lines, created_at FROM alignments WHERE fingerprint = ?')
			.get(fingerprint);
		if (!row) return null;
		const lines = parseJson(row.lines);
		if (!Array.isArray(lines) || !lines.length) return null;
		return {
			lines,
			engine: row.engine || 'legacy',
			precise: Boolean(row.precise),
			createdAt: Number(row.created_at) || 0
		};
	} catch (error) {
		console.error('lyrics db read failed:', error.message);
		return null;
	}
}

export function putAlignmentRow(fingerprint, entry) {
	const handle = open();
	if (!handle) return false;
	if (!Array.isArray(entry?.lines) || !entry.lines.length) return false;
	try {
		handle
			.prepare(
				`INSERT OR REPLACE INTO alignments
					(fingerprint, artist, title, duration, engine, precise, lines, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				fingerprint,
				String(entry.artist || ''),
				String(entry.title || ''),
				Math.round(Number(entry.duration) || 0),
				String(entry.engine || 'unknown'),
				entry.precise ? 1 : 0,
				JSON.stringify(entry.lines),
				Number(entry.createdAt) || Date.now()
			);
		return true;
	} catch (error) {
		console.error('lyrics db write failed:', error.message);
		return false;
	}
}

export function getLyricPick(key) {
	const handle = open();
	if (!handle || !key) return null;
	try {
		const row = handle
			.prepare(
				'SELECT artist, title, album, duration, display_source, cache_source, pinned, updated_at FROM lyric_picks WHERE key = ?'
			)
			.get(key);
		if (!row) return null;
		return {
			artist: row.artist,
			title: row.title,
			album: row.album,
			duration: Number(row.duration) || 0,
			displaySource: row.display_source || null,
			cacheSource: row.cache_source || null,
			pinned: Boolean(row.pinned),
			updatedAt: Number(row.updated_at) || 0
		};
	} catch (error) {
		console.error('lyrics db pick read failed:', error.message);
		return null;
	}
}

export function putLyricPick(key, entry) {
	const handle = open();
	if (!handle || !key) return false;
	try {
		handle
			.prepare(
				`INSERT OR REPLACE INTO lyric_picks
					(key, artist, title, album, duration, display_source, cache_source, pinned, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				key,
				String(entry.artist || ''),
				String(entry.title || ''),
				String(entry.album || ''),
				Math.round(Number(entry.duration) || 0),
				entry.displaySource || null,
				entry.cacheSource || null,
				entry.pinned ? 1 : 0,
				Number(entry.updatedAt) || Date.now()
			);
		return true;
	} catch (error) {
		console.error('lyrics db pick write failed:', error.message);
		return false;
	}
}

export function deleteLyricPick(key) {
	const handle = open();
	if (!handle || !key) return false;
	try {
		handle.prepare('DELETE FROM lyric_picks WHERE key = ?').run(key);
		return true;
	} catch (error) {
		console.error('lyrics db pick delete failed:', error.message);
		return false;
	}
}

export function deleteAlignmentRow(fingerprint) {
	const handle = open();
	if (!handle || !fingerprint) return false;
	try {
		handle.prepare('DELETE FROM alignments WHERE fingerprint = ?').run(fingerprint);
		return true;
	} catch (error) {
		console.error('lyrics db alignment delete failed:', error.message);
		return false;
	}
}

/** Row counts for the boot log and the dev wall. */
export function lyricsDbStats() {
	const handle = open();
	if (!handle) return { available: false, path: lyricsDbPath(), lyrics: 0, wordLevel: 0, alignments: 0, precise: 0 };
	try {
		const lyrics = handle.prepare('SELECT COUNT(*) AS n, SUM(word_level) AS w FROM lyrics').get();
		const aligned = handle.prepare('SELECT COUNT(*) AS n, SUM(precise) AS p FROM alignments').get();
		return {
			available: true,
			path: dbPath,
			lyrics: Number(lyrics?.n) || 0,
			wordLevel: Number(lyrics?.w) || 0,
			alignments: Number(aligned?.n) || 0,
			precise: Number(aligned?.p) || 0
		};
	} catch {
		return { available: true, path: dbPath, lyrics: 0, wordLevel: 0, alignments: 0, precise: 0 };
	}
}

/** Test hook: drop the open handle so the next call re-opens at the
 *  current LYRICS_DB_PATH. */
export function closeLyricsDb() {
	if (db) {
		try {
			db.close();
		} catch {
			/* already closed */
		}
	}
	db = null;
	dbPath = null;
	legacyImported = false;
}
