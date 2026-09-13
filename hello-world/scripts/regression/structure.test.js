// Lane A source-text and lint rows (design §1, §1.2 W-6, §1.3, §6.1, §6.3, §7.1, §7.3, §10.3, §15).
// This file imports no runtime module, so it collects before W5-A lands; its RED row is the walk canary.
import { describe, test, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ESLint } from 'eslint';
import { tokenizeSource } from '../../lib/sourceScan/tokenizeSource.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const HW = resolve(HERE, '..', '..');
const LANE_A = join(HW, 'scripts', 'regression');
const ENTRIES = ['runner', 'launch', 'gate', 'render-row', 'invoke', 'fingerprint', 'corpusRows', 'cnjBaseline'];
const GUARDED = ['launch.js', 'runner.js', 'invoke.js'];
const TITLES = {
  'launcher.test.js': '[canary] recursion-guard: the in-tree launch.js refuses under VITEST with no run argument',
  'runner.test.js': '[canary] recursion-guard: the in-tree runner.js refuses under VITEST with no run argument',
  'invoke.test.js': '[canary] recursion-guard: the in-tree invoke.js refuses under VITEST with no run argument',
};

// §1 walks: withFileTypes, descend only where isDirectory() is true (a junction is neither).
function walk(dir, out = []) {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) {
      if (d.name !== 'node_modules') walk(p, out);
    } else if (d.isFile()) out.push(p);
  }
  return out;
}
const laneFiles = walk(HERE);
const runtime = laneFiles.filter((p) => p.endsWith('.js') && !p.endsWith('.test.js') && dirname(p) === HERE);
const tests = laneFiles.filter((p) => p.endsWith('.test.js'));
const tok = (text, label = 'planted') => tokenizeSource(text, { label });
const T = (p) => tok(readFileSync(p, 'utf8'), relative(HW, p));
const byName = (name) => T(join(HERE, name));

