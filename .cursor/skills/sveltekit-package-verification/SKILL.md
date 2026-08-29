---
name: sveltekit-package-verification
title: SvelteKit Package.json Verification
description: Verify npm deps before install. AI generates fake versions.
version: 1.0.0
category: software-development
---

# SvelteKit Package.json Verification

## Trigger
- Before `npm install` on any SvelteKit / Vite / Node project
- After an AI agent (Cursor, Claude Code, Codex) has modified `package.json`
- User says "build won't work" or "install fails"

## The Problem

AI coding agents regularly generate `package.json` files with hallucinated versions:
- `@monaco-editor/svelte@latest` → **does not exist** (real: `monaco-editor` + `@monaco-editor/loader`)
- `cmdk-svelte@^2.0.0` → **does not exist** (real: `0.0.1` only, and it wants Svelte 3)
- `svelte-sonner@^0.5.0` → **does not exist**
- `@xterm/addon-fit@^0.1.0` → **beta-only** (real: `^0.10.0`)
- `svelte-motion@^0.4.0` with Svelte 5 → **peer-deps Svelte 3 only** (real: `^0.12.2`)

## Quick Verification Script

Run this BEFORE `npm install`:

```bash
cd frontend/
for pkg in $(jq -r '.dependencies | keys[]' package.json); do
  ver=$(jq -r ".dependencies[\"$pkg\"]" package.json)
  echo -n "Checking $pkg@$ver ... "
  npm view "$pkg@$ver" version 2>/dev/null && echo "OK" || echo "MISSING"
done
```

## Manual Checks (3–5 packages)

If you don't have `jq`, manually verify the most suspicious packages:

```bash
npm view @monaco-editor/svelte version    # expect error → use @monaco-editor/loader
npm view cmdk-svelte versions             # expect ["0.0.1"]
npm view svelte-sonner@0.5.0 version      # expect error
npm view @xterm/xterm version             # expect "5.5.0"
npm view @xterm/addon-fit version         # expect "0.10.0"
npm view svelte-motion peerDependencies   # expect includes svelte ^5.0.0
```

## Recovery When Install Fails

1. **Don't use `--force` or `--legacy-peer-deps` blindly** — they mask real problems
2. **Strip to minimal verified deps** first
3. **Get `npm install` working** with minimal set
4. **Add packages one by one**, verifying each version before install
5. **After install works**, run `npm run build` and `npm run check`

## Common Real Packages for NIL/SvelteKit Stack

| What you want | Real package | Version |
|---------------|-----------|---------|
| Icons | `@iconify/svelte` | `^4.2.0` |
| Monaco editor | `monaco-editor` + `@monaco-editor/loader` | `^0.52.2` + `^1.5.4` |
| Terminal | `@xterm/xterm` + `@xterm/addon-fit` + `@xterm/addon-webgl` | `^5.5.0` + `^0.10.0` + `^0.19.0` |
| Animation | `svelte-motion` | `^0.12.2` (Svelte 5 compatible) |
| Command palette | none stable for Svelte 5 | build custom |

## Svelte Version Compatibility Matrix

| Package | Svelte 3 | Svelte 4 | Svelte 5 |
|---------|----------|----------|----------|
| `svelte-motion@^0.12.2` | ✅ | ✅ | ✅ |
| `svelte-motion@^0.4.1` | ✅ | ❌ | ❌ |
| `cmdk-svelte@0.0.1` | ✅ | ❌ | ❌ |
| `@dnd-kit/svelte@0.2.3` | ❌ | ❌ | ✅ |

## Peer Dependency Resolution Gotchas

### `@sveltejs/vite-plugin-svelte` Version Pinning
**Scenario:** `@sveltejs/kit@^2.5.0` + `@sveltejs/adapter-node@^5.2.0` + `@sveltejs/vite-plugin-svelte@latest` fail with `ERR_MODULE_NOT_FOUND` or `externalize-deps` error.
**Cause:** `npm install` pulls `@sveltejs/vite-plugin-svelte@7.x` which is ESM-only and incompatible with SvelteKit 2.x's default expectations.
**Fix:** Pin to v3: `npm install @sveltejs/vite-plugin-svelte@3 --legacy-peer-deps`
**Prevention:** Always verify the plugin version before install:
```bash
npm view @sveltejs/vite-plugin-svelte versions --json | tail -5
```

### `--legacy-peer-deps` vs `--force`
- `--legacy-peer-deps`: Relaxes peer dependency checks, good for SvelteKit ecosystem mismatches
- `--force`: Overrides everything, more dangerous — only use after `--legacy-peer-deps` fails

## Pitfalls

| Mistake | Fix |
|---------|-----|
| `npm install --force` | Fixes symptoms, hides real conflicts. Verify versions first. |
| Trusting AI-generated `package.json` without checking | Always verify 3–5 key packages with `npm view`. |
| Using `xterm` (legacy) instead of `@xterm/xterm` | The `xterm` package is deprecated. Use `@xterm/xterm`. |
