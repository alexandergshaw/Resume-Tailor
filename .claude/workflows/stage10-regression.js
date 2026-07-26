export const meta = {
  name: 'stage10-regression',
  description: 'Stage 10: run every case in the regression document, adversarially verify each reported failure, and report confirmed regressions without fixing them',
  whenToUse: 'Once per group, after every feature in the group has cleared stages 1-9. Run against a settled tree - never while another agent is still editing.',
  phases: [
    { title: 'Enumerate', detail: 'parse the regression document into executable cases' },
    { title: 'Execute', detail: 'run parallel-safe cases fanned out, exclusive cases in sequence' },
    { title: 'Adjudicate', detail: 'try to refute every reported failure before believing it' },
  ],
}

// Stage 10 of the development loop. Feature-agnostic: the regression document is
// the only source of cases, so this script never needs to know what shipped.
// It reports; it does not fix. Fixing is stage 11 and belongs to the parent.
//
// args: {
//   doc?: string,             // default "docs/REGRESSION.md"
//   cwd?: string,             // default "hello-world"
//   docCwd?: string,          // where doc path is resolved from; default repo root ".."-relative, see below
//   areas?: string[],         // optional filter: only cases whose area matches one of these
//   buckets?: number,         // max parallel execution agents; default 6
//   refuters?: number,        // refutation agents per reported failure; default 2
//   maxAdjudicated?: number,  // cap on failures adjudicated; default 8
//   runnerModel?: string,     // default "opus" (regression is an Opus role)
//   enumerateModel?: string,  // default "sonnet" (mechanical parsing)
//   gates?: string[],         // commands every run should treat as gates
// }

// args can arrive either as a real object or as a JSON-encoded string depending
// on how the caller serialized it; accept both so the script is not caller-fragile.
function readArgs(raw) {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw)
    } catch {
      return {}
    }
  }
  return raw || {}
}

const input = readArgs(args)
const doc = input.doc || 'docs/REGRESSION.md'
const cwd = input.cwd || 'hello-world'
const buckets = Math.max(1, input.buckets || 6)
const refuters = Math.max(1, input.refuters || 2)
const maxAdjudicated = Math.max(1, input.maxAdjudicated || 8)
const runnerModel = input.runnerModel || 'opus'
const enumerateModel = input.enumerateModel || 'sonnet'
const areas = Array.isArray(input.areas) ? input.areas : []
const gates = Array.isArray(input.gates) && input.gates.length > 0
  ? input.gates
  : ['npx eslint .', 'npx tsc --noEmit', 'npx vitest run', 'npm run build']

const RULES = [
  'HARD RULES - violating any of these fails the task:',
  '- Do NOT run any git command. No add, commit, push, checkout, stash, restore, branch, or reset.',
  '- Do NOT fix anything. You are observing and reporting only. A fix here would hide the regression.',
  '- Do NOT edit any product, test, or documentation file.',
  '- No emojis anywhere in your output.',
  '- Report honestly. A case you could not run is "blocked", not "passed". Never infer a pass from the absence of an error.',
].join('\n')

const CASES = {
  type: 'object',
  additionalProperties: false,
  properties: {
    docFound: { type: 'boolean' },
    cases: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          area: { type: 'string' },
          summary: { type: 'string' },
          steps: { type: 'string' },
          expected: { type: 'string' },
          parallelSafe: {
            type: 'boolean',
            description: 'false when the case builds, starts a server, mutates shared state, or otherwise cannot run beside another case',
          },
          automatable: {
            type: 'boolean',
            description: 'false ONLY when the case heading declares automatable: no. Such cases are deliberately manual and are not executed.',
          },
        },
        required: ['id', 'area', 'summary', 'steps', 'expected', 'parallelSafe', 'automatable'],
      },
    },
    detail: { type: 'string' },
  },
  required: ['docFound', 'cases', 'detail'],
}

const VERDICTS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['pass', 'fail', 'blocked'] },
          evidence: { type: 'string', description: 'the command run and the actual observed output, not a paraphrase' },
          expectedVsActual: { type: 'string' },
        },
        required: ['id', 'status', 'evidence'],
      },
    },
  },
  required: ['verdicts'],
}

const REFUTATION = {
  type: 'object',
  additionalProperties: false,
  properties: {
    refuted: { type: 'boolean', description: 'true if this is NOT a real regression' },
    reason: { type: 'string', enum: ['real-regression', 'bad-test-case', 'stale-environment', 'flaky', 'already-known', 'could-not-reproduce'] },
    detail: { type: 'string' },
  },
  required: ['refuted', 'reason', 'detail'],
}

