// Lane A form-C invoker rows (design §9 fixtures 1-17). CLI rows run the committed invoke.js copied into a
// planted root (§1.3); stub rows call invoke() in-process with deps. TEMP/TMP point every child at a scratch
// base, so no iso-*.json lands under the live record base (T3-OPS-7).
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { invoke, parseArgs } from './invoke.js';
import { FIXED_FLAGS, encodeFormC, renderFormC } from './argv.js';
import { vitestEnv, envNamesSha256 } from './launchPolicy.js';
import { materializePlantedRepo, removePlantedRepo } from './plantedRepo.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixtures');
const fwd = (p) => p.replace(/\\/g, '/');
let P;
let scratch;
let base;
let VM;
let INVOKE;
const childEnv = (extra = {}) => ({ ...vitestEnv(process.env), TEMP: base, TMP: base, ...extra });
const cli = (payload, env = childEnv()) => spawnSync(process.execPath, [INVOKE, payload], { cwd: P.helloWorld, env, encoding: 'utf8', timeout: 180000, windowsHide: true });
const linesOf = (s) => s.split(/\r?\n/).filter(Boolean);
const lastLine = (s) => linesOf(s).pop() || '';
const isoFiles = () => (existsSync(join(base, 'resume-tailor-regression')) ? readdirSync(join(base, 'resume-tailor-regression')).filter((n) => n.startsWith('iso-')) : []);

beforeAll(() => {
  P = materializePlantedRepo({
    entries: ['invoke'],
    files: {
      'hello-world/kb/speaker.test.js': readFileSync(join(FIX, 'planted-bodies', 'kb-speaker.test.txt')),
      'hello-world/evil.config.mjs': "import { writeFileSync } from 'node:fs';\nwriteFileSync(new URL('./evil.marker', import.meta.url), 'x');\nexport default {};\n",
    },
  });
  INVOKE = join(P.entryDir, `${'invoke'}.js`);
  VM = fileURLToPath(new URL('../../node_modules/vitest/vitest.mjs', pathToFileURL(INVOKE)));
  scratch = mkdtempSync(join(tmpdir(), 'rt-t3-fixture-'));
  base = join(scratch, 'temp');
  mkdirSync(base);
}, 120000);
afterAll(() => {
  if (P) removePlantedRepo(P.root);
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});
const OK = () => [VM, 'run', ...FIXED_FLAGS, 'kb/speaker.test.js'];

describe('§9 fixture 1: transport through PowerShell', () => {
  // 3b's 18 hostile tokens (3b.r1.md Q6, forms D/A1/A2/B/C; T3-C4b-13): PowerShell metacharacters,
  // quote forms, expansion forms and the two `--config` flag-split injections (t15-t17, including
  // t16, the one 3b actually measured splitting a single-quoted argument into a standalone flag
  // element under PS 5.1 native argument passing). Each is one filter element.
  const HOSTILE = ['$(ni m01)', '(ni m02)/x.test.js', 'a`$(ni m03)', 'a;ni m04', 'a&ni m05', 'a|ni m06',
    'x\u2019 $(ni m07) \u2019y', 'x\u2018 ; ni m08 ; \u2018y', 'x" --config=./evil.config.mjs "y', '%USERNAME%',
    'a b\\', '', '\u201c$(ni m13)\u201d', 'speaker labels',
    'a"" --config=./evil.config.mjs', 'a\\" --config=./evil.config.mjs', 'x" "--config=./evil.config.mjs', 'speaker labels'];
  const ps = (command, cwd) => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')],
    { cwd, env: childEnv(), encoding: 'utf8', timeout: 120000, windowsHide: true });
  test.each(HOSTILE.map((t, i) => [i + 1, t]))('§9 fixture 1: transport: hostile token %d %j round-trips as ARGV= and is REFUSED, 0 marker files', { timeout: 120000 }, (_i, t) => {
    const cwd = mkdtempSync(join(scratch, 'ps-'));
    const argv = [VM, 'run', ...FIXED_FLAGS, t];
    const r = ps(renderFormC(argv, fwd(INVOKE)), cwd);
    const ls = linesOf(r.stdout);
    expect(ls[0].startsWith('ARGV=')).toBe(true);
    expect(JSON.parse(ls[0].slice('ARGV='.length))).toEqual(argv);
    expect(ls.some((l) => l.startsWith('REFUSED='))).toBe(true);
    expect(readdirSync(cwd)).toEqual([]);
  });
  test('§9 fixture 1: positive control: form D ("<tok>") of $(ni m01) creates its marker', { timeout: 60000 }, () => {
    const cwd = mkdtempSync(join(scratch, 'ps-'));
    ps('Write-Output "$(ni m01)"', cwd);
    expect(readdirSync(cwd)).toContain('m01');
  });
});

