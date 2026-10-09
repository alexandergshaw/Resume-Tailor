"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { normalizeQuestion } from "@/lib/copilot/questions";
import { techTermDetailKey } from "@/lib/copilot/techTermDetailContract";
import { beginTechTermDetail, getSnapshot, getTechTermDetail, subscribe } from "@/lib/copilot/techTermDetailStore";
import { fetchTechTermDetail } from "@/lib/copilot/techTermDetailClient";
import { copilotPrefetchQueue } from "@/lib/copilot/prefetchQueue";

// THE CLIENT HALF OF "EXPAND A TECH BUZZWORD", mirroring useAnswerExpansions.js.
//
// CONTENT AND OPEN STATE ARE SEPARATE, as there. A term's explanation lives in
// the module-scope store (techTermDetailStore.js), never on a component or on a
// question entry: the copilot's transcript region swaps element types when a live
// session starts or stops, which unmounts every card's hook state under it, and a
// detail held there would silently re-buy a paid model call on a tab flick. What
// is per SURFACE, and lives here, is only which chips are open. That split is what
// makes closing a chip while its request is in flight legal and NOT a cancel: the
// response still lands in the store, and because writing a record does not set
// `open`, a slow response can never reopen a chip the reader closed.
//
// THE ONE SUBSCRIPTION IS PER SURFACE, not per chip: this hook is called once by
// TechTermDetailScope (mounted where the question list lives), and every chip
// reaches the api through context. Subscribing inside each card would wake every
// card on every store write.
//
// WHY THE QUESTION IS RESOLVED FROM THE TERM. A chip knows only its own text; the
// detail route needs a non-empty question and the store key carries it, so the
// scope indexes every answer's ready terms by their own text once and a chip
// resolves itself. When two answers suggested the same term the LAST one wins,
// the more recent answer being the one on screen now. A term that no answer in the
// scope suggested resolves to nothing and its chip is inert: a control that could
// not name the question it belongs to could only explain the wrong thing.

const TechTermDetailContext = createContext(null);

/** The api the chips use, or `null` when no scope is mounted. */
export function useTechTermDetailApi() {
  return useContext(TechTermDetailContext);
}

// The route's own ceiling on the question it accepts; a longer one would be
// refused outright, so it is trimmed here instead of failing every chip.
const MAX_QUESTION_CHARS = 2000;

// normalised term -> the question of the answer that suggested it. `more` is a
// second list indexed after the first, for a surface whose answers live in two
// places (practice mode's sample answer and its detected room questions).
function indexTerms(questions, more) {
  const index = new Map();
  const entries = [...(Array.isArray(questions) ? questions : []), ...(Array.isArray(more) ? more : [])];
  for (const entry of entries) {
    const question = typeof entry?.question === "string" ? entry.question.trim().slice(0, MAX_QUESTION_CHARS) : "";
    const terms = entry?.techTerms;
    if (!question || terms?.status !== "ready" || !Array.isArray(terms.terms)) continue;
    for (const term of terms.terms) {
      const key = typeof term === "string" ? normalizeQuestion(term) : "";
      if (key) index.set(key, question);
    }
  }
  return index;
}

