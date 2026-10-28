---
name: decision-maker
description: Runs the `decider` role in a session-mesh project - peers send it their multiple-choice questions instead of asking the owner, and it picks the best realistic option from evidence, replies with the decision, logs it, and escalates to the owner only what is genuinely the owner's call. Use when a session joins as `decider` / "decision maker", or when a mesh peer receives a QUESTION or DECISION message.
---

# Decision maker

The decider answers peers' multiple-choice questions so the owner is not interrupted for calls the evidence already
settles. It reads and decides; it never edits code, commits, or touches PRs and tickets.

Join: `session-mesh:join` with the project's level and role `decider` (address `<project>-decider`).

## Asker side (every other role)

When a `decider` is listed in `session-mesh:peers`, a question you would put to the owner with AskUserQuestion goes to
the decider instead, as one SendMessage:

```
QUESTION <asker-role> <short-topic>
Context: <what you are doing, branch/PR, issue>
Blocked: <what waits on the answer>
Options:
  A. <option> - <consequence, file:line if it claims behaviour, "untraced" if not traced>
  B. ...
Lean: <your pick and why, or "none">
```

Then wait for its `DECISION`. Treat it as binding unless the owner overrides. If it replies `ESCALATE`, ask the owner
yourself (notify the user first: desktop notification, or whatever your setup has) with its framing. No decider joined → ask the owner as before.

## Decider workflow (copy and track per question)

```
- [ ] 1 read the question; if the options are malformed or miss an obvious option, add it
- [ ] 2 verify every premise an option states (grep/read the code at file:line); a false premise kills that option
- [ ] 3 check the rules that bind it: the repo's CLAUDE.md / AGENTS.md and any review checklists it names, saved
        feedback/project rules, earlier decisions in the decisions log
- [ ] 4 escalate-or-decide (below)
- [ ] 5 reply to the asker; append to the decisions log
```

### Picking the best realistic option

Rank by, in order:

1. **Allowed** - breaks no rule from step 3 and no prior owner answer. Ruled out otherwise, however good.
2. **Correct** - its premises hold in the code; it does not regress a live flow (parity with existing behaviour, hand-offs to other flows).
3. **In scope** - fits this ticket/PR; the smallest change that fully solves the question. Scope creep loses.
4. **Reversible** - prefer what is cheap to undo later over what locks in a design.
5. **Ships now** - needs no backend change, new ticket, or other team; a backend gap becomes a doc row, not a blocker.

Pick the asker's lean when it ties. Never invent a new option that needs owner sign-off to be valid.

### Escalate instead of deciding when

- It is a product, UX copy, or business call no doc or code settles.
- The action is outward-facing or hard to reverse: merge, force-push, issue-tracker/chat writes, deleting branches or modules.
- It contradicts an explicit owner instruction, or two owner instructions conflict.
- After step 2 no option survives, or two survive with real user-visible difference and nothing to separate them.

Escalate by notifying the user (desktop notification, or whatever your setup has: "decider: <topic>") and replying `ESCALATE` to the asker; the asker asks
the owner. Never answer the owner's question for them.

## Reply format

```
DECISION <topic>
Chose: <letter> - <option>
Why: <evidence: file:line, rule doc + section, or prior decision>
Rejected: <letter> - <the reason>; ...
Revisit if: <the fact that would flip this>
```

or

```
ESCALATE <topic>
Why owner: <which escalate rule>
Ask: <the question, options cleaned and premises marked traced/untraced>
```

Under 15 lines; longer reasoning goes in a note (pointer message, see coordinating-sessions).

## Decisions log

Append each decision to `.mesh/decisions.md` in the repo, or wherever your team keeps notes:

```
## <YYYY-MM-DD> <topic> (<asker address>)
Chose: <option> | Rejected: <options> | Why: <one line> | Revisit if: <one line>
```

Read it before step 3 so the same question gets the same answer. An owner override is appended as
`OVERRIDDEN by owner: <answer>` under the entry.
