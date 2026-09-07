"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SCOPE_SENTINEL, scopeKeyFor, collectScopePages } from "@/lib/experience/knowledgeScope";
import { stalenessFor, coverageFor } from "@/lib/experience/knowledgeView";
import { buildKnowledgeLog } from "@/lib/experience/knowledgeLog";
// Deliberately the RELATIVE specifier, not the "@/" alias: this repo's vitest
// setup does not unify the two into one module id, so a test that mocks the
// download helper has to name the same string the importer used
// (TechWatchPanel.js:12-15 records the same trap for its own hook).
import { triggerBlobDownload } from "../../lib/document/download.js";

// The knowledge panel's data layer: one scope's stored summary, its question
// history, the derived view over both, the per-scope UI state that survives a
// reload, and the five actions the panel can take.
//
// ------------------------------------------------------------------------
// AUTO-GENERATION IS GATED ON THE STORED ROW, NEVER ON MOUNT.
//
// app/page.js renders ExperienceTab conditionally — not `hidden`, not
// `display: none` — so the whole tab UNMOUNTS on every main-tab switch and
// every useRef, useState and "already fired" guard inside it is destroyed and
// rebuilt. The sibling digest hook's in-flight refs work only because that
// hook is instantiated in page.js, which never unmounts; copying its shape
// here would copy the shape and lose the property. ExperienceTab also reloads
// `pages` after a research batch, a meeting save and a bulk delete, so a
// mount-gated trigger re-fires on each of those too.
//
// So there are three layers, and only the first two survive an unmount:
//
//   1. THE STORED ROW, read from the table by the GET below. A row's
//      EXISTENCE is the gate — ready or failed alike — because a scope that
//      reliably fails would otherwise re-arm a paid call on every view,
//      forever. A non-null read error is NEVER treated as "no summary".
//   2. The route's own stored-row short-circuit, which is what actually
//      survives the unmount.
//   3. A per-scope in-flight ref plus a selection debounce, which dies on
//      unmount and is not the gate. Without it, arrowing down the tree fires
//      one model call per row and the user watches a summary start and
//      abandon on every keypress.
//
// ------------------------------------------------------------------------
// PERSISTENCE IS ONE KEY HOLDING A BOUNDED MAP, NOT A KEY PER SCOPE.
//
// jsdom enforces NO QUOTA AT ALL (5,000 keys written with no throw), so a
// key-per-scope design passes every behavioural test in this harness and
// fails only in production, silently, through the try/catch the repo's own
// storage idiom requires. Orphan keys for deleted pages are also unenumerable
// without a prefix scan, while one map is prunable in a single read.
//
// `open` is GLOBAL and the rest is per scope. That split is not a
// convenience: a panel whose open/closed state were per scope would change
// shape as the user arrows down the tree, and a draft that were NOT per scope
// would be destroyed by this panel's own most useful control — activating a
// citation changes the tree selection, which changes the panel's scope in the
// same frame.
//
// There is deliberately NO `storage` listener. A same-tab write fires zero
// `storage` events, so a listener only ever concerns a second tab racing over
// a half-typed question, which is worse than each tab keeping its own. Named
// as an accepted miss: last writer wins, and the cost is one retyped question.

export const KB_PANEL_STORAGE_KEY = "experience:kbPanel";
// How long the tree selection must hold still before an unasked-for model call
// is allowed to start.
export const AUTO_GENERATE_DEBOUNCE_MS = 600;
// The same window AttachmentPanel.js uses in this very directory. Exported so
// a test advances by this exact value rather than a second, drifting copy.
export const UNDO_WINDOW_MS = 5000;
// Matches the question route's own cap: a longer body is a caller that
// bypassed the field, not a user who typed too much.
export const MAX_DRAFT_CHARS = 2000;
export const MAX_REMEMBERED_SCOPES = 20;

const SUMMARY_URL = "/api/experience/knowledge";
const QUESTION_URL = "/api/experience/knowledge/question";
const JSON_HEADERS = { "Content-Type": "application/json" };

const READ_FAILED = "Your saved summary could not be read, so this panel cannot describe it.";
const GENERATE_FAILED = "The summary could not be written.";
const ASK_FAILED = "That question could not be answered.";

const DEFAULT_SCOPE_STATE = Object.freeze({ historyOpen: false, bodyExpanded: false, draft: "" });
const EMPTY_STORE = Object.freeze({ v: 1, open: true, scopes: {}, order: [] });

