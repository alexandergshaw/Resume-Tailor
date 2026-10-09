"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  listLibraryTemplates,
  selectLibraryTemplate,
  deleteLibraryTemplate,
} from "../../lib/document/templateLibraryClient";

// N151b: the state behind the "Template library" switcher panel -- the signed-in
// user's saved formatting templates for one kind, and which of them is the ACTIVE
// one (the explicit template_selections pointer; null when none is selected).
//
//   select(id)  optimistic: the pick shows at once, then the server is asked. A
//               refusal REVERTS the pick explicitly (it does not lean on the
//               follow-up refetch, which can itself fail) and surfaces the error.
//   remove(id)  deletes, then RE-READS the list. Deleting the active template
//               clears the pointer server-side (ON DELETE SET NULL), so
//               selectedId is read back, never assumed.
//   refresh()   re-reads the list. A response that has been superseded by a newer
//               request (two quick picks, a mark landing mid-flight) is dropped
//               rather than allowed to overwrite fresher state.
//
// The last list read is stored with the user and kind it belongs to, and the
// returned values are derived from it: signing out, or switching user or kind,
// shows an empty library at once instead of the previous one, with no state
// reset to run inside an effect.
//
// `kind` is a parameter so a cover-letter switcher is a later mount, not a
// rewrite; today page.js mounts it for "resume".
const NO_TEMPLATES = [];
const EMPTY_SNAPSHOT = { userId: null, kind: null, templates: NO_TEMPLATES, selectedId: null };

export function useTemplateLibrary({ currentUser, kind = "resume" }) {
  const userId = currentUser?.id ?? null;
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const [error, setError] = useState("");
  const latestRefresh = useRef(0);
  const latestSelect = useRef(0);

  const live = userId !== null && snapshot.userId === userId && snapshot.kind === kind;
  const templates = live ? snapshot.templates : NO_TEMPLATES;
  const selectedId = live ? snapshot.selectedId : null;
  // True from sign-in until the first list read for this user and kind answers.
  const loading = userId !== null && !live;

  // Take one list read into state. `keepError` lets the reconcile after a
  // REFUSED select re-read the list without wiping (or replacing) the refusal
  // message the user needs to see.
  const applyRead = useCallback((forUserId, forKind, result, keepError) => {
    if (result.ok) {
      setSnapshot({
        userId: forUserId,
        kind: forKind,
        templates: result.templates,
        selectedId: result.selectedId,
      });
      if (!keepError) setError("");
      return;
    }
    // A failed FIRST read still ends the loading state (an empty, answered
    // snapshot); a failed re-read leaves the list it already has.
    setSnapshot((prev) => (
      prev.userId === forUserId && prev.kind === forKind
        ? prev
        : { ...EMPTY_SNAPSHOT, userId: forUserId, kind: forKind }
    ));
    if (!keepError) setError(result.error);
  }, []);

  const refresh = useCallback(async ({ keepError = false } = {}) => {
    if (userId === null) return;
    const requestId = ++latestRefresh.current;
    const result = await listLibraryTemplates(kind);
    if (requestId !== latestRefresh.current) return;
    applyRead(userId, kind, result, keepError);
  }, [userId, kind, applyRead]);

  const select = useCallback(async (templateId) => {
    if (userId === null || !templateId) return;
    const selectId = ++latestSelect.current;
    // An in-flight list read predates this pick; it must not undo it.
    latestRefresh.current += 1;
    const previous = selectedId;
    const patch = (fields) => setSnapshot((prev) => (
      prev.userId === userId && prev.kind === kind ? { ...prev, ...fields } : prev
    ));
    setError("");
    patch({ selectedId: templateId });
    const result = await selectLibraryTemplate({ kind, templateId });
    if (!result.ok) {
      // Only the newest pick reverts: an older refusal arriving late must not
      // knock a newer, accepted pick back off the screen.
      if (selectId === latestSelect.current) patch({ selectedId: previous });
      setError(result.error);
    }
    await refresh({ keepError: !result.ok });
  }, [userId, kind, selectedId, refresh]);

  const remove = useCallback(async (templateId) => {
    if (userId === null || !templateId) return;
    setError("");
    const result = await deleteLibraryTemplate(templateId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await refresh();
  }, [userId, refresh]);

  // Load on sign-in, and again if the user or the kind changes. The load is
  // inline (not a call to refresh) so no state is set from the effect body: the
  // read lands asynchronously, and a stale or cancelled one is dropped.
  useEffect(() => {
    if (userId === null) return undefined;
    let cancelled = false;
    (async () => {
      const requestId = ++latestRefresh.current;
      const result = await listLibraryTemplates(kind);
      if (cancelled || requestId !== latestRefresh.current) return;
      applyRead(userId, kind, result, false);
    })();
    return () => { cancelled = true; };
  }, [userId, kind, applyRead]);

  return {
    templates,
    selectedId,
    loading,
    error: userId === null ? "" : error,
    refresh,
    select,
    remove,
  };
}
