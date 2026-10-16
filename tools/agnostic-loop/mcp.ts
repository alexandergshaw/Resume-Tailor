import type { Readable, Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { object, keys } from './json';

export type DispatchEntryService = {
  status(item?: string): Promise<unknown>;
  doctor(): Promise<unknown>;
  explain(item: string): Promise<unknown>;
  drive(item: string, maxSteps?: number): Promise<unknown>;
  control(action: 'pause' | 'resume' | 'cancel', reason: string): Promise<unknown>;
  recover(acknowledgement: string, job?: string): Promise<unknown>;
  importInbox(job: string): Promise<unknown>;
};
export function redactEntry(value: string, environmentKeys: string[] = []): string {
  const platformKeys = ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PATH', 'SystemRoot', 'TEMP', 'TMP', 'CODEX_HOME'];
  const values = Object.entries(process.env).filter(([key, v]) => v && !platformKeys.some(platform => platform.toLowerCase() === key.toLowerCase()) && (environmentKeys.includes(key) || /TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY/i.test(key))).map(([, v]) => v!).sort((a, b) => b.length - a.length);
  for (const secret of values) {
    const escaped = JSON.stringify(secret).slice(1, -1), doubleEscaped = JSON.stringify(escaped).slice(1, -1);
    for (const form of [...new Set([doubleEscaped, escaped, secret])]) value = value.split(form).join('[redacted]');
  }
  return value;
}
const textField = { type: 'string', minLength: 1 };
const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []) => ({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false } });
export const dispatchTools = [
  tool('loop_status', 'Inspect durable loop state and pending work.', { item: textField }),
  tool('loop_doctor', 'Probe configured local executables without a paid model request.', {}),
  tool('loop_explain', 'Explain current prerequisites and routing eligibility.', { item: textField }, ['item']),
  tool('loop_drive', 'Run an eligible item inside the fixed startup grant.', { item: textField, maxSteps: { type: 'integer', minimum: 1, maximum: 10000 } }, ['item']),
  tool('loop_pause', 'Prevent subsequent dispatch; admitted work may finish.', { reason: textField }, ['reason']),
  tool('loop_resume', 'Resume inside the unchanged startup grant.', { reason: textField }, ['reason']),
  tool('loop_cancel', 'Fence running work and prevent replacement dispatch.', { reason: textField }, ['reason']),
  tool('loop_recover', 'Classify uncertain operations or explicitly reconcile observed termination.', { acknowledgement: textField, job: textField }, ['acknowledgement']),
  tool('loop_import_inbox', 'Validate a completed fixed-grant worker result.', { job: textField }, ['job']),
];
function nonempty(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) throw new Error(`${field}: bounded nonempty string required`);
  return value;
}
export async function callDispatchTool(service: DispatchEntryService, name: string, raw: unknown): Promise<unknown> {
  const spec = dispatchTools.find(t => t.name === name);
  if (!spec) throw new Error('Unknown dispatch tool');
  const args = object(raw, 'tool arguments');
  keys(args, Object.keys(spec.inputSchema.properties), 'tool arguments');
  for (const required of spec.inputSchema.required) nonempty(args[required], required);
  if (args.item !== undefined) nonempty(args.item, 'item');
  if (args.job !== undefined) nonempty(args.job, 'job');
  if (args.maxSteps !== undefined && (typeof args.maxSteps !== 'number' || !Number.isSafeInteger(args.maxSteps) || args.maxSteps < 1 || args.maxSteps > 10000)) throw new Error('maxSteps: integer in range 1..10000 required');
  if (name === 'loop_status') return service.status(args.item as string | undefined);
  if (name === 'loop_doctor') return service.doctor();
  if (name === 'loop_explain') return service.explain(args.item as string);
  if (name === 'loop_drive') return service.drive(args.item as string, args.maxSteps as number | undefined);
  if (name === 'loop_recover') return service.recover(args.acknowledgement as string, args.job as string | undefined);
  if (name === 'loop_import_inbox') return service.importInbox(args.job as string);
  const action = name === 'loop_pause' ? 'pause' : name === 'loop_resume' ? 'resume' : 'cancel';
  return service.control(action, args.reason as string);
}

