// Lane A verdict rows over the M-21 recordings (AC A-7..A-13, A-20, A-24; design §5.4). Pure: nothing
// here spawns. The recordings are real vitest 4.1.8 runs (fixtures/*.vitest.json and *.stdout.txt).
import { describe, test, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fileClasses,
  a7Check,
  a7bClause,
  judgeRun,
  numberCnjKeys,
  cnjCompare,
  readCnjBaseline,
  formatCnjBaseline,
  parseCnjBaseline,
} from './verdict.js';
import { extractCorpus } from './definitions.js';
import { EXIT_CODES } from './launchPolicy.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const ID = '0123456789abcdef0123456789abcdef';
const H = (c) => c.repeat(64);
// SGR colour sequences (ESC [ ... m); built from the code point so no control character sits in a regex literal.
const SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const DOWN = '↓';

function load(tag) {
  const record = JSON.parse(readFileSync(join(FIX, `${tag}.vitest.json`), 'utf8'));
  const stdout = readFileSync(join(FIX, `${tag}.stdout.txt`), 'utf8');
  const first = record.testResults[0].name.replace(/\\/g, '/');
  const root = first.slice(0, first.lastIndexOf('/hello-world/') + '/hello-world'.length);
  const files = record.testResults.map((t) => t.name.replace(/\\/g, '/').slice(root.length + 1)).sort();
  return { record, stdout, root, files };
}
const REC = { 'g24-runA': load('g24-runA'), g25: load('g25'), g28: load('g28') };
const fileOf = (tag, t) => REC[tag].files.find((f) => f.startsWith(`planted/${t}.`));
const entryOf = (tag, t) => REC[tag].record.testResults.find((e) => e.name.replace(/\\/g, '/').endsWith(`/${fileOf(tag, t)}`));

// AC A-7 (G24 run A under --allowOnly=false, G25, G28): the expected class of every recorded file.
const CLASSES = {
  'g24-runA': { p01: 'passed', p02: 'failed', p03: 'failed', p04: 'failed', p05: 'failed', p06: 'passed', p07: 'unclassified', p08: 'failed',
    p09: 'failed', p10: 'failed', p11: 'failed', p12: 'failed', p13: 'failed', p14: 'skipped', p15: 'skipped', p16: 'failed' },
  g25: { q01: 'passed', q02: 'passed', q03: 'unclassified' },
  g28: { t01: 'passed', t02: 'skipped', t03: 'unclassified', t04: 'unclassified', t05: 'skipped' },
};
const CLASS_ROWS = Object.entries(CLASSES).flatMap(([tag, m]) => Object.entries(m).map(([t, cls]) => [tag, t, cls]));
const EXTRA_BODIES = ['q01.pass.test.js.txt', 'q02.late.test.js.txt', 't01.pass.test.js.txt', 't04.killonly.test.js.txt'];

