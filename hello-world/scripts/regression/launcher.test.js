// Lane A launcher rows (design §2, §3, §10, §13.2-§13.3; AC A-15, A-21b). In-process rows call
// launch(opts, deps) against a scratch base; process rows run the §13.2 PowerShell data copies against
// planted processes, with TEMP pointed at the scratch base (never the live record base, T3-OPS-7).
import { describe, test, expect, afterAll } from 'vitest';
import { EventEmitter } from 'node:events';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, parseArgs } from './launch.js';
import { gate } from './gate.js';
import { TIMING, KEEP_RUNS, selectForRetention, vitestEnv } from './launchPolicy.js';
import { materializePlantedRepo, removePlantedRepo } from './plantedRepo.js';

const { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } = fs;
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const FIX = join(HERE, 'fixtures');
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const TOP = `${tmpdir().replace(/\\/g, '/')}/rt-t3-fixture-toplevel`;
const LOCK = `lock-${sha(TOP)}`;
const REAL_TOP = execFileSync('git', ['-C', HERE, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).split('\n')[0].trim();
const GATE_LOCK = `lock-${sha(REAL_TOP)}`;
const FAST = { ...TIMING, HEARTBEAT_S: 0.05, STALE_S: 1, SECOND_READ_S: 0.2, VERIFY_S: 0.05, LOCK_READ_GAP_S: 0.01, KILL_WAIT_S: 0.5, TIMEOUT_S: 60, GRACE_S: 1 };
const INTEGRITY = 'EXIT=0 FILES=2 CASES=4';
const newId = () => randomBytes(16).toString('hex');
const iso = (ms) => new Date(ms).toISOString();
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await pause(100);
  }
  throw new Error('waitFor: condition never held');
}
const scratch = [];
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});
function setup() {
  const temp = mkdtempSync(join(tmpdir(), 'rt-t3-fixture-'));
  scratch.push(temp);
  const base = join(temp, 'resume-tailor-regression');
  mkdirSync(base);
  const chunk = join(temp, 'chunk');
  mkdirSync(chunk);
  const id = newId();
  const mint = join(chunk, `bucket-b.${id}.mint`);
  writeFileSync(mint, `RUN_ID=${id}\n`);
  return { temp, base, chunk, id, mint };
}
// A stand-in runner child: an EventEmitter with a pid; it exits after exitAfterMs, or when killTree is called.
function fakeRunner({ exitAfterMs = 30, code = 0 } = {}) {
  const spawned = [];
  const fn = (execPath, args, options) => {
    const c = new EventEmitter();
    c.pid = 900000 + spawned.length;
    c.args = args;
    c.options = options;
    spawned.push(c);
    if (exitAfterMs !== null) setTimeout(() => c.emit('exit', code, null), exitAfterMs);
    return c;
  };
  fn.spawned = spawned;
  return fn;
}
function depsFor(s, over = {}) {
  const runner = over.spawn || fakeRunner();
  const errs = [];
  const killed = [];
  const deps = {
    base: s.base,
    toplevel: () => TOP,
    timing: FAST,
    spawn: runner,
    stderr: (l) => errs.push(l),
    killTree: (pid) => {
      killed.push(pid);
      const c = runner.spawned?.find((x) => x.pid === pid);
      if (c) setTimeout(() => c.emit('exit', null, 'SIGTERM'), 5);
      return { ok: true };
    },
    ...over,
  };
  return { deps, errs, killed, runner };
}
const lockText = ({ runId, pid = 4242, launched = Date.now(), heartbeat = Date.now(), deadline = launched + 1860000 }) =>
  `T3_LOCK=v1\nRUN_ID=${runId}\nLAUNCHER_PID=${pid}\nTIMEOUT_S=1800\nLAUNCHED=${iso(launched)}\nDEADLINE=${iso(deadline)}\nHEARTBEAT=${iso(heartbeat)}\n`;
const finishedDir = (base, id) => {
  mkdirSync(join(base, id));
  writeFileSync(join(base, id, 'status.txt'), 'T3_STATUS=v1\n--- exit ---\nEXIT=0\n--- end ---\n');
};
const statusOf = (s) => readFileSync(join(s.base, s.id, 'status.txt'), 'utf8');
const exitField = (text, key) => (new RegExp(`^${key}=(.*)$`, 'm').exec(text) || [])[1];

