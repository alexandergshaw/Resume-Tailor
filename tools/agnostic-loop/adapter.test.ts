import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LoopStore } from './store';
import { importResult } from './adapter';
const roots: string[]=[];
afterEach(async()=>{for(const root of roots.splice(0)) await rm(root,{recursive:true,force:true});});
it('replays acknowledged finish after reload while rejecting changed identity, token or event',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'agnostic-adapter-')); roots.push(root);
  const workspace=path.join(root,'workspace'); await mkdir(workspace); const store=new LoopStore(path.join(root,'state'));
  await store.init({owner:'owner',workspace,allowedActions:['read'],candidateExclusions:[],environmentKeys:[],externalFiles:[],gates:{},concurrency:3,deadline:Date.now()+60_000,maxAssignments:10,commandTimeout:5000});
  async function event(type:string,payload:Record<string,unknown>){const state=await store.load();return store.transact({id:`event-${state.revision}`,expectedRevision:state.revision,actor:'owner',type,payload});}
  await event('item.create',{id:'item',objective:'Check replay',owner:'owner',affectedPaths:[],dependencies:[],criteria:['works'],requiredArtifacts:{},requiredGates:[],triage:{}});
  await event('activity.create',{id:'activity',item:'item',kind:'criteria',requirements:['works'],dependencies:[]});
  const worker={instance:'author',context:'fresh',provider:'manual',model:'fixture',settings:{},tools:[]};
  await event('assignment.start',{id:'assignment',item:'item',activity:'activity',role:'criteria',worker,inputs:{},writePaths:[],affectedPaths:[],resources:[],allowedActions:['read'],deadline:Date.now()+30_000,deliverables:[]});
  const state=await store.load(); const result={schemaVersion:1,id:'finish-result',expectedRevision:state.revision,assignment:'assignment',worker,publicationToken:state.assignments.assignment.publicationToken,event:{type:'assignment.finish',payload:{assignment:'assignment'}},usage:'unavailable'};
  const filename=path.join(root,'result.json'); await writeFile(filename,JSON.stringify(result));
  await importResult(store,filename,'owner'); const revision=(await store.load()).revision;
  await importResult(new LoopStore(store.directory),filename,'owner'); expect((await store.load()).revision).toBe(revision);
  for(const mutation of [{...result,worker:{...worker,context:'different'}},{...result,publicationToken:'substituted'},{...result,expectedRevision:revision}]){
    await writeFile(filename,JSON.stringify(mutation)); await expect(importResult(store,filename,'owner')).rejects.toThrow(/identity|authority|Conflicting/);
    expect((await store.load()).revision).toBe(revision);
  }
},20000);
