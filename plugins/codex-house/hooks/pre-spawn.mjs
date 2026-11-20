// PreToolUse Agent: refuse a codex:* spawn with no name and a Claude spawn the usage verdict sends to Codex, then git-ignore .handoff/ and record HEAD. Any error lets the spawn through.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { countSpawn, ensureHandoffExcluded, git, saveSpawnHead, spawnCounts } from './shared.mjs'

/** Claude agents no verdict moves to Codex: reviewers, and helpers Codex has no equivalent for. */
const ALWAYS_CLAUDE = /review|^(web-fetch|claude-code-guide|statusline-setup)$/i
/** Verdicts under which Claude subagents only review. */
const CODEX_ONLY = new Set(['codex-all', 'orchestrate'])
/** How many more Claude jobs than Codex jobs a session may start under a 50-50 verdict. */
const SPLIT_SLACK = 2
const EXEMPT = 'If Codex can\'t do this job (Slack, Snowflake, gh, push, downloads), put a line "claude-only: <reason>" in the prompt and send it again.'

/** Returns the first word of the usage script's verdict line, e.g. codex-all. */
const verdict = () => {
  const script = process.env.CODEX_HOUSE_USAGE_SCRIPT || join(import.meta.dirname, '..', 'skills', 'codex-routing', 'usage-balance.py')
  const out = execFileSync('python3', ['-I', script], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })
  return /^verdict ([\w-]+)/m.exec(out)?.[1] ?? ''
}

/** Refuses the spawn and tells the model why. */
const deny = reason => {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `codex-house: ${reason}` } }))
  process.exit(0)
}

try {
  const input = JSON.parse(readFileSync(0, 'utf8'))
  const tool = input.tool_input ?? {}
  const type = String(tool.subagent_type ?? 'general-purpose')
  if (type.startsWith('codex:')) {
    if (!String(tool.name ?? '').trim()) {
      deny('add a unique kebab-case `name` to this Agent call (for example `fix-login-null`) and send it again. The tool schema may not list `name`, but the call accepts it. A missing name is no reason to use a Claude subagent.')
    }
    countSpawn(input.session_id, 'codex')
    const cwd = input.cwd || process.cwd()
    ensureHandoffExcluded(cwd)
    saveSpawnHead(cwd, git(cwd, 'rev-parse', 'HEAD'))
  } else if (!input.agent_id && !ALWAYS_CLAUDE.test(type) && !/^\s*claude-only:\s*\S/im.test(String(tool.prompt ?? ''))) {
    const tier = verdict()
    if (CODEX_ONLY.has(tier)) {
      deny(`the usage verdict is ${tier}, so this job goes to a codex:* agent (codex:sol for work that needs judgement, codex:luna for legwork) with a unique \`name\`. Claude subagents only review at this tier. ${EXEMPT}`)
    }
    const { claude, codex } = spawnCounts(input.session_id)
    if (tier === '50-50' && claude - codex >= SPLIT_SLACK) {
      deny(`the usage verdict is 50-50 and this session has started ${claude} Claude jobs against ${codex} Codex jobs. Send this one to a codex:* agent with a unique \`name\`. ${EXEMPT}`)
    }
    countSpawn(input.session_id, 'claude')
  }
} catch {}
process.exit(0)