// Runbook one-liner (C), byte for byte from its data copy, with line 1 substituted (§13.2; T3-D3-19).
const CBLOCK = readFileSync(join(FIX, 'planted-bodies', 'runbook-c-block.txt'), 'utf8').replace(/\r\n/g, '\n').split('\n');
function runC(temp, id, { kill = false, known = '' } = {}) {
  const ps1 = join(temp, `c-${randomBytes(4).toString('hex')}.ps1`);
  writeFileSync(ps1, [`$run = '${id}'; $kill = ${kill ? '$true' : '$false'}; $knownText = '${known}'`, ...CBLOCK.slice(1)].join('\r\n'));
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1],
    { env: { ...process.env, TEMP: temp, TMP: temp }, encoding: 'utf8', timeout: 180000, windowsHide: true });
  const lines = r.stdout.split(/\r?\n/);
  const num = (k) => {
    const l = lines.find((x) => x.startsWith(`${k}=`));
    return l === undefined ? null : Number(l.slice(k.length + 1).split(' ')[0]);
  };
  const tokens = lines.filter((l) => l.startsWith('SURVIVOR ')).map((l) => l.split(' ')[1]);
  const captured = (lines.find((l) => l.startsWith('CAPTURED=')) || 'CAPTURED=0').split(' ').slice(1).filter(Boolean);
  return {
    out: r.stdout, err: r.stderr, survivors: num('SURVIVORS'), afterTreeKill: num('SURVIVORS_AFTER_TREE_KILL'), capturedCount: num('CAPTURED'),
    tokens, pids: tokens.map((t) => Number(t.split('@')[0])), capturedPids: captured.map((t) => Number(t.split('@')[0])),
  };
}

describe('§2.5 L0-L5', () => {
  test.each([[[]], [['--mint', 'm']], [['--mint', 'm', '--integrity', 'v', '--x', '1']]])('L0: %j -> refused argv', (argv) => {
    expect(parseArgs(argv).ok).toBe(false);
  });
  test('L0: a missing mint -> refused mint-missing, nothing created', async () => {
    const s = setup();
    expect(await launch({ mint: join(s.chunk, 'nope.mint'), integrity: INTEGRITY }, depsFor(s).deps)).toMatchObject({ refused: 'mint-missing' });
    expect(readdirSync(s.base)).toEqual([]);
  });
  test('L0: a UTF-16LE mint -> refused mint-invalid', async () => {
    const s = setup();
    writeFileSync(s.mint, Buffer.from(`RUN_ID=${s.id}\n`, 'utf16le'));
    expect(await launch({ mint: s.mint, integrity: INTEGRITY }, depsFor(s).deps)).toMatchObject({ refused: 'mint-invalid' });
  });
  test('L0: a mint whose RUN_ID fails the grammar -> refused id-invalid', async () => {
    const s = setup();
    writeFileSync(s.mint, 'RUN_ID=ABCDEF\n');
    expect(await launch({ mint: s.mint, integrity: INTEGRITY }, depsFor(s).deps)).toMatchObject({ refused: 'id-invalid' });
  });
  test('L0: EXIT=1 FILES=0 CASES=0 -> integrity-invalid, no lock, no run directory (a FILES=0 integrity line is a launcher refusal, T3-1d-16)', async () => {
    const s = setup();
    expect(await launch({ mint: s.mint, integrity: 'EXIT=1 FILES=0 CASES=0' }, depsFor(s).deps)).toMatchObject({ refused: 'integrity-invalid' });
    expect(readdirSync(s.base)).toEqual([]);
  });
  test('L0: an integrity value outside the grammar -> integrity-invalid', async () => {
    const s = setup();
    expect(await launch({ mint: s.mint, integrity: 'garbage' }, depsFor(s).deps)).toMatchObject({ refused: 'integrity-invalid' });
  });
  test('L0: EXIT=1 with FILES and CASES above 0 is not refused here (the runner decides INCONCLUSIVE(f))', async () => {
    const s = setup();
    expect(await launch({ mint: s.mint, integrity: 'EXIT=1 FILES=2 CASES=4' }, depsFor(s).deps)).toMatchObject({ exit: '0' });
  });
  test('L1 base-location: a base outside os.tmpdir() is refused before any write', async () => {
    const s = setup();
    const outside = join(REPO, 'hello-world', 'not-a-t3-base');
    expect(await launch({ mint: s.mint, integrity: INTEGRITY }, depsFor(s, { base: outside }).deps)).toMatchObject({ refused: 'base-location' });
    expect(existsSync(outside)).toBe(false);
  });
  test('L1 base-location: a base inside the git toplevel is refused', async () => {
    const s = setup();
    expect(await launch({ mint: s.mint, integrity: INTEGRITY }, depsFor(s, { toplevel: () => s.temp.replace(/\\/g, '/') }).deps)).toMatchObject({ refused: 'base-location' });
  });
  test('L3 (a): an unparseable lock -> refused lock-unreadable', async () => {
    const s = setup();
    writeFileSync(join(s.base, LOCK), 'garbage\n');
    expect(await launch({ mint: s.mint, integrity: INTEGRITY }, depsFor(s).deps)).toMatchObject({ refused: 'lock-unreadable' });
  });
  test('L3 (b): a lock holding the own ID -> refused id-reused', async () => {
    const s = setup();
    writeFileSync(join(s.base, LOCK), lockText({ runId: s.id }));
    expect(await launch({ mint: s.mint, integrity: INTEGRITY }, depsFor(s).deps)).toMatchObject({ refused: 'id-reused' });
  });
  test('L3 (c): an EXIT-stale lock is taken over now, and B\\<own ID>.prior-lock.txt holds the stale bytes (§2.8 fixture 7)', async () => {
    const s = setup();
    const other = newId();
    finishedDir(s.base, other);
    const stale = lockText({ runId: other });
    writeFileSync(join(s.base, LOCK), stale);
    expect(await launch({ mint: s.mint, integrity: INTEGRITY }, depsFor(s).deps)).toMatchObject({ exit: '0' });
    expect(readFileSync(join(s.base, `${s.id}.prior-lock.txt`), 'utf8')).toBe(stale);
    expect(readFileSync(join(s.base, LOCK), 'utf8')).toMatch(new RegExp(`^RUN_ID=${s.id}$`, 'm'));
  });
  test('L3 (d): a heartbeat-stale lock unchanged across the second read is taken over', async () => {
    const s = setup();
    writeFileSync(join(s.base, LOCK), lockText({ runId: newId(), heartbeat: Date.now() - 10000 }));
    expect(await launch({ mint: s.mint, integrity: INTEGRITY }, depsFor(s).deps)).toMatchObject({ exit: '0' });
  });
  test('L3 (e): a live lock -> refused concurrent-run lock-run=<L-2>', async () => {
    const s = setup();
    const other = newId();
    writeFileSync(join(s.base, LOCK), lockText({ runId: other }));
    const d = depsFor(s);
    expect(await launch({ mint: s.mint, integrity: INTEGRITY }, d.deps)).toMatchObject({ refused: 'concurrent-run' });
    expect(d.errs.join('\n')).toContain(`LAUNCHER: refused concurrent-run lock-run=${other}`);
  });
  test('L5 id-reused releases only its own lock', async () => {
    const s = setup();
    mkdirSync(join(s.base, s.id));
    expect(await launch({ mint: s.mint, integrity: INTEGRITY }, depsFor(s).deps)).toMatchObject({ refused: 'id-reused' });
    expect(existsSync(join(s.base, LOCK))).toBe(false);
  });
});

