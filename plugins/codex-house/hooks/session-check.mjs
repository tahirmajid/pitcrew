// SessionStart: warn (never block) when Codex delegation can't work in this session.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Returns the installed plugin ids, or [] when the registry can't be read. */
const installedPlugins = () => {
  const dir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  try {
    return Object.keys(JSON.parse(readFileSync(join(dir, 'plugins', 'installed_plugins.json'), 'utf8')).plugins ?? {})
  } catch {
    return []
  }
}

/** Runs a command and reports whether it exited 0. */
const ok = (cmd, args) => {
  try {
    execFileSync(cmd, args, { stdio: 'ignore', timeout: 10_000 })
    return true
  } catch {
    return false
  }
}

const problems = []
const codexPlugins = installedPlugins().filter(id => id.split('@')[0] === 'codex')
if (codexPlugins.length > 1) {
  problems.push(`more than one plugin named "codex" is installed (${codexPlugins.join(', ')}), so the codex:* agents may not load; keep codex@pitcrew and uninstall the other`)
}
if (!ok('codex', ['--version'])) problems.push('the codex CLI is not on PATH; install it (https://github.com/openai/codex)')
else if (!ok('codex', ['login', 'status'])) problems.push('Codex is not logged in; run `codex login`')

if (problems.length) {
  const text = `codex-house: ${problems.join('; ')}.`
  process.stdout.write(JSON.stringify({
    systemMessage: text,
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: `${text} Tell the user before delegating to Codex.` },
  }))
}
