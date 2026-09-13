// Lane A verdict rows (design §5.4; AC A-7..A-13, A-20, A-24). Pure.
import { selects, patternMatches, testIdentities, claimsOf } from './definitions.js';
import { EXIT_CODES } from './launchPolicy.js';

const SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const DOWN = '↓';
const stripSgr = (s) => s.replace(SGR, '');
const linesOf = (s) => s.split(/\r?\n/).map(stripSgr);

function hasDownLine(lines, relPath) {
  return lines.some((l) => new RegExp(`^\\s*${DOWN}`).test(l) && l.includes(relPath));
}

function relOf(name, root) {
  const n = name.replace(/\\/g, '/');
  const r = root.replace(/\\/g, '/');
  return n.startsWith(`${r}/`) ? n.slice(r.length + 1) : n;
}

// A-7: the pinned class mapping over a real vitest record and its default-reporter stdout.
export function fileClasses(record, stdout, root) {
  const lines = linesOf(stdout);
  const out = {};
  for (const entry of record.testResults) {
    const rel = relOf(entry.name, root);
    const statuses = (entry.assertionResults || []).map((a) => a.status);
    let cls;
    if (statuses.includes('failed') || entry.status === 'failed') cls = 'failed';
    else if (statuses.length > 0 && statuses.every((s) => s === 'skipped' || s === 'todo')) cls = 'skipped';
    else if (statuses.some((s) => s === 'passed')) cls = 'passed';
    else if (statuses.length === 0 && entry.status === 'passed' && hasDownLine(lines, rel)) cls = 'skipped';
    else cls = 'unclassified';
    out[rel] = cls;
  }
  return out;
}

// A-7: the class equality against vitest's own Test Files summary line.
export function a7Check(record, stdout, root) {
  const lines = linesOf(stdout);
  if (!lines.some((l) => /^\s*Duration\s/.test(l))) return { ok: false, reason: 'b' };
  const tfLine = lines.find((l) => /^\s*Test Files\s/.test(l));
  if (!tfLine) return { ok: false, reason: 'b' };
  const totalM = /\((\d+)\)/.exec(tfLine);
  if (!totalM) return { ok: false, reason: 'b' };
  const total = Number(totalM[1]);
  const num = (re) => Number((re.exec(tfLine) || [0, 0])[1]) || 0;
  const passed = num(/(\d+)\s+passed/);
  const failed = num(/(\d+)\s+failed/);
  const skipped = num(/(\d+)\s+skipped/);
  const classes = fileClasses(record, stdout, root);
  const values = Object.values(classes);
  if (values.length !== total) return { ok: false, reason: 'd' };
  const tally = { passed: 0, failed: 0, skipped: 0, unclassified: 0 };
  for (const c of values) tally[c] += 1;
  if (tally.passed !== passed || tally.failed !== failed || tally.skipped !== skipped) return { ok: false, reason: 'd' };
  if (tally.unclassified !== total - passed - failed - skipped) return { ok: false, reason: 'd' };
  return { ok: true };
}

const FINAL_STATUSES = new Set(['passed', 'failed', 'skipped', 'todo']);

// A-7b: fires on failed, non-final, or passed-0-tests-without-DOWN.
export function a7bClause(entry, cls) {
  if (entry.status === 'failed') return 'i';
  const statuses = (entry.assertionResults || []).map((a) => a.status);
  if (statuses.some((s) => !FINAL_STATUSES.has(s))) return 'ii';
  if (statuses.length === 0 && entry.status === 'passed' && cls !== 'skipped') return 'iii';
  return null;
}

function fileVerdict(entry, cls) {
  const failedTests = (entry.assertionResults || []).filter((a) => a.status === 'failed');
  if (failedTests.length > 0) return { kind: 'per-test', tests: failedTests };
  if (a7bClause(entry, cls) !== null) return { kind: 'fail-file' };
  return { kind: 'clean' };
}

function errorCount(stdout) {
  const line = linesOf(stdout).find((l) => /^\s*Errors\s/.test(l));
  if (!line) return 0;
  const m = /(\d+)\s+error/.exec(line);
  return m ? Number(m[1]) : 0;
}

function hasTestsLine(stdout) {
  return linesOf(stdout).some((l) => /^\s*Tests\s/.test(l));
}

