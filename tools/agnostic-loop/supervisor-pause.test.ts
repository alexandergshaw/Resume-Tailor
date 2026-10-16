import { afterEach, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { supervisorFixture, cleanupSupervisorFixtures } from './supervisor-fixtures';
import { drive, controlDispatch } from './supervisor';
import { importArtifact } from './observed';
afterEach(cleanupSupervisorFixtures);
it('pause during a preceding verifier gate prevents spawn without invalidating accepted implementation',async()=>{
 const f=await supervisorFixture({gateDelayMs:6000,marker:true});await writeFile(path.join(f.workspace,'output.txt'),'done');
 async function event(type:string,payload:Record<string,unknown>){const s=await f.store.load();return f.store.transact({id:`seed-${s.revision}`,expectedRevision:s.revision,actor:'owner',type,payload});}
 await event('item.create',{id:f.selection.id,objective:f.selection.objective,owner:'owner',affectedPaths:['output.txt','artifacts/accepted.json'],dependencies:[],criteria:['result'],requiredArtifacts:{},requiredGates:['verify'],triage:{}});
 await event('activity.create',{id:'accepted-build',item:f.selection.id,kind:'implementation-wave:build',requirements:['result'],dependencies:[]});
 const worker=(id:string)=>({instance:id,context:id,provider:'manual',model:'fixture',settings:{},tools:[]});
 await event('assignment.start',{id:'manual-author',item:f.selection.id,activity:'accepted-build',role:'implementer',worker:worker('author'),inputs:{},writePaths:['artifacts/accepted.json'],affectedPaths:['artifacts/accepted.json'],resources:[],allowedActions:['write'],deadline:Date.now()+120_000,deliverables:['accepted-artifact']});
 const file=path.join(f.workspace,'artifacts','accepted.json');await writeFile(file,'{"built":true}');const artifact=await importArtifact(f.store,'manual-author','accepted-artifact',file,'owner');await event('assignment.finish',{assignment:'manual-author'});
 await event('assignment.start',{id:'manual-checker',item:f.selection.id,activity:'accepted-build',role:'checker',worker:worker('checker'),inputs:{},writePaths:[],affectedPaths:[],resources:[],allowedActions:['review'],deadline:Date.now()+120_000,deliverables:[]});
 await event('review.record',{assignment:'manual-checker',artifact:artifact.id,hash:artifact.hash,verdict:'clean',findings:[]});await event('assignment.finish',{assignment:'manual-checker'});
 // This negative admission instrument starts from a trusted operator checkpoint;
 // the separate positive test proves the full workflow's prerequisite sequence.
 await f.store.locked(async()=>{const s=await f.store.load();s.items[f.selection.id].status='implemented';await f.store.save(s);});
 const before=await f.store.load(),candidate=(await f.store.context(before)).candidate;const pending=drive(f.store,f.config,f.selection,{maxSteps:3});
 let gateRunning=false;for(let i=0;i<300;i++){const s=await f.store.load();if(Object.values(s.operations).some(op=>op.status==='running'&&op.resource==='workspace')){gateRunning=true;break;}await new Promise(resolve=>setTimeout(resolve,20));}if(!gateRunning)throw new Error(`Gate admission never reached: ${JSON.stringify((await pending).status.checkpoints)}`);
 for(;;){try{await controlDispatch(f.store,f.config,'pause','pause while verifier gate runs');break;}catch(error){if(!(error instanceof Error)||!error.message.includes('Store locked'))throw error;await new Promise(resolve=>setTimeout(resolve,20));}}
 const result=await pending;const after=await f.store.load();expect(result.status.runStatus).toBe('paused');expect(result.status.jobs[0].pid).toBeNull();
 expect(after.artifacts[artifact.id].acceptedHash).toBe(artifact.hash);expect(after.activities['accepted-build'].rounds).toBe(before.activities['accepted-build'].rounds);expect((await f.store.context(after)).candidate).toEqual(candidate);
 await controlDispatch(f.store,f.config,'resume','owner resumes');const resumed=await drive(f.store,f.config,f.selection,{maxSteps:1});expect(resumed.status.jobs[1].status).toBe('terminated');
},90_000);
