import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

export function relativePath(value: string): string {
  if (!value || path.isAbsolute(value) || /^[a-z]:/i.test(value) || value.includes('\\') || value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Path must be a normalized relative path without traversal');
  return value;
}
export function contained(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}
export async function safeFile(root: string, relative: string): Promise<string> {
  relativePath(relative);
  const base = await realpath(root);
  let current = base;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error('Symbolic links are not permitted');
  }
  const resolved = await realpath(current);
  if (!contained(base, resolved)) throw new Error('Path escapes workspace');
  return resolved;
}
