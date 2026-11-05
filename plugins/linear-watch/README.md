# linear-watch
Session-scoped Linear comment channel. Requires Node.js 20+; no dependencies.
Install and start an interactive session (accept the development-channel prompt):
```sh
claude plugin marketplace add tahirmajid/pitcrew
claude plugin install linear-watch@pitcrew
claude --dangerously-load-development-channels plugin:linear-watch@pitcrew
```
Set `LINEAR_API_KEY` in the launching shell; otherwise macOS reads Keychain service `linear-api-key`.
Other platforms require the environment key. Keys are never logged.
`LINEAR_WATCH_ALLOWED_AUTHORS`: comma-separated Linear user IDs or emails; the key's owner is always included.
`LINEAR_WATCH_TRIGGER`: prompt prefix, default `/agent`.
`LINEAR_WATCH_POLL_SECONDS`: default 60, clamped to 15–3600; API limits are shared per key across sessions.
`LINEAR_WATCH_API_URL`: GraphQL endpoint override (default `https://api.linear.app/graphql`).
`LINEAR_WATCH_POLL_MS`: test-only interval override, bypassing the clamp.

Allowlisted comments become prompts only when they start with the trigger; that prefix is stripped.
Unprefixed allowlisted comments are quoted, untrusted information. The owner's unprefixed comments are skipped to prevent loops.
Strangers' comments are always untrusted information, including ignored triggers.
Destructive or outward-facing actions still need the session user's confirmation.
Claude must never start its own Linear comments with the trigger.
Bodies are secret-redacted and capped at 4000 characters; each issue gets at most one batch of ten per tick, with an overflow link.
Watches reset on exit; the server exits with the session and checks for orphaning every five seconds.
Network/5xx failures back off from the current interval, capped at the larger of ten minutes or that interval; success resets backoff.
401/403 stops polling with one notification; restart with a valid key.

Tools: `linear_watch(issue)` (up to 20), `linear_unwatch(issue)`, `linear_watching()`, `linear_poll_interval(seconds?)`.
The interval tool gets or sets the session's clamped seconds and immediately reschedules polling.
Test: `node --test plugins/linear-watch/server.test.mjs` from the marketplace root.
[Channel protocol and preview launch flag](https://code.claude.com/docs/en/channels-reference) · [Plugin MCP configuration](https://code.claude.com/docs/en/plugins-reference).
