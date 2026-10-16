import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

it('isolated blocker bypass is detected while original and no-op controls pass', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'resume-intake-mutation-'));
  const files = ['tools/agnostic-loop/repository-backlog.ts', 'tools/agnostic-loop/paths.ts', 'tools/resolve-ts-hook.ts', 'hello-world/scripts/backlog/lib/yamlLite.mjs', 'hello-world/scripts/backlog/lib/contract.mjs', 'hello-world/scripts/backlog/lib/loadBacklog.mjs'];
  try {
    for (const file of files) {
      const target = path.join(root, file);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.resolve(file), target);
    }
    const target = path.join(root, files[0]);
    const original = await readFile(target, 'utf8');
    const fixture = { id: 'N999', state: 'actionable', title: 'Blocked work', owed_by: 'fixture', owns: ['file.txt'], verify: 'node --version', verify_proof: { command_sha256: createHash('sha256').update('node --version').digest('hex'), fails_on_head_exit: 1, passes_on_fix_exit: 0, kills_on_revert_exit: 1, survives_noop_exit: 0, proved_at: '2026-10-16', proved_by: 'fixture' }, blocked_by: ['N999999'] };
    const yaml = Object.entries(fixture).map(([key, value], i) => `${i ? '  ' : '- '}${key}: ${JSON.stringify(value)}`).join('\n');
    const script = `import {selectRepositoryItem} from ${JSON.stringify(pathToFileURL(target).href)};
try { selectRepositoryItem(${JSON.stringify(yaml)}, 'N999'); throw new Error('ORACLE_BLOCKER_ACCEPTED'); }
catch(error) { if(!error.message.includes('dependencies remain')) throw error; }
console.log('ORACLE_PASS');`;
    const args = ['--experimental-strip-types', '--experimental-default-type=module', '--experimental-loader', pathToFileURL(path.join(root, 'tools/resolve-ts-hook.ts')).href, '--input-type=module', '-e', script];
    const instrument = () => execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
    expect(instrument()).toContain('ORACLE_PASS');
    await writeFile(target, `${original}\n// Harmless isolated control.\n`);
    expect(instrument()).toContain('ORACLE_PASS');
    const needle = 'if (row.blocked_by.length)';
    expect(original.split(needle)).toHaveLength(2);
    const mutation = original.replace(needle, 'if (false)');
    await writeFile(target, mutation);
    expect(await readFile(target, 'utf8')).toBe(mutation);
    expect(mutation).not.toBe(original);
    expect(instrument).toThrow();
    await writeFile(target, original);
    expect(instrument()).toContain('ORACLE_PASS');
  } finally { await rm(root, { recursive: true, force: true }); }
}, 120000);