describe('§9 fixtures 2-10: refusals, nothing spawned', () => {
  const ROWS = [
    [2, 'an -e blob', () => ['C:/Program Files/nodejs/node.exe', '-e', 'code'], 'argv0'],
    [3, 'a --config=./evil.config.mjs element', () => [...OK(), '--config=./evil.config.mjs'], 'flag-unknown'],
    [4, 'two --testNamePattern= elements', () => [...OK(), '--testNamePattern=speaker labels', '--testNamePattern=speaker labels'], 'pattern-duplicate'],
    [5, 'filter lib/x.test.js:3', () => [VM, 'run', ...FIXED_FLAGS, 'lib/x.test.js:3'], 'filter:DEF-1u'],
    [6, 'filter C:1', () => [VM, 'run', ...FIXED_FLAGS, 'C:1'], 'filter:path-escape'],
    [7, 'filter lib/', () => [VM, 'run', ...FIXED_FLAGS, 'lib/'], 'filter:DEF-1u'],
    [8, 'no filter', () => [VM, 'run', ...FIXED_FLAGS], 'no-filter'],
    [9, '--allowOnly=false missing', () => OK().filter((e) => e !== '--allowOnly=false'), 'flag-missing'],
    [10, 'a --outputFile.json=x element', () => [...OK(), '--outputFile.json=x'], 'output-file'],
  ];
  test.each(ROWS)('§9 fixture %d: %s -> REFUSED=%s', { timeout: 60000 }, (_n, _d, make, reason) => {
    const before = isoFiles().length;
    const r = cli(encodeFormC(make()));
    const ls = linesOf(r.stdout);
    expect(ls[0].startsWith('ARGV=')).toBe(true);
    expect(ls).toContain(`REFUSED=${reason}`);
    expect(r.status).toBe(2);
    expect(isoFiles().length).toBe(before);
    expect(existsSync(join(P.helloWorld, 'evil.marker'))).toBe(false);
  });
  test('§9 step 2: an undecodable payload prints ARGV=- and REFUSED=decode', { timeout: 60000 }, () => {
    const ls = linesOf(cli('%%%').stdout);
    expect(ls[0]).toBe('ARGV=-');
    expect(ls).toContain('REFUSED=decode');
  });
});