const block = (id, spans, { expected = 'The selected files pass.', summary = 'A planted case.' } = {}) =>
  `### ${id} | area: t | parallel-safe: yes | automatable: yes\n\n**Summary:** ${summary}\n\n**Steps:**\n${
    spans.map((s, i) => `${i + 1}. Run \`${s}\`.\n`).join('')}\n**Expected:** ${expected}\n\n`;
const corpus = (...blocks) => extractCorpus([{ file: 'docs/regression/t.md', content: blocks.join('') }]);
const judge = (tag, blocks, over = {}) => {
  const r = REC[tag];
  return judgeRun({
    corpus: corpus(...blocks), record: r.record, stdout: r.stdout, stderr: '', root: r.root, testFiles: r.files,
    selection: 'whole-suite', runId: ID, fpStart: H('a'), fpEnd: H('a'), baseline: { state: 'absent' }, facts: {}, ...over,
  });
};
const run = (tag, ...ts) => `npx vitest run ${ts.map((t) => fileOf(tag, t)).join(' ')}`;
const reasonOf = (fn) => {
  try {
    fn();
    return null;
  } catch (err) {
    return err.reason ?? 'thrown-without-reason';
  }
};

describe('M-21 provenance', () => {
  test('the four G25/G28 bodies outside the planted-red corpus exist: q01.pass.test.js.txt, q02.late.test.js.txt, t01.pass.test.js.txt, t04.killonly.test.js.txt', () => {
    for (const b of EXTRA_BODIES) expect(existsSync(join(FIX, 'planted-bodies', b))).toBe(true);
  });
  test.each(Object.keys(REC))('every file the %s recording names has its planted body, holding every recorded title', (tag) => {
    for (const f of REC[tag].files) {
      const base = f.slice('planted/'.length);
      const red = join(FIX, 'planted-red', 'hello-world', 'planted', `${base}.txt`);
      const p = existsSync(red) ? red : join(FIX, 'planted-bodies', `${base}.txt`);
      const body = readFileSync(p, 'utf8');
      for (const a of entryOf(tag, base.split('.')[0]).assertionResults) expect(body).toContain(a.title);
    }
  });
});

describe('A-7 file classes', () => {
  test.each(CLASS_ROWS)('A-7 class mapping over G24 run A / G25 / G28: %s %s -> %s', (tag, t, cls) => {
    const r = REC[tag];
    expect(fileClasses(r.record, r.stdout, r.root)[fileOf(tag, t)]).toBe(cls);
  });
  test.each(Object.keys(REC))('A-7: the class equality holds exactly on the %s recording', (tag) => {
    const r = REC[tag];
    expect(a7Check(r.record, r.stdout, r.root)).toMatchObject({ ok: true });
  });
  test('A-7: num*TestSuites is never read (18 vs 16) (T3-L10)', () => {
    const r = REC['g24-runA'];
    const bent = { ...r.record, numTotalTestSuites: 999, numPassedTestSuites: 999, numFailedTestSuites: 999, numPendingTestSuites: 999 };
    expect(fileClasses(bent, r.stdout, r.root)).toEqual(fileClasses(r.record, r.stdout, r.root));
    expect(a7Check(bent, r.stdout, r.root)).toMatchObject({ ok: true });
  });
  test('[canary] T3-R3: the ↓ module line is matched with its leading space (^\\s*↓) on the captured prefix', () => {
    const r = REC.g28;
    const line = r.stdout.split(/\r?\n/).map((l) => l.replace(SGR, '')).find((l) => l.includes(DOWN) && l.includes('t02.'));
    expect(line).toMatch(new RegExp(`^\\s+${DOWN}`));
    expect(fileClasses(r.record, r.stdout, r.root)[fileOf('g28', 't02')]).toBe('skipped');
  });
  test('A-7: with t02\'s ↓ line deleted, t02 is unclassified and the equality gives INCONCLUSIVE(d)', () => {
    const r = REC.g28;
    const cut = r.stdout.split('\n').filter((l) => !(l.includes(DOWN) && l.includes('t02.'))).join('\n');
    expect(fileClasses(r.record, cut, r.root)[fileOf('g28', 't02')]).toBe('unclassified');
    expect(a7Check(r.record, cut, r.root)).toEqual({ ok: false, reason: 'd' });
  });
  test('A-7: an Errors-free stream truncated before its Duration line gives INCONCLUSIVE(b), never 0', () => {
    const r = REC.g25;
    const cut = r.stdout.split('\n').filter((l) => !/^\s*(Errors|Duration)\s/.test(l.replace(SGR, ''))).join('\n');
    expect(a7Check(r.record, cut, r.root)).toEqual({ ok: false, reason: 'b' });
  });
});

describe('A-7b file-level failure', () => {
  const ROWS = [
    ['g24-runA', 'p07', 'ii'], ['g25', 'q03', 'iii'], ['g28', 't03', 'iii'], ['g28', 't04', 'iii'],
    ['g24-runA', 'p03', 'i'], ['g24-runA', 'p12', 'i'], ['g28', 't02', null], ['g28', 't05', null], ['g24-runA', 'p14', null], ['g24-runA', 'p01', null],
  ];
  test.each(ROWS)('A-7b fires on failed, non-final, or passed-0-tests-without-↓: %s %s -> %s (T3-L39)', (tag, t, clause) => {
    const r = REC[tag];
    const cls = fileClasses(r.record, r.stdout, r.root)[fileOf(tag, t)];
    expect(a7bClause(entryOf(tag, t), cls)).toBe(clause);
  });
});

describe('A-8..A-11 case states', () => {
  const L51 = [
    ['t02 alone is vacuous', ['t02'], 'vacuous'],
    ['t02 beside a passing file (t01; G28 records no p01) is pass', ['t01', 't02'], 'pass'],
    ['t03 stays unclassified and red', ['t03'], 'fail'],
    ['t04 stays unclassified and red', ['t04'], 'fail'],
  ];
  test.each(L51)('t02 alone is vacuous; t02 beside p01 is pass; t03 and t04 stay unclassified and red (T3-L51): %s', (_n, ts, state) => {
    expect(judge('g28', [block('R-101', [run('g28', ...ts)])]).cases['R-101'].state).toBe(state);
  });
  test('A-7b: a case selecting p07 is fail with one fail-file row naming the file', () => {
    const c = judge('g24-runA', [block('R-102', [run('g24-runA', 'p01', 'p07')])]).cases['R-102'];
    expect(c.state).toBe('fail');
    expect(c.rows.filter((x) => x.kind === 'fail-file').map((x) => x.cause)).toEqual([`file:${fileOf('g24-runA', 'p07')}`]);
  });
  test('A-8: no-match from a match count of 0, never the exit code; P is one element (T3-3b-5, T3-L6)', () => {
    const c = judge('g24-runA', [block('R-103', [`${run('g24-runA', 'p01')} -t "zzz nothing"`])]).cases['R-103'];
    expect(c.state).toBe('no-match');
    expect(c.rows).toEqual([expect.objectContaining({ kind: 'no-match', cause: 'pattern:zzz nothing' })]);
    const p01 = entryOf('g24-runA', 'p01').assertionResults[0].title;
    expect(judge('g24-runA', [block('R-104', [`${run('g24-runA', 'p01')} -t "${p01}"`])]).cases['R-104'].state).toBe('pass');
  });
  test.each([['p14'], ['p15']])('A-9 vacuous: %s alone is vacuous, never fail', (t) => {
    expect(judge('g24-runA', [block('R-105', [run('g24-runA', t)])]).cases['R-105'].state).toBe('vacuous');
  });
  test('A-10: R-007/R-009 only under whole-suite selection (T3-L11, T3-1b-5): a bare span under a union selection is not-covered', () => {
    const c = judge('g24-runA', [block('R-007', ['npx vitest run'])], { selection: 'union' }).cases['R-007'];
    expect(c.state).toBe('not-covered');
    expect(c.items).toEqual(['R-007|s1|k1|not-covered']);
  });
  test('A-10: under the whole-suite selection the bare span is judged, with no not-covered item', () => {
    const c = judge('g24-runA', [block('R-007', ['npx vitest run'])]).cases['R-007'];
    expect(c.items).toEqual([]);
    expect(c.state).not.toBe('not-covered');
  });
  test('A-11 state order (T3-L17): missing-paths outranks fail, and a two-reason case gives 2 rows and 2 keys', () => {
    const c = judge('g24-runA', [block('R-106', [`npx vitest run planted/p99.absent.test.js ${fileOf('g24-runA', 'p02')}`])]).cases['R-106'];
    expect(c.state).toBe('missing-paths');
    expect(c.rows.map((x) => x.kind).sort()).toEqual(['fail', 'missing-paths']);
    expect(new Set(c.rows.map((x) => x.key)).size).toBe(2);
  });
  test('A-11 (F10): a DEF-1u span plus a failing DEF-1 span gives fail, 1 DEF-16 row and 1 DEF-15 span item', () => {
    const c = judge('g24-runA', [block('R-107', [`cd hello-world; npx vitest run ${fileOf('g24-runA', 'p01')}`, run('g24-runA', 'p02')])]).cases['R-107'];
    expect(c.state).toBe('fail');
    expect(c.rows.length).toBe(1);
    expect(c.items).toEqual(['R-107|s1|k1|unsupported']);
  });
  test('A-11 (F10): a DEF-1u span plus a passing span gives unsupported', () => {
    const c = judge('g24-runA', [block('R-108', [`cd hello-world; npx vitest run ${fileOf('g24-runA', 'p01')}`, run('g24-runA', 'p01')])]).cases['R-108'];
    expect(c.state).toBe('unsupported');
  });
});

describe('A-12 INCONCLUSIVE reasons and A-13 exit codes', () => {
  const noTests = REC['g24-runA'].stdout.split('\n').filter((l) => !/^\s*Tests\s/.test(l.replace(SGR, ''))).join('\n');
  const one = [block('R-110', [run('g24-runA', 'p01')])];
  const ROWS = [
    ['a', 'no launcher run ID', one, { runId: null }],
    ['a', 'a spawn error', one, { facts: { spawnError: 'ENOENT' } }],
    ['b', 'no Tests line', one, { stdout: noTests }],
    ['c', 'a missing record', one, { record: null }],
    ['d', 'a selected file missing from the record', [block('R-111', ['npx vitest run planted/p97.ghost.test.js'])],
      { testFiles: [...REC['g24-runA'].files, 'planted/p97.ghost.test.js'] }],
    ['e', 'a timeout', one, { facts: { timedOut: true } }],
    ['f', 'an A-1 parity failure', one, { facts: { parityOk: false } }],
    ['g', 'a self-test failure', one, { facts: { selfTestOk: false } }],
    ['h', 'FP_END differs from FP_START', one, { fpEnd: H('b') }],
    ['h', 'FP_END not computable', one, { fpEnd: null }],
    ['h', 'FP_END and FP_START both not computable (T3-S9-13)', one, { fpStart: null, fpEnd: null }],
    ['j', 'an unreadable CNJ baseline', one, { baseline: { state: 'inconclusive', reason: 'j' } }],
  ];
  test.each(ROWS)('A-12 reasons (a)-(j): (%s) %s (T3-L18)', (letter, _n, blocks, over) => {
    const r = judge('g24-runA', blocks, over);
    expect(r.result).toBe('inconclusive');
    expect(r.reasons).toContain(letter);
    expect(r.exitCode).toBe(EXIT_CODES.inconclusive);
  });
  test('A-13: exit code 0 iff clean; no code equals a node runtime code (T3-H11, T3-L17)', () => {
    expect(EXIT_CODES.clean).toBe(0);
    const codes = [EXIT_CODES.dirty, EXIT_CODES.inconclusive, EXIT_CODES.selfTest];
    expect(new Set(codes).size).toBe(3);
    for (const c of codes) {
      expect(c).not.toBe(0);
      expect([1, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14]).not.toContain(c);
      expect(c).toBeLessThanOrEqual(128);
    }
  });
  test('A-13: a dirty run carries the dirty exit code', () => {
    const r = judge('g24-runA', [block('R-112', [run('g24-runA', 'p02')])]);
    expect(r.result).toBe('dirty');
    expect(r.exitCode).toBe(EXIT_CODES.dirty);
  });
});

describe('A-20 claims', () => {
  const p01 = entryOf('g24-runA', 'p01').assertionResults[0];
  const K2_P01 = [...p01.ancestorTitles, p01.title].join(' > ');
  const claim = (expected, t = 'p01') => judge('g24-runA', [block('R-120', [run('g24-runA', t)], { expected })]).cases['R-120'];
  test('A-20: count claims are judged only on a resolved scope: short -> count-short (T3-L15)', () => {
    const c = claim('3 tests pass.');
    expect(c.state).toBe('count-short');
    expect(c.rows).toEqual([expect.objectContaining({ kind: 'claim', cause: 'claim:R-120|k1|3 tests pass.' })]);
  });
  test('A-20: count claims are judged only on a resolved scope: above -> count-stale, an annotation only (T3-L15)', () => {
    const c = claim('1 test passes.');
    expect(c.state).toBe('pass');
    expect(c.claims.map((x) => x.outcome)).toEqual(['count-stale']);
  });
  test('A-20: count claims are judged only on a resolved scope: unresolved -> no verdict (T3-L15)', () => {
    const c = claim('In `planted/zz.absent.test.js`, 2 tests pass.');
    expect(c.state).toBe('pass');
    expect(c.claims.map((x) => x.outcome)).toEqual(['count-unresolved']);
    expect(c.items.length).toBe(1);
    expect(c.items[0].startsWith('R-120|k1|')).toBe(true);
  });
  test('A-20: count claims are judged only on a resolved scope: "at least N" with P >= N is satisfied, never red (T3-L15)', () => {
    const c = claim('At least 2 tests pass.');
    expect(c.state).toBe('pass');
    expect(c.claims.map((x) => x.outcome)).toEqual(['satisfied']);
  });
  test('A-20: K2/K3 claims over DEF-17 identities (T3-L16): p16\'s duplicate pair (one failed) is claim-fail', () => {
    const c = claim('`p16 grp > p16 same name` passes.', 'p16');
    expect(c.claims.map((x) => x.outcome)).toEqual(['claim-fail']);
    expect(c.rows).toContainEqual(expect.objectContaining({ kind: 'claim', cause: 'claim:R-120|k2|p16 grp > p16 same name' }));
  });
  test('A-20: K2 over DEF-17 identities: a passing identity is satisfied; an unknown one is claim-unmatched (T3-L16)', () => {
    expect(claim(`\`${K2_P01}\` passes.`).claims.map((x) => x.outcome)).toEqual(['satisfied']);
    const u = claim('`nope grp > nothing` passes.');
    expect(u.claims.map((x) => x.outcome)).toEqual(['claim-unmatched']);
    expect(u.items).toEqual(['R-120|k2|nope grp > nothing']);
  });
});

