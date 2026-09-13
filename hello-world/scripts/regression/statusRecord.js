// Lane A status-record rows (design §5.1). Pure: parsing, formatting and the grammar as data.

const ISO_RE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const HEX64 = /^[0-9a-f]{64}$/;
const anyNonEmpty = (v) => v.length > 0;

// §5.1: GRAMMAR as data. Delimiter rows carry `line`; key rows carry `block`, `key`, `okDash` and `valueRe`.
export const GRAMMAR = [
  { row: 'S-1', block: 'header', key: 'T3_STATUS', okDash: false, valueRe: (v) => v === 'v1' },
  { row: 'S-2', block: 'spawn', line: '--- spawn ---' },
  { row: 'S-3', block: 'spawn', key: 'RUN_ID', okDash: false, valueRe: (v) => /^[0-9a-f]{32}$/.test(v) },
  { row: 'S-4', block: 'spawn', key: 'RUNNER_PID', okDash: false, valueRe: (v) => /^[1-9][0-9]{0,9}$/.test(v) },
  { row: 'S-5', block: 'spawn', key: 'STARTED', okDash: false, valueRe: (v) => ISO_RE.test(v) },
  { row: 'S-6', block: 'spawn', key: 'TOPLEVEL', okDash: true, valueRe: anyNonEmpty },
  { row: 'S-7', block: 'spawn', key: 'INTEGRITY', okDash: true, valueRe: anyNonEmpty },
  { row: 'S-8', block: 'spawn', key: 'FP_START', okDash: true, valueRe: (v) => HEX64.test(v) },
  { row: 'S-9', block: 'spawn', key: 'ARGV', okDash: true, valueRe: anyNonEmpty },
  { row: 'S-9a', block: 'spawn', key: 'ENV_NAMES_SHA256', okDash: true, valueRe: (v) => HEX64.test(v) },
  { row: 'S-10', block: 'spawn', key: 'ARGV_SHA256', okDash: true, valueRe: (v) => HEX64.test(v) },
  { row: 'S-11', block: 'spawn', key: 'VITEST_VERSION', okDash: true, valueRe: (v) => /^([0-9A-Za-z.+-]+|unknown)$/.test(v) },
  { row: 'S-12', block: 'spawn', key: 'VITEST_PIN', okDash: true, valueRe: (v) => v === 'match' || v === 'mismatch' },
  { row: 'S-13', block: 'spawn', key: 'CNJ_BASELINE_PATH', okDash: false, valueRe: anyNonEmpty },
  { row: 'S-14', block: 'spawn', key: 'CNJ_BASELINE_SHA256', okDash: true, valueRe: (v) => v === 'absent' || HEX64.test(v) },
  { row: 'S-15', block: 'spawn', key: 'VITEST_SPAWNED', okDash: false, valueRe: (v) => v === 'yes' || v === 'no' },
  { row: 'S-16', block: 'completion', line: '--- completion ---' },
  { row: 'S-17', block: 'completion', key: 'SUMMARY_TEST_FILES', okDash: true, valueRe: (v) => v === 'absent' || anyNonEmpty(v) },
  { row: 'S-18', block: 'completion', key: 'SUMMARY_TESTS', okDash: true, valueRe: (v) => v === 'absent' || anyNonEmpty(v) },
  { row: 'S-19', block: 'completion', key: 'SUMMARY_ERRORS', okDash: true, valueRe: (v) => v === 'absent' || v === 'none' || anyNonEmpty(v) },
  { row: 'S-20', block: 'completion', key: 'SUMMARY_DURATION', okDash: true, valueRe: (v) => v === 'absent' || anyNonEmpty(v) },
  { row: 'S-21', block: 'completion', key: 'FP_END', okDash: true, valueRe: (v) => HEX64.test(v) },
  { row: 'S-22', block: 'completion', key: 'REPORT_SHA256', okDash: false, valueRe: (v) => v === 'absent' || HEX64.test(v) },
  { row: 'S-23', block: 'completion', key: 'JUDGED_BAD_SHA256', okDash: false, valueRe: (v) => v === 'absent' || HEX64.test(v) },
  { row: 'S-24', block: 'completion', key: 'VITEST_JSON_SHA256', okDash: false, valueRe: (v) => v === 'absent' || HEX64.test(v) },
  { row: 'S-25', block: 'completion', key: 'VITEST_STDOUT_SHA256', okDash: false, valueRe: (v) => v === 'absent' || HEX64.test(v) },
  { row: 'S-26', block: 'completion', key: 'VITEST_STDERR_SHA256', okDash: false, valueRe: (v) => v === 'absent' || HEX64.test(v) },
  { row: 'S-27', block: 'completion', key: 'FINISHED', okDash: false, valueRe: (v) => ISO_RE.test(v) },
  { row: 'S-28', block: 'completion', key: 'RESULT', okDash: false, valueRe: anyNonEmpty },
  { row: 'S-29', block: 'exit', line: '--- exit ---' },
  { row: 'S-30', block: 'exit', key: 'EXIT', okDash: false, valueRe: (v) => /^(0|[1-9][0-9]*|timeout|lock-lost|signal:[A-Z0-9]+|spawn-error:[A-Z0-9_]+)$/.test(v) },
  { row: 'S-31', block: 'exit', key: 'WAITED_PID', okDash: true, valueRe: (v) => /^[1-9][0-9]{0,9}$/.test(v) },
  { row: 'S-32', block: 'exit', key: 'LAUNCHER_RUN_ID', okDash: false, valueRe: (v) => /^[0-9a-f]{32}$/.test(v) },
  { row: 'S-33', block: 'exit', key: 'TIMEOUT_S', okDash: false, valueRe: (v) => /^[1-9][0-9]*$/.test(v) },
  { row: 'S-34', block: 'exit', key: 'ELAPSED_S', okDash: false, valueRe: (v) => /^[0-9]+$/.test(v) },
  { row: 'S-35', block: 'exit', key: 'KILL', okDash: false, valueRe: (v) => /^(none|ok|failed:.+)$/.test(v) },
  { row: 'S-36', block: 'exit', key: 'ENDED', okDash: false, valueRe: (v) => ISO_RE.test(v) },
  { row: 'S-37', block: 'end', line: '--- end ---' },
];

