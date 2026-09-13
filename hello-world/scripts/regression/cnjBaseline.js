// Lane A CNJ baseline writer (design §1 M-24, §5.4; R16-1). IO entry.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseRecord } from './statusRecord.js';
import { formatCnjBaseline, parseCnjBaseline } from './verdict.js';
import { parseResultTokens } from './gateCheck.js';
import { toplevel } from './io.js';

const sha256Hex = (buf) => createHash('sha256').update(buf).digest('hex');

function targetPath(root) {
  return join(root, 'hello-world', 'scripts', 'regression', 'cnj-baseline.txt');
}

// §5.4: refuses unless the named run is finished, its RESULT is clean/dirty, and its report.json
// hash matches the completion block's. Writes only the fixed path, then re-parses what it wrote.
export async function cnjBaseline({ run, replace = false }, deps = {}) {
  const doToplevel = deps.toplevel || toplevel;
  const doWrite = deps.write || ((p, t) => writeFileSync(p, t, { flag: replace ? 'w' : 'wx' }));
  const statusText = readFileSync(join(run, 'status.txt'), 'utf8');
  const parsed = parseRecord(statusText);
  if (!parsed.ok || !parsed.finished || !parsed.blocks.completion) return ['CNJ_BASELINE_WRITE=refused reason=unfinished'];
  const exitBlock = parsed.blocks.exit;
  if (exitBlock.EXIT !== '0') return ['CNJ_BASELINE_WRITE=refused reason=exit'];
  const resultValue = parsed.blocks.completion.RESULT;
  const resultTokens = parseResultTokens(resultValue);
  if (resultTokens.RESULT === 'inconclusive') return ['CNJ_BASELINE_WRITE=refused reason=inconclusive'];
  const reportPath = join(run, 'report.json');
  const reportBytes = readFileSync(reportPath);
  const reportHash = sha256Hex(reportBytes);
  const completionReportSha = parsed.blocks.completion.REPORT_SHA256;
  if (completionReportSha !== 'absent' && completionReportSha !== reportHash) return ['CNJ_BASELINE_WRITE=refused reason=report-sha'];
  const report = JSON.parse(reportBytes.toString('utf8'));
  const keys = (report.cnj && report.cnj.items ? report.cnj.items : []).map((i) => i.key);

  const root = doToplevel();
  const target = targetPath(root);
  if (!replace && existsSync(target)) return ['CNJ_BASELINE_WRITE=refused reason=exists'];

  const runId = parsed.blocks.spawn ? parsed.blocks.spawn.RUN_ID : /RUN_ID=(\S+)/.exec(resultValue)[1];
  const vitestVersion = (parsed.blocks.spawn && parsed.blocks.spawn.VITEST_VERSION) || 'unknown';
  const text = formatCnjBaseline({ runId, fp: parsed.blocks.completion.FP_END, vitest: vitestVersion, keys });
  doWrite(target, text);

  const written = readFileSync(target, 'utf8');
  let backParsed;
  try {
    backParsed = parseCnjBaseline(written);
  } catch {
    return ['CNJ_BASELINE_WRITE=refused reason=parse-back'];
  }
  if (JSON.stringify([...backParsed.keys].sort()) !== JSON.stringify([...keys].sort())) {
    return ['CNJ_BASELINE_WRITE=refused reason=parse-back'];
  }
  const writtenNormalised = written.replace(/\r\n/g, '\n');
  const sha = sha256Hex(Buffer.from(writtenNormalised, 'utf8'));
  const keysSha = sha256Hex(Buffer.from([...keys].sort().join('\n'), 'utf8'));
  return [`CNJ_BASELINE_WRITE=ok COUNT=${keys.length} SHA256=${sha}`, `KEYS_SHA256=${keysSha}`];
}

export function parseArgs(argv) {
  let run;
  let replace = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--run') {
      i += 1;
      if (argv[i] === undefined) return { ok: false, reason: 'missing-value' };
      run = argv[i];
    } else if (a === '--replace') {
      replace = true;
    } else {
      return { ok: false, reason: `unrecognised:${a}` };
    }
  }
  if (run === undefined) return { ok: false, reason: 'missing-run' };
  return { ok: true, options: { run, replace } };
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
    process.stderr.write(`CNJBASELINE: refused ${parsed.reason}\n`);
    process.exitCode = 2;
    return;
  }
  const lines = await cnjBaseline(parsed.options);
  for (const l of lines) process.stdout.write(`${l}\n`);
  process.exitCode = 0;
}

if (invokedDirectly()) {
  main().catch((err) => {
    process.stderr.write(`${err && err.stack ? err.stack : err}\n`);
    process.exitCode = 1;
  });
}
