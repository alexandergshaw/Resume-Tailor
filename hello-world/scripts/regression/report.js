// Lane A report rows (design §5.2 RESULT line, §5.3 judged-bad rows and report.json, §6.4 briefText). Pure.
import { createHash } from 'node:crypto';

// §5.2: the RESULT line's keys, in order, each once.
export const RESULT_KEYS = [
  'RESULT', 'RUN_ID', 'REASONS', 'VITEST_PIN', 'VITEST_VERSION', 'FILES', 'CASES', 'VITEST_CASES', 'REPORTED_CASES',
  'JUDGED_BAD', 'ORPHAN', 'COULD_NOT_JUDGE', 'CNJ_BASELINE', 'CNJ_NEW', 'CNJ_GONE',
  'VITEST_FAILED_FILES', 'VITEST_FAILED_TESTS', 'VITEST_ERRORS',
  'S_MISSING_PATHS', 'S_FAIL', 'S_NO_MATCH', 'S_VACUOUS', 'S_COUNT_SHORT', 'S_CLAIM_FAIL', 'S_UNSUPPORTED', 'S_NOT_COVERED', 'S_PASS',
];
const CORE_KEYS = new Set(['RESULT', 'RUN_ID', 'VITEST_PIN', 'VITEST_VERSION', 'FILES', 'CASES', 'CNJ_BASELINE']);
const S_KEYS = ['S_MISSING_PATHS', 'S_FAIL', 'S_NO_MATCH', 'S_VACUOUS', 'S_COUNT_SHORT', 'S_CLAIM_FAIL', 'S_UNSUPPORTED', 'S_NOT_COVERED', 'S_PASS'];

export function formatResultLine(fields, { judgedBadLineCount }) {
  const resultClass = fields.RESULT;
  for (const k of RESULT_KEYS) {
    if (fields[k] !== '-' || k === 'REASONS') continue;
    if (CORE_KEYS.has(k)) throw new Error(`formatResultLine: ${k} may not be -`);
    if (resultClass !== 'inconclusive') throw new Error(`formatResultLine: ${k} may be - only under inconclusive`);
  }
  if (fields.REASONS !== '-' && resultClass !== 'inconclusive') {
    throw new Error('formatResultLine: REASONS must be - unless the result is inconclusive');
  }
  if (resultClass !== 'inconclusive') {
    const sum = S_KEYS.reduce((n, k) => n + Number(fields[k]), 0);
    if (sum !== Number(fields.VITEST_CASES)) throw new Error('formatResultLine: sum of S_* must equal VITEST_CASES');
    if (Number(fields.JUDGED_BAD) !== judgedBadLineCount) throw new Error('formatResultLine: JUDGED_BAD must equal the jsonl line count');
  }
  return RESULT_KEYS.map((k) => `${k}=${fields[k]}`).join(' ');
}

// §5.3: every DEF-16/17 key ends in #n, unique across the block.
export function numberKeys(keys) {
  const counts = new Map();
  return keys.map((k) => {
    const n = (counts.get(k) || 0) + 1;
    counts.set(k, n);
    return `${k}#${n}`;
  });
}

const REQUIRED_JUDGED_BAD_FIELDS = ['key', 'runId', 'kind', 'cause', 'command', 'evidence', 'evidenceTruncated', 'fpEnd', 'argvRef', 'argvSha256'];
const REFUSED_KINDS = new Set(['flag-shaped-token', 'path-escape']);

// §5.3: one DEF-16 row. Refused-token rows carry a cause whose hash matches their token.
export function judgedBadLine(row) {
  for (const f of REQUIRED_JUDGED_BAD_FIELDS) {
    if (!(f in row) || row[f] === undefined) throw new Error(`judgedBadLine: missing ${f}`);
  }
  if (REFUSED_KINDS.has(row.kind)) {
    const m = /^refused:([^:]+):([0-9a-f]{12})$/.exec(row.cause);
    const want = createHash('sha256').update(row.token, 'utf8').digest('hex').slice(0, 12);
    if (!m || m[1] !== row.kind || m[2] !== want) throw new Error('judgedBadLine: refused-token cause does not match its token');
  }
  return JSON.stringify(row);
}

// §5.3: evidence capped at 4096 bytes, never splitting a UTF-8 character.
export function capEvidence(text) {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= 4096) return { evidence: text, evidenceTruncated: false };
  for (let end = 4096; end > 0; end -= 1) {
    const slice = buf.subarray(0, end).toString('utf8');
    if (!slice.includes('�') && Buffer.byteLength(slice, 'utf8') <= 4096) {
      return { evidence: slice, evidenceTruncated: true };
    }
  }
  return { evidence: '', evidenceTruncated: true };
}

// §5.3: the case block's own sha256, after \r\n -> \n.
export function blockSha256(text) {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

const RUN_LEVEL_LINE = '— run-level row';

// §6.4: a row's brief, self-contained. `ctx` is null for a RUN-level row.
export function briefText(row, ctx, { formC, union, fresh }) {
  const summary = ctx ? ctx.summary : RUN_LEVEL_LINE;
  const steps = ctx ? ctx.steps : RUN_LEVEL_LINE;
  const expected = ctx ? ctx.expected : RUN_LEVEL_LINE;
  const unionLine = fresh === 'yes'
    ? union
    : 'a shared fresh run is required: the parent launches one and hands its record to the whole refuter set.';
  return [
    `KEY=${row.key}`,
    `RUN_ID=${row.runId}`,
    `FP_END=${row.fpEnd}`,
    summary,
    steps,
    expected,
    `Evidence: ${row.evidence}`,
    `Union observation: ${unionLine}`,
    `Command: ${formC}`,
    'Run the printed command verbatim with the PowerShell tool; never recompose it from the readable array.',
    'Quote its ARGV= line and its INVOKED line. JSON=absent, JSON=unparseable or TESTS=0 is INCONCLUSIVE, whatever the exit code.',
    `Readable argv (do not recompose): ${row.command}`,
  ].join('\n');
}
