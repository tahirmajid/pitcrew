---
title: Pipeline
type: rules
description: How the role playbooks chain together per tier, the gate semantics, and where loops are bounded. Stack-neutral; the engine reads tiers.yml to know which roles run.
---

# Pipeline — how the roles chain

The roles are reusable across every tier. The **tier** (from `playbooks/tiers/tiers.yml`) decides
*which* roles run and *how* they execute. `/orchestrate run` assembles a per-ticket prompt by
concatenating only the active role playbooks and filling the placeholders (see `README.md` in this
folder).

```
ADHOC    doer  (Do+Verify collapsed, inline)
SMALL    implementer -> tester
MEDIUM   planner -> implementer -> tester -> updater                 (serial, per ticket)
LARGE    planner -> implementer -> tester -> updater -> reviewer      (parallel batches)
```

## Gate semantics

There are two kinds of gate. Which apply is read from the tier + `project.yml.gates`.

1. **local-green gate** (all tiers ≥ small) — before a ticket is considered done / pushed, every
   command listed in `gates.local_green` must pass, run against the project's real commands:
   - `format` → run `commands.format` (auto-fix), if defined
   - `lint`   → run `commands.lint`, zero violations
   - `build`  → run `commands.build`, succeeds
   - `test`   → run `commands.test`, green
   A red local state is **never** pushed. Fix locally, re-run the suite, repeat.

2. **batch gate** (large only) — the next batch starts ONLY when every PR in the current batch is
   CI-green (or a failure is confirmed infra/flaky). Never advance on a red PR; halt and report.

## Bounded loops (no runaway)

- **CI watch** (updater): poll on a fixed interval; exit when no checks are pending. Never an
  unbounded busy-wait.
- **CI fix** (updater/large): a *code* failure is fixed **locally** then re-pushed — never iterated
  remotely via repeated re-triggers. Infra/flaky failures get **one** re-trigger, then escalate.
- **Manifest disagreement / scope drift**: stop and report (see each role's Stop Conditions),
  don't silently patch.

## Handoff protocol

Each role ends with a single handoff message:
1. What was done
2. The artifact (manifest / commit list / test report / PR link)
3. What the next role needs to know

Never skip a role. Bounce back to the previous role rather than patching its work silently.
When a session ends mid-ticket, write a dated handoff (`projects/<slug>/handoffs/<YYYY-MM-DD>-<role>.md`)
and refresh `RESUME.md`; see `../CONVENTIONS.md`.

## The manifest is the durable plan

For medium/large, the Planner writes its plan to `projects/<slug>/prompts/<TICKET>.manifest.md`
(structure in `planner.md`) and records the path on the ticket (`tracker.json` → `tickets[].manifest`).
This makes the plan a reviewable, resumable artifact rather than an in-flight message:
- **Review gate:** `run` shows the `draft` manifest for approval, flips it to `approved`, and only
  then starts the Implementer. A `draft` manifest is never executed.
- **Resume:** if a ticket is picked up mid-flight, re-read its manifest file instead of re-planning.
- **Audit:** the manifest's `status` (`draft → approved → executed`) plus the ticket's `role_status`
  together say exactly where the ticket stands.

Adhoc/small have no Planner, so no manifest — the typed task / `checklist.md` line is the plan.

## Tool-agnostic execution

Every external action is guarded by `project.yml.integrations.<x>.enabled`:
- `github` off → commits stay local, no PR is opened.
- `ci` off → local-green is the terminal gate; no CI watch.
- `linear` (issue tracker) off → tickets are local slugs in the tracker; no tracker transitions.
- `workflow_tool` off (anything below large) → roles run inline/serially; no master/worker batches.

## Learning hook

After a ticket completes, run the tier's learning depth (`tiers.yml` → `learning`):
- `off` (adhoc/small): nothing, or an optional one-line note.
- `per_project` (medium): capture lessons to `projects/<slug>/anti-patterns.md` as candidates.
- `full` (large): capture → retro → promote (≥3 or critical) → inject promoted rows into future
  prompts; lift genuinely stack-neutral rows up to `playbooks/learning/GLOBAL-anti-patterns.md`.