function selectedFilesOfSpan(span, testFiles) {
  if (span.filters.length === 0) return [...testFiles];
  return [...new Set(span.filters.flatMap((f) => selects(f, testFiles)))];
}

function allSelectedFiles(corpus, testFiles) {
  const set = new Set();
  for (const c of corpus.cases) {
    for (const step of c.steps) {
      for (const span of step.spans) {
        if (span.kind !== 'DEF-1') continue;
        if (span.filters.length === 0 && !span.pattern) continue;
        for (const f of selectedFilesOfSpan(span, testFiles)) set.add(f);
      }
    }
    for (const d7 of c.def7) {
      if (d7.filters.length === 0) continue;
      for (const f of selectedFilesOfSpan(d7, testFiles)) set.add(f);
    }
  }
  return set;
}

function judgeCase(c, ctx) {
  const rows = [];
  const items = [];
  const claims = [];
  let anyScoped = false;
  let anyCountedPass = false;
  let anyMissingPaths = false;
  let anyNoMatch = false;
  let anyUnsupported = false;
  let anyNotCovered = false;
  let firstScopedKey = null;
  const caseSelected = new Set();

  c.steps.forEach((step, si) => {
    step.spans.forEach((span, wi) => {
      const keyBase = `${c.id}|s${si + 1}|k${wi + 1}`;
      if (span.kind === 'DEF-1u') {
        items.push(`${keyBase}|unsupported`);
        anyUnsupported = true;
        return;
      }
      const bare = span.filters.length === 0 && !span.pattern;
      if (bare) {
        if (ctx.selection === 'union') {
          items.push(`${keyBase}|not-covered`);
          anyNotCovered = true;
        }
        return;
      }
      anyScoped = true;
      if (firstScopedKey === null) firstScopedKey = keyBase;
      for (const filt of span.filters) {
        const matches = selects(filt, ctx.testFiles);
        if (matches.length === 0) {
          rows.push({ kind: 'missing-paths', cause: `filter:${filt}`, key: `${keyBase}|missing-paths` });
          anyMissingPaths = true;
        }
      }
      const scopeFiles = selectedFilesOfSpan(span, ctx.testFiles);
      for (const f of scopeFiles) caseSelected.add(f);
      let matchCount = 0;
      let countedCount = 0;
      for (const file of scopeFiles) {
        const entry = ctx.recordByFile.get(file);
        if (!entry) continue;
        const assertions = entry.assertionResults || [];
        const inScope = span.pattern ? assertions.filter((a) => patternMatches(span.pattern, a)) : assertions;
        matchCount += inScope.length;
        countedCount += inScope.filter((a) => a.status !== 'skipped' && a.status !== 'todo').length;
        const fv = fileVerdict(entry, ctx.classes[file]);
        if (fv.kind === 'per-test') {
          const ids = testIdentities(file, assertions);
          for (const t of fv.tests) {
            if (span.pattern && !patternMatches(span.pattern, t)) continue;
            const idx = assertions.indexOf(t);
            rows.push({ kind: 'fail', cause: `test:${ids[idx]}`, key: `${keyBase}|fail|${ids[idx]}` });
          }
        } else if (fv.kind === 'fail-file') {
          rows.push({ kind: 'fail-file', cause: `file:${file}`, key: `${keyBase}|fail-file|${file}` });
        }
      }
      if (span.pattern && matchCount === 0) {
        rows.push({ kind: 'no-match', cause: `pattern:${span.pattern}`, key: `${keyBase}|no-match` });
        anyNoMatch = true;
      } else if (countedCount > 0) {
        anyCountedPass = true;
      }
    });
  });

  // A-20: claims, judged against the case's own resolved scope. k1 = count claims (K1), k2 = a
  // named-test claim (K2): a fixed class label, not a per-case sequence number.
  const claimList = claimsOf(c.expectedText);
  claimList.forEach((claim) => {
    const k = claim.kind === 'count' ? 'k1' : 'k2';
    if (claim.kind === 'count') {
      const scope = claim.scope ? selects(claim.scope, ctx.testFiles) : [...caseSelected];
      if (scope.length === 0) {
        claims.push({ outcome: 'count-unresolved' });
        items.push(`${c.id}|${k}|count-unresolved`);
        return;
      }
      let actual = 0;
      for (const f of scope) {
        const entry = ctx.recordByFile.get(f);
        if (!entry) continue;
        actual += (entry.assertionResults || []).filter((a) => a.status === 'passed').length;
      }
      if (claim.atLeast) {
        if (actual >= claim.n) claims.push({ outcome: 'satisfied' });
        else {
          claims.push({ outcome: 'count-short' });
          rows.push({ kind: 'claim', cause: `claim:${c.id}|${k}|${claim.text}`, key: `${c.id}|claim|${k}|count-short` });
        }
      } else if (actual < claim.n) {
        claims.push({ outcome: 'count-short' });
        rows.push({ kind: 'claim', cause: `claim:${c.id}|${k}|${claim.text}`, key: `${c.id}|claim|${k}|count-short` });
      } else if (actual > claim.n) {
        claims.push({ outcome: 'count-stale' });
      } else {
        claims.push({ outcome: 'satisfied' });
      }
    } else {
      const scope = [...caseSelected];
      const matches = [];
      for (const f of scope) {
        const entry = ctx.recordByFile.get(f);
        if (!entry) continue;
        for (const a of entry.assertionResults || []) {
          if ([...a.ancestorTitles, a.title].join(' > ') === claim.name) matches.push(a);
        }
      }
      if (matches.length === 0) {
        claims.push({ outcome: 'claim-unmatched' });
        items.push(`${c.id}|${k}|${claim.name}`);
      } else if (matches.some((a) => a.status === 'failed')) {
        claims.push({ outcome: 'claim-fail' });
        rows.push({ kind: 'claim', cause: `claim:${c.id}|${k}|${claim.name}`, key: `${c.id}|claim|${k}|claim-fail` });
      } else {
        claims.push({ outcome: 'satisfied' });
      }
    }
  });

  let state;
  const kinds = new Set(rows.map((r) => r.kind));
  if (anyMissingPaths) state = 'missing-paths';
  else if (kinds.has('fail') || kinds.has('fail-file')) state = 'fail';
  else if (anyNoMatch) state = 'no-match';
  else if (kinds.has('claim') && rows.some((r) => r.key.endsWith('count-short'))) state = 'count-short';
  else if (kinds.has('claim') && rows.some((r) => r.key.endsWith('claim-fail'))) state = 'claim-fail';
  else if (anyScoped && !anyCountedPass) {
    state = 'vacuous';
    rows.push({ kind: 'vacuous', cause: `case:${firstScopedKey}`, key: `${firstScopedKey}|vacuous` });
  } else if (anyUnsupported) state = 'unsupported';
  else if (anyNotCovered) state = 'not-covered';
  else state = 'pass';

  return { id: c.id, state, rows, items, claims, selectedFiles: caseSelected };
}

