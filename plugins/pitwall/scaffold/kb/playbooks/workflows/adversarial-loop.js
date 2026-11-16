// Generic adversarial review loop for any work product.
//
//   Workflow({ scriptPath: "<this file>", args: { target: "the current branch's diff", fix: true } })
//
// args:
//   target      (string, required) what to review — a PR, a diff, a path, a plan/doc, a claim set
//   checklist   (string)  the standard to measure against; default: the target's own stated scope
//   dimensions  (string[]) review lenses; default: DEFAULT_DIMENSIONS
//   fix         (bool)    remediate confirmed findings between rounds and re-review. default false
//   maxRounds   (number)  hard loop bound, >= 1. default 3
//   voters      (number)  refuters per finding, >= 1. default 3
//
// Exit: a round yields nothing open, or maxRounds. Never unbounded.
// `clean` means nothing non-minor is OPEN at exit — where open = confirmed this round,
// + anything no skeptic could reach, + anything the fixer said it did not fix.
// A finding no refuter reached is UNVERIFIED, never REFUTED: silence is not acquittal.

export const meta = {
  name: 'adversarial-loop',
  description: 'Review any work product across lenses, adversarially verify each finding, optionally fix and re-review until clean',
  whenToUse: 'A diff, plan, doc or claim set needs findings that survive a skeptic, not a first-pass list',
  phases: [
    { title: 'Review', detail: 'one finder per dimension' },
    { title: 'Verify', detail: 'N refuters per finding; majority-refute kills it' },
    { title: 'Fix', detail: 'remediate confirmed findings, then re-review' },
  ],
}

const A = typeof args === 'string' ? { target: args } : (args || {})
if (!A.target) throw new Error('args.target is required')

const DEFAULT_DIMENSIONS = [
  'Correctness — logic that is wrong, not merely ugly. Wrong output, crash, data loss, race.',
  'Scope & completeness — what the stated standard requires that is missing, half-done, or silently dropped.',
  'Evidence — claims asserted without backing. Verify the PREMISE of each claim, not just its reasoning chain.',
  'Regression risk — sibling callers, shared contracts, and paths the change touches but does not mention.',
]

const DIMENSIONS = A.dimensions || DEFAULT_DIMENSIONS
const MAX_ROUNDS = A.maxRounds ?? 3
const VOTERS = A.voters ?? 3
const STANDARD = A.checklist || "the target's own stated scope and acceptance criteria"

