import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicFile } from './atomic-file';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from './json';
import { validateJournal, validateRoutingConfig } from './routing';
import type { DispatchJournal, RoutingConfig } from './dispatch-types';
import type { LoopStore } from './store';

export function configHash(config:RoutingConfig):string { return digest(canonical(config)); }
export async function atomicJson(filename:string,value:unknown):Promise<void> {
  await mkdir(path.dirname(filename),{recursive:true}); const temporary = `${filename}.${randomUUID()}.tmp`;
  await atomicFile(temporary,filename,JSON.stringify(value,null,2));
}
export async function loadJournal(store:LoopStore,config:RoutingConfig):Promise<DispatchJournal> {
  const stored = validateRoutingConfig(JSON.parse(await readFile(path.join(store.directory,'dispatch-config.json'),'utf8')));
  if (configHash(stored) !== configHash(config)) throw new Error('Dispatch configuration changed; an explicit new grant is required');
  const journal = validateJournal(JSON.parse(await readFile(path.join(store.directory,'dispatch-journal.json'),'utf8')));
  if (journal.configHash !== configHash(config)) throw new Error('Journal/configuration binding mismatch');
  return journal;
}
export async function saveJournal(store:LoopStore,journal:DispatchJournal):Promise<void> {
  const validated = validateJournal(journal); validated.revision++;
  await atomicJson(path.join(store.directory,'dispatch-journal.json'),validated);
  journal.revision = validated.revision;
}
export function emptyJournal(config:RoutingConfig):DispatchJournal { return {schemaVersion:1,revision:0,configHash:configHash(config),jobs:Object.create(null),probes:Object.create(null),reservationsMicroUsd:0,spentMicroUsd:0,unavailableUsageJobs:[],checkpoints:Object.create(null)}; }
