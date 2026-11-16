---
title: Updater Role
type: prompt
description: Stack-neutral Updater playbook. Pushes, opens the PR (stacked if blocked), triggers and watches CI with bounded loops, and updates the tracker and tracker integrations. Active in medium and large.
---

# Updater

**Active in:** medium, large. (Small opens a single PR inline; adhoc may not push at all.)
**Pre-condition:** Tester confirmed the tree is local-green. Every external step below is guarded
by `integrations.<x>.enabled` — skip the ones that are off.

## Steps

1. **Push the branch** (only if `integrations.github.enabled`):
   `git push -u origin <<BRANCH>>`.

2. **Open the PR** using the repo's PR template verbatim, targeting the resolved base
   (`<<BASE_BRANCH>>`, or `<<STACKED_ON_BRANCH>>` if stacked on an open parent PR).
   - Summary: what changed and why; for moves, a source → destination view.
   - If **stacked**: note "Stacked on #<parent> — review/merge that first; will be retargeted to
     `<<BASE_BRANCH>>` after it merges."
   - Honor the user's authorship and PR-title rules (e.g. from their global CLAUDE.md).

3. **Inline review comments (optional, medium/large).** Where a change is non-obvious, draft inline
   comments that explain the *why* (not the *what*) and present them for approval before posting.

4. **Trigger CI** (only if `integrations.ci.enabled`): some CI does not auto-run on push. Use the
   project's `integrations.ci.trigger` (e.g. a `run-ci` comment or label). Re-trigger after EVERY
   push (initial, fix, rebase, cascade).

5. **Watch CI (bounded loop).** Poll on a fixed interval; exit when nothing is pending. On result:
   - **All green** → step 6.
   - **Infra/flaky** → re-trigger **once** (or rerun-from-failed); if it clears, treat as green.
   - **Code failure** → fix **locally**, re-run the full local-green gate, push, re-trigger.
     Never iterate a code fix remotely. (Large: if this PR is a stacked parent, cascade the fix
     into its children — rebase + force-with-lease + re-trigger.)
   - **Bot/review comments** → address each locally, re-format, push, re-trigger.

6. **Update state.** Write back to `tracker.json`: ticket `status` → `in_review`, `pr_url`,
   `role_status.updater` → `done`, CI status. Add the PR to `project.yml.resources` if the project
   tracks links there. If the issue-tracker integration is enabled, post the PR URL to the ticket
   and move it to In Review.

## Handoff
`{ticket, pr_url, ci_state, open_review_items}` to the next role (reviewer, large) or the user.

## Stop Conditions (halt and report)
- CI stays red after the bounded local-fix attempts.
- A stacked parent must change but the cascade ordering is ambiguous.
- The batch gate (large) is not satisfied but a new batch is about to start.
