---
title: Playbooks — tier-graded project harness
type: readme
description: A stack-independent orchestration layer. Spin up any project (adhoc/small/medium/large) with the right amount of ceremony from one command, /orchestrate.
---

# Playbooks

A **platform-independent** layer for running projects of any size with the right amount of
process. Ceremony is a function of one dial — the **tier** — declared per project in
`projects/<slug>/project.yml`.

Nothing in this folder names a language, build tool, or framework. Each project binds abstract
command names (`build`/`test`/`lint`/`format`) to its real commands in its own `project.yml`. The
same playbooks drive a mobile app, a web service, a CLI, a data pipeline, or a docs repo.

All paths below are relative to **the knowledge base root** (the folder the `pitwall` MCP server is
configured with).

## The tier ladder

| Tier | Use it for | Roles | Tracking | Gates | Learning |
|---|---|---|---|---|---|
| **adhoc** | one quick fix | doer (inline) | none | test passes | off |
| **small** | 1–3 tasks | impl → test | `checklist.md` | build+test | off |
| **medium** | a feature (~4–15 tasks) | plan → impl → test → update | `tracker.json` | lint+build+test | per-project |
| **large** | a program (15+, multi-wave) | + reviewer, parallel batches | `tracker.json` + waves + `RESUME.md` | + batch gate + peer approval | full loop |

Each tier is a strict superset of the one before, so re-tiering = editing one field. See
`tiers/TIER-GUIDE.md` for how to choose.

## Layout

```
playbooks/
├── playbooks.yml             # global config (default tier, paths, integration defaults)
├── CONVENTIONS.md            # canonical file names + per-tier project folder shape
├── tiers/                    # tiers.yml (THE DIAL) + TIER-GUIDE.md
├── roles/                    # stack-neutral role prompts + pipeline.md (the behavior plane)
├── schemas/                  # project.yml, tracker.json, anti-patterns, note frontmatter contracts
├── learning/                 # GLOBAL-anti-patterns.md (cross-project, stack-neutral)
├── templates/                # project/ scaffold (init copies it, then prunes by tier) + doc templates
└── workflows/                # adversarial-loop.js (executable review loop)
```

Project instances live outside this folder, one per `projects/<slug>/`.

## Use it

```
/orchestrate init <name> --tier <adhoc|small|medium|large>   # scaffold a project
/orchestrate run [<ticket>|"<task>"]                         # drive a ticket through its tier pipeline
/orchestrate learn                                           # capture/promote anti-patterns (medium/large)
/orchestrate status [<name>]                                 # list projects + next action
/orchestrate resume <name>                                   # print the resume snapshot
```

The skill ships with the plugin as `skills/orchestrate/SKILL.md`.

## Adversarial review loop (executable)

The Reviewer playbook is a merge-readiness check, not a skeptic. For findings that have to survive
an attack, `workflows/adversarial-loop.js` is a Claude Code **Workflow** script — generic over any
work product (diff, PR, plan, doc, claim set):

```
review N lenses -> adversarially refute each finding (majority-refute kills it)
  -> [optional] fix confirmed findings -> re-review, deduped -> until dry or maxRounds
```

```
Workflow({ scriptPath: "<kb root>/playbooks/workflows/adversarial-loop.js",
           args: { target: "the current branch's diff", checklist: "docs/review-guide.md", fix: true } })
```

The Workflow tool must be able to read the script: add the knowledge base root to the session
(`/add-dir <kb root>`) or copy the script into the working repo's `.claude/workflows/` and call it by
name. Args and exit conditions are in the file header.

## Indexing

Indexing is automatic. Everything under the knowledge base root is indexed except paths matched by
`.pitwall/ignore`; generated files under `runs/` and `logs/` are excluded there, so churning run output
never pollutes search.