describe('orphan-fail (A-13)', () => {
  const r = judge('g24-runA', [block('R-130', [run('g24-runA', 'p01')])]);
  test('orphan-fail: a failed test counted by no judged-bad case (T3-L38)', () => {
    expect(r.orphans).toContainEqual(expect.objectContaining({ kind: 'orphan-test', cause: `test:${fileOf('g24-runA', 'p02')}|p02 fails#1` }));
    expect(r.result).toBe('dirty');
  });
  test('orphan-fail: an A-7b file with no case (p07) (T3-L38)', () => {
    expect(r.orphans).toContainEqual(expect.objectContaining({ kind: 'orphan-file', cause: `file:${fileOf('g24-runA', 'p07')}` }));
  });
  test('orphan-fail: Errors >= 1 gives error rows, never zero rows while the count is >= 1 (T3-L38; p06; T3-L5)', () => {
    expect(r.orphans.filter((x) => x.kind === 'orphan-error').length).toBeGreaterThanOrEqual(1);
    for (const x of r.orphans.filter((o) => o.kind === 'orphan-error')) expect(x.cause).toMatch(/^error:#[1-9][0-9]*$/);
  });
  test('orphan-fail: no double count: a failure its own judged-bad case counts is not an orphan', () => {
    const r2 = judge('g24-runA', [block('R-131', [run('g24-runA', 'p02')])]);
    expect(r2.orphans.filter((x) => x.cause.startsWith(`test:${fileOf('g24-runA', 'p02')}`))).toEqual([]);
  });
});

describe('A-24 and §5.4 CNJ baseline', () => {
  const X = { runId: ID, fp: H('c'), vitest: '4.1.8', keys: ['R-007|s1|k1|not-covered', 'R-009|s1|k1|not-covered'] };
  const text = formatCnjBaseline;
  test('A-24: a NEW item', () => {
    expect(cnjCompare(['a', 'b'], ['a'])).toEqual({ new: ['b'], gone: [] });
  });
  test('A-24: a GONE item', () => {
    expect(cnjCompare(['a'], ['a', 'b'])).toEqual({ new: [], gone: ['b'] });
  });
  test('A-24: one NEW and one GONE at an unchanged COUNT are both reported', () => {
    expect(cnjCompare(['a', 'c'], ['a', 'b'])).toEqual({ new: ['c'], gone: ['b'] });
  });
  test('A-24: duplicate item keys #2 are refused as non-unique', () => {
    expect(numberCnjKeys(['k', 'k', 'j', 'k'])).toEqual(['k', 'k#2', 'j', 'k#3']);
    expect(() => cnjCompare(['k', 'k'], [])).toThrow();
  });
  test('A-24: absent baseline -> CNJ_BASELINE=absent only on ENOENT (T3-L47: a fallback value needs its positive evidence)', () => {
    expect(readCnjBaseline({ error: { code: 'ENOENT' } })).toEqual({ state: 'absent' });
    expect(readCnjBaseline({ error: { code: 'EACCES' } })).toEqual({ state: 'inconclusive', reason: 'j' });
  });
  test('A-24: unreadable baseline -> INCONCLUSIVE(j) (a directory at the path)', () => {
    expect(readCnjBaseline({ error: { code: 'EISDIR' } })).toEqual({ state: 'inconclusive', reason: 'j' });
    expect(readCnjBaseline({ text: 'not a baseline\n' })).toEqual({ state: 'inconclusive', reason: 'j' });
    expect(readCnjBaseline({ text: text(X) })).toEqual({ state: 'present', baseline: X });
  });
  test('A-24: a fail case with a DEF-1u span keeps its span-keyed item and is still dispatched (T3-L8)', () => {
    const r = judge('g24-runA', [block('R-140', [`cd hello-world; npx vitest run ${fileOf('g24-runA', 'p01')}`, run('g24-runA', 'p02')])]);
    expect(r.cases['R-140'].state).toBe('fail');
    expect(r.cnj.items).toContain('R-140|s1|k1|unsupported');
  });
  const good = text(X);
  const BAD = [
    ['COUNT != body lines', good.replace('COUNT=2', 'COUNT=3')],
    ['a missing final newline', good.slice(0, -1)],
    ['a duplicate key', `${good.replace('COUNT=2', 'COUNT=3')}R-009|s1|k1|not-covered\n`],
    ['a bad line 1', good.replace('CNJ_BASELINE=v1', 'CNJ_BASELINE=v2')],
  ];
  test.each(BAD)('parseCnjBaseline: %s -> (j)', (_n, t) => {
    expect(reasonOf(() => parseCnjBaseline(t))).toBe('j');
  });
  test('parseCnjBaseline: a CRLF copy parses as the LF bytes', () => {
    expect(parseCnjBaseline(good.replace(/\n/g, '\r\n'))).toEqual(parseCnjBaseline(good));
  });
  test('COUNT=0 with an empty body parses', () => {
    expect(parseCnjBaseline(`CNJ_BASELINE=v1 RUN_ID=${ID} FP=${H('c')} VITEST=4.1.8 COUNT=0\n`)).toEqual({ runId: ID, fp: H('c'), vitest: '4.1.8', keys: [] });
  });
  test('formatCnjBaseline sorts by UTF-16 code unit, LF, final newline', () => {
    const t = text({ ...X, keys: ['a|k1|x', 'B|k1|x'] });
    expect(['a', 'B'].sort((p, q) => p.localeCompare(q))).toEqual(['a', 'B']);
    expect(t).toBe(`CNJ_BASELINE=v1 RUN_ID=${ID} FP=${H('c')} VITEST=4.1.8 COUNT=2\nB|k1|x\na|k1|x\n`);
  });
  test('format then parse round-trips', () => {
    expect(parseCnjBaseline(text(X))).toEqual(X);
  });
});
