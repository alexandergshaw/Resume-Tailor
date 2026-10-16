import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { captureCandidate, commandEnvironment } from './candidate';
import type { Policy } from './types';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); delete process.env.AGNOSTIC_TEST_SECRET; });
async function fixture(): Promise<Policy> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agnostic-candidate-')); roots.push(root);
  return { owner: 'owner', workspace: root, allowedActions: ['write', 'run'], candidateExclusions: ['excluded'], environmentKeys: ['AGNOSTIC_TEST_SECRET'], externalFiles: [], gates: { test: { executable: process.execPath, args: ['-e','process.exit(0)'], resources: ['workspace'] } }, concurrency: 3, deadline: Date.now()+60_000, maxAssignments: 10, commandTimeout: 5000 };
}
describe('real candidate identity', () => {
  it('invalidates dirty configuration and digests environment without retaining plaintext', async () => {
    const policy = await fixture(); await writeFile(path.join(policy.workspace,'config.json'), '{}');
    const before = await captureCandidate(policy);
    await writeFile(path.join(policy.workspace,'config.json'), '{"new":true}');
    expect((await captureCandidate(policy)).digest).not.toBe(before.digest);
    process.env.AGNOSTIC_TEST_SECRET = 'sentinel-value-never-in-record';
    const environment = await captureCandidate(policy);
    expect(environment.environmentHash).not.toBe(before.environmentHash);
    expect(JSON.stringify(environment)).not.toContain('sentinel-value-never-in-record');
  });
  it('excludes explicitly declared records but rejects traversal exclusions', async () => {
    const policy = await fixture(); const before = await captureCandidate(policy);
    await mkdir(path.join(policy.workspace,'excluded')); await writeFile(path.join(policy.workspace,'excluded','record'), 'data');
    expect((await captureCandidate(policy)).digest).toBe(before.digest);
    await expect(captureCandidate({ ...policy, candidateExclusions: ['../escape'] })).rejects.toThrow('traversal');
  });
  it('fails closed on a real reserved root filename rather than omitting its bytes', async () => {
    const policy = await fixture();
    await writeFile(path.join(policy.workspace, '__proto__'), 'must not disappear from candidate');
    await expect(captureCandidate(policy)).rejects.toThrow('Unsafe candidate or environment dictionary key');
    await expect(captureCandidate({ ...policy, environmentKeys: ['__proto__'] })).rejects.toThrow('dictionary key');
  });
  it('does not inherit configured environment values from object prototypes', async () => {
    const policy = await fixture();
    expect(Object.hasOwn(process.env, 'toString')).toBe(false);
    expect(Object.hasOwn(commandEnvironment({ ...policy, environmentKeys: ['toString'] }), 'toString')).toBe(false);
    expect(() => commandEnvironment({ ...policy, environmentKeys: ['constructor'] })).toThrow('dictionary key');
  });
});
