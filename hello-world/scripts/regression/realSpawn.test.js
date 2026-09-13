// Lane A real-spawn rows (design §11.3 semantics oracle, §8.1 sentinels, §11.5 and AC D-6(viii), A-6, A-7b,
// A-19). Every spawn target is under a materializePlantedRepo root; vitest is 4.1.8 through its junction.
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { caseArgv, wholeSuiteArgv, classifyToken, checkPattern } from './argv.js';
import { selects, patternMatches } from './definitions.js';
import { fileClasses } from './verdict.js';
import { vitestEnv } from './launchPolicy.js';
import { fingerprint } from './fingerprint.js';
import { materializePlantedRepo, removePlantedRepo } from './plantedRepo.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixtures');
const EXPECTED = JSON.parse(readFileSync(join(HERE, 'plantedExpected.json'), 'utf8'));
const entry = (p, name) => join(p.entryDir, `${name}.js`);
const scratch = [];
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'rt-t3-fixture-'));
  scratch.push(d);
  return d;
};
const relOf = (name, root) => name.replace(/\\/g, '/').slice(root.replace(/\\/g, '/').length + 1);
function vitestRun(p, argv) {
  const json = join(tmp(), 'vitest.json');
  const r = spawnSync(process.execPath, [...argv, `--outputFile.json=${json}`], { cwd: p.helloWorld, env: vitestEnv(process.env), encoding: 'utf8', timeout: 240000, windowsHide: true });
  return { status: r.status, stdout: r.stdout, record: existsSync(json) ? JSON.parse(readFileSync(json, 'utf8')) : null };
}

describe('§11.3 semantics oracle', () => {
  let P;
  let VM;
  const FILES = ['grp/one.test.js', 'kb/speaker.test.js'];
  beforeAll(() => {
    P = materializePlantedRepo({
      entries: [],
      files: {
        'hello-world/grp/one.test.js': readFileSync(join(FIX, 'planted-bodies', 'grp-one.test.txt')),
        'hello-world/kb/speaker.test.js': readFileSync(join(FIX, 'planted-bodies', 'kb-speaker.test.txt')),
        'hello-world/evil.config.mjs': "import { writeFileSync } from 'node:fs';\nwriteFileSync(new URL('./evil-config.marker', import.meta.url), 'x');\nexport default {};\n",
        'hello-world/evil-reporter.mjs': "import { writeFileSync } from 'node:fs';\nwriteFileSync(new URL('./evil-reporter.marker', import.meta.url), 'x');\nexport default class R {}\n",
      },
    });
    VM = join(P.helloWorld, 'node_modules', 'vitest', 'vitest.mjs');
  }, 120000);
  afterAll(() => {
    if (P) removePlantedRepo(P.root);
  });
  const ORACLE = [
    ['O-1', { filters: [], pattern: 'grp one' }, FILES, ['grp > one two']],
    ['O-2', { filters: [], pattern: 'speaker labels' }, FILES, ['renders speaker labels']],
    ['O-3', { filters: ['GRP/One.test.js'], pattern: 'GRP one' }, ['grp/one.test.js'], []],
    ['O-4', { filters: [], pattern: 'grp.one' }, FILES, ['grp > one two']],
    ['O-5', { filters: ['grp/one'], pattern: 'solo' }, ['grp/one.test.js'], ['solo top']],
  ];
  const results = {};
  const runOf = (id, span) => {
    if (!results[id]) results[id] = vitestRun(P, caseArgv(span, VM));
    return results[id];
  };
  const simFiles = (span) => [...new Set(span.filters.length ? span.filters.flatMap((f) => selects(f, FILES)) : FILES)].sort();
  const simTests = (record) => record.testResults.flatMap((f) => f.assertionResults.filter((a) => patternMatches(ORACLE_P, a)).map((a) => [...a.ancestorTitles, a.title].join(' > ')));
  let ORACLE_P = '';
  test.each(ORACLE)('oracle %s: run files = selects\' simulation', { timeout: 240000 }, (id, span, files) => {
    const r = runOf(id, span);
    const ran = r.record.testResults.map((t) => relOf(t.name, P.helloWorld)).sort();
    expect(ran).toEqual(simFiles(span));
    expect(ran).toEqual([...files].sort());
  });
  test.each(ORACLE)('oracle %s: non-skipped tests = DEF-6a\'s simulation', { timeout: 240000 }, (id, span, _files, counted) => {
    const r = runOf(id, span);
    const ran = r.record.testResults.flatMap((f) => f.assertionResults.filter((a) => a.status !== 'skipped' && a.status !== 'todo').map((a) => [...a.ancestorTitles, a.title].join(' > '))).sort();
    ORACLE_P = span.pattern;
    expect(ran).toEqual(simTests(r.record).sort());
    expect(ran).toEqual([...counted].sort());
  });
  const REFUSALS = [['^grp', 'P'], ['grp > one', 'P'], ['(a+)+$', 'P'], ['(', 'P'], ['lib/x.test.js:12', 'filter'], ['lib/', 'filter']];
  test.each(REFUSALS)('refusal: %j (%s) -> DEF-1u, 0 spawns', (tok, kind) => {
    const span = kind === 'P' ? { filters: ['grp/one.test.js'], pattern: tok } : { filters: [tok], pattern: null };
    expect(kind === 'P' ? checkPattern(tok) : classifyToken(tok)).toBe('DEF-1u');
    expect(caseArgv(span, VM)).toBeNull();
  });
  test('evil --config= and --reporter= spans leave their markers absent; a direct --config= spawn writes its marker (positive control, §8.1)', { timeout: 240000 }, () => {
    for (const tok of ['--config=./evil.config.mjs', '--reporter=./evil-reporter.mjs']) expect(caseArgv({ filters: [tok], pattern: null }, VM)).toBeNull();
    expect(existsSync(join(P.helloWorld, 'evil-config.marker'))).toBe(false);
    expect(existsSync(join(P.helloWorld, 'evil-reporter.marker'))).toBe(false);
    spawnSync(process.execPath, [VM, 'run', '--config=./evil.config.mjs', 'kb/speaker.test.js'], { cwd: P.helloWorld, env: vitestEnv(process.env), timeout: 240000, windowsHide: true });
    expect(existsSync(join(P.helloWorld, 'evil-config.marker'))).toBe(true);
  });
});

