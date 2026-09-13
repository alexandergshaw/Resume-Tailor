export const meta = {
  name: 'stage10-regression',
  description: 'Stage 10: run every case in the regression document, adversarially verify each reported failure, and report confirmed regressions without fixing them',
  whenToUse: 'Once per group, after every feature in the group has cleared stages 1-9. Run against a settled tree - never while another agent is still editing. The parent runs scripts/regression-integrity.sh with its own Bash tool and supplies its rows as args.files (and its "FILES=/CASES=" line as args.summary). Do not invoke this workflow if that script exits non-zero - report its stderr and stop instead.',
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
// docs/REGRESSION.md is an INDEX ONLY and contains zero cases - every case
// lives under docs/regression/<area>.md (split further into <area>-2.md,
// <area>-3.md, ... when an area outgrows the split threshold). This script has
// no filesystem access, so it cannot discover that file list itself: the
// PARENT runs scripts/regression-integrity.sh with its own Bash tool and
// passes its per-file rows as args.files. That script also enforces the
// structural rules (placement, ID uniqueness, size caps, honesty ratchets)
// that would otherwise let a case be silently lost or misfiled - see its own
// header comment.
//
// args: {
//   doc?: string,             // default "docs/REGRESSION.md" (the index; used for display and as the discovery fallback's target)
//   regressionDir?: string,   // default "docs/regression" (where case files live; used by the discovery fallback)
//   files?: Array<{           // rows from `scripts/regression-integrity.sh`'s stdout, one per case file.
//     file: string,           //   path relative to the repo root, e.g. "docs/regression/copilot-answers.md"
//     cases: string[],        //   the IDs the script found in that file via grep -c '^### R-' - the completeness oracle
//     bytes: number,          //   file size in bytes, used to pack enumerate batches under the per-agent budget
//     payloadBytes: object,   //   { "<id>": <Steps:+Expected: byte count> } - the within-case-truncation oracle
//   }>,
//   summary?: string,         // the script's trailing "FILES=<n> CASES=<n>" line, cross-checked against args.files
//   cwd?: string,             // default "hello-world"
//   docCwd?: string,          // where doc path is resolved from; default repo root ".."-relative, see below
//   areas?: string[],         // optional filter: only cases whose area matches one of these (matched against the filename with any -<digits> part suffix stripped)
//   buckets?: number,         // max parallel EXECUTION agents; default 6
//   enumerateBatchBytes?: number, // max bytes per enumerate batch; default 110000 (see scripts/regression-integrity.sh's H)
//   refuters?: number,        // refutation agents per reported failure; default 2
//   maxAdjudicated?: number,  // cap on failures adjudicated; default 8
//   runnerModel?: string,     // default "opus" (regression is an Opus role)
//   enumerateModel?: string,  // default "sonnet" (mechanical parsing)
//   gates?: string[],         // commands every run should treat as gates
// }
//
// If args.files is omitted or ends up empty (e.g. an `areas` filter matches
// nothing), this workflow falls back to a single discovery agent that reads
// docs/regression/ itself - logged loudly, and flagged as
// discoveryFallback: true in the result, because that path can silently
// under-report on a large document exactly the way the pre-split single-agent
// enumerate used to.

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
const regressionDir = input.regressionDir || 'docs/regression'
const cwd = input.cwd || 'hello-world'
const buckets = Math.max(1, input.buckets || 6)
const enumerateBatchBytes = Math.max(1, input.enumerateBatchBytes || 110000)
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
            type: 'string',
            enum: ['yes', 'no', 'partly'],
            description: 'Copy the heading\'s literal "automatable:" value verbatim - never infer it. "no" cases are deliberately manual and are not executed. "partly" cases mix automatable and manual steps; the workflow splits them by the per-step `Manual (`automatable: no`):` marker.',
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

// area is derived from the FILENAME, never carried as its own field: a
// sub-split part (<area>-2.md, <area>-3.md, ...) still holds cases whose
// heading says the unsuffixed area, so filename-without-suffix is the only
// thing that is both mechanical and correct for the areas? filter. Mirrors
// the same normalisation scripts/regression-integrity.sh's placement check
// performs, so the two cannot silently disagree.
function areaOfFile(file) {
  let n = String(file).split('/').pop().replace(/\.md$/, '')
  n = n.replace(/-\d+$/, '')
  return n
}

// First-fit-decreasing over the discovery rows, largest file first. Bounded-
// output is a property of the BATCH, not of one-file-per-agent: this is what
// lets an enumerate agent's returned JSON stay comfortably inside its output
// budget regardless of how many area files exist. Hard-errors rather than
// silently over-filling a bin - a file over the byte budget must have already
// been caught by scripts/regression-integrity.sh's own H-sized rule 6, so
// reaching this throw means that guard was bypassed or is out of date.
function packBatches(files, maxBytes) {
  const sorted = [...files].sort((a, b) => (b.bytes || 0) - (a.bytes || 0))
  const batches = []
  for (const f of sorted) {
    if ((f.bytes || 0) > maxBytes) {
      throw new Error(
        `${f.file} is ${f.bytes} bytes, over the enumerate batch budget of ${maxBytes}. ` +
        `scripts/regression-integrity.sh's rule 6 should have failed before this workflow ever ran - do not proceed.`,
      )
    }
    const bin = batches.find((b) => b.bytes + f.bytes <= maxBytes)
    if (bin) {
      bin.files.push(f)
      bin.bytes += f.bytes
    } else {
      batches.push({ files: [f], bytes: f.bytes })
    }
  }
  return batches
}

// A `partly` case mixes automatable and manual steps. The document's own
// convention marks every manual step as `N. Manual (`automatable: no`): ...`.
// Splitting on that marker is done here in plain JS, deterministically -
// never by asking an agent to judge which steps are "really" manual, which
// would just move the honesty gap into a new parser.
const MANUAL_STEP_MARKER = /^\s*\d+[a-z]?\.\s*Manual\s*\(`automatable:\s*no`\)\s*:/i

function splitManualSteps(stepsText) {
  const lines = String(stepsText || '').split('\n')
  const manualLines = []
  const autoLines = []
  for (const line of lines) {
    if (MANUAL_STEP_MARKER.test(line)) manualLines.push(line)
    else autoLines.push(line)
  }
  // Separable only when there is at least one marked step AND at least one
  // real unmarked step - otherwise this is one of the grandfathered `partly`
  // cases with no per-step marker at all, and it is dispatched whole, exactly
  // as it runs today. Mirrors scripts/regression-integrity.sh's own rule 7
  // definition of "separable" so the two never disagree about which cases
  // are grandfathered.
  const hasAuto = autoLines.some((l) => l.trim().length > 0)
  const separable = manualLines.length > 0 && hasAuto
  return { autoSteps: autoLines.join('\n'), manualSteps: manualLines.join('\n'), separable }
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

// Two entirely different events used to share one hardcoded return: "the
// enumerate agent returned nothing" (cap exceeded, schema violation, crash)
// and "the document is missing". Both used to emit the same confident,
// wrong `docFound: false`. They are tracked separately from here on, plus a
// third state neither the original code nor a plain crash check can see: the
// document was found and PARTLY parsed - a valid but truncated result, which
// is the natural failure mode of asking one agent to re-emit an entire large
// document as JSON.
let enumerationFailed = false
let enumerationIncomplete = false
let docFound = true
let discoveryFallback = false
const incompleteDetails = []
let allCases = []
let fileIdSets = []

let filesInput = Array.isArray(input.files) ? input.files.filter((f) => f && typeof f.file === 'string' && Array.isArray(f.cases)) : []

// Sanity-cross-check args.summary ("FILES=<n> CASES=<n>") against args.files
// itself, when both are supplied. This cannot catch a caller that runs the
// integrity script, reads its rows, and then deliberately hands this
// workflow different ones - that is a property of the caller and there is no
// ground truth to score it against - but it does catch an accidental
// mismatch between the two values the caller was supposed to pass together.
if (typeof input.summary === 'string') {
  const m = input.summary.match(/FILES=(\d+)\s+CASES=(\d+)/)
  if (m) {
    const claimedFiles = Number(m[1])
    const claimedCases = Number(m[2])
    const actualFiles = filesInput.length
    const actualCases = filesInput.reduce((n, f) => n + f.cases.length, 0)
    if (claimedFiles !== actualFiles || claimedCases !== actualCases) {
      log(
        `WARNING: args.summary ("${input.summary}") disagrees with args.files ` +
        `(${actualFiles} files / ${actualCases} cases). Proceeding on args.files, ` +
        `but this means args.files may not be exactly what the integrity script produced.`,
      )
    }
  }
}

if (areas.length > 0 && filesInput.length > 0) {
  filesInput = filesInput.filter((f) => areas.includes(areaOfFile(f.file)))
}

if (filesInput.length === 0) {
  // No transport to fabricate in the primary path - the caller ran the
  // script and handed us its rows. This is the degraded path: no rows were
  // supplied at all (or an areas filter matched none of them), so fall back
  // to a single discovery agent. It is exactly the failure mode this whole
  // change exists to fix, so it must never be silent.
  discoveryFallback = true
  log(
    'WARNING: no args.files supplied (or the areas filter matched no file) - falling back to a single ' +
    'discovery agent reading docs/regression/ directly. This can silently under-report on a large ' +
    'document the same way the pre-split single-agent enumerate used to. The caller should run ' +
    'scripts/regression-integrity.sh and pass its rows as args.files.',
  )
  const enumerated = await agent(
    [
      'You are parsing this project\'s regression suite into a list of independently executable cases.',
      '',
      RULES,
      '',
      `Repository working directory: ${cwd}`,
      `Regression index: ${doc} (an INDEX ONLY - it contains zero cases; do not conclude docFound=false just because it has none)`,
      `Case files: every ${regressionDir}/*.md file (resolve relative to the repository root; may also sit under ${cwd}/${regressionDir})`,
      '',
      'Steps:',
      `1. List and read every file matching ${regressionDir}/*.md. If that directory does not exist or holds no such file, set docFound=false, return an empty cases array, and explain where you looked. Do not invent cases.`,
      '2. Each file holds one or more cases; each case is one heading of the exact shape `### R-NNN | area: X | parallel-safe: yes|no | automatable: yes|no|partly` followed by Summary/Steps/Expected blocks. Parse every case in every file.',
      '3. For each case capture: its id exactly as written (zero-padded, e.g. "R-082"), its area, a one-line summary, concrete steps, and the expected observable result.',
      '4. Classify parallelSafe. Mark a case parallelSafe=false when running it would collide with another case: anything that runs a production build, starts or restarts a dev server, writes to a shared output directory, depends on a specific working-tree state, or mutates files.',
      '   Read-only inspections and scoped unit-test runs are parallelSafe=true.',
      '4b. Record automatable as the literal string from the heading - "yes", "no", or "partly". Copy it verbatim; never infer it from the steps.',
      areas.length > 0 ? `5. Only include cases whose area matches one of: ${areas.join(', ')}` : '5. Include every case in every file.',
      '',
      'Return the structured result.',
    ].join('\n'),
    { label: 'enumerate:discovery', phase: 'Enumerate', model: enumerateModel, schema: CASES },
  )
  if (!enumerated) {
    enumerationFailed = true
    incompleteDetails.push('discovery agent returned nothing')
  } else if (enumerated.docFound === false) {
    docFound = false
  } else {
    allCases = enumerated.cases || []
  }
} else {
  // Part B, the actual cap fix: enumerate in BATCHES of area files, packed by
  // byte budget, in parallel - never one agent re-emitting the whole
  // document, and never one agent per file either (that is 100+ agents and
  // re-introduces the same silent under-report one level down).
  const batches = packBatches(filesInput, enumerateBatchBytes)
  if (batches.length > 12) {
    log(`WARNING: ${batches.length} enumerate batches. Agent-count guidance is 15 per workflow; raise enumerateBatchBytes or split the suite.`)
  }

  const batchResults = await parallel(
    batches.map((batch, i) => () =>
      agent(
        [
          'You are parsing a set of regression-suite files into a list of independently executable cases.',
          '',
          RULES,
          '',
          `Repository working directory: ${cwd}`,
          'Read exactly these files (resolve relative to the repository root; they may also sit under ' + cwd + '/) and no others:',
          ...batch.files.map((f) => `- ${f.file}`),
          '',
          'Steps:',
          '1. Read every file listed above in full. Each file holds one or more cases; each case is one heading of the exact shape `### R-NNN | area: X | parallel-safe: yes|no | automatable: yes|no|partly` followed by Summary/Steps/Expected blocks.',
          '2. Parse EVERY case in EVERY listed file. Do not skip any, and do not summarise or shorten steps/expected - return them in full; a shortened case is treated as a dropped case downstream.',
          '3. For each case capture: its id exactly as written (zero-padded, e.g. "R-082"), its area, a one-line summary, the full steps text, and the full expected text.',
          '4. Classify parallelSafe. Mark a case parallelSafe=false when running it would collide with another case: anything that runs a production build, starts or restarts a dev server, writes to a shared output directory, depends on a specific working-tree state, or mutates files.',
          '   Read-only inspections and scoped unit-test runs are parallelSafe=true.',
          '4b. Record automatable as the literal string from the heading - "yes", "no", or "partly". Copy it verbatim; never infer it from the steps.',
          '',
          'Return the structured result. docFound is true as long as you could read the files listed above.',
        ].join('\n'),
        { label: `enumerate:${i + 1}`, phase: 'Enumerate', model: enumerateModel, schema: CASES },
      ),
    ),
  )

  batches.forEach((batch, i) => {
    const result = batchResults[i]
    const batchFiles = batch.files.map((f) => f.file).join(', ')
    const expectedIds = new Set(batch.files.flatMap((f) => f.cases))

    if (!result || !Array.isArray(result.cases)) {
      enumerationFailed = true
      incompleteDetails.push(`batch ${i + 1} (${batchFiles}) returned nothing`)
      return
    }

    // Assertion 1 (upgraded from cardinality to identity, §6.5.2): the
    // returned ID SET must equal the union of the script's own per-file ID
    // lists for every file handed to this batch. The batch - not the agent -
    // knows which files it was given, so this is the attribution the plan
    // requires without trusting a self-reported `file` field.
    const returnedIds = new Set(result.cases.map((c) => c.id))
    const missing = [...expectedIds].filter((id) => !returnedIds.has(id))
    const unexpected = [...returnedIds].filter((id) => !expectedIds.has(id))
    if (missing.length > 0) {
      enumerationIncomplete = true
      incompleteDetails.push(`batch ${i + 1} (${batchFiles}) missing id(s): ${missing.join(', ')}`)
    }
    if (unexpected.length > 0) {
      enumerationIncomplete = true
      incompleteDetails.push(`batch ${i + 1} (${batchFiles}) unexpected id(s) not in the script's rows: ${unexpected.join(', ')}`)
    }

    // Assertion 2 (§6.5.2a): per case, the returned steps+expected payload is
    // not implausibly short against the script's own byte count for that
    // case - the failure a heading count can never see, because it counts
    // headings, not content. A gutted case still counts as "present".
    const payloadByFile = new Map(batch.files.map((f) => [f.file, f.payloadBytes || {}]))
    for (const c of result.cases) {
      let srcBytes
      for (const p of payloadByFile.values()) {
        if (Object.prototype.hasOwnProperty.call(p, c.id)) { srcBytes = p[c.id]; break }
      }
      if (typeof srcBytes === 'number' && srcBytes >= 400) {
        const returnedBytes = String(c.steps || '').length + String(c.expected || '').length
        if (returnedBytes < 0.5 * srcBytes) {
          enumerationIncomplete = true
          incompleteDetails.push(`case ${c.id}: returned ${returnedBytes}B of steps+expected vs source ${srcBytes}B - looks truncated`)
        }
      }
    }

    allCases.push(...result.cases)
  })

  // Assertion 4: the grand total matches the script's own rows, with
  // FILES=0/CASES=0 never treated as a vacuous pass (§6.5.0a) - filesInput is
  // already known non-empty here, so a zero total below can only mean cases
  // were lost in flight.
  const totalExpected = filesInput.reduce((n, f) => n + f.cases.length, 0)
  if (allCases.length !== totalExpected) {
    enumerationIncomplete = true
    incompleteDetails.push(`total: got ${allCases.length} case(s) across all batches, the script's rows declared ${totalExpected}`)
  }

  const returnedIdSet = new Set(allCases.map((c) => c.id))
  fileIdSets = filesInput.map((f) => ({
    file: f.file,
    expected: f.cases,
    missing: f.cases.filter((id) => !returnedIdSet.has(id)),
  }))
}

if (enumerationFailed) {
  return {
    ok: false,
    enumerationFailed: true,
    docFound: null,
    doc,
    discoveryFallback,
    detail: incompleteDetails.join('; ') || 'One or more enumerate agents returned nothing.',
    note: 'An enumerate agent failed or returned nothing. This does NOT mean the regression document is missing - see detail for which batch, and re-run.',
  }
}

if (!docFound) {
  return {
    ok: false,
    docFound: false,
    doc,
    discoveryFallback,
    note: `No regression suite found under ${regressionDir}. Stage 10 cannot run until the parent creates it and appends the group's acceptance criteria.`,
  }
}

if (enumerationIncomplete) {
  return {
    ok: false,
    docFound: true,
    enumerationIncomplete: true,
    doc,
    discoveryFallback,
    fileIdSets,
    detail: incompleteDetails.join('; '),
    note: 'The regression suite was found and parsed SHORT - one or more files, ids, or case bodies did not come back complete. See detail. This is not "no regression document" and must not be reported as such.',
  }
}

if (allCases.length === 0) {
  return { ok: false, docFound: true, doc, total: 0, discoveryFallback, note: 'Regression suite found but produced zero cases. Check its structure.' }
}

// Cases the document itself declares manual are reported, never executed - they
// need a human. They are not failures and must not hold the run red, otherwise a
// document containing any manual case could never report green.
const manual = allCases.filter((c) => c.automatable === 'no')
const runnableAll = allCases.filter((c) => c.automatable !== 'no')

// A `partly` case with a per-step manual marker is split: its automatable
// steps are dispatched like any other case, its manual steps are reported in
// manualStepsReport and never executed or counted as a pass. A `partly` case
// with no marker (grandfathered - see scripts/regression-integrity.sh rule 7)
// is dispatched whole, unchanged from today, so this workflow behaves
// correctly on the 25 unmarked cases even before anyone backfills them.
const manualStepsReport = []
const runnable = runnableAll.map((c) => {
  if (c.automatable !== 'partly') return c
  const split = splitManualSteps(c.steps)
  if (!split.separable) return c
  manualStepsReport.push({ id: c.id, area: c.area, manualSteps: split.manualSteps })
  return { ...c, steps: split.autoSteps }
})

const safe = runnable.filter((c) => c.parallelSafe)
const exclusive = runnable.filter((c) => !c.parallelSafe)
log(
  `${allCases.length} case(s): ${safe.length} parallel-safe, ${exclusive.length} exclusive, ${manual.length} manual (not executed), ` +
  `${manualStepsReport.length} partly-case manual step-set(s) split out and not executed.` +
  (discoveryFallback ? ' [discoveryFallback: args.files was not supplied]' : ''),
)

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
      // A majority confirms. But a SPLIT is not a dismissal: if even one
      // reviewer personally reproduced the failure, it surfaces as disputed
      // and holds the run red for the parent to judge. Silently dropping a
      // reproduced defect because a second reviewer disagreed is the one
      // failure mode a regression suite must never have.
      const majority = cast.length > 0 && standing > cast.length / 2
      return {
        id: f.id,
        area: c ? c.area : '',
        summary: c ? c.summary : '',
        evidence: f.evidence,
        votesFor: standing,
        votesAgainst: cast.length - standing,
        confirmed: majority,
        disputed: !majority && standing > 0,
        reasons: cast.map((v) => `${v.reason}: ${v.detail}`),
      }
    })
  }),
)