describe('§2.8 interleavings (injected through deps)', () => {
  test('§2.8 fixture 1: two launches from two mint folders -> the second refuses concurrent-run', async () => {
    const s = setup();
    const a = depsFor(s, { spawn: fakeRunner({ exitAfterMs: null }) });
    const first = launch({ mint: s.mint, integrity: INTEGRITY }, a.deps);
    await waitFor(() => a.runner.spawned.length === 1, 10000);
    const s2 = { ...setup(), base: s.base };
    expect(await launch({ mint: s2.mint, integrity: INTEGRITY }, depsFor(s2).deps)).toMatchObject({ refused: 'concurrent-run' });
    a.runner.spawned[0].emit('exit', 0, null);
    expect(await first).toMatchObject({ exit: '0' });
  });
  test('§2.8 fixture 2: an EXIT-stale lock -> taken over with no 15 s wait', { timeout: 30000 }, async () => {
    const s = setup();
    const other = newId();
    finishedDir(s.base, other);
    writeFileSync(join(s.base, LOCK), lockText({ runId: other }));
    const t = Date.now();
    expect(await launch({ mint: s.mint, integrity: INTEGRITY }, depsFor(s, { timing: { ...FAST, SECOND_READ_S: 15 } }).deps)).toMatchObject({ exit: '0' });
    expect(Date.now() - t).toBeLessThan(10000);
  });
  test('§2.8 fixture 3: a heartbeat-stale lock that turns fresh between the two reads -> refused', async () => {
    const s = setup();
    const other = newId();
    writeFileSync(join(s.base, LOCK), lockText({ runId: other, heartbeat: Date.now() - 10000 }));
    const sleep = async (ms) => {
      if (ms === FAST.SECOND_READ_S * 1000) writeFileSync(join(s.base, LOCK), lockText({ runId: other }));
      await pause(ms);
    };
    expect(await launch({ mint: s.mint, integrity: INTEGRITY }, depsFor(s, { sleep }).deps)).toMatchObject({ refused: 'concurrent-run' });
  });
  test('§2.8 fixture 4: an injected rename-after-create by a second taker -> the first refuses at L4', async () => {
    const s = setup();
    const d = depsFor(s, {
      sleep: async (ms) => {
        if (ms === FAST.VERIFY_S * 1000) writeFileSync(join(s.base, LOCK), lockText({ runId: newId() }));
        await pause(ms);
      },
    });
    expect(await launch({ mint: s.mint, integrity: INTEGRITY }, d.deps)).toMatchObject({ refused: 'concurrent-run' });
    expect(d.runner.spawned.length).toBe(0);
  });
  test('§2.8 fixture 5: a lock replaced mid-run -> the old launcher writes EXIT=lock-lost and its runner is gone', async () => {
    const s = setup();
    const d = depsFor(s, { spawn: fakeRunner({ exitAfterMs: null }) });
    const p = launch({ mint: s.mint, integrity: INTEGRITY }, d.deps);
    await waitFor(() => d.runner.spawned.length === 1, 10000);
    writeFileSync(join(s.base, LOCK), lockText({ runId: newId() }));
    expect(await p).toMatchObject({ exit: 'lock-lost' });
    expect(d.killed).toContain(d.runner.spawned[0].pid);
    expect(exitField(statusOf(s), 'EXIT')).toBe('lock-lost');
  });
  test('§2.8 fixture 6: a resumed launcher\'s tick after a takeover writes nothing to L and ends EXIT=lock-lost', async () => {
    const s = setup();
    const d = depsFor(s, { spawn: fakeRunner({ exitAfterMs: null }) });
    const p = launch({ mint: s.mint, integrity: INTEGRITY }, d.deps);
    await waitFor(() => d.runner.spawned.length === 1, 10000);
    const theirs = lockText({ runId: newId() });
    writeFileSync(join(s.base, LOCK), theirs);
    await p;
    expect(readFileSync(join(s.base, LOCK), 'utf8')).toBe(theirs);
  });
  test('§2.8 fixture 7: takeover evidence: B\\<new ID>.prior-lock.txt holds the stale bytes', async () => {
    const s = setup();
    const other = newId();
    finishedDir(s.base, other);
    const stale = lockText({ runId: other, pid: 31337 });
    writeFileSync(join(s.base, LOCK), stale);
    await launch({ mint: s.mint, integrity: INTEGRITY }, depsFor(s).deps);
    expect(readFileSync(join(s.base, `${s.id}.prior-lock.txt`), 'utf8')).toBe(stale);
  });
  test('§2.8 fixture 8: 3 consecutive injected write failures -> lock-lost', async () => {
    const s = setup();
    let lockWrites = 0;
    const dfs = { ...fs, writeSync: (fd, buf, ...rest) => {
      if (String(buf).startsWith('T3_LOCK=v1') && ++lockWrites > 1) throw Object.assign(new Error('EIO injected'), { code: 'EIO' });
      return fs.writeSync(fd, buf, ...rest);
    } };
    const d = depsFor(s, { spawn: fakeRunner({ exitAfterMs: null }), fs: dfs });
    expect(await launch({ mint: s.mint, integrity: INTEGRITY }, d.deps)).toMatchObject({ exit: 'lock-lost' });
  });
  test('§2.8 fixture 9: lock-lost during retention -> no runner spawned, EXIT=lock-lost, WAITED_PID=-', async () => {
    const s = setup();
    const d = depsFor(s, {
      retention: async () => {
        writeFileSync(join(s.base, LOCK), lockText({ runId: newId() }));
        await pause(400);
      },
    });
    expect(await launch({ mint: s.mint, integrity: INTEGRITY }, d.deps)).toMatchObject({ exit: 'lock-lost' });
    expect(d.runner.spawned.length).toBe(0);
    expect(exitField(statusOf(s), 'WAITED_PID')).toBe('-');
  });
});

