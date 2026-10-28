import { expect, test } from 'claude-code/testing'

import { bashPaths, isGradle, isReadOnly, parseLocks, readyTarget } from './bash'

test('H1: ordinary reads are read-only', () => {
  for (const c of ['gh pr diff 12', 'gh issue list 2>&1', 'git status 2>&1', 'FOO=1 git log -1', 'git -C /x status --short', 'sed -n 1,5p f', 'jq . f | sort', 'git ls-files', 'grep -i foo f', 'grep -o x f', 'tail -f log'])
    expect([c, isReadOnly(c)]).toEqual([c, true])
})

test('H1/M1: writes stay writes', () => {
  for (const c of ['ls & rm -rf src', 'cat <(touch x)', 'git diff --output=x', 'find . -fprint x', 'rg --pre ./x foo', 'git commit -m y', 'echo x > f', 'gh api -X POST repos/o/r/labels', 'gh api repos/o/r/issues -f title=x', 'find . -delete'])
    expect([c, isReadOnly(c)]).toEqual([c, false])
})

test('H2: only a gradle command counts as gradle', () => {
  for (const c of ['./gradlew test', 'cd app && ./gradlew :a:test', 'bash -c "./gradlew build"', 'JAVA_HOME=/j gradle tasks'])
    expect([c, isGradle(c)]).toEqual([c, true])
  for (const c of ['git commit -m "bump gradle"', 'echo gradle', 'grep -rn gradle .', 'rm -rf src; echo gradle'])
    expect([c, isGradle(c)]).toEqual([c, false])
})

test('H3: git worktree add and fetch pass as metadata-only', () => {
  expect(isReadOnly('git worktree add ../repo-T1 -b temp/T1')).toBe(true)
  expect(isReadOnly('git fetch origin')).toBe(true)
})

test('M2: paths with spaces stay whole; a command with no paths is judged by cwd', () => {
  expect(bashPaths('cd "/Users/x/My Repo" && rm f', '/r', '/h')).toEqual(['/Users/x/My Repo'])
  expect(bashPaths('touch f', '/r', '/h')).toEqual(['/r'])
  expect(bashPaths('git -C ~/w commit -m x', '/r', '/h')).toEqual(['/h/w'])
})

test('M4: every ready form is caught', () => {
  expect(readyTarget('gh pr ready 12')).toBe('12')
  expect(readyTarget('gh pr ready -R o/r 12')).toBe('12')
  expect(readyTarget('gh pr ready https://github.com/o/r/pull/34')).toBe('34')
  expect(readyTarget('gh pr ready')).toBe('current')
  expect(readyTarget('gh pr ready 12 --undo')).toBeUndefined()
  expect(readyTarget('gh pr create --title x')).toBe('new')
  expect(readyTarget('gh pr create --draft --title x')).toBeUndefined()
  expect(readyTarget("gh api graphql -f query='mutation { markPullRequestReadyForReview(input:{}) { clientMutationId } }'")).toBe('unknown')
})

test('M6: a bad lock config drops bad entries instead of throwing', () => {
  expect(parseLocks('{"lock":"x"}')).toEqual([])
  expect(parseLocks('not json')).toEqual([])
  const ok = parseLocks('[{"lock":"phone","tools":"^a$"},{"lock":"bad","tools":"(("},{"lock":"Bad Name","bash":"x"}]')
  expect(ok.map(l => l.lock)).toEqual(['phone'])
})
