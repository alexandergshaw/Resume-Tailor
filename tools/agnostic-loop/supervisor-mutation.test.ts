import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { digest } from './json';

const source=path.resolve('tools/agnostic-loop'), roots:string[]=[];
const loader=path.resolve('tools/resolve-ts-hook.ts');
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
type Invariant='launch'|'qualification'|'admission'|'revoked'|'reservation';
async function isolated(){
  const root=await mkdtemp(path.join(os.tmpdir(),'agnostic-mutation-'));roots.push(root);const copy=path.join(root,'runtime');await mkdir(copy);
  const originals:Record<string,string>={},hashes:Record<string,string>={};
  for(const name of await readdir(source))if(name.endsWith('.ts')&&!name.endsWith('.test.ts')){const bytes=await readFile(path.join(source,name));originals[name]=bytes.toString('utf8');hashes[name]=digest(bytes);await writeFile(path.join(copy,name),bytes);}
  const harness=path.join(copy,'instrument.mjs');
  await writeFile(harness,`
import { supervisorFixture, cleanupSupervisorFixtures } from './supervisor-fixtures.ts';
import { drive, controlDispatch, recoverDispatch, importInbox } from './supervisor.ts';
import { loadJournal, saveJournal } from './dispatch-store.ts';
const invariant=process.argv[2];
function requireInvariant(condition,message){if(!condition)throw new Error('INVARIANT:'+message);}
try {
 const fixture=await supervisorFixture(invariant==='qualification'?{beforeConfigure:config=>{config.qualifications[0].score=0;}}:{});
 let run;
 if(invariant==='admission'){
  await drive(fixture.store,fixture.config,fixture.selection,{maxSteps:2});
  await controlDispatch(fixture.store,fixture.config,'pause','pause wins before admission');
  run=await drive(fixture.store,fixture.config,fixture.selection,{maxSteps:1});
 }else run=await drive(fixture.store,fixture.config,fixture.selection,{maxSteps:3});
 if(invariant==='admission'){
  if(run.status.jobs.length>0&&!(run.status.jobs[0].status==='terminated'&&run.status.jobs[0].resultHash))throw new Error('Harness setup: redundant guard stopped the child before a structured reply');
  requireInvariant(run.status.jobs.length===0,'paused run launched before admission');
 }else
 if(invariant==='qualification'){
  requireInvariant(run.status.jobs.length===0,'unqualified model launched');
  requireInvariant(Object.values(run.status.checkpoints).some(value=>value.includes('qualification')),'qualification rejection reason missing');
 }else{
  requireInvariant(run.status.jobs.length===1&&run.status.jobs[0].status==='terminated'&&Boolean(run.status.jobs[0].resultHash),'automatic launch did not produce a real structured reply');
  const job=run.status.jobs[0];
  if(invariant==='revoked'){
   await controlDispatch(fixture.store,fixture.config,'cancel','instrument revocation');
   let accepted=false;try{await importInbox(fixture.store,fixture.config,job.id);accepted=true;}catch(error){if(!String(error.message).includes('fenced'))throw error;}
   requireInvariant(!accepted,'revoked publication accepted');
   requireInvariant(Object.keys((await fixture.store.load()).artifacts).length===0,'revoked publication changed artifacts');
  }
  if(invariant==='reservation'){
   // Model the persisted pending snapshot; actual crash/handle barriers are a separate lifecycle instrument.
   await fixture.store.locked(async()=>{const journal=await loadJournal(fixture.store,fixture.config);journal.jobs[job.id].status='pending';journal.jobs[job.id].pid=null;journal.reservationsMicroUsd=123;await saveJournal(fixture.store,journal);});
   await recoverDispatch(fixture.store,fixture.config,{acknowledgement:'mark-uncertain'});
   const journal=await loadJournal(fixture.store,fixture.config);
   requireInvariant(journal.jobs[job.id].status==='unknown'&&journal.reservationsMicroUsd===123,'unknown launch reservation released');
   const again=await drive(fixture.store,fixture.config,fixture.selection);
   requireInvariant(again.status.jobs.length===1,'unknown launch blindly replaced');
  }
 }
 console.log(JSON.stringify({ok:true,invariant}));
}catch(error){console.log(JSON.stringify({ok:false,message:error.message}));process.exitCode=1;}finally{await cleanupSupervisorFixtures();}
`);
  return{copy,harness,originals,hashes};
}
function instrument(harness:string,invariant:Invariant){
  const result=spawnSync(process.execPath,['--experimental-strip-types','--experimental-default-type=module','--experimental-loader',pathToFileURL(loader).href,harness,invariant],{encoding:'utf8',timeout:45000,windowsHide:true});
  if(result.error)throw result.error;
  const lines=result.stdout.trim().split(/\r?\n/);let record:{ok:boolean;message?:string};
  try{record=JSON.parse(lines[lines.length-1]);}catch{throw new Error(`Mutation harness failed before its invariant: ${result.stderr.slice(0,600)}`);}
  return{code:result.status,record};
}
function replaceOnce(text:string,old:string,next:string):string{
  expect(text.split(old)).toHaveLength(2);return text.replace(old,next);
}
async function mutate(copy:string,originals:Record<string,string>,invariant:Invariant){
  if(invariant==='launch')await writeFile(path.join(copy,'supervisor.ts'),replaceOnce(originals['supervisor.ts'],"if(action.kind==='dispatch')await launchTask(store,config,selection,action.task);","if(action.kind==='dispatch'){ /* isolated launch removal */ }"));
  if(invariant==='qualification')await writeFile(path.join(copy,'routing.ts'),replaceOnce(originals['routing.ts'],"if(!qualification||qualification.score<config.profiles[request.profile].minimumScore)reasons.push('Current role qualification unavailable or below threshold');","if(!qualification)reasons.push('Current role qualification unavailable or below threshold');"));
  if(invariant==='revoked'){
    let engine=replaceOnce(originals['engine.ts'],"requireThat(a && a.status === 'running', `assignment fenced or missing: ${id}`);","requireThat(a, `assignment missing: ${id}`);");
    engine=replaceOnce(engine,"requireThat(p.publicationToken === a.publicationToken,'publication token fenced');","/* isolated publication-token removal */");
    await writeFile(path.join(copy,'engine.ts'),engine);
    await writeFile(path.join(copy,'supervisor-inbox.ts'),replaceOnce(originals['supervisor-inbox.ts'],"requireThat(assignment && (assignment.status === 'running' || assignment.status === 'finished') && assignment.publicationToken === job.publicationToken,'Inbox publication authority fenced');","requireThat(assignment,'Inbox assignment missing');"));
  }
  if(invariant==='admission'){
    await writeFile(path.join(copy,'next-actions.ts'),replaceOnce(originals['next-actions.ts'],"if (state.runStatus !== 'running') return terminal('blocked',`Run ${state.runStatus}`);","/* isolated scheduling pause removal */"));
    await writeFile(path.join(copy,'engine.ts'),replaceOnce(originals['engine.ts'],"if (s.runStatus !== 'running') out.push(`run ${s.runStatus}`);","/* isolated engine pause removal */"));
    let processSource=originals['supervisor-process.ts'];
    if(processSource.includes("if(state.runStatus==='paused')throw new PausedAdmission('Pre-spawn pause won admission; no provider process launched');"))processSource=replaceOnce(processSource,"if(state.runStatus==='paused')throw new PausedAdmission('Pre-spawn pause won admission; no provider process launched');","/* isolated explicit pause guard removal */");
    const guard=processSource.includes("state.runStatus === 'running' &&")?"state.runStatus === 'running' &&":"state.runStatus !== 'cancelled' &&";
    await writeFile(path.join(copy,'supervisor-process.ts'),replaceOnce(processSource,guard,'true &&'));
  }
  if(invariant==='reservation'){
    const text=originals['supervisor.ts'];const start=text.indexOf('export const recoverDispatch:');const end=text.indexOf('export const importInbox:',start);expect(start).toBeGreaterThanOrEqual(0);expect(end).toBeGreaterThan(start);
    const section=replaceOnce(text.slice(start,end),'await saveJournal(store,journal);','journal.reservationsMicroUsd=0; await saveJournal(store,journal);');
    await writeFile(path.join(copy,'supervisor.ts'),text.slice(0,start)+section+text.slice(end));
  }
}
describe('isolated public supervisor mutation instruments',()=>{
  for(const invariant of ['launch','qualification','admission','revoked','reservation'] as const)it(`${invariant} baseline, harmless control, detectable mutant and restoration`,async()=>{
    const f=await isolated();
    expect(instrument(f.harness,invariant)).toEqual({code:0,record:{ok:true,invariant}});
    await writeFile(path.join(f.copy,'supervisor.ts'),f.originals['supervisor.ts']+'\n// Harmless isolated comment control.\n');
    expect(instrument(f.harness,invariant)).toEqual({code:0,record:{ok:true,invariant}});
    await writeFile(path.join(f.copy,'supervisor.ts'),f.originals['supervisor.ts']);await mutate(f.copy,f.originals,invariant);
    const mutant=instrument(f.harness,invariant);expect(mutant.code).toBe(1);expect(mutant.record.ok).toBe(false);expect(mutant.record.message).toMatch(/^INVARIANT:/);
    for(const [name,bytes]of Object.entries(f.originals))await writeFile(path.join(f.copy,name),bytes);
    expect(instrument(f.harness,invariant)).toEqual({code:0,record:{ok:true,invariant}});
    for(const [name,hash]of Object.entries(f.hashes))expect(digest(await readFile(path.join(source,name)))).toBe(hash);
  },180000);
});
