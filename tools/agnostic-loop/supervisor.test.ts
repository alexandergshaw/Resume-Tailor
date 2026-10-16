import { afterEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { LoopStore } from './store';
import { drive, dispatchStatus, controlDispatch, recoverDispatch } from './supervisor';
import { supervisorFixture, cleanupSupervisorFixtures } from './supervisor-fixtures';
afterEach(cleanupSupervisorFixtures);
describe('automatic supervisor',()=>{
 it('drives real subprocess roles from unscoped selection to independently checked local delivery',async()=>{
  const f=await supervisorFixture();const result=await drive(f.store,f.config,f.selection);const state=await f.store.load();
  expect(result.status.checkpoints).toEqual({});expect(state.items['fixture-item'].status).toBe('shipped');expect(await readFile(path.join(f.workspace,'output.txt'),'utf8')).toBe('done');
  const roles=result.status.jobs.map(j=>j.task.role);expect(roles).toEqual(['specialist','checker','criteria','checker','architect','checker','planner','checker','test-designer','checker','implementer','checker','implementer','checker','verifier','checker','specialist','checker','finalizer','checker']);
  expect(new Set(result.status.jobs.map(j=>j.worker.context)).size).toBe(20);expect(Object.values(state.evidence).every(e=>e.exitCode===0)).toBe(true);
 },180_000);
 it('preserves two-round owner-needed checkpoint without a third checker after restart',async()=>{
  const f=await supervisorFixture(true);await drive(f.store,f.config,f.selection);const first=await dispatchStatus(f.store,f.config,f.selection);
  expect(first.actions[0].kind).toBe('owner-needed');expect(first.jobs.filter(j=>j.task.role==='checker')).toHaveLength(2);
  await drive(new LoopStore(f.store.directory),f.config,f.selection);expect((await dispatchStatus(f.store,f.config,f.selection)).jobs).toHaveLength(first.jobs.length);
 },120_000);
 it('honors pause before admission and reconstructs uncertainty without blind relaunch',async()=>{
  const f=await supervisorFixture();await controlDispatch(f.store,f.config,'pause','owner pause');expect((await drive(f.store,f.config,f.selection)).steps).toBe(0);
  expect((await dispatchStatus(f.store,f.config)).jobs).toHaveLength(0);await controlDispatch(f.store,f.config,'resume','owner resumes');
  await expect(recoverDispatch(f.store,f.config,{acknowledgement:'invalid'})).rejects.toThrow('acknowledgement');
 });
});
