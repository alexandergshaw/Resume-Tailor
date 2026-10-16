import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LoopStore } from './store';
import { configureDispatch } from './supervisor';
import { probeProvider } from './providers';
import { createPolicyQualification } from './routing';
import { digest } from './json';
import type { BacklogSelection, RoutingConfig } from './dispatch-types';
const roots:string[]=[];
export async function cleanupSupervisorFixtures(){for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});}
export const fixtureWorker = `
const fs=require('node:fs');
if(process.argv.includes('--version')){console.log('fixture-worker 1');process.exit(0);}
if(process.argv.includes('--help')){console.log('agnostic-loop-worker-v1');process.exit(0);}
let text='';process.stdin.on('data',chunk=>text+=chunk);process.stdin.on('end',()=>{const marker=process.argv.indexOf('--worker-marker');if(marker>=0)fs.writeFileSync(process.argv[marker+1].slice(7),String(process.pid));const perform=()=>{
 const request=JSON.parse(text), p=request.packet, t=p.task, b=request;
 const out={schemaVersion:1,job:b.job,assignment:b.assignment,publicationToken:b.publicationToken,packetHash:b.packetHash,inputHashes:t.acceptedInputs,candidateDigest:p.candidate.digest,worker:b.worker,status:'completed',artifacts:[],review:null,proposal:null,criterionEvidence:null,residuals:[],limitations:['offline fixture'],failure:null};
 if(t.purpose==='review'){out.review={artifact:p.reviewTarget.artifact.id,hash:p.reviewTarget.artifact.hash,verdict:process.argv.includes('--defective')?'defective':'clean',findings:process.argv.includes('--defective')?[{severity:'P2',mechanism:'missing requirement',classification:p.activity.rounds?'repeat':'new',need:'ruling'}]:[]};}
 else if(t.kind==='verification'){out.criterionEvidence=Object.fromEntries(p.item.criteria.map(id=>[id,p.evidence.map(e=>e.id)]));}
 else if(t.kind!=='final-report'){
  if(t.kind==='scope')out.proposal={schemaVersion:1,item:p.item.id,affectedPaths:['output.txt'],writePaths:['output.txt'],gateNames:['verify'],triage:{security:'local fixture'},limitations:p.activity.rounds?['Scope revised after first review']:[]};
  if(t.kind==='criteria')out.proposal={schemaVersion:1,item:p.item.id,criteria:Object.fromEntries(p.item.criteria.map(id=>[id,'Output is done'])),leverage:'Checked durable subprocess handoffs',diagnostics:'CLI status',limitations:[]};
  if(t.kind==='plan')out.proposal={schemaVersion:1,item:p.item.id,waves:[{id:'build',objective:'Write output',requirements:p.item.criteria,affectedPaths:['output.txt'],writePaths:['output.txt'],dependencies:[],gateNames:['verify']}],specialistKinds:[],limitations:[]};
  if(t.kind==='implementation-wave:build')fs.writeFileSync('output.txt','done');
  out.artifacts=t.artifactIds.map(id=>({id,path:t.writePaths.find(file=>file.endsWith('.json')),content:out.proposal?JSON.stringify(out.proposal):'Accepted '+t.kind}));
 }
 if(process.argv.includes('--unowned'))fs.writeFileSync('unowned.txt','unexpected');
 const native=process.argv.indexOf('--native-secret');if(native>=0)fs.writeFileSync(require('node:path').join(process.argv[native+1].slice(6),'dispatch-native',b.job+'.json'),JSON.stringify({secret:process.env.AGNOSTIC_TEST_SECRET}));
 if(process.argv.includes('--bad-settings'))console.log(JSON.stringify({outcome:out,observed:{provider:'fixture',model:'fixture-model',settings:{unexpected:'setting'},session:'session-'+out.job,source:'provider-output'},usage:{source:'unavailable',inputTokens:null,outputTokens:null,costMicroUsd:null},limitations:[]}));else console.log(JSON.stringify(out));
};if(process.argv.includes('--delay'))setTimeout(perform,5000);else perform();});`;
export async function supervisorFixture(options:boolean|{defective?:boolean; flags?:string[];maxJobs?:number;deadlineMs?:number;gateDelayMs?:number;nativeSecret?:boolean;marker?:boolean;beforeConfigure?:(config:RoutingConfig)=>void}={}){
 const settings=typeof options==='boolean'?{defective:options}:options;
 const root=await mkdtemp(path.join(os.tmpdir(),'agnostic-supervisor-'));roots.push(root);const workspace=path.join(root,'workspace');await mkdir(workspace);await mkdir(path.join(workspace,'artifacts'));
 const script=path.join(root,'worker.cjs');await writeFile(script,fixtureWorker);const evidence=path.join(root,'qualification.txt');await writeFile(evidence,'Explicit fixture qualification, not model evaluation');
 const store=new LoopStore(path.join(root,'state'));await store.init({owner:'owner',workspace,allowedActions:['read','write','review','run','import'],candidateExclusions:['artifacts'],environmentKeys:[],externalFiles:[],gates:{verify:{executable:process.execPath,args:['-e',`setTimeout(()=>{if(require('node:fs').readFileSync('output.txt','utf8')!=='done')process.exit(1)},${settings.gateDelayMs??0})`],resources:['workspace']}},concurrency:3,deadline:Date.now()+180_000,maxAssignments:100,commandTimeout:10_000});
 const provider={id:'fixture',kind:'command' as const,enabled:true,executable:process.execPath,prefixArgs:[script,...(settings.defective?['--defective']:[]),...(settings.flags??[]),...(settings.nativeSecret?['--native-secret',`state=${path.join(root,'state')}`]:[]),...(settings.marker?['--worker-marker',`marker=${path.join(root,'worker-pid.txt')}`]:[])],environmentKeys:settings.nativeSecret?['AGNOSTIC_TEST_SECRET']:[],settings:{},timeoutMs:10_000,maxOutputBytes:1_000_000};
 const target={id:'fixture-model',provider:'fixture',model:'fixture-model',settings:{},enabled:true,maxContextTokens:100_000,inputMicroUsdPerMillion:null,outputMicroUsdPerMillion:null};
 const probe=await probeProvider(provider);const qualification=await createPolicyQualification(provider,target,probe,{id:'fixture-qualification',profiles:['execution','analysis','critical'],score:100,expires:Date.now()+180_000,suiteVersion:'fixture-v1',evidencePath:evidence});
 const config:RoutingConfig={schemaVersion:1,providers:[provider],targets:[target],qualifications:[qualification],profiles:{execution:{minimumScore:50,requireObservedModel:false},analysis:{minimumScore:50,requireObservedModel:false},critical:{minimumScore:50,requireObservedModel:false}},roleProfiles:{criteria:'critical',architect:'critical',specialist:'analysis',planner:'critical',implementer:'execution',checker:'critical',verifier:'analysis','test-designer':'critical',transcriber:'execution',finalizer:'analysis'},budget:{maxJobs:20,deadline:Date.now()+180_000,maxMicroUsd:null,mode:'unbounded',allowUnavailableUsage:true},grant:{owner:'owner',pathPrefixes:['output.txt','artifacts'],gateNames:['verify'],artifactDirectory:'artifacts',allowConfigure:true,allowLocalDelivery:true}};
 const sourcePath=path.join(root,'selection.json');await writeFile(sourcePath,'bounded workflow fixture');const selection:BacklogSelection={id:'fixture-item',objective:'Create exact done output',owns:[],verify:null,requirements:['result'],sourcePath,sourceHash:digest(await readFile(sourcePath)),sourceKind:'workflow'};
 config.budget.maxJobs=settings.maxJobs??20;config.budget.deadline=Date.now()+(settings.deadlineMs??180_000);settings.beforeConfigure?.(config);
 await configureDispatch(store,config);return {root,store,config,selection,workspace};
}
