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
import {
  PROJECT_BULLET_MAX_CHARS,
  PROJECT_SIBLINGS_MAX,
  PROJECT_TITLE_MAX_CHARS,
  projectBulletDetailKey,
} from "@/lib/copilot/projectBulletDetailContract";
import {
  beginProjectBulletDetail,
  getProjectBulletDetail,
  getSnapshot,
  subscribe,
} from "@/lib/copilot/projectBulletDetailStore";
import { fetchProjectBulletDetail } from "@/lib/copilot/projectBulletDetailClient";
import { copilotPrefetchQueue } from "@/lib/copilot/prefetchQueue";

// THE CLIENT HALF OF "MORE DETAIL ON AN EXAMPLE-PROJECT BULLET", mirroring
// useTechTermDetails.js.
//
// CONTENT AND OPEN STATE ARE SEPARATE, as there. A bullet's elaboration lives in
// the module-scope store (projectBulletDetailStore.js), never on a component or
// on a question entry: the copilot's transcript region swaps element types when a
// live session starts or stops, which unmounts every card's hook state under it,
// and a detail held there would silently re-buy a paid model call on a tab flick.
// What is per SURFACE, and lives here, is only which bullets are open. That split
// is what makes closing a bullet while its request is in flight legal and NOT a
// cancel: the response still lands in the store, and because writing a record does
// not set `open`, a slow response can never reopen a bullet the reader closed.
//
// THE ONE SUBSCRIPTION IS PER SURFACE, not per bullet: this hook is called once by
// ProjectBulletDetailScope (mounted where the question list lives), and every
// bullet reaches the api through context. Subscribing inside each bullet would
// wake every bullet on every store write.
//
// WHY THE QUESTION AND THE PROJECT ARE RESOLVED FROM THE BULLET. A bullet knows
// only its title, its index and its own text; the detail route needs a non-empty
// question and the project's other bullets, and the store key carries the
// question, so the scope indexes every answer's ready example projects once and a
// bullet resolves itself. An example entry carries no id and no version, so the
// index is keyed on its CONTENT (title, index, bullet text). When two answers
// showed the same bullet the LAST one wins, the more recent answer being the one
// on screen now. A bullet that no answer in the scope showed resolves to nothing
// and renders nothing: a control that could not name the question it belongs to
// could only elaborate the wrong thing.

const ProjectBulletDetailContext = createContext(null);

/** The api the bullets use, or `null` when no scope is mounted. */
export function useProjectBulletDetailApi() {
  return useContext(ProjectBulletDetailContext);
}

// The route's own ceiling on the question it accepts; a longer one would be
// refused outright, so it is trimmed here instead of failing every bullet.
const MAX_QUESTION_CHARS = 2000;

// The shape AnswerAids renders: a title and at least one bullet, every bullet a
// non-empty string. Kept in step with AnswerAids.js's own guard, and ONLY ready
// examples are indexed, so a pending or failed row never gets a control.
function isShownExample(entry) {
  return (
    !!entry &&
    entry.status === "ready" &&
    typeof entry.title === "string" &&
    entry.title.trim() !== "" &&
    Array.isArray(entry.bullets) &&
    entry.bullets.length > 0 &&
    entry.bullets.every((b) => typeof b === "string" && b.trim() !== "")
  );
}

// normalised title :: index :: normalised bullet -> everything the request needs.
// The index and the text are both in the key so two byte-identical bullets of one
// project stay apart and a regenerated pool never resolves a stale one.
function indexKeyFor(title, bulletIndex, bullet) {
  return `${normalizeQuestion(title)}::${bulletIndex}::${normalizeQuestion(bullet)}`;
}

// `more` is a second list indexed after the first, for a surface whose answers
// live in two places (practice mode's sample answer and its detected room
// questions). Only values the route would accept are indexed: an over-long title
// or bullet is refused there, so it is left without a control here instead of
// buying a request that can only fail.
function indexBullets(questions, more) {
  const index = new Map();
  const entries = [...(Array.isArray(questions) ? questions : []), ...(Array.isArray(more) ? more : [])];
  for (const entry of entries) {
    const question = typeof entry?.question === "string" ? entry.question.trim().slice(0, MAX_QUESTION_CHARS) : "";
    if (!question) continue;
    for (const example of [entry?.projectExample, entry?.projectExampleLive]) {
      if (!isShownExample(example)) continue;
      const title = example.title.trim();
      if (title.length > PROJECT_TITLE_MAX_CHARS) continue;
      const competency = typeof example.competency === "string" ? example.competency : "";
      example.bullets.forEach((raw, bulletIndex) => {
        const bullet = raw.trim();
        if (bullet.length > PROJECT_BULLET_MAX_CHARS) return;
        index.set(indexKeyFor(title, bulletIndex, bullet), {
          question,
          title,
          competency,
          bullet,
          bulletIndex,
          siblingBullets: example.bullets
            .filter((_, j) => j !== bulletIndex)
            .map((sibling) => sibling.trim())
            .slice(0, PROJECT_SIBLINGS_MAX),
        });
      });
    }
  }
  return index;
}