describe('D-6(viii) the planted-red repository through the new side', () => {
  let P;
  let runDir;
  let report;
  let judged;
  let status;
  let fpBefore;
  let fpAfter;
  let gitAfter;
  beforeAll(async () => {
    P = materializePlantedRepo({ corpus: 'planted-red', entries: ['launch', 'runner'] });
    fpBefore = await fingerprint({ cwd: P.root });
    const base = tmp();
    const id = randomBytes(16).toString('hex');
    const mint = join(base, `bucket-b.${id}.mint`);
    writeFileSync(mint, `RUN_ID=${id}\n`);
    const md = readFileSync(join(P.root, 'docs', 'regression', 'planted.md'), 'utf8');
    const cases = (md.match(/^### R-\d+ \| area: [^|]+ \| parallel-safe: (yes|no) \| automatable: (yes|no)/gm) || []).length;
    spawnSync(process.execPath, [entry(P, 'launch'), '--mint', mint, '--integrity', `EXIT=0 FILES=1 CASES=${cases}`],
      { cwd: P.helloWorld, env: { ...vitestEnv(process.env), TEMP: base, TMP: base }, encoding: 'utf8', timeout: 600000, windowsHide: true });
    runDir = join(base, 'resume-tailor-regression', id);
    status = readFileSync(join(runDir, 'status.txt'), 'utf8');
    report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
    judged = readFileSync(join(runDir, 'judged-bad.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    fpAfter = await fingerprint({ cwd: P.root });
    gitAfter = spawnSync('git', ['status', '--porcelain=v1'], { cwd: P.root, encoding: 'utf8', windowsHide: true }).stdout;
  }, 620000);
  afterAll(() => {
    if (P) removePlantedRepo(P.root);
  });
  test('[canary] the planted-red root holds exactly one docs/regression/*.md and no alpha.md or beta.md (§11.5: replaces, never adds)', () => {
    const md = readdirSync(join(P.root, 'docs', 'regression')).filter((n) => n.endsWith('.md'));
    expect(md).toEqual(['planted.md']);
  });
  test('planted.md\'s case IDs equal plantedExpected.json\'s IDs exactly', () => {
    const ids = readFileSync(join(FIX, 'planted-red', 'docs', 'regression', 'planted.md'), 'utf8').match(/^### (R-\d+) /gm).map((h) => h.slice(4, -1));
    expect(ids).toEqual(EXPECTED.cases.map((c) => c.id));
    expect(ids.length).toBeGreaterThanOrEqual(24);
  });
  test('the run finished: S-37 present and a RESULT line recorded', () => {
    expect(status.endsWith('--- end ---\n')).toBe(true);
    expect(status).toMatch(/^RESULT=(clean|dirty) /m);
  });
  test.each(EXPECTED.cases.map((c) => [c.id, c.shape, c]))('D-6(viii): the new side over the planted-red repository matches plantedExpected.json, row by row: %s (%s)', (id, _shape, c) => {
    expect(report.rows.find((r) => r.id === id)?.state).toBe(c.new.state);
    const got = judged.filter((r) => r.caseId === id).map((r) => ({ kind: r.kind, cause: r.cause })).sort((a, b) => `${a.kind}${a.cause}`.localeCompare(`${b.kind}${b.cause}`));
    const want = [...c.new.rows].sort((a, b) => `${a.kind}${a.cause}`.localeCompare(`${b.kind}${b.cause}`));
    expect(got).toEqual(want);
  });
  test('D-6(viii): the run-level orphan rows number plantedExpected.json\'s newOrphanRows', () => {
    expect(judged.filter((r) => r.caseId === 'RUN').length).toBe(EXPECTED.runLevel.newOrphanRows);
  });
  test('A-6: a .only beside a failing test reads fail under --allowOnly=false (p10-p13; T3-L9)', () => {
    for (const id of EXPECTED.mutants.m3) expect(report.rows.find((r) => r.id === id).state).toBe('fail');
    expect(JSON.parse(/^ARGV=(.*)$/m.exec(status)[1])).toContain('--allowOnly=false');
  });
  test('G24/G25/G28 shapes through the real runner: the run\'s file classes equal the recordings\' classes', () => {
    const rec = JSON.parse(readFileSync(join(runDir, 'vitest.json'), 'utf8'));
    const out = readFileSync(join(runDir, 'vitest.stdout.txt'), 'utf8');
    const got = fileClasses(rec, out, P.helloWorld.replace(/\\/g, '/'));
    for (const tag of ['g24-runA', 'g25', 'g28']) {
      const r = JSON.parse(readFileSync(join(FIX, `${tag}.vitest.json`), 'utf8'));
      const o = readFileSync(join(FIX, `${tag}.stdout.txt`), 'utf8');
      const first = r.testResults[0].name.replace(/\\/g, '/');
      const want = fileClasses(r, o, first.slice(0, first.lastIndexOf('/hello-world/') + '/hello-world'.length));
      for (const [f, cls] of Object.entries(want)) if (f in got) expect(`${f}=${got[f]}`).toBe(`${f}=${cls}`);
    }
  });
  test('A-19: after a run DEF-12 and every tracked file of the planted root are unchanged', () => {
    expect(fpBefore.ok).toBe(true);
    expect(fpAfter).toEqual(fpBefore);
    expect(gitAfter).toBe('');
  });
});

describe('§8.1 whole-suite argv', () => {
  test('wholeSuiteArgv spawns carry --allowOnly=false and no filter', () => {
    const a = wholeSuiteArgv('C:/p/hello-world/node_modules/vitest/vitest.mjs', 'C:/B/x/vitest.json');
    expect(a).toContain('--allowOnly=false');
    expect(a.filter((e) => !e.startsWith('-') && e !== 'run' && !e.endsWith('vitest.mjs'))).toEqual([]);
  });
});
