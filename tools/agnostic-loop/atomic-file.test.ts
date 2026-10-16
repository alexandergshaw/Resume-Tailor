import { describe, expect, it } from 'vitest';
import { atomicFile, type AtomicFileOperations } from './atomic-file';

function failure(code: string) { return Object.assign(new Error(code), { code, syscall: 'rename', path: 'own.tmp', dest: 'state.json' }); }
function fixture() {
  let time = 0;
  const files = new Map([['state.json', 'old'], ['other.tmp', 'unrelated']]);
  const calls: string[] = [];
  const attempts: { source: string; destination: string; time: number; bytes: string | undefined }[] = [];
  const delays: number[] = [];
  const failures: Error[] = [];
  const ops: AtomicFileOperations = {
    platform: 'win32', now: () => time,
    delay: async milliseconds => { delays.push(milliseconds); time += milliseconds; },
    open: async filename => {
      calls.push('open');
      if (files.has(filename)) throw failure('EEXIST');
      files.set(filename, '');
      return {
        writeFile: async bytes => { calls.push('write'); files.set(filename, String(bytes)); },
        sync: async () => { calls.push('sync'); },
        close: async () => { calls.push('close'); },
      };
    },
    rename: async (source, destination) => {
      calls.push('rename'); attempts.push({ source, destination, time, bytes: files.get(source) });
      const error = failures.shift(); if (error) throw error;
      files.set(destination, files.get(source)!); files.delete(source);
    },
    unlink: async filename => { calls.push(`unlink:${filename}`); files.delete(filename); },
  };
  return { ops, files, calls, attempts, delays, failures };
}

describe('bounded atomic file publication', () => {
  it('writes, syncs and closes once, then retries the same prepared bytes', async () => {
    const f = fixture(); f.failures.push(failure('EPERM'), failure('EACCES'));
    await atomicFile('own.tmp', 'state.json', 'new', f.ops);
    expect(f.calls).toEqual(['open', 'write', 'sync', 'close', 'rename', 'rename', 'rename']);
    expect(f.delays).toEqual([10, 20]);
    expect(f.attempts).toEqual([0, 10, 30].map(time => ({ source: 'own.tmp', destination: 'state.json', time, bytes: 'new' })));
    expect(f.files.get('state.json')).toBe('new'); expect(f.files.get('other.tmp')).toBe('unrelated');
  });
  it.each([['linux', 'EPERM'], ['darwin', 'EACCES'], ['win32', 'ENOENT'], ['win32', 'EIO']])('immediately propagates %s %s', async (platform, code) => {
    const f = fixture(); f.ops.platform = platform; const error = failure(code); f.failures.push(error);
    await expect(atomicFile('own.tmp', 'state.json', 'new', f.ops)).rejects.toBe(error);
    expect(f.attempts).toHaveLength(1); expect(f.delays).toEqual([]);
    expect(f.files).toEqual(new Map([['state.json', 'old'], ['other.tmp', 'unrelated']]));
  });
  it('expires one monotonic budget, preserves the latest error and never starts at the deadline', async () => {
    const f = fixture(); const errors: Error[] = [];
    f.ops.rename = async (source, destination) => {
      f.attempts.push({ source, destination, time: f.ops.now(), bytes: f.files.get(source) });
      expect(f.files.get(destination)).toBe('old');
      const error = failure('EPERM'); errors.push(error); throw error;
    };
    f.ops.unlink = async filename => { expect(filename).toBe('own.tmp'); throw failure('EACCES'); };
    const result = await atomicFile('own.tmp', 'state.json', 'new', f.ops).catch(error => error);
    expect(result).toBe(errors.at(-1));
    expect(result).toMatchObject({ code: 'EPERM', syscall: 'rename', path: 'own.tmp', dest: 'state.json' });
    expect(f.delays.slice(0, 4)).toEqual([10, 20, 40, 50]);
    expect(f.delays.at(-1)).toBe(30); expect(f.ops.now()).toBe(1000);
    expect(f.attempts.every(attempt => attempt.time < 1000)).toBe(true);
    expect(f.files.get('state.json')).toBe('old'); expect(f.files.get('other.tmp')).toBe('unrelated');
  });
  it('checks deadline again after an oversleep', async () => {
    const f = fixture(); const error = failure('EPERM'); f.failures.push(error);
    let time = 0; f.ops.now = () => time;
    f.ops.delay = async () => { time = 1001; };
    await expect(atomicFile('own.tmp', 'state.json', 'new', f.ops)).rejects.toBe(error);
    expect(f.attempts).toHaveLength(1);
  });
  it.each(['writeFile', 'sync', 'close'] as const)('preserves %s failure even when closing or cleanup fails', async operation => {
    const f = fixture(); const primary = failure('EIO');
    const originalOpen = f.ops.open;
    f.ops.open = async (filename, flags) => {
      const handle = await originalOpen(filename, flags);
      handle[operation] = async () => { f.calls.push(operation); throw primary; };
      if (operation !== 'close') handle.close = async () => { f.calls.push('close'); throw failure('EBADF'); };
      return handle;
    };
    f.ops.unlink = async filename => { f.calls.push(`unlink:${filename}`); throw failure('EACCES'); };
    await expect(atomicFile('own.tmp', 'state.json', 'new', f.ops)).rejects.toBe(primary);
    expect(f.attempts).toEqual([]); expect(f.calls.filter(call => call === 'close')).toHaveLength(1);
    expect(f.calls).toContain('unlink:own.tmp');
    expect(f.files.get('state.json')).toBe('old'); expect(f.files.get('other.tmp')).toBe('unrelated');
  });
  it('does not clean an exclusive-open collision or invent a missing destination', async () => {
    const f = fixture(); f.files.set('own.tmp', 'someone else'); f.files.delete('state.json');
    await expect(atomicFile('own.tmp', 'state.json', 'new', f.ops)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(f.calls).toEqual(['open']); expect(f.files.get('own.tmp')).toBe('someone else'); expect(f.files.has('state.json')).toBe(false);
  });
  it('cleans only its owned temp on failure with no prior snapshot', async () => {
    const f = fixture(); f.files.delete('state.json'); const error = failure('EIO'); f.failures.push(error);
    await expect(atomicFile('own.tmp', 'state.json', 'new', f.ops)).rejects.toBe(error);
    expect([...f.files]).toEqual([['other.tmp', 'unrelated']]);
  });
});
