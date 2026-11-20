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
- **A hook that routes spawns.** Before every Agent call it reads the usage verdict and refuses:
  - a `codex:*` spawn with no `name`, with a message to add one and retry;
  - a Claude subagent while the verdict is `orchestrate` or `codex-all`, unless it is a reviewer;
  - a Claude subagent under a `50-50` verdict once the session has started two more Claude jobs than Codex jobs.

  A line `claude-only: <reason>` in the prompt lets a job through that Codex can't do. Set `CODEX_HOUSE_USAGE_SCRIPT` to your own verdict script to route by your own tiers. If the hook itself fails, the spawn goes through.
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

### pitwall

A local, Markdown-first knowledge base for agents. Point it at a folder of notes and it serves search, projects and linked tickets, threads, docs and PRs over MCP. Everything runs on your machine.

- **Search:** hybrid BM25 and vector search over Markdown-aware chunks, boosted toward the current project, with optional graph expansion from shared ticket ids and links.
- **Projects and resources:** `projects/<slug>/project.yml` ties repos, tiers and linked resources together. Links are stored, never fetched.
- **Review ledger:** records findings and what was done with each; `review_codex_run` can run the Codex CLI on a diff.
- **Skills included:** `pitwall` covers how an agent uses the knowledge base. `orchestrate` drives projects with the right amount of process for their tier.
- **Hook:** at session start it reminds the agent to recall before answering from memory.

```
claude plugin install pitwall@pitcrew      # asks for the knowledge base folder
```

**Requirements:** Node >= 22.13. The first start downloads a ~35 MB embedding model and builds the index. See `plugins/pitwall/README.md`.

## License

MIT
