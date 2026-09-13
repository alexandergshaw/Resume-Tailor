// Lane A shared policy constants and pure helpers (design §1.3, §3.1, §4.2, §7.1, §7.2, §10.2).
import { createHash, randomBytes } from 'node:crypto';
import { win32 } from 'node:path';

// §3.1: every timing constant, frozen. Overridable only through deps.timing in tests.
export const TIMING = Object.freeze({
  HEARTBEAT_S: 5,
  STALE_S: 60,
  SECOND_READ_S: 15,
  OVERDUE_RECHECK_S: 30,
  VERIFY_S: 2,
  LOCK_READ_TRIES: 3,
  LOCK_READ_GAP_S: 1,
  HEARTBEAT_FAILS: 3,
  TIMEOUT_S: 1800,
  GRACE_S: 60,
  KILL_WAIT_S: 30,
  FIRST_READ_S: 15,
  POLL_S: 590,
  ISOLATED_TIMEOUT_S: 300,
  ORACLE_TIMEOUT_S: 1800,
});

export const KEEP_RUNS = 10;
export const recordBaseName = 'resume-tailor-regression';

// §4.2: the one run-ID grammar, everywhere.
export const RUN_ID_RE = /^[0-9a-f]{32}$/;

// A-13: exit codes. None equals a node runtime code (1, 3-7, 9-14, > 128).
export const EXIT_CODES = Object.freeze({
  clean: 0,
  dirty: 20,
  inconclusive: 21,
  selfTest: 22,
});

export function newRunId() {
  return randomBytes(16).toString('hex');
}

const CHILD_ENV_DENYLIST_RE = /^(VITEST.*|TEST|NODE_ENV|NODE_OPTIONS)$/i;

// §7.1: ONE constant, three spawn sites. A copy (not an import) also lives in the step-10 ORACLE script.
export function vitestEnv(base) {
  const out = {};
  for (const [k, v] of Object.entries(base)) {
    if (!CHILD_ENV_DENYLIST_RE.test(k)) out[k] = v;
  }
  return out;
}

// §7.2: names only, never values (R2-8).
export function envNamesSha256(env) {
  const names = Object.keys(env).map((k) => k.toUpperCase()).sort();
  return createHash('sha256').update(names.join('\n'), 'utf8').digest('hex');
}

// §10.2: pure selection. `list` items: {name, isDirectory, isReparsePoint, finished, birthtimeMs}.
export function selectForRetention(list, { lockedIds = [], currentId } = {}) {
  const eligible = list.filter((e) => RUN_ID_RE.test(e.name)
    && e.isDirectory
    && !e.isReparsePoint
    && e.finished
    && e.name !== currentId
    && !lockedIds.includes(e.name));
  const sorted = [...eligible].sort((a, b) => a.birthtimeMs - b.birthtimeMs || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (sorted.length <= KEEP_RUNS) return [];
  return sorted.slice(0, sorted.length - KEEP_RUNS).map((e) => e.name);
}

// Resolve `.`/`..` segments before the string comparison below, or a toplevel that only
// string-prefix-matches tmpdir (e.g. "<tmpdir>/x/../../y/rt-t3-fixture-1", which escapes tmpdir
// once "x/.." and the following ".." are applied) would read as inside it. win32.normalize
// collapses those segments without touching process.cwd() for an already-absolute path.
function isPlantedRoot(toplevel, tmpdir) {
  const norm = (p) => win32.normalize(p).replace(/\\/g, '/').replace(/\/+$/, '');
  const base = norm(tmpdir);
  const t = norm(toplevel);
  if (t !== base && !t.startsWith(`${base}/`)) return false;
  const rel = t === base ? '' : t.slice(base.length + 1);
  return rel.split('/').some((seg) => seg.startsWith('rt-t3-fixture-'));
}

// §1.3 rule 2: the recursion-guard backstop. A planted root means: inside tmpdir, with a path
// segment beginning rt-t3-fixture-. The real repository fails this by construction.
export function recursionGuard({ vitestSet, toplevel, tmpdir }) {
  if (!vitestSet) return 'proceed';
  return isPlantedRoot(toplevel, tmpdir) ? 'proceed' : 'refuse';
}
