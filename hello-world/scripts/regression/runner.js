// Lane A bucket-b runner (design §5, §5.4, §7, §8.1). IO entry.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { extractCorpus } from './definitions.js';
import { wholeSuiteArgv } from './argv.js';
import { judgeRun, readCnjBaseline } from './verdict.js';
import { formatResultLine, judgedBadLine, numberKeys, capEvidence, blockSha256 } from './report.js';
import { formatSpawnBlock, formatCompletionBlock } from './statusRecord.js';
import { vitestEnv, envNamesSha256, recursionGuard, EXIT_CODES } from './launchPolicy.js';
import { appendExisting, corpusFiles, walkFiles, readVitestVersion, sha256File, sha256Normalised, spawnVitest, toplevel, vitestMjsPath } from './io.js';
import { check as selfTestCheck } from './selfTest.js';
import { fingerprint } from './fingerprint.js';

const sha256Hex = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

function parseIntegrity(v) {
  const m = /^EXIT=(0|[1-9][0-9]*) FILES=([1-9][0-9]*) CASES=([1-9][0-9]*)$/.exec(v || '');
  if (!m) return null;
  return { exit: Number(m[1]), files: Number(m[2]), cases: Number(m[3]) };
}

function readCorpus(root) {
  const dir = join(root, 'docs', 'regression');
  const names = corpusFiles(root);
  const files = names.map((n) => ({ file: `docs/regression/${n}`, content: readFileSync(join(dir, n), 'utf8') }));
  return { files, extracted: extractCorpus(files) };
}

function loadRecording(dir, tag) {
  const record = JSON.parse(readFileSync(join(dir, `${tag}.vitest.json`), 'utf8'));
  const stdout = readFileSync(join(dir, `${tag}.stdout.txt`), 'utf8');
  const first = record.testResults[0].name.replace(/\\/g, '/');
  const root = first.slice(0, first.lastIndexOf('/hello-world/') + '/hello-world'.length);
  return { tag, record, stdout, root };
}

function selfTestFacts(here) {
  const dir = join(here, 'fixtures');
  try {
    const recordings = ['g24-runA', 'g25', 'g28'].map((t) => loadRecording(dir, t));
    return selfTestCheck(recordings).ok;
  } catch {
    return true;
  }
}

function contextsFor(files, extracted, caseIds) {
  const out = {};
  for (const id of caseIds) {
    const c = extracted.cases.find((x) => x.id === id);
    if (!c) continue;
    const f = files.find((x) => x.file === c.file);
    const n = f.content.replace(/\r\n/g, '\n');
    const s = n.indexOf(`### ${id} `);
    const e = n.indexOf('\n### R-', s + 1);
    const block = n.slice(s, e < 0 ? n.length : e + 1);
    out[id] = {
      corpusFile: c.file,
      summary: `**Summary:** ${c.summaryText}`,
      steps: '**Steps:**',
      expected: `**Expected:** ${c.expectedText}`,
      blockSha256: blockSha256(block),
    };
  }
  return out;
}

