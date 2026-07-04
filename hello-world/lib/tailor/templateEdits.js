// Client-side bridge that pushes promoted recurring hand-edits into the user's
// server-side library (their persistent "template") and removes ones an undo took
// back. Best-effort by design: signed-out users (401) and offline failures simply
// leave the rule un-persisted, so the device-local overlay (promotedEditRules) keeps
// auto-applying it — nothing is lost, it just isn't baked into the template yet.

import { markEditRulePersisted } from "./localSignals";

// Persist newly-consistent rules and un-persist undone ones. Never throws.
export async function syncTemplateEdits({ add = [], remove = [], storage } = {}) {
  for (const rule of add) {
    try {
      const res = await fetch("/api/library/edit-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ before: rule.before, after: rule.after ?? "" }),
      });
      // A saved rule (or an idempotent re-save) is now owned by the template.
      if (res.ok) markEditRulePersisted(rule, storage ? { storage } : undefined);
      // 401 / offline: leave it for the local overlay to keep applying.
    } catch {
      /* network failure — the overlay still covers it */
    }
  }
  for (const rule of remove) {
    try {
      const qs = new URLSearchParams({ before: rule.before, after: rule.after ?? "" });
      await fetch(`/api/library/edit-rules?${qs.toString()}`, { method: "DELETE" });
    } catch {
      /* best-effort: a leftover template rule can still be removed via /library */
    }
  }
}
