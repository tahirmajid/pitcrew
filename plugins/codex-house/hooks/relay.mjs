// PostToolUse / UserPromptSubmit: hand queued post-job warnings to the main session's model. Never blocks.
import { readFileSync } from 'node:fs'
import { takeWarnings } from './shared.mjs'

try {
  const input = JSON.parse(readFileSync(0, 'utf8'))
  const text = input.session_id ? takeWarnings(input.session_id) : ''
  const hookEventName = input.hook_event_name || 'PostToolUse'
  if (text) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: text } }))
} catch {}
process.exit(0)
