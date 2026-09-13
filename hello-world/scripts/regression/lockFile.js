// Lane A per-tree lock rows (design §2.2 grammar, §2.3 staleness, §3.2 liveness and confirmations). Pure.

// §2.2: the only lock grammar. Key order is not checked when parsing; the formatter writes L-1..L-7 in order.
export const GRAMMAR = [
  { row: 'L-1', key: 'T3_LOCK' },
  { row: 'L-2', key: 'RUN_ID' },
  { row: 'L-3', key: 'LAUNCHER_PID' },
  { row: 'L-4', key: 'TIMEOUT_S' },
  { row: 'L-5', key: 'LAUNCHED' },
  { row: 'L-6', key: 'DEADLINE' },
  { row: 'L-7', key: 'HEARTBEAT' },
];

const ISO_RE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const KEY_RULES = {
  T3_LOCK: (v) => v === 'v1',
  RUN_ID: (v) => /^[0-9a-f]{32}$/.test(v),
  LAUNCHER_PID: (v) => /^[1-9][0-9]{0,9}$/.test(v),
  TIMEOUT_S: (v) => /^[1-9][0-9]{0,5}$/.test(v),
  LAUNCHED: (v) => ISO_RE.test(v),
  DEADLINE: (v) => ISO_RE.test(v),
  HEARTBEAT: (v) => ISO_RE.test(v),
};

export function formatLock(f) {
  return [
    'T3_LOCK=v1',
    `RUN_ID=${f.runId}`,
    `LAUNCHER_PID=${f.launcherPid}`,
    `TIMEOUT_S=${f.timeoutS}`,
    `LAUNCHED=${f.launched}`,
    `DEADLINE=${f.deadline}`,
    `HEARTBEAT=${f.heartbeat}`,
  ].map((l) => `${l}\n`).join('');
}

export function parseLock(text) {
  if (text.includes('\r') || !text.endsWith('\n')) return { ok: false };
  const lines = text.slice(0, -1).split('\n');
  if (lines.length !== 7) return { ok: false };
  const seen = {};
  for (const line of lines) {
    const i = line.indexOf('=');
    if (i < 0) return { ok: false };
    const key = line.slice(0, i);
    const value = line.slice(i + 1);
    if (!(key in KEY_RULES) || key in seen) return { ok: false };
    if (!KEY_RULES[key](value)) return { ok: false };
    seen[key] = value;
  }
  return {
    ok: true,
    lock: {
      runId: seen.RUN_ID,
      launcherPid: Number(seen.LAUNCHER_PID),
      timeoutS: Number(seen.TIMEOUT_S),
      launched: seen.LAUNCHED,
      deadline: seen.DEADLINE,
      heartbeat: seen.HEARTBEAT,
    },
  };
}

// §2.3: "finished" and "stale". A run is finished iff its own status.txt carries S-37 (checked by the caller).
export function isStale({ lock, finished, nowMs }, timing) {
  if (finished) return 'exit-stale';
  const age = Math.max(0, nowMs - Date.parse(lock.heartbeat));
  return age >= timing.STALE_S * 1000 ? 'heartbeat-stale' : 'live';
}

// §3.2: one observation -> a row V-1..V-7, and a final gate/reasons pair when the row decides alone.
export function liveness(o, timing) {
  const { lockRead, statusExists, mintRunId, nowMs } = o;
  if (lockRead.state === 'absent') {
    if (!statusExists) return { row: 'V-1', final: { gate: 'inconclusive', reasons: 'a:no-record' } };
    return { row: 'V-7', final: null };
  }
  if (lockRead.state === 'unparseable') {
    return { row: 'V-2', final: { gate: 'inconclusive', reasons: 'i:lock-unreadable' } };
  }
  const { lock } = lockRead;
  if (lock.runId !== mintRunId) {
    if (!statusExists) return { row: 'V-3', final: { gate: 'inconclusive', reasons: 'a:no-record' } };
    return { row: 'V-4', final: { gate: 'inconclusive', reasons: 'i:lock-foreign' } };
  }
  const age = Math.max(0, nowMs - Date.parse(lock.heartbeat));
  if (age >= timing.STALE_S * 1000) return { row: 'V-7', final: null };
  if (nowMs >= Date.parse(lock.deadline)) return { row: 'V-6', final: null };
  return { row: 'V-5', final: { gate: 'pending', reasons: '-' } };
}

// §3.2 confirmation: the gate's own second read for V-6 (overdue) and V-7 (launcher-lost).
export function confirmation(o1, o2, timing) {
  if (o2.finished) return { judge: true };
  const r2 = liveness(o2, timing);
  if (r2.final) return r2.final;
  const r1 = liveness(o1, timing);
  if (r1.row === 'V-6' && r2.row === 'V-6') {
    const l1 = o1.lockRead.lock;
    const l2 = o2.lockRead.lock;
    if (l1.runId === l2.runId && l1.launcherPid === l2.launcherPid) {
      return { gate: 'inconclusive', reasons: `overdue:${l2.launcherPid}` };
    }
    return { gate: 'inconclusive', reasons: 'i:unsettled' };
  }
  if (r1.row === 'V-7' && r2.row === 'V-7') {
    const t1 = o1.lockRead.state === 'absent' ? null : o1.lockRead.text;
    const t2 = o2.lockRead.state === 'absent' ? null : o2.lockRead.text;
    const bothLockless = o1.lockRead.state === 'absent' && o2.lockRead.state === 'absent';
    if (bothLockless || t1 === t2) return { gate: 'inconclusive', reasons: 'i:launcher-lost' };
    return { gate: 'inconclusive', reasons: 'i:unsettled' };
  }
  return { gate: 'inconclusive', reasons: 'i:unsettled' };
}