function numberCnj(keys) {
  const counts = new Map();
  return keys.map((k) => {
    const n = (counts.get(k) || 0) + 1;
    counts.set(k, n);
    return n === 1 ? k : `${k}#${n}`;
  });
}

// A-6..A-13, A-20: judge one bucket-b run against its corpus.
export function judgeRun({ corpus, record, stdout, stderr, root, testFiles, selection, runId, fpStart, fpEnd, baseline, facts = {} }) {
  const inconclusive = (letter) => ({
    result: 'inconclusive', reasons: [letter], exitCode: EXIT_CODES.inconclusive, cases: {}, orphans: [], cnj: { items: [] },
  });
  // A-1 parity and a timeout are decided before ever trusting stdout/record: a parity refusal or a
  // kill means vitest was never meaningfully run, so there is no real Tests line or record to read.
  if (runId === null || facts.spawnError) return inconclusive('a');
  if (facts.parityOk === false) return inconclusive('f');
  if (facts.timedOut) return inconclusive('e');
  if (!hasTestsLine(stdout)) return inconclusive('b');
  if (record === null) return inconclusive('c');
  const recordByFile = new Map(record.testResults.map((e) => [relOf(e.name, root), e]));
  const selectedUnion = allSelectedFiles(corpus, testFiles);
  for (const f of selectedUnion) if (!recordByFile.has(f)) return inconclusive('d');
  if (facts.selfTestOk === false) return inconclusive('g');
  if (fpEnd === null || fpEnd !== fpStart) return inconclusive('h');
  if (baseline.state === 'inconclusive') return inconclusive('j');

  const classes = fileClasses(record, stdout, root);
  const ctx = { testFiles, classes, recordByFile, selection };
  const cases = {};
  const allItems = [];
  const claimedTests = new Set();
  const claimedFiles = new Set();
  const def7ByFile = new Map();
  for (const c of corpus.cases) {
    const r = judgeCase(c, ctx);
    cases[c.id] = r;
    for (const row of r.rows) {
      if (row.kind === 'fail') claimedTests.add(row.cause.slice('test:'.length));
      if (row.kind === 'fail-file') claimedFiles.add(row.cause.slice('file:'.length));
    }
    allItems.push(...r.items);
    for (const d7 of c.def7) {
      for (const f of selectedFilesOfSpan(d7, ctx.testFiles)) {
        if (!def7ByFile.has(f)) def7ByFile.set(f, []);
        def7ByFile.get(f).push(d7.command);
      }
    }
  }
  const spanFor = (file) => (def7ByFile.has(file) ? def7ByFile.get(file)[0] : null);

  const orphans = [];
  for (const [file, entry] of recordByFile) {
    const fv = fileVerdict(entry, classes[file]);
    if (fv.kind === 'per-test') {
      const ids = testIdentities(file, entry.assertionResults || []);
      fv.tests.forEach((t) => {
        const idx = (entry.assertionResults || []).indexOf(t);
        const id = ids[idx];
        if (!claimedTests.has(id)) orphans.push({ kind: 'orphan-test', cause: `test:${id}`, span: spanFor(file) });
      });
    } else if (fv.kind === 'fail-file' && !claimedFiles.has(file)) {
      orphans.push({ kind: 'orphan-file', cause: `file:${file}`, span: spanFor(file) });
    }
  }
  const nErrors = errorCount(stdout);
  for (let i = 1; i <= nErrors; i += 1) orphans.push({ kind: 'orphan-error', cause: `error:#${i}` });

  const anyDirty = Object.values(cases).some((c) => c.state !== 'pass' && c.state !== 'unsupported' && c.state !== 'not-covered')
    || orphans.length > 0;
  const result = anyDirty ? 'dirty' : 'clean';

  return {
    result,
    reasons: [],
    exitCode: result === 'dirty' ? EXIT_CODES.dirty : EXIT_CODES.clean,
    cases,
    orphans,
    cnj: { items: numberCnj(allItems) },
  };
}

