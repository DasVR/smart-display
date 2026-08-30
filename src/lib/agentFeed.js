/**
 * Maps live host signals (Ollama, git, telemetry) onto agent/tool UI.
 * No invented traces: every field is derived from a real poll.
 */

export function runPid(name = 'sys') {
	let h = 2166136261;
	const src = String(name);
	for (let i = 0; i < src.length; i++) {
		h ^= src.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return String(Math.abs(h) % 1000).padStart(3, '0');
}

export function meterBar(pct, width = 12) {
	const n = Math.max(0, Math.min(100, Number(pct) || 0));
	const filled = Math.round((n / 100) * width);
	return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

export function toBits(n, width = 8) {
	const max = 2 ** width;
	const v = Math.max(0, Math.floor(Number(n) || 0)) % max;
	return v.toString(2).padStart(width, '0');
}

export function phaseHue(phase) {
	switch (phase) {
		case 'searching':
			return 'var(--scan)';
		case 'solving':
		case 'reasoning':
			return 'var(--solve)';
		case 'working':
		case 'executing':
			return 'var(--ok)';
		case 'idle':
		case 'done':
			return 'var(--text-tertiary)';
		default: {
			const _exhaustive = phase;
			return _exhaustive || 'var(--text-tertiary)';
		}
	}
}

export function buildAgents({ ollamaStatus, ollamaModels, git, telemetry }) {
	const model = ollamaModels?.[0]?.name || ollamaModels?.[0]?.model || 'local-llm';
	const services = telemetry?.services ?? [];
	const sysDown = services.some((s) => !s.status);

	return [
		{
			id: 'ollama',
			name: model,
			pid: runPid(model),
			phase: ollamaStatus === 'inferring' ? 'working' : 'idle',
			task: ollamaStatus === 'inferring' ? 'inferring' : 'standby',
			opacity: ollamaStatus === 'inferring' ? 1 : 0.4
		},
		{
			id: 'sys',
			name: 'sys-monitor',
			pid: runPid('sys-monitor'),
			phase: sysDown ? 'searching' : 'idle',
			task: sysDown ? 'health probe' : 'poll telemetry',
			opacity: sysDown ? 1 : 0.4
		},
		{
			id: 'git',
			name: 'git',
			pid: runPid(git?.branch || 'worktree'),
			phase: git?.dirty ? 'executing' : 'done',
			task: git?.dirty ? `${git.changed} dirty` : 'clean',
			branch: git?.branch || 'untracked',
			opacity: git?.dirty ? 1 : 0.4
		}
	];
}

export function buildReasoning({ ollamaStatus, ollamaModels, git }) {
	if (ollamaStatus === 'inferring') {
		const names = (ollamaModels || [])
			.map((m) => m.name || m.model)
			.filter(Boolean);
		return {
			title: 'local inference',
			phase: 'reasoning',
			open: true,
			lines: names.length ? names : ['model occupying VRAM']
		};
	}
	return {
		title: 'last commit',
		phase: git?.dirty ? 'solving' : 'done',
		open: false,
		lines: [git?.message, git?.branch && `branch ${git.branch}`, git?.sha]
			.filter(Boolean)
	};
}

export function buildToolCalls({ git, telemetry }) {
	const tools = [];
	const containers = telemetry?.stats?.containers;
	tools.push({
		id: 'bash-docker',
		kind: 'Bash',
		label: 'docker ps -q | wc -l',
		status: Number.isFinite(containers) ? 'done' : 'idle',
		output: Number.isFinite(containers) ? String(containers) : '--',
		detail: Number.isFinite(containers) ? `${containers} containers on host` : 'docker not reported'
	});

	for (const s of (telemetry?.services || []).slice(0, 4)) {
		tools.push({
			id: `search-${s.name}`,
			kind: 'Search',
			label: `HEAD ${s.name}`,
			status: s.status ? 'done' : 'error',
			output: s.status ? 'ok' : 'down',
			detail: s.uptime || ''
		});
	}

	for (const f of (git?.files || []).slice(0, 4)) {
		tools.push({
			id: `edit-${f.path}`,
			kind: 'Edit',
			label: f.path,
			status: 'working',
			output: f.code || 'M',
			detail: git?.status || 'working tree dirty'
		});
	}

	if (git?.sha) {
		tools.push({
			id: 'diff-head',
			kind: 'Diff',
			label: git.sha,
			status: 'done',
			output: git.message || '',
			detail: (git.commitFiles || []).join('\n')
		});
	}

	return tools.slice(0, 8);
}

export function dominantPhase(agents) {
	const rank = ['working', 'executing', 'searching', 'solving', 'reasoning', 'done', 'idle'];
	for (const p of rank) {
		if (agents.some((a) => a.phase === p)) return p;
	}
	return 'idle';
}
