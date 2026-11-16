---
title: "EDD: [Title]"
type: plan
status: draft
created: YYYY-MM-DD
---

# EDD: [Title]

| **Creation date** | YYYY-MM-DD |
| -- | -- |
| **PRD** | [Link to PRD or N/A] |
| **Status** | Draft \| In Review \| Implementation \| Complete \| Obsolete |
| **Owner(s)** | @name |
| **Reviewer(s)** | @reviewer1, @reviewer2 (anyone else feel free to add yourself) |
| **Ticket(s)** | [TICKET-ID] |

---

# Background

Provide context and motivation. Answer:
- What is the current state of the system?
- What problem are we solving?
- Why is this being prioritised now?

# Goals

List the concrete goals this EDD is trying to achieve. Be specific.

1. Goal one
2. Goal two
3. Goal three

**Non-goals** (optional): explicitly state what is out of scope to avoid scope creep.

# Current Design (Problematic)

Describe the existing design and what's wrong with it. Include:
- How the system currently works
- The specific failure modes, limitations, or pain points
- Any data or observations supporting the problem statement

# Available Solutioning Tools

List the building blocks or approaches available to solve the problem. A table works well here.

| Tool | Description |
| -- | -- |
| 1 | **Option A** — brief description |
| 2 | **Option B** — brief description |
| 3 | **Option C** — brief description |

# Solution 1: [Name]

Describe the first candidate solution in detail.

- How it works end-to-end
- Any sub-decisions or open questions
- Relevant diagrams or pseudocode if helpful

**Pros:**
- ...

**Cons:**
- ...

# Solution 2: [Name]

Describe the second candidate solution in detail.

**Pros:**
- ...

**Cons:**
- ...

# Proposed Solution

State the recommended approach and why. Address:
- Which solution (or combination) is preferred
- Why the alternatives were ruled out
- Any conditions under which we'd revisit this decision
- Migration or rollout strategy if applicable

Record the final choice as an ADR in `decisions/` (see `adr.md`).

# Appendix

## Supporting Data / Benchmarks

Include any production stats, profiling results, or benchmarks that informed the decision.

## Open Questions

- [ ] Question 1 — owner: @name
- [ ] Question 2 — owner: @name

## Discussion Log

Use dated sections for significant async discussions, e.g.:

### YYYY-MM-DD Discussion
- Key decision or conclusion from the discussion
- Any trade-offs agreed upon
