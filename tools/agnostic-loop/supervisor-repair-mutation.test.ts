import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { digest } from './json';

const source = path.resolve('tools/agnostic-loop');
const loader = path.resolve('tools/resolve-ts-hook.ts');
const roots: string[] = [];
type Mutation = 'reentry' | 'diagnostics-verification' | 'diagnostics-final-report' | 'checkpoint' | 'budget';
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function isolated() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agnostic-repair-mutation-')); roots.push(root);
  const copy = path.join(root, 'runtime'); await mkdir(copy);
  const originals: Record<string, string> = {}, hashes: Record<string, string> = {};
  for (const name of await readdir(source)) if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
    const bytes = await readFile(path.join(source, name));
    originals[name] = bytes.toString('utf8'); hashes[name] = digest(bytes);
    await writeFile(path.join(copy, name), bytes);
  }
  const harness = path.join(copy, 'repair-instrument.mjs');
  await writeFile(harness, `
import { runReentry, runCheckpoint, runGateRepair, restoreRepairEnvironment } from './supervisor-repair-fixtures.ts';
import { cleanupSupervisorFixtures } from './supervisor-fixtures.ts';
const name=process.argv[2];
try {
 if(name==='reentry')await runReentry();
 else if(name==='checkpoint')await runCheckpoint();
 else if(name==='budget')await runGateRepair('verification',{exhausted:true});
 else if(name==='diagnostics-verification')await runGateRepair('verification');
 else if(name==='diagnostics-final-report')await runGateRepair('final-report');
 else throw new Error('Unknown mutation instrument: '+name);
 console.log(JSON.stringify({ok:true,name}));
}catch(error){console.log(JSON.stringify({ok:false,message:error.message,name}));process.exitCode=1;}
finally{restoreRepairEnvironment();await cleanupSupervisorFixtures();}
`);
  return { copy, harness, originals, hashes };
}
function run(harness: string, name: Mutation) {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--experimental-default-type=module', '--experimental-loader', pathToFileURL(loader).href, harness, name], {
    encoding: 'utf8', timeout: 240_000, windowsHide: true, maxBuffer: 2_000_000,
  });
  if (result.error) throw result.error;
  let record: { ok: boolean; name: string; message?: string };
  try { record = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)!); }
  catch { throw new Error(`Harness did not reach its behavioral oracle: ${result.stderr.slice(0, 1000)}`); }
  if (result.signal) throw new Error(`Harness terminated by ${result.signal}`);
  return { code: result.status, record };
}
function once(sourceText: string, from: string, to: string) {
  expect(sourceText.split(from), `Mutation seam not unique: ${from}`).toHaveLength(2);
  return sourceText.replace(from, to);
}
async function mutate(copy: string, originals: Record<string, string>, name: Mutation) {
  if (name === 'reentry') {
    const text = originals['next-actions.ts'];
    const start = text.indexOf('const advance ='), end = text.indexOf("if (item.status === 'queued')", start);
    expect(start).toBeGreaterThanOrEqual(0); expect(end).toBeGreaterThan(start);
    const seam = text.slice(start, end);
    expect(seam).toContain('state.revision');
    await writeFile(path.join(copy, 'next-actions.ts'), text.slice(0, start) + seam.replaceAll('state.revision', '0') + text.slice(end));
  }
  if (name === 'diagnostics-verification' || name === 'diagnostics-final-report') {
    const marker = 'job.packetHash=digest(canonical(packet));';
    // Remove the entire separate failure handoff, including redundant wrappers.
    // Current successful evidence, tasks, inputs and candidate stay untouched.
    const removal = `
      const hasFailure=value=>value&&typeof value==='object'&&((value.gate&&Number.isInteger(value.exitCode)&&value.exitCode!==0&&value.outputHash)||Object.values(value).some(hasFailure));
      for(const key of Object.keys(packet))if(!['evidence','task','inputs','activity','reviewTarget','candidate','assignment','item','grant','budget'].includes(key)&&hasFailure(packet[key]))delete packet[key];
      `;
    await writeFile(path.join(copy, 'supervisor-process.ts'), once(originals['supervisor-process.ts'], marker, removal + marker));
  }
  if (name === 'checkpoint') {
    const text = originals['supervisor.ts'];
    expect(text).toContain('await saveJournal(store,journal);');
    await writeFile(path.join(copy, 'supervisor.ts'), text.replaceAll('await saveJournal(store,journal);', 'journal.checkpoints={};await saveJournal(store,journal);'));
  }
  if (name === 'budget') {
    const text = originals['engine.ts'];
    const start = text.indexOf("case 'artifact.invalidate':"), end = text.indexOf("case 'review.record':", start);
    expect(start).toBeGreaterThanOrEqual(0); expect(end).toBeGreaterThan(start);
    const section = once(text.slice(start, end), "activity.status = activity.rounds >= 2 ? 'owner-needed' : 'open';", "activity.rounds=0;activity.reviews=[];activity.status='open';");
    await writeFile(path.join(copy, 'engine.ts'), text.slice(0, start) + section + text.slice(end));
  }
}

describe('isolated failed-gate repair production mutants', () => {
  for (const name of ['reentry', 'diagnostics-verification', 'diagnostics-final-report', 'checkpoint', 'budget'] as const) {
    it(`${name}: baseline, harmless comment, designated behavioral red, restored baseline`, async () => {
      const f = await isolated();
      const success = { code: 0, record: { ok: true, name } };
      expect(run(f.harness, name)).toEqual(success);
      await writeFile(path.join(f.copy, 'supervisor.ts'), f.originals['supervisor.ts'] + '\n// Harmless isolated repair control.\n');
      expect(run(f.harness, name)).toEqual(success);
      await writeFile(path.join(f.copy, 'supervisor.ts'), f.originals['supervisor.ts']);
      await mutate(f.copy, f.originals, name);
      const mutant = run(f.harness, name);
      const oracle = name === 'reentry' ? /^INVARIANT:R1:/ : name === 'diagnostics-verification' ? /^INVARIANT:R2:/ : name === 'diagnostics-final-report' ? /^INVARIANT:R3:/ : name === 'checkpoint' ? /^INVARIANT:R4:/ : /^INVARIANT:R5:/;
      expect(mutant.code).toBe(1); expect(mutant.record.ok).toBe(false); expect(mutant.record.message).toMatch(oracle);
      for (const [file, bytes] of Object.entries(f.originals)) await writeFile(path.join(f.copy, file), bytes);
      expect(run(f.harness, name)).toEqual(success);
      for (const [file, hash] of Object.entries(f.hashes)) {
        expect(digest(await readFile(path.join(source, file)))).toBe(hash);
        expect(digest(await readFile(path.join(f.copy, file)))).toBe(hash);
      }
    }, 1_100_000);
  }
});
