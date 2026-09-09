"use client";

import { createContext, createElement, useCallback, useContext, useMemo, useState, useSyncExternalStore } from "react";

import { expansionKey } from "@/lib/copilot/expansionContract";
import { normalizeForComparison, stripStarLabel } from "@/lib/copilot/answerPoints";
import { beginExpansion, getExpansion, getSnapshot, subscribe } from "@/lib/copilot/expansionStore";
import { fetchExpansion } from "@/lib/copilot/expansionClient";

// THE ONE PLACE THIS FEATURE SUBSCRIBES TO ITS STORE, and it is called once
// per SURFACE rather than once per bullet.
//
// THE MEASURED REASON. `answerLines()` is called unmemoized in four render
// bodies, and there is no React.memo or useMemo in the feed or the dashboard,
// so every speech-to-text frame already re-renders every card. Subscribing
// inside AnswerLines or inside the per-line control would wake N cards times
// six bullets on every store write. Two subscriptions at the top of a surface
// is two.
//
// WHY THE API TRAVELS BY CONTEXT RATHER THAN BY PROP. `<AnswerLines>` is
// rendered at three call sites, in three components this chunk is not
// permitted to edit. It takes an optional `expansion` prop as well, so a
// future surface can pass one explicitly and so tests can inject a stand-in;
// context is what lets the feature reach the existing three without touching
// them. With neither, AnswerLines renders exactly what it renders today.
//
// WHY THE QUESTION IS RESOLVED FROM THE LINE, NOT PASSED DOWN. The route needs
// the question and the answer's RAW points array (labels included) to check
// that the index really names the sentence being expanded, and `AnswerLines`
// knows neither: it receives only rendered lines. The surfaces that do know
// cannot be edited, but the component that OWNS the question list can, so the
// scope indexes every answer's points by their own rendered text once, and a
// line resolves itself. A line whose question cannot be resolved gets NO
// control at all rather than a guessed one: a control that cannot name the
// question it belongs to could only elaborate the wrong bullet.

const ExpansionContext = createContext(null);

/** The api the panel uses, or `null` when no scope is mounted. */
export function useExpansionApi() {
  return useContext(ExpansionContext);
}

// point text -> { question, points }. The LAST matching answer wins, because
// when two questions produced a byte-identical bullet the one on screen now is
// the more recent one.
function indexAnswers(questions) {
  const index = new Map();
  for (const entry of Array.isArray(questions) ? questions : []) {
    const question = typeof entry?.question === "string" ? entry.question : "";
    const points = Array.isArray(entry?.points) ? entry.points.filter((p) => typeof p === "string") : [];
    if (!question || points.length === 0) continue;
    for (const raw of points) {
      // The SAME strip answerLines performs, imported rather than copied: this
      // index has to match on exactly what the rendered line carries, and
      // questionVocabulary.js declares a different, module-private STAR-label
      // regex that an implementer who greps rather than imports would find.
      const key = normalizeForComparison(stripStarLabel(raw));
      if (key) index.set(key, { question, points });
    }
  }
  return index;
}

/**
 * The expansion api for one surface.
 *
 * `questions` is the surface's own answer list; `request` is the grounding the
 * answers were drafted under (applicationId, profile, interviewType,
 * codeLanguage, engine).
 */
export function useAnswerExpansions({ questions, request } = {}) {
  // Referentially stable while nothing has been written, which is what
  // useSyncExternalStore requires and what stops a re-render loop.
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // OPEN STATE IS PER SURFACE, and content is not. That split is the whole
  // reason collapsing a panel mid-request is legal and is NOT a cancel: the
  // response completes and writes its record, and writing a record does not
  // set `open`, so a slow response cannot reopen a panel the reader closed. It
  // also means a practice-mode Hide then Show resets what is open without
  // discarding a single paid result.
  const [open, setOpen] = useState(() => new Set());

  const index = useMemo(() => indexAnswers(questions), [questions]);

  const resolve = useCallback(
    (line) => {
      const point = typeof line?.point === "string" ? line.point : "";
      if (!point) return null;
      const found = index.get(normalizeForComparison(point));
      if (!found) return null;
      const pointIndex = Number.isInteger(line?.sourceIndex) ? line.sourceIndex : -1;
      if (pointIndex < 0 || pointIndex >= found.points.length) return null;
      const payload = {
        question: found.question,
        parentPoint: point,
        points: found.points,
        pointIndex,
        applicationId: request?.applicationId ?? "",
        profile: request?.profile ?? "",
        interviewType: request?.interviewType ?? "",
        codeLanguage: request?.codeLanguage ?? "",
        engine: request?.engine ?? "",
      };
      return { key: expansionKey({ question: found.question, parentPoint: point, request: payload }), payload };
    },
    [index, request?.applicationId, request?.profile, request?.interviewType, request?.codeLanguage, request?.engine],
  );

  return useMemo(() => {
    const start = (line, options) => {
      const resolved = resolve(line);
      if (!resolved) return;
      beginExpansion({ key: resolved.key, request: resolved.payload }, fetchExpansion, options);
    };
    return {
      resolves: (line) => resolve(line) !== null,
      get: (line) => {
        const resolved = resolve(line);
        return resolved ? getExpansion(resolved.key) : null;
      },
      isOpen: (line) => {
        const resolved = resolve(line);
        return resolved ? open.has(resolved.key) : false;
      },
      toggle: (line) => {
        const resolved = resolve(line);
        if (!resolved) return;
        setOpen((previous) => {
          const next = new Set(previous);
          if (next.has(resolved.key)) next.delete(resolved.key);
          else next.add(resolved.key);
          return next;
        });
        // Opening asks; closing does not. A settled record makes this a no-op,
        // which is what makes collapse-then-reopen cost nothing.
        if (!open.has(resolved.key)) start(line);
      },
      retry: (line) => start(line, { retry: true }),
    };
  }, [resolve, open]);
}

/**
 * Mounts one api for everything rendered inside it. Placed at the component
 * that owns the question list, never per card.
 */
export function ExpansionScope({ questions, request, children }) {
  const api = useAnswerExpansions({ questions, request });
  return createElement(ExpansionContext.Provider, { value: api }, children);
}
