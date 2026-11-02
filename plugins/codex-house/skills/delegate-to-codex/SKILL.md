---
name: delegate-to-codex
description: How to hand work to OpenAI Codex through the codex@codex-plugin agents (codex:luna, codex:sol, codex:astra, codex:terra) - role presets as header lines, the .handoff brief, the Result format, verifying and committing, and the fallback when Codex fails. Use before spawning any codex:* agent.
---

# Delegating to Codex

Codex sees only the spawn prompt (header lines stripped) and the files in the session's cwd. It runs there: to work in another worktree, start the session in that worktree.

## Roles

Pick a model, then put the role's header lines at the top of the prompt.

| Role | Agent | Header lines | Use when |
|---|---|---|---|
| implementer | `codex:sol` | `approvals: never` | decided change: implement, build, test |
| reviewer | `codex:sol` | `sandbox: read-only`<br>`approvals: never` | review; findings only, no edits |
| runner | `codex:luna` | (defaults) | no judgement: command, grep, exact patch, rename |
| rescuer | `codex:sol` | (defaults) | stuck task or a second diagnosis |

`codex:astra` / `codex:terra` only when the user asks. Add `effort: low|medium|high|xhigh` when the default doesn't fit. Every Agent call needs a unique `name` (e.g. `fix-login-null`); the spawn is refused without one.

## Limits (guidance, not enforced)

- `sandbox: full-access` and `approvals: yolo` only when the user explicitly asked for them, for that job.
- One writer per worktree, Codex included: never start a write job where another agent is editing.
- Codex can't commit (`.git` is read-only in its sandbox). You review and commit.

## Brief

1. Write `.handoff/<job>.md` from [handoff.md](handoff.md): Goal, Scope, Constraints, Acceptance, Out of scope, and the empty `## Result`.
2. Prompt: header lines, then `Read .handoff/<job>.md and do it. End your final message with its ## Result section filled in.`

## Results

- Expect a short summary plus `## Result` (Status, Files changed, Commands run, Open questions). A missing field means check harder.
- The plugin's hooks git-ignore `.handoff/` before a spawn and, when a job ends, warn about missing Result fields, a moved HEAD or a `Co-Authored-By` trailer. Warnings never block; act on them.
- Verify yourself: `git diff`, re-run the Acceptance checks. Never commit or push on Codex's word.
- `codex_list` lists jobs; `codex_result` gives status, error and last message. `SendMessage` steers or resumes a job; `TaskStop` stops it.

## Failures

- Usage or rate limit: stop using Codex; check for partial changes, then give the same brief to the equivalent Claude agent in the same worktree, and say so in your report.
- Overloaded or a connection error: retry once.
- Not logged in: the user runs `codex login`.
- Stuck job: `SendMessage` once, then `TaskStop`; treat its partial changes as untrusted.
