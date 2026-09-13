// Lane A DEF-12 rows (AC DEF-12, A-18, A-19; G23) over planted git repositories. Each row gets its own root.
import { describe, test, expect, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fingerprint, parseArgs } from './fingerprint.js';
import { materializePlantedRepo, removePlantedRepo } from './plantedRepo.js';

const roots = [];
const scratch = [];
afterEach(() => {
  while (roots.length) removePlantedRepo(roots.pop());
  while (scratch.length) rmSync(scratch.pop(), { recursive: true, force: true });
});
const planted = () => {
  const r = materializePlantedRepo({ entries: [] }).root;
  roots.push(r);
  return r;
};
const plain = () => {
  const d = mkdtempSync(join(tmpdir(), 'rt-t3-fixture-'));
  scratch.push(d);
  return d;
};
const GITC = ['-c', 'user.name=t3', '-c', 'user.email=t3@invalid', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false'];
const git = (cwd, ...args) => execFileSync('git', [...GITC, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
const gitTry = (cwd, ...args) => spawnSync('git', [...GITC, ...args], { cwd, encoding: 'utf8', windowsHide: true });
const fp = async (cwd, deps) => fingerprint({ cwd }, deps);
const HEX = /^[0-9a-f]{64}$/;
const O = { timeout: 60000 };

describe('DEF-12', () => {
  test('DEF12 from a subdirectory cwd equals DEF12 from the root (A-18, G23)', O, async () => {
    const r = planted();
    writeFileSync(join(r, 'hello-world', 'untracked.txt'), 'x');
    const a = await fp(r);
    const b = await fp(join(r, 'hello-world'));
    expect(a.ok).toBe(true);
    expect(a.digest).toMatch(HEX);
    expect(b).toEqual(a);
  });
  test('a tracked file edited twice gives three distinct values from the subdirectory cwd (A-19 iv, G23 Y1)', O, async () => {
    const r = planted();
    const sub = join(r, 'hello-world');
    const v0 = (await fp(sub)).digest;
    appendFileSync(join(r, 'docs', 'REGRESSION.md'), '\nedit one\n');
    const v1 = (await fp(sub)).digest;
    appendFileSync(join(r, 'docs', 'REGRESSION.md'), '\nedit two\n');
    const v2 = (await fp(sub)).digest;
    expect(new Set([v0, v1, v2]).size).toBe(3);
  });
  test('a literal-D UD record is hashed, not ABSENT (T3-L42)', O, async () => {
    const r = planted();
    const main = git(r, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
    git(r, 'branch', 'side');
    appendFileSync(join(r, 'docs', 'REGRESSION.md'), '\nmain edit\n');
    git(r, 'commit', '-q', '-am', 'main');
    git(r, 'checkout', '-q', 'side');
    git(r, 'rm', '-q', 'docs/REGRESSION.md');
    git(r, 'commit', '-q', '-m', 'side');
    git(r, 'checkout', '-q', main);
    gitTry(r, 'merge', '-q', 'side');
    expect(git(r, 'status', '--porcelain=v1')).toContain('UD docs/REGRESSION.md');
    const a = await fp(r);
    appendFileSync(join(r, 'docs', 'REGRESSION.md'), '\nedited in conflict\n');
    const b = await fp(r);
    expect(a.ok && b.ok).toBe(true);
    expect(b.digest).not.toBe(a.digest);
  });
  test('DIR-NO-HASH only for a ?? directory ending / (T3-L47: fallback values need positive evidence): a nested repository is computable and blind inside (R8)', O, async () => {
    const r = planted();
    const nested = join(r, 'nested');
    mkdirSync(nested);
    git(nested, 'init', '-q');
    writeFileSync(join(nested, 'inner.txt'), 'one');
    expect(git(r, 'status', '--porcelain=v1', '-uall')).toContain('?? nested/');
    const a = await fp(r);
    writeFileSync(join(nested, 'inner.txt'), 'two');
    const b = await fp(r);
    expect(a.ok).toBe(true);
    expect(b.digest).toBe(a.digest);
  });
  test('a tracked file replaced by a directory: " D" is ABSENT and the new file inside is hashed (G23 Y6)', O, async () => {
    const r = planted();
    unlinkSync(join(r, 'docs', 'REGRESSION.md'));
    mkdirSync(join(r, 'docs', 'REGRESSION.md'));
    writeFileSync(join(r, 'docs', 'REGRESSION.md', 'inner.txt'), 'one');
    const a = await fp(r);
    writeFileSync(join(r, 'docs', 'REGRESSION.md', 'inner.txt'), 'two');
    const b = await fp(r);
    expect(a.ok && b.ok).toBe(true);
    expect(b.digest).not.toBe(a.digest);
  });
  test('a gitlink -> NOT-COMPUTABLE (R2, R12)', O, async () => {
    const r = planted();
    const sub = join(r, 'sub');
    mkdirSync(sub);
    git(sub, 'init', '-q');
    writeFileSync(join(sub, 'a.txt'), 'one');
    git(sub, 'add', 'a.txt');
    git(sub, 'commit', '-q', '-m', 'sub');
    gitTry(r, 'add', 'sub');
    git(r, 'commit', '-q', '-m', 'gitlink');
    writeFileSync(join(sub, 'a.txt'), 'two');
    expect(git(r, 'status', '--porcelain=v1')).toMatch(/ M sub/);
    expect((await fp(r)).ok).toBe(false);
  });
  test('an index-only git add moves the digest (R7)', O, async () => {
    const r = planted();
    appendFileSync(join(r, 'docs', 'REGRESSION.md'), '\nstaged\n');
    const a = await fp(r);
    git(r, 'add', 'docs/REGRESSION.md');
    const b = await fp(r);
    expect(b.digest).not.toBe(a.digest);
  });
  test('DEF-12 is computable while a scratch repo\'s index.lock is held, with the index mtime unchanged (--no-optional-locks, T3-H13)', O, async () => {
    const r = planted();
    appendFileSync(join(r, 'docs', 'REGRESSION.md'), '\nedit\n');
    const lock = join(r, '.git', 'index.lock');
    writeFileSync(lock, '');
    const before = statSync(join(r, '.git', 'index')).mtimeMs;
    const a = await fp(r);
    const after = statSync(join(r, '.git', 'index')).mtimeMs;
    unlinkSync(lock);
    expect(a.ok).toBe(true);
    expect(after).toBe(before);
  });
  test('a listed file removed between status and hash is not computable (A-19 vi, G23 Y7)', O, async () => {
    const r = planted();
    const target = join(r, 'vanishing.txt');
    writeFileSync(target, 'x');
    const deps = {
      git: (args, opts) => {
        if (args.includes('hash-object')) rmSync(target, { force: true });
        const res = spawnSync('git', args, { cwd: opts.cwd, encoding: 'buffer', windowsHide: true });
        return { status: res.status, stdout: res.stdout };
      },
    };
    expect((await fp(r, deps)).ok).toBe(false);
  });
  test('outside any repository -> NOT-COMPUTABLE (G23 Z)', O, async () => {
    expect((await fp(plain())).ok).toBe(false);
  });
  test('an unborn HEAD -> NOT-COMPUTABLE (DEF-12)', O, async () => {
    const d = plain();
    git(d, 'init', '-q');
    writeFileSync(join(d, 'a.txt'), 'x');
    expect((await fp(d)).ok).toBe(false);
  });
  test('fingerprint argv: a typo flag errors', () => {
    expect(parseArgs([]).ok).toBe(true);
    expect(parseArgs(['--cwdd', 'x']).ok).toBe(false);
    expect(parseArgs(['--cwd=x']).ok).toBe(false);
  });
});
