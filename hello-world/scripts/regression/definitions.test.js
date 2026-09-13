// Lane A definition rows (AC §3 DEF-*, A-2, A-3, A-17; design §8.2 fs spy, §11.1-§11.4). Pure, except the
// hermetic parity describe (a corpusOnly planted root: no git, no junction, no spawn) and the fs-spy root.
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { extractCorpus, selects, patternMatches, testIdentities } from './definitions.js';
import { judgeRun } from './verdict.js';
import { corpusRows, parseIntegrityRows, compareParity, parseArgs } from './corpusRows.js';
import { materializePlantedRepo, removePlantedRepo } from './plantedRepo.js';

const { readFileSync, readdirSync, existsSync } = fs;
const { dirname, join, resolve } = path;
const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixtures');
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const ID = '0123456789abcdef0123456789abcdef';
const H = (c) => c.repeat(64);
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const BT = '`';

const block = (id, steps, { expected = 'The selected files pass.', summary = 'A case.', tail = '' } = {}) =>
  `### ${id} | area: t | parallel-safe: yes | automatable: yes\n\n**Summary:** ${summary}\n\n**Steps:**\n${
    steps.map((s, i) => `${i + 1}. Run ${BT}${s}${BT}.\n`).join('')}\n**Expected:** ${expected}\n${tail}\n`;
const one = (text) => extractCorpus([{ file: 'docs/regression/t.md', content: text }]);
const spansOf = (c) => c.steps.flatMap((s) => s.spans);

describe('DEF-1 and DEF-1u', () => {
  test('DEF-1: "cd hello-world && npx vitest run" is DEF-1; any other prefix is DEF-1u(a) (C-2, T3-L3)', () => {
    const c = one(block('R-001', ['cd hello-world && npx vitest run lib/x.test.js', 'cd hello-world; npx vitest run lib/x.test.js'])).cases[0];
    const [a, b] = spansOf(c);
    expect(a).toMatchObject({ kind: 'DEF-1', filters: ['lib/x.test.js'], pattern: null });
    expect(b).toMatchObject({ kind: 'DEF-1u', reason: 'a' });
  });
  const U = [
    ['b', 'a pipe', 'npx vitest run lib/x.test.js | more'],
    ['d', 'an unknown flag', 'npx vitest run lib/x.test.js --reporter=verbose'],
    ['e', 'an unbalanced quote', 'npx vitest run lib/x.test.js -t "abc'],
    ['f', 'a filter with neither / nor .', 'npx vitest run speaker'],
  ];
  test.each(U)('DEF-1u(%s): %s', (reason, _n, span) => {
    expect(spansOf(one(block('R-002', [span])).cases[0])[0]).toMatchObject({ kind: 'DEF-1u', reason });
  });
  test('DEF-1: a double-quoted -t value keeps its spaces and is one pattern', () => {
    expect(spansOf(one(block('R-003', ['npx vitest run kb/speaker.test.js -t "speaker labels"'])).cases[0])[0])
      .toMatchObject({ kind: 'DEF-1', filters: ['kb/speaker.test.js'], pattern: 'speaker labels' });
  });
});