const BLOCK_KEYS = {};
for (const row of GRAMMAR) {
  if (!row.key) continue;
  BLOCK_KEYS[row.block] = BLOCK_KEYS[row.block] || [];
  BLOCK_KEYS[row.block].push(row);
}
const DELIMITER_LINE = {};
for (const row of GRAMMAR) if (row.line) DELIMITER_LINE[row.block] = row.line;

function parseBlockBody(lines, start, blockName, stopLines) {
  const rows = BLOCK_KEYS[blockName];
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const values = {};
  let i = start;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (stopLines.includes(line)) break;
    const eq = line.indexOf('=');
    if (eq < 0) return null;
    const key = line.slice(0, eq);
    const value = line.slice(eq + 1);
    const row = byKey.get(key);
    if (!row || Object.prototype.hasOwnProperty.call(values, key)) return null;
    if (value === '-') {
      if (!row.okDash) return null;
      values[key] = { dash: true };
    } else {
      if (!row.valueRe(value)) return null;
      values[key] = value;
    }
  }
  if (Object.keys(values).length !== rows.length) return null;
  return { values, next: i };
}

function resultClassOf(resultValue) {
  const m = /^RESULT=(\S+)/.exec(resultValue);
  return m ? m[1] : null;
}

function finalizeDashes(values, resultClass) {
  for (const k of Object.keys(values)) {
    if (values[k] && values[k].dash) {
      if (resultClass !== 'inconclusive') return false;
      values[k] = '-';
    }
  }
  return true;
}

