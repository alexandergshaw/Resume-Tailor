// Lane A argv rows (design §7.1, §7.2, §8, §9, §1.3). Pure: nothing here spawns, and nothing
// touches the filesystem. Every row asserts observable output of argv.js / launchPolicy.js.
import { describe, test, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCLI } from 'vitest/node';
import {
  FIXED_FLAGS,
  classifyToken,
  checkPattern,
  wholeSuiteArgv,
  caseArgv,
  validateInvokeArgv,
  encodeFormC,
  decodeFormC,
  renderFormC,
} from './argv.js';
import { vitestEnv, envNamesSha256, recursionGuard } from './launchPolicy.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const VM = 'C:/planted/hello-world/node_modules/vitest/vitest.mjs';
const FIXED = ['--no-file-parallelism', '--allowOnly=false', '--reporter=default', '--reporter=json', '--no-cache'];
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

// §8.2 fixture table: 17 class tokens + the ok control. The row number is the design table's.
// NOTE: `a:b/x.test.js` also matches row 2's drive prefix, which precedes row 4; the class is the same.
const CLASS_ROWS = [
  ['--config=./evil.config.mjs', 'flag-shaped-token', 1],
  ['-uc', 'flag-shaped-token', 1],
  ['../x.test.js', 'path-escape', 2],
  ['C:x.test.js', 'path-escape', 2],
  ['C:1', 'path-escape', 2],
  ['D:123', 'path-escape', 2],
  ['x:1', 'path-escape', 2],
  ['\\\\host\\s\\x', 'path-escape', 2],
  ['/abs/x.test.js', 'path-escape', 2],
  ['lib/x.test.js.', 'path-escape', 2],
  ['lib/x.test.js ', 'path-escape', 2],
  ['lib/x.test.js:12', 'DEF-1u', 3],
  ['lib/x.test.js::$DATA', 'path-escape', 4],
  ['a:b/x.test.js', 'path-escape', 4],
  ['lib/(whoami)/x.test.js', 'DEF-1u', 5],
  ['[^\\', 'DEF-1u', 5],
  ['lib/', 'DEF-1u', 6],
  ['lib/x.test.js', 'ok', 'ok'],
  ['lib/x\x00.test.js', 'path-escape', 2],
];

const PATTERN_ROWS = [
  ['speaker labels', 'ok'],
  ['^grp', 'DEF-1u'],
  ['grp > one', 'DEF-1u'],
  ['(a+)+$', 'DEF-1u'],
  ['(', 'DEF-1u'],
  ['speaker (labels', 'DEF-1u'],
  ['it\u2019s', 'DEF-1u'],
];

// Fixture spans (every token ok): the §11.3 oracle spans plus a two-filter span.
const SPANS = [
  { name: 'one filter', span: { filters: ['lib/x.test.js'], pattern: null } },
  { name: 'filter + P', span: { filters: ['kb/speaker.test.js'], pattern: 'speaker labels' } },
  { name: 'two filters', span: { filters: ['grp/one.test.js', 'kb/speaker.test.js'], pattern: null } },
  { name: 'mixed-case filter + P', span: { filters: ['GRP/One.test.js'], pattern: 'GRP one' } },
  { name: 'substring filter + P', span: { filters: ['grp/one'], pattern: 'solo' } },
  { name: 'P only', span: { filters: [], pattern: 'grp.one' } },
];
const expectedCaseArgv = ({ filters, pattern }) => [VM, 'run', ...FIXED, ...filters, ...(pattern ? [`--testNamePattern=${pattern}`] : [])];

describe('§8.2 classifyToken', () => {
  test.each(CLASS_ROWS)('classifyToken: %j -> %s (§8.2 row %s)', (tok, cls) => {
    expect(classifyToken(tok)).toBe(cls);
  });
});

describe('§8.2 checkPattern', () => {
  test.each(PATTERN_ROWS)('checkPattern: %j -> %s (§8.2 row P)', (p, want) => {
    expect(checkPattern(p)).toBe(want);
  });
  test('checkPattern: a bare -t (no value) -> DEF-1u (§8.2 row P)', () => {
    expect(checkPattern(undefined)).toBe('DEF-1u');
    expect(checkPattern('')).toBe('DEF-1u');
  });
});

