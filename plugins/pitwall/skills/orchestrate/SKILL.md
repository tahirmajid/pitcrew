---
name: orchestrate
description: Tier-graded project orchestrator. Scaffolds and drives projects of any size (adhoc, small, medium, large) with the right amount of ceremony, using the shared playbooks, schemas and anti-pattern learning loop in the knowledge base. Use when the user runs /orchestrate (init, run, learn, status, resume), wants to start or resume a tracked project, drive a ticket through plan/implement/test/ship, or capture lessons learned.
---

# /orchestrate

The entry point for the orchestration layer in the knowledge base (the folder the pitwall plugin's `kb` MCP
server is configured with; called "the knowledge base root" below). All paths are relative to it:
the shared layer is `playbooks/`, project instances are `projects/<slug>/`. Read and write them
through the `mcp__plugin_pitwall_kb__*` tools (`read_file`, `write_file`, `edit_file`, `link_project`,
`link_resource`, ...).

It is **tool-agnostic**: every external action is guarded by the project's
`integrations.<x>.enabled`, so a project works fully local (no hosted git, issue tracker or CI)
unless those are turned on.

Argument: `/orchestrate <subcommand> [args]`. If no subcommand, treat as `status`.

## Always, first
1. Read `playbooks/playbooks.yml` (global config + paths).
2. Read `playbooks/tiers/tiers.yml` (the dial).
These two define every behavior below. Never hard-code tier ceremony — look it up.
File names follow `playbooks/CONVENTIONS.md`; note frontmatter follows `playbooks/schemas/frontmatter.md`.

---

## `init <name> --tier <adhoc|small|medium|large> [--repo R] [--goal "..."]`

Scaffold a new project under `projects/<name>/`.

1. Copy `playbooks/templates/project/*` → `projects/<name>/`.
2. Resolve the tier in `tiers.yml`. Fill `project.yml` from args + tier defaults: set `pipeline.roles`,
   `gates.local_green`, `gates.batch_gate`, `gates.require_peer_approval`, `state.*`, `learning.*`
   from the tier entry. Put `--repo` into `repos` (absolute path). Substitute all `<<...>>`
   placeholders. Ask the user for `commands.{build,test,lint,format}` if not derivable from the repo.
3. **Prune by tier** so the folder only carries what the tier uses (shape table in `CONVENTIONS.md`):
   - `adhoc`: keep `checklist.md` (or nothing); delete `tracker.json`, `STATUS.md`, `RESUME.md`.
   - `small`: keep `checklist.md`; delete `STATUS.md`, `RESUME.md`; `tracker.json` optional.
   - `medium`: keep `tracker.json` + `STATUS.md`; delete `RESUME.md`; remove `waves`/`wave_retros`/`active_prs`/`execution_strategy` keys from the tracker.
   - `large`: keep all; add `waves{}`, `wave_retros{}`, `active_prs[]`, `execution_strategy{}` to the tracker.
4. Validate `project.yml` against `playbooks/schemas/project.schema.json` and the tracker (if kept)
   against `playbooks/schemas/tracker.schema.json`.
5. Print the resume sentence (the tier's state artifact + `next_action`).

For **adhoc** you may skip `init` entirely — `run "<task>"` can operate folderless.

---

## `run [<ticket> | "<task>"] [--wave W | --batch]`

Drive a ticket through its tier's pipeline.

1. Resolve the project: the one whose `repos` (or `repo`) contains the current working directory —
   narrowed by `subdirs` when several projects share a repo — or the named one. If the project has
   `owns_skills`, **defer**: tell the user to use that project's own skill instead of driving it here.
2. Read `tier` → from `tiers.yml` get the active **role set**, execution mode, gates, learning depth.
3. **Assemble the per-ticket prompt** (see `playbooks/roles/README.md`): concatenate
   `pipeline.md` + the active role playbooks, substitute placeholders from `project.yml` + the
   ticket entry + the **promoted** rows of `projects/<name>/anti-patterns.md` and
   `playbooks/learning/GLOBAL-anti-patterns.md` (`<<INJECTED_ANTI_PATTERNS>>`). Save to
   `projects/<name>/prompts/<ticket>.md`.
4. **Plan gate (medium/large only — tiers with the planner role).** Run the Planner first; it
   writes the durable plan to `prompts/<ticket>.manifest.md` (`status: draft`) and records the path
   on the ticket (`tracker.json` → `tickets[].manifest`). Present the manifest for approval, flip
   it to `status: approved`, and only then start the Implementer. Never execute a `draft` manifest.
   If the ticket already has an `approved`/`executed` manifest (a resume), re-read it instead of
   re-planning. Adhoc/small skip this — the typed task / checklist line is the plan.
5. **Execute by execution mode:**
   - `inline` (adhoc) / `single` (small) / `serial` (medium): run the roles in order yourself
     (or via single Agent calls), honoring each role's gates and Stop Conditions.
   - `parallel_batches` (large): dispatch master→worker batches via the Workflow tool, batch size
     from `tiers.yml` defaults, enforce the batch gate.
6. **Gates:** before any push, every command in `gates.local_green` must pass against
   `project.yml.commands`. Never push red. (Large also enforces the batch gate.)
7. **Write state back:** update the tier's state artifact (`checklist.md` or `tracker.json`):
   ticket status, role_status, branch/PR, `next_action`. Add new PRs/tickets to `resources` when
   the project tracks links there. Guard issue-tracker/GitHub/CI calls by `integrations`.

---

## `learn [retro]`

Run the learning loop at the tier's depth (`tiers.yml` → `learning`):
- `off` (adhoc/small): nothing (optionally append a one-liner to the project's anti-patterns).
- `per_project` (medium): **capture** — upsert lessons from completed tickets into
  `projects/<name>/anti-patterns.md` as `candidate` rows with occurrence counts. No promotion.
- `full` (large): **capture** + `retro` — promote rows that hit `occurrences >= 3` OR
  `severity == critical` to `status: promoted`, write a `wave_retros` entry, and **lift** any
  genuinely stack-neutral promoted row up into `playbooks/learning/GLOBAL-anti-patterns.md`.

Follow the column contract + promotion rule in `playbooks/schemas/anti-patterns.schema.md`.
Never hand-edit existing rows outside this flow.

---

## `status [<name>]`
- No name: scan every `projects/*/project.yml`, print each project's `name`, `tier`, `status`, and
  `next_action` (read from its tracker/checklist; if `state.tracker` points elsewhere, read it in
  place). One line per project; skip nothing, but list `paused` after `active`.
- With a name: print that project's full board (`STATUS.md` if present, else reconstruct from
  the tracker/checklist), plus its `resources`.

## `resume <name>`
Print the project's `RESUME.md` (large) or reconstruct a TL;DR from its `tracker.json` /
`checklist.md` (medium/small): what's done, what's open, and the exact next steps. Mention the
latest file in `handoffs/` if newer than `RESUME.md`. For any ticket mid-flight, surface its
manifest (`tickets[].manifest`) and `status` so work resumes from the existing plan rather than
re-planning.

---

## Guardrails
- Respect the user's authorship and PR-title rules (e.g. from their global CLAUDE.md).
- Stay tool-agnostic: never call issue-tracker/GitHub/CI/Workflow tools whose
  `integrations.<x>.enabled` is false.
- Never modify files a project lists under `owns_skills` or points to outside its own folder
  unless the user asks.
- Indexing is automatic; generated files under `runs/` and `logs/` are excluded by `.pitwall/ignore`.
  Put bulky run output there, not next to the notes.
