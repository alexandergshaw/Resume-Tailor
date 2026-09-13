// Lane A per-file corpus parity (design §11.4; R11-2, R14-3). IO entry.
import * as realFs from 'node:fs';
import * as realPath from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractCorpus } from './definitions.js';
import { toplevel } from './io.js';

// §11.4: the corpus walk + extractCorpus, over one root. `deps` lets the fs-spy fixture prove
// no §8.2 token ever reaches an fs or path call.
export async function corpusRows(opts, deps = {}) {
  const fs = deps.fs || realFs;
  const path = deps.path || realPath;
  const dir = path.join(opts.root, 'docs', 'regression');
  const names = fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.md'))
    .map((d) => d.name)
    .sort();
  const files = names.map((name) => ({ file: `docs/regression/${name}`, content: fs.readFileSync(path.join(dir, name), 'utf8') }));
  const extracted = extractCorpus(files);
  const rows = files.map((f) => ({ file: f.file, cases: extracted.cases.filter((c) => c.file === f.file).map((c) => c.id) }));
  const totalCases = rows.reduce((n, r) => n + r.cases.length, 0);
  return { rows, totals: { files: rows.length, cases: totalCases } };
}

// §11.4: the saved integrity-rows file's shape (row lines, ratchet lines, the FILES=/CASES= trailer).
export function parseIntegrityRows(text) {
  if (typeof text !== 'string') return { rows: [], totals: null, inputError: 'unreadable' };
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const rows = [];
  let totals = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith('{')) {
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        return { rows: [], totals: null, inputError: `bad-row:${i + 1}` };
      }
      if (typeof obj.file !== 'string' || !Array.isArray(obj.cases)) return { rows: [], totals: null, inputError: `bad-row:${i + 1}` };
      rows.push({ file: obj.file, cases: obj.cases });
    } else {
      const m = /^FILES=(\d+) CASES=(\d+)$/.exec(line);
      if (m) totals = { files: Number(m[1]), cases: Number(m[2]) };
    }
  }
  if (!totals) return { rows, totals: null, inputError: 'no-totals-line' };
  return { rows, totals, inputError: null };
}

// §11.4: the ONE --compare grammar. The exit code carries nothing.
export function compareParity(scriptResult, extract) {
  if (scriptResult.inputError) {
    return [
      'PARITY=mismatch',
      `DIFF input ${scriptResult.inputError}`,
      'SCRIPT_TOTALS=-',
      `EXTRACT_TOTALS=FILES=${extract.totals.files} CASES=${extract.totals.cases}`,
    ];
  }
  const diffs = [];
  const scriptByFile = new Map(scriptResult.rows.map((r) => [r.file, r.cases]));
  const extractByFile = new Map(extract.rows.map((r) => [r.file, r.cases]));
  const allFiles = [...new Set([...scriptByFile.keys(), ...extractByFile.keys()])].sort();
  for (const file of allFiles) {
    const hasScript = scriptByFile.has(file);
    const hasExtract = extractByFile.has(file);
    if (hasScript && !hasExtract) diffs.push(`DIFF only-script file=${file}`);
    else if (!hasScript && hasExtract) diffs.push(`DIFF only-extract file=${file}`);
    else if (JSON.stringify(scriptByFile.get(file)) !== JSON.stringify(extractByFile.get(file))) {
      diffs.push(`DIFF cases file=${file} script=${scriptByFile.get(file).join(',')} extract=${extractByFile.get(file).join(',')}`);
    }
  }
  const scriptCaseSum = scriptResult.rows.reduce((n, r) => n + r.cases.length, 0);
  const extractCaseSum = extract.rows.reduce((n, r) => n + r.cases.length, 0);
  if (scriptResult.rows.length !== extract.rows.length || scriptCaseSum !== extractCaseSum) diffs.push('DIFF totals');
  return [
    diffs.length === 0 ? 'PARITY=ok' : 'PARITY=mismatch',
    ...diffs,
    `SCRIPT_TOTALS=FILES=${scriptResult.totals.files} CASES=${scriptResult.totals.cases}`,
    `EXTRACT_TOTALS=FILES=${extract.totals.files} CASES=${extract.totals.cases}`,
  ];
}

export function parseArgs(argv) {
  if (argv.length === 0) return { ok: true, options: { mode: 'list' } };
  if (argv.length === 2 && argv[0] === '--compare') return { ok: true, options: { mode: 'compare', path: argv[1] } };
  return { ok: false, reason: 'unrecognised' };
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
    process.stderr.write(`CORPUSROWS: refused ${parsed.reason}\n`);
    process.exitCode = 2;
    return;
  }
  const root = toplevel();
  if (parsed.options.mode === 'list') {
    const { rows, totals } = await corpusRows({ root });
    for (const r of rows) process.stdout.write(`${JSON.stringify(r)}\n`);
    process.stdout.write(`FILES=${totals.files} CASES=${totals.cases}\n`);
    process.exitCode = 0;
    return;
  }
  const text = realFs.readFileSync(parsed.options.path, 'utf8');
  const script = parseIntegrityRows(text);
  const extract = await corpusRows({ root });
  for (const line of compareParity(script, extract)) process.stdout.write(`${line}\n`);
  process.exitCode = 0;
}

if (invokedDirectly()) {
  main().catch((err) => {
    process.stderr.write(`${err && err.stack ? err.stack : err}\n`);
    process.exitCode = 1;
  });
}