describe('§9 fixtures 11-16: runs', () => {
  const stubDir = () => mkdtempSync(join(scratch, 'stub-'));
  const stub = (body) => {
    const d = stubDir();
    writeFileSync(join(d, 'vitest.mjs'), body);
    return { dir: d, mjs: join(d, 'vitest.mjs') };
  };
  const deps = (s, over = {}) => ({ vitestMjsPath: () => s.mjs, cwd: s.dir, base: join(base, 'resume-tailor-regression'), env: childEnv(), ...over });
  test('§9 fixture 11: a stub vitest.mjs that exits 3 -> EXIT=3, process exits 3', { timeout: 60000 }, async () => {
    const s = stub('process.exitCode = 3;\n');
    const r = await invoke(encodeFormC([s.mjs, 'run', ...FIXED_FLAGS, 'kb/speaker.test.js']), deps(s));
    expect(r.lines[r.lines.length - 1]).toMatch(/^INVOKED EXIT=3 /);
    expect(r.exitCode).toBe(3);
  });
  test('§9 fixture 12: a stub that exits 1 with no JSON (the CACError shape) -> JSON=absent ISOLATED=inconclusive', { timeout: 60000 }, async () => {
    const s = stub("process.stderr.write('CACError: Unknown option');\nprocess.exitCode = 1;\n");
    const r = await invoke(encodeFormC([s.mjs, 'run', ...FIXED_FLAGS, 'kb/speaker.test.js']), deps(s));
    const last = r.lines[r.lines.length - 1];
    expect(last).toContain(' JSON=absent ');
    expect(last).toContain(' ISOLATED=inconclusive ');
  });
  test('§9 fixture 14: a stub sleeping past deps.timeoutMs = 1000 -> EXIT=timeout ISOLATED=inconclusive, exit 1, no surviving child', { timeout: 60000 }, async () => {
    const s = stub("import { writeFileSync } from 'node:fs';\nwriteFileSync(new URL('./pid.txt', import.meta.url), String(process.pid));\nsetTimeout(() => {}, 30000);\n");
    const r = await invoke(encodeFormC([s.mjs, 'run', ...FIXED_FLAGS, 'kb/speaker.test.js']), deps(s, { timeoutMs: 1000 }));
    const last = r.lines[r.lines.length - 1];
    expect(last).toMatch(/^INVOKED EXIT=timeout /);
    expect(last).toContain(' ISOLATED=inconclusive ');
    expect(r.exitCode).toBe(1);
    const pid = Number(readFileSync(join(s.dir, 'pid.txt'), 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
  });
  test('§9 fixture 12b: a stub that exits 0 with valid JSON reporting zero tests -> ISOLATED=inconclusive, never observed (T3-S9-12)', { timeout: 60000 }, async () => {
    const s = stub("import { writeFileSync } from 'node:fs';\nconst out = process.argv.find((a) => a.startsWith('--outputFile.json='));\nwriteFileSync(out.slice('--outputFile.json='.length), JSON.stringify({ numTotalTests: 0, testResults: [] }));\nprocess.exitCode = 0;\n");
    const r = await invoke(encodeFormC([s.mjs, 'run', ...FIXED_FLAGS, 'kb/speaker.test.js']), deps(s));
    const last = r.lines[r.lines.length - 1];
    expect(last).toMatch(/^INVOKED EXIT=0 JSON=present TESTS=0 FAILED=- ISOLATED=inconclusive /);
  });
  test('§9 fixture 13: NODE_OPTIONS=--require=<marker module> in the caller\'s env -> marker absent; a direct node --require writes it', { timeout: 180000 }, () => {
    const d = stubDir();
    const markerMod = join(d, 'marker.cjs');
    const marker = join(d, 'marker.txt');
    writeFileSync(markerMod, `if (/vitest\\.mjs$/.test(process.argv[1] || '')) require('fs').writeFileSync(${JSON.stringify(marker)}, 'x');\n`);
    cli(encodeFormC(OK()), { ...childEnv(), NODE_OPTIONS: `--require=${markerMod}` });
    expect(existsSync(marker)).toBe(false);
    spawnSync(process.execPath, ['--require', markerMod, VM, '--version'], { cwd: P.helloWorld, env: childEnv(), windowsHide: true });
    expect(existsSync(marker)).toBe(true);
  });
  test('§9 fixture 15: a real planted run with P "speaker labels" and its file filter -> JSON=present, TESTS > 0', { timeout: 180000 }, () => {
    const r = cli(encodeFormC([...OK(), '--testNamePattern=speaker labels']));
    const last = lastLine(r.stdout);
    expect(last).toMatch(/^INVOKED EXIT=0 JSON=present TESTS=[1-9][0-9]* /);
    expect(last).toContain(' ISOLATED=observed ');
  });
  test('§9 fixture 16: the INVOKED line\'s ENV_NAMES_SHA256 = envNamesSha256(vitestEnv(callerEnv))', { timeout: 180000 }, () => {
    const env = childEnv({ T3_EXTRA_NAME: '1', NODE_ENV: 'test' });
    const last = lastLine(cli(encodeFormC(OK()), env).stdout);
    expect(last.split(' ').find((t) => t.startsWith('ENV_NAMES_SHA256='))).toBe(`ENV_NAMES_SHA256=${envNamesSha256(vitestEnv(env))}`);
  });
});

describe('§9 fixture 17 and entry shape', () => {
  test('[canary] recursion-guard: the in-tree invoke.js refuses under VITEST with no run argument', { timeout: 60000 }, () => {
    const r = spawnSync(process.execPath, [join(HERE, 'invoke.js')], { env: { ...process.env, VITEST: 'true' }, encoding: 'utf8', timeout: 30000, windowsHide: true });
    expect(r.stderr).toContain('INVOKE: refused recursion-guard');
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
  });
  test('invoke argv: a typo flag and a --flag=value form return an error (§1)', () => {
    expect(parseArgs(['eyJhIjoxfQ==']).ok).toBe(true);
    expect(parseArgs(['--payload', 'x']).ok).toBe(false);
    expect(parseArgs(['--payload=x']).ok).toBe(false);
  });
});
