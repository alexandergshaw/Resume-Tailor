import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const EXPECTED_ORIGIN = 'https://github.com/alexandergshaw/Resume-Tailor.git';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function defaultGit(args, workspace) {
  return execFileSync('git', ['-C', workspace, ...args], {
    encoding: 'utf8', timeout: 30000, maxBuffer: 1048576,
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
  });
}

/** A live observation, never a push, fetch, cached-receipt check or Git mutation.
 * The production CLI fixes workspace/destination; injection is for offline tests.
 */
export async function verifyMainDelivery(workspace = root, { expectedOrigin = EXPECTED_ORIGIN, git = defaultGit } = {}) {
  const run = args => git(args, workspace);
  const snapshot = () => ({
    branch: run(['symbolic-ref', '--quiet', '--short', 'HEAD']).trim(),
    commit: run(['rev-parse', '--verify', 'HEAD']).trim(),
    status: run(['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    fetchUrl: run(['remote', 'get-url', 'origin']).trim(),
    pushUrls: run(['remote', 'get-url', '--push', '--all', 'origin']).trim().split(/\r?\n/),
  });
  const assertSnapshot = state => {
    if (state.branch !== 'main') throw new Error('Delivery requires attached branch main');
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(state.commit)) throw new Error('Cannot establish local commit identity');
    if (state.status.length) throw new Error('Delivery incomplete: tracked, staged or nonignored untracked changes remain');
    if (state.fetchUrl !== expectedOrigin || state.pushUrls.length !== 1 || state.pushUrls[0] !== expectedOrigin) throw new Error('Delivery origin fetch/push destination differs from the intended single remote');
  };
  const before = snapshot();
  assertSnapshot(before);
  const answer = run(['ls-remote', '--exit-code', 'origin', 'refs/heads/main']).trim();
  const match = /^([a-f0-9]{40}|[a-f0-9]{64})\trefs\/heads\/main$/.exec(answer);
  if (!match) throw new Error('Live origin/main observation is missing or ambiguous');
  if (match[1] !== before.commit) throw new Error('Delivery incomplete: live origin/main differs from local HEAD; push main and verify again');
  const after = snapshot();
  assertSnapshot(after);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Delivery changed during remote verification; rerun after reconciling HEAD, branch, worktree and destinations');
  return { ok: true, commit: before.commit, remote: 'origin', branch: 'main', remoteCommit: match[1], remoteUrl: expectedOrigin, observedAt: new Date().toISOString() };
}

export async function finalizeHandoff(localReport, verifier = verifyMainDelivery) {
  const localComplete = localReport?.complete === true;
  let repositoryDelivery = { ok: false, skipped: true, reason: 'Local engine completion is pending' };
  if (localComplete) {
    try { repositoryDelivery = await verifier(); }
    catch (error) { repositoryDelivery = { ok: false, error: error instanceof Error ? error.message : 'Remote delivery unproven' }; }
  }
  return { ...localReport, localComplete, repositoryDelivery, complete: localComplete && repositoryDelivery?.ok === true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (async () => {
    if (process.argv.length !== 2) throw new Error('Usage: node tools/main-delivery.mjs (fixed workspace and origin/main)');
    return verifyMainDelivery();
  })().then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => {
    process.stdout.write(`${JSON.stringify({ ok: false, complete: false, error: error instanceof Error ? error.message : 'Delivery unproven', action: 'Commit scoped verified work on main, push origin/main normally, then rerun the live delivery check' })}\n`);
    process.exitCode = 1;
  });
}
