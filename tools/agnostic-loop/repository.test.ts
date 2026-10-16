import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { selectRepositoryItem } from './repository-backlog';
import { repositoryPolicy, writeDispatchTemplate } from './dispatch-example';
import { loadDispatchSelection } from './dispatch-cli';

const verify = 'node --version';
const item = (overrides = {}) => ({
  id: 'N999', state: 'actionable', title: 'Bounded local work', owed_by: 'coordinator',
  owns: ['hello-world/lib/example.js'], verify,
  verify_proof: { command_sha256: createHash('sha256').update(verify).digest('hex'), fails_on_head_exit: 1, passes_on_fix_exit: 0, kills_on_revert_exit: 1, survives_noop_exit: 0, proved_at: '2026-10-16', proved_by: 'fixture' },
  blocked_by: [], ...overrides,
});
const yaml = (rows: ReturnType<typeof item>[]) => rows.map(row => Object.entries(row).map(([key, value], i) => `${i ? '  ' : '- '}${key}: ${JSON.stringify(value)}`).join('\n')).join('\n');

describe('Resume-Tailor repository intake', () => {
  it('uses the existing double-quoted YAML grammar and selects only an explicit ID', () => {
    const text = yaml([item({ id: 'N998', title: 'Earlier priority' }), item()]);
    expect(selectRepositoryItem(text, 'N999')).toEqual({ id: 'N999', objective: 'Bounded local work', owns: ['hello-world/lib/example.js'], verify, requirements: ['N999-request'] });
    expect(() => selectRepositoryItem(text, 'N997')).toThrow('not found');
  });
  it.each([
    [{ blocked_by: ['N123456'] }, 'dependencies remain'],
    [{ title: '**SHIPPED** historical record' }, 'already shipped'],
    [{ owns: null, verify: null, verify_proof: null }, 'unscoped'],
    [{ owns: ['hello-world/**/*.js'] }, 'exact paths'],
    [{ owns: ['../escape'] }, 'traversal'],
    [{ blocked_by: null }, 'must be an array'],
  ])('rejects unsafe or noneligible intake %j', (patch, expected) => {
    expect(() => selectRepositoryItem(yaml([item(patch)]), 'N999')).toThrow(expected as string);
  });
  it('honors existing proof checks instead of treating a populated object as proof', () => {
    const good = item();
    for (const proof of [{ ...good.verify_proof, command_sha256: 'stale' }, { ...good.verify_proof, kills_on_revert_exit: 0 }]) {
      expect(() => selectRepositoryItem(yaml([item({ verify_proof: proof })]), 'N999')).toThrow('Backlog contract');
    }
    expect(() => selectRepositoryItem(yaml([good, good]), 'N999')).toThrow('Backlog contract');
  });
  it('rejects duplicate fields instead of overwriting blockers, scope or identity', () => {
    const text = yaml([item({ blocked_by: ['N1'] })]);
    for (const field of ['  blocked_by: []', '  id: "N1"', '  owns: []', '  verify_proof: null']) {
      expect(() => selectRepositoryItem(`${text}\n${field}`, 'N999')).toThrow('Duplicate backlog field');
    }
    for (const separator of ['\u2028', '\u2029']) {
      const hidden = yaml([item({ blocked_by: [`N1${separator}`] })]);
      expect(() => selectRepositoryItem(`${hidden}\n  blocked_by: []`, 'N999')).toThrow('Duplicate backlog field');
    }
  });
  it.each([['D999', 'owner', { blocked_reason: 'Need owner' }], ['V999', 'verification', { instrument: 'Live instrument' }]])('rejects %s rows', (id, state, extra) => {
    expect(() => selectRepositoryItem(yaml([item({ id, state, ...extra })]), id as string)).toThrow('owner action');
  });
  it('reads the real backlog without mutating it and does not revive shipped rows', async () => {
    const file = path.resolve('docs/backlog.yml');
    const before = await readFile(file);
    await expect(loadDispatchSelection(file, 'N999999', 'backlog')).rejects.toThrow('not found');
    expect(await readFile(file)).toEqual(before);
  });
});

describe('repository execution policy', () => {
  it('registers real local gates with explicit arguments and workspace locks', async () => {
    const policy = repositoryPolicy(process.cwd(), 'operator', Date.now());
    expect(Object.keys(policy.gates)).toEqual(['verification', 'regression', 'engine', 'lint', 'build', 'backlog']);
    expect(policy.gates).not.toHaveProperty('typecheck');
    for (const gate of Object.values(policy.gates)) {
      expect(gate.executable).toBe(process.execPath);
      expect(gate.resources).toEqual(['workspace']);
      expect(gate.args[0]).toBe(path.resolve('tools/repository-gate.mjs'));
      await expect(readFile(gate.args[0])).resolves.toBeDefined();
    }
    expect(policy.candidateExclusions).toContain('hello-world/node_modules');
    expect(policy.candidateExclusions).not.toContain('hello-world/scripts');
    expect(policy.candidateExclusions).not.toContain('hello-world/lib');
  });
  it('generates disabled, unqualified providers without configure or delivery authority', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'resume-loop-template-'));
    try {
      await writeDispatchTemplate(directory, process.cwd(), { executable: process.execPath, model: 'owner-selected', kind: 'command', owner: 'operator', repository: true });
      const config = JSON.parse(await readFile(path.join(directory, 'routing.json'), 'utf8'));
      expect(config.providers.every((p: { enabled: boolean }) => !p.enabled)).toBe(true);
      expect(config.targets.every((p: { enabled: boolean }) => !p.enabled)).toBe(true);
      expect(config.qualifications).toEqual([]);
      expect(config.grant).toMatchObject({ allowConfigure: false, allowLocalDelivery: false });
      expect(config.grant.pathPrefixes).toContain('hello-world');
      expect(config.grant.pathPrefixes).not.toContain('src');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('root launcher returns structured failure for malformed input; gate rejects unknown names', () => {
    try { execFileSync(process.execPath, ['tools/loop.mjs', 'not-a-command'], { encoding: 'utf8', windowsHide: true }); throw new Error('Unexpected success'); }
    catch (error) { expect(JSON.parse((error as { stdout: string }).stdout).ok).toBe(false); }
    for (const name of ['untrusted-command', 'constructor', 'toString', '__proto__']) {
      const result = spawnSync(process.execPath, ['tools/repository-gate.mjs', name], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Expected one registered repository gate');
      expect(result.stdout).toBe('');
    }
  });
});
