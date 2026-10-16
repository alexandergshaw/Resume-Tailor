import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

const production = path.resolve('tools/agnostic-loop');
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

it('isolated mutations falsify independent self-review and stale-evidence instruments', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agnostic-mutation-'));
  const copied = path.join(root, 'tools/agnostic-loop');
  const enginePath = path.join(copied, 'engine.ts');
  const original = await readFile(path.join(production, 'engine.ts'));
  try {
    await cp(production, copied, { recursive: true, filter: source => !source.endsWith('.test.ts') });
    await cp(path.resolve('tools/resolve-ts-hook.ts'), path.join(root, 'tools/resolve-ts-hook.ts'), { recursive: true });
    const script = path.join(root, 'instrument.mjs');
    await writeFile(script, `
import {createDemoFixture,DemoDriver,demoWorker} from ${JSON.stringify(pathToFileURL(path.join(copied, 'demo.ts')).href)};
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
const f=await createDemoFixture(process.argv[2]);
const d=new DemoDriver(f.root,f.workspace,f.stateDirectory);
await d.event('item.create',{id:'transform',objective:'Mutation instrument',owner:'operator',affectedPaths:['input.txt','output.txt','config.json','artifacts/criteria.txt','artifacts/report.txt'],dependencies:[],criteria:['uppercase'],requiredArtifacts:{},requiredGates:['behavior'],triage:{reliability:'Independent oracle'}});
await d.activity('criteria');
if(process.argv[3]==='self'){
  await d.start('author','criteria','criteria',demoWorker('author'),['criteria']);
  await d.import('author','criteria','criterion');await d.finish('author');
  const r=await d.event('assignment.start',{id:'self',item:'transform',activity:'criteria',role:'checker',worker:demoWorker('author'),inputs:{},writePaths:[],affectedPaths:[],resources:[],allowedActions:['review'],deadline:Date.now()+60000,deliverables:[]},false);
  if(r.code===0)throw new Error('ORACLE_SELF_REVIEW_ACCEPTED');
}else{
  await d.activity('verification');
  await writeFile(path.join(d.workspace,'output.txt'),'HELLO\\n');
  await d.start('verify','verification','verifier',demoWorker('verify'),['report'],{},[],['workspace']);
  d.command(['run','verify','behavior']);
  const evidence=Object.keys((await d.state()).evidence);
  await writeFile(path.join(d.workspace,'config.json'),'changed undeclared config');
  const report={candidate:await d.candidate(),worker:demoWorker('verify'),criteria:{uppercase:evidence},limitations:[]};
  await d.import('verify','report',JSON.stringify(report));
  const r=await d.event('verification.record',{assignment:'verify',artifact:'report',report},false);
  if(r.code===0)throw new Error('ORACLE_STALE_EVIDENCE_ACCEPTED');
}
console.log('ORACLE_PASS');
`);
    let sequence = 0;
    const instrument = (kind: string) => spawnSync(process.execPath, [
      '--experimental-strip-types', '--experimental-default-type=module', '--experimental-loader',
      pathToFileURL(path.join(root, 'tools/resolve-ts-hook.ts')).href,
      script, path.join(root, `candidate-${++sequence}`), kind,
    ], { cwd: root, encoding: 'utf8', timeout: 90_000 });
    for (const kind of ['self', 'stale']) {
      const baseline = instrument(kind);
      expect(baseline.status, baseline.stderr + baseline.stdout).toBe(0);
      expect(baseline.stdout).toContain('ORACLE_PASS');
    }
    await writeFile(enginePath, Buffer.concat([original, Buffer.from('\n// Harmless isolated control.\n')]));
    const control = instrument('self');
    expect(control.status, control.stderr + control.stdout).toBe(0);
    const source = original.toString('utf8');
    const selfNeedle = "requireThat(authors.every(a => a.instance !== worker.instance && a.context !== worker.context), 'independent worker instance AND context required');";
    expect(source).toContain(selfNeedle);
    await writeFile(enginePath, source.replace(selfNeedle, 'void worker; void authors;'));
    const selfMutant = instrument('self');
    expect(selfMutant.status).not.toBe(0);
    expect(selfMutant.stderr + selfMutant.stdout).toContain('ORACLE_SELF_REVIEW_ACCEPTED');
    const staleNeedle = "equal(e.candidate,c.candidate) && e.exitCode === 0";
    expect(source).toContain(staleNeedle);
    await writeFile(enginePath, source.replace(staleNeedle, 'e.exitCode === 0'));
    const staleMutant = instrument('stale');
    expect(staleMutant.status).not.toBe(0);
    expect(staleMutant.stderr + staleMutant.stdout).toContain('ORACLE_STALE_EVIDENCE_ACCEPTED');
    await writeFile(enginePath, original);
    expect(hash(await readFile(enginePath))).toBe(hash(original));
    for (const kind of ['self', 'stale']) {
      const restored = instrument(kind);
      expect(restored.status, restored.stderr + restored.stdout).toBe(0);
    }
    expect(hash(await readFile(path.join(production, 'engine.ts')))).toBe(hash(original));
  } finally { await rm(root, { recursive: true, force: true }); }
}, 300_000);
