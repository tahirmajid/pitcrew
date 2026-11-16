---
title: Anti-Patterns Schema
type: reference
description: The column contract and promotion rule for every anti-patterns.md (global + per-project). Hand-edit the header/schema only; rows are upserted by the /orchestrate learn flow.
---

# Anti-Patterns — Schema

Every `anti-patterns.md` (the cross-project `playbooks/learning/GLOBAL-anti-patterns.md` and each
`projects/<slug>/anti-patterns.md`) is a single Markdown table where **one row = one hard-won
rule**. Markdown is used (not JSON) because these rows are both *injected into agent prompts as
rules* and *reviewed by a human* — Markdown wins on both.

## Columns (one row per pattern)

| field | meaning |
|---|---|
| `slug` | stable kebab-case id; the dedupe/upsert key |
| `rule` | the imperative rule an agent must follow |
| `signal` | a fast, stack-agnostic check that detects the violation (a grep, a count, an observation) |
| `phase` | `planner` / `impl` / `test` / `ship` / `review` / `conflict` / `any` |
| `severity` | `critical` (promotes on first sight) / `major` / `minor` |
| `work_type` | free tag for filtering (e.g. `split` / `swap` / `migration` / `any`) |
| `occurrences` | count of distinct source tickets that hit this |
| `source_tickets` | which tickets surfaced it |
| `status` | `promoted` (loaded into prompts) / `candidate` (awaiting threshold) |

## Promotion rule

```
occurrences >= 3  OR  severity == critical   ->   status: promoted
```

Only `promoted` rows are injected into role prompts (via `<<INJECTED_ANTI_PATTERNS>>`).
`candidate` rows are tracked until they cross the threshold.

## Scope: global vs per-project

- **`playbooks/learning/GLOBAL-anti-patterns.md`** — only **stack-neutral** rules that apply across
  any project regardless of language/framework (e.g. "stripping is MOVE not COPY", "every new module
  needs its lint baseline", "tests must cover every state branch, not just the happy path").
- **`projects/<slug>/anti-patterns.md`** — project- and stack-specific rules. This is the
  quarantine for everything that names a tool (a DI framework, a specific linter, an HTTP client,
  a web framework, a package manager, etc.). A `large`-tier project's `learn retro` may *lift* a row
  up to GLOBAL **only after** confirming it is genuinely stack-neutral.

## Editing

Do **not** hand-edit rows — run `/orchestrate learn` (capture upserts + counts; retro promotes).
Hand-editing is fine only for the header/schema text above the table.
