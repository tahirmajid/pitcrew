import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Presence, View } from '../types'
import { bashPaths, isGradle, isReadOnly, parseLocks, readyTarget, type ToolLock } from './bash'
import { activity } from './row'

const view = atom({ plugin: 'session-mesh', key: 'view' } as const, { off: false, me: null, peers: [] } as View)
const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/

let root = ''
let pid = ''
let lstart = ''
let sweeping = false
let home = ''
let sock = ''
let joined: { project: string; level: number; role?: string } | null = null
let claim: { ticket: string; wave?: string } | null = null
let restored = false
// what peers see in the band: whether a turn runs, its latest tool, and the session's usage
let busy = false
let tool = ''
let usage: { tok?: number; win?: number; pct?: number; usd?: number } = {}

// roles that read and advise; a change they need goes to the implementer
const NON_WRITERS = new Set(['reviewer', 'researcher', 'critic', 'judge'])
// level -> tickets one project may have in progress at once
const CLAIM_CAP: Record<number, number> = { 0: 1, 1: 1, 2: 1, 3: 3 }

const TOPS_SH = 'for p; do d=$p; case $d in /*) ;; *) d=$PWD/$d;; esac; while [ -n "$d" ] && [ ! -d "$d" ]; do [ "$d" = "${d%/*}" ] && break; d=${d%/*}; done; [ -n "$d" ] || continue; t=$(git -C "$d" rev-parse --show-toplevel 2>/dev/null) && (cd "$t" && pwd -P); done | sort -u'

function sh($: any, script: string, ...args: string[]) {
  return $.process.run(['sh', '-c', script, 'sh', ...args])
}

function hash(s: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0
  return h.toString(16).padStart(8, '0')
}

function writeAtomic($: any, path: string, body: string) {
  return sh($, 'mkdir -p "${1%/*}" && printf "%s\\n" "$2" > "$1.tmp.$$" && mv "$1.tmp.$$" "$1"', path, body)
}

function norm(s: string) {
  return s.trim().replace(/\s+/g, " ")
}

function address(p: Presence) {
  if (!p.project) return `unjoined:${p.id.slice(0, 8)}`
  return p.role ? `${p.project}-${p.role}${p.n && p.n > 1 ? `-${p.n}` : ''}` : `${p.project}-L${p.level}-s${p.n}`
}

async function worktree($: any) {
  const cwd = await $.session.cwd()
  const top = (await $.process.run(['git', '-C', cwd, 'rev-parse', '--show-toplevel'])).stdout.trim() || cwd
  return (await $.fs.stat(top, { resolve: true }))?.realPath ?? top
}

async function lease($: any, name: string, act: string, target = '') {
  const v = await read($, view)
  const owner = JSON.stringify({ pid, lstart, id: await $.session.id(), address: v.me ? address(v.me) : '?', target, at: await $.clock.now() })
  return (await $.process.run(['sh', `${$.plugin.root}/hooks/lease.sh`, root, name, pid, lstart, owner, act])).stdout.trim() as string
}

function holder(out: string) {
  try { const h = JSON.parse(out.replace(/^\S+ /, '')); return `${h.address} (pid ${h.pid})` } catch { return 'a session mid-acquire' }
}

async function guard($: any, paths: string[]) {
  const me = (await read($, view)).me
  const level = me?.level ?? 0
  const tops = (await $.process.run(["sh", "-c", TOPS_SH, "sh"].concat(paths))).stdout.split('\n').filter(Boolean)
  for (const t of tops) {
    if (me?.role && NON_WRITERS.has(me.role))
      return `session-mesh: role ${me.role} does not write to worktrees (${t}). Send the change to the implementer (session-mesh peers tool, then SendMessage).`
    const out = await lease($, `worktree-${hash(t)}`, level >= 1 ? 'acquire' : 'check', t)
    if (out.startsWith('held'))
      return `session-mesh: worktree ${t} is leased by ${holder(out)}, its writer. Send that session your change request with SendMessage, or work in a separate git worktree (git worktree add); if it is finished, ask the user to run: /mesh steal ${t}`
  }
  return undefined
}

let locks: ToolLock[] = []

async function loadLocks($: any) {
  locks = parseLocks((await sh($, 'cat "$1" 2>/dev/null || echo []', `${root}/tool-locks.json`)).stdout)
}

