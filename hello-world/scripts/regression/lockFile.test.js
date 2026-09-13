// Lane A lock rows (design §2.2 grammar, §2.3 staleness, §3.2 liveness and confirmations). Pure.
import { describe, test, expect } from 'vitest';
import { GRAMMAR, formatLock, parseLock, isStale, liveness, confirmation } from './lockFile.js';
import { TIMING } from './launchPolicy.js';

const ID = '0123456789abcdef0123456789abcdef';
const OTHER = 'fedcba9876543210fedcba9876543210';
const T0 = Date.UTC(2026, 8, 11, 12, 0, 0, 0);
const iso = (ms) => new Date(ms).toISOString();
const S = 1000;

const fields = (over = {}) => ({
  runId: ID,
  launcherPid: 4242,
  timeoutS: 1800,
  launched: iso(T0),
  deadline: iso(T0 + 1860 * S),
  heartbeat: iso(T0),
  ...over,
});
const lines = (f) => [
  'T3_LOCK=v1',
  `RUN_ID=${f.runId}`,
  `LAUNCHER_PID=${f.launcherPid}`,
  `TIMEOUT_S=${f.timeoutS}`,
  `LAUNCHED=${f.launched}`,
  `DEADLINE=${f.deadline}`,
  `HEARTBEAT=${f.heartbeat}`,
];
const text = (ls) => ls.map((l) => `${l}\n`).join('');
const lockText = (over) => text(lines(fields(over)));

// One §3.2 observation of a run that is not finished.
const obs = ({ lock = 'parsed', statusExists = true, nowMs = T0, over = {} } = {}) => {
  if (lock === 'absent') return { mintRunId: ID, finished: false, statusExists, lockRead: { state: 'absent' }, nowMs };
  if (lock === 'unparseable') return { mintRunId: ID, finished: false, statusExists, lockRead: { state: 'unparseable', text: 'garbage\n' }, nowMs };
  const t = lockText(over);
  return { mintRunId: ID, finished: false, statusExists, lockRead: { state: 'parsed', lock: parseLock(t).lock, text: t }, nowMs };
};

describe('§2.2 lock grammar', () => {
  test('GRAMMAR has exactly the seven rows L-1..L-7', () => {
    expect(GRAMMAR.map((r) => r.row)).toEqual(['L-1', 'L-2', 'L-3', 'L-4', 'L-5', 'L-6', 'L-7']);
  });
  test('lock grammar: exactly 7 keys; a well-formed lock parses (§2.2)', () => {
    const r = parseLock(lockText());
    expect(r.ok).toBe(true);
    expect(r.lock.runId).toBe(ID);
    expect(r.lock.launcherPid).toBe(4242);
    expect(r.lock.deadline).toBe(iso(T0 + 1860 * S));
  });
  test('lock grammar: key order is not checked (§2.2)', () => {
    expect(parseLock(text(lines(fields()).reverse())).ok).toBe(true);
  });
  const BAD = [
    ['a missing key', text(lines(fields()).slice(0, 6))],
    ['an unknown key', text([...lines(fields()), 'EXTRA=1'])],
    ['a duplicate key', text([...lines(fields()).slice(0, 6), `RUN_ID=${ID}`])],
    ['\\r anywhere', lockText().replace('\n', '\r\n')],
    ['an unterminated last line', lockText().slice(0, -1)],
    ['an uppercase RUN_ID', lockText({ runId: ID.toUpperCase() })],
    ['LAUNCHER_PID=0', lockText({ launcherPid: 0 })],
    ['a HEARTBEAT without milliseconds', lockText({ heartbeat: '2026-09-11T12:00:00Z' })],
    ['T3_LOCK=v2', lockText().replace('T3_LOCK=v1', 'T3_LOCK=v2')],
  ];
  test.each(BAD)('lock grammar: %s -> unparseable (§2.2)', (_name, t) => {
    expect(parseLock(t).ok).toBe(false);
  });
  test('formatLock writes L-1..L-7 at a fixed length (§2.2)', () => {
    const a = formatLock(fields());
    expect(a).toBe(lockText());
    const b = formatLock(fields({ heartbeat: iso(T0 + 987654321) }));
    expect(Buffer.byteLength(b)).toBe(Buffer.byteLength(a));
  });
});

describe('§2.3 staleness', () => {
  const lock = parseLock(lockText()).lock;
  test('EXIT-stale vs heartbeat-stale vs live (§2.3): a finished run is EXIT-stale at any age', () => {
    expect(isStale({ lock, finished: true, nowMs: T0 }, TIMING)).toBe('exit-stale');
  });
  test('EXIT-stale vs heartbeat-stale vs live (§2.3): unfinished and age >= STALE_S is heartbeat-stale', () => {
    expect(isStale({ lock, finished: false, nowMs: T0 + TIMING.STALE_S * S }, TIMING)).toBe('heartbeat-stale');
  });
  test('EXIT-stale vs heartbeat-stale vs live (§2.3): unfinished and age < STALE_S is live', () => {
    expect(isStale({ lock, finished: false, nowMs: T0 + TIMING.STALE_S * S - 1 }, TIMING)).toBe('live');
  });
  test('a backward clock step clamps age to 0 (§3.2)', () => {
    expect(isStale({ lock, finished: false, nowMs: T0 - 3600 * S }, TIMING)).toBe('live');
    expect(liveness(obs({ nowMs: T0 - 3600 * S }), TIMING).row).toBe('V-5');
  });
});

