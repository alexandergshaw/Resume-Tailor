// Lane B harness for `.claude/workflows/stage10-regression.js` (T3 design r7
// section 12; AC section 5 B-*, INV-1; plan r3 section 4.2 and P-13).
//
// The live workflow and the pinned pre-T3 copy are both compiled from TEXT by
// loadWorkflow.js under stub globals and replayed on fixtures/stub-run.json,
// so every dispatch, prompt and result below is observed, not inferred.
//
// Row labels (the 4b red/green table in the chunk's 4b-B.md):
//   [preserved]  must pass on today's workflow and keep passing after W5-B.
//   [new]        pins T3 behaviour that does not exist yet: red until W5-B.
//   [canary]     proves the instrument next to it can hit.
//   [src]        reads source text through tokenizeSource / parseModuleSource.
// A [src] row never catches SourceTokenizeError (plan section 4.1).

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadWorkflow, replayAgent, replyFor, splitCaseBlocks, STUB_NAMES } from './loadWorkflow.js';
import { assertEveryPromptCarriesWBlock, W_BLOCK_LINES } from './wBlock.pinned.js';
import { tokenizeSource } from '../../lib/sourceScan/tokenizeSource.js';
import { parseModuleSource } from '../../lib/sourceScan/exportGraph.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HELLO = path.resolve(HERE, '..', '..');
const REPO = path.resolve(HELLO, '..');
const LIVE_PATH = path.join(REPO, '.claude', 'workflows', 'stage10-regression.js');
const PRE_PATH = path.join(HERE, 'fixtures', 'stage10-regression.pre-T3.txt');
const STUB_RUN = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'stub-run.json'), 'utf8'));
const PRE_T3_BLOB = '6a1d2e6a9fe485b28722da5b6abe924f286302e4';

// Today's 19 result keys (workflow :627-658) and the four T3 adds (B-10, OQ-4').
const LEGACY_KEYS = [
  'ok', 'doc', 'docFound', 'enumerationFailed', 'enumerationIncomplete', 'discoveryFallback',
  'fileIdSets', 'total', 'automatable', 'passed', 'manualCases', 'manualSteps',
  'confirmedRegressions', 'disputedFailures', 'dismissedFailures', 'unadjudicatedFailures',
  'blocked', 'notRun', 'parentMustDo',
];
const NEW_KEYS = ['verdicts', 'batches', 'verdictAnomalies', 'models'];
const STATUSES = ['pass', 'fail', 'blocked', 'not-run', 'manual'];
const ROW_FIELDS = ['adjudication', 'blockDigest', 'id', 'label', 'split', 'status'];

// --- loading and replay ----------------------------------------------------

const loaded = new Map();
function workflow(which) {
  if (!loaded.has(which)) loaded.set(which, loadWorkflow({ path: which === 'live' ? LIVE_PATH : PRE_PATH }));
  return loaded.get(which);
}

const clone = (value) => JSON.parse(JSON.stringify(value));
const { files: _files, summary: _summary, ...ARGS_WITHOUT_FILES } = STUB_RUN.args;

/**
 * Run one workflow over the stub script. `respond(label, prompt, fallback)`
 * may replace any reply; `fallback()` is the stub-run.json reply.
 */
async function replay(which, { args = STUB_RUN.args, respond } = {}) {
  const wf = await workflow(which);
  const calls = [];
  const agent = async (prompt, options = {}) => {
    const call = { label: String(options.label), model: options.model, phase: options.phase, prompt: String(prompt) };
    calls.push(call);
    const fallback = () => replyFor(STUB_RUN, call.label, call.prompt);
    const reply = respond ? respond(call.label, call.prompt, fallback) : fallback();
    return reply == null ? null : clone(reply);
  };
  const out = await wf.run({ agent, args: typeof args === 'string' ? args : clone(args) });
  return { ...out, calls };
}

const VARIANTS = {
  'stub-run args (object)': {},
  'stub-run args (JSON string)': { args: JSON.stringify(STUB_RUN.args) },
  'areas filter ["beta"]': { args: { ...STUB_RUN.args, areas: ['beta'] } },
  'no args.files (discovery path)': { args: ARGS_WITHOUT_FILES },
};

const allPass = (prompt) => ({
  verdicts: splitCaseBlocks(prompt).map((b) => ({ id: b.id, status: 'pass', evidence: 'stub pass' })),
});
/** Every runner reports pass: ok is true on this run, which gives "ok false" rows their power. */
const cleanRespond = (label, prompt, fallback) => (label.startsWith('cases:') ? allPass(prompt) : fallback());

// --- instruments -----------------------------------------------------------

const collapse = (s) => String(s).replace(/\s+/g, ' ').trim();
const byLabel = (calls, prefix) => calls.filter((c) => c.label.startsWith(prefix));

function dispatchMap(calls) {
  const map = {};
  for (const c of calls) {
    if (c.label.startsWith('cases:')) map[c.label] = splitCaseBlocks(c.prompt).map((b) => b.id);
    else if (c.label.startsWith('refute:')) map[c.label] = [c.label.split(':')[1]];
    else if (c.label.startsWith('enumerate:')) {
      map[c.label] = c.prompt.split('\n').filter((l) => l.startsWith('- ') && l.endsWith('.md')).sort();
    }
  }
  return map;
}

/** id -> [{label, text}] over the runner (cases:*) prompts only. */
function runnerBlocks(calls) {
  const out = new Map();
  for (const c of byLabel(calls, 'cases:')) {
    for (const b of splitCaseBlocks(c.prompt)) {
      if (!out.has(b.id)) out.set(b.id, []);
      out.get(b.id).push({ label: c.label, text: b.text });
    }
  }
  return out;
}

function stepLinesOf(blockText) {
  const start = blockText.indexOf('\nSteps: ') + '\nSteps: '.length;
  const end = blockText.lastIndexOf('\nExpected: ');
  return blockText.slice(start, end).split('\n').map(collapse).filter(Boolean);
}

