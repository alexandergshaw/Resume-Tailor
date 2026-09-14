// Lane A io.js hard-delete and lock guards (design §2, §10.3; T3-S9-3/T3-S9-6). Real fs throughout,
// scratch-only: every path this file writes lives under a fresh mkdtempSync directory, cleaned up
// after each test. Before this file, no `.test.js` imported `./io.js` directly at all - its guards
// were exercised only incidentally, through gate.js, launch.js and runner.js.
import { describe, test, expect, afterEach, vi } from 'vitest';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn as spawnMock } from 'node:child_process';
import {
  deleteRunDir, deleteCompanion, releaseOwnLock, takeOverLock,
  appendExisting, readLockText, sha256File, sha256Normalised, spawnVitest,
} from './io.js';
import { parseLock, formatLock } from './lockFile.js';

// spawnVitest's own spawn() call is not dependency-injected (§7.3), so the only way to observe what it
// actually passes to child_process.spawn is to intercept the real function and forward through to it -
// never a total fake, since the fixture below needs a real child process to actually exit.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, spawn: vi.fn((...args) => actual.spawn(...args)) };
});

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

describe('appendExisting missing-file guarantee (T3-S9-14)', () => {
  test('throws ENOENT and creates nothing when the target path does not exist (io.js:121, "S-2")', () => {
    const base = fresh();
    const p = join(base, 'status.txt');
    let err;
    try {
      appendExisting(p, 'text');
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.code).toBe('ENOENT');
    expect(existsSync(p)).toBe(false);
  });
  test('[positive control] appends to an existing file rather than refusing', () => {
    const base = fresh();
    const p = join(base, 'status.txt');
    writeFileSync(p, 'A');
    appendExisting(p, 'B');
    expect(readFileSync(p, 'utf8')).toBe('AB');
  });
});

describe('readLockText error-discrimination guard (T3-S9-15)', () => {
  test('re-throws a non-ENOENT read error instead of treating it as absent', () => {
    const err = Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
    const deps = { readFileSync: () => { throw err; } };
    expect(() => readLockText('/some/lock/path', deps)).toThrow(err);
  });
  test('[positive control] a genuinely missing lock reads as absent', () => {
    const enoent = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    const deps = { readFileSync: () => { throw enoent; } };
    expect(readLockText('/some/lock/path', deps)).toEqual({ state: 'absent' });
  });
});

describe('sha256Normalised CRLF invariance (T3-S9-16)', () => {
  test('hashes a CRLF copy the same as its LF original', () => {
    const base = fresh();
    const lfPath = join(base, 'lf.txt');
    const crlfPath = join(base, 'crlf.txt');
    const text = 'line one\nline two\nline three\n';
    writeFileSync(lfPath, text);
    writeFileSync(crlfPath, text.replace(/\n/g, '\r\n'));
    expect(sha256Normalised(crlfPath)).toBe(sha256Normalised(lfPath));
  });
  test('[positive control] sha256File (no normalisation) DOES differ between the CRLF and LF copies', () => {
    const base = fresh();
    const lfPath = join(base, 'lf.txt');
    const crlfPath = join(base, 'crlf.txt');
    const text = 'line one\nline two\nline three\n';
    writeFileSync(lfPath, text);
    writeFileSync(crlfPath, text.replace(/\n/g, '\r\n'));
    expect(sha256File(crlfPath)).not.toBe(sha256File(lfPath));
  });
});

describe('spawnVitest non-detached guarantee (T3-S9-17, T3-H2)', () => {
  test('spawns its vitest child with detached: false', async () => {
    const dir = fresh('io-spawn-');
    const script = join(dir, 'ok.mjs');
    writeFileSync(script, 'process.exitCode = 0;\n');
    spawnMock.mockClear();
    const res = await spawnVitest([script], { cwd: dir, stdoutPath: join(dir, 'out.txt'), stderrPath: join(dir, 'err.txt') });
    expect(res.status).toBe(0);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0][2]).toMatchObject({ detached: false });
  });
});

// Left unswept in this wave, named rather than silently skipped (T3-S9-6): io.js's `killTree` (spawns
// real taskkill.exe; needs a live child process to be a meaningful test, not a guard-shaped function),
// `git`/`toplevel` (already exercised indirectly via plantedRepo.js's own git init/commit calls),
// `readVitestVersion`/`vitestMjsPath` (covered by gate.test.js), and `walkFiles`/`corpusFiles`/
// `recordBase` (thin wrappers with no branch of safety consequence). `createExclusive`/`rewriteInPlace`
// have only a source-text ordering guard today (structure.test.js); no behavioural test of their own was
// added here. `appendExisting`, `readLockText`, `sha256Normalised` and `spawnVitest`'s non-detached
// guarantee now have direct behavioural tests above (T3-S9-14, T3-S9-15, T3-S9-16, T3-S9-17); `sha256File`
// is exercised as the CRLF invariance block's positive-control comparison, not separately pinned.
