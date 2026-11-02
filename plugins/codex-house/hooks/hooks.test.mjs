// Run: node --test plugins/codex-house/hooks/hooks.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const hook = (name, input) =>
  execFileSync('node', [join(import.meta.dirname, name)], { input: JSON.stringify(input), encoding: 'utf8' })

const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'codex-house-test-'))
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' })
  g('init', '-q'); g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init')
  return { dir, g }
}

const transcript = (dir, message) => {
  const path = join(dir, 't.jsonl')
  writeFileSync(path, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'SubagentHandback', input: { message } }] } }) + '\n')
  return path
}

test('pre-spawn excludes .handoff/ once and post-job is quiet for a clean job', () => {
  const { dir } = repo()
  const spawn = { cwd: dir, tool_input: { subagent_type: 'codex:sol' } }
  hook('pre-spawn.mjs', spawn); hook('pre-spawn.mjs', spawn)
  assert.equal(readFileSync(join(dir, '.git/info/exclude'), 'utf8').split('\n').filter(l => l === '.handoff/').length, 1)
  const msg = '## Result\n- Status: done\n- Files changed: a\n- Commands run: b\n- Open questions: none'
  assert.equal(hook('post-job.mjs', { agent_type: 'codex:sol', cwd: dir, agent_transcript_path: transcript(dir, msg) }), '')
})

test('post-job reports missing Result fields, a moved HEAD and a Co-Authored-By trailer', () => {
  const { dir, g } = repo()
  hook('pre-spawn.mjs', { cwd: dir, tool_input: { subagent_type: 'codex:sol' } })
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x\n\nCo-Authored-By: bot <b@b>')
  const out = JSON.parse(hook('post-job.mjs', { agent_type: 'codex:sol', cwd: dir, agent_transcript_path: transcript(dir, '## Result\n- Status: done') }))
  assert.match(out.systemMessage, /missing: Files changed, Commands run, Open questions/)
  assert.match(out.systemMessage, /HEAD moved/)
  assert.match(out.systemMessage, /Co-Authored-By/)
})

test('relay hands a queued warning to the next tool call once', () => {
  const { dir } = repo()
  const session_id = `test-${Date.now()}`
  hook('post-job.mjs', { agent_type: 'codex:sol', cwd: dir, session_id, agent_transcript_path: transcript(dir, 'no result') })
  assert.match(JSON.parse(hook('relay.mjs', { session_id })).hookSpecificOutput.additionalContext, /no ## Result/)
  assert.equal(hook('relay.mjs', { session_id }), '')
})

test('hooks ignore non-codex agents', () => {
  const { dir } = repo()
  hook('pre-spawn.mjs', { cwd: dir, tool_input: { subagent_type: 'Explore' } })
  assert.doesNotMatch(readFileSync(join(dir, '.git/info/exclude'), 'utf8'), /\.handoff/)
  assert.equal(hook('post-job.mjs', { agent_type: 'Explore', cwd: dir, agent_transcript_path: '/nope' }), '')
})
