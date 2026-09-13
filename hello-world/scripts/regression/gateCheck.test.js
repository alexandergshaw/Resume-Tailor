// Lane A gate-check rows (design §4.1 mint, §4.2 run ID, §6.1 line, §6.2 stage order, §6.3 freshness). Pure.
import { describe, test, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { parseMint, greenCheck, freshness, formatGateLine } from './gateCheck.js';
import { RUN_ID_RE, EXIT_CODES } from './launchPolicy.js';

const ID = '0123456789abcdef0123456789abcdef';
const OTHER = 'fedcba9876543210fedcba9876543210';
const PID = '5151';
const H = (c) => c.repeat(64);
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const ARGV = JSON.stringify(['C:/p/hello-world/node_modules/vitest/vitest.mjs', 'run']);

const resultLine = ({ result = 'clean', reasons = '-', runId = ID, pin = 'match', version = '4.1.8' } = {}) => [
  `RESULT=${result}`, `RUN_ID=${runId}`, `REASONS=${reasons}`, `VITEST_PIN=${pin}`, `VITEST_VERSION=${version}`, 'FILES=2', 'CASES=4',
  'VITEST_CASES=4', 'REPORTED_CASES=4', `JUDGED_BAD=${result === 'dirty' ? 1 : 0}`, 'ORPHAN=0', 'COULD_NOT_JUDGE=0', 'CNJ_BASELINE=absent',
  'CNJ_NEW=0', 'CNJ_GONE=0', 'VITEST_FAILED_FILES=0', `VITEST_FAILED_TESTS=${result === 'dirty' ? 1 : 0}`, 'VITEST_ERRORS=0',
  'S_MISSING_PATHS=0', `S_FAIL=${result === 'dirty' ? 1 : 0}`, 'S_NO_MATCH=0', 'S_VACUOUS=0', 'S_COUNT_SHORT=0', 'S_CLAIM_FAIL=0',
  'S_UNSUPPORTED=0', 'S_NOT_COVERED=0', `S_PASS=${result === 'dirty' ? 3 : 4}`,
].join(' ');
const kv = (o) => Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`);
const record = ({ spawn = {}, completion = {}, exit = {}, noCompletion = false, pin = 'match', version = '4.1.8' } = {}) => [
  'T3_STATUS=v1',
  '--- spawn ---',
  ...kv({ RUN_ID: ID, RUNNER_PID: PID, STARTED: '2026-09-11T12:00:01.000Z', TOPLEVEL: 'C:/p', INTEGRITY: 'EXIT=0 FILES=2 CASES=4', FP_START: H('a'),
    ARGV, ENV_NAMES_SHA256: H('e'), ARGV_SHA256: sha256(ARGV), VITEST_VERSION: version, VITEST_PIN: pin,
    CNJ_BASELINE_PATH: 'hello-world/scripts/regression/cnj-baseline.txt', CNJ_BASELINE_SHA256: 'absent', VITEST_SPAWNED: 'yes', ...spawn }),
  ...(noCompletion ? [] : ['--- completion ---', ...kv({ SUMMARY_TEST_FILES: 'Test Files  2 passed (2)', SUMMARY_TESTS: 'Tests  4 passed (4)',
    SUMMARY_ERRORS: 'none', SUMMARY_DURATION: 'Duration  1.00s', FP_END: H('a'), REPORT_SHA256: H('1'), JUDGED_BAD_SHA256: H('2'),
    VITEST_JSON_SHA256: H('3'), VITEST_STDOUT_SHA256: H('4'), VITEST_STDERR_SHA256: H('5'), FINISHED: '2026-09-11T12:01:00.000Z',
    RESULT: resultLine({ pin, version }), ...completion })]),
  '--- exit ---',
  ...kv({ EXIT: '0', WAITED_PID: PID, LAUNCHER_RUN_ID: ID, TIMEOUT_S: '1800', ELAPSED_S: '60', KILL: 'none', ENDED: '2026-09-11T12:01:01.000Z', ...exit }),
  '--- end ---',
].map((l) => `${l}\n`).join('');
const RECOMPUTED = { REPORT_SHA256: H('1'), JUDGED_BAD_SHA256: H('2'), VITEST_JSON_SHA256: H('3'), VITEST_STDOUT_SHA256: H('4'), VITEST_STDERR_SHA256: H('5') };
const check = (recordText, over = {}) => greenCheck({ mintRunId: ID, dirName: ID, recordText, recomputed: RECOMPUTED, fresh: 'yes', ...over });
const DIRTY = String(EXIT_CODES.dirty);
const VOCAB = /^(a:mint-missing|a:mint-invalid|a:no-record|a:spawn-error|i:lock-unreadable|i:lock-foreign|i:launcher-lost|i:unsettled|overdue:[1-9][0-9]{0,9}|i:grammar|i:foreign|i:pid|e:timeout|i:lock-lost|i:kill-failed|i:unfinished|c:sha|runner:[a-j](\+[a-j])*|exit-disagree|h:gate-fp|fresh|dirty|pin)$/;
const expectGate = (r, gate, reasons) => {
  expect({ gate: r.gate, reasons: r.reasons }).toEqual({ gate, reasons });
};

describe('§4.1 mint and §4.2 run ID', () => {
  const mint = (s) => Buffer.from(s, 'utf8');
  test('mint: a plain LF mint parses', () => {
    expect(parseMint(mint(`RUN_ID=${ID}\n`))).toEqual({ ok: true, runId: ID });
  });
  test('mint: CRLF and BOM mints parse (§4.1)', () => {
    expect(parseMint(mint(`RUN_ID=${ID}\r\n`))).toEqual({ ok: true, runId: ID });
    expect(parseMint(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), mint(`RUN_ID=${ID}\n`)]))).toEqual({ ok: true, runId: ID });
  });
  const BAD = [
    ['UTF-16LE', Buffer.from(`RUN_ID=${ID}\n`, 'utf16le')],
    ['an extra LAUNCHER_PID= line', mint(`RUN_ID=${ID}\nLAUNCHER_PID=12\n`)],
    ['a NUL byte', mint(`RUN_ID=${ID}\u0000\n`)],
    ['another key', mint(`RUN=${ID}\n`)],
  ];
  test.each(BAD)('mint: %s -> a:mint-invalid (§4.1)', (_n, b) => {
    expect(parseMint(b)).toEqual({ ok: false, reason: 'a:mint-invalid' });
  });
  const IDS = [['..\\x'], ['a:b'], [''], ['0123456789abcdef0123456789abcde'], [ID.toUpperCase()], ['01234567-89ab-cdef-0123-456789abcdef']];
  // parseMint checks the file's shape only; the ID grammar is each caller's check, because the launcher
  // refuses it as id-invalid (§2.5 L0) while the gate reads it as a:mint-invalid (gate.test.js).
  test.each(IDS)('run ID fixture %j refused (§4.2)', (id) => {
    expect(RUN_ID_RE.test(id)).toBe(false);
  });
  test('RUN_ID_RE accepts a 32-hex lowercase ID', () => {
    expect(RUN_ID_RE.test(ID)).toBe(true);
  });
  test('mint: parseMint checks the file\'s shape only, not the ID grammar - an uppercase-hex ID still parses (§4.1, R23-1)', () => {
    const upper = ID.toUpperCase();
    expect(parseMint(mint(`RUN_ID=${upper}\n`))).toEqual({ ok: true, runId: upper });
  });
});

describe('§6.2 stage order', () => {
  test('stage 3 failure -> inconclusive i:grammar (§6.2)', () => expectGate(check(record().replace('\n', '\r\n')), 'inconclusive', ['i:grammar']));
  test('stage 3 runs before stage 5: a partial spawn block (missing RUNNER_PID) with EXIT=timeout -> inconclusive i:grammar, not e:timeout (§6.2, T3-C4b-15)', () => {
    expectGate(check(record({ spawn: { RUNNER_PID: undefined }, exit: { EXIT: 'timeout', KILL: 'ok' } })), 'inconclusive', ['i:grammar']);
  });
  // T3-C4b-15's fixture above is malformed (parsed.ok === false), so it can only ever exercise stage 3
  // against stage 5 - a stage 3/5 swap and a stage 4/5 swap are both invisible to it by construction,
  // because parseRecord is all-or-nothing and a malformed record can never independently carry a
  // stage-4 condition. These four rows are WELL-FORMED records (parsed.ok === true) that pair a stage-4
  // failure (dirName foreign) with each of stage 5's four EXIT/KILL conditions, so a swap that checks
  // EXIT/KILL before identity reads the wrong reason token (T3-S9-3).
  test('stage 4 runs before stage 5: dirName foreign WITH EXIT=timeout still reads i:foreign, not e:timeout (§6.2, T3-S9-3)', () => {
    expectGate(check(record({ exit: { EXIT: 'timeout', KILL: 'ok' } }), { dirName: OTHER }), 'inconclusive', ['i:foreign']);
  });
  test('stage 4 runs before stage 5: dirName foreign WITH EXIT=lock-lost still reads i:foreign, not i:lock-lost (§6.2, T3-S9-3)', () => {
    expectGate(check(record({ exit: { EXIT: 'lock-lost' } }), { dirName: OTHER }), 'inconclusive', ['i:foreign']);
  });
  test('stage 4 runs before stage 5: dirName foreign WITH EXIT=spawn-error:* still reads i:foreign, not a:spawn-error (§6.2, T3-S9-3)', () => {
    expectGate(check(record({ exit: { EXIT: 'spawn-error:ENOENT' } }), { dirName: OTHER }), 'inconclusive', ['i:foreign']);
  });
  test('stage 4 runs before stage 5: dirName foreign WITH KILL=failed:* still reads i:foreign, not i:kill-failed (§6.2, T3-S9-3)', () => {
    expectGate(check(record({ exit: { KILL: 'failed:128' } }), { dirName: OTHER }), 'inconclusive', ['i:foreign']);
  });
  test('stage 4 failure -> inconclusive i:foreign: the directory name is not M-1 (§6.2)', () => expectGate(check(record(), { dirName: OTHER }), 'inconclusive', ['i:foreign']));
  test('stage 4 failure -> inconclusive i:foreign: the RESULT line carries another RUN_ID (§6.2)', () => expectGate(check(record({ completion: { RESULT: resultLine({ runId: OTHER }) } })), 'inconclusive', ['i:foreign']));
  test('stage 4 failure -> inconclusive i:pid: S-31 differs from S-4 (§6.2)', () => expectGate(check(record({ exit: { WAITED_PID: '6161' } })), 'inconclusive', ['i:pid']));
  test('stage 4 failure -> inconclusive i:grammar: S-10 is not sha256(S-9) (§6.2)', () => expectGate(check(record({ spawn: { ARGV_SHA256: H('0') } })), 'inconclusive', ['i:grammar']));
  test('stage 5 failure -> inconclusive e:timeout (§6.2)', () => expectGate(check(record({ exit: { EXIT: 'timeout', KILL: 'ok' } })), 'inconclusive', ['e:timeout']));
  test('stage 5 failure -> inconclusive i:lock-lost (§6.2)', () => expectGate(check(record({ exit: { EXIT: 'lock-lost' } })), 'inconclusive', ['i:lock-lost']));
  test('stage 5 failure -> inconclusive i:kill-failed (§6.2)', () => expectGate(check(record({ exit: { KILL: 'failed:128' } })), 'inconclusive', ['i:kill-failed']));
  test('stage 6 failure -> inconclusive i:unfinished (§6.2)', () => expectGate(check(record({ noCompletion: true })), 'inconclusive', ['i:unfinished']));
  test('stage 7 failure -> inconclusive c:sha (§6.2)', () => expectGate(check(record(), { recomputed: { ...RECOMPUTED, REPORT_SHA256: H('9') } }), 'inconclusive', ['c:sha']));
  test('stage 8 failure -> inconclusive runner:<letters joined by +> (§6.2)', () => {
    expectGate(check(record({ completion: { RESULT: resultLine({ result: 'inconclusive', reasons: 'b,h' }) } })), 'inconclusive', ['runner:b+h']);
  });
  test('stage 9 failure -> not-green exit-disagree: clean with EXIT=3 (G29 A) (§6.2)', () => expectGate(check(record({ exit: { EXIT: '3' } })), 'not-green', ['exit-disagree']));
  test('stage 9 failure -> not-green exit-disagree: dirty with EXIT=0 (§6.2)', () => {
    expectGate(check(record({ completion: { RESULT: resultLine({ result: 'dirty' }) } })), 'not-green', ['exit-disagree']);
  });
  test('stage 9 pairing is exact, not "non-zero": dirty with EXIT=1 (not A-13\'s dirty code) -> not-green exit-disagree (§6.2, A-21b, T3-C4b-16)', () => {
    expectGate(check(record({ completion: { RESULT: resultLine({ result: 'dirty' }) }, exit: { EXIT: '1' } })), 'not-green', ['exit-disagree']);
  });
  test('stage 10 failure -> inconclusive h:gate-fp when freshness is not computable (§6.2)', () => expectGate(check(record(), { fresh: 'not-computable' }), 'inconclusive', ['h:gate-fp']));
  test('stage 10 failure -> not-green fresh (§6.2)', () => expectGate(check(record(), { fresh: 'no:fp' }), 'not-green', ['fresh']));
  test('stage 11 failure -> not-green dirty (§6.2)', () => {
    expectGate(check(record({ completion: { RESULT: resultLine({ result: 'dirty' }) }, exit: { EXIT: DIRTY } })), 'not-green', ['dirty']);
  });
  test('stage 12 failure -> not-green pin (§6.2, T3-H7)', () => expectGate(check(record({ pin: 'mismatch', version: '4.1.9' })), 'not-green', ['pin']));
  test('stage 12 reads S-12 itself, not just the RESULT line\'s own copy: S-12 mismatches alone (§6.2, T3-C4b-17)', () => {
    expectGate(check(record({ spawn: { VITEST_PIN: 'mismatch' } })), 'not-green', ['pin']);
  });
  test('only stages 10-12 accumulate, in the order dirty,fresh,pin (§6.2)', () => {
    const t = record({ pin: 'mismatch', version: '4.1.9', completion: { RESULT: resultLine({ result: 'dirty', pin: 'mismatch', version: '4.1.9' }) }, exit: { EXIT: DIRTY } });
    expectGate(check(t, { fresh: 'no:fp,vitest' }), 'not-green', ['dirty', 'fresh', 'pin']);
  });
  test('inconclusive dominates: a timed-out dirty record reads e:timeout only (§6.2)', () => {
    expectGate(check(record({ completion: { RESULT: resultLine({ result: 'dirty' }) }, exit: { EXIT: 'timeout', KILL: 'ok' } }), { fresh: 'no:fp' }), 'inconclusive', ['e:timeout']);
  });
  test('all stages pass -> GATE=green REASONS=- (G29 C) (§6.2)', () => expectGate(check(record()), 'green', []));
  test('the REASONS vocabulary is closed, verified on its own evidence (§6.2, T3-C4b-17: self-contained, fails run alone under -t before this fix)', () => {
    // Gathers its own reasons directly, rather than reading a module-global array other rows in
    // this file populate as a side effect - that made this row pass or fail by execution order
    // (`vitest run -t "REASONS vocabulary"` alone always failed: 0 rows seen).
    const gathered = [
      check(record().replace('\n', '\r\n')),
      check(record(), { dirName: OTHER }),
      check(record({ exit: { WAITED_PID: '6161' } })),
      check(record({ exit: { EXIT: 'timeout', KILL: 'ok' } })),
      check(record({ exit: { EXIT: 'lock-lost' } })),
      check(record({ exit: { KILL: 'failed:128' } })),
      check(record({ noCompletion: true })),
      check(record(), { recomputed: { ...RECOMPUTED, REPORT_SHA256: H('9') } }),
      check(record({ completion: { RESULT: resultLine({ result: 'inconclusive', reasons: 'b,h' }) } })),
      check(record({ exit: { EXIT: '3' } })),
      check(record({ completion: { RESULT: resultLine({ result: 'dirty' }) } })),
      check(record(), { fresh: 'not-computable' }),
      check(record(), { fresh: 'no:fp' }),
      check(record({ completion: { RESULT: resultLine({ result: 'dirty' }) }, exit: { EXIT: DIRTY } })),
      check(record({ pin: 'mismatch', version: '4.1.9' })),
    ].flatMap((r) => r.reasons);
    expect(gathered.length).toBeGreaterThanOrEqual(15);
    for (const tok of gathered) expect(tok).toMatch(VOCAB);
  });
});

describe('§6.3 freshness', () => {
  const rec = { fpEnd: H('a'), vitestVersion: '4.1.8' };
  const ROWS = [
    ['yes', { fpNow: H('a'), versionNow: '4.1.8' }],
    ['no:fp', { fpNow: H('b'), versionNow: '4.1.8' }],
    ['no:vitest', { fpNow: H('a'), versionNow: '4.1.9' }],
    ['no:fp,vitest', { fpNow: H('b'), versionNow: '4.1.9' }],
    ['not-computable', { fpNow: null, versionNow: '4.1.8' }],
  ];
  test.each(ROWS)('freshness: %s (§6.3)', (want, now) => {
    expect(freshness(rec, now)).toBe(want);
  });
  test('freshness: an unknown current vitest version is not computable (§6.3)', () => {
    expect(freshness(rec, { fpNow: H('a'), versionNow: null })).toBe('not-computable');
  });
});

describe('§6.1 gate line', () => {
  test('the gate line is <= 512 B printable ASCII with its keys in order (§6.1)', () => {
    const line = formatGateLine({ gate: 'not-green', reasons: ['dirty', 'fresh', 'pin'], runId: ID, result: 'dirty', exit: DIRTY, vitestPin: 'mismatch', vitestVersion: '4.1.9', fresh: 'no:fp' });
    expect(line).toBe(`GATE=not-green REASONS=dirty,fresh,pin RUN_ID=${ID} RESULT=dirty EXIT=${DIRTY} VITEST_PIN=mismatch VITEST_VERSION=4.1.9 FRESH=no:fp`);
    expect(Buffer.byteLength(line)).toBeLessThanOrEqual(512);
    expect(line).toMatch(/^[ -~]+$/);
  });
  test('the gate line prints - for every value it does not have (§6.1)', () => {
    expect(formatGateLine({ gate: 'inconclusive', reasons: ['a:mint-missing'] })).toBe('GATE=inconclusive REASONS=a:mint-missing RUN_ID=- RESULT=- EXIT=- VITEST_PIN=- VITEST_VERSION=- FRESH=-');
    expect(formatGateLine({ gate: 'pending', reasons: [], runId: ID })).toBe(`GATE=pending REASONS=- RUN_ID=${ID} RESULT=- EXIT=- VITEST_PIN=- VITEST_VERSION=- FRESH=-`);
  });
});
