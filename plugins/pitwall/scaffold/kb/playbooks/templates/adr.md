---
title: "NNNN — <short decision title>"
type: decision
project: <<PROJECT_SLUG>>
status: proposed        # proposed | accepted | superseded
created: YYYY-MM-DD
updated: YYYY-MM-DD
# superseded_by: NNNN-<slug>.md
---

# NNNN — <short decision title>

Save as `decisions/NNNN-<slug>.md` (zero-padded, never renumbered). One decision per file. To
change a decision, write a new ADR and mark this one `superseded` with a link to it.

## Context and problem

What situation forces a decision? State the problem in two or three sentences, ideally as a question.

## Decision drivers

- <driver, e.g. must work offline>
- <driver, e.g. no new runtime dependency>

## Considered options

1. <option A>
2. <option B>
3. <option C>

## Decision outcome

Chosen option: **<option>**, because <justification tied to the drivers>.

## Consequences

- Good: <what gets easier>
- Bad: <what gets harder, what we now have to maintain>
- Follow-up: <tickets or checks this decision creates>

## Pros and cons of the options (optional)

### <option A>
- Good, because …
- Bad, because …

### <option B>
- Good, because …
- Bad, because …
