import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AtomicFileOperations } from './atomic-file';
import type { Policy } from './types';

const observation = vi.hoisted(() => ({ blocked: undefined as undefined | ((error: NodeJS.ErrnoException) => void) }));
vi.mock('./atomic-file', async importOriginal => {
  const actual = await importOriginal<typeof import('./atomic-file')>();
  return { ...actual, atomicFile: (temporary: string, destination: string, bytes: string) => actual.atomicFile(temporary, destination, bytes, {
    rename: async (source, target) => {
      try { await rename(source, target); }
      catch (error) { observation.blocked?.(error as NodeJS.ErrnoException); throw error; }
    },
  } satisfies Partial<AtomicFileOperations>) };
});
import { LoopStore } from './store';
import { atomicJson } from './dispatch-store';
const roots: string[] = [];
afterEach(async () => { observation.blocked = undefined; for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(kind: 'store' | 'dispatch') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'atomic-reader-')); roots.push(root);
  const workspace = path.join(root, 'workspace'); await mkdir(workspace);
  const store = new LoopStore(path.join(root, 'state'));
  const policy: Policy = { owner:'owner', workspace, allowedActions:['write'], candidateExclusions:[], environmentKeys:[], externalFiles:[], gates:{}, concurrency:3, deadline:Date.now()+60_000, maxAssignments:10, commandTimeout:5000 };
  const state = await store.init(policy);
  const filename = path.join(store.directory, kind === 'store' ? 'state.json' : 'dispatch-journal.json');
  if (kind === 'dispatch') await atomicJson(filename, { revision: 0 });
  return { store, filename, publish: () => kind === 'store' ? store.locked(() => store.save({ ...state, revision: 1 })) : atomicJson(filename, { revision: 1 }) };
}
const windows = process.platform === 'win32' ? describe : describe.skip;
windows('real Windows read-handle replacement contention', () => {
  for (const kind of ['store', 'dispatch'] as const) {
    it(`${kind} publishes after observed refusal and reader release`, async () => {
      const f = await fixture(kind); const old = await readFile(f.filename, 'utf8');
      const reader = await open(f.filename, 'r');
      let pending: Promise<void> | undefined;
      try {
        const blocked = new Promise<NodeJS.ErrnoException>(resolve => { observation.blocked = resolve; });
        pending = f.publish(); const settled = pending.then(() => null, error => error);
        const error = await blocked; expect(['EPERM', 'EACCES']).toContain(error.code);
        expect(await readFile(f.filename, 'utf8')).toBe(old);
        expect(await reader.readFile('utf8')).toBe(old);
        if (kind === 'store') await expect(new LoopStore(f.store.directory).locked(async () => 1)).rejects.toThrow('Store locked');
        await reader.close(); await pending; expect(await settled).toBeNull();
        expect(JSON.parse(await readFile(f.filename, 'utf8')).revision).toBe(1);
        expect((await readdir(f.store.directory)).filter(name => name.endsWith('.tmp'))).toEqual([]);
      } finally { await reader.close().catch(() => {}); await pending?.catch(() => {}); }
    }, 10_000);
    it(`${kind} fails within the bounded retry while preserving a continuously held snapshot`, async () => {
      const f = await fixture(kind); const old = await readFile(f.filename, 'utf8'); const reader = await open(f.filename, 'r');
      try {
        const started = performance.now();
        const outcome = f.publish().then(() => ({ error: undefined }), error => ({ error }));
        const { error } = await outcome;
        expect(error).toMatchObject({ syscall: 'rename' }); expect(['EPERM', 'EACCES']).toContain(error.code);
        expect(performance.now() - started).toBeLessThan(8000);
        expect(await readFile(f.filename, 'utf8')).toBe(old); expect(await reader.readFile('utf8')).toBe(old);
        expect((await readdir(f.store.directory)).filter(name => name.endsWith('.tmp'))).toEqual([]);
      } finally { await reader.close(); }
    }, 10_000);
  }
});
