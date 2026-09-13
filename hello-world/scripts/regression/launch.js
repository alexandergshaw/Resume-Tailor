// Lane A launcher (design §2, §3, §10, §13.2-§13.3). IO entry: the one launcher protocol.
import * as realFs from 'node:fs';
import { spawn as realSpawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseMint } from './gateCheck.js';
import { formatHeader, formatExitBlock, isRecordFinished } from './statusRecord.js';
import { formatLock, parseLock, isStale } from './lockFile.js';
import { RUN_ID_RE, TIMING, recursionGuard, vitestEnv, selectForRetention } from './launchPolicy.js';
import {
  createExclusive, appendExisting, rewriteInPlace, readLockText, deleteRunDir, deleteCompanion,
  releaseOwnLock, takeOverLock, toplevel, recordBase, killTree as realKillTree,
} from './io.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const realSleep = (ms) => new Promise((resolve_) => { setTimeout(resolve_, ms); });

function lockPathFor(base, top) {
  const hash = createHash('sha256').update(Buffer.from(top || '', 'utf8')).digest('hex');
  return join(base, `lock-${hash}`);
}

function isoNow() {
  return new Date().toISOString();
}

async function runRetention({ base, currentId, fsDeps, stderr }) {
  let entries;
  try {
    entries = fsDeps.readdirSync(base, { withFileTypes: true });
  } catch {
    return;
  }
  const lockedIds = [];
  for (const e of entries) {
    if (!e.name.startsWith('lock-')) continue;
    const read = readLockText(join(base, e.name), fsDeps);
    if (read.state !== 'present') continue;
    const parsed = parseLock(read.text);
    if (parsed.ok) lockedIds.push(parsed.lock.runId);
  }
  const list = [];
  for (const e of entries) {
    if (!RUN_ID_RE.test(e.name)) continue;
    let st;
    try {
      st = fsDeps.lstatSync(join(base, e.name));
    } catch {
      continue;
    }
    let finished = false;
    try {
      finished = isRecordFinished(fsDeps.readFileSync(join(base, e.name, 'status.txt'), 'utf8'));
    } catch {
      finished = false;
    }
    list.push({ name: e.name, isDirectory: st.isDirectory(), isReparsePoint: st.isSymbolicLink(), finished, birthtimeMs: st.birthtimeMs });
  }
  const toDelete = selectForRetention(list, { lockedIds, currentId });
  for (const name of toDelete) {
    try {
      deleteRunDir(base, name, fsDeps);
      for (const suffix of ['launcher.out.txt', 'launcher.err.txt', 'prior-lock.txt']) {
        const companion = `${name}.${suffix}`;
        if (fsDeps.existsSync(join(base, companion))) deleteCompanion(base, companion, fsDeps);
      }
    } catch (err) {
      stderr(`LAUNCHER: retention ${name} ${err.code || err.message}`);
    }
  }
}