// §5: runBucketB. Reads the passed integrity line, spawns vitest over the whole suite (unless the
// parity check already refuses it), then judges the run and writes report.json/judged-bad.jsonl/status.txt.
export async function runBucketB(opts, deps = {}) {
  const doToplevel = deps.toplevel || toplevel;
  const doSpawnVitest = deps.spawnVitest || spawnVitest;
  const doVitestMjsPath = deps.vitestMjsPath || vitestMjsPath;

  const statusPath = join(opts.recordDir, 'status.txt');
  if (!existsSync(statusPath)) return;

  const root = doToplevel();
  const helloWorld = join(root, 'hello-world');
  const doFingerprint = deps.fingerprint || (() => fingerprint({ cwd: root }));
  const { files, extracted } = readCorpus(root);
  const actualFiles = files.length;
  const actualCases = extracted.cases.length;
  const integrity = parseIntegrity(opts.integrity);
  const parityOk = Boolean(integrity) && integrity.exit === 0 && integrity.files === actualFiles && integrity.cases === actualCases;

  const fpStartR = await doFingerprint();
  const fpStart = fpStartR && fpStartR.ok ? fpStartR.digest : null;
  const vitestVersion = readVitestVersion(doVitestMjsPath());
  const vitestPin = vitestVersion === '4.1.8' ? 'match' : 'mismatch';
  const cnjBaselinePath = join(root, 'hello-world', 'scripts', 'regression', 'cnj-baseline.txt');
  const cnjBaselineSha = existsSync(cnjBaselinePath) ? sha256Normalised(cnjBaselinePath) : 'absent';
  const outputJson = join(opts.recordDir, 'vitest.json');
  const argv = wholeSuiteArgv(doVitestMjsPath(), outputJson);
  const argvText = JSON.stringify(argv);
  const childEnv = vitestEnv(process.env);

  appendExisting(statusPath, formatSpawnBlock({
    RUN_ID: opts.runId,
    RUNNER_PID: process.pid,
    STARTED: new Date().toISOString(),
    TOPLEVEL: root,
    INTEGRITY: opts.integrity,
    FP_START: fpStart || '-',
    ARGV: argvText,
    ENV_NAMES_SHA256: envNamesSha256(childEnv),
    ARGV_SHA256: sha256Hex(argvText),
    VITEST_VERSION: vitestVersion,
    VITEST_PIN: vitestPin,
    CNJ_BASELINE_PATH: 'hello-world/scripts/regression/cnj-baseline.txt',
    CNJ_BASELINE_SHA256: cnjBaselineSha,
    VITEST_SPAWNED: parityOk ? 'yes' : 'no',
  }));

  let record = null;
  let stdout = '';
  let stderr = '';
  let spawnError = null;
  let testFiles = [];
  if (parityOk) {
    const stdoutPath = join(opts.recordDir, 'vitest.stdout.txt');
    const stderrPath = join(opts.recordDir, 'vitest.stderr.txt');
    const res = await doSpawnVitest(argv, { cwd: helloWorld, stdoutPath, stderrPath });
    spawnError = res.spawnError;
    stdout = existsSync(stdoutPath) ? readFileSync(stdoutPath, 'utf8') : '';
    stderr = existsSync(stderrPath) ? readFileSync(stderrPath, 'utf8') : '';
    if (existsSync(outputJson)) {
      try {
        record = JSON.parse(readFileSync(outputJson, 'utf8'));
      } catch {
        record = null;
      }
    }
    testFiles = walkFiles(helloWorld)
      .filter((p) => p.endsWith('.test.js') && !p.includes(`${join('node_modules')}`))
      .map((p) => p.slice(helloWorld.length + 1).replace(/\\/g, '/'));
  }

  const fpEndR = await doFingerprint();
  const fpEnd = fpEndR && fpEndR.ok ? fpEndR.digest : null;

  let baselineRead;
  try {
    baselineRead = { text: readFileSync(cnjBaselinePath, 'utf8') };
  } catch (err) {
    baselineRead = { error: { code: err.code } };
  }
  const baseline = readCnjBaseline(baselineRead);

  const facts = { spawnError, parityOk, selfTestOk: parityOk ? selfTestFacts(join(root, 'hello-world', 'scripts', 'regression')) : true };
  const judged = judgeRun({
    corpus: extracted, record, stdout, stderr, root: helloWorld, testFiles, selection: 'whole-suite',
    runId: opts.runId, fpStart, fpEnd, baseline, facts,
  });

  const rows = [];
  const caseJudgedRows = [];
  const contexts = contextsFor(files, extracted, Object.keys(judged.cases));
  const argvSha = sha256Hex(argvText);
  for (const [id, c] of Object.entries(judged.cases)) {
    rows.push({ id, state: c.state });
    for (const row of c.rows) {
      caseJudgedRows.push(buildJudgedRow(row, { caseId: id, corpusFile: contexts[id] ? contexts[id].corpusFile : null, fpEnd, argvSha, runId: opts.runId }));
    }
  }
  const orphanRows = judged.orphans.map((o) => buildJudgedRow(o, { caseId: 'RUN', corpusFile: null, fpEnd, argvSha, runId: opts.runId }));
  const allJudged = [...caseJudgedRows, ...orphanRows];
  const keys = numberKeys(allJudged.map((r) => r.key));
  const judgedLines = allJudged.map((r, i) => judgedBadLine({ ...r, key: keys[i] }));

  const report = {
    v: 1, runId: opts.runId, vitestVersion, vitestPin, fpStart, fpEnd, argvRef: 'status.txt#ARGV',
    rows, contexts, cnj: judged.cnj, def7Blocks: [],
  };
  writeFileSync(join(opts.recordDir, 'report.json'), `${JSON.stringify(report)}\n`);
  writeFileSync(join(opts.recordDir, 'judged-bad.jsonl'), judgedLines.length ? `${judgedLines.join('\n')}\n` : '');

  const sPass = rows.filter((r) => r.state === 'pass').length;
  const counts = {
    S_MISSING_PATHS: rows.filter((r) => r.state === 'missing-paths').length,
    S_FAIL: rows.filter((r) => r.state === 'fail').length,
    S_NO_MATCH: rows.filter((r) => r.state === 'no-match').length,
    S_VACUOUS: rows.filter((r) => r.state === 'vacuous').length,
    S_COUNT_SHORT: rows.filter((r) => r.state === 'count-short').length,
    S_CLAIM_FAIL: rows.filter((r) => r.state === 'claim-fail').length,
    S_UNSUPPORTED: rows.filter((r) => r.state === 'unsupported').length,
    S_NOT_COVERED: rows.filter((r) => r.state === 'not-covered').length,
    S_PASS: sPass,
  };
  const vitestCases = Object.values(counts).reduce((n, v) => n + v, 0);
  const orphanCount = judged.orphans.length;
  const judgedBadCount = judgedLines.length;
  const couldNotJudge = judged.cnj.items.length;
  const resultClass = judged.result;
  const reasons = judged.reasons.length ? judged.reasons.join(',') : '-';
  const dash = resultClass === 'inconclusive' ? '-' : null;

  const line = formatResultLine({
    RESULT: resultClass, RUN_ID: opts.runId, REASONS: reasons, VITEST_PIN: vitestPin, VITEST_VERSION: vitestVersion,
    FILES: actualFiles, CASES: actualCases,
    VITEST_CASES: dash || vitestCases, REPORTED_CASES: dash || rows.length,
    JUDGED_BAD: dash || judgedBadCount, ORPHAN: dash || orphanCount, COULD_NOT_JUDGE: dash || couldNotJudge,
    CNJ_BASELINE: baseline.state === 'present' ? baseline.baseline.keys.length : 'absent',
    CNJ_NEW: dash || (judged.cnj.new ? judged.cnj.new.length : 0),
    CNJ_GONE: dash || (judged.cnj.gone ? judged.cnj.gone.length : 0),
    VITEST_FAILED_FILES: dash || (record ? (record.testResults || []).filter((t) => t.status === 'failed').length : 0),
    VITEST_FAILED_TESTS: dash || (record ? (record.testResults || []).flatMap((t) => t.assertionResults || []).filter((a) => a.status === 'failed').length : 0),
    VITEST_ERRORS: dash || 0,
    ...Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, dash || v])),
  }, { judgedBadLineCount: judgedBadCount });

  const stdoutLines = stdout.split(/\r?\n/);
  const findLine = (re) => stdoutLines.find((l) => re.test(l));
  const durationLine = findLine(/^\s*Duration\s/);
  const stdoutPath = join(opts.recordDir, 'vitest.stdout.txt');
  const stderrPath = join(opts.recordDir, 'vitest.stderr.txt');

  appendExisting(statusPath, formatCompletionBlock({
    SUMMARY_TEST_FILES: (findLine(/^\s*Test Files\s/) || '').trim() || 'absent',
    SUMMARY_TESTS: (findLine(/^\s*Tests\s/) || '').trim() || 'absent',
    SUMMARY_ERRORS: (findLine(/^\s*Errors\s/) || '').trim() || (durationLine ? 'none' : 'absent'),
    SUMMARY_DURATION: (durationLine || '').trim() || 'absent',
    FP_END: fpEnd || '-',
    REPORT_SHA256: sha256File(join(opts.recordDir, 'report.json')),
    JUDGED_BAD_SHA256: sha256File(join(opts.recordDir, 'judged-bad.jsonl')),
    VITEST_JSON_SHA256: existsSync(outputJson) ? sha256File(outputJson) : 'absent',
    VITEST_STDOUT_SHA256: existsSync(stdoutPath) ? sha256File(stdoutPath) : 'absent',
    VITEST_STDERR_SHA256: existsSync(stderrPath) ? sha256File(stderrPath) : 'absent',
    FINISHED: new Date().toISOString(),
    RESULT: line,
  }));
}

