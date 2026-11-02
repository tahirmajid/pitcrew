---
name: codex-routing
description: Decides whether a delegated job goes to a Codex agent (codex:*) or a Claude subagent, from the work type and Claude's weekly usage - a work-to-agent table, usage tiers (normal, implement, orchestrate), what never goes to Codex, and a script that prints the current tier. Use before a batch of delegated work, with delegate-to-codex.
---

# Routing work between Codex and Claude

The more of Claude's weekly limit is used, the more work moves to Codex, so Claude lasts the week. The "never Codex" list always stays on Claude.

## Which agent

| Work | Codex | Claude |
|---|---|---|
| Command, grep, exact patch, rename, data gathering | runner (`codex:luna`) | Explore, or a cheap general-purpose subagent |
| Decided change | implementer (`codex:sol`) | general-purpose |
| Review of a diff or plan | reviewer (`codex:sol`, read-only) | a fresh general-purpose reviewer |
| Analysis, debugging, root cause, plan drafts | `codex:sol` | Plan |
| Stuck task, second diagnosis | rescuer (`codex:sol`) | Plan |

Roles and their header lines: `delegate-to-codex`. Use your own specialised Claude agents in the Claude column where you have them.

**Never Codex:** anything on a phone, emulator or browser; tools only Claude has (Claude-side MCP servers that aren't configured in `~/.codex/config.toml`); network work the sandbox blocks (first dependency sync, downloads, `gh`, push).

## Usage tiers

Before each batch run `python3 -I <this skill's directory>/usage-balance.py` and follow its verdict. Re-check per batch, not per message.

| Verdict | Claude weekly used | Codex gets | Claude keeps |
|---|---|---|---|
| `normal` | under 60% | review, second diagnosis, legwork | implementation, analysis, planning |
| `implement` | 60-75% | the above plus implementation | analysis, planning, verification |
| `orchestrate` | 75% or more (or 5-hour ≥ 80%) | most of the work: implementation, analysis, review, legwork | orchestration, briefs, verification, and what Codex can't do |
| `codex-off` | Codex weekly ≥ 85% or its limit reached | nothing until it resets | everything; if Claude is ≥ 75% too, must-finish work only and tell the user |

"Codex unknown": run one small runner job, then check again. "Claude unknown": the status line hasn't cached the limits yet (setup below); the verdict falls back to `normal`.

## Setup for the Claude numbers

Claude Code gives rate limits only to the status line. `statusline-limits.py` in this directory shows them and caches them in `~/.claude/claude-limits.json`, which the script reads. Use it as your status line (`"statusLine": {"type": "command", "command": "python3 -I <path>/statusline-limits.py"}`), or have your own status line write the same file: `{"saved_at": <epoch>, "rate_limits": <the status line's rate_limits>}`.
