---
title: Tier Guide
type: reference
description: How to choose a tier and how promotion works. Plain-language companion to tiers.yml.
---

# Choosing a tier

The tier is the only real decision when starting a project. Pick the **smallest** tier that fits —
you can always promote later (it's one field, and each tier is a subset of the next).

## Decision flow

- **Can you describe the whole thing in one sentence and do it in one sitting?** → **adhoc.**
  No folder, no tracking. `/orchestrate run "the task"`. Example: "fix the typo in the README",
  "bump the retry timeout and add a test".

- **A few related steps, one PR, no dependency graph?** → **small.**
  A `checklist.md` is the only state. Two roles (implement, test). Example: "add retry-with-backoff
  to the client + a test", "add a new CLI flag and document it".

- **A feature with several tickets that mostly go in order?** → **medium.**
  Full 4-role pipeline, a flat `tracker.json`, a `STATUS.md` board, per-project anti-pattern
  capture. Example: "build the new settings screen across ~8 tickets".

- **A program: many tickets, real blocking graph, multiple waves, CI + peer review?** → **large.**
  Everything medium has, plus a reviewer role, parallel batches with a batch gate, stacked PRs +
  cascade, a `RESUME.md` handoff, and the full capture→retro→promote learning loop. Example:
  a large multi-wave migration that splits a monolith into modules.

## Promotion is cheap

Because the ladder is monotonic (`adhoc ⊂ small ⊂ medium ⊂ large`), promoting a project means:

- `small → medium`: switch on `tracker.json` + `STATUS.md`, add the planner + updater roles.
- `medium → large`: add a `waves{}` key to the tracker, turn on the reviewer, the batch gate, peer
  approval, and `auto_promote` for learning.

Edit `tier` in `project.yml`; `/orchestrate` fills the newly-required artifacts from `tiers.yml`.
Never a rewrite.

## What each tier turns ON (summary)

See `tiers.yml` for the authoritative table. The axes that change per tier: role set, execution
(inline → serial → parallel batches), state artifact (none → checklist → tracker → tracker+waves),
gates (test → +build → +lint → +batch gate + peer approval), learning (off → per-project → full),
PR strategy, and resume doc. The per-tier project folder shape is in `../CONVENTIONS.md`.