function chunk(items, n) {
  const out = []
  const size = Math.ceil(items.length / n)
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function caseBlock(c) {
  return [
    `Case ${c.id} [area: ${c.area}] parallelSafe=${c.parallelSafe}`,
    `Summary: ${c.summary}`,
    `Steps: ${c.steps}`,
    `Expected: ${c.expected}`,
  ].join('\n')
}

phase('Enumerate')
const enumerated = await agent(
  [
    'You are parsing a regression document into a list of independently executable cases.',
    '',
    RULES,
    '',
    `Repository working directory: ${cwd}`,
    `Regression document: ${doc} (resolve it relative to the repository root; it may also sit under ${cwd}/${doc})`,
    '',
    'Steps:',
    `1. Locate and read ${doc}. If it does not exist anywhere, set docFound=false, return an empty cases array, and explain where you looked. Do not invent cases.`,
    '2. Split the document into discrete, independently checkable cases. Each acceptance criterion is normally one case.',
    '3. For each case capture: a stable id (use the document\'s own numbering or heading when present), the area or feature it belongs to, a one-line summary, concrete steps, and the expected observable result.',
    '4. Classify parallelSafe. Mark a case parallelSafe=false when running it would collide with another case: anything that runs a production build, starts or restarts a dev server, writes to a shared output directory, depends on a specific working-tree state, or mutates files.',
    '   Read-only inspections and scoped unit-test runs are parallelSafe=true.',
    '4b. Record automatable. Set automatable=false ONLY when the case heading literally declares "automatable: no". Those cases are deliberately manual (they need a human judgement, a live API key, or a signed-in session) and will not be executed. Everything else is automatable=true.',
    areas.length > 0 ? `5. Only include cases whose area matches one of: ${areas.join(', ')}` : '5. Include every case in the document.',
    '',
    'Return the structured result.',
  ].join('\n'),
  { label: 'enumerate', phase: 'Enumerate', model: enumerateModel, schema: CASES },
)

if (!enumerated || !enumerated.docFound) {
  return {
    ok: false,
    docFound: false,
    doc,
    detail: (enumerated && enumerated.detail) || 'Enumeration agent returned nothing.',
    note: `No regression document at ${doc}. Stage 10 cannot run until the parent creates it and appends the group's acceptance criteria.`,
  }
}

const allCases = enumerated.cases || []
if (allCases.length === 0) {
  return { ok: false, docFound: true, doc, total: 0, note: 'Regression document found but produced zero cases. Check its structure.' }
}

// Cases the document itself declares manual are reported, never executed - they
// need a human. They are not failures and must not hold the run red, otherwise a
// document containing any manual case could never report green.
const manual = allCases.filter((c) => c.automatable === false)
const runnable = allCases.filter((c) => c.automatable !== false)
const safe = runnable.filter((c) => c.parallelSafe)
const exclusive = runnable.filter((c) => !c.parallelSafe)
log(`${allCases.length} case(s): ${safe.length} parallel-safe, ${exclusive.length} exclusive, ${manual.length} manual (not executed).`)

phase('Execute')
const runnerPreamble = [
  'You are executing regression cases against the current working tree and reporting exactly what happened.',
  '',
  RULES,
  '',
  `Working directory: ${cwd}`,
  `Gate commands available if a case refers to them: ${gates.join(' ; ')}`,
  '',
  'For each case: perform the steps, observe the real result, and compare it to the expected result.',
  'Evidence must be the actual command and its actual output, quoted. Never write "works as expected" without the output that shows it.',
  'If a case cannot be run (missing fixture, needs credentials, needs a signed-in browser), mark it blocked and say why. Blocked is not a pass.',
].join('\n')

const safeBatches = safe.length > 0 ? chunk(safe, buckets) : []
const safeRuns = await parallel(
  safeBatches.map((batch, i) => () =>
    agent(
      [runnerPreamble, '', `Run these ${batch.length} case(s):`, '', batch.map(caseBlock).join('\n\n')].join('\n'),
      { label: `cases:${i + 1}`, phase: 'Execute', model: runnerModel, schema: VERDICTS },
    ),
  ),
)

let exclusiveRun = null
if (exclusive.length > 0) {
  exclusiveRun = await agent(
    [
      runnerPreamble,
      '',
      'These cases are NOT safe to run concurrently. Run them STRICTLY ONE AT A TIME, in the order given, letting each finish completely before starting the next.',
      '',
      exclusive.map(caseBlock).join('\n\n'),
    ].join('\n'),
    { label: 'cases:exclusive', phase: 'Execute', model: runnerModel, schema: VERDICTS },
  )
}

const verdicts = []
for (const r of safeRuns) if (r && Array.isArray(r.verdicts)) verdicts.push(...r.verdicts)
if (exclusiveRun && Array.isArray(exclusiveRun.verdicts)) verdicts.push(...exclusiveRun.verdicts)

const byId = new Map(allCases.map((c) => [c.id, c]))
const reported = new Set(verdicts.map((v) => v.id))
const notRun = runnable.filter((c) => !reported.has(c.id)).map((c) => c.id)
if (notRun.length > 0) log(`WARNING: ${notRun.length} case(s) produced no verdict: ${notRun.join(', ')}`)

const failures = verdicts.filter((v) => v.status === 'fail')
const blocked = verdicts.filter((v) => v.status === 'blocked')
log(`${verdicts.filter((v) => v.status === 'pass').length} passed, ${failures.length} failed, ${blocked.length} blocked.`)

phase('Adjudicate')
const LENSES = [
  'Is the CASE wrong rather than the code? Check whether the documented expectation still matches intended behavior, or whether the case is stale.',
  'Is the ENVIRONMENT wrong rather than the code? Check for stale build output, a cached dev server, missing env vars, or a tree left dirty by an earlier step.',
  'Is it NON-DETERMINISTIC? Re-run the case at least twice and check for order dependence, timing, or shared state from a neighbouring case.',
]

const toAdjudicate = failures.slice(0, maxAdjudicated)
if (failures.length > toAdjudicate.length) {
  log(`NOTE: adjudicating only ${toAdjudicate.length} of ${failures.length} failures (maxAdjudicated). The remainder are reported unadjudicated.`)
}

const adjudicated = await parallel(
  toAdjudicate.map((f) => () => {
    const c = byId.get(f.id)
    return parallel(
      Array.from({ length: refuters }, (unused, k) => () =>
        agent(
          [
            'You are trying to REFUTE a reported regression. Default to refuted=true unless the evidence for a real regression is solid.',
            '',
            RULES,
            '',
            `Working directory: ${cwd}`,
            '',
            'Reported failure:',
            c ? caseBlock(c) : `Case ${f.id}`,
            '',
            `Reported evidence: ${f.evidence}`,
            f.expectedVsActual ? `Reported expected vs actual: ${f.expectedVsActual}` : '',
            '',
            `Your angle for this review: ${LENSES[k % LENSES.length]}`,
            '',
            'Reproduce the case yourself before deciding. Set refuted=false only when you personally reproduced the failure and it reflects genuinely broken product behavior.',
          ].filter(Boolean).join('\n'),
          { label: `refute:${f.id}:${k + 1}`, phase: 'Adjudicate', model: runnerModel, schema: REFUTATION },
        ),
      ),
    ).then((votes) => {
      const cast = votes.filter(Boolean)
      const standing = cast.filter((v) => !v.refuted).length
      return {
        id: f.id,
        area: c ? c.area : '',
        summary: c ? c.summary : '',
        evidence: f.evidence,
        votesFor: standing,
        votesAgainst: cast.length - standing,
        confirmed: cast.length > 0 && standing > cast.length / 2,
        reasons: cast.map((v) => `${v.reason}: ${v.detail}`),
      }
    })
  }),
)

const judged = adjudicated.filter(Boolean)
const confirmed = judged.filter((j) => j.confirmed)
const dismissed = judged.filter((j) => !j.confirmed)
const unadjudicated = failures.slice(toAdjudicate.length).map((f) => ({ id: f.id, evidence: f.evidence }))

return {
  ok: confirmed.length === 0 && blocked.length === 0 && notRun.length === 0 && unadjudicated.length === 0,
  doc,
  total: allCases.length,
  automatable: runnable.length,
  passed: verdicts.filter((v) => v.status === 'pass').length,
  manualCases: manual.map((c) => ({ id: c.id, summary: c.summary, steps: c.steps })),
  confirmedRegressions: confirmed,
  dismissedFailures: dismissed.map((d) => ({ id: d.id, reasons: d.reasons })),
  unadjudicatedFailures: unadjudicated,
  blocked: blocked.map((b) => ({ id: b.id, evidence: b.evidence })),
  notRun,
  parentMustDo: [
    'Stage 11: run RCA on each confirmed regression, delegate the fix, then re-run this workflow. No partial passes.',
    'Blocked and not-run cases are not passes. Either make them runnable or record in the document why they cannot be automated.',
    'Manual cases (automatable: no) were reported, not executed. Run them by hand and record the outcome; they are never counted as passes.',
    'Dismissed failures still deserve a glance: a case dismissed as bad-test-case means the regression document needs an edit.',
  ],
}