describe('A-2, A-3, DEF-10, A-17', () => {
  const text =
    block('R-010', ['npx vitest run lib/a.test.js', 'cd hello-world; npx vitest run lib/b.test.js'],
      { summary: `See ${BT}npx vitest run lib/c.test.js${BT} for the old form.`, expected: 'It passes; npx vitest run is named here in prose.' }) +
    block('R-011', ['npx vitest run lib/d.test.js']);
  test('A-2: every raw occurrence is classified and the classes sum to the raw count (T3-L4)', () => {
    const o = one(text).occurrences;
    expect(o).toEqual({ raw: 5, 'DEF-1': 2, 'DEF-1u': 1, 'DEF-7': 1, 'DEF-8': 1 });
  });
  test('DEF-7 and DEF-8 carry no case state; a DEF-7-only failure is a run-level orphan-fail row naming that block (A-3, T3-L5)', () => {
    const c = one(text).cases[0];
    expect(c.def7.map((s) => s.filters)).toEqual([['lib/c.test.js']]);
    expect(spansOf(c).some((s) => s.filters?.includes('lib/c.test.js'))).toBe(false);
    // Over G24 run A: the Steps select p01; p02 is named only by a DEF-7 span, and its failure is an orphan row.
    const record = JSON.parse(readFileSync(join(FIX, 'g24-runA.vitest.json'), 'utf8'));
    const stdout = readFileSync(join(FIX, 'g24-runA.stdout.txt'), 'utf8');
    const first = record.testResults[0].name.replace(/\\/g, '/');
    const root = first.slice(0, first.lastIndexOf('/hello-world/') + '/hello-world'.length);
    const files = record.testResults.map((t) => t.name.replace(/\\/g, '/').slice(root.length + 1));
    const p01 = files.find((f) => f.startsWith('planted/p01.'));
    const p02 = files.find((f) => f.startsWith('planted/p02.'));
    const corpus = one(block('R-012', [`npx vitest run ${p01}`], { summary: `Also ${BT}npx vitest run ${p02}${BT} outside Steps.` }));
    const r = judgeRun({ corpus, record, stdout, stderr: '', root, testFiles: files, selection: 'whole-suite', runId: ID,
      fpStart: H('a'), fpEnd: H('a'), baseline: { state: 'absent' }, facts: {} });
    expect(r.cases['R-012'].state).toBe('pass');
    const row = r.orphans.find((x) => x.kind === 'orphan-test' && x.cause === `test:${p02}|p02 fails#1`);
    expect(row).toBeDefined();
    expect(row.span).toContain(p02);
  });
  test('DEF-10: the Expected region runs to the next ### R- line or EOF (T3-L14)', () => {
    const t = block('R-020', ['npx vitest run lib/a.test.js'], { expected: 'First.', tail: '\n## Notes\nStill expected.\n' }) + block('R-021', ['npx vitest run lib/b.test.js'], { expected: 'Last.', tail: '\nTrailing.' });
    const [a, b] = one(t).cases;
    expect(a.expectedText).toContain('Still expected.');
    expect(a.expectedText).not.toContain('R-021');
    expect(b.expectedText).toContain('Trailing.');
  });
  test('A-17: a CRLF corpus extracts identically', () => {
    const lf = one(text);
    const crlf = one(text.replace(/\n/g, '\r\n'));
    expect(crlf.cases.map((c) => [c.id, spansOf(c), c.def7, c.expectedText])).toEqual(lf.cases.map((c) => [c.id, spansOf(c), c.def7, c.expectedText]));
    expect(crlf.occurrences).toEqual(lf.occurrences);
  });
});

describe('§11.1-§11.2 selection and matching', () => {
  const FILES = ['grp/one.test.js', 'kb/speaker.test.js'];
  test('selects: win32 rule, slashes normalised, case-folded substring (§11.2): case-folded', () => {
    expect(selects('GRP/One.test.js', FILES)).toEqual(['grp/one.test.js']);
  });
  test('selects: win32 rule, slashes normalised, case-folded substring (§11.2): slashes normalised', () => {
    expect(selects('grp/one', ['grp\\one.test.js', 'kb\\speaker.test.js'])).toEqual(['grp\\one.test.js']);
  });
  test('selects: win32 rule, slashes normalised, case-folded substring (§11.2): substring', () => {
    expect(selects('one', FILES)).toEqual(['grp/one.test.js']);
    expect(selects('zz', FILES)).toEqual([]);
  });
  // A minimal record in vitest's JSON shape (3b V10-V13's names); fullName is deliberately misleading.
  const REC = [{ name: 'C:/r/hello-world/a.test.js', assertionResults: [{ ancestorTitles: ['outer', 'inner'], title: 'alpha', fullName: 'a.test.js zz', status: 'passed' }] }];
  const count = (p) => REC.flatMap((f) => f.assertionResults).filter((t) => patternMatches(p, t)).length;
  test.each([['outer inner', 1], ['outer > inner', 0], ['^outer inner alpha$', 1], ['a.test.js', 0]])(
    'patternMatches over one recorded JSON: %j -> %d (§11.3, 3b V10-V13, N-56)', (p, n) => {
      expect(count(p)).toBe(n);
    },
  );
  test('DEF-17: file + ancestorTitles + title joined by " > " + #n; fullName is never parsed (T3-L44)', () => {
    const record = JSON.parse(readFileSync(join(FIX, 'g24-runA.vitest.json'), 'utf8'));
    const p16 = record.testResults.find((t) => t.name.includes('p16.'));
    const ids = testIdentities('planted/p16.dupname.test.js', p16.assertionResults);
    expect(ids).toEqual(['planted/p16.dupname.test.js|p16 grp > p16 same name#1', 'planted/p16.dupname.test.js|p16 grp > p16 same name#2']);
    const bent = p16.assertionResults.map((a) => ({ ...a, fullName: 'garbage > name' }));
    expect(testIdentities('planted/p16.dupname.test.js', bent)).toEqual(ids);
  });
});

