// SubagentStop: after a codex:* job, report a moved HEAD, Co-Authored-By trailers and missing ## Result fields. Never blocks.
import { readFileSync } from 'node:fs'
import { git, queueWarning, spawnHead } from './shared.mjs'

const RESULT_FIELDS = ['Status', 'Files changed', 'Commands run', 'Open questions']

/** Returns the job's final message: the last SubagentHandback call in its transcript. */
const finalMessage = path => {
  let last = ''
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.includes('SubagentHandback')) continue
    try {
      for (const part of JSON.parse(line).message?.content ?? []) {
        if (part.type === 'tool_use' && part.name === 'SubagentHandback') last = String(part.input?.message ?? '')
      }
    } catch {}
  }
  return last
}

/** Returns the problems with the job's ## Result section. */
const resultProblems = message => {
  const at = message.search(/^#{1,6}\s*Result\b/m)
  if (at < 0) return ['its final message has no ## Result section']
  const section = message.slice(at)
  const missing = RESULT_FIELDS.filter(f => !new RegExp(`(^|\\n)\\s*(-\\s*|\\*\\*|#{1,6}\\s*)${f}`, 'i').test(section))
  return missing.length ? [`its ## Result is missing: ${missing.join(', ')}`] : []
}

/** Returns the problems with commits made since the job was spawned. */
const gitProblems = cwd => {
  const before = spawnHead(cwd)
  if (!before) return []
  const now = git(cwd, 'rev-parse', 'HEAD')
  if (now === before) return []
  const out = [`HEAD moved during the job (${before.slice(0, 8)} -> ${now.slice(0, 8)}); review those commits`]
  if (/co-authored-by:/i.test(git(cwd, 'log', '--format=%B', `${before}..${now}`))) out.push('a new commit carries a Co-Authored-By trailer')
  return out
}

try {
  const input = JSON.parse(readFileSync(0, 'utf8'))
  if (String(input.agent_type ?? '').startsWith('codex:')) {
    const cwd = input.cwd || process.cwd()
    const problems = []
    try { problems.push(...resultProblems(finalMessage(input.agent_transcript_path))) } catch {}
    try { problems.push(...gitProblems(cwd)) } catch {}
    if (problems.length) {
      const text = `codex-house (${input.agent_type}): ${problems.join('; ')}. Check before relying on its work.`
      if (input.session_id) queueWarning(input.session_id, text)
      process.stdout.write(JSON.stringify({ systemMessage: text }))
    }
  }
} catch {}
process.exit(0)
