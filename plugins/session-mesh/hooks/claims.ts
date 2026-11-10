export type Claim = { pid: string; lstart: string; project: string; address: string; paths: string[] }

const clean = (p: string) => p.trim().replace(/^\.\//, '').replace(/\/+$/, '')
const hasGlob = (p: string) => /[*?[]/.test(p)
const prefix = (p: string) => (hasGlob(p) ? p.slice(0, p.search(/[*?[]/)).replace(/[^/]*$/, '') : p).replace(/\/$/, '')

function globRe(p: string) {
  let r = ''
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!
    if (c === '*') { if (p[i + 1] === '*') { r += '.*'; i++; if (p[i + 1] === '/') i++ } else r += '[^/]*' }
    else if (c === '?') r += '[^/]'
    else r += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${r}(/.*)?$`)
}

/** Whether claim `a` covers the concrete or glob path `b`; a bare directory covers its subtree. */
const covers = (a: string, b: string) => globRe(a).test(b)

/** Two repo-relative paths or globs overlap; glob against glob is judged by their literal directory prefixes (conservative). */
export function overlaps(a: string, b: string) {
  a = clean(a); b = clean(b)
  if (covers(a, b) || covers(b, a)) return true
  if (!hasGlob(a) || !hasGlob(b)) return false
  const [pa, pb] = [prefix(a), prefix(b)]
  return pa === '' || pb === '' || pa === pb || pa.startsWith(`${pb}/`) || pb.startsWith(`${pa}/`)
}

/** Claims whose owner is still running (same pid and start time as `alive` reports). */
export const live = (cs: Claim[], alive: Map<string, string>) => cs.filter(c => alive.get(c.pid) === c.lstart.trim().replace(/\s+/g, ' '))

/** The first path in `paths` that another live session in `project` claims, with its holder. */
export function conflict(others: Claim[], project: string, paths: string[]) {
  for (const p of paths) for (const c of others) if (c.project === project && c.paths.some(q => overlaps(q, p))) return { path: p, holder: c }
  return undefined
}

/** `abs` relative to worktree `top`, or undefined when it lies outside. */
export const relTo = (top: string, abs: string) => (abs.startsWith(`${top}/`) ? abs.slice(top.length + 1) : undefined)

/** Edit guard: the deny text when another live session holds `rel`, else whether this session should now claim it. */
export function editDecision(others: Claim[], project: string, level: number, rel: string) {
  const hit = conflict(others, project, [rel])
  if (hit) return { deny: `session-mesh: path ${rel} is claimed by ${hit.holder.address} (pid ${hit.holder.pid}). Message that session (peers tool, then SendMessage) and ask it to release the path; never edit it another way.` }
  return { claim: level >= 1 }
}

/** The claim refusal text for `hit`, naming the holder. */
export const refusal = (hit: { path: string; holder: Claim }) => `path ${hit.path} is claimed by ${hit.holder.address} (pid ${hit.holder.pid}). Message that session for a release; do not work around it.`

/** Paths left after releasing `drop` (everything when `drop` is omitted). */
export const release = (paths: string[], drop?: string[]) => (drop ? paths.filter(p => !drop.map(clean).includes(clean(p))) : [])
