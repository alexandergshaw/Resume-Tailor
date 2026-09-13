// Test infrastructure for the stage-10 workflow harness (T3 design r7 section
// 12.4). Imports only node:fs and node:vm, so a plain-node script outside
// vitest (the step-10 lane B loader) can use the same API and the same stub
// replay as the harness.
//
// Why the workflow is read as TEXT and compiled here, never imported:
//   * `.claude/workflows/stage10-regression.js` is not a module a test can
//     import. Its body runs `phase(...)` and `agent(...)` at top level over a
//     global `args`, and it ends in a top-level `return`.
//   * No workflow source may appear as code in a `.js` under `test/` (design
//     section 1.2 W-1 (a), (c)): the pinned pre-T3 copy is the DATA file
//     `fixtures/stage10-regression.pre-T3.txt`.
//
// The compile context holds the JavaScript intrinsics plus EXACTLY the stubs
// the workflow uses as free identifiers: agent, phase, parallel, log, args.
// Nothing else from node is visible (no console, timers, process, TextEncoder
// or structuredClone), so a workflow that grows a new free identifier fails
// loudly with a ReferenceError instead of silently reaching a node global.
// `phase`, `parallel` and `log` always have loader defaults (log and phase are
// captured); a caller that omits `agent` or `args` gets the ReferenceError at
// the first use.
//
// Stated limit: the stub agent does not enforce the `schema` option.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export const STUB_NAMES = Object.freeze(['agent', 'phase', 'parallel', 'log', 'args']);

export class WorkflowLoadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WorkflowLoadError';
  }
}

const EXPORT_AT_LINE_START = /^export\b/gm;
const META_EXPORT = /^export const meta = /m;

/** Wrap a workflow body as an async function and compile it inside `context`. */
function compileIn(context, body, filename) {
  const wrapped = `(async function () {\n${body}\n})`;
  // lineOffset -1 cancels the wrapper's first line, so a stack trace names the
  // workflow file's own line numbers.
  const script = new vm.Script(wrapped, { filename, lineOffset: -1 });
  return script.runInContext(context);
}

/** Copy a value out of the compile context into this realm (undefined kept). */
function toThisRealm(value) {
  return value === undefined ? undefined : structuredClone(value);
}

const defaultParallel = (thunks) => Promise.all(thunks.map((thunk) => thunk()));

/**
 * @param {{ path: string } | { source: string, filename?: string }} spec
 * @returns {Promise<{ source: string, filename: string, meta: object,
 *   run: (stubs: object) => Promise<{ result: any, logs: string[], phases: string[] }> }>}
 */
export async function loadWorkflow(spec) {
  const hasPath = Boolean(spec) && typeof spec.path === 'string';
  const hasSource = Boolean(spec) && typeof spec.source === 'string';
  if (hasPath === hasSource) {
    throw new WorkflowLoadError('loadWorkflow needs exactly one of {path} or {source}');
  }
  const filename = hasPath ? spec.path : spec.filename || 'stage10-regression.source.js';
  // CRLF and LF checkouts of the same text compile and replay identically.
  const source = (hasPath ? readFileSync(spec.path, 'utf8') : spec.source).replace(/\r\n/g, '\n');

  const exportsFound = source.match(EXPORT_AT_LINE_START) || [];
  if (exportsFound.length !== 1 || !META_EXPORT.test(source)) {
    throw new WorkflowLoadError(
      `${filename}: expected exactly one line-start export, "export const meta = ", found ${exportsFound.length}`,
    );
  }
  const runBody = source.replace(META_EXPORT, 'const meta = ');
  // The same text with the meta export turned into a `return`: the function
  // returns the meta object before any other statement runs (function
  // declarations are hoisted, never executed), so it needs no stub at all.
  const metaBody = source.replace(META_EXPORT, 'return ');
  const meta = toThisRealm(await compileIn(vm.createContext(Object.create(null)), metaBody, filename)());

  async function run(stubs = {}) {
    for (const name of Object.keys(stubs)) {
      if (!STUB_NAMES.includes(name)) {
        throw new WorkflowLoadError(`unknown stub "${name}"; the workflow's free identifiers are ${STUB_NAMES.join(', ')}`);
      }
    }
    const logs = [];
    const phases = [];
    const globals = Object.create(null);
    if (Object.prototype.hasOwnProperty.call(stubs, 'agent')) globals.agent = stubs.agent;
    if (Object.prototype.hasOwnProperty.call(stubs, 'args')) globals.args = stubs.args;
    globals.parallel = stubs.parallel || defaultParallel;
    globals.log = (...parts) => {
      logs.push(parts.map(String).join(' '));
      if (stubs.log) stubs.log(...parts);
    };
    globals.phase = (...parts) => {
      phases.push(String(parts[0]));
      if (stubs.phase) stubs.phase(...parts);
    };
    const raw = await compileIn(vm.createContext(globals), runBody, filename)();
    return { result: toThisRealm(raw), logs, phases };
  }

  return { source, filename, meta, run };
}