function useProjectBulletDetails({ questions, extraQuestions, request, onDetailOutcome } = {}) {
  // Referentially stable while nothing has been written, which is what
  // useSyncExternalStore requires and what stops a re-render loop. The value is
  // kept (not discarded) because it is also a dependency of the api memo below:
  // the api's methods read the store at call time, so without a changing
  // identity a store write would re-render this scope but leave every bullet
  // reading through context on its last render, with a settled elaboration
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

  const index = useMemo(() => indexBullets(questions, extraQuestions), [questions, extraQuestions]);
  const applicationId = request?.applicationId ?? "";
  const engine = request?.engine ?? "";

  // THE ONE PLACE A BULLET BECOMES A STORE KEY. The warm (keyFor, prefetch) and the
  // click (toggle, retry) both go through here, so they cannot compute different
  // keys: a click after a warm finds the warm's record and issues no second paid
  // request.
  const resolve = useCallback(
    (descriptor) => {
      const title = typeof descriptor?.title === "string" ? descriptor.title.trim() : "";
      const bullet = typeof descriptor?.bullet === "string" ? descriptor.bullet.trim() : "";
      if (!title || !bullet || !Number.isInteger(descriptor?.bulletIndex)) return null;
      const found = index.get(indexKeyFor(title, descriptor.bulletIndex, bullet));
      if (!found) return null;
      const payload = {
        bullet: found.bullet,
        title: found.title,
        siblingBullets: found.siblingBullets,
        bulletIndex: found.bulletIndex,
        question: found.question,
        applicationId,
        engine,
      };
      return { key: projectBulletDetailKey({ ...payload, competency: found.competency }), payload };
    },
    [index, applicationId, engine],
  );

  return useMemo(() => {
    // THE SESSION LOG RECORDS BULLETS THE CANDIDATE OPENED, NOT BULLETS THAT WERE
    // WARMED. A prefetch issues the request before any click, so by the time the
    // candidate opens a bullet its record is already loading or settled and the
    // request this call would issue is a no-op: a "log the request this call
    // issued" gate would never fire for a warmed bullet. So the report is driven
    // by the OPEN instead, once per key for the scope's lifetime (loggedRef), and
    // it reads the OBSERVED terminal outcome: straight from the store when the
    // record has already settled (a warmed bullet), otherwise on the first
    // terminal write. Prefetch never comes through here. The outcome carries the
    // status and the enumerated code and nothing else: no bullet, title, question
    // or elaboration ever reaches the callback.
    const reportWhenSettled = (key) => {
      const settled = (record) => record.status !== "idle" && record.status !== "loading";
      const emit = (record) => {
        try {
          onOutcomeRef.current?.({ status: record.status, code: record.code });
        } catch {
          // Logging is a supplement; nothing here may interrupt the reader.
        }
      };
      const current = getProjectBulletDetail(key);
      if (settled(current)) {
        emit(current);
        return;
      }
      const unsubscribe = subscribe(() => {
        const record = getProjectBulletDetail(key);
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

    const start = (descriptor, options) => {
      const resolved = resolve(descriptor);
      if (!resolved) return;
      beginProjectBulletDetail({ key: resolved.key, request: resolved.payload }, fetchProjectBulletDetail, options);
      if (loggedRef.current.has(resolved.key)) return;
      loggedRef.current.add(resolved.key);
      reportWhenSettled(resolved.key);
    };
    return {
      resolves: (descriptor) => resolve(descriptor) !== null,
      // The resolved store key, or null when no answer in the scope showed the
      // bullet. A bullet hands it to useWarmOnMount as the warm key: a stable
      // string, so the warm fires once per bullet and not once per store write.
      keyFor: (descriptor) => resolve(descriptor)?.key ?? null,
      // WARM THE CACHE WITHOUT OPENING ANYTHING, and without reporting: a warm is
      // not an open (see reportWhenSettled). Goes through the shared throttle, then
      // beginProjectBulletDetail, whose loading-record guard makes a click that
      // follows issue no second request. A click does NOT come through here:
      // toggle and retry call beginProjectBulletDetail directly.
      prefetch: (descriptor) => {
        const resolved = resolve(descriptor);
        if (!resolved) return;
        copilotPrefetchQueue.enqueue(resolved.key, () =>
          beginProjectBulletDetail({ key: resolved.key, request: resolved.payload }, fetchProjectBulletDetail),
        );
      },
      get: (descriptor) => {
        const resolved = resolve(descriptor);
        return resolved ? getProjectBulletDetail(resolved.key) : null;
      },
      isOpen: (descriptor) => {
        const resolved = resolve(descriptor);
        return resolved ? open.has(resolved.key) : false;
      },
      toggle: (descriptor) => {
        const resolved = resolve(descriptor);
        if (!resolved) return;
        setOpen((previous) => {
          const next = new Set(previous);
          if (next.has(resolved.key)) next.delete(resolved.key);
          else next.add(resolved.key);
          return next;
        });
        // Opening asks; closing does not. A settled record makes this a no-op,
        // which is what makes collapse-then-reopen cost nothing.
        if (!open.has(resolved.key)) start(descriptor);
      },
      retry: (descriptor) => start(descriptor, { retry: true }),
      // Carried so a store write gives the api (and so the context value) a new
      // identity; nothing reads it.
      version: storeVersion.version,
    };
  }, [resolve, open, storeVersion]);
}

/**
 * Mounts one api for everything rendered inside it. Placed at the component
 * that owns the question list, never per bullet.
 *
 * `questions` is the surface's own answer list (`extraQuestions`, optional, a
 * second one); `request` is the grounding the answers were drafted under
 * (applicationId, engine). `onDetailOutcome`, when given, is told
 * `{ status, code }` once per bullet, when the candidate first opens it (never
 * for a background prefetch), which is what the session log records: the outcome
 * only, never the bullet, the elaboration or the question.
 */
export function ProjectBulletDetailScope({ questions, extraQuestions, request, onDetailOutcome, children }) {
  const api = useProjectBulletDetails({ questions, extraQuestions, request, onDetailOutcome });
  return createElement(ProjectBulletDetailContext.Provider, { value: api }, children);
}
