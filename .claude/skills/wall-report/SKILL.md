---
name: wall-report
description: Keep the user's wall display current on what you're doing. Use at the start of any multi-step task, at each milestone, when you need the user, and when you finish (with the pull request). The wall is glanced at from across the room, so reports are a few plain words.
---

# Reporting to the wall

The user has a wall display that shows every coding session they have going,
on their computer and in the cloud. Your hooks already tell it *that* you're
working and which tool is running. This skill is for telling it *what* you're
doing, in words a person reads from across the room.

## How

Call the `report_progress` tool (the `wall` MCP server). If the tool isn't
there, run the same thing from a shell:

```bash
node hooks/wall-report.mjs "Fix the flaky weather test" --step "Reproducing it" --done 1 --total 4
```

(In a plugin install the script is `${CLAUDE_PLUGIN_ROOT}/scripts/wall-report.mjs`.)
It never fails your work: with no wall set up it just says so.

## When

| Moment | Send |
| --- | --- |
| You start a task of more than a couple of steps | `summary` (the whole job), `step`, `total` if you know it |
| You finish a step or start a new phase of the work | `step`, `done` |
| You need the user (a decision, a credential, a review) | `phase: "waiting"`, `step` saying what you need |
| You're done | `phase: "done"`, `link` to the pull request if there is one |
| You stopped and can't go on | `phase: "error"`, `step` saying why |

Don't report every tool call: the hooks do that. Four to eight reports for a
normal task is right. If you keep a to-do list (TodoWrite), the wall already
reads your current item and "3 of 5" from it, so report only the headline and
the end.

## Words

- `summary`: the job in under eight words, plain English, sentence case, no
  file paths or code: "Redesign the Agents view", "Fix the flaky weather test".
- `step`: what you're doing now, starting with a verb: "Writing the tests",
  "Waiting on CI", "Reproducing the failure".
- No ticket numbers, emoji or exclamation marks. The user may be across the
  room; say what a person would want to know at a glance.
