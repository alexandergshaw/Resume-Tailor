"use client";

import { useCallback } from "react";
import { useCodeLanguageChange } from "./useCodeLanguage";
import { invalidateLiveAnswers, codeLanguageChangeAnnouncement } from "@/lib/copilot/choiceChangeInvalidation";
import { codeLanguageLabel } from "@/lib/copilot/codeLanguages";

// AC-C25 / CONF-1 — the live surface's language subscriber, out of
// CopilotClient.js by necessity (D-1: that file is forbidden from calling
// `discardDraftedAnswers`/`discardAnswerWork` by its own source-text test,
// and D-2: it has no line budget for a subscriber block besides). Calls the
// SAME composer chunk A's own interview-type change uses
// (`lib/copilot/choiceChangeInvalidation.js`'s `invalidateLiveAnswers`),
// CONFIGURED here, never copied — see that module's header for the duty
// list this delegates to.
//
// ORIGIN-BLIND, deliberately, and this is the one place this module departs
// from chunk A's own live-surface subscriber (`CopilotClient.js`'s
// `onInterviewTypeChanged`), which gates its redraft on
// `meta.origin === "local"`. That gate exists there because an interview-type
// change also unmounts/resets things a foreign click should not touch. A
// language change destroys nothing — it only costs a redraft — so there is
// no asymmetry for an origin gate to protect, and CONF-1's whole point is
// that a change made in ANOTHER window still leaves this window's cached
// answer stale under the language actually selected. `canRedraft` is taken
// as a plain argument and forwarded VERBATIM, never re-derived from
// `meta.origin` here: AC-A15b's origin condition is a billing constraint the
// caller already owns (CopilotClient.js computes it from `mode`), and
// re-deriving it in two places is how the two conditions drift apart.
export function useLiveCodeLanguageChange({
  canRedraft,
  clearAnswerCache,
  bumpDraftGeneration,
  redraftCurrentAnswer,
  // R-3 (a11y finding 2, HIGH): (text) => void, called ONLY for a
  // foreign-origin change — see codeLanguageChangeAnnouncement's own doc for
  // why a local one stays silent. Optional so this hook's own test suite,
  // which never passes it, keeps mounting a subscriber with nothing to
  // announce.
  onForeignChange,
}) {
  // Stable identity — an honest one, not merely a stated intention: EVERY
  // dep here is a genuinely stable reference at the call site
  // (`CopilotClient.js`), so `useCodeLanguageChange`'s effect (dep array
  // `[handler]`) does not tear down and re-subscribe on every render —
  // including the once-per-second clock tick a live session redraws with,
  // which is what a fresh arrow per render used to cost here. Still picks up
  // a changed `canRedraft` — AC-A15b's exact defect one criterion over would
  // be freezing this at mount, where `canRedraft` may still read `false`.
  const onCodeLanguageChanged = useCallback(
    (next, prev, meta) => {
      invalidateLiveAnswers({
        clearAnswerCache,
        bumpDraftGeneration,
        redraftCurrentAnswer,
        canRedraft,
      });
      if (meta.origin === "foreign" && onForeignChange) {
        onForeignChange(
          codeLanguageChangeAnnouncement({ surface: "live", origin: "foreign", label: codeLanguageLabel(next) }),
        );
      }
    },
    [canRedraft, clearAnswerCache, bumpDraftGeneration, redraftCurrentAnswer, onForeignChange],
  );

  useCodeLanguageChange(onCodeLanguageChanged);
}