async function lockFor($: any, matches: (l: ToolLock) => boolean) {
  for (const l of locks) {
    if (!matches(l)) continue
    const out = await lease($, `tool-${l.lock}`, 'acquire', l.lock)
    if (out.startsWith('held'))
      return `session-mesh: ${l.lock} is held by ${holder(out)}. Ask that session to finish and have the user type /mesh release there; do not retry in a loop.`
  }
  return undefined
}

async function claimTicket($: any, ticket: string, wave?: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/.test(ticket)) return 'refused: ticket must be an id like ABC-123'
  const v = await sweep($) ?? (await read($, view)).me
  if (!v?.project) return 'refused: join a project first'
  const peers = (await read($, view)).peers.filter(p => p.project === v.project && p.ticket)
  const dup = peers.find(p => p.ticket === ticket)
  if (dup) return `refused: ${ticket} is claimed by ${address(dup)}`
  const cap = CLAIM_CAP[v.level ?? 0] ?? 1
  // ponytail: cap counted from presence, so two simultaneous claims can both pass; a lease per ticket if that bites
  if (peers.length >= cap) return `refused: ${v.project} already has ${peers.length} ticket(s) in progress (level ${v.level} allows ${cap}): ${peers.map(p => `${p.ticket} by ${address(p)}`).join(', ')}`
  claim = { ticket, ...(wave ? { wave } : {}) }
  await sweep($)
  return `claimed ${ticket}${wave ? ` (wave ${wave})` : ''} for ${address(v)}`
}

async function signoff($: any, pr: string, ledger: string) {
  const me = (await read($, view)).me
  if (me?.role !== 'reviewer' || !me.project) return 'refused: only a joined reviewer signs off'
  if (!/^\d+$/.test(pr) || !ledger.trim()) return 'refused: pr must be a number and ledger the review ledger id'
  await writeAtomic($, `${root}/projects/${me.project}/signoff/${pr}.json`, JSON.stringify({ by: address(me), ledger, at: await $.clock.now() }))
  return `signed off PR #${pr} for ${me.project}`
}

// a PR goes ready only after a live reviewer in this project signed it off
async function readyGate($: any, pr: string | undefined) {
  const v = await read($, view)
  if (!v.me?.project || !v.peers.some(p => p.project === v.me?.project && p.role === 'reviewer')) return undefined
  if (pr && (await $.fs.exists(`${root}/projects/${v.me.project}/signoff/${pr}.json`))) return undefined
  return `session-mesh: PR ${pr ? `#${pr} ` : ''}has no reviewer sign-off in ${v.me.project}. Hand it to the reviewer (peers tool, SendMessage); it signs off after its review.`
}

async function isOff($: any) {
  return (await $.fs.exists(`${root}/OFF`)) as boolean
}

async function sweep($: any) {
  if (sweeping) return
  sweeping = true
  try {
    const id = await $.session.id()
    const wt = await worktree($)
    const lines = (await sh($, 'cat "$1"/sessions/*.json 2>/dev/null', root)).stdout.split('\n').filter(Boolean)
    const recs: Presence[] = lines.flatMap((l: string) => { try { return [JSON.parse(l)] } catch { return [] } })
    const others = recs.filter(r => r.pid !== pid && /^\d+$/.test(r.pid))
    const ps = others.length ? (await $.process.run(['ps', '-o', 'pid=,lstart=', '-p', others.map(r => r.pid).join(',')])).stdout : ''
    const alive = new Map<string, string>(ps.split('\n').filter(Boolean).map((l: string) => {
      const [p, ...rest] = l.trim().split(/\s+/)
      return [p ?? '', rest.join(' ')] as [string, string]
    }))
    const peers = others.filter(r => alive.get(r.pid) === norm(r.lstart))
    const dead = others.filter(r => alive.get(r.pid) !== norm(r.lstart)).map(r => `${root}/sessions/${r.pid}.json`)
    if (dead.length) await $.process.run(['rm', '-f', ...dead])

    const prev = recs.find(r => r.pid === pid)
    // a hot reload keeps the pid, so the presence file restores this session's join
    if (!restored && prev?.project) {
      joined ??= { project: prev.project, level: prev.level ?? 0, ...(prev.role ? { role: prev.role } : {}) }
      if (!claim && prev.ticket) claim = { ticket: prev.ticket, ...(prev.wave ? { wave: prev.wave } : {}) }
    }
    restored = true
    const join = joined
    let n: number | undefined
    if (join) {
      const taken = new Set(peers.filter(p => p.project === join.project && p.role === join.role).map(p => p.n))
      n = prev?.project === join.project && prev?.role === join.role && prev?.n !== undefined && !taken.has(prev.n) ? prev.n : 1
      while (taken.has(n)) n++
    }
    const me: Presence = { id, pid, lstart, sock, worktree: wt, at: await $.clock.now(), busy, ...(busy && tool ? { tool } : {}), ...usage, ...(join ? { ...join, n, ...(claim ?? {}) } : {}) }
    await writeAtomic($, `${root}/sessions/${pid}.json`, JSON.stringify(me))
    await loadLocks($)
    const off = (await $.fs.exists(`${root}/OFF`)) as boolean
    await update($, view, () => ({ off, me, peers }))
    return me
  } finally {
    sweeping = false
  }
}

