import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { selectRepositoryItem } from './repository-backlog';
import { LoopStore } from './store';
import { digest, object, keys } from './json';
import { relativePath } from './paths';
import { probeProvider } from './providers';
import { routeModel } from './routing';
import { loadJournal } from './dispatch-store';
import { drive, dispatchStatus, controlDispatch, recoverDispatch, importInbox } from './supervisor';
import { configureFromFile, qualifyFromFile, readRoutingConfig } from './dispatch-configure';
import { writeDispatchTemplate } from './dispatch-example';
import { serveDispatchMcp, type DispatchEntryService } from './mcp';
import type { AdapterKind, BacklogSelection, DispatchRole, RoleProfile } from './dispatch-types';

function required(flags: Record<string, string>, name: string): string { const v = flags[name]; if (!v?.trim()) throw new Error(`Required option ${name}`); return v; }
function positive(value: string | undefined, name: string): number | undefined { if (value === undefined) return undefined; if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > 10000) throw new Error(`${name}: integer in range 1..10000 required`); return Number(value); }
export async function loadDispatchSelection(filename: string, id: string, kind: 'backlog' | 'workflow'): Promise<BacklogSelection> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id) || ['constructor', 'prototype', '__proto__'].includes(id)) throw new Error('Invalid item ID');
  const sourcePath = path.resolve(filename), bytes = await readFile(sourcePath);
  if (kind === 'backlog') {
    return { ...selectRepositoryItem(bytes.toString('utf8'), id), sourcePath, sourceHash: digest(bytes), sourceKind: kind };
  }
  const raw = object(JSON.parse(bytes.toString('utf8')), 'workflow'); keys(raw, ['schemaVersion', 'id', 'objective', 'owns', 'verify', 'requirements'], 'workflow');
  if (raw.schemaVersion !== 1 || raw.id !== id || typeof raw.objective !== 'string' || !raw.objective.trim() || !Array.isArray(raw.owns) || !Array.isArray(raw.requirements) || !raw.requirements.length || !(raw.verify === null || typeof raw.verify === 'string')) throw new Error('Invalid explicit workflow selection');
  const owns = raw.owns.map(v => { if (typeof v !== 'string') throw new Error('Workflow owns must contain paths'); return relativePath(v); });
  const requirements = raw.requirements.map(v => { if (typeof v !== 'string' || !v.trim() || ['constructor', 'prototype', '__proto__'].includes(v)) throw new Error('Invalid workflow requirement'); return v; });
  if (new Set(requirements).size !== requirements.length || new Set(owns).size !== owns.length) throw new Error('Duplicate workflow paths/requirements');
  return { id, objective: raw.objective, owns, verify: raw.verify as string | null, requirements, sourcePath, sourceHash: digest(bytes), sourceKind: kind };
}
export async function fixedDispatchService(options: { state: string; config: string; actor: string; source: string; sourceKind: 'backlog' | 'workflow' }): Promise<DispatchEntryService> {
  const store = new LoopStore(options.state), config = await readRoutingConfig(options.config, options.actor);
  if ((await store.load()).policy.owner !== options.actor) throw new Error('Startup actor differs from state owner');
  const selection = (item: string) => loadDispatchSelection(options.source, item, options.sourceKind);
  async function doctor(): Promise<unknown> {
    const probes = await Promise.all(config.providers.filter(p => p.enabled).map(p => probeProvider(p)));
    return { probes, disabledProviders: config.providers.filter(p => !p.enabled).map(p => p.id), qualification: config.qualifications.map(q => ({ target: q.target, authority: q.authority, profiles: q.profiles, expires: q.expires })), note: 'Local version/help probes do not establish authenticated model access or live conformance', startup: { state: store.directory, config: path.resolve(options.config), actor: options.actor }, limitations: ['Cooperative workers; no hostile-worker sandbox'] };
  }
  return {
    status: async item => dispatchStatus(store, config, item ? await selection(item) : undefined),
    doctor,
    explain: async item => {
      const status = await dispatchStatus(store, config, await selection(item));
      const raw = await doctor() as { probes: Awaited<ReturnType<typeof probeProvider>>[] };
      const action = status.actions.find(a => a.kind === 'dispatch');
      if (!action || action.kind !== 'dispatch') return { status, routing: null, note: 'No current dispatch role; inspect prerequisite actions/checkpoints' };
      const task = action.task;
      // Explicit estimate for explanation only; supervisor owns actual admission.
      const state = await store.load();
      const journal = await loadJournal(store, config);
      const authors = state.activities[task.activity]?.authors ?? [];
      const request = { role: task.role as DispatchRole, profile: config.roleProfiles[task.role], estimatedInputTokens: 4096, reservedOutputTokens: 4096, requireWrites: task.writePaths.length > 0, authors, now: Date.now() };
      return { status, routing: routeModel(config, raw.probes, journal, request), estimate: { inputTokens: 4096, outputTokens: 4096, purpose: 'hypothetical explanation allowance; not observed token usage or an admission reservation' } };
    },
    drive: async (item, maxSteps) => drive(store, config, await selection(item), { maxSteps }),
    control: async (action, reason) => controlDispatch(store, config, action, reason),
    recover: async (acknowledgement, job) => recoverDispatch(store, config, { acknowledgement, job }),
    importInbox: async job => importInbox(store, config, job),
  };
}
export function isDispatchEntry(args: string[]): boolean { return ['dispatch', 'drive', 'doctor', 'explain', 'mcp'].includes(args[0]); }
export async function dispatchAutomatic(args: string[]): Promise<unknown> {
  const tokens = args[0] === 'dispatch' ? args.slice(1) : args;
  const command = tokens[0]; const positional: string[] = []; const flags: Record<string, string> = {};
  const options = ['--state', '--config', '--actor', '--item', '--backlog', '--workflow', '--max-steps', '--reason', '--job', '--acknowledgement', '--policy', '--workspace', '--directory', '--executable', '--model', '--kind', '--target', '--profiles', '--score', '--expires', '--evidence', '--preset', '--context-tokens'];
  for (let i = 1; i < tokens.length; i++) {
    const arg = tokens[i];
    if (['--enable', '--grant', '--allow-unavailable-usage'].includes(arg)) { if (Object.hasOwn(flags, arg)) throw new Error(`Duplicate ${arg}`); flags[arg] = 'true'; continue; }
    if (arg.startsWith('--')) { if (!options.includes(arg) || Object.hasOwn(flags, arg) || !tokens[i + 1] || tokens[i + 1].startsWith('--')) throw new Error('Unknown, duplicate or missing dispatch option'); flags[arg] = tokens[++i]; }
    else positional.push(arg);
  }
  const allowed: Record<string, string[]> = {
    template: ['--directory', '--workspace', '--executable', '--model', '--kind', '--actor', '--preset', '--grant', '--allow-unavailable-usage', '--context-tokens'],
    qualify: ['--config', '--actor', '--target', '--profiles', '--score', '--expires', '--evidence', '--enable'],
    configure: ['--config', '--actor', '--state', '--policy', '--workspace'],
    status: ['--config', '--actor', '--state', '--item', '--backlog', '--workflow'],
    doctor: ['--config', '--actor', '--state', '--backlog', '--workflow'],
    explain: ['--config', '--actor', '--state', '--item', '--backlog', '--workflow'],
    drive: ['--config', '--actor', '--state', '--item', '--backlog', '--workflow', '--max-steps'],
    pause: ['--config', '--actor', '--state', '--reason'], resume: ['--config', '--actor', '--state', '--reason'], cancel: ['--config', '--actor', '--state', '--reason'],
    recover: ['--config', '--actor', '--state', '--acknowledgement', '--job'], 'import-inbox': ['--config', '--actor', '--state', '--job'],
    mcp: ['--config', '--actor', '--state', '--backlog', '--workflow'],
  };
  if (!Object.hasOwn(allowed, command)) throw new Error('Usage: dispatch template|qualify|configure|doctor|explain|drive|status|pause|resume|cancel|recover|import-inbox|mcp');
  if (positional.length) { if (command !== 'configure' || positional.length !== 1 || flags['--config']) throw new Error('Unexpected positional dispatch argument'); flags['--config'] = positional[0]; }
  for (const name of Object.keys(flags)) if (!allowed[command].includes(name)) throw new Error(`${name} is not allowed for ${command}`);
  if (flags['--workflow'] && flags['--backlog']) throw new Error('Select either --workflow or --backlog');
  const actor = required(flags, '--actor');
  if (command === 'template') { const kind = required(flags, '--kind'); if (!['codex', 'claude', 'gemini', 'command'].includes(kind)) throw new Error('Unsupported adapter kind'); if (flags['--preset'] !== undefined && flags['--preset'] !== 'repository') throw new Error('Supported preset is repository; omit for generic template'); return writeDispatchTemplate(path.resolve(required(flags, '--directory')), path.resolve(required(flags, '--workspace')), { executable: required(flags, '--executable'), model: required(flags, '--model'), kind: kind as AdapterKind, owner: actor, repository: flags['--preset'] === 'repository', grant: flags['--grant'] === 'true', allowUnavailableUsage: flags['--allow-unavailable-usage'] === 'true', contextTokens: flags['--context-tokens'] === undefined ? undefined : Number(flags['--context-tokens']) }); }
  if (command === 'qualify') return qualifyFromFile({ config: required(flags, '--config'), actor, target: required(flags, '--target'), profiles: required(flags, '--profiles').split(',') as RoleProfile[], score: Number(required(flags, '--score')), expires: Number(required(flags, '--expires')), evidence: required(flags, '--evidence'), enable: flags['--enable'] === 'true' });
  if (command === 'configure') return configureFromFile({ state: required(flags, '--state'), config: required(flags, '--config'), actor, policy: flags['--policy'], workspace: flags['--workspace'] });
  const service = await fixedDispatchService({ state: required(flags, '--state'), config: required(flags, '--config'), actor, source: path.resolve(flags['--workflow'] ?? flags['--backlog'] ?? 'docs/backlog.yml'), sourceKind: flags['--workflow'] ? 'workflow' : 'backlog' });
  if (command === 'mcp') { const config = await readRoutingConfig(flags['--config'], actor); await serveDispatchMcp(service, process.stdin, process.stdout, config.providers.flatMap(p => p.environmentKeys)); return { transport: 'stdio', stopped: true }; }
  if (command === 'status') return service.status(flags['--item']);
  if (command === 'doctor') return service.doctor();
  if (command === 'explain') return service.explain(required(flags, '--item'));
  if (command === 'drive') return service.drive(required(flags, '--item'), positive(flags['--max-steps'], '--max-steps'));
  if (command === 'recover') return service.recover(required(flags, '--acknowledgement'), flags['--job']);
  if (command === 'import-inbox') return service.importInbox(required(flags, '--job'));
  if (command !== 'pause' && command !== 'resume' && command !== 'cancel') throw new Error('Unsupported command');
  return service.control(command, required(flags, '--reason'));
}