/** AC INV-1 claims (1)-(3), per case the pre-T3 workflow dispatches. */
function inv1Violations(preCalls, newCalls) {
  const out = [];
  const expectedById = new Map(Object.values(STUB_RUN.enumerate).flat().map((c) => [c.id, c.expected]));
  const preB = runnerBlocks(preCalls);
  const newB = runnerBlocks(newCalls);
  const preIds = [...preB.keys()].sort().join(',');
  const newIds = [...newB.keys()].sort().join(',');
  if (preIds !== newIds) out.push(`(3) case set: pre [${preIds}] new [${newIds}]`);
  for (const [id, blocks] of newB) if (blocks.length !== 1) out.push(`(3) ${id} has a block in ${blocks.length} prompts`);
  for (const [id, preBlocks] of preB) {
    const nb = newB.get(id);
    if (!nb) continue;
    const text = collapse(nb[0].text);
    for (const step of stepLinesOf(preBlocks[0].text)) if (!text.includes(step)) out.push(`(1) ${id} lost step: ${step}`);
    if (!text.includes(collapse(expectedById.get(id)))) out.push(`(2) ${id} lost its Expected`);
  }
  return out;
}

const sortedIds = (list) => [...list].sort().join(',');

/** Design section 12.3: the four harness invariants on a full return. */
function fourInvariantViolations(r) {
  if (!Array.isArray(r.verdicts)) return ['verdicts is not an array'];
  if (!Array.isArray(r.batches)) return ['batches is not an array'];
  const out = [];
  if (r.verdicts.length !== r.total) out.push(`1: verdicts.length ${r.verdicts.length} != total ${r.total}`);
  const summed = r.verdicts.filter((row) => STATUSES.includes(row.status)).length;
  if (summed !== r.total) out.push(`2: status counts sum to ${summed}, total ${r.total}`);
  const slice = (pred) => r.verdicts.filter(pred).map((row) => row.id);
  const fail = (adj) => (row) => row.status === 'fail' && row.adjudication === adj;
  const legacy = [
    ['confirmedRegressions', (r.confirmedRegressions || []).map((x) => x.id), slice(fail('confirmed'))],
    ['disputedFailures', (r.disputedFailures || []).map((x) => x.id), slice(fail('disputed'))],
    ['dismissedFailures', (r.dismissedFailures || []).map((x) => x.id), slice(fail('dismissed'))],
    ['unadjudicatedFailures', (r.unadjudicatedFailures || []).map((x) => x.id), slice(fail('unadjudicated'))],
    ['blocked', (r.blocked || []).map((x) => x.id), slice((row) => row.status === 'blocked')],
    ['notRun', r.notRun || [], slice((row) => row.status === 'not-run')],
    ['manualCases', (r.manualCases || []).map((x) => x.id), slice((row) => row.status === 'manual')],
  ];
  for (const [name, list, rows] of legacy) {
    if (sortedIds(list) !== sortedIds(rows)) out.push(`3: ${name} [${sortedIds(list)}] != verdicts slice [${sortedIds(rows)}]`);
  }
  if (r.passed !== slice((row) => row.status === 'pass').length) out.push('3: passed != pass rows');
  const seen = new Map();
  for (const b of r.batches) {
    for (const id of b.caseIds) {
      if (seen.has(id)) out.push(`4: ${id} in ${seen.get(id)} and ${b.label}`);
      else seen.set(id, b.label);
    }
  }
  const labelled = slice((row) => row.label !== null);
  if (sortedIds(seen.keys()) !== sortedIds(labelled)) out.push('4: batches union != rows with a non-null label');
  return out;
}

function batchLabelViolations(batches) {
  const labels = batches.map((b) => b.label);
  return labels.filter((l, i) => labels.indexOf(l) !== i).map((l) => `duplicate batch label ${l}`);
}

function fnv1a32(units) {
  let h = 0x811c9dc5;
  for (const u of units) h = Math.imul(h ^ u, 0x01000193) >>> 0;
  return h >>> 0;
}
/** blockDigest's encoding and rendering are not fixed by design section 12.2: accept each reading. */
function digestCandidates(text) {
  const out = new Set();
  const units16 = Array.from({ length: text.length }, (_, i) => text.charCodeAt(i));
  for (const h of [fnv1a32(units16), fnv1a32([...Buffer.from(text, 'utf8')])]) {
    const hex = h.toString(16);
    out.add(h);
    out.add(hex);
    out.add(hex.padStart(8, '0'));
    out.add(hex.padStart(8, '0').toUpperCase());
  }
  return out;
}

