/** Offline protocol fixtures only. These records are synthetic and never establish live browser truth. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LoopStore as FixtureStore } from './store';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { importArtifact, observeEvent } from './observed';
import { LIVE_APP_URL } from './live-verification';
import type { LoopStore } from './store';
import type { Envelope, LiveVerificationReport, Worker } from './types';

const filename = fileURLToPath(import.meta.url), moduleDirectory = path.dirname(filename);
const cliFlags = ['--experimental-strip-types','--experimental-default-type=module','--experimental-loader',pathToFileURL(path.resolve(moduleDirectory,'../resolve-ts-hook.ts')).href];
const fixtureExecutable = process.argv[1] && path.resolve(process.argv[1]) === filename;
export async function importSyntheticLiveVerification(store: LoopStore,itemId: string,cliRuntime = false): Promise<string> {
  if (cliRuntime) {
    const run = spawnSync(process.execPath,[...cliFlags,filename,store.directory,itemId],{encoding:'utf8',timeout:60_000,windowsHide:true});
    if (run.status !== 0) throw new Error(`Synthetic CLI-runtime fixture failed: ${run.stderr} ${run.stdout}`);
    return JSON.parse(run.stdout).artifact;
  }
  const prefix = `synthetic-live-${randomUUID()}`, root = (await store.load()).policy.workspace;
  const event = async (type: string,payload: Record<string,unknown>,allocation?: string[]) => {
    const state = await store.load();
    const envelope: Envelope = {id:randomUUID(),expectedRevision:state.revision,actor:state.policy.owner,type,payload};
    if (fixtureExecutable && type === 'live-verification.record') {
      const file = path.join(store.directory,`${prefix}-record.json`); await writeFile(file,JSON.stringify(envelope));
      const run = spawnSync(process.execPath,[...cliFlags,path.join(moduleDirectory,'cli.ts'),'apply',file,'--state',store.directory,'--actor',state.policy.owner],{encoding:'utf8',timeout:30_000,windowsHide:true});
      if (run.status !== 0) throw new Error(`Synthetic public live record failed: ${run.stdout} ${run.stderr}`);
      return;
    }
    await store.transact(envelope,{...await observeEvent(store,envelope),...(allocation ? {artifactAllocation:{directory:'artifacts',paths:allocation,configHash:'a'.repeat(64)}} : {})});
  };
  const worker = (id: string): Worker => ({instance:`${prefix}-${id}`,context:`${prefix}-${id}`,provider:'synthetic-offline-fixture',model:'not-observed',settings:{},tools:[]});
  const activity = async (id: string,kind: string) => event('activity.create',{id,item:itemId,kind,requirements:(await store.load()).items[itemId].criteria,dependencies:[]});
  const start = async (id: string,activity: string,role: string,files: string[],inputs: Record<string,string> = {}) => {
    const state = await store.load();
    await event('assignment.start',{id,item:itemId,activity,role,worker:worker(id),inputs,writePaths:files,affectedPaths:files,resources:[],allowedActions:role === 'checker' ? ['review'] : ['write'],deadline:Math.min(Date.now()+60_000,state.policy.deadline),deliverables:[]},files);
  };
  const review = async (id: string,activity: string) => {
    const assignment = `${id}-check`;
    await start(assignment,activity,'checker',[]);
    await event('review.record',{assignment,artifact:id,hash:(await store.load()).artifacts[id].hash,verdict:'clean',findings:[]});
    await event('assignment.finish',{assignment});
  };
  await mkdir(path.join(root,'artifacts'),{recursive:true});
  const attachment = `${prefix}-observation`, observationPath = `artifacts/${attachment}.json`;
  await activity(attachment,'live-observation'); await start(attachment,attachment,'specialist',[observationPath]);
  await writeFile(path.join(root,observationPath),JSON.stringify({synthetic:true,limitation:'Offline protocol-only observation; no browser was used'}));
  await importArtifact(store,attachment,attachment,path.join(root,observationPath),(await store.load()).policy.owner);
  await event('assignment.finish',{assignment:attachment}); await review(attachment,attachment);
  const id = `${prefix}-report`, file = `artifacts/${id}.json`;
  await activity(id,'live-verification'); await start(id,id,'verifier',[file],{[attachment]:(await store.load()).artifacts[attachment].hash});
  const state = await store.load(), context = await store.context(state);
  const report: LiveVerificationReport = {schemaVersion:1,candidate:context.candidate,worker:worker(id),mode:'affected-flow',scopeRationale:'Synthetic fixture tests protocol acceptance only',url:LIVE_APP_URL,started:Date.now(),finished:Date.now(),deployedRevision:'synthetic-fixture-not-live',candidateBinding:{explanation:'Synthetic immutable observation for offline protocol testing only',evidence:[attachment]},steps:[{id:'synthetic-step',expected:'Protocol test accepts independently reviewed report',observed:'Synthetic fixture assertion only',status:'passed',evidence:[attachment]}],criteria:Object.fromEntries(state.items[itemId].criteria.map(criterion => [criterion,{steps:['synthetic-step'],nonLiveReason:null}])),cleanup:{status:'not-needed',details:'Synthetic temporary workspace; no live application data created',evidence:[]},limitations:['Synthetic offline protocol only; not live verification']};
  await writeFile(path.join(root,file),JSON.stringify(report)); await importArtifact(store,id,id,path.join(root,file),state.policy.owner);
  await event('live-verification.record',{assignment:id,artifact:id,report}); await event('assignment.finish',{assignment:id}); await review(id,id);
  return id;
}

if (fixtureExecutable) importSyntheticLiveVerification(new FixtureStore(process.argv[2]),process.argv[3]).then(artifact => process.stdout.write(`${JSON.stringify({artifact})}\n`)).catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'Synthetic fixture failed'}\n`); process.exitCode=1; });
