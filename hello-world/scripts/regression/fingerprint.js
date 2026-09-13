// Lane A DEF-12 (design DEF-12, A-18, A-19; entry shape §1). IO entry.
import { statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { git } from './io.js';

function parseStatusZ(text) {
  const tokens = text.split('\0').filter((t) => t.length > 0);
  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    out.push({ code: tok.slice(0, 2), path: tok.slice(3) });
    if (tok[0] === 'R' || tok[0] === 'C') i += 1;
  }
  return out;
}

const line1 = (buf) => buf.toString('utf8').split('\n')[0].trim();

// DEF-12: HEAD + every git-status record, resolved against --show-toplevel (identical from any cwd).
export async function fingerprint(opts, deps = { git }) {
  const top = deps.git(['rev-parse', '--show-toplevel'], { cwd: opts.cwd });
  if (top.status !== 0) return { ok: false };
  const toplevel = line1(top.stdout);
  const head = deps.git(['rev-parse', 'HEAD'], { cwd: toplevel });
  if (head.status !== 0) return { ok: false };
  const status = deps.git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: toplevel });
  if (status.status !== 0) return { ok: false };
  const records = parseStatusZ(status.stdout.toString('utf8'));
  const parts = [];
  for (const r of records) {
    if (r.code === '??' && r.path.endsWith('/')) {
      parts.push(`${r.code} ${r.path} DIR-NO-HASH`);
      continue;
    }
    let isRegularFile = false;
    try {
      isRegularFile = statSync(join(toplevel, r.path)).isFile();
    } catch { /* missing: not a regular file */ }
    if (isRegularFile) {
      const h = deps.git(['hash-object', '--no-filters', '--', r.path], { cwd: toplevel });
      if (h.status !== 0) return { ok: false };
      parts.push(`${r.code} ${r.path} ${line1(h.stdout)}`);
    } else if (r.code.includes('D')) {
      parts.push(`${r.code} ${r.path} ABSENT`);
    } else {
      return { ok: false };
    }
  }
  const digest = createHash('sha256').update(`${line1(head.stdout)}\n${parts.join('\n')}`, 'utf8').digest('hex');
  return { ok: true, digest };
}

export function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--cwd') {
      i += 1;
      if (argv[i] === undefined) return { ok: false, reason: 'missing-value' };
      options.cwd = argv[i];
    } else {
      return { ok: false, reason: `unrecognised:${a}` };
    }
  }
  return { ok: true, options };
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
    process.stderr.write(`FINGERPRINT: refused ${parsed.reason}\n`);
    process.exitCode = 2;
    return;
  }
  const cwd = parsed.options.cwd || process.cwd();
  const r = await fingerprint({ cwd });
  if (r.ok) {
    process.stdout.write(`DEF12=${r.digest}\n`);
    process.exitCode = 0;
  } else {
    process.stdout.write('DEF12=NOT-COMPUTABLE reason=git\n');
    process.exitCode = 1;
  }
}

if (invokedDirectly()) {
  main().catch((err) => {
    process.stderr.write(`${err && err.stack ? err.stack : err}\n`);
    process.exitCode = 1;
  });
}
