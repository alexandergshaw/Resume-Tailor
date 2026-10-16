import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { policyTemplate, routingTemplate, repositoryPolicy } from './dispatch-example';
import { loadDispatchSelection } from './dispatch-cli';
import { LoopStore } from './store';
import { nextAssignments } from './scheduler';
import { supervisorFixture, cleanupSupervisorFixtures } from './supervisor-fixtures';

const execute = promisify(execFile);
const args = ['--experimental-strip-types', '--experimental-default-type=module', '--experimental-loader', pathToFileURL(path.resolve('tools/resolve-ts-hook.ts')).href, path.resolve('tools/agnostic-loop/cli.ts')];
async function cli(parameters: string[]): Promise<unknown> { const result = await execute(process.execPath, [...args, ...parameters], { timeout: 30000, windowsHide: true }); return JSON.parse(result.stdout); }
async function mcpCli(parameters: string[], calls?: unknown[]): Promise<Record<string, unknown>[]> {
  const child = spawn(process.execPath, [...args, 'mcp', ...parameters], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = ''; child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
  const finished = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'real-entry-test', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    ...(calls ?? [
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'loop_status', arguments: {} } },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'loop_drive', arguments: { item: 'fixture', config: 'injected.json' } } },
    ]),
  ];
  child.stdin.end(requests.map(v => JSON.stringify(v)).join('\n') + '\n');
  expect(await finished, stderr).toBe(0);
  return stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}