describe('§8.1 builders', () => {
  test('FIXED_FLAGS is exactly the five flags in order (§8.1)', () => {
    expect(FIXED_FLAGS).toEqual(FIXED);
  });

  test('wholeSuiteArgv = [vitestMjs, run, ...FIXED_FLAGS, --outputFile.json=<path>] and carries no case token (§8.1)', () => {
    expect(wholeSuiteArgv(VM, 'C:/B/0123/vitest.json')).toEqual([VM, 'run', ...FIXED, '--outputFile.json=C:/B/0123/vitest.json']);
    expect(parseCLI(['vitest', ...wholeSuiteArgv(VM, 'x.json').slice(1)]).filter).toEqual([]);
  });

  test.each(SPANS)('caseArgv builds the exact argv for the $name span (§8.1)', ({ span }) => {
    expect(caseArgv(span, VM)).toEqual(expectedCaseArgv(span));
  });

  test.each(SPANS)('no built argv contains "--" and no case element begins with "-" (§8.1, T3-1b2-6): $name', ({ span }) => {
    const argv = caseArgv(span, VM);
    expect(argv.includes('--')).toBe(false);
    for (const el of argv.slice(2 + FIXED.length)) {
      if (!el.startsWith('--testNamePattern=')) expect(el.startsWith('-')).toBe(false);
    }
    expect(argv.filter((el) => el.startsWith('-t')).length).toBe(0);
  });

  test.each(SPANS)('parseCLI(caseArgv(span)).options keys are within FIXED_FLAGS, testNamePattern and outputFile (§8.1, T3-1b2-6): $name', ({ span }) => {
    const argv = caseArgv(span, VM);
    const { filter, options } = parseCLI(['vitest', ...argv.slice(1)]);
    // Measured (vitest 4.1.8): parseCLI always adds "--": [], color and run; the t alias mirrors testNamePattern.
    const allowed = new Set(['fileParallelism', 'allowOnly', 'reporter', 'cache', 'testNamePattern', 't', 'outputFile', '--', 'color', 'run']);
    expect(Object.keys(options).filter((k) => !allowed.has(k))).toEqual([]);
    expect(options['--']).toEqual([]);
    expect(options.allowOnly).toBe(false);
    expect(filter).toEqual(span.filters);
    if (span.pattern) expect(options.testNamePattern).toBe(span.pattern);
  });

  test('caseArgv refuses a span with any refused token or a refused P: no argv (§8.1)', () => {
    expect(caseArgv({ filters: ['lib/x.test.js:12'], pattern: null }, VM)).toBeNull();
    expect(caseArgv({ filters: ['lib/x.test.js', '--config=./evil.config.mjs'], pattern: null }, VM)).toBeNull();
    expect(caseArgv({ filters: ['lib/x.test.js'], pattern: '^grp' }, VM)).toBeNull();
  });
});

describe('§9 step 3 validateInvokeArgv', () => {
  const OK = [VM, 'run', ...FIXED, 'lib/x.test.js'];
  const without = (flag) => OK.filter((e) => e !== flag);
  const ROWS = [
    ['not-array', 'lib/x.test.js'],
    ['not-array', [VM, 'run', ...FIXED, 3]],
    ['argv0', ['C:/Program Files/nodejs/node.exe', '-e', 'code']],
    ['not-run', [VM, 'watch', ...FIXED, 'lib/x.test.js']],
    ['flag-missing', without('--allowOnly=false')],
    ['flag-duplicate', [...OK, '--reporter=json']],
    ['flag-unknown', [...OK, '--config=./evil.config.mjs']],
    ['pattern', [...OK, '--testNamePattern=^grp']],
    ['pattern-duplicate', [...OK, '--testNamePattern=speaker labels', '--testNamePattern=speaker labels']],
    ['filter:DEF-1u', [VM, 'run', ...FIXED, 'lib/x.test.js:3']],
    ['filter:path-escape', [VM, 'run', ...FIXED, 'C:1']],
    ['no-filter', [VM, 'run', ...FIXED]],
    ['output-file', [...OK, '--outputFile.json=x']],
    ['double-dash', [...OK, '--']],
  ];
  test.each(ROWS)('validateInvokeArgv refuses %s (§9 step 3)', (reason, a) => {
    expect(validateInvokeArgv(a, VM)).toBe(reason);
  });
  test('validateInvokeArgv refuses decode: an undecodable payload (§9 step 2)', () => {
    expect(decodeFormC('%%%not-base64')).toEqual({ ok: false, reason: 'decode' });
  });
  test('decodeFormC refuses a payload only a strict base64 decode would reject (§9 step 2, T3-C4b-12)', () => {
    // A single character outside [A-Za-z0-9+/=] injected into an otherwise-valid payload. A lenient
    // decoder (Buffer.from's default) silently drops it and still recovers the original valid JSON,
    // which is the fixture the existing row above cannot tell apart from real corruption.
    const b64 = encodeFormC(OK);
    const withInvalidChar = `${b64.slice(0, 2)}@${b64.slice(2)}`;
    expect(decodeFormC(withInvalidChar)).toEqual({ ok: false, reason: 'decode' });
  });
  test('validateInvokeArgv accepts the control argv and one ok pattern (§9 step 3)', () => {
    expect(validateInvokeArgv(OK, VM)).toBeNull();
    expect(validateInvokeArgv([...OK, '--testNamePattern=speaker labels'], VM)).toBeNull();
  });
  test('validateInvokeArgv compares argv[0] as a string: a differently spelled path is argv0 (§9 (b))', () => {
    expect(validateInvokeArgv([VM.toUpperCase(), ...OK.slice(1)], VM)).toBe('argv0');
  });
});