async function join($: any, project: string, level: number, role?: string) {
  if (!NAME.test(project)) return `refused: project must match ${NAME}`
  if (![0, 1, 2, 3].includes(level)) return 'refused: level must be 0, 1, 2 or 3'
  if (role !== undefined && !NAME.test(role)) return `refused: role must match ${NAME}`
  joined = { project, level, ...(role ? { role } : {}) }
  const me = await sweep($)
  return me ? `joined as ${address(me)} (worktree ${me.worktree})` : 'joined; presence refresh pending'
}

async function status($: any) {
  await sweep($)
  const v = await read($, view)
  const rows = [v.me, ...v.peers].filter((p): p is Presence => !!p).map(p => `${p === v.me ? '>' : ' '} ${address(p)}${p.ticket ? ` [${p.ticket}${p.wave ? ` w${p.wave}` : ''}]` : ''}  pid ${p.pid}  ${p.worktree}${p.sock ? `  uds:${p.sock}` : ''}`)
  const leases = (await lease($, 'x', 'list')).split('\n').filter(Boolean).map(l => {
    try { const h = JSON.parse(l.replace(/^\S+ /, '')); return `  lease ${h.target || '?'}  ${l.startsWith('mine') ? 'mine' : `held by ${h.address}`}` } catch { return `  lease ${l}` }
  })
  return [v.off ? 'MESH OFF (guards disabled machine-wide)' : 'mesh on', ...rows, ...leases].join('\n')
}

async function steal($: any, path: string) {
  const top = (await sh($, TOPS_SH, path.replace(/^~(?=\/|$)/, home))).stdout.trim()
  if (!top) return `not a git worktree: ${path}`
  return `${await lease($, `worktree-${hash(top)}`, 'steal', top)}: ${top}`
}

