import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const commands = {
  engine: { cwd: root, args: [path.join(root, 'hello-world/node_modules/vitest/vitest.mjs'), 'run', '--config', 'tools/vitest.config.mjs'] },
  test: { cwd: path.join(root, 'hello-world'), args: [path.join(root, 'hello-world/node_modules/vitest/vitest.mjs'), 'run'] },
  lint: { cwd: path.join(root, 'hello-world'), args: [path.join(root, 'hello-world/node_modules/eslint/bin/eslint.js'), '.'] },
  backlog: { cwd: path.join(root, 'hello-world'), args: [path.join(root, 'hello-world/scripts/backlog/checkGenerated.mjs')], then: [path.join(root, 'hello-world/scripts/backlog/checkContract.mjs')] },
  build: { cwd: path.join(root, 'hello-world'), args: [path.join(root, 'hello-world/scripts/copy-mediapipe.mjs')], then: [path.join(root, 'hello-world/node_modules/next/dist/bin/next'), 'build'] },
};

const command = process.argv.length === 3 && Object.hasOwn(commands, process.argv[2])
  ? commands[process.argv[2]] : null;
if (!command) {
  process.stderr.write('Expected one registered repository gate: engine|test|lint|backlog|build\n');
  process.exitCode = 1;
} else {
  const execute = args => new Promise(resolve => {
    const child = spawn(process.execPath, args, { cwd: command.cwd, stdio: 'inherit', shell: false, windowsHide: true });
    child.on('error', error => { process.stderr.write(`${error.message}\n`); resolve(1); });
    child.on('exit', code => resolve(code ?? 1));
  });
  let code = await execute(command.args);
  if (code === 0 && command.then) code = await execute(command.then);
  process.exitCode = code;
}