// §5.1 parse rules. Returns {ok:false, reason:'grammar'} or {ok:true, finished, blocks}.
export function parseRecord(text) {
  if (typeof text !== 'string' || text.includes('\r') || !text.endsWith('\n')) return { ok: false, reason: 'grammar' };
  const lines = text.slice(0, -1).split('\n');
  if (lines[0] !== 'T3_STATUS=v1') return { ok: false, reason: 'grammar' };
  let i = 1;
  const blocks = { header: { T3_STATUS: 'v1' } };
  let hasSpawn = false;
  let hasCompletion = false;
  let hasExit = false;
  let finished = false;

  if (lines[i] === DELIMITER_LINE.spawn) {
    i += 1;
    const stop = [DELIMITER_LINE.completion, DELIMITER_LINE.exit, DELIMITER_LINE.end];
    const parsed = parseBlockBody(lines, i, 'spawn', stop);
    if (!parsed) return { ok: false, reason: 'grammar' };
    blocks.spawn = parsed.values;
    i = parsed.next;
    hasSpawn = true;
  }

  if (lines[i] === DELIMITER_LINE.completion) {
    if (!hasSpawn) return { ok: false, reason: 'grammar' };
    i += 1;
    const stop = [DELIMITER_LINE.exit, DELIMITER_LINE.end];
    const parsed = parseBlockBody(lines, i, 'completion', stop);
    if (!parsed) return { ok: false, reason: 'grammar' };
    blocks.completion = parsed.values;
    i = parsed.next;
    hasCompletion = true;
  }

  if (lines[i] === DELIMITER_LINE.exit) {
    i += 1;
    const parsed = parseBlockBody(lines, i, 'exit', [DELIMITER_LINE.end]);
    if (!parsed) return { ok: false, reason: 'grammar' };
    blocks.exit = parsed.values;
    i = parsed.next;
    hasExit = true;
    if (lines[i] === DELIMITER_LINE.end) {
      i += 1;
      finished = true;
    }
  }

  if (i !== lines.length) return { ok: false, reason: 'grammar' };

  const resultClass = hasCompletion ? resultClassOf(blocks.completion.RESULT) : 'inconclusive';
  if (hasSpawn && !finalizeDashes(blocks.spawn, resultClass)) return { ok: false, reason: 'grammar' };
  if (hasCompletion && !finalizeDashes(blocks.completion, resultClass)) return { ok: false, reason: 'grammar' };
  if (hasExit && !finalizeDashes(blocks.exit, resultClass)) return { ok: false, reason: 'grammar' };

  return { ok: true, finished, blocks };
}

// §2.3: "finished" is a lightweight scan, independent of full grammar validity (a torn tail elsewhere
// in the record must not hide a genuinely written S-37 line).
export function isRecordFinished(text) {
  return typeof text === 'string' && text.split('\n').some((l) => l === DELIMITER_LINE.end);
}

export function formatHeader() {
  return 'T3_STATUS=v1\n';
}

export function formatSpawnBlock(f) {
  const keys = BLOCK_KEYS.spawn.map((r) => r.key);
  return `${DELIMITER_LINE.spawn}\n${keys.map((k) => `${k}=${escapeValue(String(f[k]))}\n`).join('')}`;
}

export function formatCompletionBlock(f) {
  const keys = BLOCK_KEYS.completion.map((r) => r.key);
  // S-28's physical line IS the §5.2 line, byte for byte: its own first token already reads RESULT=<class>.
  const line = (k) => (k === 'RESULT' ? escapeValue(String(f[k])) : `${k}=${escapeValue(String(f[k]))}`);
  return `${DELIMITER_LINE.completion}\n${keys.map((k) => `${line(k)}\n`).join('')}`;
}

export function formatExitBlock(f) {
  const keys = BLOCK_KEYS.exit.map((r) => r.key);
  return `${DELIMITER_LINE.exit}\n${keys.map((k) => `${k}=${escapeValue(String(f[k]))}\n`).join('')}${DELIMITER_LINE.end}\n`;
}

// T3-1g-10: C0/C1 controls (except \t) and DEL escaped as \xHH; single-line values.
export function escapeValue(s) {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (ch === '\t') {
      out += ch;
      continue;
    }
    if ((cp >= 0x00 && cp <= 0x1f) || cp === 0x7f || (cp >= 0x80 && cp <= 0x9f)) {
      out += `\\x${cp.toString(16).padStart(2, '0')}`;
    } else {
      out += ch;
    }
  }
  return out;
}