function gitBlobSha1(buffer) {
  const lf = Buffer.from(buffer.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
  return createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${lf.length}\0`), lf])).digest('hex');
}

/** 0-based indices of the lines of `next` that an LCS line diff against `prev` marks as added. */
function addedLineIndices(prev, next) {
  const n = prev.length;
  const m = next.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = prev[i] === next[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const added = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (prev[i] === next[j]) {
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else added.push(j++);
  }
  while (j < m) added.push(j++);
  return added;
}

/** AC B-19 (i)-(iii) over the lines `nextText` adds to `prevText` (design section 12.4). */
function b19Hits(prevText, nextText) {
  const lf = (t) => t.replace(/\r\n/g, '\n');
  const next = lf(nextText);
  const lines = next.split('\n');
  const added = addedLineIndices(lf(prevText).split('\n'), lines);
  const { readable, codeMask } = tokenizeSource(next);
  const starts = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const wStart = lines.findIndex((l) => /^\s*(?:export\s+)?const W_BLOCK\b/.test(l));
  let wEnd = -1;
  if (wStart >= 0) wEnd = lines.findIndex((l, k) => k > wStart && /^\s*\]/.test(l));
  const hits = { i: [], ii: [], iii: [] };
  for (const k of added) {
    const line = lines[k];
    if (line.includes('npx vitest run')) hits.i.push(k + 1);
    const code = codeMask.slice(starts[k], starts[k] + line.length);
    let regex = code.includes('RegExp(');
    for (let x = 0; x < line.length && !regex; x++) {
      const at = starts[k] + x;
      if (readable[at] !== '/' || codeMask[at] !== ' ') continue;
      // The '/' must START its blanked span: walking left over whitespace
      // (real, or a blanked comment) must reach real code, not a blanked
      // character such as a string's quote or its contents.
      let y = at - 1;
      while (y >= 0 && /\s/.test(codeMask[y]) && /\s/.test(readable[y])) y--;
      if (y < 0 || !/\s/.test(codeMask[y])) regex = true;
    }
    if (regex) hits.ii.push(k + 1);
    if (line.includes('vitest') && !(wStart >= 0 && k > wStart && (wEnd < 0 || k < wEnd))) hits.iii.push(k + 1);
  }
  return hits;
}

function walkJs(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJs(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/** The app/ and lib/ modules a source imports, as hello-world-relative POSIX paths. */
function appLibImports(src, fileAbs) {
  const out = [];
  for (const edge of parseModuleSource(src).imports) {
    let abs = null;
    if (edge.spec.startsWith('@/')) abs = path.join(HELLO, edge.spec.slice(2));
    else if (edge.spec.startsWith('./') || edge.spec.startsWith('../')) abs = path.resolve(path.dirname(fileAbs), edge.spec);
    if (!abs) continue;
    const rel = path.relative(HELLO, abs).split(path.sep).join('/');
    if (rel.startsWith('app/') || rel.startsWith('lib/')) out.push(rel);
  }
  return out;
}
const ALLOWED_APP_LIB = ['lib/sourceScan/exportGraph.js', 'lib/sourceScan/tokenizeSource.js'];

const omit = (obj, keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]));
const W_LABELS = {
  'enumerate:discovery (:301)': { prefix: 'enumerate:discovery', args: ARGS_WITHOUT_FILES },
  'enumerate:<n> (:344)': { prefix: 'enumerate:', args: STUB_RUN.args, exclude: 'enumerate:discovery' },
  'cases:<n> (:522)': { prefix: 'cases:', args: STUB_RUN.args, exclude: 'cases:exclusive' },
  'cases:exclusive (:531)': { prefix: 'cases:exclusive', args: STUB_RUN.args },
  'refute:<id>:<k> (:573)': { prefix: 'refute:', args: STUB_RUN.args },
};

// --- the pre-T3 copy -------------------------------------------------------

describe('pre-T3 copy (B-12)', () => {
  it('[preserved] pre-T3 copy: the in-process blob hash after CRLF -> LF is 6a1d2e6a... (§12.4)', () => {
    expect(gitBlobSha1(readFileSync(PRE_PATH))).toBe(PRE_T3_BLOB);
  });

  it('[canary] one changed byte moves the in-process blob hash, and a CRLF copy does not', () => {
    const bytes = readFileSync(PRE_PATH);
    const edited = Buffer.from(bytes);
    edited[0] = edited[0] === 0x65 ? 0x45 : 0x65;
    expect(gitBlobSha1(edited)).not.toBe(PRE_T3_BLOB);
    const crlf = Buffer.from(bytes.toString('latin1').replace(/\n/g, '\r\n'), 'latin1');
    expect(gitBlobSha1(crlf)).toBe(PRE_T3_BLOB);
  });

  it('[preserved] loadWorkflow exposes exactly the five stubs, and a missing agent stub fails loud (§12.4)', async () => {
    expect([...STUB_NAMES]).toEqual(['agent', 'phase', 'parallel', 'log', 'args']);
    const wf = await workflow('live');
    await expect(wf.run({ args: clone(STUB_RUN.args) })).rejects.toThrow(/agent is not defined/);
  });
});

// --- stub-run.json itself (P-13) --------------------------------------------

describe('stub-run.json (P-13)', () => {
  it('[preserved] stub-run.json has >= 2 batches and >= 3 cases, and every case ID it dispatches exists in its enumerate output (P-13)', async () => {
    const wf = await workflow('pre');
    const { agent, calls } = replayAgent(STUB_RUN);
    const { result } = await wf.run({ agent, args: clone(STUB_RUN.args) });
    expect(result.total).toBeGreaterThanOrEqual(3);
    expect(result.enumerationIncomplete).toBe(false);
    expect(byLabel(calls, 'enumerate:').length).toBeGreaterThanOrEqual(2);
    expect(byLabel(calls, 'cases:').length).toBeGreaterThanOrEqual(2);
    const enumerated = new Set(Object.values(STUB_RUN.enumerate).flat().map((c) => c.id));
    const declared = new Set(STUB_RUN.args.files.flatMap((f) => f.cases));
    expect([...enumerated].sort()).toEqual([...declared].sort());
    const dispatched = [...runnerBlocks(calls).keys()];
    expect(dispatched.length).toBeGreaterThanOrEqual(3);
    for (const id of dispatched) expect(enumerated.has(id), id).toBe(true);
    // The coverage stub-run.json promises in its "about" line, observed on today's return.
    expect(result.passed).toBeGreaterThan(0);
    expect(result.blocked.map((b) => b.id)).toEqual(['R-903']);
    expect(result.notRun).toEqual(['R-909']);
    expect(result.manualCases.map((c) => c.id)).toEqual(['R-904']);
    expect(result.manualSteps.map((s) => s.id)).toEqual(['R-902']);
    expect(result.confirmedRegressions.map((c) => c.id)).toEqual(['R-908']);
    expect(result.disputedFailures.map((c) => c.id)).toEqual(['R-906']);
    expect(result.dismissedFailures.map((c) => c.id)).toEqual(['R-907']);
    expect(result.unadjudicatedFailures.map((c) => c.id)).toEqual(['R-905']);
    expect(dispatchMap(calls)['cases:exclusive']).toEqual(['R-905']);
  });
});

// --- B-1 / B-12 / INV-1 ----------------------------------------------------

describe('dispatch equals pre-T3 (B-1, B-12, INV-1)', () => {
  it.each(Object.keys(VARIANTS))(
    '[preserved] B-1/B-12: for today\'s args, dispatch {label -> IDs} equals the pre-T3 workflow\'s, replayed on fixtures/stub-run.json (T3-L25): %s',
    async (name) => {
      const pre = await replay('pre', VARIANTS[name]);
      const live = await replay('live', VARIANTS[name]);
      const preMap = dispatchMap(pre.calls);
      expect(Object.values(preMap).flat().length).toBeGreaterThan(0);
      expect(Object.keys(preMap).some((l) => l.startsWith('cases:'))).toBe(true);
      expect(dispatchMap(live.calls)).toEqual(preMap);
      expect(live.calls.map((c) => c.label).sort()).toEqual(pre.calls.map((c) => c.label).sort());
    },
  );

  it('[preserved] B-1: the case whose steps hold `npx vitest run x.test.js` is dispatched whole, byte-equal to pre-T3 (T3-L25)', async () => {
    const pre = runnerBlocks((await replay('pre')).calls).get('R-901');
    const live = runnerBlocks((await replay('live')).calls).get('R-901');
    const steps = STUB_RUN.enumerate['docs/regression/alpha.md'][0].steps;
    expect(steps).toContain('`npx vitest run x.test.js`');
    expect(live).toHaveLength(1);
    expect(live[0].text).toBe(pre[0].text);
    expect(live[0].text).toContain(`Steps: ${steps}`);
  });

  it('[canary] B-1: a dispatched block that gains one trailing space on its last line is caught by the byte-equal comparison above (row 9)', () => {
    const prompt = [
      'Case R-901 [area: alpha] parallelSafe=true',
      'Summary: The keyword scorer\'s unit tests pass',
      'Steps: 1. From hello-world run `npx vitest run x.test.js` and quote the Test Files and Tests lines.',
      'Expected: Test Files  1 passed (1) and Tests  12 passed (12).',
    ].join('\n');
    const planted = `${prompt} `;
    const [clean] = splitCaseBlocks(prompt);
    const [mutated] = splitCaseBlocks(planted);
    expect(mutated.text).not.toBe(clean.text);
  });

  it('[canary] B-1: a planted source with a different runner chunk size changes the dispatch map', async () => {
    const wf = await workflow('pre');
    const planted = wf.source.replace('chunk(safe, buckets)', 'chunk(safe, buckets + 1)');
    expect(planted).not.toBe(wf.source);
    const mutant = await loadWorkflow({ source: planted });
    const { agent, calls } = replayAgent(STUB_RUN);
    await mutant.run({ agent, args: clone(STUB_RUN.args) });
    expect(dispatchMap(calls)).not.toEqual(dispatchMap((await replay('pre')).calls));
  });

  it('[canary] no-op control: a comment-only edit of the pre-T3 source leaves dispatch and the 19 keys equal', async () => {
    const wf = await workflow('pre');
    const noop = await loadWorkflow({ source: `${wf.source}\n// no-op control line\n` });
    const { agent, calls } = replayAgent(STUB_RUN);
    const { result } = await noop.run({ agent, args: clone(STUB_RUN.args) });
    const base = await replay('pre');
    expect(dispatchMap(calls)).toEqual(dispatchMap(base.calls));
    expect(pick(result, LEGACY_KEYS)).toEqual(pick(base.result, LEGACY_KEYS));
  });

  it.each(Object.keys(VARIANTS))(
    '[preserved] INV-1 over captured prompts, block split at "Case <id> [area:" (T3-L24): %s',
    async (name) => {
      const pre = await replay('pre', VARIANTS[name]);
      const live = await replay('live', VARIANTS[name]);
      expect(runnerBlocks(pre.calls).size).toBeGreaterThan(0);
      expect(inv1Violations(pre.calls, live.calls)).toEqual([]);
    },
  );

  it('[canary] INV-1: a step dropped from one case of a pair sharing that line is caught, though a whole-prompt search still finds the line', async () => {
    const pre = await replay('pre');
    const [r907, r908] = STUB_RUN.enumerate['docs/regression/beta.md'].slice(1, 3);
    const shared = r907.steps.split('\n')[0];
    expect(r908.steps.split('\n')[0]).toBe(shared);
    const mutated = pre.calls.map((c) => {
      const block = splitCaseBlocks(c.prompt).find((b) => b.id === 'R-908');
      if (!c.label.startsWith('cases:') || !block) return c;
      return { ...c, prompt: c.prompt.replace(block.text, block.text.replace(shared, '')) };
    });
    const prompt = mutated.find((c) => c.prompt !== pre.calls.find((p) => p.label === c.label).prompt).prompt;
    expect(prompt).toContain(shared);
    expect(inv1Violations(pre.calls, mutated)).toEqual([`(1) R-908 lost step: ${collapse(shared)}`]);
  });
});

