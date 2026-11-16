---
title: Conventions — canonical file names
type: rules
description: One canonical file name per document type, and the per-tier project folder shape. Use these names so agents and search find the same thing in every project.
---

# Conventions

One idea, one file name. Knowledge bases drift into many variants of the same document
(`*-STATE.md`, `*-Status.md`, `RESUME-<date>.md`, `START.md`, `KICKOFF.md`, `resume.txt`, one
ever-growing `decisions.md`). Agents then miss the live one or read a stale one. Use the names below;
when you find a variant, rename it to the canonical form or move it to `archive/`.

Frontmatter for every note: `schemas/frontmatter.md`.

## Canonical names (inside `projects/<slug>/`)

| File | `type` | What it is | Replaces |
|---|---|---|---|
| `README.md` | readme | Index: what the project is, where things live. | ad-hoc index / overview files |
| `project.yml` | — | Profile and registry entry: tier, repos, commands, integrations, and the `resources:` list of linked tickets, threads, docs and PRs. | — |
| `STATUS.md` | status | Live board, overwritten in place. | `*-STATE.md`, `*-Status.md`, status variants |
| `RESUME.md` | handoff | Current handoff snapshot, overwritten in place. | `RESUME-<date>.md`, `START.md`, `KICKOFF.md`, `resume.txt` |
| `handoffs/<YYYY-MM-DD>-<role>.md` | handoff | Dated handoffs, append-only history. | dated resume / kickoff variants |
| `checklist.md` | status | State for adhoc/small. | — |
| `tracker.json` | — | Machine state for medium/large (`schemas/tracker.schema.json`). | — |
| `PLAN.md` | plan | The overall plan or design for the project. | — |
| `BACKLOG.md` | backlog | Not-yet-ticketed work. | — |
| `RULES.md` | rules | Project rules agents must follow. | — |
| `anti-patterns.md` | rules | Learned rules (`schemas/anti-patterns.schema.md`). | — |
| `decisions/NNNN-<slug>.md` | decision | One ADR per decision, MADR format (`templates/adr.md`). | a single growing `decisions.md` |
| `prompts/<TICKET>.md` | prompt | Assembled per-ticket role prompt. | — |
| `prompts/<TICKET>.manifest.md` | plan | Planner's durable plan (`roles/planner.md`). | — |
| `reviews/` | review | Review write-ups. | — |
| `retros/` | retro | Retrospectives (`templates/retro-prompt.md`). | — |
| `runbooks/<slug>.md` | runbook | Step-by-step procedures (`templates/runbook.md`). | — |
| `runs/`, `logs/` | — | Generated output. **Not indexed** (`.pitwall/ignore`). | — |

Dates in file names are always `YYYY-MM-DD`. ADR numbers are zero-padded (`0001`) and never reused.

## Project folder shape by tier

Consistent with `tiers/tiers.yml`. `/orchestrate init` copies `templates/project/` and prunes to
this shape. Optional folders (`decisions/`, `reviews/`, `runbooks/`, `handoffs/`, `retros/`) appear
at any tier once they have content.

| File / folder | adhoc | small | medium | large |
|---|---|---|---|---|
| folder itself | optional (`run` can be folderless) | yes | yes | yes |
| `project.yml` | optional | yes | yes | yes |
| `checklist.md` | optional | yes | — | — |
| `tracker.json` | — | optional | yes (flat tickets) | yes (+ `waves`, `wave_retros`, `active_prs`, `execution_strategy`) |
| `STATUS.md` | — | — | yes | yes |
| `RESUME.md` + `handoffs/` | — | — | — | yes |
| `anti-patterns.md` | — | optional one-liners | yes (candidates) | yes (promoted + lifted) |
| `prompts/` (+ manifests) | — | prompts only | yes | yes |
| `retros/` | — | — | optional | yes (per wave) |

## Where things go outside a project

| Folder | Holds |
|---|---|
| `reference/` | Stable facts shared across projects: schemas, domain docs, gotchas. |
| `playbooks/` | This process layer. Edit deliberately; it drives every project. |
| `inbox/` | Quick notes and bookmarks. Triage into a project or `reference/`. |
| `archive/` | Closed projects (`status: closed`) and finished phases, moved whole. |
