// Lane A IO primitives (design §2, §3, §7.3, §10.3). The one seam between lane A's pure logic and the
// filesystem/process world: walks, git, hashing, the vitest spawn, exclusive/in-place writers, the lock's
// own deletion and takeover calls, and the record base.
import * as fs from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUN_ID_RE, recordBaseName, vitestEnv } from './launchPolicy.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// §1 walks: readdirSync withFileTypes, descend only where isDirectory() is true.
export function walkFiles(dir, base = dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of entries) {
    const p = join(dir, d.name);
    if (d.isDirectory()) walkFiles(p, base, out);
    else if (d.isFile()) out.push(p);
  }
  return out;
}

// The corpus walk: direct children of docs/regression whose Dirent.isFile() is true and name ends .md.
export function corpusFiles(root) {
  const dir = join(root, 'docs', 'regression');
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((d) => d.isFile() && d.name.endsWith('.md')).map((d) => d.name).sort();
}

// git(args): argv array, always --no-optional-locks. Never a throw: status/stdout carry the outcome.
export function git(args, opts = {}) {
  try {
    const stdout = execFileSync('git', ['--no-optional-locks', ...args], {
      cwd: opts.cwd, input: opts.input, encoding: 'buffer', windowsHide: true, maxBuffer: 64 * 1024 * 1024,
    });
    return { status: 0, stdout };
  } catch (err) {
    if (err.status !== undefined && err.status !== null) return { status: err.status, stdout: err.stdout || Buffer.alloc(0) };
    return { status: null, stdout: Buffer.alloc(0), error: err };
  }
}

// §2.1: the lock hash input, from THIS file's own directory (a planted copy resolves to its own root).
export function toplevel() {
  const r = git(['-C', HERE, 'rev-parse', '--show-toplevel']);
  if (r.status !== 0) return null;
  return r.stdout.toString('utf8').split('\n')[0].trim();
}

export function sha256File(path) {
  return createHash('sha256').update(fs.readFileSync(path)).digest('hex');
}

export function sha256Normalised(path) {
  const text = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function readVitestVersion(vitestMjsPath) {
  try {
    const pkg = join(dirname(vitestMjsPath), 'package.json');
    const parsed = JSON.parse(fs.readFileSync(pkg, 'utf8'));
    return typeof parsed.version === 'string' ? parsed.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

export function vitestMjsPath() {
  return join(HERE, '..', '..', 'node_modules', 'vitest', 'vitest.mjs');
}

export function recordBase() {
  return join(tmpdir(), recordBaseName);
}

// §7.3: never a pipe, never spawnSync with captured output. The fds are opened wx and closed after exit.
export function spawnVitest(argv, { cwd, stdoutPath, stderrPath, env = vitestEnv(process.env) }) {
  return new Promise((resolve) => {
    const outFd = fs.openSync(stdoutPath, 'wx');
    const errFd = fs.openSync(stderrPath, 'wx');
    const close = () => {
      try { fs.closeSync(outFd); } catch { /* already closed */ }
      try { fs.closeSync(errFd); } catch { /* already closed */ }
    };
    let child;
    try {
      child = spawn(process.execPath, argv, { cwd, env, stdio: ['ignore', outFd, errFd], detached: false, windowsHide: true });
    } catch (err) {
      close();
      resolve({ status: null, signal: null, spawnError: err.code || String(err) });
      return;
    }
    child.on('error', (err) => {
      close();
      resolve({ status: null, signal: null, spawnError: err.code || String(err) });
    });
    child.on('exit', (status, signal) => {
      close();
      resolve({ status, signal, spawnError: null });
    });
  });
}

export function createExclusive(path, text, deps = fs) {
  deps.writeFileSync(path, text, { flag: 'wx' });
}

// S-2: the runner's first write. A missing file refuses and creates nothing.
export function appendExisting(path, text, deps = fs) {
  const fd = deps.openSync(path, 'r+');
  try {
    const size = deps.fstatSync(fd).size;
    const buf = Buffer.from(text, 'utf8');
    deps.writeSync(fd, buf, 0, buf.length, size);
  } finally {
    deps.closeSync(fd);
  }
}

// The lock's in-place rewrite: same length every time, so this never truncates the file short.
export function rewriteInPlace(path, text, deps = fs) {
  const fd = deps.openSync(path, 'r+');
  try {
    const buf = Buffer.from(text, 'utf8');
    deps.writeSync(fd, buf, 0, buf.length, 0);
    if (deps.fsyncSync) deps.fsyncSync(fd);
  } finally {
    deps.closeSync(fd);
  }
}

export function readLockText(path, deps = fs) {
  try {
    return { state: 'present', text: deps.readFileSync(path, 'utf8') };
  } catch (err) {
    if (err.code === 'ENOENT') return { state: 'absent' };
    throw err;
  }
}

const COMPANION_RE = /^[0-9a-f]{32}\.(launcher\.out\.txt|launcher\.err\.txt|prior-lock\.txt)$/;

export function deleteRunDir(base, name, deps = fs) {
  if (!RUN_ID_RE.test(name)) throw new Error('deleteRunDir: bad name');
  const dir = join(base, name);
  const st = deps.lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('deleteRunDir: not a plain directory');
  deps.rmSync(dir, { recursive: true });
}

export function deleteCompanion(base, name, deps = fs) {
  if (!COMPANION_RE.test(name)) throw new Error('deleteCompanion: bad name');
  deps.unlinkSync(join(base, name));
}

export function releaseOwnLock(lockPath, runId, parseLock, deps = fs) {
  const read = readLockText(lockPath, deps);
  if (read.state !== 'present') return;
  const parsed = parseLock(read.text);
  if (parsed.ok && parsed.lock.runId === runId) deps.unlinkSync(lockPath);
}

export function takeOverLock(lockPath, staleBytes, priorLockPath, deps = fs) {
  const read = readLockText(lockPath, deps);
  if (read.state !== 'present' || read.text !== staleBytes) return { ok: false };
  deps.renameSync(lockPath, priorLockPath);
  return { ok: true };
}

export function killTree(pid) {
  return new Promise((resolve) => {
    let r;
    try {
      r = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } catch {
      resolve({ ok: false, code: null });
      return;
    }
    r.on('exit', (code) => resolve({ ok: code === 0, code }));
    r.on('error', () => resolve({ ok: false, code: null }));
  });
}