// --- B-6 model split ---------------------------------------------------------

describe('model split (B-6)', () => {
  it('[preserved] B-6: runner model on cases:* is args.runnerModel (T3-L29)', async () => {
    const { calls } = await replay('live');
    const models = byLabel(calls, 'cases:').map((c) => c.model);
    expect(models.length).toBeGreaterThanOrEqual(2);
    expect(new Set(models)).toEqual(new Set(['sonnet']));
  });

  it('[new] B-6: refuter model on refute:* defaults to opus, not the runner model (T3-L29)', async () => {
    const { calls } = await replay('live');
    const models = byLabel(calls, 'refute:').map((c) => c.model);
    expect(models.length).toBeGreaterThan(0);
    expect(new Set(models)).toEqual(new Set(['opus']));
  });

  it('[new] B-6: args.refuterModel governs refute:* only (T3-L29)', async () => {
    const { calls } = await replay('live', { args: { ...STUB_RUN.args, refuterModel: 'haiku' } });
    expect(new Set(byLabel(calls, 'refute:').map((c) => c.model))).toEqual(new Set(['haiku']));
    expect(new Set(byLabel(calls, 'cases:').map((c) => c.model))).toEqual(new Set(['sonnet']));
    expect(new Set(byLabel(calls, 'enumerate:').map((c) => c.model))).toEqual(new Set(['sonnet']));
  });

  it('[preserved] B-6: enumerate:* stays sonnet by default and honours args.enumerateModel (T3-L29)', async () => {
    const plain = await replay('live');
    expect(new Set(byLabel(plain.calls, 'enumerate:').map((c) => c.model))).toEqual(new Set(['sonnet']));
    const overridden = await replay('live', { args: { ...STUB_RUN.args, enumerateModel: 'haiku' } });
    expect(new Set(byLabel(overridden.calls, 'enumerate:').map((c) => c.model))).toEqual(new Set(['haiku']));
  });

  it('[new] B-6: models reported as {enumerate, runner, refuter} (T3-L29)', async () => {
    const { result } = await replay('live');
    expect(result.models).toEqual({ enumerate: 'sonnet', runner: 'sonnet', refuter: 'opus' });
  });

  it('[preserved] B-6: today\'s args as a JSON string get no error and every key they get today (T3-L29)', async () => {
    const pre = await replay('pre', VARIANTS['stub-run args (JSON string)']);
    const live = await replay('live', VARIANTS['stub-run args (JSON string)']);
    expect(pick(live.result, LEGACY_KEYS)).toEqual(pick(pre.result, LEGACY_KEYS));
  });

  it('[preserved] B-6: today\'s args object with runnerModel gets no error and every key it gets today (T3-L29)', async () => {
    const pre = await replay('pre');
    const live = await replay('live');
    expect(Object.keys(pre.result).sort()).toEqual([...LEGACY_KEYS].sort());
    expect(pick(live.result, LEGACY_KEYS)).toEqual(pick(pre.result, LEGACY_KEYS));
  });

  it('[canary] B-6: a live result missing one legacy key is caught by the pick(...) comparison the two rows above use (rows 22-23)', async () => {
    const { result: full } = await replay('live', VARIANTS['stub-run args (JSON string)']);
    const { total: _total, ...missingTotal } = full;
    expect(pick(missingTotal, LEGACY_KEYS)).not.toEqual(pick(full, LEGACY_KEYS));
  });

  it('[preserved] B-6: with no runnerModel, cases:* and refute:* both run on opus (T3-L29)', async () => {
    const { runnerModel: _runnerModel, ...args } = STUB_RUN.args;
    const { calls } = await replay('live', { args });
    expect(new Set(byLabel(calls, 'cases:').map((c) => c.model))).toEqual(new Set(['opus']));
    expect(new Set(byLabel(calls, 'refute:').map((c) => c.model))).toEqual(new Set(['opus']));
  });
});

