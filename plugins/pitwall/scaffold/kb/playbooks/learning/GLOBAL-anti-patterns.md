---
title: Global Anti-Patterns (cross-project, stack-neutral)
type: rules
description: Hard-won rules that apply to ANY project regardless of language or framework. Injected into every project's role prompts on top of its own anti-patterns. The /orchestrate learn retro flow promotes rows here only after confirming they are genuinely stack-neutral.
---

# Global Anti-Patterns — Canonical, Stack-Neutral

Schema and promotion rule: see `../schemas/anti-patterns.schema.md`.
**Only stack-neutral rules belong here.** Anything that names a tool (a DI framework, a linter, an
HTTP client, a web framework, a package manager, …) lives in that project's own
`projects/<slug>/anti-patterns.md`, never here.

Seeded from a large multi-wave migration; `source_tickets` reads `seed` for these starter rows.

## Patterns

| slug | rule | signal | phase | severity | work_type | occurrences | source_tickets | status |
|---|---|---|---|---|---|---|---|---|
| move-not-copy | Relocating code is a MOVE, not a COPY — every extracted file must be DELETED from its origin, not left compiling in two places. A build can pass with duplication. | `git diff --name-status <base>...HEAD` shows an `A` for a relocated file with no matching `D` | impl | critical | migration | 3 | seed | promoted |
| push-only-when-local-green | Never push a tree that fails locally and expect CI to debug it. Run the full local-green gate (build+test+lint) first; fix locally, re-run, then push. | a push happens before `commands.{build,test,lint}` all pass | ship | critical | any | 3 | seed | promoted |
| handle-tests-with-code | Every production file moved/changed/deleted must have its test(s) handled in the same change — relocated or updated, never orphaned. | a `*Test`/`*_test`/`*.spec` references a moved or deleted symbol | test | major | any | 3 | seed | promoted |
| cover-every-branch | A changed unit with multiple behavior branches (success/failure, empty/non-empty, parse-error) needs an explicit test per branch — a single happy-path test is insufficient. | the new test file has fewer cases than the impl has branches | test | major | any | 2 | seed | promoted |
| new-module-needs-baseline | A newly created build unit/module that has a linter or coverage baseline must get its baseline file immediately, or the first lint/build run aborts. | a new module dir is missing the project's expected baseline file | impl | critical | migration | 3 | seed | promoted |
| sweep-all-trees | When updating consumers after a signature/location change, sweep ALL trees (production + unit test + integration/e2e), not just the obvious one. | a stale reference survives in a test/integration tree after the main tree is updated | impl | major | any | 3 | seed | promoted |
| verify-claims-against-code | The ticket description is a hypothesis; the code is the truth. Confirm files exist at stated paths and consumer counts match before treating them as fact. | a planned file/path/count does not match what's actually in the repo | planner | major | any | 2 | seed | promoted |
| no-scope-creep-config | Do not touch unrelated config / ignore files (.gitignore, CI config, formatters) as part of a feature change — that scope belongs in its own change and over-eager cleanups have wiped real config. | the diff edits a root config/ignore file the ticket never mentioned | review | major | any | 2 | seed | promoted |
| infra-flake-rerun-once | A CI failure caused by infrastructure (artifact/download corruption, executor recycling, network) is not a code regression — rerun once (from-failed if possible). Never treat it as a code bug; never spam fresh runs. | CI fails with a download/zip/IO/executor error, not a compile/test/lint failure in project source | ship | major | any | 1 | seed | candidate |
| colocate-private-helpers | Private helpers that exist only to serve code being moved must move WITH it, not be left behind in the origin. | a helper only referenced by relocated code remains at the origin | impl | major | migration | 1 | seed | candidate |