describe('§10 retention', () => {
  const entry = (name, over = {}) => ({ name, isDirectory: true, isReparsePoint: false, finished: true, birthtimeMs: 1000, ...over });
  test('retention: 12 finished runs -> the oldest 2 are selected (§10.2, pure)', () => {
    const ids = Array.from({ length: 12 }, () => newId());
    const list = ids.map((n, i) => entry(n, { birthtimeMs: 1000 + i }));
    expect(KEEP_RUNS).toBe(10);
    expect(selectForRetention(list, { lockedIds: [], currentId: newId() }).sort()).toEqual(ids.slice(0, 2).sort());
  });
  test('retention: an unfinished, locked, reparse-point, uppercase, 31-hex or non-ID entry is never selected (§10.2, pure)', () => {
    const old = Array.from({ length: 12 }, (_, i) => entry(newId(), { birthtimeMs: 5000 + i }));
    const locked = newId();
    const odd = [entry(newId(), { finished: false, birthtimeMs: 1 }), entry(locked, { birthtimeMs: 2 }), entry(newId(), { isReparsePoint: true, isDirectory: false, birthtimeMs: 3 }),
      entry(newId().toUpperCase(), { birthtimeMs: 4 }), entry(newId().slice(1), { birthtimeMs: 5 }), entry('notes', { birthtimeMs: 6 })];
    const got = selectForRetention([...old, ...odd], { lockedIds: [locked], currentId: newId() });
    expect(got.sort()).toEqual(old.slice(0, 2).map((e) => e.name).sort());
  });
  test('retention: 12 finished runs -> the oldest 2 and their companions deleted; the listed survivors survive; EBUSY is logged and skipped (§10.2)', { timeout: 60000 }, async () => {
    const s = setup();
    const ids = [];
    for (let i = 0; i < 12; i++) {
      const id = newId();
      ids.push(id);
      finishedDir(s.base, id);
      for (const c of ['launcher.out.txt', 'launcher.err.txt', 'prior-lock.txt']) writeFileSync(join(s.base, `${id}.${c}`), 'x');
      await pause(20);
    }
    const unfinished = newId();
    mkdirSync(join(s.base, unfinished));
    writeFileSync(join(s.base, unfinished, 'status.txt'), 'T3_STATUS=v1\n');
    const lockedId = newId();
    finishedDir(s.base, lockedId);
    writeFileSync(join(s.base, 'lock-othertree'), lockText({ runId: lockedId }));
    const target = join(s.temp, 'jtarget');
    finishedDir(s.temp, 'jtarget');
    const junction = newId();
    symlinkSync(target, join(s.base, junction), 'junction');
    for (const n of [newId().toUpperCase(), newId().slice(1), 'notes']) finishedDir(s.base, n);
    const keepFiles = [`iso-${newId()}.json`, `hand-${newId()}.out.txt`, `${ids[5]}.launcher.out.txt`, `${newId()}.launcher.err.txt`];
    for (const f of keepFiles) writeFileSync(join(s.base, f), 'x');
    const busy = ids[1];
    const dfs = { ...fs, rmSync: (p, o) => {
      if (p.endsWith(busy)) throw Object.assign(new Error('EBUSY injected'), { code: 'EBUSY' });
      return fs.rmSync(p, o);
    } };
    const d = depsFor(s, { fs: dfs });
    expect(await launch({ mint: s.mint, integrity: INTEGRITY }, d.deps)).toMatchObject({ exit: '0' });
    expect(existsSync(join(s.base, ids[0]))).toBe(false);
    for (const c of ['launcher.out.txt', 'launcher.err.txt', 'prior-lock.txt']) expect(existsSync(join(s.base, `${ids[0]}.${c}`))).toBe(false);
    expect(existsSync(join(s.base, busy))).toBe(true);
    expect(existsSync(join(s.base, `${busy}.launcher.out.txt`))).toBe(true);
    expect(d.errs.some((l) => l.startsWith('LAUNCHER: retention'))).toBe(true);
    for (const id of ids.slice(2)) expect(existsSync(join(s.base, id))).toBe(true);
    for (const n of [unfinished, lockedId, junction, 'notes', 'lock-othertree', ...keepFiles]) expect(existsSync(join(s.base, n)), n).toBe(true);
    expect(existsSync(join(target, 'status.txt'))).toBe(true);
    unlinkSync(join(s.base, junction));
  });
});

