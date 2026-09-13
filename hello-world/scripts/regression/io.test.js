// Lane A io.js hard-delete and lock guards (design §2, §10.3; T3-S9-3/T3-S9-6). Real fs throughout,
// scratch-only: every path this file writes lives under a fresh mkdtempSync directory, cleaned up
// after each test. Before this file, no `.test.js` imported `./io.js` directly at all - its guards
// were exercised only incidentally, through gate.js, launch.js and runner.js.
import { describe, test, expect, afterEach } from 'vitest';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deleteRunDir, deleteCompanion, releaseOwnLock, takeOverLock } from './io.js';
import { parseLock, formatLock } from './lockFile.js';

const ID = '0123456789abcdef0123456789abcdef';
const OTHER = 'fedcba9876543210fedcba9876543210';
const lock = (over = {}) => formatLock({
  runId: ID, launcherPid: 111, timeoutS: 1800,
  launched: '2026-09-11T12:00:00.000Z', deadline: '2026-09-11T12:30:00.000Z', heartbeat: '2026-09-11T12:00:00.000Z',
  ...over,
});

const scratchDirs = [];
function fresh(prefix = 'io-test-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

describe('deleteRunDir hard-delete guard (T3-S9-3)', () => {
  test('refuses a name that fails the RUN_ID grammar, before touching the filesystem', () => {
    const base = fresh();
    expect(() => deleteRunDir(base, 'not-an-id')).toThrow('deleteRunDir: bad name');
  });
  test('refuses a plain FILE (not a directory) at the target path, and never deletes it', () => {
    const base = fresh();
    const p = join(base, ID);
    writeFileSync(p, 'marker');
    expect(() => deleteRunDir(base, ID)).toThrow('deleteRunDir: not a plain directory');
    expect(readFileSync(p, 'utf8')).toBe('marker');
  });
  test('refuses a directory JUNCTION at the target path, and never touches the junction\'s target (T3-S9-3)', () => {
    const base = fresh();
    const target = fresh('io-test-target-');
    writeFileSync(join(target, 'marker.txt'), 'do-not-delete');
    const link = join(base, ID);
    symlinkSync(target, link, 'junction');
    expect(() => deleteRunDir(base, ID)).toThrow('deleteRunDir: not a plain directory');
    expect(existsSync(link)).toBe(true);
    expect(readFileSync(join(target, 'marker.txt'), 'utf8')).toBe('do-not-delete');
  });
  test('[positive control] a genuine plain directory IS removed (the guard does not block a legitimate delete)', () => {
    const base = fresh();
    const dir = join(base, ID);
    mkdirSync(dir);
    writeFileSync(join(dir, 'f.txt'), 'x');
    deleteRunDir(base, ID);
    expect(existsSync(dir)).toBe(false);
  });
});

describe('deleteCompanion grammar guard', () => {
  test('refuses a name outside the companion grammar', () => {
    const base = fresh();
    expect(() => deleteCompanion(base, 'not-a-companion.txt')).toThrow('deleteCompanion: bad name');
  });
  test('[positive control] a real companion file is removed', () => {
    const base = fresh();
    const name = `${ID}.launcher.out.txt`;
    writeFileSync(join(base, name), 'x');
    deleteCompanion(base, name);
    expect(existsSync(join(base, name))).toBe(false);
  });
});

describe('releaseOwnLock ownership guard (T3-S9-6)', () => {
  test('never releases a lock owned by a DIFFERENT run ID', () => {
    const base = fresh();
    const lockPath = join(base, 'lock.txt');
    const text = lock({ runId: OTHER });
    writeFileSync(lockPath, text);
    releaseOwnLock(lockPath, ID, parseLock);
    expect(existsSync(lockPath)).toBe(true);
    expect(readFileSync(lockPath, 'utf8')).toBe(text);
  });
  test('[positive control] releases a lock owned by the given run ID', () => {
    const base = fresh();
    const lockPath = join(base, 'lock.txt');
    writeFileSync(lockPath, lock({ runId: ID }));
    releaseOwnLock(lockPath, ID, parseLock);
    expect(existsSync(lockPath)).toBe(false);
  });
  test('a missing lock is a no-op, not a throw', () => {
    const base = fresh();
    expect(() => releaseOwnLock(join(base, 'lock.txt'), ID, parseLock)).not.toThrow();
  });
});

describe('takeOverLock byte-exact staleness guard (T3-S9-6)', () => {
  test('refuses when the current lock bytes differ from the staleBytes it read (the lock moved since)', () => {
    const base = fresh();
    const lockPath = join(base, 'lock.txt');
    const staleText = lock({ heartbeat: '2026-09-11T12:00:00.000Z' });
    const freshText = lock({ heartbeat: '2026-09-11T12:05:00.000Z' });
    writeFileSync(lockPath, freshText);
    const priorPath = join(base, 'prior-lock.txt');
    const result = takeOverLock(lockPath, staleText, priorPath);
    expect(result).toEqual({ ok: false });
    expect(existsSync(lockPath)).toBe(true);
    expect(readFileSync(lockPath, 'utf8')).toBe(freshText);
    expect(existsSync(priorPath)).toBe(false);
  });
  test('[positive control] takes over when the current lock bytes exactly match staleBytes', () => {
    const base = fresh();
    const lockPath = join(base, 'lock.txt');
    const staleText = lock();
    writeFileSync(lockPath, staleText);
    const priorPath = join(base, 'prior-lock.txt');
    const result = takeOverLock(lockPath, staleText, priorPath);
    expect(result).toEqual({ ok: true });
    expect(existsSync(lockPath)).toBe(false);
    expect(readFileSync(priorPath, 'utf8')).toBe(staleText);
  });
  test('refuses when the lock is absent', () => {
    const base = fresh();
    const result = takeOverLock(join(base, 'lock.txt'), lock(), join(base, 'prior-lock.txt'));
    expect(result).toEqual({ ok: false });
  });
});

// Left unswept in this wave, named rather than silently skipped (T3-S9-6): io.js's `killTree` (spawns
// real taskkill.exe; needs a live child process to be a meaningful test, not a guard-shaped function),
// `git`/`toplevel` (already exercised indirectly via plantedRepo.js's own git init/commit calls),
// `spawnVitest` (covered by runner.test.js), `readVitestVersion`/`vitestMjsPath` (covered by
// gate.test.js), and `walkFiles`/`corpusFiles`/`sha256File`/`sha256Normalised`/`recordBase` (thin
// wrappers with no branch of safety consequence). `createExclusive`/`appendExisting`/`rewriteInPlace`/
// `readLockText` have only a source-text ordering guard today (structure.test.js); no behavioural test
// of their own was added here.