// An optimistic row minted client-side before the server reply lands
// (useExperiencePages.js:90). A draft written under one of these keys is
// orphaned the instant the create resolves, so it lives in memory only.
function isOptimisticKey(key) {
  return typeof key === "string" && key.startsWith("temp-");
}

function readStore() {
  if (typeof window === "undefined") return EMPTY_STORE;
  try {
    const raw = window.localStorage.getItem(KB_PANEL_STORAGE_KEY);
    if (!raw) return EMPTY_STORE;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || parsed.v !== 1) return EMPTY_STORE;
    const scopes = parsed.scopes && typeof parsed.scopes === "object" && !Array.isArray(parsed.scopes) ? parsed.scopes : {};
    return {
      v: 1,
      // Absent means expanded: a scope nobody has ever collapsed shows its
      // summary. Only an explicit `false` closes it.
      open: parsed.open !== false,
      scopes,
      order: Array.isArray(parsed.order) ? parsed.order.filter((k) => typeof k === "string") : [],
    };
  } catch {
    // A blocked, disabled or corrupted store is not worth surfacing — the
    // in-session choice still holds for this visit.
    return EMPTY_STORE;
  }
}

function writeStore(store) {
  if (typeof window === "undefined") return;
  const scopes = {};
  for (const [key, value] of Object.entries(store.scopes)) {
    if (!isOptimisticKey(key)) scopes[key] = value;
  }
  try {
    window.localStorage.setItem(
      KB_PANEL_STORAGE_KEY,
      JSON.stringify({ v: 1, open: store.open, scopes, order: store.order.filter((k) => !isOptimisticKey(k)) })
    );
  } catch {
    // Never reverts the in-session choice — see readStore.
  }
}

// Moves one scope to the front of the LRU and applies a patch to its state,
// evicting anything past the cap. Evicting the 21st scope loses only a draft
// on a scope the user has not touched in twenty selections.
function touchScope(store, scopeKey, patch) {
  const scopes = { ...store.scopes, [scopeKey]: { ...DEFAULT_SCOPE_STATE, ...(store.scopes[scopeKey] || {}), ...patch } };
  const order = [scopeKey, ...store.order.filter((k) => k !== scopeKey)].slice(0, MAX_REMEMBERED_SCOPES);
  const kept = new Set(order);
  for (const key of Object.keys(scopes)) {
    if (!kept.has(key)) delete scopes[key];
  }
  return { ...store, scopes, order };
}

function residueRemovedFrom(outcome) {
  const refused = outcome && Array.isArray(outcome.refused) ? outcome.refused : [];
  let total = 0;
  for (const entry of refused) {
    if (entry && entry.reason === "residue-removed" && Number.isInteger(entry.count)) total += entry.count;
  }
  return total;
}

/**
 * summaryViewFor(row) — which of the six things a stored summary row can be.
 *
 * FOUR OF THESE LOOK IDENTICAL FROM OUTSIDE, and three of them would render as
 * "there is nothing here" under any implementation that does not separate them
 * on purpose:
 *
 *   "content"     prose, with a coverage record behind it.
 *   "empty-scope" the scope genuinely had nothing: pagesInScope is 0.
 *   "zero-out"    input arrived and NOTHING came out. This is the state that
 *                 exposes a wiring bug: buildKnowledgeBaseBlock's `isEligible`
 *                 has no default and falls back to `() => false`, and an empty
 *                 scope, a forgotten `isEligible` and an all-ineligible scope
 *                 return a byte-identical object on every field. It is checked
 *                 FIRST, before `status`, because the route stores it as a
 *                 failure — and "failed" would hide the one fact that makes it
 *                 diagnosable.
 *   "legacy"      a row written before this feature stored a retrieval record
 *                 at all (`retrieval_outcome` is SQL NULL). It has prose and
 *                 nothing to check the prose against, so the coverage claim is
 *                 refused rather than assumed.
 *
 * Plus "failed" (an ordinary failure with its own sentence) and "none" (no row
 * yet), which are not the same as any of the four.
 */