describe('automatic dispatch public entry', () => {
  it('retains legacy CLI and supplies usable explicitly qualified setup without stage events', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dispatch-entry-'));
    try {
      const workspace = path.join(directory, 'project'), setup = path.join(directory, 'setup'), state = path.join(directory, 'state');
      await mkdir(workspace); await mkdir(setup);
      const worker = path.join(directory, 'worker.mjs');
      await writeFile(worker, 'if(process.argv.includes("--help")) console.log("agnostic-loop-worker-v1"); else if(process.argv.includes("--version")) console.log("fixture-worker-v1"); else process.exit(1);');
      const config = routingTemplate({ executable: process.execPath, kind: 'command', model: 'user-supplied-model', owner: 'operator', now: Date.now() });
      config.providers[0].prefixArgs = [worker]; config.grant.allowConfigure = true; config.grant.allowLocalDelivery = true;
      const configPath = path.join(setup, 'routing.json'), policyPath = path.join(setup, 'policy.json'), evidencePath = path.join(setup, 'qualification.txt');
      await writeFile(configPath, JSON.stringify(config)); await writeFile(policyPath, JSON.stringify(policyTemplate(workspace, 'operator', Date.now()))); await writeFile(evidencePath, 'Operator explicitly qualifies this scripted fixture for protocol tests only.');
      const qualified = await cli(['dispatch', 'qualify', '--config', configPath, '--actor', 'operator', '--target', 'local-model', '--profiles', 'execution,analysis,critical', '--score', '1', '--expires', String(Date.now() + 3600000), '--evidence', evidencePath, '--enable']);
      expect(qualified).toMatchObject({ ok: true, result: { qualification: { authority: 'operator' }, liveModelAccess: 'unverified' } });
      const configured = await cli(['dispatch', 'configure', '--state', state, '--config', configPath, '--actor', 'operator', '--policy', policyPath, '--workspace', workspace]);
      expect(configured).toMatchObject({ ok: true, result: { configured: true } });
      expect(await cli(['status', '--state', state])).toMatchObject({ ok: true, result: { revision: 0 } });
      expect(await cli(['doctor', '--state', state, '--config', configPath, '--actor', 'operator'])).toMatchObject({ ok: true, result: { probes: [{ availability: 'available', authentication: 'unknown' }] } });
      const entryFlags = ['--state', state, '--config', configPath, '--actor', 'operator'];
      const status = await cli(['dispatch', 'status', ...entryFlags]) as { result: unknown };
      const protocol = await mcpCli(entryFlags);
      const statusReply = protocol.find(r => r.id === 2)!;
      const text = (statusReply.result as { content: { text: string }[] }).content[0].text;
      expect(JSON.parse(text)).toEqual(status.result);
      expect(protocol.find(r => r.id === 3)).toMatchObject({ result: { isError: true } });
      expect(protocol.every(r => r.jsonrpc === '2.0')).toBe(true);
      expect(await cli(['dispatch', 'pause', '--state', state, '--config', configPath, '--actor', 'operator', '--reason', 'Pause only'])).toMatchObject({ ok: true, result: { runStatus: 'paused' } });
      expect((await new LoopStore(state).load()).runStatus).toBe('paused');
      expect(await cli(['dispatch', 'resume', '--state', state, '--config', configPath, '--actor', 'operator', '--reason', 'Resume within same grant'])).toMatchObject({ ok: true, result: { runStatus: 'running' } });
      const saved = JSON.parse(await readFile(configPath, 'utf8')); expect(saved.targets[0].model).toBe('user-supplied-model');
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 60000);
  it('validates explicit workflow source bytes without executing its verification prose', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dispatch-selection-'));
    try {
      const file = path.join(directory, 'workflow.json');
      await writeFile(file, JSON.stringify({ schemaVersion: 1, id: 'fixture', objective: 'Bounded change', owns: ['src/file.ts'], verify: 'untrusted shell text', requirements: ['AC-1'] }));
      expect(await loadDispatchSelection(file, 'fixture', 'workflow')).toMatchObject({ id: 'fixture', verify: 'untrusted shell text', sourceKind: 'workflow' });
      await writeFile(file, JSON.stringify({ schemaVersion: 1, id: 'fixture', objective: 'Bounded change', owns: ['../escape'], verify: null, requirements: ['AC-1'] }));
      await expect(loadDispatchSelection(file, 'fixture', 'workflow')).rejects.toThrow('Path');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('public CLI and actual MCP drive each complete the offline role loop without manual stage events', async () => {
    try {
      const expectedRoles = ['specialist', 'checker', 'criteria', 'checker', 'architect', 'checker', 'planner', 'checker', 'test-designer', 'checker', 'implementer', 'checker', 'implementer', 'checker', 'verifier', 'checker', 'specialist', 'checker', 'finalizer', 'checker'];
      for (const transport of ['cli', 'mcp']) {
        const fixture = await supervisorFixture();
        const configPath = path.join(fixture.root, 'routing-source.json'); await writeFile(configPath, JSON.stringify(fixture.config));
        await writeFile(fixture.selection.sourcePath, JSON.stringify({ schemaVersion: 1, id: fixture.selection.id, objective: fixture.selection.objective, owns: [], verify: null, requirements: ['result'] }));
        const parameters = ['--state', fixture.store.directory, '--config', configPath, '--actor', 'owner', '--workflow', fixture.selection.sourcePath];
        let result: { steps: number; status: { jobs: { task: { role: string } }[]; checkpoints: Record<string, string> } };
        if (transport === 'cli') {
          const executed = await execute(process.execPath, [...args, 'drive', '--item', fixture.selection.id, ...parameters], { timeout: 180000, maxBuffer: 4194304, windowsHide: true });
          const envelope = JSON.parse(executed.stdout); expect(envelope.ok).toBe(true); result = envelope.result;
        } else {
          const replies = await mcpCli(parameters, [{ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'loop_drive', arguments: { item: fixture.selection.id } } }]);
          const reply = replies.find(r => r.id === 2)!.result as { isError: boolean; content: { text: string }[] };
          expect(reply.isError).toBe(false); result = JSON.parse(reply.content[0].text);
        }
        expect(result.status.checkpoints, JSON.stringify(result.status.checkpoints)).toEqual({});
        expect(result.status.jobs.map(j => j.task.role)).toEqual(expectedRoles);
        expect((await fixture.store.load()).items[fixture.selection.id].status).toBe('shipped');
        expect(await readFile(path.join(fixture.workspace, 'output.txt'), 'utf8')).toBe('done');
      }
    } finally { await cleanupSupervisorFixtures(); }
  }, 240000);
});

describe('validated legacy compact status',()=>{
 it('preserves exact default status and projects only progress fields',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'compact-status-'));
  try{
   const workspace=path.join(root,'workspace');await mkdir(workspace);const store=new LoopStore(path.join(root,'state'));await store.init(policyTemplate(workspace,'owner',Date.now()));
   const state=await store.load(),context=await store.context(state),worker={instance:'worker',context:'fresh',provider:'manual',model:'fixture',settings:{},tools:[]};
   state.items.item={id:'item',objective:'mixed fixture',owner:'owner',affectedPaths:[],dependencies:[],criteria:['works'],requiredArtifacts:{},requiredGates:[],triage:{},status:'queued',needs:['owner prerequisite'],escalation:'inspect fixture'};
   state.activities.activity={id:'activity',item:'item',kind:'criteria',requirements:['works'],dependencies:[],status:'open',rounds:0,authors:[],reviews:[]};
   state.assignments.assignment={id:'assignment',item:'item',activity:'activity',role:'criteria',worker,inputs:{},writePaths:[],affectedPaths:[],resources:[],allowedActions:[],deadline:state.policy.deadline,deliverables:[],baseline:context.candidate,policyHash:context.candidate.policyHash,publicationToken:'token',status:'cancelled',reconciled:false,reason:'owner cancelled'};
   state.operations.operation={id:'operation',assignment:'assignment',resource:'workspace',status:'unknown',publicationToken:'token',pid:null,reconciled:false};
   await store.save(state);await store.transact({id:'pause',expectedRevision:0,actor:'owner',type:'run.pause',payload:{reason:'inspect'}});
   const S=await store.load(),C=await store.context(S),expected={...S,candidate:C.candidate,staleArtifacts:Object.keys(S.artifacts).filter(id=>!C.artifacts[id]),scheduling:nextAssignments(S,C),limitations:['Provider identity is operator-attested','No hostile-worker sandbox','Whole-candidate evidence only']};
   const oraclePath=path.join(root,'status-oracle.mjs'),runtime=path.dirname(args.at(-1)!);
   await writeFile(oraclePath,`import {LoopStore} from ${JSON.stringify(pathToFileURL(path.join(runtime,'store.ts')).href)};import {nextAssignments} from ${JSON.stringify(pathToFileURL(path.join(runtime,'scheduler.ts')).href)};const store=new LoopStore(${JSON.stringify(store.directory)}),S=await store.load(),C=await store.context(S);console.log(JSON.stringify({...S,candidate:C.candidate,staleArtifacts:Object.keys(S.artifacts).filter(id=>!C.artifacts[id]),scheduling:nextAssignments(S,C),limitations:['Provider identity is operator-attested','No hostile-worker sandbox','Whole-candidate evidence only']}));`);
   // Candidate tool identity includes execArgv, so compute the oracle under the identical CLI runtime flags.
   const oracle=await execute(process.execPath,[...args.slice(0,-1),oraclePath],{timeout:30000,windowsHide:true});Object.assign(expected,JSON.parse(oracle.stdout));
   const full=await cli(['status','--state',store.directory]) as {result:Record<string,unknown>};expect(full.result).toEqual(JSON.parse(JSON.stringify(expected)));
   const compact=await cli(['status','--output','summary','--state',store.directory]) as {result:Record<string,unknown>};
   expect(Object.keys(compact.result).sort()).toEqual(['revision','runStatus','items','assignments','operations','candidate','staleArtifacts','scheduling','limitations'].sort());
   expect(compact.result).toEqual({revision:S.revision,runStatus:S.runStatus,items:[{id:'item',status:'queued',needs:['owner prerequisite'],escalation:'inspect fixture'}],assignments:[{id:'assignment',item:'item',role:'criteria',status:'cancelled',reconciled:false,reason:'owner cancelled'}],operations:[{id:'operation',assignment:'assignment',status:'unknown',reconciled:false}],candidate:expected.candidate.digest,staleArtifacts:expected.staleArtifacts,scheduling:expected.scheduling,limitations:expected.limitations});
   const forbidden=new Set(['events','files','artifacts','verificationReports','finalReports','outputPath','policy']);
   const inspect=(v:unknown)=>{if(v&&typeof v==='object')for(const [key,value]of Object.entries(v)){expect(forbidden.has(key),key).toBe(false);inspect(value);}};inspect(compact.result);
   expect(Buffer.byteLength(JSON.stringify(compact.result))).toBeLessThan(Buffer.byteLength(JSON.stringify(full.result)));
   const bytes=await readFile(path.join(store.directory,'state.json'));
   for(const parameters of [['status','--output','full'],['next','--output','summary'],['status','--output'],['status','--output','summary','--output','summary']]){
    await expect(cli([...parameters,'--state',store.directory])).rejects.toThrow();expect(await readFile(path.join(store.directory,'state.json'))).toEqual(bytes);
   }
  }finally{await rm(root,{recursive:true,force:true});}
 },40000);
});