const judged = adjudicated.filter(Boolean)
const confirmed = judged.filter((j) => j.confirmed)
const disputed = judged.filter((j) => j.disputed)
const dismissed = judged.filter((j) => !j.confirmed && !j.disputed)
if (disputed.length > 0) {
  log(`${disputed.length} failure(s) DISPUTED - at least one reviewer reproduced them. Parent must judge; not dismissed.`)
}
const unadjudicated = failures.slice(toAdjudicate.length).map((f) => ({ id: f.id, evidence: f.evidence }))

return {
  ok:
    confirmed.length === 0 &&
    disputed.length === 0 &&
    blocked.length === 0 &&
    notRun.length === 0 &&
    unadjudicated.length === 0,
  doc,
  docFound: true,
  enumerationFailed: false,
  enumerationIncomplete: false,
  discoveryFallback,
  fileIdSets,
  total: allCases.length,
  automatable: runnable.length,
  passed: verdicts.filter((v) => v.status === 'pass').length,
  manualCases: manual.map((c) => ({ id: c.id, summary: c.summary, steps: c.steps })),
  manualSteps: manualStepsReport,
  confirmedRegressions: confirmed,
  disputedFailures: disputed,
  dismissedFailures: dismissed.map((d) => ({ id: d.id, reasons: d.reasons })),
  unadjudicatedFailures: unadjudicated,
  blocked: blocked.map((b) => ({ id: b.id, evidence: b.evidence })),
  notRun,
  parentMustDo: [
    'Stage 11: run RCA on each confirmed regression, delegate the fix, then re-run this workflow. No partial passes.',
    'Blocked and not-run cases are not passes. Either make them runnable or record in the document why they cannot be automated.',
    'Manual cases (automatable: no) were reported, not executed. Run them by hand and record the outcome; they are never counted as passes.',
    'manualSteps holds the manual halves of `partly` cases that were split out - run them by hand too; they are never counted as passes.',
    'Dismissed failures still deserve a glance: a case dismissed as bad-test-case means the regression document needs an edit.',
  ],
}
