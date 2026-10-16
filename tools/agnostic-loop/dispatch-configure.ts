import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { LoopStore } from './store';
import { canonical, digest } from './json';
import type { RoleProfile, RoutingConfig } from './dispatch-types';
import { configureDispatch } from './supervisor';
import { createPolicyQualification, validateRoutingConfig } from './routing';
import { probeProvider } from './providers';

export async function readRoutingConfig(filename: string, actor: string): Promise<RoutingConfig> {
  const config = validateRoutingConfig(JSON.parse(await readFile(filename, 'utf8')));
  if (config.grant.owner !== actor) throw new Error('Startup actor must equal the fixed routing grant owner');
  return config;
}
export async function configureFromFile(options: { state: string; config: string; actor: string; policy?: string; workspace?: string }): Promise<unknown> {
  const config = await readRoutingConfig(options.config, options.actor); const store = new LoopStore(options.state);
  if (options.policy) {
    const policy = JSON.parse(await readFile(options.policy, 'utf8'));
    if (!options.workspace || policy.workspace !== path.resolve(options.workspace) || policy.owner !== options.actor) throw new Error('Policy workspace and owner must equal the explicit startup grant');
    await store.init(policy);
  }
  const state = await store.load();
  if (state.policy.owner !== options.actor) throw new Error('State policy owner differs from startup actor');
  const journal = await configureDispatch(store, config);
  return { configured: true, state: store.directory, config: path.resolve(options.config), journalRevision: journal.revision, limitations: ['Cooperative workers; no OS confinement', 'Installed executable does not establish authenticated model access'] };
}
export async function qualifyFromFile(options: { config: string; actor: string; target: string; profiles: RoleProfile[]; score: number; expires: number; evidence: string; enable: boolean }): Promise<unknown> {
  const config = await readRoutingConfig(options.config, options.actor);
  const target = config.targets.find(t => t.id === options.target); if (!target) throw new Error('Unknown target');
  const provider = config.providers.find(p => p.id === target.provider); if (!provider) throw new Error('Unknown target provider');
  if (options.enable) { provider.enabled = true; target.enabled = true; }
  const probe = await probeProvider(provider);
  if (probe.availability !== 'available') throw new Error(`Provider unavailable: ${probe.reasons.join('; ')}`);
  if (!Number.isFinite(options.score) || options.score < 0 || !Number.isSafeInteger(options.expires) || options.expires <= Date.now() || !options.profiles.length || options.profiles.some(p => !['execution', 'analysis', 'critical'].includes(p))) throw new Error('Qualification requires explicit score, profiles and future expiry');
  const evidencePath = path.resolve(options.evidence); const evidence = await readFile(evidencePath);
  if (!evidence.toString('utf8').trim()) throw new Error('Nonempty operator qualification evidence required');
  const record = await createPolicyQualification(provider, target, probe, { id: `operator-${target.id}-${digest(evidence).slice(0, 12)}`, profiles: [...new Set(options.profiles)], score: options.score, expires: options.expires, suiteVersion: 'operator-attestation-v1', evidencePath });
  config.qualifications = [...config.qualifications.filter(q => q.target !== target.id), record];
  validateRoutingConfig(config);
  await writeFile(options.config, `${JSON.stringify(config, null, 2)}\n`);
  return { qualification: record, configHash: digest(canonical(config)), liveModelAccess: 'unverified', note: 'Explicit operator qualification; not an evaluation or live smoke. Configure after this edit; an already configured grant cannot silently change.' };
}
