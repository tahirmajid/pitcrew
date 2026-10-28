import { expect, test } from 'claude-code/testing'

import { activity, kTokens } from './row'

const base = { id: 'x', pid: '1', lstart: 'l', worktree: '/w', at: 0 }

test('token counts read as k and M', () => {
  expect([kTokens(950), kTokens(412_300), kTokens(1_000_000), kTokens(1_250_000)]).toEqual(['950', '412k', '1M', '1.3M'])
})

test('a working session shows its tool, context fill and cost', () => {
  expect(activity({ ...base, busy: true, tool: 'mcp__notes__read_file', tok: 412_000, win: 1_000_000, pct: 41, usd: 3.2 }))
    .toBe('working: read_file · ctx 41% 412k/1M · $3.20')
})

test('an idle session with no usage yet shows only its state', () => {
  expect(activity({ ...base, busy: false, tool: 'Bash' })).toBe('idle')
})
