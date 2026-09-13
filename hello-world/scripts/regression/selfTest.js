// Lane A self-test (design A-14): fires under a broken extractor or broken verdict logic, judged
// against the M-21 recordings the caller hands it. Pure: no fs, no process.
import { a7Check } from './verdict.js';

export function check(recordings) {
  for (const r of recordings) {
    const res = a7Check(r.record, r.stdout, r.root);
    if (!res.ok) return { ok: false, reason: r.tag || 'unknown', detail: res.reason };
  }
  return { ok: true };
}