describe('§9 form C', () => {
  const OK = [VM, 'run', ...FIXED, 'lib/x.test.js'];
  test('encodeFormC output uses only [A-Za-z0-9+/=] and decodeFormC round-trips it', () => {
    const b64 = encodeFormC(OK);
    expect(b64).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(decodeFormC(b64)).toEqual({ ok: true, value: OK });
  });
  test('renderFormC prints & node <single-quoted path> <single-quoted payload> (§9)', () => {
    expect(renderFormC(OK, 'C:/repo/hello-world/scripts/regression/invoke.js')).toBe(
      `& node 'C:/repo/hello-world/scripts/regression/invoke.js' '${encodeFormC(OK)}'`,
    );
  });
  test.each(["'", '\u2018', '\u2019', '\u201A', '\u201B'])('renderFormC doubles the five single-quote characters and refuses ", \\ and the empty path (§9): %j is doubled', (q) => {
    expect(renderFormC(OK, `C:/a${q}b/invoke.js`)).toBe(`& node 'C:/a${q}${q}b/invoke.js' '${encodeFormC(OK)}'`);
  });
  test.each([['C:/a"b/invoke.js'], ['C:\\a\\invoke.js'], ['']])('renderFormC refuses the path %j (§9)', (p) => {
    expect(() => renderFormC(OK, p)).toThrow();
  });
  test('renderFormC never emits a double quote, --% or npx (T3-3b-8)', () => {
    const line = renderFormC(OK, 'C:/repo/invoke.js');
    expect(line.includes('"')).toBe(false);
    expect(line.includes('--%')).toBe(false);
    expect(/\bnpx\b/.test(line)).toBe(false);
  });
  test.each(SPANS.filter((s) => s.span.filters.length > 0))('render then validate: every fixture span\'s form-C payload validates (N-32): $name', ({ span }) => {
    const argv = caseArgv(span, VM);
    const line = renderFormC(argv, 'C:/repo/invoke.js');
    const payload = /'([A-Za-z0-9+/=]+)'$/.exec(line)[1];
    const decoded = decodeFormC(payload);
    expect(decoded.ok).toBe(true);
    expect(validateInvokeArgv(decoded.value, VM)).toBeNull();
  });
});

describe('§7 child environment', () => {
  test('vitestEnv: {VITEST, Path, node_options, TEST, NODE_ENV, vitest_pool_id} -> {Path} (§7.1 fixture)', () => {
    expect(vitestEnv({ VITEST: '1', Path: 'x', node_options: 'y', TEST: '1', NODE_ENV: 't', vitest_pool_id: '2' })).toEqual({ Path: 'x' });
  });
  test('vitestEnv returns a copy and keeps unrelated names (§7.1)', () => {
    const base = { Path: 'x', TEMP: 't', VITESTX: 'drop', MY_TEST: 'keep' };
    const out = vitestEnv(base);
    expect(out).toEqual({ Path: 'x', TEMP: 't', MY_TEST: 'keep' });
    expect(base.VITESTX).toBe('drop');
  });
  test('envNamesSha256 hashes upper-cased names sorted by code unit, joined by \\n (§7.2)', () => {
    expect(envNamesSha256({ path: '1', Temp: '2', A: '3' })).toBe(sha256('A\nPATH\nTEMP'));
  });
  test('envNamesSha256 ignores values: names only (§7.2, R2-8)', () => {
    expect(envNamesSha256({ A: 'one' })).toBe(envNamesSha256({ A: 'two' }));
  });
  test('envNamesSha256 sorts by code unit, not locale: "a_b" and "ab" differ in the two orders (§7.2, T3-C4b-12)', () => {
    const codeUnitOrder = ['AB', 'A_B'].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join('\n');
    expect(envNamesSha256({ a_b: 1, ab: 2 })).toBe(sha256(codeUnitOrder));
  });
});

describe('§1.3 recursionGuard pure rows', () => {
  const T = tmpdir();
  const fwd = (p) => p.replace(/\\/g, '/');
  test('recursionGuard: planted root -> proceed (§1.3 rule 4 pure rows)', () => {
    expect(recursionGuard({ vitestSet: true, toplevel: `${fwd(T)}/rt-t3-fixture-abc123`, tmpdir: T })).toBe('proceed');
  });
  test('recursionGuard: real root -> refuse (§1.3 rule 4 pure rows)', () => {
    expect(recursionGuard({ vitestSet: true, toplevel: fwd(REPO_ROOT), tmpdir: T })).toBe('refuse');
  });
  test('recursionGuard: rt-t3-fixture- outside tmpdir -> refuse (§1.3 rule 4 pure rows)', () => {
    expect(recursionGuard({ vitestSet: true, toplevel: 'D:/work/rt-t3-fixture-abc123', tmpdir: T })).toBe('refuse');
  });
  test('recursionGuard: VITEST unset -> proceed on the real root (§1.3 rule 2)', () => {
    expect(recursionGuard({ vitestSet: false, toplevel: fwd(REPO_ROOT), tmpdir: T })).toBe('proceed');
  });
  test('recursionGuard: a ".." segment below tmpdir that only string-prefix-matches it -> refuse (§1.3 rule 2, "inside tmpdir", T3-C4b-11)', () => {
    expect(recursionGuard({ vitestSet: true, toplevel: `${fwd(T)}/x/../../y/rt-t3-fixture-1`, tmpdir: T })).toBe('refuse');
  });
});
