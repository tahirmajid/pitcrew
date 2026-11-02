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

### codex-house

House rules for handing work to OpenAI Codex from Claude Code. It runs on [SSS135/claude-code-codex-plugin](https://github.com/SSS135/claude-code-codex-plugin), which this marketplace lists unmodified as `codex`, pinned to a release tag. Installing `codex-house` installs it too.

- **Skill `codex-routing`:** which work goes to Codex and which stays with Claude, by Claude's weekly use: under 60% Codex does review, second diagnosis and legwork; from 60% implementation too; from 75% most of the work, with Claude orchestrating and verifying. `usage-balance.py` prints the current tier; `statusline-limits.py` gives it Claude's numbers.
- **Skill `delegate-to-codex`:** role presets (implementer, reviewer, runner, rescuer) as header lines on `codex:sol` / `codex:luna`, a `.handoff/<job>.md` brief template, the `## Result` format, how to verify and commit, and what to do when Codex fails.
- **Hooks that warn, never block:**
  - at session start, a warning when another plugin named `codex` is installed, or the Codex CLI is missing or logged out;
  - before a `codex:*` spawn, `.handoff/` is added to the repo's `info/exclude`;
  - after a job, a warning to Claude (on its next tool call or your next message) when `## Result` fields are missing, HEAD moved, or a commit carries `Co-Authored-By`.
- **Limits** (no `full-access` / `yolo` unless asked, one writer per worktree) are guidance in the skill.
- Tests: `node --test plugins/codex-house/hooks/hooks.test.mjs`.

```
claude plugin install codex-house@pitcrew      # also installs codex@pitcrew
codex login                                    # once, if Codex isn't logged in
```

**Requirements:** the [Codex CLI](https://github.com/openai/codex) on your PATH, and a Claude Code build that loads mods. Remove `codex@openai-codex` if you have it: both plugins are named `codex`, and the `codex:*` agents don't load while both are installed.

Add your own rules (routing, budgets, team conventions) as a separate personal skill that tells Claude to load `codex-house:delegate-to-codex` first.

## License

MIT
