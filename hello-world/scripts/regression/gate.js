// Lane A gate (design §3.2, §6). IO entry: the only verdict emitter.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseMint, greenCheck, freshness, formatGateLine, parseResultTokens } from './gateCheck.js';
import { parseRecord, isRecordFinished } from './statusRecord.js';
import { parseLock, liveness, confirmation } from './lockFile.js';
import { RUN_ID_RE, TIMING } from './launchPolicy.js';
import { readLockText, sha256File, recordBase, toplevel, vitestMjsPath, readVitestVersion } from './io.js';

const realSleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function lockPathFor(base) {
  const top = toplevel();
  const hash = createHash('sha256').update(Buffer.from(top || '', 'utf8')).digest('hex');
  return join(base, `lock-${hash}`);
}

async function readLockOnce(path) {
  const read = readLockText(path);
  if (read.state === 'absent') return { state: 'absent' };
  const parsed = parseLock(read.text);
  if (parsed.ok) return { state: 'parsed', lock: parsed.lock, text: read.text };
  return { state: 'unparseable', text: read.text };
}

function hashOrAbsent(path) {
  try {
    return sha256File(path);
  } catch {
    return 'absent';
  }
}

// §6.1-§6.3: mint -> liveness (if not finished) -> greenCheck (if finished). One printed line.
export async function gate(opts, deps = {}) {
  const now = deps.now || Date.now;
  const sleep = deps.sleep || realSleep;
  const timing = deps.timing || TIMING;
  const doFingerprint = deps.fingerprint || (async () => ({ ok: false }));
  const doVitestVersion = deps.vitestVersion || (() => readVitestVersion(vitestMjsPath()));
  const base = opts.recordBase || recordBase();

  let mintBytes;
  try {
    mintBytes = readFileSync(opts.mint);
  } catch {
    return { line: formatGateLine({ gate: 'inconclusive', reasons: ['a:mint-missing'] }) };
  }
  const mint = parseMint(mintBytes);
  if (!mint.ok) return { line: formatGateLine({ gate: 'inconclusive', reasons: [mint.reason] }) };
  if (!RUN_ID_RE.test(mint.runId)) return { line: formatGateLine({ gate: 'inconclusive', reasons: ['a:mint-invalid'] }) };
  const mintRunId = mint.runId;

  const runDir = join(base, mintRunId);
  const statusPath = join(runDir, 'status.txt');
  const readStatus = () => {
    try {
      return readFileSync(statusPath, 'utf8');
    } catch {
      return null;
    }
  };

  let statusText = readStatus();
  let finished = statusText !== null && isRecordFinished(statusText);

  if (!finished) {
    const lockRead = await readLockOnce(lockPathFor(base));
    const obs = { mintRunId, finished: false, statusExists: statusText !== null, lockRead, nowMs: now() };
    const r = liveness(obs, timing);
    if (r.final) return { line: formatGateLine({ gate: r.final.gate, reasons: [r.final.reasons], runId: mintRunId }) };

    const waitS = r.row === 'V-6' ? timing.OVERDUE_RECHECK_S : timing.SECOND_READ_S;
    await sleep(waitS * 1000);
    statusText = readStatus();
    finished = statusText !== null && isRecordFinished(statusText);
    const lockRead2 = await readLockOnce(lockPathFor(base));
    const obs2 = { mintRunId, finished, statusExists: statusText !== null, lockRead: lockRead2, nowMs: now() };
    const c = confirmation(obs, obs2, timing);
    if (!c.judge) return { line: formatGateLine({ gate: c.gate, reasons: [c.reasons], runId: mintRunId }) };
  }

  const recordText = statusText;
  const parsed = parseRecord(recordText);
  let resultClass = '-';
  let exitVal = '-';
  let pin = '-';
  let version = '-';
  if (parsed.ok) {
    if (parsed.blocks.exit) exitVal = parsed.blocks.exit.EXIT;
    if (parsed.blocks.completion) {
      const tokens = parseResultTokens(parsed.blocks.completion.RESULT);
      resultClass = tokens.RESULT;
      pin = tokens.VITEST_PIN;
      version = tokens.VITEST_VERSION;
    }
  }

  const recomputed = {
    REPORT_SHA256: hashOrAbsent(join(runDir, 'report.json')),
    JUDGED_BAD_SHA256: hashOrAbsent(join(runDir, 'judged-bad.jsonl')),
    VITEST_JSON_SHA256: hashOrAbsent(join(runDir, 'vitest.json')),
    VITEST_STDOUT_SHA256: hashOrAbsent(join(runDir, 'vitest.stdout.txt')),
    VITEST_STDERR_SHA256: hashOrAbsent(join(runDir, 'vitest.stderr.txt')),
  };

  let fresh = 'not-computable';
  if (parsed.ok && parsed.blocks.completion) {
    const fp = await doFingerprint();
    const versionNow = await doVitestVersion();
    fresh = freshness(
      { fpEnd: parsed.blocks.completion.FP_END, vitestVersion: parsed.blocks.spawn ? parsed.blocks.spawn.VITEST_VERSION : null },
      { fpNow: fp && fp.ok ? fp.digest : null, versionNow },
    );
  }

  const check = greenCheck({ mintRunId, dirName: mintRunId, recordText, recomputed, fresh });
  return {
    line: formatGateLine({
      gate: check.gate, reasons: check.reasons, runId: mintRunId, result: resultClass, exit: exitVal, vitestPin: pin, vitestVersion: version, fresh,
    }),
  };
}

export function parseArgs(argv) {
  let mint;
  let recordBaseOverride;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--mint') {
      i += 1;
      if (argv[i] === undefined) return { ok: false, reason: 'missing-value' };
      mint = argv[i];
    } else if (a === '--record-base') {
      i += 1;
      if (argv[i] === undefined) return { ok: false, reason: 'missing-value' };
      recordBaseOverride = argv[i];
    } else {
      return { ok: false, reason: `unrecognised:${a}` };
    }
  }
  if (mint === undefined) return { ok: false, reason: 'missing-mint' };
  return { ok: true, options: { mint, recordBase: recordBaseOverride } };
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
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`GATE: refused ${parsed.reason}\n`);
    process.exitCode = 2;
    return;
  }
  const r = await gate(parsed.options);
  process.stdout.write(`${r.line}\n`);
  process.exitCode = 0;
}

if (invokedDirectly()) {
  main().catch((err) => {
    process.stderr.write(`${err && err.stack ? err.stack : err}\n`);
    process.exitCode = 1;
  });
}