describe('corpus parity (hermetic)', () => {
  let root;
  let saved;
  let extract;
  const rowsOf = (text) => text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.startsWith('{')).map((l) => {
    const o = JSON.parse(l);
    return { file: o.file, cases: o.cases };
  });
  const rewrite = (text, fn) => text.replace(/\r\n/g, '\n').split('\n').map((l) => (l.startsWith('{') ? fn(JSON.parse(l)) : l)).filter((l) => l !== null).join('\n');
  const moved = () => rewrite(saved, (o) => {
    if (o.file.endsWith('alpha.md')) return JSON.stringify({ ...o, cases: o.cases.slice(0, -1) });
    if (o.file.endsWith('beta.md')) return JSON.stringify({ ...o, cases: [...o.cases, 'R-002'] });
    return JSON.stringify(o);
  });
  // Same case-ID SET as alpha.md, reversed order - membership is unchanged, only the sequence differs.
  // `moved()` above changes which file each ID belongs to; this changes nothing but the order within
  // one file, the one input shape §11.4 4/7's own fixtures never construct (T3-S9-5/T3-S9-8).
  const reordered = () => rewrite(saved, (o) => (o.file.endsWith('alpha.md') ? JSON.stringify({ ...o, cases: [...o.cases].reverse() }) : JSON.stringify(o)));
  beforeAll(async () => {
    root = materializePlantedRepo({ entries: [], corpusOnly: true }).root;
    saved = readFileSync(join(FIX, 'integrity-rows.planted.ndjson'), 'utf8');
    extract = await corpusRows({ root });
  });
  afterAll(() => {
    if (root) removePlantedRepo(root);
  });
  test('[must-hit] exactly two integrity-* fixtures, and the script hash matches the repository\'s script (§11.4 1)', () => {
    expect(readdirSync(FIX).filter((n) => n.startsWith('integrity-')).sort()).toEqual(['integrity-rows.planted.ndjson', 'integrity-script.sha256.txt']);
    const line = readFileSync(join(FIX, 'integrity-script.sha256.txt'), 'utf8');
    expect(line).toMatch(/^INTEGRITY_SCRIPT_SHA256=[0-9a-f]{64}\r?\n?$/);
    const want = sha256(readFileSync(join(REPO_ROOT, 'scripts', 'regression-integrity.sh'), 'utf8').replace(/\r\n/g, '\n'));
    expect(line.trim().slice('INTEGRITY_SCRIPT_SHA256='.length)).toBe(want);
  });
  test('saved rows have the script\'s stdout shape (§11.4 2)', () => {
    const ls = saved.replace(/\r\n/g, '\n').split('\n').filter((l) => l !== '');
    const rows = ls.filter((l) => l.startsWith('{'));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const r of rows) {
      const o = JSON.parse(r);
      expect(typeof o.file).toBe('string');
      expect(Array.isArray(o.cases)).toBe(true);
    }
    const rest = ls.slice(rows.length);
    expect(rest.length).toBe(4);
    expect(rest[0]).toMatch(/^GRANDFATHERED=\d+$/);
    expect(rest[1]).toMatch(/^YES_MANUAL_SMELL=\d+$/);
    expect(rest[2]).toMatch(/^YES_WITH_MARKER=\d+$/);
    expect(rest[3]).toMatch(/^FILES=([1-9][0-9]*) CASES=([1-9][0-9]*)$/);
  });
  test('FILES and CASES match the rows and the planted .md count (§11.4 3)', () => {
    const rows = rowsOf(saved);
    const [, files, cases] = /FILES=(\d+) CASES=(\d+)/.exec(saved);
    const md = readdirSync(join(root, 'docs', 'regression'), { withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith('.md'));
    expect(Number(files)).toBe(rows.length);
    expect(Number(files)).toBe(md.length);
    expect(Number(cases)).toBe(rows.reduce((n, r) => n + r.cases.length, 0));
  });
  test.each([['docs/regression/alpha.md'], ['docs/regression/beta.md']])('corpusRows equals the saved rows per file, in order: %s (§11.4 4)', (file) => {
    expect(extract.rows.find((r) => r.file === file)).toEqual(rowsOf(saved).find((r) => r.file === file));
    expect(extract.rows.map((r) => r.file)).toEqual(rowsOf(saved).map((r) => r.file));
    expect(`FILES=${extract.totals.files} CASES=${extract.totals.cases}`).toBe(/FILES=\d+ CASES=\d+/.exec(saved)[0]);
  });
  test('the CRLF, short-header and non-.md shapes are present; the script copy is byte-equal (§11.4 5)', () => {
    expect(readFileSync(join(root, 'docs', 'regression', 'beta.md'), 'latin1').includes('\r\n')).toBe(true);
    expect(readFileSync(join(root, 'docs', 'regression', 'alpha.md'), 'utf8')).toMatch(/^### R-003 \| area: alpha\s*$/m);
    expect(rowsOf(saved).some((r) => r.cases.includes('R-003'))).toBe(false);
    expect(existsSync(join(root, 'docs', 'regression', 'notes.txt'))).toBe(true);
    expect(rowsOf(saved).some((r) => r.file.endsWith('notes.txt'))).toBe(false);
    expect(readFileSync(join(root, 'scripts', 'regression-integrity.sh')).equals(readFileSync(join(REPO_ROOT, 'scripts', 'regression-integrity.sh')))).toBe(true);
  });
  test('[canary] a moved ID fails the per-file comparison (§11.4 6)', () => {
    expect(rowsOf(moved())).not.toEqual(extract.rows);
    expect(/FILES=\d+ CASES=\d+/.exec(moved())[0]).toBe(/FILES=\d+ CASES=\d+/.exec(saved)[0]);
  });
  test('--compare: ok / moved-ID / deleted-row / no-totals-line (§11.4 7): ok', () => {
    const out = compareParity(parseIntegrityRows(saved), extract);
    expect(out[0]).toBe('PARITY=ok');
    expect(out.filter((l) => l.startsWith('DIFF'))).toEqual([]);
    expect(out.slice(-2)).toEqual([`SCRIPT_TOTALS=FILES=${extract.totals.files} CASES=${extract.totals.cases}`, `EXTRACT_TOTALS=FILES=${extract.totals.files} CASES=${extract.totals.cases}`]);
  });
  test('--compare: ok / moved-ID / deleted-row / no-totals-line (§11.4 7): moved-ID', () => {
    const out = compareParity(parseIntegrityRows(moved()), extract);
    expect(out[0]).toBe('PARITY=mismatch');
    const diffs = out.filter((l) => l.startsWith('DIFF'));
    expect(diffs.length).toBe(2);
    expect(diffs[0]).toMatch(/^DIFF cases file=docs\/regression\/alpha\.md script=/);
    expect(diffs[1]).toMatch(/^DIFF cases file=docs\/regression\/beta\.md script=/);
  });
  test('a same-membership reorder within one file is a real difference, not equal cases (§11.4 4, T3-S9-5)', () => {
    const alphaReordered = rowsOf(reordered()).find((r) => r.file === 'docs/regression/alpha.md');
    const alphaExtract = extract.rows.find((r) => r.file === 'docs/regression/alpha.md');
    expect(new Set(alphaReordered.cases)).toEqual(new Set(alphaExtract.cases));
    expect(alphaReordered.cases).not.toEqual(alphaExtract.cases);
  });
  test('--compare: a same-membership reorder within one file is DIFF cases, never PARITY=ok (§11.4 7, T3-S9-5/T3-S9-8)', () => {
    const out = compareParity(parseIntegrityRows(reordered()), extract);
    expect(out[0]).toBe('PARITY=mismatch');
    const diffs = out.filter((l) => l.startsWith('DIFF'));
    expect(diffs).toEqual(['DIFF cases file=docs/regression/alpha.md script=R-002,R-001 extract=R-001,R-002']);
  });
  test('--compare: ok / moved-ID / deleted-row / no-totals-line (§11.4 7): deleted-row', () => {
    const out = compareParity(parseIntegrityRows(rewrite(saved, (o) => (o.file.endsWith('beta.md') ? null : JSON.stringify(o)))), extract);
    expect(out[0]).toBe('PARITY=mismatch');
    expect(out.filter((l) => l.startsWith('DIFF'))).toEqual(['DIFF only-extract file=docs/regression/beta.md', 'DIFF totals']);
  });
  test('--compare: ok / moved-ID / deleted-row / no-totals-line (§11.4 7): no-totals-line', () => {
    const out = compareParity(parseIntegrityRows(saved.replace(/^FILES=.*$/m, '')), extract);
    expect(out[0]).toBe('PARITY=mismatch');
    expect(out.filter((l) => l.startsWith('DIFF'))).toEqual(['DIFF input no-totals-line']);
    expect(out[out.length - 2]).toBe('SCRIPT_TOTALS=-');
  });
  test.each([[['--compare']], [['--compare=x']], [['--comapre', 'x']]])('corpusRows argv: --compare without value, --compare=x, --comapre x are errors (§1 entry shape, T3-2-2): %j', (argv) => {
    expect(parseArgs(argv).ok).toBe(false);
  });
});

