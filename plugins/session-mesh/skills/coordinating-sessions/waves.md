# Parallel waves (level 3)

One planner, up to three implementers, each on its own ticket in its own worktree. Level 3 lets a project hold three
claimed tickets at once; levels 0-2 allow one.

## Planner

1. Split the work into tickets that touch disjoint files. Two tickets editing the same file go in different waves.
2. Number the waves. Hand each implementer one ticket:

```
HANDOFF planner -> implementer
What: <ticket id> - <goal>
Where: new worktree from <base branch>: git worktree add ../<repo>-<ticket> -b temp/<ticket>
Wave: <n>
Done when: tests green in that worktree, committed on temp/<ticket>
```

3. When every ticket in a wave reports done, merge each `temp/<ticket>` into the wave branch one at a time, run the
   tests after each merge, and send any conflict back to the ticket's implementer. Start the next wave after that.

## Implementer

1. Create the worktree from the handoff and work only there. Its write lock is yours alone.
2. Call `session-mesh:claim` with the ticket and wave. A refusal means another session has it, or the project is at
   its cap: tell the planner, do not start.
3. Done: commit, send the planner the branch and test result, then `/mesh unclaim` (the person types it) or let the
   session end.

Builds share two gradle slots across the machine; a denied build means retry later, not wait in a loop.
