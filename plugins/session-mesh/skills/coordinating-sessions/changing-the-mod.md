# Changing the session-mesh mod

The mod is a Claude Code plugin of function hooks: `hooks/register.tsx` (join, presence, band, guards, routing) and
`hooks/lease.sh` (every lock decision). Load the `plugin-authoring` skill before editing it.

Locks use generation numbers: a lease is `leases/<name>.g1, .g2, ...`; the highest is current and its `owner` file
names the holder (claude pid + its start time). A free or dead lease is taken with `mkdir <name>.g<n+1>`, which
exactly one session can win. Never reintroduce rename-to-reap: it destroyed 47 of 200 fresh leases under a 20 ms stall.

## Gates (copy and track)

```
- [ ] G1 claude plugin validate <mod> passes; tsc against the plugin-authoring types file passes
- [ ] G2 claude plugin test <mod> passes
- [ ] G3 every new guard or rule has a test that FAILS when the rule is broken (break it, watch it fail, restore)
- [ ] G4 lock change: run lease.sh against two processes with a forced stall between judge and mkdir; zero double holders
- [ ] G5 fresh-context adversarial review of the diff; every critical/high finding fixed or rebutted with evidence
- [ ] G6 two live sessions: writer holds the lease, the other session's write is denied, its read runs
- [ ] G7 promote the dev copy to the installed copy only after G1-G6
```

`tsc -p <mod>` with the engine-written types can fail with TS2589 or run out of memory on any `tool.call` hook;
that is the engine's typings, not the mod. Type-check against the plugin-authoring skill's `types/claude-code.d.ts`.

Live sessions run the installed copy (`session-mesh@pitcrew`); develop in a clone of the pitcrew repo so a broken
save never disables live guards. Promote:

```bash
# bump "version" in plugins/session-mesh/.claude-plugin/plugin.json, commit and push, then:
claude plugin marketplace update pitcrew && claude plugin update session-mesh@pitcrew
```

New sessions pick it up; running ones on restart. Never also start a session with `--plugin-dir` on the dev copy:
the mod would load twice.
