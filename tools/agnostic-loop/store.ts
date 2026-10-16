import { randomUUID } from 'node:crypto';
import { atomicFile } from './atomic-file';
import { mkdir, open, readFile, unlink, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { validateState } from './validation';
import { applyEvent, createState } from './engine';
import { captureCandidate } from './candidate';
import { canonical, digest } from './json';
import { contained, safeFile } from './paths';
import type { Context, Envelope, LoopState } from './types';
import { assertManualStore } from './policy-continuation';

export class LoopStore {
  readonly directory: string;
  constructor(directory: string) { this.directory = path.resolve(directory); }
  async locked<T>(fn: () => Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true });
    const lockPath = path.join(this.directory, 'lock.json');
    const token = randomUUID();
    let handle;
    try { handle = await open(lockPath, 'wx'); }
    catch { throw new Error('Store locked; do not remove automatically. Explicit recovery requires the observed lock token and operator acknowledgement.'); }
    await handle.writeFile(JSON.stringify({ token, pid: process.pid, created: Date.now() }));
    await handle.sync(); await handle.close();
    try { return await fn(); }
    finally {
      const observed = JSON.parse(await readFile(lockPath, 'utf8'));
      if (observed.token === token) await unlink(lockPath);
    }
  }
  async recoverLock(token: string, acknowledgement: string): Promise<void> {
    if (acknowledgement !== 'operations-stopped-and-side-effects-reconciled') throw new Error('Explicit recovery requires operations-stopped-and-side-effects-reconciled acknowledgement');
    const filename = path.join(this.directory, 'lock.json');
    const current = JSON.parse(await readFile(filename, 'utf8'));
    if (!token || current.token !== token) throw new Error('Recovery lock ownership changed');
    await unlink(filename);
  }
  async save(state: LoopState): Promise<void> {
    const filename = path.join(this.directory, `state.${randomUUID()}.tmp`);
    await atomicFile(filename, path.join(this.directory, 'state.json'), JSON.stringify(state, null, 2));
  }
  async init(policy: unknown): Promise<LoopState> {
    return this.locked(async () => {
      try { await lstat(path.join(this.directory, 'state.json')); throw new Error('Store already initialized'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const state = createState(policy);
      const root = path.resolve(state.policy.workspace);
      if (contained(root, this.directory)) {
        const relative = path.relative(root, this.directory).split(path.sep).join('/');
        if (!state.policy.candidateExclusions.some(value => relative === value || relative.startsWith(`${value}/`))) throw new Error('State directory must be outside candidate or explicitly excluded');
      }
      await captureCandidate(state.policy);
      await this.save(state); return state;
    });
  }
  async verifiedBlob(filename: string, hash: string): Promise<Buffer> {
    const actual = await realpath(filename);
    const base = await realpath(path.join(this.directory, 'blobs'));
    if (!contained(base, actual) || (await lstat(filename)).isSymbolicLink()) throw new Error('Record blob escapes immutable store');
    const bytes = await readFile(actual);
    if (digest(bytes) !== hash) throw new Error('Immutable blob integrity mismatch');
    return bytes;
  }
  async load(): Promise<LoopState> {
    let state: LoopState;
    try { state = validateState(JSON.parse(await readFile(path.join(this.directory, 'state.json'), 'utf8'))); }
    catch { throw new Error('Invalid or missing store snapshot; restore a verified snapshot before continuing'); }
    await this.verifyReferences(state);
    return state;
  }
  private async verifyReferences(state: LoopState): Promise<void> {
    for (const artifact of Object.values(state.artifacts)) {
      await this.verifiedBlob(path.join(this.directory, 'blobs', artifact.hash), artifact.hash);
    }
    for (const evidence of Object.values(state.evidence)) await this.verifiedBlob(evidence.outputPath, evidence.outputHash);
    for (const [id, report] of Object.entries({ ...state.verificationReports, ...state.finalReports })) {
      const artifact = state.artifacts[id];
      if (!artifact || canonical(JSON.parse((await this.verifiedBlob(path.join(this.directory, 'blobs', artifact.hash), artifact.hash)).toString('utf8'))) !== canonical(report)) throw new Error('Report bytes do not bind stored report');
    }
  }
  createAssignmentMonitor(assignmentId: string): () => Promise<boolean> {
    let cached: { hash: string; state: LoopState } | undefined;
    return async () => {
      try {
        let state: LoopState;
        let hash: string;
        try {
          const bytes = await readFile(path.join(this.directory, 'state.json'));
          hash = digest(bytes);
          state = cached?.hash === hash ? cached.state : validateState(JSON.parse(bytes.toString('utf8')));
        } catch { throw new Error('Invalid or missing store snapshot; restore a verified snapshot before continuing'); }
        await this.verifyReferences(state);
        cached = { hash, state };
        return state.assignments[assignmentId]?.status === 'running';
      } catch (error) { cached = undefined; throw error; }
    };
  }
  async blob(bytes: Buffer): Promise<{ hash: string; path: string }> {
    const hash = digest(bytes);
    const folder = path.join(this.directory, 'blobs'); await mkdir(folder, { recursive: true });
    const filename = path.join(folder, hash);
    try { const handle = await open(filename, 'wx'); try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); } }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    if (digest(await readFile(filename)) !== hash) throw new Error('Existing immutable blob corrupted');
    return { hash, path: filename };
  }
  private async observeArtifacts(state: LoopState): Promise<Context['artifacts']> {
    const artifacts: Context['artifacts'] = {};
    for (const [id, a] of Object.entries(state.artifacts)) {
      try {
        const hash = digest(await readFile(await safeFile(state.policy.workspace, a.path)));
        if (hash === a.hash) artifacts[id] = { id: a.id, activity: a.activity, version: a.version, hash, path: a.path, author: a.author, inputs: a.inputs };
      } catch { /* Missing or unsafe mutable sources are unavailable observations. */ }
    }
    return artifacts;
  }
  async context(state: LoopState): Promise<Context> {
    const artifacts = await this.observeArtifacts(state);
    return { now: Date.now(), candidate: await captureCandidate(state.policy), artifacts, evidence: state.evidence };
  }
  async transact(event: Envelope, observations: Partial<Context> = {}): Promise<LoopState> {
    return this.locked(async () => {
      const state = await this.load();
      const artifacts = await this.observeArtifacts(state);
      const context = { evidence: state.evidence, ...observations, artifacts: { ...artifacts } };
      // Supplied metadata never replaces locked observations of existing sources.
      for (const [id, artifact] of Object.entries(observations.artifacts ?? {})) {
        if (state.artifacts[id]) continue;
        const hash = digest(await readFile(await safeFile(state.policy.workspace, artifact.path)));
        if (hash !== artifact.hash) throw new Error('Imported source changed before commit');
        await this.verifiedBlob(path.join(this.directory, 'blobs', hash), hash);
        context.artifacts[id] = artifact;
      }
      // The caller cannot replace the candidate or clock captured under the lock.
      const finalContext: Context = { ...context, now: Date.now(), candidate: await captureCandidate(state.policy) };
      // Never trust a caller's manual-mode claim or amend fixed native grants.
      finalContext.manualPolicyContinuation = false;
      if (event.type === 'policy.continue') {
        await assertManualStore(this.directory);
        finalContext.manualPolicyContinuation = true;
      }
      const next = applyEvent(state, event, finalContext);
      if (next !== state) await this.save(next);
      return next;
    });
  }
}
