"use client";

import { useCallback, useEffect, useState } from "react";
import { buildTree, collectDescendantIds, breadcrumb } from "../../lib/experience/tree";

// The `reason` codes returned by POST /api/experience/move (see
// lib/experience/tree.js's canMove) turned into copy a user can act on. Never
// shown as a bare "failed to move" - `cycle` in particular means the drop
// target was one of the dragged page's own descendants, which reads as a
// mysterious no-op unless it's named.
const MOVE_REASON_MESSAGES = {
  cycle: "A page cannot be moved inside one of its own sub-pages.",
  "self-parent": "A page cannot be its own parent.",
  "unknown-page": "That page could not be found.",
  "unknown-parent": "That destination could not be found.",
};

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

// Mirrors PageEditor.js's ANNOUNCE_TOGGLE: an invisible marker appended so
// that storing the identical error message twice in a row still produces a
// genuinely different STRING. Built explicitly rather than typed as a
// literal character in source, for the same reason PageEditor does this -
// an invisible unicode character embedded directly in a source file is easy
// to lose or mis-copy.
const ERROR_TOGGLE = String.fromCodePoint(0x200b);

function stripErrorToggle(text) {
  return typeof text === "string" && text.endsWith(ERROR_TOGGLE) ? text.slice(0, -1) : text;
}

