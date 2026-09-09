"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

import {
  EMPTY_GLOSSARY_INDEX,
  buildGlossaryIndex,
  glossaryMarksFor,
} from "@/lib/copilot/glossaryMatch";
import { glossaryPanelState } from "@/lib/copilot/glossaryPanel";

// THE POSTING GLOSSARY, HELD ONCE, REACHED THROUGH CONTEXT.
//
// ---------------------------------------------------------------------------
// WHY CONTEXT AND NOT A PROP (AC-M2)
// ---------------------------------------------------------------------------
// `AnswerLines` is rendered from three places -- QuestionFeed.js,
// practice/SampleAnswer.js and dashboard/CopilotDashboard.js. Threading a
// `marks` prop through all three would mean editing all three, and each edit
// is a chance to pass a different shape. Context with a FROZEN EMPTY DEFAULT
// means none of them changes at all, and a render with no provider mounted
// yields exactly zero marks rather than throwing -- which is what keeps
// AnswerLines.emphasis.test.js, AnswerLines.expansion.test.js and
// AnswerLines.citation.test.js green without one byte of edit to any of them.
//
// ---------------------------------------------------------------------------
// FETCHED ONCE PER POSTING, AND NEVER POLLED (AC-T10, AC-T11)
// ---------------------------------------------------------------------------
// One GET when the posting is selected. Not per answer, not per question, not
// per hover -- a hover is an in-memory lookup, which is what makes the hover
// surface cost zero outbound requests and disclose nothing to a publisher
// about what a candidate is looking up.
//
// And it is NOT polled while a posting is still being researched. This repo
// can poll (useDriveDocuments.js does, for an OAuth popup the user is staring
// at) and that is the wrong shape here: a 3-second poll during a live
// interview is network traffic, re-renders and a moving panel, for the benefit
// of watching "61 of 120" become "73 of 120" -- which no candidate needs
// mid-answer. The marks a reader already has keep working, and a page revisit
// picks up whatever the worker has finished. Stated as a ruling so it is not
// added later as a courtesy.
//
// ---------------------------------------------------------------------------
// A FAILED READ IS AN EMPTY GLOSSARY, NOT AN ERROR (AC-T7)
// ---------------------------------------------------------------------------
// Nothing here can make a bullet render differently on failure: no spinner on a
// bullet, no placeholder underline, no "researching..." caption, no skeleton.
// The copilot is read DURING a live interview and a bullet that changes shape
// under the reader's eyes is worse than a bullet with no marks at all.

const EMPTY_VALUE = Object.freeze({ index: EMPTY_GLOSSARY_INDEX, row: null });

const GlossaryContext = createContext(EMPTY_VALUE);

/**
 * The pure provider: takes terms already in hand and builds the index. Used by
 * `GlossaryProvider` below once its read lands, and directly by tests, which is
 * what lets the composition contract be exercised without a network.
 */
export function GlossaryScope({ terms, row = null, children }) {
  const value = useMemo(
    () => Object.freeze({ index: buildGlossaryIndex(terms), row: row || null }),
    [terms, row],
  );
  return <GlossaryContext.Provider value={value}>{children}</GlossaryContext.Provider>;
}

/** The closed vocabulary for the selected posting; a frozen empty one by default. */
export function useGlossaryIndex() {
  return useContext(GlossaryContext).index;
}

/**
 * The marks one rendered line may show: found once over the whole point,
 * partitioned by the emphasis boundary, straddlers dropped, then capped.
 */
export function useGlossaryMarks() {
  const index = useGlossaryIndex();
  return useMemo(
    () => (point, emphasis) => glossaryMarksFor(point, index, emphasis).marks,
    [index],
  );
}

/**
 * AC-T8's one line of visible state, for whichever shell renders the "Terms for
 * this posting" section. The row itself is deliberately not exposed: a caller
 * that read `researched_count` directly would be a second, drifting copy of the
 * sixteen-state decision.
 */
export function useGlossaryPanel(options) {
  const { row } = useContext(GlossaryContext);
  return glossaryPanelState(row, options);
}

/**
 * Reads the selected posting's glossary once and holds it.
 *
 * @param {{applicationId?: string, positionId?: string, children: any}} props
 */
export function GlossaryProvider({ applicationId, positionId, children }) {
  // The KEY is stored alongside the row rather than the row alone, so that
  // switching postings does not need a synchronous `setRow(null)` inside the
  // effect to clear the previous one. That clearing is derived below instead:
  // a setState in an effect body is a cascading render, and on this surface it
  // would be one per posting change during a live session.
  const [loaded, setLoaded] = useState({ key: "", row: null });

  // `applicationId` is the key the copilot actually holds: postings.js's
  // `normalizePostingRows` drops `position.id`, so the practice picker's client
  // has `applications.id` and nothing else. The route resolves either.
  const key = applicationId || positionId || "";

  useEffect(() => {
    if (!key) return undefined;
    let cancelled = false;
    const param = applicationId ? "applicationId" : "positionId";
    // ONE request. No interval, no retry loop, no revalidation on focus.
    fetch(`/api/copilot/glossary?${param}=${encodeURIComponent(key)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (!cancelled) setLoaded({ key, row: body?.glossary || null });
      })
      .catch(() => {
        // Swallowed on purpose: an unreachable glossary must leave the answer
        // exactly as it would have been without this feature.
        if (!cancelled) setLoaded({ key, row: null });
      });
    return () => {
      cancelled = true;
    };
  }, [key, applicationId]);

  // The previous posting's terms are never shown against a new posting: a
  // stale row here would mark the wrong words in a live answer.
  const row = loaded.key === key ? loaded.row : null;

  return (
    <GlossaryScope terms={row?.terms} row={row}>
      {children}
    </GlossaryScope>
  );
}
