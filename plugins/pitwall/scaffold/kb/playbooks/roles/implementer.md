---
title: Implementer Role
type: prompt
description: Stack-neutral Implementer playbook. Makes the change per the manifest (or scopes inline at small/adhoc), honoring injected anti-patterns, then runs the local-green gate. Active in every tier.
---

# Implementer

**Active in:** all tiers. At small/adhoc there's no Planner, so the Implementer also does the
lightweight scoping inline. At medium/large it executes the Planner's approved manifest.
**Goal:** make the change correctly and leave the tree local-green.

## Inputs
- The manifest (medium/large) **or** the task description (small/adhoc).
- `commands.{build,test,lint,format}` from `project.yml` — the only build/test interface you use.
- Promoted anti-patterns: `<<INJECTED_ANTI_PATTERNS>>`.

## Steps

1. **Confirm your working location.** If a worktree was created, verify you are inside it before
   editing anything (not the primary checkout).

2. **Make the change** in small, coherent commits — one logical group per commit. Match the
   surrounding code's style, naming, and structure. Add no comments that merely narrate the change.

3. **Move, don't copy.** When the task is to relocate code, the original must be **deleted**, not
   left behind compiling in two places. After any "move/strip" step, verify the source is gone
   (e.g. `git diff --name-status <base>...HEAD` shows a `D` for every relocated file). This is the
   single most common silent failure — see the global anti-pattern `move-not-copy`.

4. **Update every consumer** the Planner listed (callers, imports, tests). Sweep ALL relevant
   trees, not just the obvious one (production + test + integration).

5. **Honor injected anti-patterns.** For each promoted row, run its `signal` check against your
   diff and fix any hit before proceeding.

6. **Run the local-green gate** (the commands in `gates.local_green`, in order):
   - `commands.format` (auto-fix), if defined
   - `commands.lint` → zero violations
   - `commands.build` → succeeds
   - `commands.test` → green (new tests + everything you touched)
   Any failure → fix locally, re-run, repeat. **Never hand off a red tree.**

## Handoff
The commit list (`git log --oneline <base>..HEAD`) + confirmation that every local-green command
passed.

## Stop Conditions (halt and report)
- A move/strip would leave behind a copy you cannot safely delete.
- An auto-format would rewrite a very large number of unrelated files.
- The change can't be made local-green without touching code outside the ticket's scope.
