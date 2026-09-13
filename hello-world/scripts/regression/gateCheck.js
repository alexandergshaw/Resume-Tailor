// Lane A gate-check rows (design §4.1 mint, §6.1 gate line, §6.2 stage order, §6.3 freshness). Pure.
import { createHash } from 'node:crypto';
import { parseRecord } from './statusRecord.js';
import { EXIT_CODES } from './launchPolicy.js';

const sha256Hex = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

// §4.1: parseMint checks the file's shape only; the ID grammar is each caller's own check.
export function parseMint(buffer) {
  let bytes = buffer;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3);
  const text = bytes.toString('utf8');
  if (text.includes('\x00')) return { ok: false, reason: 'a:mint-invalid' };
  const stripped = text.replace(/\r/g, '');
  const lines = stripped.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  if (lines.length !== 1) return { ok: false, reason: 'a:mint-invalid' };
  const m = /^RUN_ID=(.*)$/.exec(lines[0]);
  if (!m) return { ok: false, reason: 'a:mint-invalid' };
  return { ok: true, runId: m[1] };
}

// The §5.2 line's first token is always the RESULT class. Tolerate both a bare class value
// (statusRecord already stripped the record's own KEY= envelope) and one still carrying it.
export function parseResultTokens(value) {
  const out = {};
  const tokens = value.split(' ');
  const firstEq = tokens[0].indexOf('=');
  if (firstEq < 0) out.RESULT = tokens[0];
  else out[tokens[0].slice(0, firstEq)] = tokens[0].slice(firstEq + 1);
  for (const part of tokens.slice(1)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    out[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return out;
}

// §6.2: the stage order. The first failing stage decides; only stages 10-12 accumulate.
export function greenCheck({ mintRunId, dirName, recordText, recomputed, fresh }) {
  const parsed = parseRecord(recordText);
  if (!parsed.ok) return { gate: 'inconclusive', reasons: ['i:grammar'] };
  const { blocks } = parsed;
  const resultTokens = blocks.completion ? parseResultTokens(blocks.completion.RESULT) : null;

  if (dirName !== mintRunId) return { gate: 'inconclusive', reasons: ['i:foreign'] };
  if (resultTokens && resultTokens.RUN_ID !== mintRunId) return { gate: 'inconclusive', reasons: ['i:foreign'] };
  if (blocks.spawn && blocks.spawn.RUN_ID !== mintRunId) return { gate: 'inconclusive', reasons: ['i:foreign'] };
  if (blocks.exit && blocks.exit.LAUNCHER_RUN_ID !== mintRunId) return { gate: 'inconclusive', reasons: ['i:foreign'] };
  if (blocks.exit && blocks.spawn && blocks.exit.WAITED_PID !== '-' && blocks.exit.WAITED_PID !== blocks.spawn.RUNNER_PID) {
    return { gate: 'inconclusive', reasons: ['i:pid'] };
  }
  if (blocks.spawn && blocks.spawn.ARGV_SHA256 !== '-' && blocks.spawn.ARGV !== '-') {
    if (blocks.spawn.ARGV_SHA256 !== sha256Hex(blocks.spawn.ARGV)) return { gate: 'inconclusive', reasons: ['i:grammar'] };
  }

  const exit = blocks.exit ? blocks.exit.EXIT : null;
  if (exit === 'timeout') return { gate: 'inconclusive', reasons: ['e:timeout'] };
  if (exit === 'lock-lost') return { gate: 'inconclusive', reasons: ['i:lock-lost'] };
  if (typeof exit === 'string' && exit.startsWith('spawn-error:')) return { gate: 'inconclusive', reasons: ['a:spawn-error'] };
  if (blocks.exit && blocks.exit.KILL.startsWith('failed:')) return { gate: 'inconclusive', reasons: ['i:kill-failed'] };

  if (!blocks.completion) return { gate: 'inconclusive', reasons: ['i:unfinished'] };

  const shaKeys = ['REPORT_SHA256', 'JUDGED_BAD_SHA256', 'VITEST_JSON_SHA256', 'VITEST_STDOUT_SHA256', 'VITEST_STDERR_SHA256'];
  for (const k of shaKeys) {
    const have = blocks.completion[k];
    if (have !== 'absent' && have !== recomputed[k]) return { gate: 'inconclusive', reasons: ['c:sha'] };
  }

  const resultClass = resultTokens.RESULT;
  if (resultClass === 'inconclusive') {
    const letters = (resultTokens.REASONS || '').split(',').filter(Boolean);
    return { gate: 'inconclusive', reasons: [`runner:${letters.join('+')}`] };
  }

  const expectExit = resultClass === 'clean' ? '0' : String(EXIT_CODES.dirty);
  if (blocks.exit.EXIT !== expectExit) return { gate: 'not-green', reasons: ['exit-disagree'] };

  if (fresh === 'not-computable') return { gate: 'inconclusive', reasons: ['h:gate-fp'] };

  const reasons = [];
  if (resultClass === 'dirty') reasons.push('dirty');
  if (fresh !== 'yes') reasons.push('fresh');
  // Stage 12 (design §6.2 row 12) reads S-12 itself (the spawn block's own VITEST_PIN), not the
  // RESULT line's copy of it: comparing S-12 against resultTokens.VITEST_PIN would compare the
  // copy to itself and never catch the two diverging.
  if (blocks.spawn.VITEST_PIN === 'mismatch') reasons.push('pin');
  if (reasons.length > 0) return { gate: 'not-green', reasons };
  return { gate: 'green', reasons: [] };
}

// §6.3: the ONE FRESH function, shared by gate.js and render-row.js.
export function freshness({ fpEnd, vitestVersion }, { fpNow, versionNow }) {
  if (!fpNow || !versionNow) return 'not-computable';
  const fpOk = fpNow === fpEnd;
  const verOk = versionNow === vitestVersion;
  if (fpOk && verOk) return 'yes';
  if (!fpOk && !verOk) return 'no:fp,vitest';
  if (!fpOk) return 'no:fp';
  return 'no:vitest';
}

// §6.1: the one gate-line grammar.
export function formatGateLine(o) {
  const dash = (v) => (v === undefined || v === null ? '-' : v);
  const reasons = o.reasons && o.reasons.length ? o.reasons.join(',') : '-';
  return `GATE=${o.gate} REASONS=${reasons} RUN_ID=${dash(o.runId)} RESULT=${dash(o.result)} EXIT=${dash(o.exit)} `
    + `VITEST_PIN=${dash(o.vitestPin)} VITEST_VERSION=${dash(o.vitestVersion)} FRESH=${dash(o.fresh)}`;
}