describe('§2.7 kills and survivor verification (runbook one-liner (C) byte for byte)', () => {
  test('timeout kill: EXIT=timeout, KILL=ok, EXIT only after the runner\'s exit event; (C) before lists runner and grandchild; (C) after with the captured tokens -> SURVIVORS=0 (§2.7, R14-2)', { timeout: 180000 }, async () => {
    const s = setup();
    const stub = join(s.temp, 'stub-runner.mjs');
    writeFileSync(stub, [
      "import { appendFileSync, writeFileSync } from 'node:fs';",
      "import { spawn } from 'node:child_process';",
      "import { join } from 'node:path';",
      'const a = process.argv;',
      "const id = a[a.indexOf('--run-id') + 1];",
      "const dir = a[a.indexOf('--record-dir') + 1];",
      "appendFileSync(join(dir, 'status.txt'), '--- spawn ---\\nRUN_ID=' + id + '\\nRUNNER_PID=' + process.pid + '\\n');",
      "const g = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 90000)'], { stdio: 'ignore', windowsHide: true });",
      "writeFileSync(join(dir, 'grand.pid'), String(g.pid));",
      'setInterval(() => {}, 1000);',
    ].join('\n'));
    const { deps } = depsFor(s, { timing: { ...FAST, TIMEOUT_S: 10, GRACE_S: 1, HEARTBEAT_S: 0.5, KILL_WAIT_S: 5 }, runnerPath: stub });
    delete deps.spawn;
    delete deps.killTree;
    const p = launch({ mint: s.mint, integrity: INTEGRITY }, deps);
    await waitFor(() => existsSync(join(s.base, s.id, 'grand.pid')), 30000);
    const runnerPid = Number(exitField(statusOf(s), 'RUNNER_PID'));
    const grandPid = Number(readFileSync(join(s.base, s.id, 'grand.pid'), 'utf8'));
    const before = runC(s.temp, s.id);
    expect(before.pids).toEqual(expect.arrayContaining([runnerPid, grandPid]));
    expect(await p).toMatchObject({ exit: 'timeout' });
    const st = statusOf(s);
    expect(exitField(st, 'EXIT')).toBe('timeout');
    expect(exitField(st, 'KILL')).toBe('ok');
    expect(alive(runnerPid)).toBe(false);
    const after = runC(s.temp, s.id, { known: before.tokens.join(' ') });
    expect(after.survivors).toBe(0);
    expect(alive(grandPid)).toBe(false);
  });

  test('overdue kill: (C) kill mode captures launcher, runner, vitest and >= 1 worker; SURVIVORS_AFTER_TREE_KILL=0 and SURVIVORS=0; the gate then reads i:launcher-lost (§2.7)', { timeout: 300000 }, async () => {
    const s = setup();
    const P = materializePlantedRepo({ entries: [], files: { 'hello-world/slow/slow.test.js': "import { test } from 'vitest';\ntest('slow', async () => { await new Promise((r) => setTimeout(r, 120000)); }, 150000);\n" } });
    try {
      const runner = join(s.temp, 'stub-runner2.mjs');
      writeFileSync(runner, [
        "import { appendFileSync, writeFileSync } from 'node:fs';",
        "import { spawn } from 'node:child_process';",
        "import { join } from 'node:path';",
        'const [id, dir, hw] = process.argv.slice(2);',
        "appendFileSync(join(dir, 'status.txt'), '--- spawn ---\\nRUN_ID=' + id + '\\nRUNNER_PID=' + process.pid + '\\n');",
        "spawn(process.execPath, [join(hw, 'node_modules', 'vitest', 'vitest.mjs'), 'run', 'slow/slow.test.js'], { cwd: hw, stdio: 'ignore', windowsHide: true });",
        "setTimeout(() => writeFileSync(join(dir, 'worker.ready'), 'x'), 8000);",
        'setInterval(() => {}, 1000);',
      ].join('\n'));
      const launcher = join(s.temp, 'stub-launcher.mjs');
      writeFileSync(launcher, [
        "import { closeSync, mkdirSync, openSync, writeFileSync, writeSync } from 'node:fs';",
        "import { spawn } from 'node:child_process';",
        "import { join } from 'node:path';",
        'const [id, lockPath, dir, hw, runnerPath] = process.argv.slice(2);',
        'const iso = (ms) => new Date(ms).toISOString();',
        'const t0 = Date.now() - 10000;',
        'mkdirSync(dir, { recursive: true });',
        "writeFileSync(join(dir, 'status.txt'), 'T3_STATUS=v1\\n');",
        "const lock = () => 'T3_LOCK=v1\\nRUN_ID=' + id + '\\nLAUNCHER_PID=' + process.pid + '\\nTIMEOUT_S=1\\nLAUNCHED=' + iso(t0) + '\\nDEADLINE=' + iso(t0 + 1000) + '\\nHEARTBEAT=' + iso(Date.now()) + '\\n';",
        'writeFileSync(lockPath, lock());',
        "setInterval(() => { const fd = openSync(lockPath, 'r+'); writeSync(fd, lock(), 0); closeSync(fd); }, 1000);",
        "spawn(process.execPath, [runnerPath, id, dir, hw], { stdio: 'ignore', windowsHide: true });",
      ].join('\n'));
      const child = spawn(process.execPath, [launcher, s.id, join(s.base, GATE_LOCK), join(s.base, s.id), P.helloWorld, runner],
        { detached: true, stdio: 'ignore', windowsHide: true, env: vitestEnv(process.env) });
      child.unref();
      await waitFor(() => existsSync(join(s.base, s.id, 'worker.ready')), 90000);
      const gdeps = { timing: { ...TIMING, OVERDUE_RECHECK_S: 2, SECOND_READ_S: 2, STALE_S: 5 } };
      const g1 = (await gate({ mint: s.mint, recordBase: s.base }, gdeps)).line;
      expect(g1).toMatch(new RegExp(`^GATE=inconclusive REASONS=overdue:${child.pid} `));
      const c = runC(s.temp, s.id, { kill: true });
      expect(c.capturedPids).toContain(child.pid);
      expect(c.capturedCount).toBeGreaterThanOrEqual(4);
      expect(c.afterTreeKill).toBe(0);
      expect(c.survivors).toBe(0);
      await pause(7000);
      expect((await gate({ mint: s.mint, recordBase: s.base }, gdeps)).line).toMatch(/^GATE=inconclusive REASONS=i:launcher-lost /);
    } finally {
      removePlantedRepo(P.root);
    }
  });

  test('negative: a lock naming another live PID -> nothing captured or killed (§2.7 identity check)', { timeout: 120000 }, () => {
    const s = setup();
    const idle = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore', windowsHide: true });
    try {
      writeFileSync(join(s.base, 'lock-negative'), lockText({ runId: s.id, pid: idle.pid, launched: Date.now() - 60000 }));
      const c = runC(s.temp, s.id, { kill: true });
      expect(c.capturedCount).toBe(0);
      expect(alive(idle.pid)).toBe(true);
    } finally {
      idle.kill();
    }
  });

  test('R14-2 positive power: a detached grandchild under a killed intermediate is DETECTED when the captured tokens are passed as $knownText text, and NOT listed without them (§2.7.1)', { timeout: 180000 }, async () => {
    const s = setup();
    const dir = join(s.base, s.id);
    mkdirSync(dir);
    writeFileSync(join(dir, 'status.txt'), 'T3_STATUS=v1\n');
    const cFile = join(s.temp, 'chain-c.mjs');
    writeFileSync(cFile, 'setInterval(() => {}, 1000);\n');
    const bFile = join(s.temp, 'chain-b.mjs');
    writeFileSync(bFile, [
      "import { spawn } from 'node:child_process';",
      "import { writeFileSync } from 'node:fs';",
      'const [cPath, out] = process.argv.slice(2);',
      "const c = spawn(process.execPath, [cPath], { detached: true, stdio: 'ignore', windowsHide: true });",
      'c.unref();',
      'writeFileSync(out, String(c.pid));',
      'setInterval(() => {}, 1000);',
    ].join('\n'));
    const rFile = join(s.temp, 'chain-r.mjs');
    writeFileSync(rFile, [
      "import { appendFileSync, writeFileSync } from 'node:fs';",
      "import { spawn } from 'node:child_process';",
      "import { join } from 'node:path';",
      'const [id, dir, bPath, cPath] = process.argv.slice(2);',
      "appendFileSync(join(dir, 'status.txt'), '--- spawn ---\\nRUN_ID=' + id + '\\nRUNNER_PID=' + process.pid + '\\n');",
      "const b = spawn(process.execPath, [bPath, cPath, join(dir, 'c.pid')], { stdio: 'ignore', windowsHide: true });",
      "writeFileSync(join(dir, 'b.pid'), String(b.pid));",
      'setInterval(() => {}, 1000);',
    ].join('\n'));
    const dead = spawnSync(process.execPath, ['-e', '0'], { windowsHide: true }).pid;
    writeFileSync(join(s.base, 'lock-chain'), lockText({ runId: s.id, pid: dead, launched: Date.now() - 5000 }));
    const r = spawn(process.execPath, [rFile, s.id, dir, bFile, cFile], { stdio: 'ignore', windowsHide: true });
    let cPid = 0;
    try {
      await waitFor(() => existsSync(join(dir, 'c.pid')), 30000);
      cPid = Number(readFileSync(join(dir, 'c.pid'), 'utf8'));
      const bPid = Number(readFileSync(join(dir, 'b.pid'), 'utf8'));
      const captured = runC(s.temp, s.id);
      expect(captured.pids).toEqual(expect.arrayContaining([r.pid, bPid, cPid]));
      spawnSync('taskkill.exe', ['/PID', String(bPid), '/F'], { windowsHide: true });
      await pause(1500);
      const withTokens = runC(s.temp, s.id, { known: captured.tokens.join(' ') });
      expect(withTokens.survivors).toBeGreaterThanOrEqual(1);
      expect(withTokens.pids).toContain(cPid);
      const control = runC(s.temp, s.id);
      expect(control.pids).not.toContain(cPid);
    } finally {
      for (const pid of [cPid, r.pid]) if (pid) spawnSync('taskkill.exe', ['/PID', String(pid), '/F'], { windowsHide: true });
      await pause(500);
      expect(alive(cPid)).toBe(false);
      expect(alive(r.pid)).toBe(false);
    }
  });
});