// --- The stub replay over fixtures/stub-run.json (plan P-13) --------------

const CASE_HEAD = /^Case (R-\d+) \[area:/;

/**
 * Split a prompt into case blocks. A block runs from a line `Case <id> [area:`
 * to the next such line or the prompt's end (AC INV-1); trailing blank lines
 * are dropped, so a runner prompt's block equals the dispatched caseBlock text.
 * A block is never found by searching the whole prompt for a step.
 *
 * @param {string} prompt
 * @returns {{ id: string, text: string }[]}
 */
export function splitCaseBlocks(prompt) {
  const blocks = [];
  let current = null;
  for (const line of String(prompt).split('\n')) {
    const head = CASE_HEAD.exec(line);
    if (head) {
      current = { id: head[1], lines: [line] };
      blocks.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return blocks.map((block) => {
    const lines = [...block.lines];
    while (lines.length > 1 && lines[lines.length - 1].trim() === '') lines.pop();
    return { id: block.id, text: lines.join('\n') };
  });
}

/**
 * The stub agent's reply to one call, from a stub-run document:
 *   enumerate:discovery -> every file's enumerate cases, in args.files order;
 *   enumerate:<n>       -> the cases of every args.files entry whose exact line
 *                          "- <file>" appears in the prompt;
 *   cases:<label>       -> one verdict {id, ...verdicts[id]} per case block in
 *                          the prompt, in prompt order (an ID with no verdict
 *                          entry is omitted);
 *   refute:<id>:<k>     -> refutations[id][k - 1], else defaultRefutation.
 * Any other label gets null.
 */
export function replyFor(run, label, prompt) {
  const text = String(prompt);
  const files = run.args.files;
  if (label === 'enumerate:discovery') {
    return { docFound: true, cases: files.flatMap((f) => run.enumerate[f.file] || []), detail: 'stub discovery' };
  }
  if (label.startsWith('enumerate:')) {
    const lines = new Set(text.split('\n'));
    const listed = files.filter((f) => lines.has(`- ${f.file}`));
    return { docFound: true, cases: listed.flatMap((f) => run.enumerate[f.file] || []), detail: 'stub enumerate' };
  }
  if (label.startsWith('cases:')) {
    const ids = splitCaseBlocks(text).map((block) => block.id);
    return { verdicts: ids.filter((id) => run.verdicts[id]).map((id) => ({ id, ...run.verdicts[id] })) };
  }
  if (label.startsWith('refute:')) {
    const [, id, k] = label.split(':');
    const votes = run.refutations[id] || [];
    return votes[Number(k) - 1] || run.defaultRefutation;
  }
  return null;
}

/**
 * A recording stub `agent` over a stub-run document. Every call is recorded as
 * {label, model, phase, prompt}; each reply is a fresh copy, so a workflow that
 * mutates a reply cannot change a later one.
 */
export function replayAgent(run) {
  const calls = [];
  async function agent(prompt, options = {}) {
    const call = { label: String(options.label), model: options.model, phase: options.phase, prompt: String(prompt) };
    calls.push(call);
    const reply = replyFor(run, call.label, call.prompt);
    return reply === null ? null : JSON.parse(JSON.stringify(reply));
  }
  return { agent, calls };
}
