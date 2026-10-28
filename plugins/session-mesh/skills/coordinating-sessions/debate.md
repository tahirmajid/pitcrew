# Debate protocol

One question, two or three sessions: `proposer`, `critic`, and optionally `judge` (otherwise the user judges).
Each joins the same project with its role.

## Rounds

Copy and track:

```
- [ ] R0 judge (or user) sends both sides the question and what a decision must settle
- [ ] R1 proposer -> critic: position
- [ ] R1 critic -> proposer: rebuttal
- [ ] R2 proposer -> critic: answer or concede
- [ ] R2 critic -> proposer: answer or concede
- [ ] R3 (only if still split) one final exchange
- [ ] each side -> judge: final position in five lines
- [ ] judge records the decision and tells both sides
```

At most three rounds. Stop early when one side concedes or both converge.

## Codex as an extra critic

When the question is about code or a diff, the judge (or the user) runs a Codex review before the final round and
sends both sides its findings as one extra position, `DEBATE R<n> codex`:

- Code or diff: a Codex review of the diff (e.g. `codex:codex-rescue`, or your Codex review tool with a diff base or the uncommitted changes).
- Design with no diff yet: the `codex:rescue` agent, given the question and both positions.

Each side must answer every Codex finding: accept it, or refute its premise with evidence. Codex never decides;
the judge weighs it like any other position.

## Message format

```
DEBATE R<n> <role>
Claim: <one sentence>
Evidence: <file:line, command output, or link - checked, not recalled>
Premise check: <the opponent's premise you verified or refuted, and how>
Concede: <points you now accept, or "none">
```

Under 300 words per message; a longer position goes in a note (pointer message, see SKILL.md). Argue from evidence, never from agreement; a claim without evidence loses.
No new questions after R1.

## Decision record

The judge writes it where the project keeps decisions (the project's PLAN or decisions file; through the knowledge
base's own tools when it has an access rule):

```
## Decision: <question> (<date>)
Chose: <option>
Rejected: <option> - because <the evidence that decided it>
Open risks: <what could make this wrong>
Debate: <proposer address> vs <critic address>, <n> rounds
```
