---
name: coordinating-sessions
description: Coordinates several Claude Code sessions working on one project through the session-mesh mod - each session joins with a role (planner, implementer, tester, reviewer, researcher, or proposer/critic/judge for debates), messages peers by role, hands work off, respects the one-writer-per-worktree and device locks, gates PRs on reviewer sign-off, and runs parallel ticket waves. Use when the user runs more than one session on the same work, asks sessions to talk to, hand off to, or argue with each other, mentions /mesh, a mesh role or address, or when a tool call is denied with "session-mesh:".
---

# Coordinating sessions

The session-mesh mod gives each session a role inside a project and enforces locks. Messages travel through the
built-in SendMessage tool. Mod tools: `session-mesh:join`, `peers`, `claim`, `signoff` (`mcp__session-mesh__<name>`).

## Join first

1. Project name: the user's existing project name if they keep one (e.g. `my-app`), otherwise a short kebab-case name for the work; tell the user.
2. Level: 0 adhoc, 1 small, 2 medium, 3 large; the project's declared tier when it has one. Every session in a
   project uses the same level.
3. Role: the one the user gave. None given and other sessions exist → ask the user.
4. Call `session-mesh:join` with `project`, `level`, `role` (the person can type `/mesh join <project> <level> <role>`).

The address is now `<project>-<role>` (`-2`, `-3` when a role repeats). A restarted session joins again.

## Roles

| Role | Does | Writes to the worktree |
|---|---|---|
| planner | breaks work into steps, owns the plan | no |
| implementer | changes code | yes, holds the write lease |
| tester | runs builds and tests, reports failures | builds only |
| reviewer | reviews PRs, signs them off, see [review.md](review.md) | never (denied by the mod) |
| researcher | finds facts, prior art, docs | never (denied by the mod) |
| proposer, critic, judge | debate one question, see [debate.md](debate.md) | critic and judge never |
| decider | answers peers' multiple-choice questions instead of the owner, see the `decision-maker` skill | never |

Several implementers on separate tickets: see [waves.md](waves.md).

A `decider` is joined → send it your multiple-choice questions (`QUESTION` format in the `decision-maker` skill)
instead of AskUserQuestion; ask the owner only when it replies `ESCALATE`.

## Messaging

1. Call `session-mesh:peers` once. Each line is `<project>-<role>  to: uds:/tmp/cc-socks/<pid>.sock`.
   Reuse those addresses; call `peers` again only when a send fails or the user says a session joined or restarted.
2. SendMessage with `to` set to the `uds:` address exactly. Never put the mesh address in `to`: auto mode cannot
   judge an unknown name and the send fails hard.
3. The mod stamps `[from <your address>]` on the text. Reply by copying the incoming `from=`.

Keep messages short and self-contained: the receiver has none of your context, and every line costs it tokens.

**Pointer messages.** A body over ~10 lines (test output, plans, findings, debate positions) goes in a note; the
message carries one line and the path:

- Write `.mesh/notes/<YYYY-MM-DD>-<role>-<topic>.md` in the repo (or `~/.claude/mesh/projects/<project>/notes/` outside
  one), or wherever your team keeps notes. The receiver reads it with its normal file tools.

Read a note only when the one-line summary is not enough to act on.

Handoff format:

```
HANDOFF <from-role> -> <to-role>
What: <the one thing to do>
Where: <worktree path>, branch <name>, files <paths>
Evidence: <command + result in one line, or the note path>
Done when: <checkable condition>
```

Handoff workflow (copy and track):

```
- [ ] planner -> implementer: plan location + acceptance criteria
- [ ] implementer -> tester: worktree, branch, what changed, exact test command
- [ ] tester -> implementer: failures (note path when long); repeat until green
- [ ] implementer -> reviewer: diff base and the green test command
- [ ] reviewer -> implementer: findings, each with file:line and a failure scenario
- [ ] implementer -> planner: done, or what changed in the plan
```

A finding or failure goes back to the implementer, never fixed by the role that found it.

## Token budget

Every turn re-reads the whole context, so cost = context size × turns. Measured 2026-10-16: long-lived roles ran
300–500k context for 1000+ turns (~95% of spend); a fresh peer starts at ~80k; mesh messages themselves are noise.

1. **Cap context.** Past ~200k, write your state (role, task, branch, worktree, next step, open handoffs) to a
   pointer note, then ask the owner to `/compact` (or `/clear` + rejoin from the note). Orchestrator and implementer
   hit this first.
2. **Subagents by default, peers by exception.** A subagent's context is discarded when it returns; a peer's keeps
   growing and is re-read on every wake. Review, research, testing, a single decision, a debate round → subagent.
   Join a standing peer only for a role that holds a write lease or device lock, or serves many requests over hours
   (orchestrator, implementer). Before adding a peer, say why a subagent won't do.
   Route the subagent's model by thinking needed (your own token-efficiency rules): `haiku` for no-judgement
   legwork (grep and report, run a command and return failure lines, apply an exact patch), `sonnet` for search and
   mechanical work from an approved plan, `opus` for plan, review, design, root cause.
3. **Batch sends.** Every message wakes a receiver that re-reads its full context. Collect findings, questions and
   status into one message; never send "ack", "on it" or progress pings. No reply needed → say `No reply needed.`
4. **Idle is free, polling is not.** Wait for a message or task notification; no short ScheduleWakeup/Monitor loops
   to check on peers. CI watching: one check sized to the CI run, not per-minute.
5. **Lean starts.** A new peer reads only what its role needs: the handoff, the named note, the named files. No
   whole-plan or whole-doc reads "for context"; in the kickoff brief, list the exact paths.
6. **Keep big output out of context.** Gradle/test logs: grep the failure lines, never cat the full log. Wide searches
   go to an Explore subagent so only the conclusion lands in the role's context.

## Locks and denials

A call denied with `session-mesh:` → see [locks.md](locks.md). Never retry the same call another way, and never run
`/mesh steal` or `/mesh off` yourself: only the person types those.

## Changing the mod

See [changing-the-mod.md](changing-the-mod.md) for the gates every change to session-mesh must pass.