// voters:0 would make the majority test `0 >= 0` and confirm everything unread;
// maxRounds:0 would skip the loop and report clean on an unopened target.
if (!Number.isInteger(VOTERS) || VOTERS < 1) throw new Error(`args.voters must be an integer >= 1 (got ${A.voters})`)
if (!Number.isInteger(MAX_ROUNDS) || MAX_ROUNDS < 1) throw new Error(`args.maxRounds must be an integer >= 1 (got ${A.maxRounds})`)
if (!DIMENSIONS.length) throw new Error('args.dimensions must not be empty')

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'one sentence, the defect itself' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
          location: { type: 'string', description: 'file:line, section, or claim id' },
          failure: { type: 'string', description: 'concrete inputs/state -> wrong outcome' },
          evidence: { type: 'string', description: 'what you actually read that proves it' },
        },
        required: ['title', 'severity', 'location', 'failure'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT = {
  type: 'object',
  properties: { refuted: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['refuted', 'reason'],
}

// The fixer's own account is the only deterministic signal for what it left alone —
// without it, "still open" degrades to "whatever the next round happened to re-find".
const FIXREPORT = {
  type: 'object',
  properties: {
    fixed: { type: 'array', items: { type: 'integer' }, description: '1-based numbers of findings actually repaired' },
    unfixed: {
      type: 'array',
      items: {
        type: 'object',
        properties: { n: { type: 'integer' }, reason: { type: 'string' } },
        required: ['n', 'reason'],
      },
      description: 'findings deliberately not repaired, with why',
    },
  },
  required: ['fixed', 'unfixed'],
}

// Simplification: findings are identified by exact lowercased location::title. Two agents wording
// one defect differently key apart, costing a duplicate verify. Upgrade to a semantic
// dedup judge only if duplicate verifies show up as a real cost in practice.
const key = f => `${f.location}::${f.title}`.toLowerCase()
const nonMinor = f => f.severity !== 'minor'

const refutedHistory = []      // advisory only — NEVER a hard filter, see the reset below
const declined = new Map()     // key -> finding the fixer said it did not fix
const history = []
let open = []
let exhausted = false

for (let round = 1; round <= MAX_ROUNDS; round++) {
  log(`round ${round}/${MAX_ROUNDS} — ${DIMENSIONS.length} lenses over ${A.target}`)

  // Fresh per round. A Fix round rewrites the artifact, so every earlier disposition is stale —
  // carrying keys across rounds would blindlist exactly the code the fixer just touched.
  // Convergence is guaranteed by MAX_ROUNDS, not by suppressing repeats.
  const seen = new Set()
  const priorNote = refutedHistory.length
    ? `Refuted in an earlier round, against an EARLIER version of this artifact:\n${refutedHistory.join('\n')}\n` +
      `Do not re-raise these on the old reasoning. Do raise one if you can show it is real NOW.\n\n`
    : ''

  // pipeline, not barrier: a lens's findings reach Verify while other lenses still read.
  const rounds = await pipeline(
    DIMENSIONS,
    (dim, _item, i) =>
      agent(
        `Review this work product: ${A.target}\n\n` +
          `Measure it against: ${STANDARD}\n\n` +
          `Your lens for this pass — report ONLY through it:\n${dim}\n\n` +
          priorNote +
          `Read the actual artifact before claiming anything. A finding with no evidence you personally read is not a finding. Return [] rather than padding.`,
        { label: `review:${i + 1}`, phase: 'Review', schema: FINDINGS },
      ),
    (res, _dim, i) => {
      // Claim keys SYNCHRONOUSLY, before any await — two lenses reporting the same defect
      // must not each pay VOTERS refuters. This is the intra-round dedup.
      const mine = (res?.findings || []).filter(f => !seen.has(key(f)))
      mine.forEach(f => seen.add(key(f)))
      return parallel(
        mine.map(f => () =>
          parallel(
            Array.from({ length: VOTERS }, (_, v) => () =>
              agent(
                `Try to REFUTE this finding. You are the skeptic, not the author.\n\n` +
                  `Target: ${A.target}\nLocation: ${f.location}\nClaim: ${f.title}\n` +
                  `Alleged failure: ${f.failure}\nCited evidence: ${f.evidence || '(none given)'}\n\n` +
                  `Check the PREMISE first — a sound chain on a false premise is still refuted. ` +
                  `Go read the artifact yourself; do not take the citation on trust. ` +
                  `Default to refuted=true if you cannot confirm it.`,
                { label: `refute:${i + 1}.${v + 1}`, phase: 'Verify', schema: VERDICT },
              ),
            ),
          ).then(votes => {
            const live = votes.filter(Boolean)
            if (!live.length) {
              // No skeptic reached it. That is not an acquittal — surface it as unverified.
              log(`all ${VOTERS} refuters died on "${f.title}" — UNVERIFIED, carried as open`)
              return { ...f, verdict: 'UNVERIFIED', dissent: [] }
            }
            // Threshold against the votes actually cast, not the nominal VOTERS — otherwise
            // 2 dead refuters out of 3 silently kill a finding the survivor confirmed.
            const survives = live.filter(v => !v.refuted).length >= Math.ceil(live.length / 2)
            return {
              ...f,
              verdict: survives ? 'CONFIRMED' : 'REFUTED',
              voters: live.length,
              dissent: live.filter(v => v.refuted).map(v => v.reason),
            }
          }),
        ),
      )
    },
  )

  const judged = rounds.filter(Boolean).flat().filter(Boolean)
  const confirmed = judged.filter(f => f.verdict === 'CONFIRMED')
  const unverified = judged.filter(f => f.verdict === 'UNVERIFIED')
  const refuted = judged.filter(f => f.verdict === 'REFUTED')
  refuted.forEach(f => refutedHistory.push(`- ${f.location} — ${f.title}`))

  open = [...confirmed, ...unverified]
  // A finding the fixer declined stays open until a later round re-raises it or the run ends.
  declined.forEach((f, k) => { if (!open.some(o => key(o) === k)) open.push(f) })

  history.push({ round, confirmed: confirmed.length, unverified: unverified.length, refuted: refuted.length, criticals: open.filter(nonMinor).length })
  log(`round ${round}: ${confirmed.length} confirmed, ${unverified.length} unverified, ${refuted.length} refuted (${open.filter(nonMinor).length} critical/major open)`)

  if (!open.length) { log('nothing open — converged'); break }
  if (!A.fix) { log('fix disabled — reporting after one round'); break }
  if (round === MAX_ROUNDS) {
    exhausted = true
    log(`hit maxRounds=${MAX_ROUNDS} with ${open.filter(nonMinor).length} critical/major still open — escalating, NOT clean`)
    break
  }

  const numbered = open.map((f, n) => `${n + 1}. [${f.severity}] ${f.location} — ${f.title}\n   failure: ${f.failure}`).join('\n\n')
  const report = await agent(
    `Fix these findings in ${A.target}. Sequential edits — you are the only writer.\n\n${numbered}\n\n` +
      `Fix the ROOT CAUSE, not the symptom: if sibling callers route through the same code, fix it once where they all pass. ` +
      `Report by number exactly which you fixed and which you did not, with why. Do not claim a fix you did not make.`,
    { label: `fix:round-${round}`, phase: 'Fix', schema: FIXREPORT },
  )

  // A dead or skipped fixer fixed nothing — treat every finding as still open, not as repaired.
  declined.clear()
  const stillOpen = report ? new Set(report.unfixed.map(u => u.n)) : new Set(open.map((_, n) => n + 1))
  if (!report) log('fix agent returned nothing — treating all findings as unfixed')
  open.forEach((f, n) => { if (stillOpen.has(n + 1)) declined.set(key(f), f) })
  log(`fixer repaired ${open.length - declined.size}, declined ${declined.size}`)
}

const rank = f => ['critical', 'major', 'minor'].indexOf(f.severity)

return {
  target: A.target,
  rounds: history,
  clean: !exhausted && open.filter(nonMinor).length === 0,
  exhaustedRounds: exhausted,
  open: [...open].sort((a, b) => rank(a) - rank(b)),
  unverified: open.filter(f => f.verdict === 'UNVERIFIED'),
  refutedCount: refutedHistory.length,
}