// --- B-7 / B-15 W-block --------------------------------------------------------

describe('W-block (B-7, B-15)', () => {
  it.each(Object.keys(W_LABELS))(
    '[new] B-7: all 5 agent() call sites carry the six W lines contiguously (T3-L30): %s',
    async (site) => {
      const spec = W_LABELS[site];
      const { calls } = await replay('live', { args: spec.args });
      const prompts = byLabel(calls, spec.prefix).filter((c) => c.label !== spec.exclude).map((c) => c.prompt);
      expect(prompts.length).toBeGreaterThan(0);
      assertEveryPromptCarriesWBlock(prompts);
    },
  );

  const wLineHits = (line) => ['regression', 'case', 'refut', 'stage', '`', '${', '\''].filter((bad) => line.toLowerCase().includes(bad));

  it('[preserved] B-15: the W lines contain no regression/case/refut/stage, backtick, ${ or \' (T3-L30)', () => {
    expect(W_BLOCK_LINES).toHaveLength(6);
    expect(W_BLOCK_LINES.slice(0, 5).map((l) => l.slice(0, 3))).toEqual(['W1.', 'W2.', 'W3.', 'W4.', 'W5.']);
    expect(W_BLOCK_LINES.flatMap(wLineHits)).toEqual([]);
  });

  it('[canary] B-15: a planted W line containing "case" hits', () => {
    expect(wLineHits('W6. Run each case in order.')).toEqual(['case']);
    expect(() => assertEveryPromptCarriesWBlock([W_BLOCK_LINES.join('\n'), W_BLOCK_LINES.slice(1).join('\n')])).toThrow(/prompt 1/);
    expect(() => assertEveryPromptCarriesWBlock([])).toThrow(/nothing was checked/);
  });
});

// --- B-8 / B-9 / B-10 dispatch identity and attribution --------------------------

