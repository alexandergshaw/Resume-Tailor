// Lane A corpus definitions (design §11.1, §11.2; AC DEF-1..DEF-17, A-2, A-3, A-17). Pure.

const HEADER_RE = /^### (R-\d+) \|[^\n]*$/gm;
const FULL_HEADER_RE = /^### R-\d+ \| area: ([^|]+) \| parallel-safe: (yes|no) \| automatable: (yes|no)\s*$/;
const CD_PREFIX = 'cd hello-world && ';
const NEEDLE = 'npx vitest run';

function numberList(keys) {
  const counts = new Map();
  return keys.map((k) => {
    const n = (counts.get(k) || 0) + 1;
    counts.set(k, n);
    return `${k}#${n}`;
  });
}

// DEF-1/DEF-1u: parse one Steps command's text (already stripped of its enclosing backticks).
function parseVitestCommand(cmd) {
  let rest = cmd;
  if (rest.startsWith(CD_PREFIX)) rest = rest.slice(CD_PREFIX.length);
  if (rest.indexOf(NEEDLE) !== 0) return { ok: false, reason: 'a' };
  let argsText = rest.slice(NEEDLE.length).replace(/^\s+/, '');
  let inQuote = false;
  for (const ch of argsText) {
    if (ch === '"') inQuote = !inQuote;
    else if (ch === '|' && !inQuote) return { ok: false, reason: 'b' };
  }
  if (inQuote) return { ok: false, reason: 'e' };
  const tokens = [];
  let i = 0;
  while (i < argsText.length) {
    while (i < argsText.length && /\s/.test(argsText[i])) i += 1;
    if (i >= argsText.length) break;
    if (argsText[i] === '"') {
      const end = argsText.indexOf('"', i + 1);
      tokens.push(argsText.slice(i + 1, end));
      i = end + 1;
    } else {
      let j = i;
      while (j < argsText.length && !/\s/.test(argsText[j])) j += 1;
      tokens.push(argsText.slice(i, j));
      i = j;
    }
  }
  const filters = [];
  let pattern = null;
  for (let k = 0; k < tokens.length; k += 1) {
    const tok = tokens[k];
    if (tok === '-t') {
      k += 1;
      pattern = tokens[k] !== undefined ? tokens[k] : '';
      continue;
    }
    if (tok.startsWith('-')) return { ok: false, reason: 'd' };
    if (!tok.includes('/') && !tok.includes('.')) return { ok: false, reason: 'f' };
    filters.push(tok);
  }
  return { ok: true, filters, pattern: pattern || null };
}

function spanFromCommand(cmd) {
  const r = parseVitestCommand(cmd);
  if (!r.ok) return { kind: 'DEF-1u', reason: r.reason };
  return { kind: 'DEF-1', filters: r.filters, pattern: r.pattern };
}