function useTechTermDetails({ questions, extraQuestions, request, onDetailOutcome } = {}) {
  // Referentially stable while nothing has been written, which is what
  // useSyncExternalStore requires and what stops a re-render loop. The value is
  // kept (not discarded) because it is also a dependency of the api memo below:
  // the api's methods read the store at call time, so without a changing
  // identity a store write would re-render this scope but leave every chip
  // reading through context on its last render, with a settled explanation
  // sitting in the store and "Looking that up" still on screen.
  const storeVersion = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const [open, setOpen] = useState(() => new Set());

  // Held in a ref so a caller handing over a new function each render changes the
  // identity of nothing below.
  const onOutcomeRef = useRef(onDetailOutcome);
  useEffect(() => {
    onOutcomeRef.current = onDetailOutcome;
  }, [onDetailOutcome]);

  // Keys whose outcome has already been reported to the session log. See
  // reportWhenSettled below.
  const loggedRef = useRef(new Set());

  const index = useMemo(() => indexTerms(questions, extraQuestions), [questions, extraQuestions]);
  const applicationId = request?.applicationId ?? "";
  const engine = request?.engine ?? "";

  const resolve = useCallback(
    (term) => {
      const text = typeof term === "string" ? term.trim() : "";
      if (!text) return null;
      const question = index.get(normalizeQuestion(text));
      if (!question) return null;
      const payload = { term: text, question, applicationId, engine };
      return { key: techTermDetailKey(payload), payload };
    },
    [index, applicationId, engine],
  );

  return useMemo(() => {
    // THE SESSION LOG RECORDS TERMS THE CANDIDATE OPENED, NOT TERMS THAT WERE
    // WARMED. A prefetch issues the request before any click, so by the time the
    // candidate opens a term its record is already loading or settled and the
    // request this call would issue is a no-op: the old "log the request this call
    // issued" gate would never fire for a warmed term. So the report is driven by
    // the OPEN instead, once per key for the scope's lifetime (loggedRef), and it
    // reads the OBSERVED terminal outcome: straight from the store when the record
    // has already settled (a warmed term), otherwise on the first terminal write.
    // Prefetch never comes through here.
    const reportWhenSettled = (key, term) => {
      const settled = (record) => record.status !== "idle" && record.status !== "loading";
      const emit = (record) => {
        try {
          onOutcomeRef.current?.({ term, status: record.status, code: record.code });
        } catch {
          // Logging is a supplement; nothing here may interrupt the reader.
        }
      };
      const current = getTechTermDetail(key);
      if (settled(current)) {
        emit(current);
        return;
      }
      const unsubscribe = subscribe(() => {
        const record = getTechTermDetail(key);
        if (record.status === "idle") {
          // Evicted or reset while in flight: nothing will ever settle it.
          unsubscribe();
          return;
        }
        if (settled(record)) {
          unsubscribe();
          emit(record);
        }
      });
    };

    const start = (term, options) => {
      const resolved = resolve(term);
      if (!resolved) return;
      beginTechTermDetail({ key: resolved.key, request: resolved.payload }, fetchTechTermDetail, options);
      if (loggedRef.current.has(resolved.key)) return;
      loggedRef.current.add(resolved.key);
      reportWhenSettled(resolved.key, resolved.payload.term);
    };
    return {
      resolves: (term) => resolve(term) !== null,
      // The resolved store key, or null when no answer in the scope suggested the
      // term. A chip hands it to useWarmOnMount as the warm key: a stable string,
      // so the warm fires once per term and not once per store write.
      keyFor: (term) => resolve(term)?.key ?? null,
      // WARM THE CACHE WITHOUT OPENING ANYTHING, and without reporting: a warm is
      // not an open (see reportWhenSettled). Goes through the shared throttle, then
      // beginTechTermDetail, whose loading-record guard makes a click that follows
      // issue no second request. A click does NOT come through here: toggle and
      // retry call beginTechTermDetail directly.
      prefetch: (term) => {
        const resolved = resolve(term);
        if (!resolved) return;
        copilotPrefetchQueue.enqueue(resolved.key, () =>
          beginTechTermDetail({ key: resolved.key, request: resolved.payload }, fetchTechTermDetail),
        );
      },
      get: (term) => {
        const resolved = resolve(term);
        return resolved ? getTechTermDetail(resolved.key) : null;
      },
      isOpen: (term) => {
        const resolved = resolve(term);
        return resolved ? open.has(resolved.key) : false;
      },
      toggle: (term) => {
        const resolved = resolve(term);
        if (!resolved) return;
        setOpen((previous) => {
          const next = new Set(previous);
          if (next.has(resolved.key)) next.delete(resolved.key);
          else next.add(resolved.key);
          return next;
        });
        // Opening asks; closing does not. A settled record makes this a no-op,
        // which is what makes collapse-then-reopen cost nothing.
        if (!open.has(resolved.key)) start(term);
      },
      retry: (term) => start(term, { retry: true }),
      // Carried so a store write gives the api (and so the context value) a new
      // identity; nothing reads it.
      version: storeVersion.version,
    };
  }, [resolve, open, storeVersion]);
}

/**
 * Mounts one api for everything rendered inside it. Placed at the component
 * that owns the question list, never per card.
 *
 * `questions` is the surface's own answer list (`extraQuestions`, optional, a
 * second one); `request` is the grounding the answers were drafted under
 * (applicationId, engine). `onDetailOutcome`, when
 * given, is told `{ term, status, code }` once per term, when the candidate
 * first opens it (never for a background prefetch), which is what the session
 * log records: the term and the outcome, never the explanation or the question.
 */
export function TechTermDetailScope({ questions, extraQuestions, request, onDetailOutcome, children }) {
  const api = useTechTermDetails({ questions, extraQuestions, request, onDetailOutcome });
  return createElement(TechTermDetailContext.Provider, { value: api }, children);
}
