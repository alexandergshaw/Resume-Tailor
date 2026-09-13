// Lane A status-record rows (design §5.1, §5.2 as carried by S-28, and the §5.1 shapes table). Pure.
import { describe, test, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  GRAMMAR,
  parseRecord,
  formatHeader,
  formatSpawnBlock,
  formatCompletionBlock,
  formatExitBlock,
  escapeValue,
} from './statusRecord.js';
import { greenCheck } from './gateCheck.js';
import { liveness } from './lockFile.js';
import { TIMING } from './launchPolicy.js';

const ID = '0123456789abcdef0123456789abcdef';
const PID = '5151';
const H = (c) => c.repeat(64);
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const ARGV = JSON.stringify(['C:/p/hello-world/node_modules/vitest/vitest.mjs', 'run', '--no-file-parallelism']);

const resultLine = (result = 'clean', reasons = '-') => {
  const n = (v) => (result === 'inconclusive' && reasons.includes('a') ? '-' : v);
  return [
    `RESULT=${result}`, `RUN_ID=${ID}`, `REASONS=${reasons}`, 'VITEST_PIN=match', 'VITEST_VERSION=4.1.8', 'FILES=2', 'CASES=4',
    `VITEST_CASES=${n(4)}`, `REPORTED_CASES=${n(4)}`, `JUDGED_BAD=${n(0)}`, `ORPHAN=${n(0)}`, `COULD_NOT_JUDGE=${n(0)}`, 'CNJ_BASELINE=absent',
    `CNJ_NEW=${n(0)}`, `CNJ_GONE=${n(0)}`, `VITEST_FAILED_FILES=${n(0)}`, `VITEST_FAILED_TESTS=${n(0)}`, `VITEST_ERRORS=${n(0)}`,
    `S_MISSING_PATHS=${n(0)}`, `S_FAIL=${n(0)}`, `S_NO_MATCH=${n(0)}`, `S_VACUOUS=${n(0)}`, `S_COUNT_SHORT=${n(0)}`, `S_CLAIM_FAIL=${n(0)}`,
    `S_UNSUPPORTED=${n(0)}`, `S_NOT_COVERED=${n(0)}`, `S_PASS=${n(4)}`,
  ].join(' ');
};
const spawnLines = (o = {}) => Object.entries({
  RUN_ID: ID, RUNNER_PID: PID, STARTED: '2026-09-11T12:00:01.000Z', TOPLEVEL: 'C:/p', INTEGRITY: 'EXIT=0 FILES=2 CASES=4',
  FP_START: H('a'), ARGV, ENV_NAMES_SHA256: H('e'), ARGV_SHA256: sha256(ARGV), VITEST_VERSION: '4.1.8', VITEST_PIN: 'match',
  CNJ_BASELINE_PATH: 'hello-world/scripts/regression/cnj-baseline.txt', CNJ_BASELINE_SHA256: 'absent', VITEST_SPAWNED: 'yes', ...o,
}).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`);
const completionLines = (o = {}) => Object.entries({
  SUMMARY_TEST_FILES: 'Test Files  2 passed (2)', SUMMARY_TESTS: 'Tests  4 passed (4)', SUMMARY_ERRORS: 'none', SUMMARY_DURATION: 'Duration  1.00s',
  FP_END: H('a'), REPORT_SHA256: H('1'), JUDGED_BAD_SHA256: H('2'), VITEST_JSON_SHA256: H('3'), VITEST_STDOUT_SHA256: H('4'),
  VITEST_STDERR_SHA256: H('5'), FINISHED: '2026-09-11T12:01:00.000Z', RESULT: resultLine(), ...o,
}).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`);
const exitLines = (o = {}) => Object.entries({
  EXIT: '0', WAITED_PID: PID, LAUNCHER_RUN_ID: ID, TIMEOUT_S: '1800', ELAPSED_S: '60', KILL: 'none', ENDED: '2026-09-11T12:01:01.000Z', ...o,
}).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`);
const record = ({ spawn = spawnLines(), completion = completionLines(), exit = exitLines(), end = true } = {}) =>
  [
    'T3_STATUS=v1',
    ...(spawn ? ['--- spawn ---', ...spawn] : []),
    ...(completion ? ['--- completion ---', ...completion] : []),
    ...(exit ? ['--- exit ---', ...exit] : []),
    ...(end ? ['--- end ---'] : []),
  ].map((l) => `${l}\n`).join('');
const RECOMPUTED = { REPORT_SHA256: H('1'), JUDGED_BAD_SHA256: H('2'), VITEST_JSON_SHA256: H('3'), VITEST_STDOUT_SHA256: H('4'), VITEST_STDERR_SHA256: H('5') };
const gate = (recordText) => greenCheck({ mintRunId: ID, dirName: ID, recordText, recomputed: RECOMPUTED, fresh: 'yes' });

describe('§5.1 parse rules', () => {
  test('a complete record parses into its four blocks and is finished', () => {
    const r = parseRecord(record());
    expect(r.ok).toBe(true);
    expect(r.finished).toBe(true);
    expect(r.blocks.spawn.RUN_ID).toBe(ID);
    expect(r.blocks.completion.RESULT).toBe(resultLine());
    expect(r.blocks.exit.EXIT).toBe('0');
  });
  const BAD = [
    ['\\r anywhere', record().replace('T3_STATUS=v1\n', 'T3_STATUS=v1\r\n')],
    ['a duplicate key', record({ spawn: [...spawnLines(), `RUN_ID=${ID}`] })],
    ['an unknown key', record({ spawn: [...spawnLines(), 'SURPRISE=1'] })],
    ['a misplaced key', record({ spawn: [...spawnLines(), 'EXIT=0'] })],
    ['a present block missing a key', record({ completion: completionLines({ FP_END: undefined }) })],
    ['completion without spawn', record({ spawn: null })],
    ['delimiters out of order', record().replace('--- completion ---\n', '--- exitX ---\n')],
    ['"-" on a row that is not -ok', record({ spawn: spawnLines({ RUN_ID: '-' }) })],
    ['"-" on an -ok row under RESULT=clean', record({ spawn: spawnLines({ FP_START: '-' }) })],
  ];
  test.each(BAD)('parse rules: %s -> grammar (§5.1)', (_n, t) => {
    expect(parseRecord(t)).toEqual({ ok: false, reason: 'grammar' });
  });
  test('delimiter order is fixed even with fully well-formed blocks: exit physically before completion -> grammar (§5.1, T3-C4b-16)', () => {
    // Unlike the "delimiters out of order" row above (a corrupted, unparseable delimiter line), this
    // reorders two otherwise-valid blocks, so only real order enforcement - not an incidental parse
    // failure on garbage - can catch it.
    const reordered = ['T3_STATUS=v1', '--- spawn ---', ...spawnLines(), '--- exit ---', ...exitLines(), '--- completion ---', ...completionLines(), '--- end ---']
      .map((l) => `${l}\n`).join('');
    expect(parseRecord(reordered)).toEqual({ ok: false, reason: 'grammar' });
  });
  test('"-" on an -ok row is legal under RESULT=inconclusive (§5.1)', () => {
    const t = record({ spawn: spawnLines({ FP_START: '-' }), completion: completionLines({ RESULT: resultLine('inconclusive', 'h') }) });
    expect(parseRecord(t).ok).toBe(true);
  });
  test('block presence: absent runner blocks are legal; completion without spawn -> grammar (§5.1, T3-CD3-3)', () => {
    expect(parseRecord(record({ spawn: null, completion: null })).ok).toBe(true);
    expect(parseRecord(record({ completion: null })).ok).toBe(true);
    expect(parseRecord(record({ spawn: null })).ok).toBe(false);
  });
});

describe('§5.1 grammar data and formatters', () => {
  test('S-9a is a spawn row and S-37 stays the delimiter', () => {
    const s9a = GRAMMAR.find((r) => r.row === 'S-9a');
    expect(s9a.block).toBe('spawn');
    expect(s9a.key).toBe('ENV_NAMES_SHA256');
    expect(GRAMMAR.find((r) => r.row === 'S-37').line).toBe('--- end ---');
    expect(GRAMMAR.filter((r) => /^S-\d+a?$/.test(r.row)).length).toBe(38);
  });
  test('spawn block keys and order: S-2 first, S-15 last (formatSpawnBlock)', () => {
    const t = formatSpawnBlock(Object.fromEntries(spawnLines().map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])));
    const ls = t.split('\n').filter(Boolean);
    expect(ls[0]).toBe('--- spawn ---');
    expect(ls[ls.length - 1]).toBe('VITEST_SPAWNED=yes');
  });
  test('the formatters compose a record that parses (header, completion with RESULT last, exit with S-37 last)', () => {
    const kv = (ls) => Object.fromEntries(ls.map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    const t = formatHeader() + formatSpawnBlock(kv(spawnLines())) + formatCompletionBlock(kv(completionLines())) + formatExitBlock(kv(exitLines()));
    const comp = formatCompletionBlock(kv(completionLines())).split('\n').filter(Boolean);
    expect(comp[comp.length - 1].startsWith('RESULT=')).toBe(true);
    expect(t.endsWith('--- end ---\n')).toBe(true);
    expect(parseRecord(t).ok).toBe(true);
  });
  test('control characters are escaped \\xHH (T3-1g-10)', () => {
    expect(escapeValue('a\u0001b\u007fc\td\u0085e\nf')).toBe('a\\x01b\\x7fc\td\\x85e\\x0af');
  });
});

describe('§5.1 shapes a finished or dead run leaves', () => {
  test('shape normal -> green (§5.1 shapes table)', () => {
    expect(gate(record())).toMatchObject({ gate: 'green', reasons: [] });
  });
  test('shape runner refused before vitest -> inconclusive runner:<letters> (§5.1 shapes table)', () => {
    const t = record({ spawn: spawnLines({ VITEST_SPAWNED: 'no' }), completion: completionLines({ RESULT: resultLine('inconclusive', 'a') }) });
    expect(gate(t)).toMatchObject({ gate: 'inconclusive', reasons: ['runner:a'] });
  });
  test('shape runner died before S-2 -> i:unfinished (§5.1 shapes table)', () => {
    expect(gate(record({ spawn: null, completion: null }))).toMatchObject({ gate: 'inconclusive', reasons: ['i:unfinished'] });
  });
  test('shape runner died inside a block -> i:grammar (§5.1 shapes table)', () => {
    expect(gate(record({ spawn: spawnLines({ VITEST_SPAWNED: undefined }), completion: null }))).toMatchObject({ gate: 'inconclusive', reasons: ['i:grammar'] });
  });
  test('shape runner died between blocks -> i:unfinished (§5.1 shapes table)', () => {
    expect(gate(record({ completion: null }))).toMatchObject({ gate: 'inconclusive', reasons: ['i:unfinished'] });
  });
  test('shape spawn error -> a:spawn-error (§5.1 shapes table)', () => {
    const t = record({ spawn: null, completion: null, exit: exitLines({ EXIT: 'spawn-error:ENOENT', WAITED_PID: '-' }) });
    expect(gate(t)).toMatchObject({ gate: 'inconclusive', reasons: ['a:spawn-error'] });
  });
  test('shape timeout -> e:timeout (§5.1 shapes table)', () => {
    expect(gate(record({ completion: null, exit: exitLines({ EXIT: 'timeout', KILL: 'ok' }) }))).toMatchObject({ gate: 'inconclusive', reasons: ['e:timeout'] });
  });
  test('shape lock lost -> i:lock-lost (§5.1 shapes table)', () => {
    expect(gate(record({ exit: exitLines({ EXIT: 'lock-lost', KILL: 'ok' }) }))).toMatchObject({ gate: 'inconclusive', reasons: ['i:lock-lost'] });
  });
  test('shape launcher alive -> §3.2 (pending while the lock beats) (§5.1 shapes table)', () => {
    const lockText = ['T3_LOCK=v1', `RUN_ID=${ID}`, 'LAUNCHER_PID=4242', 'TIMEOUT_S=1800', 'LAUNCHED=2026-09-11T12:00:00.000Z',
      'DEADLINE=2026-09-11T12:31:00.000Z', 'HEARTBEAT=2026-09-11T12:00:30.000Z'].map((l) => `${l}\n`).join('');
    expect(parseRecord(record({ exit: null, end: false })).finished).toBe(false);
    const o = { mintRunId: ID, finished: false, statusExists: true, lockRead: { state: 'parsed', text: lockText, lock: { runId: ID, launcherPid: 4242, timeoutS: 1800, launched: '2026-09-11T12:00:00.000Z', deadline: '2026-09-11T12:31:00.000Z', heartbeat: '2026-09-11T12:00:30.000Z' } }, nowMs: Date.UTC(2026, 8, 11, 12, 0, 40) };
    expect(liveness(o, TIMING).final).toEqual({ gate: 'pending', reasons: '-' });
  });
  test('shape launch refused, or never started -> a:no-record (§5.1 shapes table)', () => {
    const o = { mintRunId: ID, finished: false, statusExists: false, lockRead: { state: 'absent' }, nowMs: Date.UTC(2026, 8, 11, 12, 0, 40) };
    expect(liveness(o, TIMING).final).toEqual({ gate: 'inconclusive', reasons: 'a:no-record' });
  });
});