describe('§3.2 liveness V-1..V-7', () => {
  const ROWS = [
    ['V-1', 'no lock, no status.txt', obs({ lock: 'absent', statusExists: false }), { gate: 'inconclusive', reasons: 'a:no-record' }],
    ['V-2', 'lock unparseable', obs({ lock: 'unparseable' }), { gate: 'inconclusive', reasons: 'i:lock-unreadable' }],
    ['V-3', 'foreign lock, no status.txt', obs({ statusExists: false, over: { runId: OTHER } }), { gate: 'inconclusive', reasons: 'a:no-record' }],
    ['V-4', 'foreign lock, status.txt exists', obs({ over: { runId: OTHER } }), { gate: 'inconclusive', reasons: 'i:lock-foreign' }],
    ['V-5', 'own lock, fresh, before DEADLINE', obs({ nowMs: T0 + 30 * S, over: { heartbeat: iso(T0) } }), { gate: 'pending', reasons: '-' }],
    ['V-6', 'own lock, fresh, past DEADLINE', obs({ nowMs: T0 + 1861 * S, over: { heartbeat: iso(T0 + 1850 * S) } }), null],
    ['V-6', 'own lock, fresh, exactly at DEADLINE (T3-C4b-17 boundary)', obs({ nowMs: T0 + 1860 * S, over: { heartbeat: iso(T0 + 1850 * S) } }), null],
    ['V-7', 'own lock, age >= 60 s', obs({ nowMs: T0 + 61 * S }), null],
    ['V-7', 'no lock but status.txt exists', obs({ lock: 'absent', statusExists: true }), null],
  ];
  test.each(ROWS)('liveness %s: %s (§3.2)', (row, _name, o, final) => {
    const r = liveness(o, TIMING);
    expect(r.row).toBe(row);
    expect(r.final).toEqual(final);
  });
});

describe('§3.2 confirmations', () => {
  const overdue = (nowMs, over = {}) => obs({ nowMs, over: { heartbeat: iso(nowMs - 5 * S), deadline: iso(T0 + 60 * S), ...over } });
  test('confirmation pairs -> overdue:<L-3>: V-6 then V-6 with the same L-2 and L-3 (§3.2)', () => {
    expect(confirmation(overdue(T0 + 100 * S), overdue(T0 + 130 * S), TIMING)).toEqual({ gate: 'inconclusive', reasons: 'overdue:4242' });
  });
  test('confirmation pairs: V-6 then V-6 with a different L-3 -> i:unsettled (§3.2)', () => {
    expect(confirmation(overdue(T0 + 100 * S), overdue(T0 + 130 * S, { launcherPid: 777 }), TIMING)).toEqual({ gate: 'inconclusive', reasons: 'i:unsettled' });
  });
  test('confirmation pairs -> i:launcher-lost: V-7 then V-7 with byte-identical lock content (§3.2)', () => {
    expect(confirmation(obs({ nowMs: T0 + 61 * S }), obs({ nowMs: T0 + 76 * S }), TIMING)).toEqual({ gate: 'inconclusive', reasons: 'i:launcher-lost' });
  });
  test('confirmation pairs -> i:launcher-lost: V-7 then V-7 both lockless (§3.2)', () => {
    expect(confirmation(obs({ lock: 'absent' }), obs({ lock: 'absent', nowMs: T0 + 15 * S }), TIMING)).toEqual({ gate: 'inconclusive', reasons: 'i:launcher-lost' });
  });
  test('confirmation pairs -> i:unsettled: V-7 then V-7 with a moved heartbeat that is still stale (§3.2)', () => {
    const second = obs({ nowMs: T0 + 200 * S, over: { heartbeat: iso(T0 + 100 * S) } });
    expect(confirmation(obs({ nowMs: T0 + 61 * S }), second, TIMING)).toEqual({ gate: 'inconclusive', reasons: 'i:unsettled' });
  });
  test('confirmation pairs -> i:unsettled: V-7 then V-6 (a launcher that resumed past its deadline) (§3.2)', () => {
    const first = obs({ nowMs: T0 + 1900 * S, over: { heartbeat: iso(T0 + 1800 * S) } });
    const second = obs({ nowMs: T0 + 1915 * S, over: { heartbeat: iso(T0 + 1914 * S) } });
    expect(liveness(first, TIMING).row).toBe('V-7');
    expect(liveness(second, TIMING).row).toBe('V-6');
    expect(confirmation(first, second, TIMING)).toEqual({ gate: 'inconclusive', reasons: 'i:unsettled' });
  });
  test('confirmation: a second observation that is finished is judged from the record (§3.2)', () => {
    expect(confirmation(obs({ nowMs: T0 + 61 * S }), { ...obs({ nowMs: T0 + 76 * S }), finished: true }, TIMING)).toEqual({ judge: true });
  });
  test('confirmation: a second observation in V-1..V-5 prints its own final state (§3.2)', () => {
    const second = obs({ nowMs: T0 + 90 * S, over: { heartbeat: iso(T0 + 89 * S) } });
    expect(confirmation(obs({ nowMs: T0 + 61 * S }), second, TIMING)).toEqual({ gate: 'pending', reasons: '-' });
  });
});
