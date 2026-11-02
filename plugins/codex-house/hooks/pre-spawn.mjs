// PreToolUse Agent: before a codex:* spawn, git-ignore .handoff/ and record HEAD for the post-job check. Never blocks.
import { readFileSync } from 'node:fs'
import { ensureHandoffExcluded, git, saveSpawnHead } from './shared.mjs'

try {
  const input = JSON.parse(readFileSync(0, 'utf8'))
  if (String(input.tool_input?.subagent_type ?? '').startsWith('codex:')) {
    const cwd = input.cwd || process.cwd()
    ensureHandoffExcluded(cwd)
    saveSpawnHead(cwd, git(cwd, 'rev-parse', 'HEAD'))
  }
} catch {}
process.exit(0)
