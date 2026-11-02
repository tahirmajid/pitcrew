// Helpers shared by the codex-house hooks.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'

/** Runs git in cwd and returns trimmed stdout. */
export const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

/** Adds .handoff/ to the repository's info/exclude once. */
export const ensureHandoffExcluded = cwd => {
  const common = git(cwd, 'rev-parse', '--git-common-dir')
  const exclude = join(isAbsolute(common) ? common : join(cwd, common), 'info', 'exclude')
  let text = ''
  try { text = readFileSync(exclude, 'utf8') } catch {}
  if (!text.split('\n').includes('.handoff/')) appendFileSync(exclude, `${text && !text.endsWith('\n') ? '\n' : ''}.handoff/\n`)
}

/** Returns a state file under the temp dir named by a hash of key. */
const stateFile = (key, ext) => {
  const dir = join(tmpdir(), 'codex-house')
  mkdirSync(dir, { recursive: true })
  return join(dir, `${createHash('sha1').update(String(key)).digest('hex').slice(0, 16)}.${ext}`)
}

/** Returns the state file holding the HEAD recorded at the last codex spawn in cwd. */
const headFile = cwd => stateFile(cwd, 'head')

/** Queues a warning for the session's next tool call. */
export const queueWarning = (sessionId, text) => appendFileSync(stateFile(sessionId, 'warn'), `${text}\n`)

/** Returns and clears the session's queued warnings. */
export const takeWarnings = sessionId => {
  const file = stateFile(sessionId, 'warn')
  try {
    const text = readFileSync(file, 'utf8').trim()
    rmSync(file)
    return text
  } catch {
    return ''
  }
}

/** Records HEAD at spawn time for cwd. */
export const saveSpawnHead = (cwd, head) => writeFileSync(headFile(cwd), head)

/** Returns the HEAD recorded at the last codex spawn in cwd, or undefined. */
export const spawnHead = cwd => {
  try { return readFileSync(headFile(cwd), 'utf8').trim() || undefined } catch { return undefined }
}