// CRUD + move for the "Professional Experience" knowledge base, fetched from
// app/api/experience/* (chunk 1, read-only here). Mirrors the fetch-on-mount
// shape of app/components/LibraryEditor.js: a plain fetch, a 401 treated as
// "signed out" rather than an error, and a single flat `pages` array that
// lib/experience/tree.js turns into a tree on demand.
export function useExperiencePages() {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setErrorState] = useState("");

  // Every call site below calls THIS, never setErrorState directly. React
  // bails out of a setState whose new value is Object.is-equal to the old
  // one, so storing the exact same error message twice in a row (two
  // rejected moves with the same reason, back to back) would silently stop
  // reaching the DOM the second time - the Alert that renders `error` never
  // re-commits, so its role="alert" never fires again; a repeated failure
  // reads as no response at all. Toggling a trailing invisible marker
  // whenever the incoming message equals what is already stored guarantees
  // the STRING itself always genuinely changes, without widening `error`'s
  // type away from a plain string - the Alert here and DeletePageDialog's
  // `error` prop both keep working completely unchanged.
  const setError = useCallback((message) => {
    setErrorState((prev) => (!message ? message : stripErrorToggle(prev) === message ? message + ERROR_TOGGLE : message));
  }, []);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/experience");
      if (res.status === 401) {
        setSignedOut(true);
        setPages([]);
        return;
      }
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error || "Failed to load project pages.");
      setSignedOut(false);
      setPages(Array.isArray(json.pages) ? json.pages : []);
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load project pages.");
    } finally {
      setLoading(false);
    }
  }, [setError]);

  // Fetch-on-mount, same pattern as LibraryEditor.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);

  const createPage = useCallback(
    async ({ title, parentId = null } = {}) => {
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const now = new Date().toISOString();
      const siblingCount = pages.filter((p) => (p.parent_id ?? null) === (parentId ?? null)).length;
      const optimistic = {
        id: tempId,
        parent_id: parentId ?? null,
        title: title || "Untitled page",
        body: "",
        position: siblingCount,
        archived_at: null,
        created_at: now,
        updated_at: now,
      };
      setPages((prev) => [...prev, optimistic]);
      try {
        const res = await fetch("/api/experience", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: optimistic.title, parent_id: parentId ?? null }),
        });
        const json = await readJson(res);
        if (!res.ok) throw new Error(json.error || "Failed to create the page.");
        setPages((prev) => prev.map((p) => (p.id === tempId ? json.page : p)));
        return { ok: true, page: json.page };
      } catch (err) {
        setPages((prev) => prev.filter((p) => p.id !== tempId));
        const message = err.message || "Failed to create the page.";
        setError(message);
        return { ok: false, error: message };
      }
    },
    [pages, setError],
  );

  // Sends a PATCH for exactly the fields present on `fields` (an object that
  // may hold `title`, `body`, or both) in a SINGLE request, and is the
  // shared path renamePage, updatePageBody, and savePage all funnel through
  // below. Two callers that each send a single-field PATCH for what is
  // conceptually one save (a title-only request and a body-only request
  // fired independently) race: the PATCH route `.select()`s the WHOLE row
  // regardless of which fields it patched, so whichever reply lands second
  // overwrites local state with a stale snapshot of the field IT never
  // touched. Funnelling every save through one function that always sends
  // both fields together when both changed removes that race outright.
  //
  // The response merge is the second half of the same fix: it copies back
  // only the keys THIS request's `fields` actually named, never the whole
  // `json.page` wholesale. `json.page` is a full-row snapshot as of
  // whenever the server's SELECT ran, and blindly replacing the cached row
  // with it would let this reply overwrite a field some OTHER concurrent
  // write (a rename fired from a different call site, mid-flight) already
  // updated in between - the same failure mode one level up.
  const patchPage = useCallback(
    async (id, fields, defaultErrorMessage) => {
      setPages((prev) => prev.map((p) => (p.id === id ? { ...p, ...fields } : p)));
      try {
        const res = await fetch(`/api/experience/pages/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fields),
        });
        const json = await readJson(res);
        if (!res.ok) throw new Error(json.error || defaultErrorMessage);
        setPages((prev) =>
          prev.map((p) => {
            if (p.id !== id || !json.page) return p;
            const next = { ...p };
            for (const key of Object.keys(fields)) {
              if (Object.prototype.hasOwnProperty.call(json.page, key)) next[key] = json.page[key];
            }
            if (Object.prototype.hasOwnProperty.call(json.page, "updated_at")) {
              next.updated_at = json.page.updated_at;
            }
            return next;
          }),
        );
        return { ok: true, page: json.page };
      } catch (err) {
        // Deliberately no rollback: the locally-typed value stays on screen
        // (same principle as PageEditor's failed-save behaviour, chunk 3 -
        // never discard the user's own edit) and the error is surfaced
        // instead of silently reverting the text out from under them.
        const message = err.message || defaultErrorMessage;
        setError(message);
        return { ok: false, error: message };
      }
    },
    [setError],
  );

  const renamePage = useCallback(
    (id, title) => patchPage(id, { title }, "Failed to rename the page."),
    [patchPage],
  );

  const updatePageBody = useCallback(
    (id, body) => patchPage(id, { body }, "Failed to save the page."),
    [patchPage],
  );

  // The single combined save PageEditor's autosave uses: ONE PATCH carrying
  // whatever of `{ title, body }` the caller passes, rather than the two
  // independent, unawaited requests (renamePage + updatePageBody) firing
  // side by side for what PageEditor always sends as one payload containing
  // both fields.
  const savePage = useCallback(
    (id, patch) => {
      const fields = {};
      if (Object.prototype.hasOwnProperty.call(patch || {}, "title")) fields.title = patch.title;
      if (Object.prototype.hasOwnProperty.call(patch || {}, "body")) fields.body = patch.body;
      return patchPage(id, fields, "Failed to save the page.");
    },
    [patchPage],
  );

  const deletePage = useCallback(
    async (id) => {
      const doomed = new Set([id, ...collectDescendantIds(pages, id)]);
      // Captured now, from the `pages` this callback closed over, purely to
      // remember what the doomed rows themselves looked like - NOT to use as
      // a whole-array snapshot to restore later. `pages` is fixed as of
      // whenever this callback was created; the live state can move on from
      // it (another save, another delete) while this DELETE is in flight.
      const doomedRows = pages.filter((p) => doomed.has(p.id));
      setPages((prev) => prev.filter((p) => !doomed.has(p.id)));
      try {
        const res = await fetch(`/api/experience/pages/${id}`, { method: "DELETE" });
        if (!res.ok) {
          const json = await readJson(res);
          throw new Error(json.error || "Failed to delete the page.");
        }
        return { ok: true };
      } catch (err) {
        // Roll back FUNCTIONALLY: restore only the rows THIS call removed,
        // into whatever state actually is right now - not by overwriting the
        // whole array with the stale `pages` snapshot above. A plain
        // setPages(prevPages) would silently discard any OTHER write (a
        // rename, a different delete, a move) that landed on the real state
        // while this delete was in flight, since it replaces the entire
        // array with a copy that predates that write.
        setPages((prev) => {
          const remaining = prev.filter((p) => !doomed.has(p.id));
          return [...remaining, ...doomedRows];
        });
        const message = err.message || "Failed to delete the page.";
        setError(message);
        return { ok: false, error: message };
      }
    },
    [pages, setError],
  );

  const movePage = useCallback(
    async (id, newParentId, newIndex) => {
      try {
        const res = await fetch("/api/experience/move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, newParentId: newParentId ?? null, newIndex }),
        });
        const json = await readJson(res);
        if (!res.ok) {
          const message = MOVE_REASON_MESSAGES[json.reason] || json.error || "That move is not allowed.";
          setError(message);
          return { ok: false, error: message, reason: json.reason };
        }
        setPages(Array.isArray(json.pages) ? json.pages : pages);
        return { ok: true };
      } catch (err) {
        const message = err.message || "Failed to move the page.";
        setError(message);
        return { ok: false, error: message };
      }
    },
    [pages, setError],
  );

  return {
    pages,
    tree: buildTree(pages),
    loading,
    signedOut,
    error,
    setError,
    reload,
    createPage,
    renamePage,
    updatePageBody,
    savePage,
    deletePage,
    movePage,
    breadcrumbFor: (id) => breadcrumb(pages, id),
    descendantsOf: (id) => collectDescendantIds(pages, id),
  };
}