describe('§8.2 fs spy', () => {
  // Every §8.2 token and a token through the builder's node_modules junction sit in Steps spans.
  const TOKENS = ['--config=./evil.config.mjs', '-uc', '../x.test.js', 'C:x.test.js', 'C:1', 'D:123', '\\\\host\\s\\x', '/abs/x.test.js',
    'lib/x.test.js:12', 'lib/x.test.js::$DATA', 'a:b/x.test.js', 'lib/(whoami)/x.test.js', 'node_modules/vitest/secret.test.js'];
  const QUOTED = ['lib/x.test.js.', 'lib/x.test.js '];
  const md = `### R-500 | area: tokens | parallel-safe: yes | automatable: yes\n\n**Summary:** Every refused token.\n\n**Steps:**\n${
    [...TOKENS, ...QUOTED.map((t) => `"${t}"`)].map((t, i) => `${i + 1}. Run ${BT}npx vitest run ${t}${BT}.\n`).join('')}\n**Expected:** Nothing runs.\n`;
  let P;
  const calls = [];
  const spy = (mod, name) => new Proxy(mod, {
    get(target, prop) {
      const v = target[prop];
      if (typeof v !== 'function') return v;
      return (...args) => {
        calls.push({ fn: `${name}.${String(prop)}`, args });
        return v.apply(target, args);
      };
    },
  });
  const flat = (a) => (Array.isArray(a) ? a.flatMap(flat) : typeof a === 'string' ? [a] : a instanceof URL ? [a.href] : []);
  beforeAll(async () => {
    P = materializePlantedRepo({ entries: [], files: { 'docs/regression/tokens.md': md } });
    await corpusRows({ root: P.root }, { fs: spy(fs, 'fs'), path: spy(path, 'path') });
  }, 60000);
  afterAll(() => {
    if (P) removePlantedRepo(P.root);
  });
  test('fs spy: 0 fs/path calls carry any §8.2 token, the junction, the ADS token, C:x, a trailing dot, a trailing space or name:NN (§8.2, R4-2, T3-1g-5)', () => {
    const bad = calls.filter((c) => flat(c.args).some((s) => [...TOKENS, ...QUOTED].some((t) => s.includes(t))));
    expect(bad).toEqual([]);
  });
  test('[canary] fs spy: the corpus read is seen', () => {
    expect(calls.some((c) => c.fn.startsWith('fs.') && flat(c.args).some((s) => s.replace(/\\/g, '/').endsWith('docs/regression/tokens.md')))).toBe(true);
  });
});
