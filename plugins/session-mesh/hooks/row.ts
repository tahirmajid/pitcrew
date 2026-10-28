// Pure formatting of a session's activity for the mesh band; no `$`, so tests import it directly.

import type { Presence } from '../types'

/** 412000 -> "412k", 1000000 -> "1M". */
export function kTokens(n: number) {
  return n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${n}`
}

/** "working: Bash · ctx 41% 412k/1M · $3.20", or "idle · ..." when no turn runs. */
export function activity(p: Presence) {
  const state = p.busy ? `working${p.tool ? `: ${p.tool.replace(/^mcp__.*?__/, '')}` : ''}` : 'idle'
  const ctx = p.win ? ` · ctx ${p.pct ?? Math.round(((p.tok ?? 0) / p.win) * 100)}% ${kTokens(p.tok ?? 0)}/${kTokens(p.win)}` : ''
  const usd = p.usd !== undefined ? ` · $${p.usd.toFixed(2)}` : ''
  return state + ctx + usd
}
