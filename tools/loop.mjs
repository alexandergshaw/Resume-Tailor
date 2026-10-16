import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { finalizeHandoff } from './main-delivery.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (!args.length || (args.length === 1 && ['help', '--help'].includes(args[0]))) {
  process.stdout.write(`${JSON.stringify({ ok: true, result: {
    commands: ['init', 'status', 'next', 'apply EVENT', 'import ASSIGNMENT ID FILE', 'packet ASSIGNMENT FILE', 'result FILE', 'run ASSIGNMENT GATE', 'assemble-final ASSIGNMENT RESIDUALS_JSON', 'demo NEW_DIRECTORY', 'handoff STORE ITEM', 'recover-lock', 'recover-operations', 'reconcile-operation ID', 'dispatch', 'mcp'],
    documentation: 'docs/dev-loop/USAGE.md', automaticDispatch: 'disabled by default; explicit operator qualification and grant required',
  } })}\n`);
  process.exit(0);
}
const entry = args[0] === 'handoff' ? 'manual-handoff.ts' : 'cli.ts';
const isHandoff = entry === 'manual-handoff.ts';
if (args[0] === 'handoff') args.shift();
const child = spawn(process.execPath, [
  '--experimental-strip-types', '--experimental-default-type=module',
  '--experimental-loader', pathToFileURL(path.join(root, 'tools/resolve-ts-hook.ts')).href,
  path.join(root, 'tools/agnostic-loop', entry), ...args,
], { cwd: root, stdio: isHandoff ? ['inherit', 'pipe', 'inherit'] : 'inherit', shell: false, windowsHide: true });
let localOutput = '';
if (isHandoff) child.stdout.on('data', chunk => { localOutput += chunk; });
child.on('error', error => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
  process.exitCode = 1;
});
child.on('close', async (code, signal) => {
  if (!isHandoff) { process.exitCode = code ?? (signal ? 1 : 0); return; }
  try {
    const local = JSON.parse(localOutput);
    const report = await finalizeHandoff({ ...local, complete: code === 0 && local.complete === true });
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exitCode = report.complete ? 0 : (code || 2);
  } catch {
    process.stdout.write(`${JSON.stringify({ complete: false, localComplete: false, error: 'Local handoff unproven; inspect store and explicit item selection' })}\n`);
    process.exitCode = 1;
  }
});
