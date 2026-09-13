// Lane A argv builders and the token classifier (design §7.1 fixture aside, §8, §9, §1.3). Pure.

// §8.1: the fixed flags, in order. --allowOnly=false is required (T3-3b-6).
export const FIXED_FLAGS = ['--no-file-parallelism', '--allowOnly=false', '--reporter=default', '--reporter=json', '--no-cache'];

const QUOTE_CHARS = ["'", '‘', '’', '‚', '‛'];
const PATTERN_RE = /^[A-Za-z0-9_][A-Za-z0-9 _.,:/-]*$/;
const LOCATION_RE = /^[A-Za-z0-9_][A-Za-z0-9_./-]*:[0-9]+$/;
const FILTER_RE = /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/;

// §8.2: syntactic only, checked in this order, first match wins.
export function classifyToken(tok) {
  if (tok.startsWith('-')) return 'flag-shaped-token';
  if (/^[A-Za-z]:/.test(tok) || tok.startsWith('/') || tok.startsWith('\\')
    || tok.split(/[\\/]/).includes('..') || /[. ]$/.test(tok) || tok.includes('\x00')) {
    return 'path-escape';
  }
  if (LOCATION_RE.test(tok)) return 'DEF-1u';
  if (tok.includes(':')) return 'path-escape';
  if (!FILTER_RE.test(tok)) return 'DEF-1u';
  if (tok.endsWith('/')) return 'DEF-1u';
  return 'ok';
}

// §8.2 row P: the pattern allowlist, no `>` (R5-8).
export function checkPattern(p) {
  if (p === undefined || p === '') return 'DEF-1u';
  if (!PATTERN_RE.test(p)) return 'DEF-1u';
  try {
    // Only compiled to prove it's a valid pattern; the allowlist above keeps it safe either way.
    RegExp(p);
  } catch {
    return 'DEF-1u';
  }
  return 'ok';
}

// §8.1: no case token; two different corpora give identical argv.
export function wholeSuiteArgv(vitestMjs, jsonPath) {
  return [vitestMjs, 'run', ...FIXED_FLAGS, `--outputFile.json=${jsonPath}`];
}

// §8.1: built only from tokens classifyToken/checkPattern mark ok. Any refused token -> no argv.
export function caseArgv(span, vitestMjs) {
  const filters = span.filters || [];
  for (const f of filters) if (classifyToken(f) !== 'ok') return null;
  let patternArg = null;
  if (span.pattern) {
    if (checkPattern(span.pattern) !== 'ok') return null;
    patternArg = `--testNamePattern=${span.pattern}`;
  }
  return [vitestMjs, 'run', ...FIXED_FLAGS, ...filters, ...(patternArg ? [patternArg] : [])];
}

// §9 step 3: the committed invoker's own re-validation of what it decodes.
export function validateInvokeArgv(a, vitestMjsPath) {
  if (!Array.isArray(a) || !a.every((e) => typeof e === 'string')) return 'not-array';
  if (a[0] !== vitestMjsPath) return 'argv0';
  if (a[1] !== 'run') return 'not-run';
  const rest = a.slice(2);
  const flagCounts = new Map(FIXED_FLAGS.map((f) => [f, 0]));
  let patternSeen = 0;
  let filterCount = 0;
  for (const el of rest) {
    if (el === '--') return 'double-dash';
    if (el.startsWith('--outputFile')) return 'output-file';
    if (flagCounts.has(el)) {
      flagCounts.set(el, flagCounts.get(el) + 1);
      continue;
    }
    if (el.startsWith('--testNamePattern=')) {
      patternSeen += 1;
      if (patternSeen > 1) return 'pattern-duplicate';
      if (checkPattern(el.slice('--testNamePattern='.length)) !== 'ok') return 'pattern';
      continue;
    }
    if (el.startsWith('-')) return 'flag-unknown';
    const cls = classifyToken(el);
    if (cls !== 'ok') return `filter:${cls}`;
    filterCount += 1;
  }
  for (const n of flagCounts.values()) {
    if (n === 0) return 'flag-missing';
    if (n > 1) return 'flag-duplicate';
  }
  if (filterCount === 0) return 'no-filter';
  return null;
}

// §9: form C, the committed invoker's transport.
export function encodeFormC(argv) {
  return Buffer.from(JSON.stringify(argv), 'utf8').toString('base64');
}

export function decodeFormC(b64) {
  if (typeof b64 !== 'string') return { ok: false, reason: 'decode' };
  const buf = Buffer.from(b64, 'base64');
  // Buffer.from(s, 'base64') is lenient: it silently drops any character outside the base64
  // alphabet instead of refusing the payload. Re-encoding the decoded bytes and comparing back
  // to the input is a strict round-trip check: it matches only a canonical base64 string, so one
  // stray character (dropped on decode, absent on re-encode) fails the comparison.
  if (buf.toString('base64') !== b64) return { ok: false, reason: 'decode' };
  try {
    const value = JSON.parse(buf.toString('utf8'));
    return { ok: true, value };
  } catch {
    return { ok: false, reason: 'decode' };
  }
}

export function renderFormC(argv, invokeJsPath) {
  if (!invokeJsPath || invokeJsPath.includes('"') || invokeJsPath.includes('\\')) {
    throw new Error('renderFormC: refused path');
  }
  let doubled = invokeJsPath;
  for (const q of QUOTE_CHARS) doubled = doubled.split(q).join(q + q);
  return `& node '${doubled}' '${encodeFormC(argv)}'`;
}
