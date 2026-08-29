# Portfolio Site Protection Rule

## CRITICAL: Do NOT modify the portfolio site unless explicitly asked

The user's main portfolio website lives at `/home/das/portfolio-v2/` (repo: `DasVR/Das-web`). This is a **separate, production project** that should NEVER be touched as part of pentest harness work.

## Repositories
| Project | Local Path | Remote | Tech Stack |
|---------|-----------|--------|------------|
| **Portfolio** | `/home/das/portfolio-v2/` | `DasVR/Das-web` | Next.js 14 + Tailwind + shadcn/ui |
| **Pentest Harness** | `/home/das/projects/finn-pentest-harness/` | `DasVR/finn-pentest-harness` | FastAPI + SvelteKit/Tauri |

## How to Tell Which Repo You're In
```bash
git remote -v  # Shows the remote URL
pwd            # Shows current directory
```

## Recovery (if portfolio was accidentally modified)
```bash
cd /home/das/portfolio-v2
git status          # Check what's modified
git checkout .      # Discard ALL local changes (nuclear option)
git checkout <file> # Discard specific file
git reset --hard <commit>  # Reset to specific commit
```

## Prevention
- Always `pwd` before creating files
- Always `git remote -v` before committing
- If working on pentest harness, cd to `/home/das/projects/finn-pentest-harness/` FIRST
- The user gets angry if the portfolio is broken — verify before every build
