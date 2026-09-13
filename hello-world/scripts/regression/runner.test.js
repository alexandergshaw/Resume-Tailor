// Lane A runner rows (design §5, §5.4, §7, §8.1; AC A-6, A-21). runBucketB runs in-process with an injected
// spawn seam; one row launches the real launcher and runner over a planted root, nothing injected.
import { describe, test, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBucketB, parseArgs } from './runner.js';
import { cnjBaseline, parseArgs as cnjArgs } from './cnjBaseline.js';
import { spawnVitest } from './io.js';
import { extractCorpus } from './definitions.js';
import { parseCnjBaseline } from './verdict.js';
import { vitestEnv } from './launchPolicy.js';
import { materializePlantedRepo, removePlantedRepo } from './plantedRepo.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixtures');
const H = (c) => c.repeat(64);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const newId = () => randomBytes(16).toString('hex');
const entry = (p, name) => join(p.entryDir, `${name}.js`);
const SAVED_LAST = readFileSync(join(FIX, 'integrity-rows.planted.ndjson'), 'utf8').replace(/\r\n/g, '\n').trimEnd().split('\n').pop();
const SPAWN_KEYS = ['RUN_ID', 'RUNNER_PID', 'STARTED', 'TOPLEVEL', 'INTEGRITY', 'FP_START', 'ARGV', 'ENV_NAMES_SHA256', 'ARGV_SHA256', 'VITEST_VERSION',
  'VITEST_PIN', 'CNJ_BASELINE_PATH', 'CNJ_BASELINE_SHA256', 'VITEST_SPAWNED'];
