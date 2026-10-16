import { afterEach, describe, it } from 'vitest';
import { cleanupSupervisorFixtures } from './supervisor-fixtures';
import {
  runReentry, runCheckpoint, runGateRepair, missingDiagnosticControl,
  nonGateControl, boundedDiagnosticControl, wrongItemControl, restoreRepairEnvironment,
} from './supervisor-repair-fixtures';

afterEach(async () => { restoreRepairEnvironment(); await cleanupSupervisorFixtures(); });

describe('real-process failed-gate repair invariants', () => {
  // Expected red on the unrepaired source at INVARIANT:R1. R2/R3's diagnostic
  // red is measured after reentry is corrected, before diagnostics are repaired.
  // These remain ordinary passing obligations after runtime repair: no .fails.
  it('R1 acknowledged advance reenters after observed invalidation through a legal disposition', runReentry, 300_000);
  it('R4 positive bounded stop explains action/stage and limit after reopen; zero-step stays read-only', runCheckpoint, 300_000);
  for (const stage of ['verification', 'final-report'] as const) {
    it(`${stage === 'verification' ? 'R2' : 'R3'} real ${stage} failure requires verified diagnostic-dependent repair, new checking, and current-candidate delivery; R5 survives restart`, async () => {
      await runGateRepair(stage);
    }, 450_000);
    it(`R5 actual defective/clean outcomes exhaust ${stage} repair budget without replacing its activity`, async () => {
      await runGateRepair(stage, { exhausted: true });
    }, 450_000);
  }
  for (const mode of ['missing', 'corrupt'] as const) {
    it(`${mode} actual referenced gate bytes reject without launch or fabricated checkpoint`, async () => {
      await missingDiagnosticControl(mode);
    }, 300_000);
  }
  for (const mode of ['review', 'invalidation', 'paused', 'provider'] as const) {
    it(`non-gate ${mode} remains admissible without fabricated failure diagnostics`, async () => {
      await nonGateControl(mode);
    }, 450_000);
  }
  it('verified long output has a UTF-8 byte cap, labeled truncation, redaction and packet-hash binding', async () => {
    await boundedDiagnosticControl();
  }, 300_000);
  it('prior diagnostic bytes participate in conservative admission before repair launch', async () => {
    await boundedDiagnosticControl(true);
  }, 300_000);
  it('unrelated historical failure is excluded from another item and its direct-invalidation repair', wrongItemControl, 450_000);
});
