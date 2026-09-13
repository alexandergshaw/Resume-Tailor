// Test-only IO module (design M-18, §11.5, §10.3): builds planted repositories under
// the OS temp dir for T3's spawning tests and for the orchestrator's 4b hand-off.
// It has no CLI and no invokedDirectly(): importing it runs nothing.
//
// Why a planted root at all: bucket b IS the whole suite, so a test that ran an
// in-tree entry against the real tree would re-enter the suite without bound
// (design §1.3). Every spawn target a test uses comes from the root returned here.
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const REAL_NODE_MODULES = join(REPO_ROOT, 'hello-world', 'node_modules');
const REAL_VITEST_MJS = join(REAL_NODE_MODULES, 'vitest', 'vitest.mjs');
const FIXTURES = join(HERE, 'fixtures');

export const PLANTED_PREFIX = 'rt-t3-fixture-';
export const CORPORA = Object.freeze(['mini', 'planted-red']);

// §1 walks: readdirSync withFileTypes, descend only where isDirectory() is true.
// A junction reports isDirectory() === false, so the walk never follows one.
function walkFiles(dir, base = dir, out = []) {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) walkFiles(p, base, out);
    else if (d.isFile()) out.push(relative(base, p));
  }
  return out.sort();
}

function copyInto(src, dst) {
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
}

function isInside(parent, child) {
  const r = relative(parent, child);
  return r === '' || (!r.startsWith('..') && !isAbsolute(r));
}

// Positive evidence only: inside the OS temp dir AND under a segment that
// begins with the fixture prefix. The real repository fails this by construction.
export function isPlantedRoot(p) {
  const abs = resolve(p);
  const base = resolve(tmpdir());
  if (!isInside(base, abs) || abs === base) return false;
  return relative(base, abs).split(sep).some((seg) => seg.startsWith(PLANTED_PREFIX));
}

const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.\/[^'"]+)['"]/g;

// The named entries plus every ./ module they import, transitively.
function entryClosure(sourceDir, entries) {
  const seen = new Set();
  const queue = entries.map((e) => (e.endsWith('.js') ? e : `${e}.js`));
  while (queue.length > 0) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    if (name.includes('/') || name.includes('\\')) throw new Error(`plantedRepo: entry ${name} is not a direct child`);
    seen.add(name);
    const text = readFileSync(join(sourceDir, name), 'utf8');
    for (const m of text.matchAll(IMPORT_RE)) queue.push(m[1].slice(2));
  }
  return [...seen].sort();
}

function git(root, args) {
  execFileSync(
    'git',
    [
      '-c', 'core.autocrlf=false',
      '-c', 'core.safecrlf=false',
      '-c', 'user.name=t3-fixture',
      '-c', 'user.email=t3-fixture@invalid',
      '-c', 'commit.gpgsign=false',
      ...args,
    ],
    { cwd: root, stdio: 'ignore', windowsHide: true },
  );
}

function checkRel(rel) {
  const parts = rel.split(/[\\/]/);
  if (rel === '' || isAbsolute(rel) || parts.includes('..') || /^[A-Za-z]:/.test(rel)) {
    throw new Error(`plantedRepo: files key ${JSON.stringify(rel)} must be a plain relative path`);
  }
}

/**
 * Build one planted root, laid out exactly as design §11.5:
 *   <root>/docs/REGRESSION.md, <root>/docs/regression/*  (ONE corpus: 'mini' OR 'planted-red')
 *   <root>/scripts/regression-integrity.sh               (byte copy of the repository's script)
 *   <root>/hello-world/                                  (vitest's cwd)
 *   <root>/hello-world/node_modules                      (junction; unless corpusOnly)
 *   <root>/hello-world/scripts/regression/               (entries + ./ imports + package.json from sourceDir; unless corpusOnly)
 *   <root>/hello-world/<rel>                             ('planted-red' only: the test bodies, .txt suffix dropped)
 * `files` ({ '<path relative to root>': string | Buffer }) adds planted sources (stubs, test bodies)
 * before the single commit, so they are tracked.
 * Every validation runs before anything is written.
 */
