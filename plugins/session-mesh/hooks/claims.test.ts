import { expect, test } from 'claude-code/testing'

import { conflict, editDecision, live, overlaps, refusal, release, relTo, type Claim } from './claims'

const c = (pid: string, paths: string[], project = 'p', address = `p-impl-${pid}`): Claim => ({ pid, lstart: 'Mon Nov 10 10:00:00 2026', project, address, paths })

test('P1: a path overlapping another session\'s claim is refused and names the holder', () => {
  const hit = conflict([c('1', ['app/Foo.kt'])], 'p', ['app/Bar.kt', 'app/Foo.kt'])
  expect(hit?.path).toBe('app/Foo.kt')
  expect(refusal(hit!)).toContain('claimed by p-impl-1')
  expect(conflict([c('1', ['app/Foo.kt'])], 'other', ['app/Foo.kt'])).toBeUndefined()
})

test('P2: globs and directories overlap what they cover', () => {
  expect(overlaps('feature/x/**', 'feature/x/a/B.kt')).toBe(true)
  expect(overlaps('feature/x', 'feature/x/B.kt')).toBe(true)
  expect(overlaps('a/*.kt', 'a/B.kt')).toBe(true)
  expect(overlaps('a/*.kt', 'a/b/B.kt')).toBe(false)
  expect(overlaps('a/**/*.kt', 'a/b/**')).toBe(true)
  expect(overlaps('a/B.kt', 'a/C.kt')).toBe(false)
  expect(overlaps('a/B.kt', 'ab/B.kt')).toBe(false)
})

test('P3: a claim made from one worktree blocks the same repo-relative path from another', () => {
  const claimedInWtA = c('1', [relTo('/r/wt-a', '/r/wt-a/app/Foo.kt')!])
  const editInWtB = relTo('/r/wt-b', '/r/wt-b/app/Foo.kt')!
  expect(editDecision([claimedInWtA], 'p', 1, editInWtB).deny).toContain('claimed by')
  expect(relTo('/r/wt-a', '/r/wt-b/app/Foo.kt')).toBeUndefined()
})

test('P4: a dead session\'s claim is ignored', () => {
  const alive = new Map([['1', 'Mon Nov 10 10:00:00 2026']])
  const kept = live([c('1', ['a']), c('2', ['a'])], alive)
  expect(kept.map(k => k.pid)).toEqual(['1'])
  expect(live([c('1', ['a'])], new Map([['1', 'Tue Nov 11 09:00:00 2026']]))).toEqual([])
})

test('P5: the first edit of an unclaimed path claims it; another session\'s claim denies', () => {
  expect(editDecision([], 'p', 1, 'a/B.kt')).toEqual({ claim: true })
  expect(editDecision([], 'p', 0, 'a/B.kt')).toEqual({ claim: false })
  const d = editDecision([c('1', ['a/**'], 'p', 'p-planner')], 'p', 1, 'a/B.kt')
  expect(d.deny).toMatch(/^session-mesh: path a\/B\.kt is claimed by p-planner/)
})

test('P6: release drops the given paths or all of them', () => {
  expect(release(['a', 'b/'], ['b'])).toEqual(['a'])
  expect(release(['a', 'b'])).toEqual([])
})
