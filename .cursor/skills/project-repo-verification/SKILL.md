---
name: project-repo-verification
description: Verify target repo before any build to prevent errors.
---

# Project Repo Verification & Scoping

## Why This Exists
The user maintains multiple projects across multiple GitHub repos. Building in the wrong repo is one of the fastest ways to frustrate them. This skill enforces verification BEFORE any build action.

## Trigger
- User says "build X", "scaffold Y", "write docs for Z", "create components for..."
- User mentions any project name (leadvine, finn-pentest-harness, portfolio-v2, etc.)
- About to run any command that modifies files outside the current working directory

## Step 1: ALWAYS Verify Target Repo First

### The Golden Rule
**Never assume which repo the user wants. Verify first. Every time.**

```bash
# Run BOTH before building anything
git remote -v    # Shows which repo this actually is
pwd              # Shows current directory
```

### Expected Repo Targets
| Project | Expected Path | Expected Remote |
|-----------|-------------|-----------------|
| Portfolio v5 | `/home/das/portfolio-v2/` | `DasVR/Das-web` |
| Finn Pentest Harness | `/home/das/projects/finn-pentest-harness/` | `DasVR/finn-pentest-harness` |
| LeadVine | `/home/das/projects/leadvine/` | Local only (no remote yet) |
| Discord Voice Bot | `/home/das/projects/discord-voice-robot/` | `DasVR/discord-voice-robot` |
| Finn Godmode API | `/home/das/projects/finn-godmode-api/` | `DasVR/finn-godmode-api` |

### When Wrong Repo Detected
1. **STOP immediately** — do not write a single file
2. **Tell the user**: "I see we're in [wrong repo], but this should be in [correct repo]. Let me switch."
3. **Navigate to correct repo**: `cd /path/to/correct/repo`
4. **Verify again**: `git remote -v` + `pwd`
5. **Only then**: begin building

## Step 2: Confirm Project Scope

Before scaffolding, confirm with the user (or infer from context):

**Single-repo projects** (most common):
- Portfolio → portfolio-v2 only
- Pentest harness → finn-pentest-harness only
- LeadVine → leadvine only

**Multi-repo split projects** (rare — must verify):
- Frontend in repo A, backend in repo B
- Design docs in one repo, implementation in another

### Never Mix Unrelated Projects in One Repo
If a document contains features from two different projects:
- Extract Project A content → copy to Project A's repo
- Extract Project B content → copy to Project B's repo
- Delete the confused mixed document/repo after separation

## Step 3: Document Separation Workflow

When documents are mixed across projects:

1. **Identify the confused doc** — read it, identify which sections belong to which project
2. **Copy sections to correct repos** — don't move, COPY first (safer)
3. **Verify copied content** — read the new files in each repo to confirm they're correct
4. **Delete the confused doc** from the mixed repo
5. **Delete the confused repo** entirely if it was a temporary scratch repo
6. **Push changes** to both target repos

## Step 4: Cleanup After Separation

### If a temporary/scratch repo exists:
```bash
# Delete from GitHub
cd /path/to/confused-repo
gh repo delete owner/repo-name --yes

# Delete local directory
rm -rf /path/to/confused-repo
```

### If existing repo had mixed content:
```bash
# Remove mixed files
git rm mixed-doc.md
git commit -m "Remove mixed doc (separated into correct repos)"
git push
```

## Pitfalls

### Pitfall: "I already know which repo this is"
**WRONG.** The user's context window and your context window are separate. They may have switched projects mentally while you didn't. Always verify.

### Pitfall: Building before confirming
**WRONG.** If you build 10 files in the wrong repo, the user has to deal with reverting, cleaning, and rebuilding. Verify costs 5 seconds. Fixing costs 5 minutes.

### Pitfall: Mixing LeadVine + Pentest docs
**WRONG.** These are separate projects with separate repos. Even if they share a dark terminal aesthetic, they do not belong in the same document or repo.

### Pitfall: "I'll just copy it later"
**WRONG.** Copying later means mixed commits, confused history, and potential data loss. Fix the repo BEFORE committing.

### Pitfall: Trusting a generated `package.json` without verification
**WRONG.** AI agents (including Cursor Cloud, Codex, and others) often hallucinate dependency versions that do not exist on npm. Before running `npm install`, always verify at least 3-5 key packages with `npm view <pkg> version`. Common hallucinations include:
- `@monaco-editor/svelte` (does not exist; use `monaco-editor` + `@monaco-editor/loader`)
- `cmdk-svelte@^2.0.0` (only `0.0.1` exists)
- `svelte-sonner@^0.5.0` (does not exist)
- `@xterm/addon-*@^0.1x.0` (xterm addons are all beta-only)
- `svelte-motion@^0.4.0` with Svelte 5 (only supports Svelte 3)

**Fix:** strip to a minimal verified dependency set, get `npm install` working, then add packages one by one with real versions.

## Step 5: Fetch Latest Before Working on Shared Repos

When returning to a project after time away (especially if Cursor or other agents may have worked on it):

```bash
# ALWAYS fetch first — Cursor and other agents push to branches that get merged later
git fetch origin

# Check ALL branches, not just the current one
git branch -a
git log --all --oneline -15

# If local is behind, pull before touching anything
git pull origin $(git branch --show-current)
```

**Why this matters:** Other agents (Cursor, Codex, Claude Code) push feature branches that are merged to master. The local checkout can be 15+ commits behind even though `git status` looks clean. Missing this means rebuilding code that already exists.

## Step 6: Audit Tokens/Env Before Making Changes

Before modifying `.env`, `requirements.txt`, or any credential/config file:

```bash
# Read existing .env (if allowed) or grep for key patterns
grep -rh 'sk-' .env .env.example 2>/dev/null | grep -v '^#' | head -20
grep -rh 'OLLAMA\|OPENAI\|DISCORD\|API_KEY' .env .env.example 2>/dev/null | head -20
```

**Rule:** Never overwrite existing tokens. Never add a new provider without checking if one is already configured. The user's existing tokens are the source of truth.

## Verification Checklist

Before any `write_file`, `patch`, or `git commit`:
- [ ] `pwd` shows expected path
- [ ] `git remote -v` shows expected remote
- [ ] `git fetch origin` run and local branch is up to date
- [ ] All remote branches inspected for agent/Cursor work
- [ ] Project name in user's message matches current repo name
- [ ] No unrelated project names are in the files being written
- [ ] Existing tokens/env audited before adding new ones
- [ ] If unsure: ask the user to confirm target repo
