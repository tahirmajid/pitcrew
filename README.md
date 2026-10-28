# pitcrew

A crew of Claude Code mods and skills. It installs as a plugin marketplace:

```
claude plugin marketplace add tahirmajid/pitcrew
claude plugin install <plugin>@pitcrew
```

## Plugins

### session-mesh

This plugin runs several Claude Code sessions on one project as a crew. Each session joins with a role, and the crew shares one view of who is doing what.

- **Roles:** the roles are planner, implementer, tester, reviewer, researcher, decider, and proposer/critic/judge for debates. Peers address each other as `<project>-<role>`.
- **Presence band:** shows each peer's role, claimed ticket, current tool and context usage.
- **Locks:** one writer per worktree. You can add your own tool locks in `~/.claude/mesh/tool-locks.json`, for example "one session at a time on the e2e device".
- **Gates:** while a reviewer is joined, a PR can't be marked ready until the reviewer signs it off. Ticket claims stop two sessions taking the same ticket.
- **Skills included:** `coordinating-sessions` covers the protocol: handoffs, waves, debates and locks. `decision-maker` lets one `decider` session answer the crew's multiple-choice questions, so the questions don't all go to you.

```
claude plugin install session-mesh@pitcrew
/mesh join my-app 2 implementer     # level 0-3 caps parallel tickets
/mesh                                # status
```

Usage: `/mesh [status] | join <project> <level 0-3> [role] | claim <ticket> [wave] | unclaim | signoff <pr> <ledger> | release | steal <worktree> | off | on`

**Requirements:** a Claude Code build that loads mods (`hooks/register.tsx` uses the mod runtime). State lives in `~/.claude/mesh/`. Tested on macOS; the lease script also handles GNU `stat`.

## License

MIT
