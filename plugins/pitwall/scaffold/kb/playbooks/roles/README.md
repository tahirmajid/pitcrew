---
title: Roles — how they assemble
type: reference
description: How /orchestrate run turns the generic role playbooks into a filled, per-ticket prompt. Lists the placeholder tokens and the assembly order.
---

# Roles — assembly

These playbooks are the **behavior plane**: reusable, stack-neutral role definitions. Every
language-, framework- or build-tool-specific rule lives in per-project anti-patterns instead. They
never name a build tool — they reference the abstract `commands.{build,test,lint,format}` a project
binds in its `project.yml`.

## Assembly (what `/orchestrate run` does)

1. Read `projects/<slug>/project.yml` → resolve `tier` against `playbooks/tiers/tiers.yml` → get the
   active **role set**.
2. Concatenate, in pipeline order, only the active role playbooks (+ `pipeline.md` once at top).
3. Substitute the placeholder tokens (below) from `project.yml` + the ticket's tracker entry +
   the promoted anti-pattern rows.
4. Hand the assembled prompt to the agent (inline/serial for adhoc–medium; dispatched as
   master→worker batches via the Workflow tool for large).

## Two per-ticket artifacts in `projects/<slug>/prompts/`

| file | written by | purpose |
|---|---|---|
| `<TICKET>.md` | `run` (assembly) | the filled role prompt handed to the agent |
| `<TICKET>.manifest.md` | the Planner | the **durable plan** — reviewed before the Implementer runs, re-read on resume (medium/large only) |

The manifest path is recorded on the ticket (`tracker.json` → `tickets[].manifest`); its
`status` field walks `draft → approved → executed`. See `planner.md` for its structure.

No per-project prompt is written by hand. The same playbooks serve any stack — only the `commands`
binding and the injected anti-patterns differ.

## Placeholder tokens

| token | filled from |
|---|---|
| `<<TICKET>>` | ticket id (issue-tracker id, GitHub issue, or local slug) |
| `<<TICKET_TITLE>>` | ticket title |
| `<<REPO>>` | `project.yml.repos[0]` (or the `repo` alias) |
| `<<BASE_BRANCH>>` | `project.yml.base_branch` |
| `<<BRANCH>>` | the ticket's working branch |
| `<<STACKED_ON_BRANCH>>` | resolved parent branch (large/stacked) or `<<BASE_BRANCH>>` |
| `<<COMMANDS>>` | the `project.yml.commands` map (build/test/lint/format) |
| `<<INJECTED_ANTI_PATTERNS>>` | promoted rows from this project's anti-patterns.md + GLOBAL |
| `<<WORKTREE_PATH>>` | the worktree created for this ticket (if any) |

## Files
- `pipeline.md` — chaining, gates, bounded loops, handoff protocol (read first)
- `planner.md` — scope + manifest (medium, large)
- `implementer.md` — make the change + local-green (all tiers; also scopes inline at small/adhoc)
- `tester.md` — independent green gate + coverage (small, medium, large)
- `updater.md` — push, PR, CI watch, tracker update (medium, large)
- `reviewer.md` — correctness/scope review + bot triage + merge verdict (large)