describe('dispatch identity and attribution (B-8, B-9, B-10)', () => {
  it('[new] B-8/B-9: batches built before dispatch; labels unique; caseIds disjoint; union = the dispatched set (T3-L31)', async () => {
    const { result, calls } = await replay('live');
    const runnerCalls = byLabel(calls, 'cases:');
    expect(Array.isArray(result.batches)).toBe(true);
    expect(result.batches.map((b) => b.label)).toEqual(runnerCalls.map((c) => c.label));
    expect(batchLabelViolations(result.batches)).toEqual([]);
    for (const b of result.batches) {
      const call = runnerCalls.find((c) => c.label === b.label);
      expect(b.caseIds).toEqual(splitCaseBlocks(call.prompt).map((x) => x.id));
      expect(b.model).toBe(call.model);
      expect(b.model).toBe(result.models.runner);
      expect(b.returned).toBe(true);
    }
    const union = result.batches.flatMap((b) => b.caseIds);
    expect(new Set(union).size).toBe(union.length);
    expect(sortedIds(union)).toBe(sortedIds(runnerBlocks(calls).keys()));
    for (const row of result.verdicts.filter((v) => v.label !== null)) {
      expect(result.batches.find((b) => b.caseIds.includes(row.id)).label).toBe(row.label);
    }
  });

  it('[new] B-9: a batch whose agent returns nothing is still listed from the dispatcher, returned false, its cases not-run under its label (T3-L31)', async () => {
    const respond = (label, prompt, fallback) => (label === 'cases:2' ? null : fallback());
    const { result, calls } = await replay('live', { respond });
    const dispatched = splitCaseBlocks(calls.find((c) => c.label === 'cases:2').prompt).map((b) => b.id);
    const batch = result.batches.find((b) => b.label === 'cases:2');
    expect(batch.returned).toBe(false);
    expect(batch.caseIds).toEqual(dispatched);
    for (const id of dispatched) {
      expect(result.verdicts.find((v) => v.id === id)).toMatchObject({ status: 'not-run', label: 'cases:2' });
    }
  });

  it('[canary] B-9: a planted batches list with a duplicate label fails the uniqueness check', () => {
    const planted = [{ label: 'cases:1', caseIds: ['R-1'] }, { label: 'cases:1', caseIds: ['R-2'] }];
    expect(batchLabelViolations(planted)).toEqual(['duplicate batch label cases:1']);
  });

  it('[preserved] B-10 control: with every runner reporting pass, today\'s ok is true (the power behind every "ok false" row)', async () => {
    const pre = await replay('pre', { respond: cleanRespond });
    const live = await replay('live', { respond: cleanRespond });
    expect(pre.result.ok).toBe(true);
    expect(live.result.ok).toBe(true);
  });

  const withExtra = (label, extra, drop = []) => (l, prompt, fallback) => {
    if (!l.startsWith('cases:')) return fallback();
    const reply = allPass(prompt);
    reply.verdicts = reply.verdicts.filter((v) => !(l === label && drop.includes(v.id)));
    if (l === label) reply.verdicts.push(...extra);
    return reply;
  };

  it('[new] attributeVerdicts: out-of-batch -> verdictAnomalies; the case stays not-run; ok false (B-10, T3-L31)', async () => {
    const respond = (l, prompt, fallback) => {
      if (l === 'cases:1') return withExtra('cases:1', [], ['R-901'])(l, prompt, fallback);
      return withExtra('cases:2', [{ id: 'R-901', status: 'pass', evidence: 'answered by the wrong agent' }])(l, prompt, fallback);
    };
    const { result } = await replay('live', { respond });
    expect(result.verdictAnomalies).toEqual([
      { label: 'cases:2', id: 'R-901', kind: 'out-of-batch', status: 'pass', evidence: 'answered by the wrong agent', evidenceTruncated: false },
    ]);
    expect(result.verdicts.find((v) => v.id === 'R-901')).toMatchObject({ status: 'not-run', label: 'cases:1' });
    expect(result.notRun).toContain('R-901');
    expect(result.ok).toBe(false);
  });

  it('[new] attributeVerdicts: unknown -> verdictAnomalies; no refuter; evidence truncated at 2000; ok false (B-10, T3-L31)', async () => {
    const long = 'x'.repeat(2500);
    const respond = withExtra('cases:2', [{ id: 'R-999', status: 'fail', evidence: long }]);
    const { result, calls } = await replay('live', { respond });
    expect(result.verdictAnomalies).toHaveLength(1);
    expect(result.verdictAnomalies[0]).toMatchObject({ label: 'cases:2', id: 'R-999', kind: 'unknown', status: 'fail', evidenceTruncated: true });
    expect(result.verdictAnomalies[0].evidence).toHaveLength(2000);
    expect(result.verdicts.some((v) => v.id === 'R-999')).toBe(false);
    expect(byLabel(calls, 'refute:R-999:')).toEqual([]);
    expect(result.ok).toBe(false);
  });

  it('[new] attributeVerdicts: duplicate -> every copy in verdictAnomalies; the case stays not-run; no refuter; ok false (B-10, T3-L31)', async () => {
    const respond = withExtra('cases:2', [
      { id: 'R-910', status: 'pass', evidence: 'first copy' },
      { id: 'R-910', status: 'fail', evidence: 'second copy' },
    ], ['R-910']);
    const { result, calls } = await replay('live', { respond });
    const dup = result.verdictAnomalies.filter((a) => a.id === 'R-910');
    expect(dup.map((a) => [a.kind, a.status, a.label])).toEqual([['duplicate', 'pass', 'cases:2'], ['duplicate', 'fail', 'cases:2']]);
    expect(result.verdicts.find((v) => v.id === 'R-910').status).toBe('not-run');
    expect(byLabel(calls, 'refute:R-910:')).toEqual([]);
    expect(result.ok).toBe(false);
  });

  it('[new] attributeVerdicts: bad-status -> verdictAnomalies; the case stays not-run; ok false (B-10, T3-L31)', async () => {
    const respond = withExtra('cases:2', [{ id: 'R-910', status: 'passed', evidence: 'status outside the schema' }], ['R-910']);
    const { result } = await replay('live', { respond });
    expect(result.verdictAnomalies.map((a) => [a.id, a.kind, a.status])).toEqual([['R-910', 'bad-status', 'passed']]);
    expect(result.verdicts.find((v) => v.id === 'R-910').status).toBe('not-run');
    expect(result.ok).toBe(false);
  });

  it('[new] attributeVerdicts: IDs match by exact bytes, so "R-910 " and "r-910" are unknown and R-910 stays not-run (§12.2)', async () => {
    const respond = withExtra('cases:2', [
      { id: 'R-910 ', status: 'pass', evidence: 'trailing space' },
      { id: 'r-910', status: 'pass', evidence: 'lower case' },
    ], ['R-910']);
    const { result } = await replay('live', { respond });
    expect(result.verdictAnomalies.map((a) => [a.id, a.kind])).toEqual([['R-910 ', 'unknown'], ['r-910', 'unknown']]);
    expect(result.verdicts.find((v) => v.id === 'R-910').status).toBe('not-run');
  });

  it('[new] B-8: one verdicts row per enumerated ID, in allCases order, with the dispatcher\'s label and the adjudication outcome (T3-L31)', async () => {
    const { result, calls } = await replay('live');
    const blocks = runnerBlocks(calls);
    const expected = [
      ['R-901', 'pass', 'cases:1', null, false],
      ['R-902', 'pass', 'cases:1', null, true],
      ['R-903', 'blocked', 'cases:1', null, false],
      ['R-904', 'manual', null, null, false],
      ['R-905', 'fail', 'cases:exclusive', 'unadjudicated', false],
      ['R-906', 'fail', 'cases:1', 'disputed', false],
      ['R-907', 'fail', 'cases:2', 'dismissed', false],
      ['R-908', 'fail', 'cases:2', 'confirmed', false],
      ['R-909', 'not-run', 'cases:2', null, false],
      ['R-910', 'pass', 'cases:2', null, false],
    ];
    expect(result.verdicts.map((v) => [v.id, v.status, v.label, v.adjudication, v.split])).toEqual(expected);
    for (const row of result.verdicts) {
      expect(Object.keys(row).sort()).toEqual(ROW_FIELDS);
      if (row.status === 'manual') expect(row.blockDigest).toBeNull();
      else expect(digestCandidates(blocks.get(row.id)[0].text).has(row.blockDigest), row.id).toBe(true);
    }
  });

  it('[preserved] B-8: the legacy blocked list is built in allCases order, not agent-dispatch order, when two blocked cases arrive out of that order (T3-L31)', async () => {
    const respond = (label, prompt, fallback) => {
      if (label === 'cases:1') {
        const reply = fallback();
        reply.verdicts = reply.verdicts.map((v) => (v.id === 'R-906' ? { ...v, status: 'blocked' } : v));
        return reply;
      }
      if (label === 'cases:exclusive') {
        const reply = fallback();
        reply.verdicts = reply.verdicts.map((v) => (v.id === 'R-905' ? { ...v, status: 'blocked' } : v));
        return reply;
      }
      return fallback();
    };
    const { result } = await replay('live', { respond });
    // R-905 (alpha's 5th case) is dispatched LAST, via cases:exclusive; R-906
    // (beta's 1st case) is dispatched FIRST, via cases:1 - so allCases/document
    // order and agent-dispatch order disagree on these two, which is what
    // actually pins which order `blocked` is built in.
    expect(result.blocked.map((b) => b.id)).toEqual(['R-903', 'R-905', 'R-906']);
  });

  it('[preserved] B-8: every refuter prompt carries its case\'s full dispatched block (T3-L31)', async () => {
    const { calls } = await replay('live');
    const blocks = runnerBlocks(calls);
    const refutes = byLabel(calls, 'refute:');
    expect(refutes.length).toBe(6);
    for (const c of refutes) expect(c.prompt).toContain(blocks.get(c.label.split(':')[1])[0].text);
  });

  it('[new] B-8: no refuter is dispatched for an anomaly, so no refuter prompt falls back to a bare "Case <id>" line (T3-L31)', async () => {
    // Two failures only (both inside maxAdjudicated): a real one (R-910) and an
    // unknown ID. Today both are adjudicated and R-999's refuters get the bare
    // "Case R-999" fallback; after T3 only R-910 is, with its full block.
    const respond = withExtra('cases:2', [
      { id: 'R-910', status: 'fail', evidence: 'real failure' },
      { id: 'R-999', status: 'fail', evidence: 'unknown ID' },
    ], ['R-910']);
    const { calls } = await replay('live', { respond });
    const refutes = byLabel(calls, 'refute:');
    expect(byLabel(calls, 'refute:R-910:')).toHaveLength(2);
    expect(byLabel(calls, 'refute:R-999:')).toEqual([]);
    for (const c of refutes) expect(splitCaseBlocks(c.prompt).map((b) => b.id)).toEqual([c.label.split(':')[1]]);
  });
});

