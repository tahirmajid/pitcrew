---
title: Reviewer Role
type: prompt
description: Stack-neutral Reviewer playbook. Posts a structured review, triages bot comments, and gates merge readiness. Active in the large tier only.
---

# Reviewer

**Active in:** large only. (Medium relies on the peer reviewer on the PR; small/adhoc skip.)
**Goal:** an independent correctness + scope review that produces a clear merge verdict, and
disposition of any automated (bot) review comments.

## Steps

1. **Read the diff against the ticket's scope.** Confirm the change does what the ticket asked and
   nothing it didn't (no scope creep, no unrelated files — e.g. stray config/ignore-file edits).

2. **Correctness pass.** Look for the failure classes this project keeps hitting — walk the
   promoted anti-patterns and check each `signal` against the diff. Flag criticals and majors
   separately.

3. **Triage bot/automated comments** (if `integrations.bots.enabled`). For each: is it a real
   issue (address it) or noise (resolve with a one-line reason)? Track how many remain open.

4. **Record the verdict** in `tracker.json` under the ticket's `pr_review`:
   `{ ready: bool, criticals: N, majors: N, bot_comments_open: N }`. For a longer write-up, save it
   under `projects/<slug>/reviews/`.

For findings that must survive an attack rather than a first-pass read, run
`playbooks/workflows/adversarial-loop.js` (see `../README.md`).

## Merge policy
A PR is **not** mergeable until `gates.require_peer_approval` is satisfied (a human approval) AND
`pr_review.ready == true` with zero open criticals. The reviewer never self-approves the merge
gate; it only reports readiness.

## Handoff
`{ticket, ready, criticals, majors, bot_comments_open}` to the master/orchestrator. If not ready,
bounce back to the Updater/Implementer with the specific findings.
