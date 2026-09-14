// Lane A report rows (design §5.2 RESULT line, §5.3 judged-bad rows and report.json, §6.4 briefText). Pure.
import { describe, test, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { RESULT_KEYS, formatResultLine, judgedBadLine, numberKeys, capEvidence, blockSha256, briefText } from './report.js';

const ID = '0123456789abcdef0123456789abcdef';
const H = (c) => c.repeat(64);
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const KEYS = ['RESULT', 'RUN_ID', 'REASONS', 'VITEST_PIN', 'VITEST_VERSION', 'FILES', 'CASES', 'VITEST_CASES', 'REPORTED_CASES',
  'JUDGED_BAD', 'ORPHAN', 'COULD_NOT_JUDGE', 'CNJ_BASELINE', 'CNJ_NEW', 'CNJ_GONE',
  'VITEST_FAILED_FILES', 'VITEST_FAILED_TESTS', 'VITEST_ERRORS',
  'S_MISSING_PATHS', 'S_FAIL', 'S_NO_MATCH', 'S_VACUOUS', 'S_COUNT_SHORT', 'S_CLAIM_FAIL', 'S_UNSUPPORTED', 'S_NOT_COVERED', 'S_PASS'];
const fields = (o = {}) => ({
  RESULT: 'dirty', RUN_ID: ID, REASONS: '-', VITEST_PIN: 'match', VITEST_VERSION: '4.1.8', FILES: 2, CASES: 5, VITEST_CASES: 4,
  REPORTED_CASES: 4, JUDGED_BAD: 2, ORPHAN: 1, COULD_NOT_JUDGE: 0, CNJ_BASELINE: 'absent', CNJ_NEW: 0, CNJ_GONE: 0,
  VITEST_FAILED_FILES: 1, VITEST_FAILED_TESTS: 1, VITEST_ERRORS: 0,
  S_MISSING_PATHS: 0, S_FAIL: 1, S_NO_MATCH: 0, S_VACUOUS: 0, S_COUNT_SHORT: 0, S_CLAIM_FAIL: 0, S_UNSUPPORTED: 0, S_NOT_COVERED: 0, S_PASS: 3, ...o,
});
const base = {
  runId: ID, command: 'npx vitest run --no-file-parallelism --allowOnly=false planted/p02.fail.test.js', evidence: 'x', evidenceTruncated: false,
  fpEnd: H('a'), argvRef: 'status.txt#ARGV', argvSha256: H('b'),
};
const caseRow = (o = {}) => ({ ...base, key: 'R-902|s1|k1|fail|planted/p02.fail.test.js|p02 fails#1#1', kind: 'fail', cause: 'test:planted/p02.fail.test.js|p02 fails#1',
  caseId: 'R-902', corpusFile: 'docs/regression/planted.md', automatable: 'yes', contextRef: 'R-902', step: 1, stepText: '1. Run `x`.', span: 'npx vitest run x', test: 'planted/p02.fail.test.js|p02 fails#1', ...o });

describe('§5.2 the RESULT line', () => {
  test('RESULT line: keys in order, each once; "-" only under inconclusive (§5.2)', () => {
    expect(RESULT_KEYS).toEqual(KEYS);
    const line = formatResultLine(fields(), { judgedBadLineCount: 2 });
    expect(line.split(' ').map((t) => t.slice(0, t.indexOf('=')))).toEqual(KEYS);
    expect(line).toMatch(/^[ -~]+$/);
    expect(Buffer.byteLength(line)).toBeLessThanOrEqual(1024);
  });
  test('RESULT line: "-" in a count under RESULT=dirty is refused (§5.2)', () => {
    expect(() => formatResultLine(fields({ S_FAIL: '-' }), { judgedBadLineCount: 2 })).toThrow();
  });
  test('RESULT line: "-" outside inconclusive is refused even in a field the sum rule never reads (§5.2, T3-C4b-17)', () => {
    // S_FAIL above is one of the summed S_* keys, so a build that dropped the dedicated "-"-outside-
    // inconclusive check would still throw here (Number('-') breaks the sum), masking the gap. ORPHAN
    // is not summed and not a CORE_KEYS field, so only the dedicated check can catch this row.
    expect(() => formatResultLine(fields({ ORPHAN: '-' }), { judgedBadLineCount: 2 })).toThrow();
  });
  test('RESULT line: with S-15 no, every VITEST_* and S_* count is "-" under inconclusive (§5.2)', () => {
    const dash = Object.fromEntries(KEYS.filter((k) => k.startsWith('VITEST_CASES') || k.startsWith('VITEST_FAILED') || k === 'VITEST_ERRORS' || k.startsWith('S_')).map((k) => [k, '-']));
    const line = formatResultLine(fields({ RESULT: 'inconclusive', REASONS: 'a', ...dash, REPORTED_CASES: '-', JUDGED_BAD: '-', ORPHAN: '-', COULD_NOT_JUDGE: '-', CNJ_NEW: '-', CNJ_GONE: '-' }), { judgedBadLineCount: 0 });
    expect(line).toContain('REASONS=a');
    expect(line).toContain('S_PASS=-');
  });
  test('RESULT line: REASONS is "-" unless the result is inconclusive (§5.2)', () => {
    expect(() => formatResultLine(fields({ REASONS: 'b' }), { judgedBadLineCount: 2 })).toThrow();
  });
  test('sum of S_* = VITEST_CASES; JUDGED_BAD = jsonl line count', () => {
    expect(() => formatResultLine(fields({ S_PASS: 4 }), { judgedBadLineCount: 2 })).toThrow();
    expect(() => formatResultLine(fields(), { judgedBadLineCount: 3 })).toThrow();
    expect(() => formatResultLine(fields(), { judgedBadLineCount: 2 })).not.toThrow();
  });
});

describe('§5.3 judged-bad rows', () => {
  test('judged-bad row fields per kind: case (§5.3, T3-L21)', () => {
    const o = JSON.parse(judgedBadLine(caseRow()));
    for (const k of ['key', 'runId', 'kind', 'cause', 'command', 'evidence', 'evidenceTruncated', 'fpEnd', 'argvRef', 'argvSha256', 'caseId', 'corpusFile', 'automatable', 'contextRef', 'step', 'stepText', 'span', 'test']) {
      expect(o).toHaveProperty(k);
    }
  });
  test('judged-bad row fields per kind: claim (§5.3, T3-L21)', () => {
    const o = JSON.parse(judgedBadLine(caseRow({ kind: 'claim', key: 'R-925|claim|R-925|k1|3 tests pass.|count-short#1', cause: 'claim:R-925|k1|3 tests pass.', claimKey: 'R-925|k1|3 tests pass.', step: null, stepText: null, span: null, test: undefined })));
    expect(o.step).toBeNull();
    expect(o.span).toBeNull();
    expect(o.claimKey).toBe('R-925|k1|3 tests pass.');
  });
  test('judged-bad row fields per kind: orphan (§5.3, T3-L21)', () => {
    const o = JSON.parse(judgedBadLine({ ...base, key: 'RUN|orphan|error#1', kind: 'orphan-error', cause: 'error:#1', caseId: 'RUN', corpusFile: null, automatable: null, contextRef: null, span: null }));
    expect(o.caseId).toBe('RUN');
    expect([o.corpusFile, o.automatable, o.contextRef]).toEqual([null, null, null]);
  });
  test('judged-bad row fields per kind: refused-token (§5.3, T3-L21)', () => {
    const token = '--config=./evil.config.mjs';
    const row = { ...base, key: 'R-950|s1|k1|flag-shaped-token#1', kind: 'flag-shaped-token', token, command: '\u2014 no command: token refused (flag-shaped-token)',
      cause: `refused:flag-shaped-token:${sha256(token).slice(0, 12)}`, caseId: 'R-950', corpusFile: 'docs/regression/x.md', automatable: 'yes', contextRef: 'R-950', step: 1, stepText: 's', span: 'npx vitest run x' };
    expect(JSON.parse(judgedBadLine(row)).cause).toBe(`refused:flag-shaped-token:${sha256(token).slice(0, 12)}`);
    expect(() => judgedBadLine({ ...row, cause: 'refused:flag-shaped-token:000000000000' })).toThrow();
  });
  test('judged-bad row: a missing required field is refused (§5.3)', () => {
    const row = caseRow();
    delete row.fpEnd;
    expect(() => judgedBadLine(row)).toThrow();
  });
  test('keys end #n and are unique across the block (T3-L40)', () => {
    expect(numberKeys(['R-1|a', 'R-1|b', 'R-1|a'])).toEqual(['R-1|a#1', 'R-1|b#1', 'R-1|a#2']);
    const block = numberKeys(['R-916|s1|k1|fail|planted/p16.dupname.test.js|p16 grp > p16 same name#2', 'RUN|orphan|error', 'RUN|orphan|error']);
    expect(new Set(block).size).toBe(block.length);
    expect(block.every((k) => /#[1-9][0-9]*$/.test(k))).toBe(true);
  });
  test('evidence is capped at 4096 B with evidenceTruncated', () => {
    expect(capEvidence('short')).toEqual({ evidence: 'short', evidenceTruncated: false });
    const big = capEvidence('\u00e9'.repeat(3000));
    expect(Buffer.byteLength(big.evidence)).toBeLessThanOrEqual(4096);
    expect(big.evidenceTruncated).toBe(true);
    expect(big.evidence.includes('\ufffd')).toBe(false);
  });
  test('evidence cap never splits a multi-byte character: a 3-byte character lands the cut mid-character (\u00a75.3, T3-C4b-17)', () => {
    // '\u00e9' above is 2 bytes, and 4096 is even, so every cut point it can reach already lands on a
    // character boundary - the "never split a character" branch never actually runs. A 3-byte
    // character forces byte 4096 into the middle of one, so only the real fallback loop can pass.
    const big = capEvidence('\u20ac'.repeat(2000));
    expect(Buffer.byteLength(big.evidence, 'utf8')).toBe(4095);
    expect(big.evidenceTruncated).toBe(true);
    expect(big.evidence.includes('\ufffd')).toBe(false);
  });
  test('evidence cap never splits a 4-byte character: it phase-shifts the cut into the middle of one at byte 4096 (T3-S9-11)', () => {
    // The 3-byte case above lands its cut one byte short of 4096 by coincidence of that character's
    // width; a 4-byte character forces the naive 4096-byte cut to land mid-character instead, which is
    // the case the fallback loop (not just the byte-length check) has to actually walk backward for.
    const big = capEvidence(`a${'\u{1F600}'.repeat(1200)}`);
    expect(Buffer.byteLength(big.evidence, 'utf8')).toBe(4093);
    expect(big.evidenceTruncated).toBe(true);
    expect(big.evidence.includes('\ufffd')).toBe(false);
  });
});

describe('§5.3 report context and §6.4 brief', () => {
  test('blockSha256 is computed after CRLF -> LF', () => {
    const lf = '### R-001 | area: a | parallel-safe: yes | automatable: yes\n\n**Summary:** s\n';
    expect(blockSha256(lf)).toBe(sha256(lf));
    expect(blockSha256(lf.replace(/\n/g, '\r\n'))).toBe(sha256(lf));
  });
  test('A-23: a row\'s brief renders alone (briefText)', () => {
    const ctx = { summary: '**Summary:** p02 fails.', steps: '**Steps:**\n1. Run `x`.', expected: '**Expected:** The selected files pass.' };
    const t = briefText(caseRow(), ctx, { formC: "& node 'C:/r/invoke.js' 'WyJhIl0='", union: 'Test Files  1 failed | 1 passed (2)', fresh: 'yes' });
    for (const s of ['R-902|s1|k1|fail', ctx.summary, '1. Run `x`.', ctx.expected, ID, H('a'), "& node 'C:/r/invoke.js' 'WyJhIl0='", 'Test Files  1 failed | 1 passed (2)', 'never recompose', 'do not recompose']) {
      expect(t).toContain(s);
    }
  });
  test('A-23: a RUN row reads "\u2014 run-level row" in its three context fields', () => {
    const t = briefText({ ...base, key: 'RUN|orphan|error#1', kind: 'orphan-error', cause: 'error:#1', caseId: 'RUN', corpusFile: null, automatable: null, contextRef: null, span: null }, null, { formC: '', union: 'Errors  1 error', fresh: 'yes' });
    expect(t.split('\u2014 run-level row').length - 1).toBe(3);
  });
  test('A-23: without FRESH=yes the brief carries the shared-fresh-run line instead of the union observation', () => {
    const t = briefText(caseRow(), { summary: 's', steps: 't', expected: 'e' }, { formC: 'f', union: 'Test Files  9 passed (9)', fresh: 'no:fp' });
    expect(t).toContain('a shared fresh run is required');
    expect(t).not.toContain('Test Files  9 passed (9)');
  });
});
