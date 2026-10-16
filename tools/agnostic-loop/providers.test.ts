import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildInvocation, normalizeResult, probeProvider, outcomeSchema } from './providers';
import { createPolicyQualification } from './routing';
import type { CapturedProcess, InvocationRequest, ProviderConfig, WorkerOutcome } from './dispatch-types';
const hash='a'.repeat(64),roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
function sample():WorkerOutcome{return{schemaVersion:1,job:'job',assignment:'assignment',publicationToken:'token',packetHash:hash,inputHashes:{},candidateDigest:hash,worker:{instance:'worker',context:'fresh',provider:'local',model:'exact-model',settings:{},tools:[]},status:'completed',artifacts:[],review:null,proposal:null,criterionEvidence:null,residuals:[],limitations:[],failure:null};}
function captured(stdout:string,exitCode:number|null=0):CapturedProcess{return{stdout,stderr:'',exitCode,terminated:true,started:1,finished:2};}
function request(kind:ProviderConfig['kind']):InvocationRequest{return{provider:{id:'local',kind,enabled:true,executable:process.execPath,prefixArgs:[],environmentKeys:[],settings:{},timeoutMs:5000,maxOutputBytes:65536},target:{id:'target',provider:'local',model:'exact-model',settings:{},enabled:true,maxContextTokens:10000,inputMicroUsdPerMillion:null,outputMicroUsdPerMillion:null},worker:sample().worker,packet:{task:{role:'checker'}},packetHash:hash,job:'job',assignment:'assignment',publicationToken:'token',resultPath:path.join(os.tmpdir(),'native-result.json'),workspace:os.tmpdir(),nativeCostCapMicroUsd:null};}
describe('actual provider transport contract',()=>{
  it('builds fresh pinned native invocations without silently granting bypass',()=>{
    const codex=buildInvocation(request('codex'));expect(codex.args).toContain('--ephemeral');expect(codex.args).toContain('--ignore-user-config');expect(codex.args).toContain('exact-model');expect(codex.args).toContain('read-only');expect(codex.args).not.toContain('--resume');
    const claude=buildInvocation(request('claude'));expect(claude.args).toContain('--print');expect(claude.args).toContain('--json-schema');
    const gemini=buildInvocation(request('gemini'));expect(gemini.args).toContain('--prompt');expect(gemini.args).not.toContain('--yolo');
    expect(outcomeSchema.additionalProperties).toBe(false);
  });
  it('normalizes native output while preserving unavailable and mismatched observations',()=>{
    const body=JSON.stringify({outcomeJson:JSON.stringify(sample())});
    const codex=normalizeResult(request('codex').provider,captured('{"type":"thread.started","thread_id":"actual-session"}\n{"type":"turn.completed","usage":{"input_tokens":12,"output_tokens":4}}'),body);
    expect(codex.outcome?.job).toBe('job');expect(codex.observed.model).toBeNull();expect(codex.observed.session).toBe('actual-session');expect(codex.usage.costMicroUsd).toBeNull();
    const claude=normalizeResult(request('claude').provider,captured(JSON.stringify({structured_output:JSON.parse(body),model:'different-model',session_id:'actual',usage:{input_tokens:7,output_tokens:2},total_cost_usd:0.001})),null);
    expect(claude.observed.model).toBe('different-model');expect(claude.usage.costMicroUsd).toBe(1000);
    const gemini=normalizeResult(request('gemini').provider,captured(JSON.stringify({response:body,stats:{models:{'actual-gemini':{tokens:{prompt:12,candidates:5,cached:3,thoughts:2,tool:0}}}}})),null);
    expect(gemini.observed.model).toBe('actual-gemini');expect(gemini.usage).toEqual({source:'observed',inputTokens:12,outputTokens:5,costMicroUsd:null});
    const failedTool=normalizeResult(request('gemini').provider,captured(JSON.stringify({response:body,stats:{tools:{totalFail:1}}})),null);
    expect(failedTool.outcome).toBeNull();expect(failedTool.errors).toContain('Gemini transport reported failed tool execution');
    expect(normalizeResult(request('command').provider,captured('{'),null).outcome).toBeNull();
    expect(normalizeResult(request('command').provider,captured(JSON.stringify({...sample(),actor:'owner'})),null).outcome).toBeNull();
    expect(normalizeResult(request('command').provider,captured(JSON.stringify(sample()),1),null).outcome).toBeNull();
  });
  it('probes and invokes a real generic worker and generates honest operator qualification',async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),'agnostic-provider-'));roots.push(root);const script=path.join(root,'worker.cjs');
    await writeFile(script,`if(process.argv.includes('--version')){console.log('fixture-v1')}else if(process.argv.includes('--help')){console.log('agnostic-loop-worker-v1')}else{let input='';process.stdin.on('data',v=>input+=v);process.stdin.on('end',()=>{const packet=JSON.parse(input);console.log(JSON.stringify(${JSON.stringify(sample())}));});}`);
    const req=request('command');req.provider.prefixArgs=[script];req.workspace=root;
    const probe=await probeProvider(req.provider);expect(probe.availability).toBe('available');expect(probe.authentication).toBe('unknown');
    const invocation=buildInvocation(req);const started=Date.now();
    const result=await new Promise<CapturedProcess>((resolve,reject)=>{const child=spawn(invocation.executable,invocation.args,{cwd:invocation.cwd,env:invocation.environment,shell:false,windowsHide:true});let stdout='';child.stdout.on('data',v=>stdout+=v);child.once('error',reject);child.once('close',exitCode=>resolve({stdout,stderr:'',exitCode,terminated:true,started,finished:Date.now()}));child.stdin.end(invocation.stdin);});
    expect(normalizeResult(req.provider,result,null).outcome?.job).toBe('job');
    const evidence=path.join(root,'approval.txt');await writeFile(evidence,'Explicit operator policy; no live provider evaluation claimed');
    const qualification=await createPolicyQualification(req.provider,req.target,probe,{id:'policy',profiles:['critical'],score:0,expires:Date.now()+60000,suiteVersion:'policy-v1',evidencePath:evidence});
    expect(qualification.authority).toBe('operator');expect(qualification.evidenceHash).toHaveLength(64);expect(await readFile(evidence,'utf8')).toContain('no live provider');
    await writeFile(script,(await readFile(script,'utf8'))+'\n// changed tooling');expect((await probeProvider(req.provider)).executableHash).not.toBe(probe.executableHash);
  },20000);
});