function backtickSpans(text) {
  return [...text.matchAll(/`([^`]*)`/g)].map((m) => ({ start: m.index, end: m.index + m[0].length, content: m[1] }));
}

function extractOneCase(headerLine, body, occ) {
  const m = FULL_HEADER_RE.exec(headerLine);
  if (!m) return null;
  const id = /^### (R-\d+)/.exec(headerLine)[1];
  const [, area, parallelSafe, automatable] = m;
  const summaryIdx = body.indexOf('**Summary:**');
  const stepsIdx = body.indexOf('**Steps:**');
  const expectedIdx = body.indexOf('**Expected:**');
  const stepsStart = stepsIdx < 0 ? body.length : stepsIdx;
  const stepsEnd = expectedIdx < 0 ? body.length : expectedIdx;
  const expectedText = expectedIdx < 0 ? '' : body.slice(expectedIdx + '**Expected:**'.length).trim();

  const spans = backtickSpans(body);
  const enclosing = (idx) => spans.find((s) => s.start < idx && idx < s.end);

  const steps = [];
  const def7 = [];
  const def8 = [];
  for (const raw of body.matchAll(new RegExp(NEEDLE, 'g'))) {
    occ.raw += 1;
    const idx = raw.index;
    const inSteps = idx >= stepsStart && idx < stepsEnd;
    const span = enclosing(idx);
    if (inSteps) {
      const command = span ? span.content : body.slice(idx, body.indexOf('\n', idx) < 0 ? undefined : body.indexOf('\n', idx));
      const s = spanFromCommand(command);
      occ[s.kind] = (occ[s.kind] || 0) + 1;
      steps.push({ spans: [s] });
    } else if (span) {
      occ['DEF-7'] = (occ['DEF-7'] || 0) + 1;
      const r = parseVitestCommand(span.content);
      def7.push(r.ok ? { filters: r.filters, pattern: r.pattern, command: span.content } : { filters: [], pattern: null, command: span.content });
    } else {
      occ['DEF-8'] = (occ['DEF-8'] || 0) + 1;
      def8.push({ text: body.slice(Math.max(0, idx - 20), idx + NEEDLE.length + 20) });
    }
  }

  return {
    id,
    area: area.trim(),
    parallelSafe: parallelSafe === 'yes',
    automatable,
    summaryText: summaryIdx < 0 ? '' : body.slice(summaryIdx + '**Summary:**'.length, stepsStart).trim(),
    steps,
    def7,
    def8,
    expectedText,
  };
}

// DEF-1..DEF-17: enumerate cases and raw-occurrence classes over a set of corpus files.
export function extractCorpus(files) {
  const cases = [];
  const occ = { raw: 0 };
  for (const f of files) {
    const content = f.content.replace(/\r\n/g, '\n');
    const headers = [...content.matchAll(HEADER_RE)];
    for (let i = 0; i < headers.length; i += 1) {
      const h = headers[i];
      const bodyStart = h.index;
      const bodyEnd = i + 1 < headers.length ? headers[i + 1].index : content.length;
      const headerLine = h[0];
      const body = content.slice(bodyStart + headerLine.length, bodyEnd);
      const c = extractOneCase(headerLine, body, occ);
      if (c) cases.push({ ...c, file: f.file });
    }
  }
  return { cases, occurrences: occ };
}

// §11.2: vitest's win32 file-filter rule for an ok filter.
export function selects(filter, testFiles) {
  const norm = (s) => s.replace(/\\/g, '/').toLocaleLowerCase();
  const f = norm(filter);
  return testFiles.filter((t) => norm(t).includes(f));
}

// DEF-6a: the -t match. No flags; fullName is never parsed.
export function patternMatches(p, assertionResult) {
  return new RegExp(p).test([...assertionResult.ancestorTitles, assertionResult.title].join(' '));
}

// DEF-17: file + ancestorTitles + title joined by " > " + #n. fullName is never parsed.
export function testIdentities(file, assertionResults) {
  return numberList(assertionResults.map((a) => `${file}|${[...a.ancestorTitles, a.title].join(' > ')}`));
}

// A-20: claims extracted from a case's Expected text (text only; verdict.js resolves and judges them).
export function claimsOf(expectedText) {
  const claims = [];
  for (const m of expectedText.matchAll(/`([^`]+)`\s+passes\./g)) {
    claims.push({ kind: 'name', name: m[1] });
  }
  const countRe = /(?:In\s+`([^`]+)`,\s*)?(At least\s+)?(\d+)\s+tests?\s+pass(?:es)?\./gi;
  for (const m of expectedText.matchAll(countRe)) {
    claims.push({ kind: 'count', scope: m[1] || null, atLeast: Boolean(m[2]), n: Number(m[3]), text: m[0] });
  }
  return claims;
}

// T1 seam: the run plan an enumerated corpus reduces to (id + automatable, in document order).
export function plan(corpus) {
  return corpus.cases.map((c) => ({ id: c.id, automatable: c.automatable }));
}