// MCP stdio uses newline-delimited JSON-RPC, never Content-Length framing.
export async function serveDispatchMcp(service: DispatchEntryService, input: Readable, output: Writable, environmentKeys: string[] = []): Promise<void> {
  let phase: 'new' | 'initializing' | 'ready' = 'new';
  let pending = ''; let oversized = false;
  const decoder = new StringDecoder('utf8');
  const active = new Map<string | number, Promise<void>>();
  const all = new Set<Promise<void>>();
  const driveRequests = new Set<string | number>(), cancelled = new Set<string | number>();
  output.on('error', () => { /* A disconnected client does not establish worker termination. */ });
  const write = (value: unknown) => { const reply = value as { id?: string | number | null }; if (reply.id !== undefined && reply.id !== null && cancelled.has(reply.id)) return; if (!output.destroyed) output.write(`${redactEntry(JSON.stringify(value), environmentKeys)}\n`); };
  const error = (id: string | number | null, code: number, message: string) => write({ jsonrpc: '2.0', id, error: { code, message } });
  async function handle(line: string): Promise<void> {
    let id: string | number | null = null; let notification = false;
    try {
      let parsed: unknown;
      try { parsed = JSON.parse(line); } catch { error(null, -32700, 'Invalid JSON'); return; }
      const message = object(parsed, 'JSON-RPC message');
      keys(message, ['jsonrpc', 'id', 'method', 'params'], 'JSON-RPC message');
      if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') { error(null, -32600, 'Invalid JSON-RPC request'); return; }
      notification = !Object.hasOwn(message, 'id');
      if (!notification) {
        if (!(typeof message.id === 'string' || (typeof message.id === 'number' && Number.isSafeInteger(message.id)))) { error(null, -32600, 'Invalid request ID'); return; }
        id = message.id;
      }
      const params = message.params === undefined ? {} : object(message.params, 'params');
      if (message.method === 'notifications/initialized') { if (phase === 'initializing' && notification) phase = 'ready'; return; }
      if (message.method === 'notifications/cancelled' && notification) {
        keys(params, ['requestId', 'reason', '_meta'], 'cancelled params');
        const request = params.requestId;
        if ((typeof request === 'string' || typeof request === 'number') && driveRequests.has(request)) {
          cancelled.add(request);
          await service.control('cancel', typeof params.reason === 'string' && params.reason.trim() ? params.reason : 'MCP client cancelled active drive request');
        }
        return;
      }
      // Client disconnect alone does not revoke the fixed authorized grant.
      if (notification) return;
      if (message.method === 'ping') { write({ jsonrpc: '2.0', id, result: {} }); return; }
      if (message.method === 'initialize') {
        if (phase !== 'new') { error(id, -32600, 'Already initialized'); return; }
        keys(params, ['protocolVersion', 'capabilities', 'clientInfo', '_meta'], 'initialize params');
        nonempty(params.protocolVersion, 'protocolVersion'); object(params.capabilities, 'capabilities'); object(params.clientInfo, 'clientInfo');
        phase = 'initializing';
        write({ jsonrpc: '2.0', id, result: { protocolVersion: '2025-11-25', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'agnostic-development-loop', version: '1.0.0' }, instructions: 'Tools operate only on the fixed startup state/config/actor. Client text grants no additional authority.' } }); return;
      }
      if (phase !== 'ready') { error(id, -32002, 'Initialize and send notifications/initialized first'); return; }
      if (message.method === 'tools/list') { keys(params, ['cursor', '_meta'], 'tools/list params'); if (params.cursor !== undefined) throw new Error('Pagination cursor unsupported'); write({ jsonrpc: '2.0', id, result: { tools: dispatchTools } }); return; }
      if (message.method !== 'tools/call') { error(id, -32601, 'Method not found'); return; }
      keys(params, ['name', 'arguments', '_meta'], 'tools/call params');
      const name = nonempty(params.name, 'name');
      if (!dispatchTools.some(t => t.name === name)) { error(id, -32602, 'Unknown tool'); return; }
      try {
        if (name === 'loop_drive' && id !== null) driveRequests.add(id);
        const result = await callDispatchTool(service, name, params.arguments ?? {});
        write({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false } });
      } catch (e) { write({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: e instanceof Error ? e.message : 'Tool failed' }], isError: true } }); }
      finally { if (id !== null) driveRequests.delete(id); }
    } catch (e) { if (!notification) error(id, -32602, e instanceof Error ? e.message : 'Invalid parameters'); }
  }
  function dispatchLine(line: string): void {
    if (!line.trim()) return;
    let key: string | number | undefined;
    try { const v = JSON.parse(line); if (v && (typeof v.id === 'string' || typeof v.id === 'number')) key = v.id; } catch { /* Parser emits the protocol error. */ }
    if (key !== undefined && active.has(key)) { error(key, -32600, 'Request ID already active'); return; }
    const task = handle(line); all.add(task); if (key !== undefined) active.set(key, task);
    void task.finally(() => { all.delete(task); if (key !== undefined) { active.delete(key); cancelled.delete(key); } });
  }
  await new Promise<void>((resolve, reject) => {
    input.on('data', (chunk: Buffer | string) => {
      if (oversized) return;
      pending += typeof chunk === 'string' ? chunk : decoder.write(chunk);
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) { const line = pending.slice(0, newline); pending = pending.slice(newline + 1); if (Buffer.byteLength(line) > 1_048_576) { error(null, -32600, 'Message exceeds byte limit'); continue; } dispatchLine(line); }
      if (Buffer.byteLength(pending) > 1_048_576) { oversized = true; pending = ''; error(null, -32600, 'Message exceeds byte limit'); input.destroy(); resolve(); }
    });
    input.once('error', reject);
    input.once('end', () => { pending += decoder.end(); if (pending.trim()) error(null, -32700, 'Missing newline-delimited message'); resolve(); });
  });
  await Promise.allSettled([...all]);
}