async function command($: any, args: string, human: boolean) {
  const [verb, a, b, c] = args.trim().split(/\s+/)
  if (verb === 'steal' && a) return human ? steal($, a) : 'refused: /mesh steal is for the person at the keyboard only'
  if (verb === 'join' && a && b !== undefined) return join($, a, Number(b.replace(/^L/i, '')), c)
  if (verb === 'claim' && a) return claimTicket($, a, b)
  if (verb === 'signoff' && a && b) return signoff($, a, b)
  if (verb === 'unclaim') { claim = null; await sweep($); return 'ticket claim dropped' }
  if (verb === 'release') { await lease($, 'x', 'release-all'); return 'released every lease this session held' }
  if (verb === 'off') { await sh($, 'mkdir -p "$1" && : > "$1/OFF"', root); await sweep($); return 'MESH OFF: every guard passes until /mesh on' }
  if (verb === 'on') { await $.process.run(['rm', '-f', `${root}/OFF`]); await sweep($); return 'mesh on' }
  if (!verb || verb === 'status') return status($)
  return 'usage: /mesh [status] | join <project> <level 0-3> [role] | claim <ticket> [wave] | unclaim | signoff <pr> <ledger> | release | steal <worktree> | off | on'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    home = (await sh($, 'printf %s "$HOME"')).stdout
    root = `${home}/.claude/mesh`
    pid = (await sh($, 'printf %s "$PPID"')).stdout
    lstart = norm((await $.process.run(["ps", "-o", "lstart=", "-p", pid])).stdout)
    sock = (await sh($, 'printf %s "${CLAUDE_CODE_MESSAGING_SOCKET:-}"')).stdout
    await $.tool.register({
      name: 'join',
      description:
        'Join this session to a session-mesh project at a level (0 adhoc, 1 small, 2 medium, 3 large) with an optional role (planner, implementer, tester, reviewer, researcher, proposer, critic, judge). Peers then address it as <project>-<role>. Resolve the project name from the local-knowledge orchestrator first.',
      inputSchema: {
        type: 'object',
        properties: { project: { type: 'string' }, level: { type: 'number', enum: [0, 1, 2, 3] }, role: { type: 'string' } },
        required: ['project', 'level'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'peers',
      description: "List this project's live session-mesh peers by role, each with the SendMessage `to` address (uds:...) that reaches it.",
      inputSchema: { type: 'object', properties: {} },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'claim',
      description: 'Claim the ticket this session works on (e.g. ABC-123), optionally with a wave number. Refused if another session holds it or the project is at its cap (1 at level 0-2, 3 at level 3). Peers see the ticket.',
      inputSchema: { type: 'object', properties: { ticket: { type: 'string' }, wave: { type: 'string' } }, required: ['ticket'] },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'signoff',
      description: 'Reviewer only: record that PR <pr> passed review, citing the review ledger id. Required before any session in the project may mark that PR ready while a reviewer is joined.',
      inputSchema: { type: 'object', properties: { pr: { type: 'string' }, ledger: { type: 'string' } }, required: ['pr', 'ledger'] },
      isDeferred: false,
    })
    await $.command.register({ name: 'mesh', description: 'session-mesh: status, join, off/on', argumentHint: '[status | join <project> <level> [role] | claim <ticket> [wave] | unclaim | signoff <pr> <ledger> | release | steal <worktree> | off | on]' })
    await sweep($)
    $.clock.every(10000, () => { void sweep($).catch(() => undefined) })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    busy = true
    tool = ''
    void sweep($).catch(() => undefined)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    busy = false
    void sweep($).catch(() => undefined)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const c = e.context
    usage = { ...(c.tokens !== undefined ? { tok: c.tokens } : {}), win: c.window, ...(c.percent !== undefined ? { pct: c.percent } : {}), ...(e.cost ? { usd: e.cost.usd } : {}) }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason !== 'clear' && e.reason !== 'resume') {
      await lease($, 'x', 'release-all')
      await $.process.run(['rm', '-f', `${root}/sessions/${pid}.json`])
    }
    return next(e)
  })

  on('command.run', { command: 'mesh' }, async ($, e) => ({ text: await command($, e.args, e.origin.kind === 'composer') }))

  on('tool.call', { tool: 'mcp__session-mesh__join' }, async ($, e) => {
    const p = e as unknown as { project: string; level: number; role?: string }
    return { result: await join($, String(p.project), Number(p.level), p.role) }
  }).catch(($, e, next) => (next.called ? next(e) : { result: "join failed; see /mesh status" }))

  on('tool.call', { tool: /^(Edit|Write|NotebookEdit)$/ }, async ($, e, next) => {
    if (await isOff($)) return next(e)
    const input = e as unknown as { file_path?: string; notebook_path?: string }
    const path = input.file_path ?? input.notebook_path
    const deny = path ? await guard($, [path]) : undefined
    return deny ? { deny } : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'session-mesh: guard failed closed (/mesh off to bypass)' }))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (await isOff($)) return next(e)
    const cmd = (e as unknown as { command: string }).command
    const locked = await lockFor($, l => !!l.bash?.test(cmd))
    if (locked) return { deny: locked }
    let target = readyTarget(cmd)
    if (target === 'current') target = (await $.process.run(['gh', 'pr', 'view', '--json', 'number', '-q', '.number'])).stdout.trim() || 'unknown'
    if (target) {
      const gate = await readyGate($, /^\d+$/.test(target) ? target : undefined)
      if (gate) return { deny: target === 'new' ? `${gate} Create the PR with --draft.` : gate }
    }
    const gradle = isGradle(cmd)
    const role = (await read($, view)).me?.role
    // gradle skips the worktree lease so testers can build in the writer's worktree; read-only roles stay guarded
    if ((!gradle || (role && NON_WRITERS.has(role))) && !isReadOnly(cmd)) {
      const deny = await guard($, bashPaths(cmd, await $.session.cwd(), home))
      if (deny) return { deny }
    }
    if (!gradle) return next(e)
    if ((e as unknown as { run_in_background?: boolean }).run_in_background)
      return { deny: 'session-mesh: run gradle in the foreground; a background run would free its machine slot while still building' }
    let slot = ''
    // only a fresh win counts: 'mine' means this session already builds in that slot
    for (const k of ['gradle-1', 'gradle-2']) if ((await lease($, k, 'acquire', 'gradle')) === 'won') { slot = k; break }
    if (!slot) return { deny: 'session-mesh: both gradle-heavy slots are busy on this Mac; retry in a few minutes (do not wait in a loop)' }
    try {
      return await next(e)
    } finally {
      await lease($, slot, 'release')
    }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'session-mesh: guard failed closed (/mesh off to bypass)' }))

  // auto mode's classifier gives no verdict on a `to` it can't resolve, so the model sends to the peer's uds address
  // (from the peers tool) and this hook only stamps the sender's mesh address on the text
  on('session.send', async ($, e, next) => {
    const v = await read($, view)
    if (!v.me?.project || e.origin.kind !== 'model' || !v.peers.some(p => p.sock && `uds:${p.sock}` === e.to)) return next(e)
    return next({ ...e, text: `[from ${address(v.me)}] ${e.text}` })
  })

  on('tool.call', { tool: 'mcp__session-mesh__claim' }, async ($, e) => {
    const p = e as unknown as { ticket: string; wave?: string }
    return { result: await claimTicket($, String(p.ticket), p.wave) }
  }).catch(($, e, next) => (next.called ? next(e) : { result: 'claim failed; ask the user for /mesh status' }))

  on('tool.call', { tool: 'mcp__session-mesh__signoff' }, async ($, e) => {
    const p = e as unknown as { pr: string; ledger: string }
    return { result: await signoff($, String(p.pr), String(p.ledger)) }
  }).catch(($, e, next) => (next.called ? next(e) : { result: 'signoff failed' }))

  // configured tool locks (~/.claude/mesh/tool-locks.json), e.g. one session at a time on the e2e phone
  on('tool.call', async ($, e, next) => {
    tool = e.tool
    if (e.tool === 'Bash' || e.tool.startsWith('mcp__session-mesh__') || (await isOff($))) return next(e)
    const deny = await lockFor($, l => !!l.tools?.test(e.tool))
    if (deny) return { deny }
    if (e.tool === 'mcp__github__update_pull_request' && (e as unknown as { draft?: boolean }).draft === false) {
      const gate = await readyGate($, String((e as unknown as { pull_number?: number }).pull_number ?? ''))
      if (gate) return { deny: gate }
    }
    return next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'session-mesh: guard failed closed (/mesh off to bypass)' }))

  on('tool.call', { tool: 'mcp__session-mesh__peers' }, async $ => {
    await sweep($)
    const v = await read($, view)
    const rows = v.peers.filter(p => p.project && p.project === v.me?.project).map(p => `${address(p)}${p.ticket ? ` [${p.ticket}${p.wave ? ` w${p.wave}` : ''}]` : ''}  to: uds:${p.sock ?? '?'}  (${p.worktree})`)
    return { result: [`you: ${v.me ? address(v.me) : 'not joined'}`, ...(rows.length ? rows : ['no peers in this project'])].join('\n') }
  }).catch(($, e, next) => (next.called ? next(e) : { result: 'peers failed; ask the user for /mesh status' }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const v = await read($, view)
    if (e.props.hasSurvey || !v.me) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    if (v.off) return <Box><Text color="red">MESH OFF: guards disabled (/mesh on)</Text></Box>
    // unjoined: stay silent unless some session on this Mac is meshed
    if (!v.me.project) return v.peers.some(p => p.project) ? <Box><Text dimColor>mesh: not joined (/mesh join &lt;project&gt; &lt;level&gt; &lt;role&gt;)</Text></Box> : next(e)
    const mine = v.peers.filter(p => p.project === v.me?.project)
    const rest = v.peers.length - mine.length
    const row = (p: Presence, me: boolean) => (
      <Box key={p.pid}>
        <Text color={p.busy ? 'green' : undefined} dimColor={!p.busy}>{p.busy ? '●' : '○'} </Text>
        <Text dimColor>{me ? 'you ' : ''}{address(p)}{p.ticket ? ` [${p.ticket}]` : ''} · {activity(p)}</Text>
      </Box>
    )
    return (
      <Box flexDirection="column">
        <Text dimColor>mesh {v.me.project}{rest ? ` · +${rest} other` : ''}</Text>
        {row(v.me, true)}
        {mine.map(p => row(p, false))}
      </Box>
    )
  })
}
