export const meta = {
  name: 'stage9-unit-tests',
  description: 'Stage 9: write unit tests for each enumerated unit, run them, then prove they can fail by mutating the source',
  whenToUse: 'After stage 8, once every acceptance criterion passes. The parent enumerates the units from the diff and supplies per-unit notes as args.units.',
  phases: [
    { title: 'Write tests', detail: 'one implementer agent per unit' },
    { title: 'Suite', detail: 'run the full suite and fix fallout' },
    { title: 'Mutation', detail: 'sabotage each unit in turn, confirm its tests fail, restore' },
  ],
}

// Stage 9 of the development loop. Feature-agnostic: everything specific to the
// work under test arrives through args. This script delegates writing, running,
// and mutation-proving only. It never touches product code itself, never fixes
// implementation bugs (that is stage 7), and never runs git.
//
// args: {
//   units: [{ name, sourceFile, testFile?, notes, publicApi? }],  // required
//   cwd?: string,           // default "hello-world"
//   testCommand?: string,   // default "npx vitest run"
//   lintCommand?: string,   // default "npx eslint"
//   implModel?: string,     // default "sonnet"
//   mutationModel?: string, // default = implModel
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
const cwd = input.cwd || 'hello-world'
const testCommand = input.testCommand || 'npx vitest run'
const lintCommand = input.lintCommand || 'npx eslint'
const implModel = input.implModel || 'sonnet'
const mutationModel = input.mutationModel || implModel
const units = Array.isArray(input.units) ? input.units : []

if (units.length === 0) {
  return {
    ok: false,
    error: 'No units supplied. Pass args.units = [{ name, sourceFile, notes }] enumerated from the diff.',
  }
}

if (units.length > 12) {
  log(`WARNING: ${units.length} units supplied. Agent-count guidance is 15 per workflow; consider splitting this into two runs.`)
}

const RULES = [
  'HARD RULES - violating any of these fails the task:',
  '- Do NOT run any git command. No add, commit, push, checkout, stash, restore, branch, or reset.',
  '- Do NOT modify any file outside the ones named in your assignment.',
  '- NEVER edit a file with a shell command. No sed -i, no perl -i, no > or >> redirection onto a source file, no truncate. Use the Edit tool only, so every change is visible and reviewable. An in-place shell edit that goes wrong is unrecoverable and invisible.',
  '- No emojis anywhere: not in code, not in comments, not in test names, not in your output.',
  '- No eslint-disable comments. No "as any".',
  '- Every file you touch must stay under 1000 lines.',
  '- Match the surrounding code style, naming, and comment density.',
  '- Report honestly. If something does not pass, say so plainly; do not describe partial work as complete.',
].join('\n')

const TEST_RESULT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    unit: { type: 'string' },
    testFile: { type: 'string', description: 'repo-relative path of the test file written' },
    testCount: { type: 'number' },
    passing: { type: 'boolean' },
    summary: { type: 'string', description: 'what behaviors are covered, one line each' },
    blockers: { type: 'string', description: 'empty string if none' },
  },
  required: ['unit', 'testFile', 'testCount', 'passing', 'summary'],
}

const SUITE_RESULT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    lintClean: { type: 'boolean' },
    suitePassing: { type: 'boolean' },
    totalTests: { type: 'number' },
    failures: { type: 'array', items: { type: 'string' } },
    filesTouched: { type: 'array', items: { type: 'string' } },
    detail: { type: 'string' },
  },
  required: ['lintClean', 'suitePassing', 'totalTests', 'failures', 'detail'],
}

const MUTATION_RESULT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          unit: { type: 'string' },
          mutation: { type: 'string', description: 'the exact behavioral change introduced' },
          testsFailedAsExpected: { type: 'boolean' },
          failingTestNames: { type: 'array', items: { type: 'string' } },
          restored: { type: 'boolean' },
          detail: { type: 'string' },
        },
        required: ['unit', 'mutation', 'testsFailedAsExpected', 'restored', 'detail'],
      },
    },
    allRestored: { type: 'boolean', description: 'true only if every mutated file was returned to its exact original content' },
    detail: { type: 'string' },
  },
  required: ['results', 'allRestored', 'detail'],
}

function unitBlock(u, i) {
  return [
    `Unit ${i + 1}: ${u.name || u.sourceFile}`,
    `Source file: ${u.sourceFile}`,
    u.testFile ? `Write the tests to: ${u.testFile}` : 'Choose a test path that matches this repo\'s existing convention for the source file.',
    u.publicApi ? `Public surface to cover: ${u.publicApi}` : '',
    'Notes from the diff review (these define what must be covered):',
    String(u.notes || '(none supplied)'),
  ].filter(Boolean).join('\n')
}

