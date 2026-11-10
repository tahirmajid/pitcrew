# Locks and denials

| Deny text starts with | Meaning | Do |
|---|---|---|
| `worktree ... is leased by X, its writer` | another session owns writes there | SendMessage X the change you need, or work in a separate `git worktree add`; never retry the same write |
| `path ... is claimed by X` | another session claims that file (any worktree of this repo) | SendMessage X and ask it to release the path (`release_paths`); never edit it another way or push your change into X's chat |
| `both gradle-heavy slots are busy` | two builds already run on this machine | do other work, retry in a few minutes; never loop |
| `run gradle in the foreground` | a background build would free its slot early | run it in the foreground |
| `role X does not write to worktrees` | your role is read-only | send the change to the implementer |
| `<lock> is held by X` | a configured device or tool (e.g. the e2e device) is in use | wait for X; the person types `/mesh release` there when it is done |
| `PR ... has no reviewer sign-off` | a reviewer is joined and has not signed off | hand the PR to the reviewer, see [review.md](review.md) |
| `guard failed closed` | the mod errored | tell the user; they can run `/mesh off` |

When a session finishes writing, the person types `/mesh release` there (it frees that session's own leases; the
next write takes them again). Only the person may run `/mesh steal <worktree>` (take a lease from a live session) and
`/mesh off` / `/mesh on` (kill switch). Ask; never work around a lock.

## Path claims

The first Edit, Write or NotebookEdit of a file claims its repo-relative path for the session; `claim_paths` claims
paths or globs up front. Claims are shared by every worktree of one repo (same `git rev-parse --git-common-dir`), only
bind sessions in the same project, and lapse when the session dies. `/mesh release` or `release_paths` frees them;
`path_claims` lists them. Bash writes (`sed -i`, redirects, `git checkout`) are not checked.

## Device and tool locks

`~/.claude/mesh/tool-locks.json` lists locks as `{ "lock", "tools" (tool-name regex), "bash" (command regex) }`.
The first matching call takes the lock for the session's lifetime or until `/mesh release`.