// --- design section 12.3 --------------------------------------------------------

describe('backward compatibility and the four invariants (§12.3)', () => {
  const FULL_RUNS = { ...VARIANTS, 'every runner passes': { respond: cleanRespond } };

  it.each(Object.keys(FULL_RUNS))(
    '[new] the four harness invariants hold on every full return, including the return over fixtures/stub-run.json (§12.3; P-13): %s',
    async (name) => {
      const { result } = await replay('live', FULL_RUNS[name]);
      expect(result.total).toBeGreaterThan(0);
      expect(fourInvariantViolations(result)).toEqual([]);
    },
  );

  it('[canary] the four invariants: a planted result breaking each one hits', () => {
    const good = {
      total: 2, passed: 1, confirmedRegressions: [], disputedFailures: [], dismissedFailures: [],
      unadjudicatedFailures: [], blocked: [], notRun: ['R-2'], manualCases: [],
      verdicts: [
        { id: 'R-1', status: 'pass', label: 'cases:1', adjudication: null },
        { id: 'R-2', status: 'not-run', label: 'cases:1', adjudication: null },
      ],
      batches: [{ label: 'cases:1', caseIds: ['R-1', 'R-2'] }],
    };
    expect(fourInvariantViolations(good)).toEqual([]);
    expect(fourInvariantViolations({ ...good, total: 3 }).some((v) => v.startsWith('1:'))).toBe(true);
    const badStatus = { ...good, verdicts: [good.verdicts[0], { ...good.verdicts[1], status: 'skipped' }] };
    expect(fourInvariantViolations(badStatus).some((v) => v.startsWith('2:'))).toBe(true);
    expect(fourInvariantViolations({ ...good, notRun: [] }).some((v) => v.startsWith('3:'))).toBe(true);
    const overlap = { ...good, batches: [...good.batches, { label: 'cases:2', caseIds: ['R-1'] }] };
    expect(fourInvariantViolations(overlap).some((v) => v.startsWith('4:'))).toBe(true);
  });

  it.each(Object.keys(FULL_RUNS))(
    '[preserved] today\'s 19 keys keep their names, element shapes and types; their values change only on a run with non-empty verdictAnomalies (§12.3, T3-1d-5): %s',
    async (name) => {
      const pre = await replay('pre', FULL_RUNS[name]);
      const live = await replay('live', FULL_RUNS[name]);
      expect(Object.keys(pre.result).sort()).toEqual([...LEGACY_KEYS].sort());
      expect(pick(live.result, LEGACY_KEYS)).toEqual(pick(pre.result, LEGACY_KEYS));
      expect(Object.keys(live.result).filter((k) => !LEGACY_KEYS.includes(k)).every((k) => NEW_KEYS.includes(k))).toBe(true);
    },
  );

  it('[canary] the 19-key pick(...) comparison catches a legacy key whose TYPE changed (rows 50-54)', async () => {
    const { result: full } = await replay('live');
    const typeChanged = { ...full, total: String(full.total) };
    expect(pick(typeChanged, LEGACY_KEYS)).not.toEqual(pick(full, LEGACY_KEYS));
  });

  it('[new] no verdicts row field is named automatable (§12.3, T3-1d-5)', async () => {
    const { result } = await replay('live');
    expect(result.verdicts.length).toBe(result.total);
    expect(result.verdicts.filter((row) => Object.prototype.hasOwnProperty.call(row, 'automatable'))).toEqual([]);
  });

  const EARLY = {
    'enumerationFailed (:438)': { respond: (l, p, f) => (l === 'enumerate:1' ? null : f()) },
    'docFound false (:450)': {
      args: ARGS_WITHOUT_FILES,
      respond: (l, p, f) => (l === 'enumerate:discovery' ? { docFound: false, cases: [], detail: 'no docs' } : f()),
    },
    'enumerationIncomplete (:460)': {
      respond: (l, p, f) => {
        const reply = f();
        if (l === 'enumerate:2') reply.cases = reply.cases.filter((c) => c.id !== 'R-910');
        return reply;
      },
    },
    'zero cases (:473)': {
      args: ARGS_WITHOUT_FILES,
      respond: (l, p, f) => (l === 'enumerate:discovery' ? { docFound: true, cases: [], detail: 'empty' } : f()),
    },
  };

  it.each(Object.keys(EARLY))('[preserved] B-10: early return %s keeps today\'s keys and values', async (name) => {
    const pre = await replay('pre', EARLY[name]);
    const live = await replay('live', EARLY[name]);
    expect(pre.result.ok).toBe(false);
    expect(byLabel(pre.calls, 'cases:')).toEqual([]);
    expect(omit(live.result, NEW_KEYS)).toEqual(pre.result);
  });

  it.each(Object.keys(EARLY))('[new] the 4 early returns gain the four keys (§12.3): %s', async (name) => {
    const { result } = await replay('live', EARLY[name]);
    expect(pick(result, ['verdicts', 'batches', 'verdictAnomalies'])).toEqual({ verdicts: [], batches: [], verdictAnomalies: [] });
    expect(Object.keys(result.models || {}).sort()).toEqual(['enumerate', 'refuter', 'runner']);
  });

  it.each(Object.keys(EARLY))('[canary] the omit(...) comparison over an early return catches a changed VALUE, not just a changed key (rows 56-59): %s', async (name) => {
    const { result } = await replay('live', EARLY[name]);
    const mutated = { ...result, ok: !result.ok };
    expect(omit(mutated, NEW_KEYS)).not.toEqual(omit(result, NEW_KEYS));
  });
});