describe('§13.3 launch block, recursion canary, runbook drift, entry shape', () => {
  test('launch block: the bytes after line 1 give argv equality and a 40-byte BOM-less mint (§13.3)', { timeout: 120000 }, async () => {
    const s = setup();
    const chunk = join(s.temp, 'chunk dir');
    mkdirSync(chunk);
    const argvOut = join(s.temp, 'argv.json');
    const P = materializePlantedRepo({ entries: [], files: { 'hello-world/scripts/regression/launch.js': "import { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.T3_ARGV_OUT, JSON.stringify(process.argv.slice(2)));\n" } });
    try {
      const block = readFileSync(join(FIX, 'planted-bodies', 'runbook-launch-block.txt'), 'utf8').replace(/\r\n/g, '\n').split('\n');
      const ps1 = join(s.temp, 'launch-block.ps1');
      writeFileSync(ps1, [`$repo = '${P.root}'; $chunk = '${chunk}'; $integrity = '${INTEGRITY}'`, ...block.slice(1)].join('\r\n'));
      const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1],
        { env: { ...vitestEnv(process.env), TEMP: s.temp, TMP: s.temp, T3_ARGV_OUT: argvOut }, encoding: 'utf8', timeout: 60000, windowsHide: true });
      const m = /LAUNCHED RUN_ID=([0-9a-f]{32}) MINT=(.+)$/m.exec(r.stdout);
      expect(m).not.toBeNull();
      const mint = m[2].trim();
      await waitFor(() => existsSync(argvOut), 30000);
      expect(JSON.parse(readFileSync(argvOut, 'utf8'))).toEqual(['--mint', mint, '--integrity', INTEGRITY]);
      const bytes = readFileSync(mint);
      expect(bytes.length).toBe(40);
      expect([...bytes.subarray(0, 3)]).toEqual([0x52, 0x55, 0x4e]);
      expect(bytes[39]).toBe(0x0a);
    } finally {
      removePlantedRepo(P.root);
    }
  });
  test('[canary] recursion-guard: the in-tree launch.js refuses under VITEST with no run argument', { timeout: 60000 }, () => {
    const r = spawnSync(process.execPath, [join(HERE, 'launch.js')], { env: { ...process.env, VITEST: 'true' }, encoding: 'utf8', timeout: 30000, windowsHide: true });
    expect(r.stderr).toContain('LAUNCHER: refused recursion-guard');
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
  });
  test('[src] runbook drift: each fenced block of docs/regression-runbook.md equals its data copy after \\r\\n -> \\n', () => {
    const book = readFileSync(join(REPO, 'docs', 'regression-runbook.md'), 'utf8').replace(/\r\n/g, '\n').split('\n');
    const fence = (marker) => {
      let i = book.findIndex((l) => l.startsWith(marker));
      expect(i, marker).toBeGreaterThanOrEqual(0);
      while (book[i] !== '```powershell') i++;
      const out = [];
      for (i++; book[i] !== '```'; i++) out.push(book[i]);
      return `${out.join('\n')}\n`;
    };
    const copy = (n) => readFileSync(join(FIX, 'planted-bodies', n), 'utf8').replace(/\r\n/g, '\n');
    expect(fence('## 1. Launch bucket b')).toBe(copy('runbook-launch-block.txt'));
    expect(fence('- **(C) Survivors of a run**')).toBe(copy('runbook-c-block.txt'));
  });
  test('launch argv: a typo flag and --mint=x return an error (§1)', () => {
    expect(parseArgs(['--mint', 'm', '--integrity', 'EXIT=0 FILES=1 CASES=1']).ok).toBe(true);
    expect(parseArgs(['--mnt', 'm', '--integrity', 'v']).ok).toBe(false);
    expect(parseArgs(['--mint=x', '--integrity', 'v']).ok).toBe(false);
    expect(parseArgs(['--mint', 'm', '--integrity', 'v', '--timeout', '5']).ok).toBe(false);
  });
});
