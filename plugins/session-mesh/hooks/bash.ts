// Pure Bash-command parsing for the session-mesh guards; no `$`, so tests import it directly.

const READ_ONLY = new RegExp(
  '^(' +
    [
      'cd', 'pushd', 'popd', 'ls', 'cat', 'head', 'tail', 'grep', 'rg', 'pwd', 'echo', 'printf', 'wc', 'which', 'find',
      'sed -n', 'awk', 'jq', 'sort', 'uniq', 'cut', 'tr', 'diff', 'stat', 'file', 'du', 'df', 'ps', 'date', 'true',
      'git (status|log|diff|show|rev-parse|rev-list|ls-files|grep|blame|fetch|remote -v|config --get|worktree (add|list|prune)|branch( --list| -a| -r| -vv)?$)',
      'gh (pr|issue|run|repo|release|workflow) (view|diff|list|checks|status)',
      'gh api',
    ].join('|') +
    ')(\\s|$)',
)
// options that make an allow-listed command write (git diff --output, find -fprint, rg --pre, sort -o, gh api writes)
const WRITE_FLAGS = /\s(-(exec|execdir|delete|ok|okdir|fprint|fprint0|fprintf|fls)\b|--output\b|--pre\b)/
const GH_API_WRITE = /\s(-X\s*(POST|PUT|PATCH|DELETE)|--method\s*(POST|PUT|PATCH|DELETE)|-[fF]\s|--field\b|--raw-field\b|--input\b)/
const SEGMENTS = /&&|\|\||;|\||&|\n/

/** Strips leading `VAR=x`, `env`, git global options and a `bash -c '...'` wrapper from one segment. */
function bare(seg: string) {
  return seg
    .trim()
    .replace(/^(env\s+)?([A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, '')
    .replace(/^(ba|z)?sh\s+-c\s+['"]?/, '')
    .replace(/^git\s+((-C|-c)\s+\S+\s+|--no-pager\s+)+/, 'git ')
}

/** True when every segment of the command only reads. */
export function isReadOnly(cmd: string) {
  const c = cmd.replace(/\d?>\s*\/dev\/null|\d?>&\d/g, '')
  if (/[>`]|\$\(|<\(/.test(c)) return false
  return c.split(SEGMENTS).every(seg => {
    const t = bare(seg)
    return !t || (READ_ONLY.test(t) && !WRITE_FLAGS.test(` ${t}`) && !(/^gh api/.test(t) && GH_API_WRITE.test(` ${t}`)))
  })
}

/** True when some segment runs gradle or a gradle wrapper as its command. */
export function isGradle(cmd: string) {
  return cmd.split(SEGMENTS).some(seg => /^(\S*\/)?gradlew?(\s|$|['"])/.test(bare(seg).replace(/^\(\s*/, '')))
}

/** Splits into words, keeping quoted spans (paths with spaces) whole. */
function words(cmd: string) {
  return (cmd.match(/"[^"]*"|'[^']*'|[^\s;&|()]+/g) ?? []).map(t => t.replace(/^['"]|['"]$/g, ''))
}

/** The directories a command may write into: absolute paths, cd/pushd/git -C targets, and cwd unless the command starts with a cd. */
export function bashPaths(cmd: string, cwd: string, home: string) {
  const toks = words(cmd).map(t => t.replace(/^~(?=\/|$)/, home))
  let dir = cwd
  const out: string[] = []
  toks.forEach((t, i) => {
    const prev = toks[i - 1]
    if (prev === 'cd' || prev === 'pushd' || prev === '-C') out.push((dir = t.startsWith('/') ? t : `${dir}/${t}`))
    else if (t.startsWith('/') && !t.startsWith('/dev/')) out.push(t)
  })
  // ponytail: a command naming absolute paths is judged by them, not by the session root it starts in; `touch rel /abs`
  // slips through - parse relative args if that matters
  const leadingCd = /^\s*(cd|pushd)\s/.test(cmd)
  return leadingCd || out.length ? out : [cwd]
}

/** What a PR-ready attempt targets: a PR number, 'current' (no number given), or undefined when the command is not one. */
export function readyTarget(cmd: string): string | undefined {
  if (/markPullRequestReadyForReview/.test(cmd)) return 'unknown'
  const m = cmd.match(/\bgh\s+pr\s+ready\b(.*)/)
  if (m && !/--undo/.test(m[1] ?? '')) return (m[1] ?? '').match(/\/pull\/(\d+)|(?:^|\s)#?(\d+)(?=\s|$)/)?.slice(1).find(Boolean) ?? 'current'
  if (/\bgh\s+pr\s+create\b/.test(cmd) && !/\s(--draft|-d)(\s|$)/.test(cmd)) return 'new'
  return undefined
}

export type ToolLock = { lock: string; tools?: RegExp; bash?: RegExp }

/** Parses tool-locks.json, dropping entries with a bad name or a regex that does not compile. */
export function parseLocks(text: string): ToolLock[] {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return [] }
  if (!Array.isArray(raw)) return []
  return raw.flatMap(l => {
    try {
      if (!l || typeof l.lock !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(l.lock)) return []
      return [{ lock: l.lock, ...(l.tools ? { tools: new RegExp(l.tools) } : {}), ...(l.bash ? { bash: new RegExp(l.bash) } : {}) }]
    } catch {
      return []
    }
  })
}
