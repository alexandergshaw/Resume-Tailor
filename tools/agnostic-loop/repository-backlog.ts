import { parseBacklogYaml } from '../../hello-world/scripts/backlog/lib/yamlLite.mjs';
import { validateContract } from '../../hello-world/scripts/backlog/lib/contract.mjs';
import { relativePath } from './paths';

/** The product's tiny parser has no object scalar support. Support only the
 * documented proof record as an inline JSON object, leaving other grammar to it.
 * Reject duplicate fields before its last-value-wins behavior can erase scope.
 */
function parseRepositoryBacklog(text: string) {
  const proofs = new Map<number, unknown>();
  let index = -1;
  let fields = new Set<string>();
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n').map(line => {
    if (/^- id: /.test(line)) { index++; fields = new Set(['id']); return line; }
    const field = /^ {2}([a-zA-Z_]+): (.*)$/s.exec(line);
    if (!field) return line;
    if (fields.has(field[1])) throw new Error(`Duplicate backlog field: ${field[1]}`);
    fields.add(field[1]);
    if (field[1] !== 'verify_proof' || !field[2].trimStart().startsWith('{')) return line;
    if (index < 0) throw new Error('Backlog proof before item');
    const proof = JSON.parse(field[2]);
    if (!proof || Array.isArray(proof) || typeof proof !== 'object') throw new Error('Backlog proof must be an object');
    proofs.set(index, proof);
    return '  verify_proof: null';
  }).join('\n');
  const rows = parseBacklogYaml(normalized);
  for (const [i, proof] of proofs) rows[i].verify_proof = proof;
  return rows;
}

/** Explicit intake only: preserve product priority/state; never execute verify text. */
export function selectRepositoryItem(text: string, id: string) {
  const rows = parseRepositoryBacklog(text);
  const validation = validateContract(rows);
  if (!validation.ok) throw new Error(`Backlog contract: ${validation.violations.join('; ')}`);
  const row = rows.find((item: { id: string }) => item.id === id);
  if (!row) throw new Error('Backlog item not found');
  if (row.state !== 'actionable') throw new Error(`Item requires owner action: ${row.state}`);
  if (/\bSHIPPED\b/i.test(row.title)) throw new Error('Backlog item is already shipped; reconcile history before intake');
  if (!Array.isArray(row.blocked_by)) throw new Error('Backlog blocked_by must be an array');
  if (row.blocked_by.length) throw new Error(`Backlog dependencies remain: ${row.blocked_by.join(', ')}`);
  if (!Array.isArray(row.owns) || !row.owns.length || typeof row.verify !== 'string' || !row.verify.trim()) throw new Error('Backlog item is unscoped: owns and verify are required; use a checked explicit --workflow');
  const owns = row.owns.map((value: unknown) => {
    if (typeof value !== 'string' || /[*?\[\]{}]/.test(value)) throw new Error('Backlog owns requires exact paths; use a checked explicit --workflow for glob scopes');
    return relativePath(value);
  });
  if (new Set(owns).size !== owns.length) throw new Error('Duplicate backlog owned paths');
  return { id, objective: row.title, owns, verify: row.verify, requirements: [`${id}-request`] };
}
