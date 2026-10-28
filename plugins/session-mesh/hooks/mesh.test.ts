import { expect, test } from 'claude-code/testing'

test('/mesh with an unknown verb prints usage', async $ => {
  const r = await $.command.run({ command: 'mesh', args: 'bogus', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(r.text).toMatch(/^usage: \/mesh/)
})

test('join refuses a bad project name and a bad level', async $ => {
  const bad = await $.command.run({ command: 'mesh', args: 'join ../etc 2', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(bad.text).toMatch(/^refused: project/)
  const lvl = await $.command.run({ command: 'mesh', args: 'join my-app L7', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(lvl.text).toBe('refused: level must be 0, 1, 2 or 3')
})

test('/mesh steal is refused unless the person typed it', async $ => {
  const r = await $.command.run({ command: 'mesh', args: 'steal /tmp', origin: { kind: 'sdk' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(r.text).toBe('refused: /mesh steal is for the person at the keyboard only')
})

test('join refuses a bad role', async $ => {
  const r = await $.command.run({ command: 'mesh', args: 'join my-app 2 ../x', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(r.text).toMatch(/^refused: role/)
})

test('/mesh usage lists release', async $ => {
  const r = await $.command.run({ command: 'mesh', args: 'nope', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(r.text).toContain('release')
})

const AT = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const

test('claim refuses a malformed ticket id', async $ => {
  const r = await $.command.run({ command: 'mesh', args: 'claim ../etc', ...AT })
  expect(r.text).toBe('refused: ticket must be an id like ABC-123')
})

test('signoff is refused for a session that is not a joined reviewer', async $ => {
  const r = await $.command.run({ command: 'mesh', args: 'signoff 12 rev-1', ...AT })
  expect(r.text).toBe('refused: only a joined reviewer signs off')
})