export function summaryViewFor(row) {
  if (!row || typeof row !== "object") {
    return {
      state: "none",
      summaryText: "",
      error: "",
      counts: null,
      anomalyStage: null,
      omitted: [],
      truncatedRead: false,
      residueRemoved: 0,
      generatedAt: null,
    };
  }

  const outcome =
    row.retrieval_outcome && typeof row.retrieval_outcome === "object" && !Array.isArray(row.retrieval_outcome)
      ? row.retrieval_outcome
      : null;
  const counts = outcome && outcome.counts && typeof outcome.counts === "object" && !Array.isArray(outcome.counts) ? outcome.counts : null;

  // NAMED, never counted. The title comes from the STORED source_pages entry,
  // which is the only thing that can name a page that has since been deleted
  // from the tree — the live tree cannot resolve one that is no longer in it.
  const omitted = (Array.isArray(row.source_pages) ? row.source_pages : [])
    .filter((page) => page && page.included !== true)
    .map((page) => ({
      id: typeof page.id === "string" ? page.id : "",
      title: typeof page.title === "string" ? page.title : "",
      reason: typeof page.reason === "string" && page.reason ? page.reason : "unknown",
    }));

  const base = {
    summaryText: typeof row.summary === "string" ? row.summary : "",
    error: typeof row.error === "string" && row.error ? row.error : "",
    counts,
    anomalyStage: outcome && outcome.anomaly && typeof outcome.anomaly.stage === "string" ? outcome.anomaly.stage : null,
    omitted,
    truncatedRead: !!(outcome && outcome.truncatedRead),
    residueRemoved: residueRemovedFrom(outcome),
    generatedAt: typeof row.generated_at === "string" ? row.generated_at : null,
  };

  const inScope = counts && Number.isInteger(counts.pagesInScope) ? counts.pagesInScope : null;
  const included = counts && Number.isInteger(counts.pagesIncluded) ? counts.pagesIncluded : null;

  if (inScope !== null && included !== null && inScope > 0 && included === 0) return { ...base, state: "zero-out" };
  if (row.status === "failed") return { ...base, state: "failed" };
  if (!outcome) return { ...base, state: "legacy" };
  if (inScope === 0) return { ...base, state: "empty-scope" };
  return { ...base, state: "content" };
}