const BODIES = {
  'hello-world/grp/one.test.js': readFileSync(join(FIX, 'planted-bodies', 'grp-one.test.txt')),
  'hello-world/kb/speaker.test.js': readFileSync(join(FIX, 'planted-bodies', 'kb-speaker.test.txt')),
};
const roots = [];
const scratch = [];
afterAll(() => {
  while (roots.length) removePlantedRepo(roots.pop());
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});
const planted = (opts = {}) => {
  const p = materializePlantedRepo({ entries: [], ...opts });
  roots.push(p.root);
  return p;
};
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'rt-t3-fixture-'));
  scratch.push(d);
  return d;
};
const recordDir = (withStatus = true) => {
  const id = newId();
  const dir = join(tmp(), id);
  mkdirSync(dir);
  if (withStatus) writeFileSync(join(dir, 'status.txt'), 'T3_STATUS=v1\n');
  return { id, dir };
};
// The spawn seam: records what runBucketB hands io.spawnVitest and writes an empty vitest run.
const seam = (seen) => async (argv, o) => {
  seen.push({ argv, o });
  const json = argv.find((a) => a.startsWith('--outputFile.json='))?.slice('--outputFile.json='.length);
  if (json) writeFileSync(json, JSON.stringify({ numTotalTests: 0, testResults: [], success: true }));
  writeFileSync(o.stdoutPath, ' Test Files  0 passed (0)\n      Tests  0 passed (0)\n   Duration  1ms\n', { flag: 'a' });
  writeFileSync(o.stderrPath, '', { flag: 'a' });
  return { status: 0, signal: null, spawnError: null };
};
const depsFor = (p, seen, over = {}) => ({
  toplevel: () => p.root, spawnVitest: seam(seen), vitestMjsPath: () => join(p.root, 'hello-world', 'node_modules', 'vitest', 'vitest.mjs'),
  fingerprint: () => ({ ok: true, digest: H('a') }), ...over,
});
const statusBlock = (dir, name) => {
  const t = readFileSync(join(dir, 'status.txt'), 'utf8');
  const s = t.indexOf(`--- ${name} ---\n`);
  const rest = t.slice(s + name.length + 9);
  return rest.slice(0, rest.search(/^--- /m) < 0 ? rest.length : rest.search(/^--- /m)).split('\n').filter(Boolean);
};
const resultOf = (dir) => (/^RESULT=(.*)$/m.exec(readFileSync(join(dir, 'status.txt'), 'utf8')) || [])[1] || '';
const integrityOf = (root) => {
  const dir = join(root, 'docs', 'regression');
  const md = readdirSync(dir).filter((n) => n.endsWith('.md'));
  const cases = md.reduce((n, f) => n + (readFileSync(join(dir, f), 'utf8').match(/^### R-\d+ \| area: [^|\r\n]+ \| parallel-safe: (yes|no) \| automatable: (yes|no)/gm) || []).length, 0);
  return `EXIT=0 FILES=${md.length} CASES=${cases}`;
};

describe('§5 runBucketB', () => {
  test('spawn block keys and order; S-15 last (§5.1)', async () => {
    const p = planted({ files: BODIES });
    const r = recordDir();
    await runBucketB({ runId: r.id, recordDir: r.dir, integrity: `EXIT=0 ${SAVED_LAST}` }, depsFor(p, []));
    const keys = statusBlock(r.dir, 'spawn').map((l) => l.slice(0, l.indexOf('=')));
    expect([...keys].sort()).toEqual([...SPAWN_KEYS].sort());
    expect(keys[keys.length - 1]).toBe('VITEST_SPAWNED');
  });
  test('(f): EXIT=1 in --integrity -> inconclusive; CASES off by one -> inconclusive (S-7; T3-D6-1): EXIT=1', async () => {
    const p = planted({ files: BODIES });
    const r = recordDir();
    await runBucketB({ runId: r.id, recordDir: r.dir, integrity: `EXIT=1 ${SAVED_LAST}` }, depsFor(p, []));
    expect(resultOf(r.dir)).toMatch(/^inconclusive RUN_ID=\S+ REASONS=\S*f/);
  });
  test('(f): EXIT=1 in --integrity -> inconclusive; CASES off by one -> inconclusive (S-7; T3-D6-1): CASES + 1', async () => {
    const p = planted({ files: BODIES });
    const r = recordDir();
    const bumped = SAVED_LAST.replace(/CASES=(\d+)/, (_m, n) => `CASES=${Number(n) + 1}`);
    await runBucketB({ runId: r.id, recordDir: r.dir, integrity: `EXIT=0 ${bumped}` }, depsFor(p, []));
    expect(resultOf(r.dir)).toMatch(/^inconclusive RUN_ID=\S+ REASONS=\S*f/);
  });
  test('the child env is vitestEnv(process.env) (§7.1)', { timeout: 60000 }, async () => {
    const d = tmp();
    const stub = join(d, 'env-stub.mjs');
    writeFileSync(stub, 'process.stdout.write(JSON.stringify(Object.keys(process.env)));\n');
    const res = await spawnVitest([stub], { cwd: d, stdoutPath: join(d, 'out.txt'), stderrPath: join(d, 'err.txt') });
    const names = JSON.parse(readFileSync(join(d, 'out.txt'), 'utf8'));
    expect(Object.keys(process.env).some((n) => /^VITEST/i.test(n))).toBe(true);
    expect(names.filter((n) => /^(VITEST.*|TEST|NODE_ENV|NODE_OPTIONS)$/i.test(n))).toEqual([]);
    expect(names.sort()).toEqual(Object.keys(vitestEnv(process.env)).sort());
    expect(res.status).toBe(0);
  });
  test('vitest stdio is two fds, never a pipe (§7.3)', { timeout: 60000 }, async () => {
    const d = tmp();
    const stub = join(d, 'io-stub.mjs');
    writeFileSync(stub, "process.stdout.write('OUT'); process.stderr.write('ERR');\n");
    await spawnVitest([stub], { cwd: d, stdoutPath: join(d, 'o.txt'), stderrPath: join(d, 'e.txt') });
    expect(readFileSync(join(d, 'o.txt'), 'utf8')).toBe('OUT');
    expect(readFileSync(join(d, 'e.txt'), 'utf8')).toBe('ERR');
  });
  const TOKEN = 'kb/zz-canary-token.test.js';
  const extraCase = `### R-020 | area: zz | parallel-safe: yes | automatable: yes\n\n**Summary:** A token only this corpus holds.\n\n**Steps:**\n1. Run \`npx vitest run ${TOKEN}\`.\n\n**Expected:** It passes.\n`;
  test('wholeSuiteArgv at the spawn seam: over two planted corpora the spawned argv arrays are identical except the one element beginning --outputFile.json=, and carry no corpus token (§8.1, T3-1b-4)', async () => {
    const a = planted({ files: BODIES });
    const b = planted({ files: { ...BODIES, 'docs/regression/zz.md': extraCase } });
    const seenA = [];
    const seenB = [];
    const ra = recordDir();
    const rb = recordDir();
    await runBucketB({ runId: ra.id, recordDir: ra.dir, integrity: integrityOf(a.root) }, depsFor(a, seenA));
    await runBucketB({ runId: rb.id, recordDir: rb.dir, integrity: integrityOf(b.root) }, depsFor(b, seenB));
    expect(seenA.length).toBe(1);
    expect(seenB.length).toBe(1);
    const strip = (argv) => argv.map((e) => (e.startsWith('--outputFile.json=') ? '--outputFile.json=' : e.replace(/rt-t3-fixture-[^/\\]+/g, 'ROOT')));
    expect(strip(seenA[0].argv)).toEqual(strip(seenB[0].argv));
    for (const [seen, r] of [[seenA, ra], [seenB, rb]]) {
      const out = seen[0].argv.filter((e) => e.startsWith('--outputFile.json='));
      expect(out.length).toBe(1);
      expect(dirname(out[0].slice('--outputFile.json='.length))).toBe(r.dir);
    }
  });
  test('[canary] a corpus token planted in one corpus is absent from both argv arrays and present in that corpus\'s extracted spans (F-10)', async () => {
    const b = planted({ files: { ...BODIES, 'docs/regression/zz.md': extraCase } });
    const seen = [];
    const r = recordDir();
    await runBucketB({ runId: r.id, recordDir: r.dir, integrity: integrityOf(b.root) }, depsFor(b, seen));
    expect(seen[0].argv.some((e) => e.includes(TOKEN))).toBe(false);
    const c = extractCorpus([{ file: 'docs/regression/zz.md', content: extraCase }]);
    expect(c.cases[0].steps[0].spans[0].filters).toEqual([TOKEN]);
  });
  test('S-2: a runner started against a directory without status.txt refuses and creates nothing (§5.1, T3-1d2-2)', async () => {
    const p = planted({ files: BODIES });
    const r = recordDir(false);
    const seen = [];
    await runBucketB({ runId: r.id, recordDir: r.dir, integrity: `EXIT=0 ${SAVED_LAST}` }, depsFor(p, seen));
    expect(readdirSync(r.dir)).toEqual([]);
    expect(seen.length).toBe(0);
  });
  test('launch -> the real runner over a planted root, nothing injected (T3-1b-3)', { timeout: 600000 }, () => {
    const p = materializePlantedRepo({ entries: ['launch', 'runner'], files: BODIES });
    roots.push(p.root);
    const temp = tmp();
    const id = newId();
    const mint = join(temp, `bucket-b.${id}.mint`);
    writeFileSync(mint, `RUN_ID=${id}\n`);
    spawnSync(process.execPath, [entry(p, 'launch'), '--mint', mint, '--integrity', `EXIT=0 ${SAVED_LAST}`],
      { cwd: p.helloWorld, env: { ...vitestEnv(process.env), TEMP: temp, TMP: temp }, encoding: 'utf8', timeout: 580000, windowsHide: true });
    const st = readFileSync(join(temp, 'resume-tailor-regression', id, 'status.txt'), 'utf8');
    expect(st.endsWith('--- end ---\n')).toBe(true);
    expect(st).toMatch(/^EXIT=0$/m);
    expect(st).toMatch(new RegExp(`^RESULT=clean RUN_ID=${id} `, 'm'));
  });
  test('[canary] recursion-guard: the in-tree runner.js refuses under VITEST with no run argument', { timeout: 60000 }, () => {
    const r = spawnSync(process.execPath, [join(HERE, 'runner.js')], { env: { ...process.env, VITEST: 'true' }, encoding: 'utf8', timeout: 30000, windowsHide: true });
    expect(r.stderr).toContain('RUNNER: refused recursion-guard');
    expect(r.status).toBe(2);
  });
  test('runner argv: a typo flag and --run-id=x return an error (§1)', () => {
    expect(parseArgs(['--run-id', 'i', '--record-dir', 'd', '--integrity', 'v']).ok).toBe(true);
    expect(parseArgs(['--run-idd', 'i', '--record-dir', 'd', '--integrity', 'v']).ok).toBe(false);
    expect(parseArgs(['--run-id=x', '--record-dir', 'd', '--integrity', 'v']).ok).toBe(false);
  });
});

describe('§5.4 cnjBaseline entry (in-process, deps.toplevel = a planted root)', () => {
  const ARGV = JSON.stringify(['vitest.mjs', 'run']);
  const KEYS = ['R-010|s1|k1|not-covered', 'R-007|s1|k1|not-covered'];
  const kv = (o) => Object.entries(o).map(([k, v]) => `${k}=${v}\n`).join('');
  const resultLine = (id, result) => [`RESULT=${result}`, `RUN_ID=${id}`, `REASONS=${result === 'inconclusive' ? 'h' : '-'}`, 'VITEST_PIN=match', 'VITEST_VERSION=4.1.8',
    'FILES=2', 'CASES=4', 'VITEST_CASES=4', 'REPORTED_CASES=4', 'JUDGED_BAD=0', 'ORPHAN=0', 'COULD_NOT_JUDGE=2', 'CNJ_BASELINE=absent', 'CNJ_NEW=2', 'CNJ_GONE=0',
    'VITEST_FAILED_FILES=0', 'VITEST_FAILED_TESTS=0', 'VITEST_ERRORS=0', 'S_MISSING_PATHS=0', 'S_FAIL=0', 'S_NO_MATCH=0', 'S_VACUOUS=0', 'S_COUNT_SHORT=0',
    'S_CLAIM_FAIL=0', 'S_UNSUPPORTED=0', 'S_NOT_COVERED=0', 'S_PASS=4'].join(' ');
  function finishedRun({ exit = '0', result = 'clean', end = true } = {}) {
    const id = newId();
    const dir = join(tmp(), id);
    mkdirSync(dir);
    const report = `${JSON.stringify({ v: 1, runId: id, cnj: { items: KEYS.map((key) => ({ key })) } })}\n`;
    writeFileSync(join(dir, 'report.json'), report);
    const text = `T3_STATUS=v1\n--- spawn ---\n${kv({ RUN_ID: id, RUNNER_PID: '5151', STARTED: '2026-09-11T12:00:01.000Z', TOPLEVEL: 'C:/p', INTEGRITY: 'EXIT=0 FILES=2 CASES=4',
      FP_START: H('a'), ARGV, ENV_NAMES_SHA256: H('e'), ARGV_SHA256: sha(Buffer.from(ARGV)), VITEST_VERSION: '4.1.8', VITEST_PIN: 'match',
      CNJ_BASELINE_PATH: 'hello-world/scripts/regression/cnj-baseline.txt', CNJ_BASELINE_SHA256: 'absent', VITEST_SPAWNED: 'yes' })}--- completion ---\n${
      kv({ SUMMARY_TEST_FILES: 'Test Files  2 passed (2)', SUMMARY_TESTS: 'Tests  4 passed (4)', SUMMARY_ERRORS: 'none', SUMMARY_DURATION: 'Duration  1.00s',
        FP_END: H('c'), REPORT_SHA256: sha(Buffer.from(report)), JUDGED_BAD_SHA256: H('2'), VITEST_JSON_SHA256: H('3'), VITEST_STDOUT_SHA256: H('4'),
        VITEST_STDERR_SHA256: H('5'), FINISHED: '2026-09-11T12:01:00.000Z', RESULT: resultLine(id, result) })}${
      end ? `--- exit ---\n${kv({ EXIT: exit, WAITED_PID: '5151', LAUNCHER_RUN_ID: id, TIMEOUT_S: '1800', ELAPSED_S: '60', KILL: 'none', ENDED: '2026-09-11T12:01:01.000Z' })}--- end ---\n` : ''}`;
    writeFileSync(join(dir, 'status.txt'), text);
    return { id, dir };
  }
  const target = (p) => join(p.root, 'hello-world', 'scripts', 'regression', 'cnj-baseline.txt');
  const run = async (p, r, opts = {}, deps = {}) => cnjBaseline({ run: r.dir, ...opts }, { toplevel: () => p.root, ...deps });
  test('cnjBaseline: writes, parses back and prints ok over a finished planted run', async () => {
    const p = planted();
    const r = finishedRun();
    const lines = await run(p, r);
    const text = readFileSync(target(p), 'utf8');
    expect(lines[0]).toBe(`CNJ_BASELINE_WRITE=ok COUNT=2 SHA256=${sha(Buffer.from(text.replace(/\r\n/g, '\n')))}`);
    expect(lines[1]).toBe(`KEYS_SHA256=${sha(Buffer.from([...KEYS].sort().join('\n')))}`);
    expect(parseCnjBaseline(text)).toEqual({ runId: r.id, fp: H('c'), vitest: '4.1.8', keys: [...KEYS].sort() });
  });
  const REFUSALS = [
    ['unfinished', () => finishedRun({ end: false })],
    ['exit', () => finishedRun({ exit: '1' })],
    ['inconclusive', () => finishedRun({ result: 'inconclusive' })],
    ['report-sha', () => {
      const r = finishedRun();
      const p = join(r.dir, 'report.json');
      writeFileSync(p, readFileSync(p, 'utf8').replace('"v":1', '"v":2'));
      return r;
    }],
  ];
  test.each(REFUSALS)('cnjBaseline: refuses unfinished / exit / inconclusive / report-sha / exists: %s', async (reason, make) => {
    const p = planted();
    expect(await run(p, make())).toEqual([`CNJ_BASELINE_WRITE=refused reason=${reason}`]);
    expect(existsSync(target(p))).toBe(false);
  });
  test('cnjBaseline: refuses unfinished / exit / inconclusive / report-sha / exists: exists', async () => {
    const p = planted();
    await run(p, finishedRun());
    const before = readFileSync(target(p));
    expect(await run(p, finishedRun())).toEqual(['CNJ_BASELINE_WRITE=refused reason=exists']);
    expect(readFileSync(target(p)).equals(before)).toBe(true);
  });
  test('cnjBaseline: --replace rewrites', async () => {
    const p = planted();
    await run(p, finishedRun());
    const second = finishedRun();
    expect((await run(p, second, { replace: true }))[0]).toMatch(/^CNJ_BASELINE_WRITE=ok /);
    expect(parseCnjBaseline(readFileSync(target(p), 'utf8')).runId).toBe(second.id);
  });
  test('cnjBaseline: an injected write without the final newline refuses parse-back', async () => {
    const p = planted();
    const write = (path, text) => writeFileSync(path, text.slice(0, -1), { flag: 'wx' });
    expect(await run(p, finishedRun(), {}, { write })).toEqual(['CNJ_BASELINE_WRITE=refused reason=parse-back']);
  });
  test.each([[['--run=x']], [['--run']], [['--rnu', 'x']]])('cnjBaseline argv: --run=x, --run without value, --rnu x error (T3-2-2): %j', (argv) => {
    expect(cnjArgs(argv).ok).toBe(false);
    expect(cnjArgs(['--run', 'x']).ok).toBe(true);
    expect(cnjArgs(['--run', 'x', '--replace']).ok).toBe(true);
  });
});
