// Lane A render-row (design §6.4). IO entry: a row's self-contained brief.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { freshness } from './gateCheck.js';
import { parseRecord } from './statusRecord.js';
import { briefText, blockSha256 } from './report.js';
import { caseArgv, renderFormC } from './argv.js';
import { toplevel, vitestMjsPath, readVitestVersion } from './io.js';
import { fingerprint } from './fingerprint.js';

function blockOf(text, id) {
  const n = text.replace(/\r\n/g, '\n');
  const s = n.indexOf(`### ${id} `);
  if (s < 0) return null;
  const e = n.indexOf('\n### R-', s + 1);
  return n.slice(s, e < 0 ? n.length : e + 1);
}

// §6.4: RENDER=live|stored|refused, then the row's self-contained brief.
export async function renderRow({ run, key }, deps = {}) {
  const doToplevel = deps.toplevel || toplevel;
  const doFingerprint = deps.fingerprint || fingerprint;
  const doVitestVersion = deps.vitestVersion || (() => readVitestVersion(vitestMjsPath()));

  const judgedText = readFileSync(join(run, 'judged-bad.jsonl'), 'utf8');
  const row = judgedText.split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((r) => r.key === key);
  if (!row) return `RENDER=refused KEY=${key}`;

  const statusText = readFileSync(join(run, 'status.txt'), 'utf8');
  const parsed = parseRecord(statusText);
  const spawn = parsed.ok ? parsed.blocks.spawn : null;
  const completion = parsed.ok ? parsed.blocks.completion : null;
  const runId = row.runId;

  let fresh = '-';
  if (completion) {
    const fp = await doFingerprint({ cwd: doToplevel() });
    const versionNow = await doVitestVersion();
    fresh = freshness({ fpEnd: completion.FP_END, vitestVersion: spawn ? spawn.VITEST_VERSION : null }, { fpNow: fp && fp.ok ? fp.digest : null, versionNow });
  }

  const report = JSON.parse(readFileSync(join(run, 'report.json'), 'utf8'));
  const ctxData = row.contextRef ? report.contexts[row.contextRef] : null;
  let render = ctxData ? 'stored' : null;
  if (ctxData) {
    const live = readFileSync(join(doToplevel(), ctxData.corpusFile), 'utf8');
    const block = blockOf(live, row.contextRef);
    if (block !== null && blockSha256(block) === ctxData.blockSha256) render = 'live';
  }

  const first = `RENDER=${render || 'stored'} KEY=${key} RUN_ID=${runId} FRESH=${fresh}`;
  const ctx = ctxData ? { summary: ctxData.summary, steps: ctxData.steps, expected: ctxData.expected } : null;
  const argv = row.test ? caseArgv({ filters: [row.test.split('|')[0]], pattern: null }, vitestMjsPath()) : null;
  const invokePath = join(run, '..', '..', 'invoke.js').replace(/\\/g, '/');
  const formC = row.token !== undefined ? row.command : (argv ? renderFormC(argv, invokePath) : row.command);
  const union = completion ? `${completion.SUMMARY_TEST_FILES} / ${completion.SUMMARY_TESTS}` : '';
  const brief = briefText(row, ctx, { formC, union, fresh });
  return `${first}\n${brief}`;
}

export function parseArgs(argv) {
  let run;
  let key;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--run') {
      i += 1;
      if (argv[i] === undefined) return { ok: false, reason: 'missing-value' };
      run = argv[i];
    } else if (a === '--key') {
      i += 1;
      if (argv[i] === undefined) return { ok: false, reason: 'missing-value' };
      key = argv[i];
    } else {
      return { ok: false, reason: `unrecognised:${a}` };
    }
  }
  if (run === undefined || key === undefined) return { ok: false, reason: 'missing-args' };
  return { ok: true, options: { run, key } };
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
    process.stderr.write(`RENDER-ROW: refused ${parsed.reason}\n`);
    process.exitCode = 2;
    return;
  }
  const out = await renderRow(parsed.options);
  process.stdout.write(`${out}\n`);
  process.exitCode = 0;
}

if (invokedDirectly()) {
  main().catch((err) => {
    process.stderr.write(`${err && err.stack ? err.stack : err}\n`);
    process.exitCode = 1;
  });
}