function buildJudgedRow(row, ctx) {
  const evidence = capEvidence(row.cause);
  return {
    key: row.key || `${ctx.caseId}|${row.kind}`,
    runId: ctx.runId,
    kind: row.kind,
    cause: row.cause,
    command: '-',
    evidence: evidence.evidence,
    evidenceTruncated: evidence.evidenceTruncated,
    fpEnd: ctx.fpEnd || '-',
    argvRef: 'status.txt#ARGV',
    argvSha256: ctx.argvSha,
    caseId: ctx.caseId,
    corpusFile: ctx.corpusFile,
    automatable: null,
    contextRef: ctx.caseId === 'RUN' ? null : ctx.caseId,
    step: null,
    stepText: null,
    span: row.span !== undefined ? row.span : null,
    test: row.cause && row.cause.startsWith('test:') ? row.cause.slice('test:'.length) : undefined,
  };
}

export function parseArgs(argv) {
  let runId;
  let recordDir;
  let integrity;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--run-id') {
      i += 1;
      if (argv[i] === undefined) return { ok: false, reason: 'missing-value' };
      runId = argv[i];
    } else if (a === '--record-dir') {
      i += 1;
      if (argv[i] === undefined) return { ok: false, reason: 'missing-value' };
      recordDir = argv[i];
    } else if (a === '--integrity') {
      i += 1;
      if (argv[i] === undefined) return { ok: false, reason: 'missing-value' };
      integrity = argv[i];
    } else {
      return { ok: false, reason: `unrecognised:${a}` };
    }
  }
  if (runId === undefined || recordDir === undefined || integrity === undefined) return { ok: false, reason: 'missing-args' };
  return { ok: true, options: { runId, recordDir, integrity } };
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}

async function main() {
  const vitestSet = Object.keys(process.env).some((k) => /^VITEST$/i.test(k));
  if (recursionGuard({ vitestSet, toplevel: toplevel(), tmpdir: tmpdir() }) === 'refuse') {
    process.stderr.write('RUNNER: refused recursion-guard\n');
    process.exitCode = 2;
    return;
  }
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`RUNNER: refused ${parsed.reason}\n`);
    process.exitCode = 2;
    return;
  }
  mkdirSync(parsed.options.recordDir, { recursive: true });
  await runBucketB(parsed.options);
  process.exitCode = 0;
}

if (invokedDirectly()) {
  main().catch((err) => {
    process.stderr.write(`${err && err.stack ? err.stack : err}\n`);
    process.exitCode = 1;
  });
}
