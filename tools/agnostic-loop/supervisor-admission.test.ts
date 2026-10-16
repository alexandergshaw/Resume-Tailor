import { afterEach, describe, expect, it } from 'vitest';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { supervisorFixture, cleanupSupervisorFixtures } from './supervisor-fixtures';
import { drive, dispatchStatus, recoverDispatch } from './supervisor';
import { loadJournal } from './dispatch-store';
afterEach(async()=>{delete process.env.AGNOSTIC_TEST_SECRET;await cleanupSupervisorFixtures();});
async function contents(directory:string):Promise<string>{let text='';for(const entry of await readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);text+=entry.isDirectory()?await contents(file):(await readFile(file)).toString('utf8');}return text;}
describe('actual launch admission and sanitized capture',()=>{
 it('crashes after real child spawn before PID persistence and recovers unknown without relaunch',async()=>{
  const f=await supervisorFixture({flags:['--delay'],marker:true}),barrier=path.join(f.root,'spawn-barrier.txt'),setup=path.join(f.root,'setup.json'),controller=path.join(f.root,'controller.mjs');
  await writeFile(setup,JSON.stringify({state:f.store.directory,config:f.config,selection:f.selection}));
  const storeUrl=pathToFileURL(path.resolve('tools/agnostic-loop/store.ts')).href,supervisorUrl=pathToFileURL(path.resolve('tools/agnostic-loop/supervisor.ts')).href;
  await writeFile(controller,`import {readFile,writeFile} from 'node:fs/promises';import {LoopStore} from ${JSON.stringify(storeUrl)};import {drive} from ${JSON.stringify(supervisorUrl)};const setup=JSON.parse(await readFile(${JSON.stringify(setup)},'utf8'));class BarrierStore extends LoopStore{async context(state){const value=await super.context(state);if(Object.values(state.operations).some(op=>op.status==='pending'&&op.id.endsWith(':operation'))){await writeFile(${JSON.stringify(barrier)},'spawned-before-handle');await new Promise(()=>{});}return value;}}await drive(new BarrierStore(setup.state),setup.config,setup.selection,{maxSteps:3});`);
  const child=spawn(process.execPath,['--experimental-strip-types','--experimental-default-type=module','--experimental-loader',pathToFileURL(path.resolve('tools/resolve-ts-hook.ts')).href,controller],{stdio:'ignore',windowsHide:true});
  let reached=false;try{for(let i=0;i<500;i++){try{await readFile(barrier);reached=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,20));}}expect(reached).toBe(true);}finally{child.kill();await new Promise<void>(resolve=>child.once('close',()=>resolve()));}
  // Explicitly stop this test-owned worker; controller still cannot infer its recovered identity.
  let workerPid:number|null=null;try{workerPid=Number(await readFile(path.join(f.root,'worker-pid.txt'),'utf8'));}catch{/* Spawn marker can win before stdin is read. */}if(workerPid)try{process.kill(workerPid);}catch{/* Already terminated. */}
  const journalBefore=await loadJournal(f.store,f.config);expect(Object.values(journalBefore.jobs)[0].status).toBe('pending');
  // Crashed controller owns an orphan lock. Recovery is explicit and checks its observed token.
  const lock=JSON.parse(await readFile(path.join(f.store.directory,'lock.json'),'utf8'));await f.store.recoverLock(lock.token,'operations-stopped-and-side-effects-reconciled');
  await recoverDispatch(f.store,f.config,{acknowledgement:'mark-uncertain'});const resumed=await drive(f.store,f.config,f.selection);
  expect(resumed.status.jobs).toHaveLength(1);expect(resumed.status.jobs[0].status).toBe('unknown');expect((await loadJournal(f.store,f.config)).reservationsMicroUsd).toBe(journalBefore.reservationsMicroUsd);expect(resumed.steps).toBe(0);
 },50_000);
 it('removes rejected native raw credentials including JSON-escaped quote and backslash sentinels',async()=>{
  const sentinel='credential-quote"-slash\\-sentinel';process.env.AGNOSTIC_TEST_SECRET=sentinel;const f=await supervisorFixture({nativeSecret:true});const result=await drive(f.store,f.config,f.selection);
  expect(result.status.checkpoints[f.selection.id]).toContain('credential material');const saved=await contents(f.store.directory);
  expect(saved).not.toContain(sentinel);expect(saved).not.toContain(JSON.stringify(sentinel).slice(1,-1));expect(JSON.stringify(await dispatchStatus(f.store,f.config))).not.toContain(sentinel);
 },35_000);
});
