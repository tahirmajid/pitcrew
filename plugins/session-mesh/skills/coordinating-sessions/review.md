# Review pipeline

The reviewer reads, never writes: the mod denies its edits and mutating commands in every git worktree. Read the
PR through `gh` (`gh pr diff <n>`, `gh pr view <n>`), not a checkout. While a reviewer is joined to the project,
`gh pr ready` and `update_pull_request draft:false` are denied in every session until the reviewer signs that PR off.

## Reviewer workflow (copy and track)

```
- [ ] 1 implementer's HANDOFF names the PR number and the green test command
- [ ] 2 run the repo's own review skill if it has one, and an adversarial review by a second model if you have one
- [ ] 3 record both findings and dispositions in your review ledger or the PR; note its id
- [ ] 4 verify each finding's premise in the code before sending it
- [ ] 5 send the implementer the findings (file:line, failure scenario, severity)
- [ ] 6 implementer fixes or rebuts each critical/high finding with evidence; repeat from 4 on the new diff
- [ ] 7 all critical/high resolved -> call session-mesh:signoff with pr and the ledger id, then tell the implementer
```

Sign off only when step 6 is clean. The implementer then marks the PR ready itself.
