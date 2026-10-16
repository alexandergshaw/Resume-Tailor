import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { AdapterKind, RoutingConfig } from './dispatch-types';
import type { Policy } from './types';

export function routingTemplate(options: { executable: string; model: string; kind: AdapterKind; owner: string; now: number; contextTokens?: number }): RoutingConfig {
  if (!path.isAbsolute(options.executable) || !options.model.trim() || !options.owner.trim()) throw new Error('Template requires an absolute executable, exact model and owner');
  if (options.contextTokens !== undefined && (!Number.isSafeInteger(options.contextTokens) || options.contextTokens < 1)) throw new Error('Context capacity must be a positive integer selected by the owner');
  return {
    schemaVersion: 1,
    providers: [{ id: 'local', kind: options.kind, enabled: false, executable: options.executable, prefixArgs: [], environmentKeys: [], settings: {}, timeoutMs: 120000, maxOutputBytes: 1048576 }],
    targets: [{ id: 'local-model', provider: 'local', model: options.model, settings: {}, enabled: false, maxContextTokens: options.contextTokens ?? 32768, inputMicroUsdPerMillion: null, outputMicroUsdPerMillion: null }],
    qualifications: [],
    profiles: { execution: { minimumScore: 1, requireObservedModel: false }, analysis: { minimumScore: 1, requireObservedModel: false }, critical: { minimumScore: 1, requireObservedModel: false } },
    roleProfiles: { criteria: 'critical', architect: 'critical', specialist: 'analysis', planner: 'critical', implementer: 'execution', checker: 'critical', verifier: 'analysis', 'test-designer': 'critical', transcriber: 'execution', finalizer: 'analysis' },
    budget: { maxJobs: 40, deadline: options.now + 3600000, maxMicroUsd: null, mode: 'unbounded', allowUnavailableUsage: false },
    grant: { owner: options.owner, pathPrefixes: ['hello-world', 'extension', 'tools', 'docs', 'scripts', 'AGENTS.md', 'README.md', 'package.json', 'dispatch-artifacts'], gateNames: ['verification', 'regression'], artifactDirectory: 'dispatch-artifacts', allowConfigure: false, allowLocalDelivery: false },
  };
}
export function policyTemplate(workspace: string, owner: string, now: number): Policy {
  if (!path.isAbsolute(workspace)) throw new Error('Workspace must be absolute');
  const gate = { executable: process.execPath, args: ['-e', 'throw new Error("Replace this placeholder with a real repository verification gate")'], resources: ['workspace'] };
  return { owner, workspace, allowedActions: ['read', 'write', 'review', 'run', 'import'], candidateExclusions: ['.git', 'node_modules', '.next', '.agnostic-loop', 'dispatch-artifacts'], environmentKeys: [], externalFiles: [], gates: { verification: gate, regression: gate }, concurrency: 1, deadline: now + 3600000, maxAssignments: 100, commandTimeout: 120000 };
}
export function repositoryPolicy(workspace: string, owner: string, now: number): Policy {
  const policy = policyTemplate(workspace, owner, now);
  const gate = (name: string) => ({ executable: process.execPath, args: [path.join(workspace, 'tools/repository-gate.mjs'), name], resources: ['workspace'] });
  policy.gates = { verification: gate('test'), regression: gate('test'), engine: gate('engine'), lint: gate('lint'), build: gate('build'), backlog: gate('backlog') };
  policy.candidateExclusions.push('hello-world/node_modules', 'hello-world/.next', 'hello-world/coverage', 'hello-world/public/mediapipe/wasm');
  policy.environmentKeys = ['PATH', 'SystemRoot', 'TEMP', 'TMP'];
  policy.deadline = now + 10800000;
  policy.commandTimeout = 1800000;
  return policy;
}
export async function writeDispatchTemplate(directory: string, workspace: string, options: { executable: string; model: string; kind: AdapterKind; owner: string; repository?: boolean; grant?: boolean; allowUnavailableUsage?: boolean; contextTokens?: number }): Promise<unknown> {
  const now = Date.now(); const config = routingTemplate({ ...options, now }); const policy = policyTemplate(workspace, options.owner, now);
  const selectedPolicy = options.repository ? repositoryPolicy(workspace, options.owner, now) : policy;
  if (options.repository) {
    config.grant.gateNames = Object.keys(selectedPolicy.gates); config.budget.deadline = selectedPolicy.deadline;
    config.providers[0].environmentKeys = ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PATH', 'SystemRoot', 'TEMP', 'TMP', 'CODEX_HOME'];
  }
  if (options.grant) { config.grant.allowConfigure = true; config.grant.allowLocalDelivery = true; }
  if (options.allowUnavailableUsage) config.budget.allowUnavailableUsage = true;
  await mkdir(directory, { recursive: true });
  const configPath = path.resolve(directory, 'routing.json'), policyPath = path.resolve(directory, 'policy.json');
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx' });
  await writeFile(policyPath, `${JSON.stringify(selectedPolicy, null, 2)}\n`, { flag: 'wx' });
  return { configPath, policyPath, enabled: false, qualification: 'required', preset: options.repository ? 'repository' : 'generic-unconfigured', note: options.repository ? 'Resume-Tailor preset registers app tests, engine tests, ESLint, build and backlog checks using the tools/repository-gate.mjs adapter; no application typecheck is claimed. Provider environment includes reviewed platform/auth-location names, never automatically API key names. Qualification/enabling remain explicit.' : 'Review paths, registered gates, context limits, settings and budgets; explicitly enable providers and grant configure/local delivery before qualification and admission. Placeholder gates intentionally fail.' };
}
