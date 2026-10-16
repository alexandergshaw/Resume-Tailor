import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const flags = ['--experimental-strip-types', '--experimental-default-type=module', '--experimental-loader', pathToFileURL(path.resolve('tools/resolve-ts-hook.ts')).href];
function message(id: number, method: string, params?: unknown): string { return `${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })}\n`; }
async function exchange(chunks: string[], delay = 0, afterSettle?: string, secret?: string): Promise<{ replies: Record<string, unknown>[]; stderr: string }> {
  const source = `import {serveDispatchMcp} from ${JSON.stringify(pathToFileURL(path.resolve('tools/agnostic-loop/mcp.ts')).href)};
const service={status:async item=>({runStatus:'running',item:item??null}),doctor:async()=>({available:true,detail:process.env.DISPATCH_SECRET_SENTINEL??''}),explain:async item=>({item}),drive:async item=>{await new Promise(r=>setTimeout(r,${delay}));process.stderr.write('drive-settled\\n');return {item,delivered:true}},control:async(action,reason)=>({action,reason}),recover:async acknowledgement=>({acknowledgement}),importInbox:async job=>({job})};
await serveDispatchMcp(service,process.stdin,process.stdout,['DISPATCH_SECRET_SENTINEL']);`;
  const child = spawn(process.execPath, [...flags, '--input-type=module', '-e', source], { shell: false, windowsHide: true, env: { ...process.env, ...(secret === undefined ? {} : { DISPATCH_SECRET_SENTINEL: secret }) }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  let markSettled!: () => void;
  const settled = new Promise<void>(resolve => { markSettled = resolve; });
  child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; if (stderr.includes('drive-settled')) markSettled(); });
  const finished = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  for (const chunk of chunks) child.stdin.write(chunk);
  if (afterSettle) { await settled; child.stdin.write(afterSettle); }
  child.stdin.end();
  const code = await finished; expect(code, stderr).toBe(0);
  return { replies: stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)), stderr };
}
const initialize = message(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'protocol-test', version: '1' } });
const initialized = `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`;
describe('real MCP stdio protocol', () => {
  it('negotiates lifecycle and exposes closed fixed-grant tools using newline framing', async () => {
    const result = await exchange([initialize.slice(0, 15), initialize.slice(15) + initialized, message(2, 'tools/list'), message(3, 'tools/call', { name: 'loop_status', arguments: { item: 'A25' } })]);
    const byId = Object.fromEntries(result.replies.map(r => [String(r.id), r]));
    expect(byId['1']).toMatchObject({ jsonrpc: '2.0', result: { protocolVersion: '2025-11-25', capabilities: { tools: { listChanged: false } } } });
    const tools = (byId['2'].result as { tools: { name: string; inputSchema: { additionalProperties: boolean; properties: Record<string, unknown> } }[] }).tools;
    expect(tools.map(t => t.name)).toContain('loop_drive');
    expect(tools.every(t => t.inputSchema.additionalProperties === false)).toBe(true);
    expect(tools.some(t => ['config', 'actor', 'executable', 'credentials', 'state'].some(k => Object.hasOwn(t.inputSchema.properties, k)))).toBe(false);
    expect(byId['3']).toMatchObject({ result: { isError: false, content: [{ type: 'text', text: '{"runStatus":"running","item":"A25"}' }] } });
    expect(result.replies).toHaveLength(3);
  });
  it('rejects missing initialization and invalid framing without contaminating stdout', async () => {
    const result = await exchange([message(2, 'tools/list'), 'not-json\n', 'Content-Length: 7\n', '{}']);
    expect(result.replies).toEqual(expect.arrayContaining([expect.objectContaining({ id: 2, error: { code: -32002, message: 'Initialize and send notifications/initialized first' } }), expect.objectContaining({ id: null, error: { code: -32700, message: 'Invalid JSON' } }), expect.objectContaining({ id: null, error: { code: -32700, message: 'Missing newline-delimited message' } })]));
  });
  it('rejects tool grant overrides and exposes pause separately from cancellation', async () => {
    const result = await exchange([initialize + initialized, message(2, 'tools/call', { name: 'loop_drive', arguments: { item: 'A25', executable: 'unauthorized.exe' } }), message(3, 'tools/call', { name: 'loop_pause', arguments: { reason: 'Owner pause' } }), message(4, 'tools/call', { name: 'loop_cancel', arguments: { reason: 'Owner cancel' } }), message(5, 'tools/call', { name: 'loop_drive', arguments: { item: 'A25', maxSteps: -1 } })]);
    const byId = Object.fromEntries(result.replies.map(r => [String(r.id), r]));
    expect(byId['2']).toMatchObject({ result: { isError: true } });
    expect(JSON.stringify(byId['2'])).toContain('unsupported field executable');
    expect(byId['3']).toMatchObject({ result: { content: [{ text: '{"action":"pause","reason":"Owner pause"}' }], isError: false } });
    expect(byId['4']).toMatchObject({ result: { content: [{ text: '{"action":"cancel","reason":"Owner cancel"}' }], isError: false } });
    expect(byId['5']).toMatchObject({ result: { isError: true } });
  });
  it('serves status and pause before a pending drive returns', async () => {
    const result = await exchange([initialize + initialized, message(2, 'tools/call', { name: 'loop_drive', arguments: { item: 'A25' } }), message(3, 'tools/call', { name: 'loop_status', arguments: {} }), message(4, 'tools/call', { name: 'loop_pause', arguments: { reason: 'Pause future work' } })], 250);
    const ids = result.replies.map(r => r.id);
    expect(ids.indexOf(3)).toBeLessThan(ids.indexOf(2)); expect(ids.indexOf(4)).toBeLessThan(ids.indexOf(2));
  });
  it('explicit request cancellation fences drive response without treating disconnect as cancellation', async () => {
    const result = await exchange([initialize + initialized, message(2, 'tools/call', { name: 'loop_drive', arguments: { item: 'A25' } }), `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 2, reason: 'Owner cancelled request' } })}\n`, message(3, 'tools/call', { name: 'loop_status', arguments: {} })], 250);
    expect(result.replies.some(r => r.id === 2)).toBe(false);
    expect(result.replies.some(r => r.id === 3)).toBe(true);
  });
  it('allows an ID to be reused after its cancelled drive has settled', async () => {
    const result = await exchange([initialize + initialized, message(2, 'tools/call', { name: 'loop_drive', arguments: { item: 'A25' } }), `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 2, reason: 'Owner cancelled request' } })}\n`], 250, message(2, 'tools/call', { name: 'loop_status', arguments: { item: 'reused' } }));
    const reused = result.replies.filter(r => r.id === 2);
    expect(reused).toHaveLength(1);
    expect(reused[0]).toMatchObject({ result: { isError: false, content: [{ text: '{"runStatus":"running","item":"reused"}' }] } });
  });
  it('redacts quote/backslash secrets inside JSON-encoded tool diagnostics', async () => {
    const sentinel = 'fixture-credential-"quoted"-\\path';
    const result = await exchange([initialize + initialized, message(2, 'tools/call', { name: 'loop_doctor', arguments: {} })], 0, undefined, sentinel);
    const reply = result.replies.find(r => r.id === 2)!.result as { content: { text: string }[] };
    expect(JSON.parse(reply.content[0].text)).toEqual({ available: true, detail: '[redacted]' });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(sentinel); expect(serialized).not.toContain(JSON.stringify(sentinel).slice(1, -1));
  });
});