phase('Write tests')
const written = await parallel(
  units.map((u, i) => () =>
    agent(
      [
        'You are writing unit tests for one specific unit of newly written code.',
        '',
        RULES,
        '',
        `Working directory: ${cwd} (run all commands from there).`,
        '',
        unitBlock(u, i),
        '',
        'How to work:',
        '1. Read the source file first, plus its call sites, so the tests assert real behavior rather than restating the implementation.',
        '2. Follow the existing test conventions in this repo (framework, import style, file naming). Read a neighboring test file before writing.',
        '3. Cover the behaviors in the notes: the happy path, each branch, boundary values, and the failure modes. Assert observable outcomes, not internal calls.',
        '4. Every test must be capable of failing: assert specific values, never merely that a function did not throw. Avoid snapshot-only tests.',
        '5. Do not modify the source file. If the unit looks untestable without a change, stop and report it in blockers instead of editing product code.',
        '5b. Do NOT sabotage the source to check that your test can fail, not even temporarily and not even if you intend to restore it. That is the mutation phase\'s job and it runs under a capture-and-restore protocol you do not have here. Deleting a safety constraint from a production prompt to watch a test go red risks shipping that deletion. Reason about whether your assertion could fail instead.',
        `6. Run only your own test file until it passes: ${testCommand} <your test file>`,
        `7. Then run ${lintCommand} <your test file> and leave it with zero errors and zero warnings.`,
        '',
        'Return the structured result. Set passing=false and describe the problem in blockers if you could not get it green.',
      ].join('\n'),
      { label: `test:${u.name || `unit${i + 1}`}`, phase: 'Write tests', model: implModel, schema: TEST_RESULT },
    ),
  ),
)

const testFiles = written.filter(Boolean).map((r) => r.testFile).filter(Boolean)
const failedToWrite = written.filter(Boolean).filter((r) => !r.passing)
const died = written.filter((r) => !r).length
if (died > 0) log(`WARNING: ${died} test-writing agent(s) returned nothing and were dropped.`)
log(`Wrote ${testFiles.length} test file(s); ${failedToWrite.length} reported not passing.`)

phase('Suite')
const suite = await agent(
  [
    'You are running the full test suite after new unit tests were added, and fixing fallout in the TEST files only.',
    '',
    RULES,
    '- Do NOT change product code to make a test pass. If a test fails because the product is wrong, report it; that is the parent\'s call, not yours.',
    '',
    `Working directory: ${cwd}`,
    `Test command: ${testCommand}`,
    `Lint command: ${lintCommand}`,
    '',
    `New test files just added:\n${testFiles.map((f) => `- ${f}`).join('\n') || '(none)'}`,
    '',
    'Steps:',
    `1. Run ${testCommand} for the whole project.`,
    '2. If a NEW test fails because the test itself is wrong (bad expectation, wrong import, missing setup), fix the test file.',
    '3. If a failure indicates the product code is actually wrong, leave it alone and list it in failures with the reasoning.',
    '4. If a PRE-EXISTING test broke, that is a regression: do not paper over it, list it in failures.',
    `5. Finish with ${lintCommand} over the new test files: zero errors, zero warnings.`,
    '',
    'Return the structured result with the real numbers from the final run.',
  ].join('\n'),
  { label: 'suite', phase: 'Suite', model: implModel, schema: SUITE_RESULT },
)

phase('Mutation')
const mutation = await agent(
  [
    'You are proving that a set of unit tests can actually fail. This is a controlled sabotage pass.',
    '',
    RULES,
    '',
    `Working directory: ${cwd}`,
    `Test command: ${testCommand}`,
    '',
    'Units and their test files:',
    units
      .map((u, i) => {
        const w = written[i]
        return `- ${u.name || u.sourceFile}: source ${u.sourceFile}, tests ${(w && w.testFile) || u.testFile || 'unknown'}`
      })
      .join('\n'),
    '',
    'Work through the units STRICTLY ONE AT A TIME. Never have two units mutated at once; the suite would be unreadable.',
    'For each unit:',
    '1. Read the source file and copy its exact original content into your working memory before changing anything.',
    '2. Introduce ONE targeted behavioral break in the source: invert a condition, drop a clamp, return the wrong branch, off-by-one a boundary. Do not just delete the file or introduce a syntax error; a syntax error proves nothing about assertions.',
    `3. Run only that unit's test file: ${testCommand} <test file>.`,
    '4. Record whether the tests failed and which test names failed. If they all still pass, the tests are not real; record testsFailedAsExpected=false with the mutation you tried.',
    '5. RESTORE the source file to its exact original content immediately, before moving to the next unit. This is mandatory even if the run errored.',
    '6. Re-run that test file and confirm it is green again before continuing.',
    '',
    'CRITICAL: when you are completely finished, every source file must be byte-identical to how you found it. The only acceptable end state is a fully restored tree. Do not use git to restore; write the original content back with the file tools.',
    `Finally, run ${testCommand} once more over the whole project and confirm it is green, proving nothing was left mutated.`,
    '',
    'Return the structured result. Set allRestored=false if any file could not be returned to its original content, and say exactly which one in detail.',
  ].join('\n'),
  { label: 'mutation-check', phase: 'Mutation', model: mutationModel, schema: MUTATION_RESULT },
)

const weakTests = (mutation && mutation.results ? mutation.results : []).filter((r) => !r.testsFailedAsExpected)

return {
  ok:
    failedToWrite.length === 0 &&
    !!suite &&
    suite.suitePassing &&
    suite.lintClean &&
    !!mutation &&
    mutation.allRestored &&
    weakTests.length === 0,
  unitsRequested: units.length,
  testFiles,
  notPassing: failedToWrite.map((r) => ({ unit: r.unit, blockers: r.blockers || '' })),
  suite: suite || null,
  mutation: mutation || null,
  weakTests: weakTests.map((r) => ({ unit: r.unit, mutation: r.mutation, detail: r.detail })),
  parentMustVerify: [
    'Run git status --short and git diff: confirm only intended test files changed and no source file was left mutated.',
    'Spot-read at least one new test file: are the assertions real, or restatements of the implementation?',
    'Any entry in weakTests means those tests cannot fail and must be rewritten before stage 10.',
  ],
}
