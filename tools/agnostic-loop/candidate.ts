import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { Candidate, Policy } from './types';
import { canonical, digest } from './json';
import { relativePath } from './paths';

function dictionaryKey(key: string): void {
  if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe candidate or environment dictionary key');
}

export function commandEnvironment(policy: Policy): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV ?? 'production' };
  for (const key of policy.environmentKeys) {
    dictionaryKey(key);
    if (Object.hasOwn(process.env, key) && process.env[key] !== undefined) env[key] = process.env[key]!;
  }
  return env;
}
export async function captureCandidate(policy: Policy): Promise<Candidate> {
  const root = await realpath(policy.workspace);
  const files: Record<string, string> = {};
  const seen = new Set<string>();
  const exclusions = policy.candidateExclusions.map(relativePath);
  async function visit(dir: string, prefix: string): Promise<void> {
    for (const name of (await readdir(dir)).sort()) {
      const relative = prefix ? `${prefix}/${name}` : name;
      relativePath(relative);
      dictionaryKey(relative);
      const folded = relative.toLowerCase();
      if (seen.has(folded)) throw new Error(`Case-colliding candidate path: ${relative}`);
      seen.add(folded);
      const location = path.join(dir, name);
      const info = await lstat(location);
      if (info.isSymbolicLink()) throw new Error(`Candidate contains symbolic link: ${relative}`);
      if (exclusions.some(exclusion => folded === exclusion.toLowerCase() || folded.startsWith(`${exclusion.toLowerCase()}/`))) continue;
      if (info.isDirectory()) await visit(location, relative);
      else if (info.isFile()) files[relative] = digest(await readFile(location));
      else throw new Error(`Unsupported candidate file: ${relative}`);
    }
  }
  await visit(root, '');
  for (const [index, filename] of policy.externalFiles.entries()) {
    if ((await lstat(filename)).isSymbolicLink()) throw new Error('External input is a symbolic link');
    files[`@external/${index}`] = digest(await readFile(filename));
  }
  const policyHash = digest(canonical(policy));
  const environmentHash = digest(canonical(commandEnvironment(policy)));
  const toolFiles: Record<string, string> = {};
  for (const gate of Object.values(policy.gates)) {
    if (!path.isAbsolute(gate.executable)) throw new Error('Gate executable must be an absolute pinned path');
    toolFiles[gate.executable] = digest(await readFile(gate.executable));
  }
  const toolHash = digest(canonical({ version: process.version, platform: process.platform, arch: process.arch, execArgv: process.execArgv, toolFiles }));
  const result = { files, policyHash, environmentHash, toolHash };
  return { ...result, digest: digest(canonical(result)) };
}
