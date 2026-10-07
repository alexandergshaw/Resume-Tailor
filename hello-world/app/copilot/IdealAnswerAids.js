"use client";

import { createContext, useContext } from "react";

import { useEngine } from "@/app/settings/engine";
import AnswerAids from "./AnswerAids";
import { useIdealProject } from "./useIdealProject";

// N125: AnswerAids with its worked example sourced from useIdealProject — the
// ONLY thing that feeds `idealProject`/`idealProjectTailored` on the four
// places a drafted answer's aids render (QuestionFeed's card, CopilotDashboard's
// current-answer panel and its history item, practice's SampleAnswer). No site
// passes a draft's own `idealProject` any more: the answer response, the live
// stream's done frame and practice's queued cache entry all still CARRY one
// (for contract stability), but a frozen copy rendered beside the hook's would
// be a SECOND example on the same card, so none of them is read for display.
//
// WHY A WRAPPER, AND WHY CONTEXT FOR THE APPLICATION ID. The hook cannot be
// called conditionally, and every one of those sites renders AnswerAids behind
// a condition (a card that is `done`, a panel that is revealed, an item that is
// expanded) — so the hook has to live in a component that exists exactly when
// the aids do, which is this one. The selected posting's id is reached through
// context for the reason GlossaryProvider.js records for the glossary: threading
// a prop through all four sites means editing all four, and each edit is a
// chance to pass a different value. The frozen EMPTY default means a render
// with no provider mounted asks for nothing and shows no example, rather than
// throwing — which is also what keeps every existing suite that renders one of
// these surfaces without a provider green with no edit.
const IdealProjectContext = createContext("");

/**
 * Provides the selected posting's application id to every IdealAnswerAids
 * beneath it. Mounted once per client shell (CopilotClient, PracticeClient),
 * beside the GlossaryProvider that already takes the same id.
 *
 * @param {{applicationId?: string, children: any}} props
 */
export function IdealProjectScope({ applicationId, children }) {
  return <IdealProjectContext.Provider value={applicationId || ""}>{children}</IdealProjectContext.Provider>;
}

/**
 * @param {{buzzwords?: string[], anchor?: object|null, question?: string}} props
 *   `question` is the text the example is asked for — the card's, the panel's
 *   or the item's own, never a neighbour's.
 */
export default function IdealAnswerAids({ buzzwords, anchor, question }) {
  const applicationId = useContext(IdealProjectContext);
  const { engine } = useEngine();
  const { ready, tailored, tailoredStatus } = useIdealProject({ applicationId, question, engine });
  return (
    <AnswerAids
      buzzwords={buzzwords}
      anchor={anchor}
      idealProject={ready}
      idealProjectTailored={tailored}
      tailoredStatus={tailoredStatus}
    />
  );
}
