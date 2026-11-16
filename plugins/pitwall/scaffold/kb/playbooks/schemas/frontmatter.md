---
title: Note Frontmatter Contract
type: reference
description: The YAML frontmatter keys every Markdown note in the knowledge base may carry, and the type vocabulary.
---

# Note frontmatter

Every Markdown note may open with a YAML frontmatter block. Only `title` and `type` are expected;
everything else is optional. Notes without frontmatter (or with an unknown `type`) are still
indexed and searchable — frontmatter only sharpens filtering and ranking.

```yaml
---
title: Checkout redesign — status
type: status
project: checkout-redesign
status: active
tags: [payments, ui]
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

| key | expected | meaning |
|---|---|---|
| `title` | yes | Human title. Falls back to the first `#` heading, then the file name. |
| `type` | yes | One value from the vocabulary below. |
| `project` | no | The project slug (`projects/<slug>/`) this note belongs to. Inferred from the path when omitted. |
| `status` | no | Lifecycle of the note itself, free text per type (e.g. `draft`, `active`, `accepted`, `superseded`). |
| `tags` | no | List of free-form tags. |
| `created` | no | ISO date `YYYY-MM-DD`. |
| `updated` | no | ISO date `YYYY-MM-DD` of the last meaningful edit. |

Extra keys are allowed and ignored by the index (e.g. a manifest's `ticket` and `base`).

## `type` vocabulary

| type | use for |
|---|---|
| `readme` | folder or project index |
| `status` | live board (`STATUS.md`) |
| `handoff` | resume snapshot or dated handoff (`RESUME.md`, `handoffs/*.md`) |
| `plan` | `PLAN.md`, Planner manifests |
| `backlog` | `BACKLOG.md` |
| `rules` | `RULES.md`, `anti-patterns.md`, pipeline rules |
| `decision` | ADRs under `decisions/` |
| `runbook` | step-by-step operational procedures under `runbooks/` |
| `review` | review write-ups under `reviews/` |
| `retro` | retrospectives under `retros/` |
| `prompt` | reusable prompts, assembled role prompts, role playbooks |
| `reference` | stable facts: schemas, domain docs, gotchas |
| `note` | anything else; quick notes in `inbox/` |