// A-24: CNJ baseline comparison and the ONE format/parse pair.
export function numberCnjKeys(keys) {
  return numberCnj(keys);
}

export function cnjCompare(newKeys, oldKeys) {
  if (new Set(newKeys).size !== newKeys.length) throw new Error('cnjCompare: newKeys must be unique');
  const oldSet = new Set(oldKeys);
  const newSet = new Set(newKeys);
  return {
    new: newKeys.filter((k) => !oldSet.has(k)),
    gone: oldKeys.filter((k) => !newSet.has(k)),
  };
}

export function readCnjBaseline(read) {
  if (read.error) return read.error.code === 'ENOENT' ? { state: 'absent' } : { state: 'inconclusive', reason: 'j' };
  try {
    return { state: 'present', baseline: parseCnjBaseline(read.text) };
  } catch {
    return { state: 'inconclusive', reason: 'j' };
  }
}

export function formatCnjBaseline({ runId, fp, vitest, keys }) {
  const sorted = [...keys].sort();
  return `CNJ_BASELINE=v1 RUN_ID=${runId} FP=${fp} VITEST=${vitest} COUNT=${sorted.length}\n${sorted.map((k) => `${k}\n`).join('')}`;
}

export function parseCnjBaseline(text) {
  const bad = () => Object.assign(new Error('parseCnjBaseline: malformed'), { reason: 'j' });
  const t = text.replace(/\r\n/g, '\n');
  if (!t.endsWith('\n')) throw bad();
  const lines = t.slice(0, -1).split('\n');
  const m = /^CNJ_BASELINE=v1 RUN_ID=([0-9a-f]{32}) FP=([0-9a-f]{64}) VITEST=(\S+) COUNT=(\d+)$/.exec(lines[0]);
  if (!m) throw bad();
  const body = lines.slice(1);
  if (body.length !== Number(m[4])) throw bad();
  if (new Set(body).size !== body.length) throw bad();
  return { runId: m[1], fp: m[2], vitest: m[3], keys: body };
}
