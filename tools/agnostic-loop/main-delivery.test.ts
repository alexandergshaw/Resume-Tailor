import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyMainDelivery, finalizeHandoff } from '../main-delivery.mjs';

const roots: string[] = [];
function git(dir: string, ...args: string[]) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' } }).trim();
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'main-delivery-')); roots.push(root);
  const workspace = join(root, 'work'); const remote = join(root, 'remote.git');
  mkdirSync(workspace); git(workspace, 'init', '-b', 'main');
  git(workspace, 'config', 'user.name', 'Delivery Test'); git(workspace, 'config', 'user.email', 'delivery@example.invalid');
  writeFileSync(join(workspace, 'file.txt'), 'baseline\n');
  writeFileSync(join(workspace, '.gitignore'), 'ignored/\n');
  git(workspace, 'add', '.'); git(workspace, 'commit', '-m', 'baseline');
  git(root, 'init', '--bare', remote); git(workspace, 'remote', 'add', 'origin', remote);
  git(workspace, 'push', '-u', 'origin', 'main');
  const check = (options = {}) => verifyMainDelivery(workspace, { expectedOrigin: remote, ...options });
  return { root, workspace, remote, check };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('main delivery live Git oracle', () => {
  it('preserves index bytes when tracked file timestamps change without content changes', async () => {
    const f = fixture(); const tracked = join(f.workspace, 'file.txt');
    const previous = statSync(tracked); const later = new Date(previous.mtimeMs + 60000);
    utimesSync(tracked, previous.atime, later);
    expect(statSync(tracked).mtimeMs).not.toBe(previous.mtimeMs);
    // No status call between the touch and this snapshot: status itself can
    // refresh cached index stat information unless optional Git locks are off.
    const index = join(f.workspace, '.git', 'index'); const before = readFileSync(index);
    await expect(f.check()).resolves.toMatchObject({ ok: true });
    expect(readFileSync(index).equals(before)).toBe(true);
  });
  it('accepts matching clean main, ignores ignored output, and preserves repository state', async () => {
    const f = fixture(); mkdirSync(join(f.workspace, 'ignored')); writeFileSync(join(f.workspace, 'ignored', 'receipt'), 'local');
    const snapshot = () => JSON.stringify([git(f.workspace, 'rev-parse', 'HEAD'), git(f.workspace, 'status', '--porcelain=v1', '--untracked-files=all'), git(f.workspace, 'show-ref'), readFileSync(join(f.workspace, '.git', 'config'), 'utf8')]);
    const before = snapshot(); const result = await f.check();
    expect(result.ok).toBe(true); expect(result.commit).toBe(git(f.workspace, 'rev-parse', 'HEAD'));
    expect(result.remoteCommit).toBe(result.commit); expect(result.branch).toBe('main'); expect(result.remote).toBe('origin');
    expect(result.remoteUrl).toBe(f.remote); expect(Number.isNaN(Date.parse(result.observedAt))).toBe(false);
    expect(snapshot()).toBe(before);
  });
  it.each(['tracked', 'staged', 'untracked'])('rejects actual %s dirt and accepts recovery', async (kind) => {
    const f = fixture();
    if (kind === 'untracked') { mkdirSync(join(f.workspace, 'nested')); writeFileSync(join(f.workspace, 'nested', 'new.txt'), 'new'); }
    else { writeFileSync(join(f.workspace, 'file.txt'), 'changed'); if (kind === 'staged') git(f.workspace, 'add', 'file.txt'); }
    expect(git(f.workspace, 'status', '--porcelain=v1', '--untracked-files=all')).not.toBe('');
    await expect(f.check()).rejects.toThrow();
    if (kind === 'untracked') rmSync(join(f.workspace, 'nested'), { recursive: true });
    else { git(f.workspace, 'restore', '--staged', 'file.txt'); git(f.workspace, 'restore', 'file.txt'); }
    await expect(f.check()).resolves.toMatchObject({ ok: true });
  });
  it.each(['topic', 'detached'])('rejects %s branch state', async (kind) => {
    const f = fixture(); if (kind === 'topic') git(f.workspace, 'switch', '-c', 'topic'); else git(f.workspace, 'checkout', '--detach');
    expect(git(f.workspace, 'branch', '--show-current')).not.toBe('main');
    await expect(f.check()).rejects.toThrow();
  });
  it('rejects the production default for a fixture origin', async () => {
    const f = fixture(); await expect(verifyMainDelivery(f.workspace)).rejects.toThrow();
  });
  it.each(['missing', 'wrong', 'multiple-push', 'unavailable', 'missing-ref'])('rejects %s remote configuration/state', async (kind) => {
    const f = fixture();
    if (kind === 'missing') git(f.workspace, 'remote', 'remove', 'origin');
    if (kind === 'wrong') git(f.workspace, 'remote', 'set-url', 'origin', join(f.root, 'wrong.git'));
    if (kind === 'multiple-push') { git(f.workspace, 'remote', 'set-url', '--add', '--push', 'origin', f.remote); git(f.workspace, 'remote', 'set-url', '--add', '--push', 'origin', join(f.root, 'wrong.git')); }
    if (kind === 'unavailable') rmSync(f.remote, { recursive: true });
    if (kind === 'missing-ref') git(f.remote, 'update-ref', '-d', 'refs/heads/main');
    await expect(f.check()).rejects.toThrow();
  });
  it('rejects unpublished local commits', async () => {
    const f = fixture(); git(f.workspace, 'commit', '--allow-empty', '-m', 'unpublished');
    expect(git(f.workspace, 'rev-parse', 'HEAD')).not.toBe(git(f.remote, 'rev-parse', 'refs/heads/main'));
    await expect(f.check()).rejects.toThrow();
  });
  it('rejects live remote advance even when tracking ref still equals HEAD', async () => {
    const f = fixture(); const other = join(f.root, 'other'); git(f.root, 'clone', '-b', 'main', f.remote, other);
    git(other, 'config', 'user.name', 'Other'); git(other, 'config', 'user.email', 'other@example.invalid');
    git(other, 'commit', '--allow-empty', '-m', 'remote advance'); git(other, 'push', 'origin', 'main');
    expect(git(f.workspace, 'rev-parse', 'refs/remotes/origin/main')).toBe(git(f.workspace, 'rev-parse', 'HEAD'));
    expect(git(f.remote, 'rev-parse', 'refs/heads/main')).not.toBe(git(f.workspace, 'rev-parse', 'HEAD'));
    await expect(f.check()).rejects.toThrow();
  });
  it('rejects HEAD changing while live remote is queried', async () => {
    const f = fixture(); const before = git(f.workspace, 'rev-parse', 'HEAD'); let changed = false;
    const instrument = (args: string[], workspace: string) => {
      const output = git(workspace, ...args);
      if (args.includes('ls-remote')) { git(f.workspace, 'commit', '--allow-empty', '-m', 'during check'); changed = true; }
      return output;
    };
    await expect(f.check({ git: instrument })).rejects.toThrow();
    expect(changed).toBe(true); expect(git(f.workspace, 'rev-parse', 'HEAD')).not.toBe(before);
  });
  it.each(['equality', 'cleanliness', 'ending'])('detects isolated %s-check mutation', async (kind) => {
    const f = fixture(); const source = readFileSync(fileURLToPath(new URL('../main-delivery.mjs', import.meta.url)), 'utf8');
    const needle = kind === 'equality' ? 'if (match[1] !== before.commit)' : kind === 'cleanliness' ? 'if (state.status.length)' : 'if (JSON.stringify(before) !== JSON.stringify(after))';
    expect(source.includes(needle)).toBe(true);
    const mutated = source.replace(needle, 'if (false)'); expect(mutated).not.toBe(source);
    const path = join(f.root, `mutant-${kind}.mjs`); writeFileSync(path, mutated);
    expect(readFileSync(path, 'utf8')).toBe(mutated);
    const mutant = await import(pathToFileURL(path).href);
    const options: any = { expectedOrigin: f.remote };
    if (kind === 'equality') git(f.workspace, 'commit', '--allow-empty', '-m', 'unpublished');
    if (kind === 'cleanliness') { writeFileSync(join(f.workspace, 'file.txt'), 'dirty'); expect(git(f.workspace, 'status', '--porcelain')).not.toBe(''); }
    if (kind === 'ending') options.git = (args: string[], workspace: string) => { const out = git(workspace, ...args); if (args.includes('ls-remote')) git(f.workspace, 'commit', '--allow-empty', '-m', 'drift'); return out; };
    // The normal negative oracle would require rejection; the altered guard now
    // accepts the deliberately invalid fixture, proving that oracle detects it.
    await expect(mutant.verifyMainDelivery(f.workspace, options)).resolves.toMatchObject({ ok: true });
    expect(readFileSync(fileURLToPath(new URL('../main-delivery.mjs', import.meta.url)), 'utf8')).toBe(source);
  });
});

describe('repository handoff composition', () => {
  it('never calls remote verifier for locally incomplete reports', async () => {
    let calls = 0; const result = await finalizeHandoff({ complete: false, item: 'example' }, async () => { calls++; throw new Error('must skip'); });
    expect(calls).toBe(0); expect(result).toMatchObject({ complete: false, localComplete: false, item: 'example', repositoryDelivery: { ok: false, skipped: true } });
  });
  it('fails overall completion when remote verification throws', async () => {
    const result = await finalizeHandoff({ complete: true }, async () => { throw new Error('remote mismatch'); });
    expect(result).toMatchObject({ complete: false, localComplete: true, repositoryDelivery: { ok: false } });
    expect(result.repositoryDelivery.error).toContain('remote mismatch');
  });
  it('completes only with both local and repository acceptance', async () => {
    const result = await finalizeHandoff({ complete: true, item: 'example' }, async () => ({ ok: true, commit: 'observed' }));
    expect(result).toMatchObject({ complete: true, localComplete: true, item: 'example', repositoryDelivery: { ok: true, commit: 'observed' } });
  });
});
