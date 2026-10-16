import { open, rename, unlink } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

type WriteHandle = Pick<Awaited<ReturnType<typeof open>>, 'writeFile' | 'sync' | 'close'>;
export interface AtomicFileOperations {
  open: (filename: string, flags: 'wx') => Promise<WriteHandle>;
  rename: (source: string, destination: string) => Promise<void>;
  unlink: (filename: string) => Promise<void>;
  now: () => number;
  delay: (milliseconds: number) => Promise<void>;
  platform: string;
}
const defaults: AtomicFileOperations = {
  open, rename, unlink, now: () => performance.now(),
  delay: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  platform: process.platform,
};

// Retry only replacement of the already closed, prepared sibling file.
async function replace(source: string, destination: string, ops: AtomicFileOperations): Promise<void> {
  const deadline = ops.now() + 1000;
  let delay = 10;
  for (;;) {
    try { await ops.rename(source, destination); return; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (ops.platform !== 'win32' || (code !== 'EPERM' && code !== 'EACCES')) throw error;
      const remaining = deadline - ops.now();
      if (remaining <= 0) throw error;
      await ops.delay(Math.min(delay, remaining));
      if (ops.now() >= deadline) throw error;
      delay = Math.min(delay * 2, 50);
    }
  }
}

export async function atomicFile(
  temporary: string, destination: string, bytes: string,
  operations: Partial<AtomicFileOperations> = {},
): Promise<void> {
  const ops = { ...defaults, ...operations };
  let owned = false;
  let handle: WriteHandle | undefined;
  try {
    handle = await ops.open(temporary, 'wx');
    owned = true;
    await handle.writeFile(bytes);
    await handle.sync();
    const closing = handle; handle = undefined;
    await closing.close();
    await replace(temporary, destination, ops);
  } catch (error) {
    if (handle) { try { await handle.close(); } catch { /* Preserve the primary error. */ } }
    if (owned) { try { await ops.unlink(temporary); } catch { /* Cleanup is best effort. */ } }
    throw error;
  }
}