// §2.5: the launcher protocol. Resolves once the run finishes (or is refused).
export async function launch(opts, deps = {}) {
  const fsDeps = deps.fs || realFs;
  const base = deps.base || recordBase();
  const timing = deps.timing || TIMING;
  const doSpawn = deps.spawn || realSpawn;
  const doKillTree = deps.killTree || realKillTree;
  const sleep = deps.sleep || realSleep;
  const doToplevel = deps.toplevel || toplevel;
  const stderr = deps.stderr || ((l) => process.stderr.write(`${l}\n`));
  const runnerPath = deps.runnerPath || join(HERE, 'runner.js');
  const retentionFn = deps.retention || ((args) => runRetention(args));

  // L0
  let mintBytes;
  try {
    mintBytes = fsDeps.readFileSync(opts.mint);
  } catch {
    return { refused: 'mint-missing' };
  }
  const mint = parseMint(mintBytes);
  if (!mint.ok) return { refused: 'mint-invalid' };
  const runId = mint.runId;
  if (!RUN_ID_RE.test(runId)) return { refused: 'id-invalid' };
  const integrityM = /^EXIT=(0|[1-9][0-9]*) FILES=(\d+) CASES=(\d+)$/.exec(opts.integrity || '');
  if (!integrityM || Number(integrityM[2]) === 0 || Number(integrityM[3]) === 0) return { refused: 'integrity-invalid' };

  // L1
  const top = doToplevel();
  const normBase = resolve(base).replace(/\\/g, '/');
  const normTmp = resolve(tmpdir()).replace(/\\/g, '/');
  const normTop = top ? resolve(top).replace(/\\/g, '/') : null;
  const insideTmp = normBase === normTmp || normBase.startsWith(`${normTmp}/`);
  const insideTop = normTop && (normBase === normTop || normBase.startsWith(`${normTop}/`));
  if (!insideTmp || insideTop) return { refused: 'base-location' };

  // L2
  try {
    fsDeps.mkdirSync(base, { recursive: true });
  } catch { /* already exists */ }
  const lockPath = lockPathFor(base, top);

  const nowMs = Date.now();
  const launched = new Date(nowMs).toISOString();
  const deadline = new Date(nowMs + timing.TIMEOUT_S * 1000 + timing.GRACE_S * 1000).toISOString();
  const ownFields = { runId, launcherPid: process.pid, timeoutS: timing.TIMEOUT_S, launched, deadline, heartbeat: launched };
  const ownLockText = formatLock(ownFields);

  // L3: acquire
  let acquired = false;
  try {
    createExclusive(lockPath, ownLockText, fsDeps);
    acquired = true;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  if (!acquired) {
    const read = readLockText(lockPath, fsDeps);
    if (read.state === 'absent') {
      try {
        createExclusive(lockPath, ownLockText, fsDeps);
        acquired = true;
      } catch {
        return { refused: 'concurrent-run' };
      }
    } else {
      const parsed = parseLock(read.text);
      if (!parsed.ok) return { refused: 'lock-unreadable' };
      if (parsed.lock.runId === runId) return { refused: 'id-reused' };
      const finished = isRecordFinished(safeReadStatus(fsDeps, base, parsed.lock.runId));
      const stale = isStale({ lock: parsed.lock, finished, nowMs: Date.now() }, timing);
      if (stale === 'exit-stale') {
        const priorPath = join(base, `${runId}.prior-lock.txt`);
        const taken = takeOverLock(lockPath, read.text, priorPath, fsDeps);
        if (!taken.ok) return { refused: 'concurrent-run' };
        try {
          createExclusive(lockPath, ownLockText, fsDeps);
          acquired = true;
        } catch {
          return { refused: 'concurrent-run' };
        }
      } else if (stale === 'heartbeat-stale') {
        await sleep(timing.SECOND_READ_S * 1000);
        const read2 = readLockText(lockPath, fsDeps);
        const stillStale = read2.state === 'present' && read2.text === read.text;
        if (!stillStale) return { refused: 'concurrent-run' };
        const priorPath = join(base, `${runId}.prior-lock.txt`);
        const taken = takeOverLock(lockPath, read.text, priorPath, fsDeps);
        if (!taken.ok) return { refused: 'concurrent-run' };
        try {
          createExclusive(lockPath, ownLockText, fsDeps);
          acquired = true;
        } catch {
          return { refused: 'concurrent-run' };
        }
      } else {
        stderr(`LAUNCHER: refused concurrent-run lock-run=${parsed.lock.runId}`);
        return { refused: 'concurrent-run' };
      }
    }
  }

  // L4: verify
  await sleep(timing.VERIFY_S * 1000);
  const verifyRead = readLockText(lockPath, fsDeps);
  if (verifyRead.state !== 'present') return { refused: 'concurrent-run' };
  const verifyParsed = parseLock(verifyRead.text);
  if (!verifyParsed.ok || verifyParsed.lock.runId !== runId) return { refused: 'concurrent-run' };

  // L5: mkdir the run directory
  const runDir = join(base, runId);
  const statusPath = join(runDir, 'status.txt');
  try {
    fsDeps.mkdirSync(runDir);
    createExclusive(statusPath, formatHeader(), fsDeps);
  } catch {
    releaseOwnLock(lockPath, runId, parseLock, fsDeps);
    return { refused: 'id-reused' };
  }

  // L6: heartbeat
  const state = { lockLost: false, timedOut: false, runnerPid: null, stopped: false };
  let heartbeatTimer = null;
  const tick = () => {
    if (state.stopped) return;
    const read = readLockText(lockPath, fsDeps);
    if (read.state !== 'present') {
      state.lockLost = true;
      if (state.runnerPid) doKillTree(state.runnerPid);
      return;
    }
    const parsed = parseLock(read.text);
    if (!parsed.ok || parsed.lock.runId !== runId) {
      state.lockLost = true;
      if (state.runnerPid) doKillTree(state.runnerPid);
      return;
    }
    try {
      rewriteInPlace(lockPath, formatLock({ ...parsed.lock, heartbeat: isoNow() }), fsDeps);
      state.writeFails = 0;
    } catch {
      state.writeFails = (state.writeFails || 0) + 1;
      if (state.writeFails >= timing.HEARTBEAT_FAILS) {
        state.lockLost = true;
        if (state.runnerPid) doKillTree(state.runnerPid);
        return;
      }
    }
    if (!state.timedOut && Date.now() >= Date.parse(deadline) - timing.GRACE_S * 1000) {
      state.timedOut = true;
      if (state.runnerPid) doKillTree(state.runnerPid);
    }
  };
  heartbeatTimer = setInterval(tick, timing.HEARTBEAT_S * 1000);
  tick();

  // L7: retention
  await retentionFn({ base, currentId: runId, fsDeps, stderr });

  const stopHeartbeat = () => {
    state.stopped = true;
    clearInterval(heartbeatTimer);
  };

  // L8: spawn (unless already lock-lost)
  if (state.lockLost) {
    stopHeartbeat();
    return writeExit({ fsDeps, statusPath, exit: 'lock-lost', waitedPid: '-', runId, timeoutS: timing.TIMEOUT_S, kill: 'none' });
  }

  return new Promise((resolvePromise) => {
    let child;
    try {
      child = doSpawn(process.execPath, [runnerPath, '--run-id', runId, '--record-dir', runDir, '--integrity', opts.integrity], {
        cwd: dirname(runnerPath), detached: false, windowsHide: true, stdio: 'ignore', env: vitestEnv(process.env),
      });
    } catch (err) {
      stopHeartbeat();
      resolvePromise(writeExit({ fsDeps, statusPath, exit: `spawn-error:${err.code || 'ERR'}`, waitedPid: '-', runId, timeoutS: timing.TIMEOUT_S, kill: 'none' }));
      return;
    }
    state.runnerPid = child.pid;
    let killResult = 'none';
    child.on('error', (err) => {
      stopHeartbeat();
      resolvePromise(writeExit({ fsDeps, statusPath, exit: `spawn-error:${err.code || 'ERR'}`, waitedPid: '-', runId, timeoutS: timing.TIMEOUT_S, kill: 'none' }));
    });
    child.on('exit', (code, signal) => {
      stopHeartbeat();
      let exit;
      if (state.lockLost) exit = 'lock-lost';
      else if (state.timedOut) exit = 'timeout';
      else if (signal) exit = `signal:${signal}`;
      else exit = String(code);
      if (state.timedOut || state.lockLost) killResult = 'ok';
      resolvePromise(writeExit({ fsDeps, statusPath, exit, waitedPid: String(child.pid), runId, timeoutS: timing.TIMEOUT_S, kill: killResult }));
    });
  });
}

function safeReadStatus(fsDeps, base, id) {
  try {
    return fsDeps.readFileSync(join(base, id, 'status.txt'), 'utf8');
  } catch {
    return '';
  }
}

function writeExit({ fsDeps, statusPath, exit, waitedPid, runId, timeoutS, kill }) {
  const elapsedS = 0;
  appendExisting(statusPath, formatExitBlock({
    EXIT: exit, WAITED_PID: waitedPid, LAUNCHER_RUN_ID: runId, TIMEOUT_S: String(timeoutS), ELAPSED_S: String(elapsedS), KILL: kill, ENDED: isoNow(),
  }), fsDeps);
  return { exit };
}

export function parseArgs(argv) {
  let mint;
  let integrity;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--mint') {
      i += 1;
      if (argv[i] === undefined) return { ok: false, reason: 'missing-value' };
      mint = argv[i];
    } else if (a === '--integrity') {
      i += 1;
      if (argv[i] === undefined) return { ok: false, reason: 'missing-value' };
      integrity = argv[i];
    } else {
      return { ok: false, reason: `unrecognised:${a}` };
    }
  }
  if (mint === undefined || integrity === undefined) return { ok: false, reason: 'missing-args' };
  return { ok: true, options: { mint, integrity } };
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}

async function main() {
  const vitestSet = Object.keys(process.env).some((k) => /^VITEST$/i.test(k));
  if (recursionGuard({ vitestSet, toplevel: toplevel(), tmpdir: tmpdir() }) === 'refuse') {
    process.stderr.write('LAUNCHER: refused recursion-guard\n');
    process.exitCode = 2;
    return;
  }
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`LAUNCHER: refused ${parsed.reason}\n`);
    process.exitCode = 2;
    return;
  }
  const r = await launch(parsed.options);
  if (r.refused) {
    process.stderr.write(`LAUNCHER: refused ${r.refused}\n`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = r.exit === '0' ? 0 : 1;
}

if (invokedDirectly()) {
  main().catch((err) => {
    process.stderr.write(`${err && err.stack ? err.stack : err}\n`);
    process.exitCode = 1;
  });
}