export function materializePlantedRepo(opts = {}) {
  const { entries = [], corpusOnly = false, corpus = 'mini', sourceDir = HERE, files = {} } = opts;
  if (!CORPORA.includes(corpus)) throw new Error(`plantedRepo: unknown corpus ${JSON.stringify(corpus)}`);
  if (corpusOnly && corpus !== 'mini') throw new Error('plantedRepo: corpusOnly is legal only with the mini corpus');
  if (!Array.isArray(entries)) throw new Error('plantedRepo: entries must be an array');
  const src = resolve(sourceDir);
  if (src !== HERE && isInside(REPO_ROOT, src)) {
    throw new Error('plantedRepo: a sourceDir inside the repository other than the builder directory is refused');
  }
  for (const rel of Object.keys(files)) checkRel(rel);
  const closure = corpusOnly ? [] : entryClosure(src, entries);

  const root = mkdtempSync(join(tmpdir(), PLANTED_PREFIX));
  copyInto(join(REPO_ROOT, 'scripts', 'regression-integrity.sh'), join(root, 'scripts', 'regression-integrity.sh'));
  if (corpus === 'mini') {
    copyInto(join(FIXTURES, 'planted-corpus', 'REGRESSION.md'), join(root, 'docs', 'REGRESSION.md'));
    const reg = join(FIXTURES, 'planted-corpus', 'regression');
    for (const rel of walkFiles(reg)) copyInto(join(reg, rel), join(root, 'docs', 'regression', rel));
  } else {
    const red = join(FIXTURES, 'planted-red');
    copyInto(join(red, 'docs', 'REGRESSION.md'), join(root, 'docs', 'REGRESSION.md'));
    const reg = join(red, 'docs', 'regression');
    for (const rel of walkFiles(reg)) copyInto(join(reg, rel), join(root, 'docs', 'regression', rel));
    const bodies = join(red, 'hello-world');
    for (const rel of walkFiles(bodies)) {
      if (!rel.endsWith('.txt')) throw new Error(`plantedRepo: planted-red body ${rel} lacks the .txt suffix`);
      copyInto(join(bodies, rel), join(root, 'hello-world', rel.slice(0, -'.txt'.length)));
    }
  }
  // §11.5: a corpusOnly root holds only the index, the corpus and the script copy;
  // not even an empty hello-world/ (the parity describe must see nothing else).
  if (corpusOnly) return { root, helloWorld: null, entryDir: null };
  mkdirSync(join(root, 'hello-world'), { recursive: true });

  const entryDir = join(root, 'hello-world', 'scripts', 'regression');
  copyInto(join(src, 'package.json'), join(entryDir, 'package.json'));
  for (const name of closure) copyInto(join(src, name), join(entryDir, name));
  for (const [rel, bytes] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, bytes);
  }
  git(root, ['init', '-q']);
  mkdirSync(join(root, '.git', 'info'), { recursive: true });
  writeFileSync(join(root, '.git', 'info', 'exclude'), 'hello-world/node_modules\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'planted']);
  symlinkSync(REAL_NODE_MODULES, join(root, 'hello-world', 'node_modules'), 'junction');
  return { root, helloWorld: join(root, 'hello-world'), entryDir };
}

/**
 * Remove a planted root: the node_modules junction first (only after lstat says it is
 * a link), then the root; then assert the real vitest.mjs survived. Refuses anything
 * that is not a planted root (design §10.3 row).
 */
export function removePlantedRepo(root) {
  const abs = resolve(root);
  if (!isPlantedRoot(abs)) throw new Error(`plantedRepo: refusing to remove ${abs}: not a planted root`);
  const jn = join(abs, 'hello-world', 'node_modules');
  let isLink = false;
  try {
    isLink = lstatSync(jn).isSymbolicLink();
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (isLink) unlinkSync(jn);
  rmSync(abs, { recursive: true, force: true });
  if (!existsSync(REAL_VITEST_MJS)) throw new Error('plantedRepo: the real vitest.mjs is missing after removal');
  return { removed: abs };
}