// String, template and regex bodies: the runs where readable and codeMask differ (codeMask blanks them).
function literals(t) {
  const out = [];
  for (let i = 0; i < t.readable.length;) {
    if (t.readable[i] !== t.codeMask[i]) {
      let j = i;
      while (j < t.readable.length && t.readable[j] !== t.codeMask[j]) j++;
      out.push({ start: i, end: j, text: t.readable.slice(i, j).replace(/^['"`]|['"`]$/g, '') });
      i = j;
    } else i++;
  }
  return out;
}
function matchParen(s, open) {
  let d = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') d++;
    else if (s[i] === ')' && --d === 0) return i;
  }
  return -1;
}
function matchBrace(s, open) {
  let d = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') d++;
    else if (s[i] === '}' && --d === 0) return i;
  }
  return -1;
}
// Named function bodies: `function name(...) {` and `const name = (...) => {`.
function functionRanges(codeMask) {
  const out = [];
  const re = /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(|\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g;
  for (const m of codeMask.matchAll(re)) {
    const close = matchParen(codeMask, m.index + m[0].length - 1);
    if (close < 0) continue;
    const after = codeMask.slice(close + 1).match(/^\s*(=>\s*)?\{/);
    if (!after || (m[2] && !after[1])) continue;
    const open = close + 1 + after[0].length - 1;
    out.push({ name: m[1] || m[2], start: open, end: matchBrace(codeMask, open) });
  }
  return out;
}
function specifiers(t) {
  return literals(t)
    .filter((l) => /(\bfrom|\bimport\s*\(|\bimport)\s*['"`]?$/.test(t.codeMask.slice(Math.max(0, l.start - 24), l.start)))
    .map((l) => l.text);
}
const hits = (t, re) => [...t.codeMask.matchAll(re)];

const DEL_RE = /\b(rmSync|rmdirSync|unlinkSync|renameSync|rm|rmdir|unlink|rename)\s*\(/g;
const DEL_ALLOWED = { 'io.js': ['deleteRunDir', 'deleteCompanion', 'releaseOwnLock', 'takeOverLock'], 'plantedRepo.js': ['removePlantedRepo'] };
function deletionCalls(t, file) {
  const ranges = functionRanges(t.codeMask);
  return hits(t, DEL_RE).map((m) => ({
    file,
    ok: ranges.some((r) => r.start <= m.index && m.index < r.end && (DEL_ALLOWED[file] || []).includes(r.name)),
  }));
}
const SPAWN_RE = /\b(spawn|spawnSync|execFile|execFileSync|fork)\s*\(|\bdeps\.spawn\w*\s*\(/g;
const ENTRY_RE = /(^|[/\\])(launch|runner|gate|invoke|render-row|fingerprint|corpusRows|cnjBaseline)\.js$/;
function spawnViolations(t, exemptTitles = []) {
  const exempt = exemptTitles.map((title) => {
    const at = t.readable.indexOf(title);
    const open = t.codeMask.lastIndexOf('(', at);
    return { start: open, end: matchParen(t.codeMask, open) };
  });
  const lits = literals(t);
  const out = [];
  for (const m of hits(t, SPAWN_RE)) {
    const open = m.index + m[0].length - 1;
    const close = matchParen(t.codeMask, open);
    if (exempt.some((e) => e.start <= m.index && m.index < e.end)) continue;
    for (const l of lits) if (l.start > open && l.end <= close && ENTRY_RE.test(l.text)) out.push(l.text);
  }
  return out;
}
const GUARD_TARGETS = /\b(spawn|spawnSync|execFile|fork|spawnVitest|createExclusive|appendExisting|rewriteInPlace|writeFileSync|mkdirSync)\s*\(/g;
function guardFirst(t) {
  const main = functionRanges(t.codeMask).find((r) => r.name === 'main');
  if (!main) return 'no-main';
  const body = t.codeMask.slice(main.start, main.end);
  const g = body.search(/\brecursionGuard\s*\(/);
  if (g < 0) return 'no-guard';
  const first = [...body.matchAll(GUARD_TARGETS)][0];
  return first && first.index < g ? 'late' : 'ok';
}
const BELT = [
  ['__dirname', /\b__dirname\b/g, 'export const a = __dirname;'],
  ['__filename', /\b__filename\b/g, 'export const a = __filename;'],
  ['require(', /\brequire\s*\(/g, "export const a = require('x');"],
  ['module.exports', /\bmodule\.exports\b/g, 'module.exports = 1;'],
  ['exports.x', /\bexports\.[A-Za-z_$]/g, 'exports.a = 1;'],
  ['window.', /\bwindow\./g, 'export const a = window.x;'],
  ['document.', /\bdocument\./g, 'export const a = document.body;'],
];

describe('§15 layout and walks', () => {
  test('[canary] the walks found >= 19 runtime and >= 14 test files (§15 item 6)', () => {
    expect(runtime.length).toBeGreaterThanOrEqual(19);
    expect(tests.length).toBeGreaterThanOrEqual(14);
  });
  test('[canary] tokenizeSource classifies a planted code line as code', () => {
    const t = tok("const a = 1; const s = 'text';\n");
    expect(t.codeMask).toContain('const a = 1;');
    expect(t.codeMask.includes('text')).toBe(false);
  });
  test('§15 item 1: package.json is exactly {"type":"module"}, and no lane A runtime file ends .mjs or .cjs', () => {
    expect(readFileSync(join(HERE, 'package.json'), 'utf8')).toBe('{"type":"module"}');
    expect(laneFiles.filter((p) => dirname(p) === HERE && /\.(mjs|cjs)$/.test(p))).toEqual([]);
    expect(laneFiles.filter((p) => p.includes(`${sep}fixtures${sep}`) && p.endsWith('.js'))).toEqual([]);
  });
  test('[canary] §15 item 1: a planted x.mjs name is found by the same filter', () => {
    expect([join(HERE, 'x.mjs')].filter((p) => dirname(p) === HERE && /\.(mjs|cjs)$/.test(p)).length).toBe(1);
  });
  test('[src] every lane A runtime file and test file stays under 1000 lines (§15 item 6, R8-5)', () => {
    for (const p of [...runtime, ...tests]) expect(readFileSync(p, 'utf8').split('\n').length, basename(p)).toBeLessThan(1000);
  });
});

describe('§15 items 2-3: lint', () => {
  test('[src] the resolved config gives no-undef severity 2 for every runtime .js (§15 item 2)', { timeout: 120000 }, async () => {
    const eslint = new ESLint({ cwd: HW });
    for (const p of runtime) {
      const rule = (await eslint.calculateConfigForFile(p)).rules['no-undef'];
      const sev = Array.isArray(rule) ? rule[0] : rule;
      expect(sev === 2 || sev === 'error', basename(p)).toBe(true);
    }
  });
  test('[canary] the same call on a .mjs path has no no-undef (§15 item 2)', { timeout: 60000 }, async () => {
    const rule = (await new ESLint({ cwd: HW }).calculateConfigForFile(join(HERE, 'virtual-canary.mjs'))).rules['no-undef'];
    expect(rule === undefined || rule[0] === 0 || rule === 0 || rule === 'off').toBe(true);
  });
  test('[canary] lintText replayUrl at a virtual lane A .js path gives exactly 1 no-undef (§15 item 2)', { timeout: 60000 }, async () => {
    const [r] = await new ESLint({ cwd: HW }).lintText('export const x = replayUrl;', { filePath: join(HERE, 'virtual-canary.js') });
    expect(r.messages.filter((m) => m.ruleId === 'no-undef').length).toBe(1);
  });
  const plainNode = () => {
    const globals = JSON.parse(spawnSync(process.execPath, ['--input-type=module', '-e', 'process.stdout.write(JSON.stringify(Object.getOwnPropertyNames(globalThis)))'], { encoding: 'utf8', windowsHide: true }).stdout);
    return new ESLint({
      cwd: HW,
      overrideConfigFile: true,
      overrideConfig: [{ files: ['**/*.js'], languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: Object.fromEntries(globals.map((n) => [n, 'readonly'])) }, rules: { 'no-undef': 'error' } }],
    });
  };
  test('[src] THE guard: the plain-node globals lint gives 0 messages over every runtime file (§15 item 3)', { timeout: 120000 }, async () => {
    const results = await plainNode().lintFiles(runtime);
    expect(results.length).toBe(runtime.length);
    expect(results.flatMap((r) => r.messages.map((m) => `${basename(r.filePath)}:${m.line} ${m.message}`))).toEqual([]);
  });
  test.each([['export const x = status;', 1], ['export const y = parent.pid;', 1], ['export const z = document.body;', 1], ["export const w = require('x');", 1], ['export const v = process.pid + navigator.hardwareConcurrency;', 0]])(
    '[canary] plain-node globals lint: %j -> %d message(s) (§15 item 3)', async (code, n) => {
      const [r] = await plainNode().lintText(code, { filePath: join(HERE, 'virtual-globals.js') });
      expect(r.messages.length).toBe(n);
    }, 60000,
  );
});

describe('§15 items 4-5: source-text rules', () => {
  test('[src] no __dirname, __filename, require(, module.exports, exports.x, window., document. (§15 item 4)', () => {
    for (const p of runtime) for (const [, re] of BELT) expect(hits(T(p), re).length, `${basename(p)} ${re}`).toBe(0);
  });
  test.each(BELT.map(([name, re, code]) => [name, re, code]))('[canary] §15 item 4: a planted %s hits', (_n, re, code) => {
    expect(hits(tok(code), re).length).toBe(1);
  });
  test('[src] exactly 6 deletion calls in the five functions (§10.3)', () => {
    const calls = runtime.flatMap((p) => deletionCalls(T(p), basename(p)));
    expect(calls.length).toBe(6);
    expect(calls.filter((c) => !c.ok)).toEqual([]);
  });
  test('[canary] a planted rmSync outside them hits (§10.3)', () => {
    expect(deletionCalls(tok('function other(x) { fs.rmSync(x, { recursive: true }); }\n'), 'io.js').filter((c) => !c.ok).length).toBe(1);
  });
  const ENV_SPREAD = /\benv\s*:\s*\{\s*\.\.\.\s*process\.env\b/g;
  test('[src] one env constant at three sites (§7.1)', () => {
    for (const f of ['launch.js', 'io.js', 'invoke.js']) {
      const t = byName(f);
      expect(/import\s*\{[^}]*\bvitestEnv\b[^}]*\}\s*from\s*['"]\.\/launchPolicy\.js['"]/.test(t.readable), f).toBe(true);
      expect(hits(t, /\bvitestEnv\s*\(/g).length, f).toBeGreaterThanOrEqual(1);
    }
    for (const p of runtime) expect(hits(T(p), ENV_SPREAD).length, basename(p)).toBe(0);
  });
  test('[canary] env: {...process.env} beside a spawn hits (§7.1)', () => {
    expect(hits(tok('spawn(a, b, { env: {...process.env} });\n'), ENV_SPREAD).length).toBe(1);
  });
  const IO_BAD = [/\bspawnSync\s*\(/g, /\bexecSync\s*\(/g];
  const pipeLits = (t) => literals(t).filter((l) => l.text === 'pipe');
  test('[src] io.js has no spawnSync, execSync or \'pipe\' (§7.3; T3-1g-1)', () => {
    const t = byName('io.js');
    for (const re of IO_BAD) expect(hits(t, re).length).toBe(0);
    expect(pipeLits(t)).toEqual([]);
  });
  test.each([['spawnSync(', "spawnSync('x', []);\n"], ['execSync(', "execSync('x');\n"], ["'pipe'", "spawn(a, b, { stdio: 'pipe' });\n"]])('[canary] planted %s hits (§7.3)', (_n, code) => {
    const t = tok(code);
    expect(IO_BAD.reduce((n, re) => n + hits(t, re).length, 0) + pipeLits(t).length).toBe(1);
  });
  const SHELL = [/\bshell\s*:\s*true\b/g, /\bexecSync\s*\(/g, /(?<![.\w$])exec\s*\(/g];
  const SHELL_STR = /(\.cmd\b|\bnpx\b|cmd\.exe|powershell)/i;
  const shellHits = (t) => {
    let n = SHELL.reduce((a, re) => a + hits(t, re).length, 0);
    const lits = literals(t);
    for (const m of hits(t, SPAWN_RE)) {
      const open = m.index + m[0].length - 1;
      const close = matchParen(t.codeMask, open);
      n += lits.filter((l) => l.start > open && l.end <= close && SHELL_STR.test(l.text)).length;
    }
    return n;
  };
  test('[src] no shell on any spawn path: lane A runtime files hold 0 matches of shell:\\s*true, execSync(, exec(, .cmd, npx, cmd.exe, powershell (T3-1g-1)', () => {
    for (const p of runtime) expect(shellHits(T(p)), basename(p)).toBe(0);
  });
  test('[canary] a planted shell: true hits (T3-1g-1)', () => {
    expect(shellHits(tok("spawn('node', [], { shell: true });\n"))).toBe(1);
  });
  const writers = (t) => hits(t, /\bprocess\.stdout\.write\s*\(|\bconsole\.(log|info)\s*\(/g).length;
  test('[src] gate.js has one stdout writer (§6.1)', () => {
    expect(writers(byName('gate.js'))).toBe(1);
  });
  test('[canary] a second process.stdout.write hits (§6.1)', () => {
    expect(writers(tok("process.stdout.write('a');\nprocess.stdout.write('b');\n"))).toBe(2);
  });
  const verdictLits = (t) => literals(t).filter((l) => /(^|\s)(GATE=|RESULT=|BUCKET_B=)/.test(l.text));
  test('[src] launch.js has no verdict literal (GATE=, RESULT=, BUCKET_B=) (§6.1)', () => {
    expect(verdictLits(byName('launch.js'))).toEqual([]);
  });
  test("[canary] a planted 'GATE=' literal hits (§6.1)", () => {
    expect(verdictLits(tok("const x = 'GATE=green';\n")).length).toBe(1);
  });
  const ownFreshness = (t) => hits(t, /\bfunction\s+freshness\s*\(|\b(?:const|let)\s+freshness\s*=/g).length;
  test('[src] both entries import freshness from gateCheck.js (§6.3)', () => {
    for (const f of ['gate.js', 'render-row.js']) {
      const t = byName(f);
      expect(/import\s*\{[^}]*\bfreshness\b[^}]*\}\s*from\s*['"]\.\/gateCheck\.js['"]/.test(t.readable), f).toBe(true);
      expect(ownFreshness(t), f).toBe(0);
    }
  });
  test('[canary] a planted local function freshness( hits (§6.3)', () => {
    expect(ownFreshness(tok('function freshness(a, b) { return a === b; }\n'))).toBe(1);
  });
});

describe('§1.3 recursion by construction', () => {
  test('[src] spawn arguments name an entry only as a materializePlantedRepo value; the three titles found exactly once (§1.3 rule 4, eight entry names)', () => {
    expect(tests.length).toBeGreaterThanOrEqual(14);
    for (const [file, title] of Object.entries(TITLES)) {
      const t = byName(file);
      expect(t.readable.split(title).length - 1, file).toBe(1);
    }
    for (const p of tests) {
      const title = TITLES[basename(p)];
      expect(spawnViolations(T(p), title ? [title] : []), basename(p)).toEqual([]);
    }
  });
  test('[canary] a planted spawn of ./runner.js hits; a planted readFileSync of it does not (§1.3 rule 4)', () => {
    expect(spawnViolations(tok("spawn(process.execPath, [new URL('./runner.js', import.meta.url).pathname]);\n")).length).toBe(1);
    expect(spawnViolations(tok("readFileSync(new URL('./runner.js', import.meta.url), 'utf8');\n")).length).toBe(0);
  });
  test('[src] in launch.js, runner.js and invoke.js the recursionGuard call precedes every spawn, createExclusive, appendExisting, rewriteInPlace, writeFileSync and mkdirSync call in main (§1.3 rule 3; C18-3)', () => {
    for (const f of GUARDED) expect(guardFirst(byName(f)), f).toBe('ok');
  });
  test('[canary] a planted main with mkdirSync before the guard hits (§1.3 rule 3)', () => {
    expect(guardFirst(tok("async function main() { mkdirSync('x'); if (recursionGuard(g) === 'refuse') return; }\n"))).toBe('late');
  });
});

describe('§1 imports, entries and literals', () => {
  const APP = join(HW, 'app');
  const LIB = join(HW, 'lib');
  const intoLaneA = (t, file) => specifiers(t).filter((s) => {
    const abs = s.startsWith('@/') ? join(HW, s.slice(2)) : s.startsWith('.') ? resolve(dirname(file), s) : null;
    return abs !== null && (abs === LANE_A || abs.startsWith(LANE_A + sep));
  });
  // Measured at 4b: this walk and read of app/ and lib/ exceeds vitest's 5 s default on this machine.
  test('[src] nothing under app/ or lib/ imports scripts/regression (§1.2 W-6)', { timeout: 180000 }, () => {
    const app = walk(APP).filter((p) => /\.(js|jsx|mjs)$/.test(p));
    const lib = walk(LIB).filter((p) => /\.(js|jsx|mjs)$/.test(p));
    expect(app.filter((p) => p.endsWith('.js')).length).toBeGreaterThanOrEqual(1);
    expect(lib.filter((p) => p.endsWith('.js')).length).toBeGreaterThanOrEqual(1);
    // A static or literal dynamic specifier into lane A must contain this substring; the rest need no tokenizing.
    const bad = [...app, ...lib].filter((p) => readFileSync(p, 'utf8').includes('scripts/regression')).flatMap((p) => intoLaneA(T(p), p).map((s) => `${relative(HW, p)}: ${s}`));
    expect(bad).toEqual([]);
  });
  test.each([["const m = await import('../scripts/regression/definitions.js');\n"], ["import { plan } from '@/scripts/regression/definitions.js';\n"]])('[canary] W-6: a planted app/ source %j hits (§1.2 W-6)', (code) => {
    const file = join(APP, 'page.js');
    expect(intoLaneA(tok(code, 'app/page.js'), file).length).toBe(1);
  });
  const badImports = (t) => specifiers(t).filter((s) => !/^node:/.test(s) && !/^\.\//.test(s));
  test('[src] runtime imports only node:* and ./ (§1; T3-2-5)', () => {
    for (const p of runtime) expect(badImports(T(p)), basename(p)).toEqual([]);
  });
  test("[canary] a planted '@/lib/x' and '../../lib/x' hit (§1)", () => {
    expect(badImports(tok("import a from '@/lib/x';\nimport b from '../../lib/x';\nimport c from 'node:fs';\n")).length).toBe(2);
  });
  test('[src] every entry (eight) copies invokedDirectly() and never calls process.exit (§1, R8-8; T3-2-2)', () => {
    for (const e of ENTRIES) {
      const t = byName(`${e}.js`);
      expect(hits(t, /\bfunction\s+invokedDirectly\s*\(/g).length, e).toBe(1);
      expect(hits(t, /\bprocess\.exit\s*\(/g).length, e).toBe(0);
      expect(hits(t, /\bexport\s+(async\s+)?function\s+parseArgs\s*\(/g).length, `${e} exports parseArgs`).toBe(1);
    }
    expect(hits(byName('plantedRepo.js'), /\binvokedDirectly\b/g).length).toBe(0);
  });
  test('[canary] a planted process.exit( hits (§1)', () => {
    expect(hits(tok('process.exit(1);\n'), /\bprocess\.exit\s*\(/g).length).toBe(1);
  });
  const barePid = (t) => (t.readable.match(/(?<![A-Z_])PID=/g) || []).length;
  test('[src] no bare PID= key literal (T3-1d2-3)', () => {
    for (const p of runtime) expect(barePid(T(p)), basename(p)).toBe(0);
  });
  test("[canary] a planted 'PID=' string hits (T3-1d2-3)", () => {
    expect(barePid(tok("const a = 'PID=' + 1; const b = 'RUNNER_PID=';\n"))).toBe(1);
  });
  const killsL3 = (t) => hits(t, /\b(killTree|kill)\s*\([^)]*\blauncherPid\b/g).length;
  test('[src] no lane A code kills L-3 (§2.7)', () => {
    for (const p of runtime) expect(killsL3(T(p)), basename(p)).toBe(0);
  });
  test('[canary] a planted killTree(lock.launcherPid) hits (§2.7)', () => {
    expect(killsL3(tok('killTree(lock.launcherPid);\n'))).toBe(1);
  });
  test('[src] launch.js accepts no timing flag (§1; §3.1 timing is deps-only)', () => {
    const flags = literals(byName('launch.js')).filter((l) => /^--(timeout|stale|heartbeat|grace|verify|timing|second-read|kill-wait|deadline)/i.test(l.text));
    expect(flags).toEqual([]);
  });
  test('[src] no readdir with recursive: true (T3-3b2-L2)', () => {
    for (const p of runtime) expect(hits(T(p), /\breaddir(Sync)?\s*\([^)]*\brecursive\s*:\s*true/g).length, basename(p)).toBe(0);
  });
  test('[canary] readdirSync(d, {recursive: true}) hits (T3-3b2-L2)', () => {
    expect(hits(tok('readdirSync(d, {recursive: true});\n'), /\breaddir(Sync)?\s*\([^)]*\brecursive\s*:\s*true/g).length).toBe(1);
  });
  test('[src] the pinned exports of definitions.js (T3-1b2-15)', async () => {
    const m = await import('./definitions.js');
    for (const name of ['extractCorpus', 'selects', 'plan']) expect(typeof m[name], name).toBe('function');
  });
});