export function useKnowledgeScope({ scopePageId = null, pages, loading = false, signedOut = false, error = "" } = {}) {
  const livePages = useMemo(() => (Array.isArray(pages) ? pages : []), [pages]);
  const scopeKey = scopeKeyFor(scopePageId);
  const blocked = !!(loading || signedOut || error);

  // One state object carrying the key it belongs to, so a scope change needs
  // no synchronous reset: a stale scope's data is simply not read.
  const [data, setData] = useState({ key: null, summary: null, questions: [], hasMore: false, error: "" });
  const [store, setStore] = useState(() => readStore());
  const [busy, setBusy] = useState({ generating: false, asking: false });
  const [announcement, setAnnouncement] = useState({ text: "", seq: 0 });
  // Both of these are SCOPED VALUES, carrying the key they belong to, for the
  // same reason `data` is: a scope change must void them, and voiding them by
  // resetting state from an effect is a cascading render whose only purpose is
  // to undo something a comparison can do for free.
  const [askErrorState, setAskErrorState] = useState({ key: null, text: "" });
  const [lastAnswerState, setLastAnswerState] = useState({ key: null, id: null });
  const [pendingDelete, setPendingDelete] = useState(null);

  const inFlightRef = useRef(new Set());
  const sessionFailedRef = useRef(new Set());
  // The runs that never produced a row at all. Held in a ref, never in state,
  // so a Clear cannot null it — the stored rows a Clear deletes cannot be
  // rebuilt, but these can still be reported.
  const sessionEventsRef = useRef([]);
  const undoTimerRef = useRef(null);
  // Synced in effects, never during render: a ref written while rendering is a
  // torn read under concurrent rendering, and both of these are only ever read
  // from an event handler, which always runs after the effects for the render
  // that produced it.
  const dataRef = useRef(data);
  const busyRef = useRef(busy);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  const askError = askErrorState.key === scopeKey ? askErrorState.text : "";
  const lastAnswerId = lastAnswerState.key === scopeKey ? lastAnswerState.id : null;

  const loaded = data.key === scopeKey;
  const summary = loaded ? data.summary : null;
  const questions = useMemo(() => (loaded ? data.questions : []), [loaded, data.questions]);
  const hasMore = loaded ? data.hasMore : false;
  const loadError = loaded ? data.error : "";

  const scopeState = store.scopes[scopeKey] || DEFAULT_SCOPE_STATE;

  const announce = useCallback((text) => {
    // `seq` always increments: React bails out of a setState whose value is
    // Object.is-equal to the previous one, so two identical announcements in a
    // row would produce no DOM change at all for assistive tech to notice.
    setAnnouncement((prev) => ({ text, seq: prev.seq + 1 }));
  }, []);

  const recordEvent = useCallback((reason, kind) => {
    sessionEventsRef.current = [...sessionEventsRef.current, { reason, at: new Date().toISOString(), kind }];
  }, []);

  // ---- persisted UI state -------------------------------------------------

  useEffect(() => {
    writeStore(store);
  }, [store]);

  // PRUNE ON READ, AGAINST THE LIVE TREE, and only after a successful load.
  // Pruning during a load — `pages` initialises to [] and a failed fetch
  // leaves it [] — would wipe every draft the user has. The root sentinel has
  // no page row to match against and survives every prune; so does whatever
  // scope is selected right now, which may be an optimistic row the server has
  // not acknowledged yet.
  useEffect(() => {
    if (blocked) return;
    // Deliberately a setState from an effect, and the updater returns `prev`
    // unchanged whenever nothing is orphaned, so the cascade the rule warns
    // about happens at most once per genuine tree change. The alternative —
    // pruning lazily at read time — would leave the orphans in storage for
    // ever, which is the whole thing this exists to stop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStore((prev) => {
      const live = new Set(livePages.map((page) => page && page.id).filter(Boolean));
      const keep = (key) => key === SCOPE_SENTINEL || key === scopeKey || live.has(key);
      const scopes = {};
      let changed = false;
      for (const [key, value] of Object.entries(prev.scopes)) {
        if (keep(key)) scopes[key] = value;
        else changed = true;
      }
      const order = prev.order.filter(keep);
      if (!changed && order.length === prev.order.length) return prev;
      return { ...prev, scopes, order };
    });
  }, [livePages, blocked, scopeKey]);

  const setOpen = useCallback((value) => {
    setStore((prev) => ({ ...prev, open: typeof value === "function" ? !!value(prev.open) : !!value }));
  }, []);

  const patchScope = useCallback(
    (patch) => {
      setStore((prev) => touchScope(prev, scopeKey, patch));
    },
    [scopeKey]
  );

  const setDraft = useCallback(
    (value) => {
      const text = typeof value === "string" ? value : "";
      patchScope({ draft: text.slice(0, MAX_DRAFT_CHARS) });
    },
    [patchScope]
  );

  const setHistoryOpen = useCallback((value) => patchScope({ historyOpen: !!value }), [patchScope]);
  const setBodyExpanded = useCallback((value) => patchScope({ bodyExpanded: !!value }), [patchScope]);

  // ---- the load -----------------------------------------------------------

  useEffect(() => {
    if (blocked) return undefined;
    let cancelled = false;
    (async () => {
      const url = scopePageId ? `${SUMMARY_URL}?scopePageId=${encodeURIComponent(scopePageId)}` : SUMMARY_URL;
      try {
        const res = await fetch(url);
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          // A FAILED READ IS NEVER AN EMPTY KNOWLEDGE BASE. Reporting it as
          // one would let the auto-generation gate below fire a paid call on
          // every view until the read recovered.
          recordEvent("load-error", "summary");
          setData({ key: scopeKey, summary: null, questions: [], hasMore: false, error: body?.error || READ_FAILED });
          return;
        }
        setData({
          key: scopeKey,
          summary: body?.summary || null,
          questions: Array.isArray(body?.questions) ? body.questions : [],
          hasMore: !!body?.hasMore,
          error: "",
        });
      } catch {
        if (cancelled) return;
        recordEvent("load-error", "summary");
        setData({ key: scopeKey, summary: null, questions: [], hasMore: false, error: READ_FAILED });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scopeKey, scopePageId, blocked, recordEvent]);

  // ---- derived view -------------------------------------------------------

  const scope = useMemo(() => {
    const { scopePages } = collectScopePages(livePages, scopePageId);
    const self = scopePageId ? livePages.find((page) => page && page.id === scopePageId) : null;
    return {
      pageId: scopePageId || null,
      title: self && typeof self.title === "string" ? self.title : null,
      pageCount: scopePages.length,
    };
  }, [livePages, scopePageId]);

  const view = useMemo(() => summaryViewFor(summary), [summary]);
  const coverage = useMemo(() => coverageFor(summary?.source_pages, summary?.retrieval_outcome), [summary]);
  // Memoised on [pages, source_pages] because buildTree is recomputed on every
  // render of useExperiencePages and descendantsOf rebuilds its map on every
  // call. Measured at 0.66 ms p50 for 1000 pages — a useMemo, not architecture,
  // and the number is recorded so nobody optimises it further.
  const staleness = useMemo(() => stalenessFor(summary?.source_pages, livePages), [summary, livePages]);

  const lastAnswer = useMemo(
    () => (lastAnswerId ? questions.find((row) => row && row.id === lastAnswerId) || null : null),
    [lastAnswerId, questions]
  );

  // ---- generating ---------------------------------------------------------

  const runGenerate = useCallback(
    async ({ force }) => {
      if (inFlightRef.current.has(scopeKey)) return;
      inFlightRef.current.add(scopeKey);
      setBusy((prev) => ({ ...prev, generating: true }));
      announce(`Writing a summary of ${scope.pageCount} page${scope.pageCount === 1 ? "" : "s"}…`);
      const payload = force ? { scopePageId, force: true } : { scopePageId };
      try {
        const res = await fetch(SUMMARY_URL, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(payload) });
        const body = await res.json().catch(() => ({}));
        // A row came back on the failure paths too — the route writes one on
        // every path that got far enough to have something to say — so it is
        // stored either way and the panel reads its status.
        if (body && body.summary) {
          setData((prev) => (prev.key === scopeKey ? { ...prev, summary: body.summary, error: "" } : prev));
        }
        if (res.ok) {
          announce("Summary updated.");
        } else {
          sessionFailedRef.current.add(scopeKey);
          if (!body || !body.summary) recordEvent("write-failed", "summary");
          setData((prev) => (prev.key === scopeKey && (!body || !body.summary) ? { ...prev, error: body?.error || GENERATE_FAILED } : prev));
          announce(GENERATE_FAILED);
        }
      } catch {
        sessionFailedRef.current.add(scopeKey);
        recordEvent("model-timeout", "summary");
        setData((prev) => (prev.key === scopeKey ? { ...prev, error: GENERATE_FAILED } : prev));
        announce(GENERATE_FAILED);
      } finally {
        inFlightRef.current.delete(scopeKey);
        setBusy((prev) => ({ ...prev, generating: false }));
      }
    },
    [announce, recordEvent, scopeKey, scopePageId, scope.pageCount]
  );

  const generate = useCallback(() => runGenerate({ force: true }), [runGenerate]);

  // THE AUTO TRIGGER. Every clause here is a bill if it is dropped.
  useEffect(() => {
    if (blocked) return undefined;
    // A collapsed panel is the user saying they do not want this.
    if (!store.open) return undefined;
    // The load must have completed FOR THIS SCOPE. `summary === null` before
    // the read lands is indistinguishable from "no row exists".
    if (!loaded || loadError) return undefined;
    // The row's EXISTENCE is the gate — ready or failed alike.
    if (summary) return undefined;
    if (inFlightRef.current.has(scopeKey) || sessionFailedRef.current.has(scopeKey)) return undefined;
    const timer = setTimeout(() => {
      runGenerate({ force: false });
    }, AUTO_GENERATE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [blocked, store.open, loaded, loadError, summary, scopeKey, runGenerate]);

  // ---- asking -------------------------------------------------------------

  const ask = useCallback(async () => {
    const question = (scopeState.draft || "").trim();
    if (!question || busyRef.current.asking) return;
    setBusy((prev) => ({ ...prev, asking: true }));
    setAskErrorState({ key: scopeKey, text: "" });
    announce(`Looking through ${scope.pageCount} page${scope.pageCount === 1 ? "" : "s"}…`);
    try {
      const res = await fetch(QUESTION_URL, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ scopePageId, question }),
      });
      const body = await res.json().catch(() => ({}));
      if (body && body.question) {
        setData((prev) => (prev.key === scopeKey ? { ...prev, questions: [body.question, ...prev.questions] } : prev));
        setLastAnswerState({ key: scopeKey, id: body.question.id || null });
      }
      if (res.ok) {
        // Cleared on a SUCCESSFUL submit only. A draft surviving success leaves
        // the just-asked question in the field, where a second Enter silently
        // re-asks it.
        setDraft("");
        announce("Answer ready.");
      } else {
        if (!body || !body.question) recordEvent("write-failed", "question");
        setAskErrorState({ key: scopeKey, text: body?.error || ASK_FAILED });
        announce(ASK_FAILED);
      }
    } catch {
      recordEvent("model-timeout", "question");
      setAskErrorState({ key: scopeKey, text: ASK_FAILED });
      announce(ASK_FAILED);
    } finally {
      setBusy((prev) => ({ ...prev, asking: false }));
    }
  }, [announce, recordEvent, scopeState.draft, scopeKey, scopePageId, scope.pageCount, setDraft]);

  // ---- removing -----------------------------------------------------------

  const finalizeDelete = useCallback(async (id) => {
    undoTimerRef.current = null;
    setPendingDelete(null);
    try {
      await fetch(QUESTION_URL, { method: "DELETE", headers: JSON_HEADERS, body: JSON.stringify({ id }) });
    } catch {
      // The row is already gone from view and the undo window has closed;
      // a reload is the recovery, and surfacing this would be noise about
      // something the user cannot act on.
    }
  }, []);

  // ONE CLICK, THEN AN UNDO — never a confirm. Inside the window nothing has
  // been destroyed, so the repo's own rule (confirm only when the action
  // destroys the only copy) is satisfied rather than excepted, and an undo is
  // strictly stronger than a confirm: it covers the mis-click AND the changed
  // mind, at one click instead of two.
  const removeQuestion = useCallback(
    (id) => {
      const current = dataRef.current;
      const index = current.questions.findIndex((row) => row && row.id === id);
      if (index === -1) return;
      const row = current.questions[index];
      // A second removal inside an open window commits the first one rather
      // than dropping it: two pending deletes and one Undo control would make
      // it ambiguous which row comes back.
      if (undoTimerRef.current) {
        clearTimeout(undoTimerRef.current);
        const previous = pendingDelete;
        if (previous) finalizeDelete(previous.id);
      }
      setData((prev) => ({ ...prev, questions: prev.questions.filter((entry) => entry && entry.id !== id) }));
      setPendingDelete({ id, question: typeof row.question === "string" ? row.question : "", row, index });
      announce("Question removed. Undo is available for five seconds.");
      undoTimerRef.current = setTimeout(() => finalizeDelete(id), UNDO_WINDOW_MS);
    },
    [announce, finalizeDelete, pendingDelete]
  );

  const undoDelete = useCallback(() => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setPendingDelete((prev) => {
      if (!prev) return null;
      setData((current) => {
        const next = [...current.questions];
        next.splice(Math.min(prev.index, next.length), 0, prev.row);
        return { ...current, questions: next };
      });
      return null;
    });
    announce("Question restored.");
  }, [announce]);

  useEffect(
    () => () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    },
    []
  );

  // BULK CLEAR DOES CONFIRM (in the component): per-row undo cannot restore a
  // set the user can no longer enumerate.
  const clearQuestions = useCallback(async () => {
    try {
      const res = await fetch(QUESTION_URL, {
        method: "DELETE",
        headers: JSON_HEADERS,
        body: JSON.stringify({ scopePageId, all: true }),
      });
      if (res.ok) {
        setData((prev) => (prev.key === scopeKey ? { ...prev, questions: [], hasMore: false } : prev));
        announce("Question history cleared for this scope.");
      } else {
        announce("The question history could not be cleared.");
      }
    } catch {
      announce("The question history could not be cleared.");
    }
  }, [announce, scopeKey, scopePageId]);

  // ---- the log ------------------------------------------------------------

  // Rebuilt from the stored rows at download time, never accumulated in
  // component state, so it can never go stale relative to what is on screen.
  // Always available, in every state including the two where it matters most —
  // a failed generation and a zero-out.
  const downloadLog = useCallback(() => {
    const markdown = buildKnowledgeLog({
      scope: { pageId: scope.pageId, title: scope.title },
      summaryRow: summary,
      questionRows: questions,
      sessionEvents: sessionEventsRef.current,
    });
    triggerBlobDownload(new Blob([markdown], { type: "text/markdown" }), `knowledge-scope-log-${scopeKey}.md`);
  }, [questions, scope.pageId, scope.title, scopeKey, summary]);

  return {
    scope,
    summary,
    questions,
    hasMore,
    view,
    coverage,
    staleness,
    loadError,
    busy,
    announcement,
    announce,
    draft: scopeState.draft || "",
    setDraft,
    open: store.open,
    setOpen,
    historyOpen: !!scopeState.historyOpen,
    setHistoryOpen,
    bodyExpanded: !!scopeState.bodyExpanded,
    setBodyExpanded,
    lastAnswer,
    askError,
    pendingDelete,
    undoDelete,
    generate,
    ask,
    removeQuestion,
    clearQuestions,
    downloadLog,
  };
}
