// Lane A gate and render-row rows over planted records (design §3.2, §6, §6.4; AC A-15, A-21, A-21b).
// Every record base is a mkdtemp directory with the rt-t3-fixture- prefix (T3-OPS-7), never the live base.
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gate, parseArgs as gateArgs } from './gate.js';
import { renderRow, parseArgs as renderArgs } from './render-row.js';
import { readVitestVersion } from './io.js';
import { blockSha256 } from './report.js';
import { materializePlantedRepo, removePlantedRepo } from './plantedRepo.js';
import { tokenizeSource } from '../../lib/sourceScan/tokenizeSource.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const HW = resolve(HERE, '..', '..');
const ID = '0123456789abcdef0123456789abcdef';
const OTHER = 'fedcba9876543210fedcba9876543210';
const PID = '5151';
const H = (c) => c.repeat(64);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const TOP = execFileSync('git', ['-C', HERE, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).split('\n')[0].trim();
const LOCK_NAME = `lock-${sha(Buffer.from(TOP, 'utf8'))}`;
const ARGV = JSON.stringify(['C:/p/hello-world/node_modules/vitest/vitest.mjs', 'run']);
const T0 = Date.UTC(2026, 8, 11, 12, 0, 0);
const iso = (ms) => new Date(ms).toISOString();

const resultLine = ({ result = 'clean', runId = ID, pin = 'match', version = '4.1.8' } = {}) => [
  `RESULT=${result}`, `RUN_ID=${runId}`, 'REASONS=-', `VITEST_PIN=${pin}`, `VITEST_VERSION=${version}`, 'FILES=2', 'CASES=4', 'VITEST_CASES=4',
  'REPORTED_CASES=4', 'JUDGED_BAD=0', 'ORPHAN=0', 'COULD_NOT_JUDGE=0', 'CNJ_BASELINE=absent', 'CNJ_NEW=0', 'CNJ_GONE=0', 'VITEST_FAILED_FILES=0',
  'VITEST_FAILED_TESTS=0', 'VITEST_ERRORS=0', 'S_MISSING_PATHS=0', 'S_FAIL=0', 'S_NO_MATCH=0', 'S_VACUOUS=0', 'S_COUNT_SHORT=0', 'S_CLAIM_FAIL=0',
  'S_UNSUPPORTED=0', 'S_NOT_COVERED=0', 'S_PASS=4',
].join(' ');
const kv = (o) => Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}\n`).join('');
const FILES = { 'report.json': '{"v":1}\n', 'judged-bad.jsonl': '', 'vitest.json': '{}\n', 'vitest.stdout.txt': 'Tests  4 passed (4)\n', 'vitest.stderr.txt': '' };

// A finished run directory whose status record's S-22..S-26 are the files' real hashes.
function writeRun(base, dirId, { spawn = {}, exit = {}, result = {}, completion = true, pin = 'match', version = '4.1.8', files = FILES } = {}) {
  const dir = join(base, dirId);
  mkdirSync(dir, { recursive: true });
  for (const [n, t] of Object.entries(files)) writeFileSync(join(dir, n), t);
  const h = (n) => sha(Buffer.from(files[n]));
  const text = `T3_STATUS=v1\n--- spawn ---\n${kv({ RUN_ID: dirId, RUNNER_PID: PID, STARTED: iso(T0), TOPLEVEL: 'C:/p', INTEGRITY: 'EXIT=0 FILES=2 CASES=4',
    FP_START: H('a'), ARGV, ENV_NAMES_SHA256: H('e'), ARGV_SHA256: sha(Buffer.from(ARGV)), VITEST_VERSION: version, VITEST_PIN: pin,
    CNJ_BASELINE_PATH: 'hello-world/scripts/regression/cnj-baseline.txt', CNJ_BASELINE_SHA256: 'absent', VITEST_SPAWNED: 'yes', ...spawn })}${
    completion ? `--- completion ---\n${kv({ SUMMARY_TEST_FILES: 'Test Files  2 passed (2)', SUMMARY_TESTS: 'Tests  4 passed (4)', SUMMARY_ERRORS: 'none',
      SUMMARY_DURATION: 'Duration  1.00s', FP_END: H('a'), REPORT_SHA256: h('report.json'), JUDGED_BAD_SHA256: h('judged-bad.jsonl'),
      VITEST_JSON_SHA256: h('vitest.json'), VITEST_STDOUT_SHA256: h('vitest.stdout.txt'), VITEST_STDERR_SHA256: h('vitest.stderr.txt'),
      FINISHED: iso(T0 + 60000), RESULT: resultLine({ runId: dirId, pin, version, ...result }) })}` : ''}--- exit ---\n${
    kv({ EXIT: '0', WAITED_PID: PID, LAUNCHER_RUN_ID: dirId, TIMEOUT_S: '1800', ELAPSED_S: '60', KILL: 'none', ENDED: iso(T0 + 61000), ...exit })}--- end ---\n`;
  writeFileSync(join(dir, 'status.txt'), text);
  return dir;
}
const lockText = ({ runId = ID, pid = 4242, heartbeat = T0, deadline = T0 + 1860000 } = {}) =>
  `T3_LOCK=v1\nRUN_ID=${runId}\nLAUNCHER_PID=${pid}\nTIMEOUT_S=1800\nLAUNCHED=${iso(T0)}\nDEADLINE=${iso(deadline)}\nHEARTBEAT=${iso(heartbeat)}\n`;

const cleanup = [];
afterAll(() => {
  for (const d of cleanup) rmSync(d, { recursive: true, force: true });
});
function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'rt-t3-fixture-'));
  cleanup.push(base);
  const mint = join(base, `bucket-b.${ID}.mint`);
  writeFileSync(mint, `RUN_ID=${ID}\n`);
  let clock = T0 + 120000;
  const deps = {
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    fingerprint: () => ({ ok: true, digest: H('a') }),
    vitestVersion: () => '4.1.8',
  };
  return { base, mint, deps, setClock: (ms) => (clock = ms) };
}
const line = async (f, over = {}) => (await gate({ mint: f.mint, recordBase: f.base }, { ...f.deps, ...over })).line;

describe('§6 gate over finished records', () => {
  test('G29 A -> not-green exit-disagree; B -> inconclusive e:timeout; C -> green (T3-L49): A', async () => {
    const f = fixture();
    writeRun(f.base, ID, { exit: { EXIT: '3' } });
    expect(await line(f)).toMatch(/^GATE=not-green REASONS=exit-disagree RUN_ID=0123456789abcdef0123456789abcdef RESULT=clean EXIT=3 /);
  });
  test('G29 A -> not-green exit-disagree; B -> inconclusive e:timeout; C -> green (T3-L49): B', async () => {
    const f = fixture();
    writeRun(f.base, ID, { exit: { EXIT: 'timeout', KILL: 'ok' } });
    expect(await line(f)).toMatch(/^GATE=inconclusive REASONS=e:timeout /);
  });
  test('G29 A -> not-green exit-disagree; B -> inconclusive e:timeout; C -> green (T3-L49): C', async () => {
    const f = fixture();
    writeRun(f.base, ID);
    expect(await line(f)).toBe(`GATE=green REASONS=- RUN_ID=${ID} RESULT=clean EXIT=0 VITEST_PIN=match VITEST_VERSION=4.1.8 FRESH=yes`);
  });
  test('absent, partial, foreign-RUN_ID or stale record -> inconclusive (T3-L20): absent', async () => {
    expect(await line(fixture())).toMatch(/^GATE=inconclusive REASONS=a:no-record /);
  });
  test('absent, partial, foreign-RUN_ID or stale record -> inconclusive (T3-L20): partial', async () => {
    const f = fixture();
    writeRun(f.base, ID, { spawn: { VITEST_SPAWNED: undefined }, completion: false });
    expect(await line(f)).toMatch(/^GATE=inconclusive REASONS=i:grammar /);
  });
  test('absent, partial, foreign-RUN_ID or stale record -> inconclusive (T3-L20): foreign RUN_ID', async () => {
    const f = fixture();
    writeRun(f.base, ID, { spawn: { RUN_ID: OTHER }, result: { runId: OTHER } });
    expect(await line(f)).toMatch(/^GATE=inconclusive REASONS=i:foreign /);
  });
  test('absent, partial, foreign-RUN_ID or stale record -> inconclusive (T3-L20): a stale clean record of another run', async () => {
    const f = fixture();
    writeRun(f.base, OTHER);
    expect(await line(f)).toMatch(/^GATE=inconclusive REASONS=a:no-record /);
  });
  test('a mint whose RUN_ID fails the grammar -> a:mint-invalid, and nothing is read by it (§4.2)', async () => {
    const f = fixture();
    writeFileSync(f.mint, 'RUN_ID=..\\x\n');
    expect(await line(f)).toMatch(/^GATE=inconclusive REASONS=a:mint-invalid RUN_ID=- /);
  });
  test('an edited report.json -> c:sha', async () => {
    const f = fixture();
    const dir = writeRun(f.base, ID);
    writeFileSync(join(dir, 'report.json'), '{"v":2}\n');
    expect(await line(f)).toMatch(/^GATE=inconclusive REASONS=c:sha /);
  });
  test('EXIT=lock-lost -> i:lock-lost', async () => {
    const f = fixture();
    writeRun(f.base, ID, { exit: { EXIT: 'lock-lost' } });
    expect(await line(f)).toMatch(/^GATE=inconclusive REASONS=i:lock-lost /);
  });
  test('a physical last line ENDED=... still reads green (T3-1d-11)', async () => {
    const f = fixture();
    const dir = writeRun(f.base, ID);
    const ls = readFileSync(join(dir, 'status.txt'), 'utf8').trimEnd().split('\n');
    expect(ls[ls.length - 2].startsWith('ENDED=')).toBe(true);
    expect(await line(f)).toMatch(/^GATE=green /);
  });
  test('exactly one stdout line; exit code 0 once printed (the returned line is one grammar line)', async () => {
    const f = fixture();
    writeRun(f.base, ID);
    const l = await line(f);
    expect(l.includes('\n')).toBe(false);
    expect(l).toMatch(/^GATE=\S+ REASONS=\S+ RUN_ID=\S+ RESULT=\S+ EXIT=\S+ VITEST_PIN=\S+ VITEST_VERSION=\S+ FRESH=\S+$/);
  });
});

describe('A-21 vitest version and pin', () => {
  const stub = (pkg) => {
    const d = mkdtempSync(join(tmpdir(), 'rt-t3-fixture-'));
    cleanup.push(d);
    writeFileSync(join(d, 'vitest.mjs'), 'process.exitCode = 0;\n');
    if (pkg !== null) writeFileSync(join(d, 'package.json'), pkg);
    return join(d, 'vitest.mjs');
  };
  test('stub vitest 4.1.9 -> VITEST_PIN=mismatch and not-green pin; an unreadable vitest package.json -> VITEST_VERSION=unknown, VITEST_PIN=mismatch; live 4.1.8 -> match (T3-L50): 4.1.9', async () => {
    expect(readVitestVersion(stub('{"name":"vitest","version":"4.1.9"}'))).toBe('4.1.9');
    const f = fixture();
    writeRun(f.base, ID, { pin: 'mismatch', version: '4.1.9' });
    expect(await line(f, { vitestVersion: () => '4.1.9' })).toBe(`GATE=not-green REASONS=pin RUN_ID=${ID} RESULT=clean EXIT=0 VITEST_PIN=mismatch VITEST_VERSION=4.1.9 FRESH=yes`);
  });
  test('stub vitest 4.1.9 -> VITEST_PIN=mismatch and not-green pin; an unreadable vitest package.json -> VITEST_VERSION=unknown, VITEST_PIN=mismatch; live 4.1.8 -> match (T3-L50): unreadable', () => {
    expect(readVitestVersion(stub(null))).toBe('unknown');
    expect(readVitestVersion(stub('{not json'))).toBe('unknown');
  });
  test('stub vitest 4.1.9 -> VITEST_PIN=mismatch and not-green pin; an unreadable vitest package.json -> VITEST_VERSION=unknown, VITEST_PIN=mismatch; live 4.1.8 -> match (T3-L50): live', () => {
    expect(readVitestVersion(join(HW, 'node_modules', 'vitest', 'vitest.mjs'))).toBe('4.1.8');
  });
});

describe('§3.2 liveness through the gate (injected clock and sleep)', () => {
  const withStatus = (f) => {
    mkdirSync(join(f.base, ID), { recursive: true });
    writeFileSync(join(f.base, ID, 'status.txt'), 'T3_STATUS=v1\n');
  };
  test('each §3.2 row with an injected clock and sleep through deps: V-1 -> a:no-record', async () => {
    expect(await line(fixture())).toMatch(/^GATE=inconclusive REASONS=a:no-record /);
  });
  test('each §3.2 row with an injected clock and sleep through deps: V-2 -> i:lock-unreadable', async () => {
    const f = fixture();
    withStatus(f);
    writeFileSync(join(f.base, LOCK_NAME), 'garbage\n');
    expect(await line(f)).toMatch(/^GATE=inconclusive REASONS=i:lock-unreadable /);
  });
  test('each §3.2 row with an injected clock and sleep through deps: V-3 -> a:no-record', async () => {
    const f = fixture();
    writeFileSync(join(f.base, LOCK_NAME), lockText({ runId: OTHER, heartbeat: T0 + 110000 }));
    expect(await line(f)).toMatch(/^GATE=inconclusive REASONS=a:no-record /);
  });
  test('each §3.2 row with an injected clock and sleep through deps: V-4 -> i:lock-foreign', async () => {
    const f = fixture();
    withStatus(f);
    writeFileSync(join(f.base, LOCK_NAME), lockText({ runId: OTHER, heartbeat: T0 + 110000 }));
    expect(await line(f)).toMatch(/^GATE=inconclusive REASONS=i:lock-foreign /);
  });
  test('each §3.2 row with an injected clock and sleep through deps: V-5 -> pending', async () => {
    const f = fixture();
    withStatus(f);
    writeFileSync(join(f.base, LOCK_NAME), lockText({ heartbeat: T0 + 110000 }));
    expect(await line(f)).toBe(`GATE=pending REASONS=- RUN_ID=${ID} RESULT=- EXIT=- VITEST_PIN=- VITEST_VERSION=- FRESH=-`);
  });
  test('each §3.2 row with an injected clock and sleep through deps: V-6 then V-6 -> overdue:<L-3>', async () => {
    const f = fixture();
    withStatus(f);
    f.setClock(T0 + 1900000);
    const beat = { heartbeat: T0 + 1899000, deadline: T0 + 1860000 };
    writeFileSync(join(f.base, LOCK_NAME), lockText(beat));
    const deps = { sleep: async (ms) => {
      f.setClock(f.deps.now() + ms);
      writeFileSync(join(f.base, LOCK_NAME), lockText({ ...beat, heartbeat: f.deps.now() - 1000 }));
    } };
    expect(await line(f, deps)).toMatch(/^GATE=inconclusive REASONS=overdue:4242 /);
  });
  test('each §3.2 row with an injected clock and sleep through deps: V-7 then V-7 -> i:launcher-lost', async () => {
    const f = fixture();
    withStatus(f);
    writeFileSync(join(f.base, LOCK_NAME), lockText({ heartbeat: T0 }));
    expect(await line(f)).toMatch(/^GATE=inconclusive REASONS=i:launcher-lost /);
  });
});

describe('§6.4 render-row', () => {
  let P;
  let run;
  const KEY = 'R-001|s1|k1|fail|kb/speaker.test.js|renders speaker labels#1#1';
  const blockOf = (text) => {
    const n = text.replace(/\r\n/g, '\n');
    const s = n.indexOf('### R-001 ');
    const e = n.indexOf('\n### R-', s + 1);
    return n.slice(s, e < 0 ? n.length : e + 1);
  };
  beforeAll(() => {
    P = materializePlantedRepo({ entries: [], corpusOnly: true });
    const base = mkdtempSync(join(tmpdir(), 'rt-t3-fixture-'));
    cleanup.push(base);
    const alpha = readFileSync(join(P.root, 'docs', 'regression', 'alpha.md'), 'utf8');
    const row = { key: KEY, runId: ID, kind: 'fail', cause: 'test:kb/speaker.test.js|renders speaker labels#1', command: 'npx vitest run --no-file-parallelism --allowOnly=false kb/speaker.test.js -t "speaker labels"',
      evidence: 'expected pass', evidenceTruncated: false, fpEnd: H('a'), argvRef: 'status.txt#ARGV', argvSha256: sha(Buffer.from(ARGV)), caseId: 'R-001',
      corpusFile: 'docs/regression/alpha.md', automatable: 'yes', contextRef: 'R-001', step: 1, stepText: '1. Run `x`.', span: 'npx vitest run kb/speaker.test.js -t "speaker labels"', test: 'kb/speaker.test.js|renders speaker labels#1' };
    const report = `${JSON.stringify({ v: 1, runId: ID, contexts: { 'R-001': { corpusFile: 'docs/regression/alpha.md', summary: '**Summary:** STORED SUMMARY.', steps: '**Steps:**', expected: '**Expected:**', blockSha256: blockSha256(blockOf(alpha)) } } })}\n`;
    run = writeRun(base, ID, { files: { ...FILES, 'report.json': report, 'judged-bad.jsonl': `${JSON.stringify(row)}\n` } });
  });
  afterAll(() => {
    if (P) removePlantedRepo(P.root);
  });
  const deps = (over = {}) => ({ toplevel: () => P.root, fingerprint: () => ({ ok: true, digest: H('a') }), vitestVersion: () => '4.1.8', ...over });
  const first = async (key, over) => (await renderRow({ run, key }, deps(over))).split('\n')[0];
  test('render-row: untouched -> live (§6.4, T3-1d-12)', async () => {
    expect(await first(KEY)).toBe(`RENDER=live KEY=${KEY} RUN_ID=${ID} FRESH=yes`);
  });
  test('render-row: unknown key -> refused (§6.4, T3-1d-12)', async () => {
    expect(await first('R-999|nope#1')).toMatch(/^RENDER=refused /);
  });
  test('render-row: tree edit -> FRESH=no:fp (§6.4, T3-1d-12)', async () => {
    expect(await first(KEY, { fingerprint: () => ({ ok: true, digest: H('b') }) })).toMatch(/ FRESH=no:fp/);
  });
  test('render-row: vitest bump -> FRESH=no:vitest (§6.4, T3-1d-12)', async () => {
    expect(await first(KEY, { vitestVersion: () => '4.1.9' })).toMatch(/ FRESH=no:vitest/);
  });
  test('render-row: one byte edited -> stored (§6.4, T3-1d-12)', async () => {
    const p = join(P.root, 'docs', 'regression', 'alpha.md');
    writeFileSync(p, readFileSync(p, 'utf8').replace('Speaker labels render', 'Speaker labels rendeR'));
    const out = await renderRow({ run, key: KEY }, deps());
    expect(out.split('\n')[0]).toMatch(/^RENDER=stored /);
    expect(out).toContain('STORED SUMMARY.');
  });
});

describe('gate source and entry shape', () => {
  const OUTS = ['runner.stdout.txt', 'launcher.out.txt', 'launcher.err.txt'];
  const reads = (text) => OUTS.filter((n) => tokenizeSource(text, { label: 'x' }).readable.includes(n)).length;
  test('[src] gate.js reads no runner.stdout.txt and no launcher out/err file (T3-1d2-9)', () => {
    expect(reads(readFileSync(join(HERE, 'gate.js'), 'utf8'))).toBe(0);
  });
  test("[canary] a planted readFileSync('runner.stdout.txt') hits", () => {
    expect(reads("readFileSync(join(dir, 'runner.stdout.txt'));\n")).toBe(1);
  });
  test('gate argv and render-row argv: a typo flag and a --flag=value form return an error (§1): gate', () => {
    expect(gateArgs(['--mint', 'm']).ok).toBe(true);
    expect(gateArgs(['--mint', 'm', '--record-base', 'b']).ok).toBe(true);
    expect(gateArgs(['--mnt', 'm']).ok).toBe(false);
    expect(gateArgs(['--mint=m']).ok).toBe(false);
  });
  test('gate argv and render-row argv: a typo flag and a --flag=value form return an error (§1): render-row', () => {
    expect(renderArgs(['--run', 'r', '--key', 'k']).ok).toBe(true);
    expect(renderArgs(['--run', 'r', '--kye', 'k']).ok).toBe(false);
    expect(renderArgs(['--run=r', '--key', 'k']).ok).toBe(false);
  });
});
