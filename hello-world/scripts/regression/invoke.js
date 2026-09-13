// Lane A committed form-C invoker (design §9). IO entry. spawnSync is sanctioned here only:
// its stdio is inherited, so no maxBuffer exists (the §7.3 no-spawnSync rule is scoped to io.js).
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decodeFormC, validateInvokeArgv } from './argv.js';
import { vitestEnv, envNamesSha256, recursionGuard, TIMING } from './launchPolicy.js';
import { vitestMjsPath, recordBase, toplevel } from './io.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// §9: decode, re-validate, spawn in isolation, report. `deps` lets fixtures point this at a stub.
export async function invoke(payloadB64, deps = {}) {
  const doVitestMjsPath = deps.vitestMjsPath || vitestMjsPath;
  const cwd = deps.cwd || resolve(HERE, '..', '..');
  const base = deps.base || recordBase();
  const callerEnv = deps.env || process.env;
  const timeoutMs = deps.timeoutMs || TIMING.ISOLATED_TIMEOUT_S * 1000;

  const decoded = decodeFormC(payloadB64);
  const lines = [];
  if (!decoded.ok) {
    lines.push('ARGV=-');
    lines.push(`REFUSED=${decoded.reason}`);
    return { lines, exitCode: 2 };
  }
  lines.push(`ARGV=${JSON.stringify(decoded.value)}`);
  const reason = validateInvokeArgv(decoded.value, doVitestMjsPath());
  if (reason) {
    lines.push(`REFUSED=${reason}`);
    return { lines, exitCode: 2 };
  }

  mkdirSync(base, { recursive: true });
  let jsonPath = join(base, `iso-${randomBytes(16).toString('hex')}.json`);
  while (existsSync(jsonPath)) jsonPath = join(base, `iso-${randomBytes(16).toString('hex')}.json`);

  const childEnv = vitestEnv(callerEnv);
  const argv = [...decoded.value, `--outputFile.json=${jsonPath}`];
  const res = spawnSync(process.execPath, argv, { cwd, env: childEnv, stdio: 'inherit', timeout: timeoutMs, windowsHide: true });

  const timedOut = (res.error && res.error.code === 'ETIMEDOUT') || (res.signal && res.status === null && res.error);
  let exitToken;
  if (timedOut) exitToken = 'timeout';
  else if (res.error) exitToken = `spawn-error:${res.error.code || 'UNKNOWN'}`;
  else if (res.signal) exitToken = `signal:${res.signal}`;
  else exitToken = String(res.status);

  let jsonState = 'absent';
  let record = null;
  if (existsSync(jsonPath)) {
    try {
      record = JSON.parse(readFileSync(jsonPath, 'utf8'));
      jsonState = 'present';
    } catch {
      jsonState = 'unparseable';
    }
  }
  const tests = jsonState === 'present' && typeof record.numTotalTests === 'number' ? record.numTotalTests : null;
  const failed = jsonState === 'present' && typeof record.numFailedTests === 'number' ? record.numFailedTests : null;
  const isolated = jsonState !== 'present' || tests === 0 || exitToken === 'timeout' ? 'inconclusive' : 'observed';
  const envSha = envNamesSha256(childEnv);
  lines.push(
    `INVOKED EXIT=${exitToken} JSON=${jsonState} TESTS=${tests === null ? '-' : tests} FAILED=${failed === null ? '-' : failed} `
    + `ISOLATED=${isolated} JSONPATH=${jsonPath} ENV_NAMES_SHA256=${envSha}`,
  );

  return { lines, exitCode: exitToken === 'timeout' ? 1 : (res.status ?? 1) };
}

export function parseArgs(argv) {
  if (argv.length !== 1) return { ok: false, reason: 'argc' };
  if (argv[0].startsWith('-')) return { ok: false, reason: 'unrecognised' };
  return { ok: true, options: { payload: argv[0] } };
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
    process.stderr.write('INVOKE: refused recursion-guard\n');
    process.exitCode = 2;
    return;
  }
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`INVOKE: refused ${parsed.reason}\n`);
    process.exitCode = 2;
    return;
  }
  const r = await invoke(parsed.options.payload);
  process.stdout.write(`${r.lines.join('\n')}\n`);
  process.exitCode = r.exitCode;
}

if (invokedDirectly()) {
  main().catch((err) => {
    process.stderr.write(`${err && err.stack ? err.stack : err}\n`);
    process.exitCode = 1;
  });
}