// --- B-11 / B-19 / source sweeps ----------------------------------------------------

describe('meta, added lines and the sweep seam (B-11, B-19, W-1)', () => {
  it('[new] B-11: meta.whenToUse states the refuter change and that bucket b is not a workflow input', async () => {
    const { meta } = await workflow('live');
    expect(meta.whenToUse).toContain('refuterModel');
    expect(meta.whenToUse).toContain('opus');
    expect(meta.whenToUse).toMatch(/bucket b/i);
    expect(meta.whenToUse).toMatch(/not (?:a |an )?(?:workflow )?input/i);
  });

  it('[new] [src] B-6: the args comment names refuterModel and its opus default', async () => {
    const { source } = await workflow('live');
    expect(source).toMatch(/^\/\/\s+refuterModel\?:.*opus/m);
  });

  it('[preserved] [src] B-19 (i)-(iii) over the added lines: lane B adds no vitest pattern, DEF-1..DEF-17 stay in lane A (T3-L2)', async () => {
    const pre = await workflow('pre');
    const live = await workflow('live');
    expect(b19Hits(pre.source, live.source)).toEqual({ i: [], ii: [], iii: [] });
  });

  it('[canary] B-19: planted added lines hit (i), (ii) and (iii), and a slash inside a string or a W_BLOCK line does not', async () => {
    const { source } = await workflow('pre');
    const plant = (extra) => b19Hits(source, `${source}\n${extra}\n`);
    expect(plant('const PLANTED = /R-\\d+/u')).toEqual({ i: [], ii: [source.split('\n').length + 1], iii: [] });
    expect(plant('const PLANTED = new RegExp(\'R-\')').ii).toHaveLength(1);
    expect(plant('const PLANTED = \'npx vitest run lib\'')).toMatchObject({ ii: [] });
    expect(plant('const PLANTED = \'npx vitest run lib\'').i).toHaveLength(1);
    expect(plant('const PLANTED = \'vitest\'').iii).toHaveLength(1);
    expect(plant('const PLANTED = \'a /usr/bin path\'')).toEqual({ i: [], ii: [], iii: [] });
    const wBlock = ['const W_BLOCK = [', ...W_BLOCK_LINES.map((l) => `  '${l}',`), ']'].join('\n');
    expect(plant(wBlock)).toEqual({ i: [], ii: [], iii: [] });
  });

  it('[preserved] [src] the walk of test/workflows finds exactly 3 .js files and parseModuleSource succeeds on each (R7-1) — T2 seam, see §9 OQ-P7', () => {
    const found = walkJs(HERE).map((f) => path.relative(HERE, f).split(path.sep).join('/')).sort();
    expect(found).toEqual(['loadWorkflow.js', 'stage10Regression.harness.test.js', 'wBlock.pinned.js']);
    for (const f of walkJs(HERE)) expect(() => parseModuleSource(readFileSync(f, 'utf8'))).not.toThrow();
  });

  it('[canary] parseModuleSource throws on a planted unterminated string, so "succeeds" has power', () => {
    expect(() => parseModuleSource('const planted = \'never closed\n')).toThrow();
  });

  it('[preserved] [src] their app/lib imports are exactly exportGraph.js and tokenizeSource.js (W-1 e)', () => {
    const imports = walkJs(HERE).flatMap((f) => appLibImports(readFileSync(f, 'utf8'), f));
    expect([...new Set(imports)].sort()).toEqual(ALLOWED_APP_LIB);
  });

  it('[canary] a planted phrasing.js import hits (W-1 e)', () => {
    const planted = 'import { x } from \'../../lib/text/phrasing.js\';\nconst y = await import(\'@/app/page.js\');\n';
    const hits = appLibImports(planted, path.join(HERE, 'planted.js')).filter((p) => !ALLOWED_APP_LIB.includes(p));
    expect(hits).toEqual(['lib/text/phrasing.js', 'app/page.js']);
  });

  it('[preserved] log stub captures the no-args.files warning (:295)', async () => {
    const { logs, phases } = await replay('live', { args: ARGS_WITHOUT_FILES });
    expect(logs.some((l) => l.startsWith('WARNING: no args.files supplied'))).toBe(true);
    expect(phases).toEqual(['Enumerate', 'Execute', 'Adjudicate']);
    const withFiles = await replay('live');
    expect(withFiles.logs.some((l) => l.startsWith('WARNING: no args.files supplied'))).toBe(false);
  });
});
