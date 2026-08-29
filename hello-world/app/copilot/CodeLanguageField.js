"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import { isCodeBearingInterviewType } from "@/lib/copilot/interviewTypes";
import { visuallyHidden } from "@/lib/copilot/answerStatus";
import { useInterviewTypeChange } from "./useInterviewType";
import { useCodeLanguageStorageBlocked } from "./useCodeLanguage";
import CodeLanguagePicker, { STORAGE_SENTENCE } from "./CodeLanguagePicker";

// A-49: the ONLY place F-C2's deferred unmount (D-5) can live without
// inverting something already shipped, and the sole owner of the render gate
// (AC-C2/AC-C2b/AC-C28d). Not in SessionSetup.js/PracticeSetup.js — both
// declare "no hooks, no handlers, no derived values here" and both call zero
// hooks today; not in CopilotClient.js — it is at 933 of a hard, executable
// 950; not in CodeLanguagePicker.js — a component cannot defer its own
// unmount, so the decision has to sit one level above the element being
// removed.
//
// THE GATE (AC-C2, AC-C2b, AC-C28d): the control renders only when the
// selected interview type is code-bearing AND the engine is not embedded —
// absent, never disabled, and never additionally gated on a posting being
// selected (live mode's default is no posting, and the override is the only
// way to get a specific language in that state). `isCodeBearingInterviewType`
// is the registry predicate (CONF-6) — a hand-rolled per-type comparison
// list would reintroduce the second list D4 removed.
//
// THE DEFERRAL (D-5, following the shape of `choiceChangeInvalidation.js`'s
// "Deferred, not dropped" branch and the reasoning of `SpeakerChip.js`'s
// BUG-2): a FOREIGN interview-type change that would close the gate must not
// unmount a focused control and drop focus to `<body>` — the exact failure
// `SpeakerChip.js` names for the same class of defect, and R-273 step 3's
// "nothing holding focus unmounts" is a deliberate user-protection property,
// not an accident, so the new control is what accommodates it. The gate that
// matters here is the INTERVIEW-TYPE gate, not the language one, so this
// subscribes to `useInterviewTypeChange` — wiring `useCodeLanguageChange`
// instead would produce a deferral that can never fire, silently.
//
// The deferral flag is set inside the change SUBSCRIPTION, never from a
// `useEffect` body (`react-hooks/set-state-in-effect` is error-level at this
// repo's zero-warnings bar) — `meta.origin` is already an argument the
// subscription receives. Focus is tracked as plain state, set from the
// bubbled synthetic `onFocus`/`onBlur` on a wrapping `<Box>`, which needs no
// prop on `CodeLanguagePicker` at all — its surface stays exactly
// `{ value, onChange, disabled }`. A local change (this user, in this
// window) always unmounts immediately; there is nothing to protect them
// from. Losing focus clears the deferral and the gate is re-evaluated
// normally — deferred, not dropped, so a control that closed its gate while
// unfocused disappears at once and one that stayed forever would be the
// opposite defect (a live language select under a non-code-bearing type).
//
// R-2 FIX: `onBlur` cannot clear the deferral SYNCHRONOUSLY. Opening MUI's
// non-native `Select` moves DOM focus off the `role="combobox"` div and into
// its portaled `MenuList`; the resulting `focusout` bubbles to this `Box`
// and fires BEFORE the matching `focusin` on the portaled item arrives. A
// synchronous `handleBlur` reads that as "focus left the field", clears both
// `focused` and `deferred`, and the gate at the return-null check below
// unmounts the whole subtree — including the menu mid-open — before the
// `focusin` can restore `focused`. That relocates the exact defect this
// component exists to prevent (see D-5 above) from the background storage
// event onto the user's own next keystroke.
//
// So `handleBlur` only SCHEDULES the clear (one `requestAnimationFrame`),
// and `handleFocus` cancels a pending one — the standard "focus-within
// across a portal" pattern. Belt-and-braces: the scheduled callback also
// re-checks where focus actually landed before committing to the clear,
// because relying on `handleFocus` firing at all assumes the portal's
// `focusin` reaches this `Box`, which the mouse-driven open path does not
// exercise the same way a real subsequent `focusin` would. "Still inside"
// covers two shapes: focus is back inside the `Box`'s own DOM subtree, or
// focus is inside the LISTBOX THIS FIELD OWNS — matched by comparing the
// listbox's `aria-labelledby` (MUI points it at the same `labelId` as the
// combobox, `SelectInput.js`) against this field's own combobox, not just
// "any open listbox" — so a second, unrelated open select elsewhere on the
// page can never hold this deferral open.
//
// R-6 (a11y findings 3 and 4) — TWO always-mounted, visually-hidden
// `role="status"` regions, following this app's own convention
// (`CopilotClient.js`'s consolidated live region: "mounted empty, never
// conditionally rendered — only its text ever changes"). Both live HERE,
// never on `CodeLanguagePicker.js`, because both need component state to
// detect a transition, and that picker is deliberately stateless (its own
// "reads BOTH stores' flags for itself" test pins zero `useState`/`useRef` —
// see that file's header for why: two independent latches is the exact
// two-latch shape a prior chunk's seam defects came from). A component one
// level up, that already owns state for an unrelated reason, is where a
// transition-detecting latch is safe to add.
//
// FINDING 4 — the control's own mount/unmount is otherwise unannounced. The
// gate variable `present` below is the union already used for the render
// decision (`gateOpen || deferred`); the live region's presence is NEVER
// itself conditional on it (that would silence the disappearance it exists to
// report) — only its TEXT changes, and only on a genuine transition during
// this mount, never on the value the component happened to start with (a
// user who loads the page with the control already showing did not just
// watch it appear, so nothing is announced at mount — matching this app's
// live/local interview-type row being deliberately silent for the same
// reason: a change nobody watched happen needs no narration).
//
// FINDING 3 — the storage-blocked sentence is otherwise reachable only via
// the sibling INTERVIEW-TYPE control's helper text, and only when this
// user re-enters a control after the fact. This region fixes both halves at
// once: it fires off THIS store's own blocked flag (`useCodeLanguageStorageBlocked`),
// so it speaks regardless of whether the sibling is ALSO blocked (finding 3a
// — the visible sentence's precedence at `CodeLanguagePicker.js:77-78` is
// untouched, this is a second, spoken channel, not a rewrite of it), and it
// fires AT THE TRANSITION rather than waiting for a later focus visit
// (finding 3b). Reusing `CodeLanguagePicker.STORAGE_SENTENCE` verbatim keeps
// the spoken wording identical to what a sighted user reads.
//
// Neither region overlaps chunk C's other announcement (the drafted-answers
// wipe in `lib/copilot/choiceChangeInvalidation.js`'s
// `codeLanguageChangeAnnouncement`, joined into `CopilotClient.js`'s own
// consolidated region): these two report a different fact (this control's
// visibility, and this browser's storage), on a different trigger (an
// interview-type change and a storage write failure, not a language VALUE
// change), through a different DOM node. Nothing here fires twice for the
// wipe, and nothing there fires for these.
//
// Detected during RENDER, via the React-documented "adjust state during
// rendering" shape (store the previous render's value in state, compare it
// to the current one, and conditionally call a setter right there in the
// component body) — never inside a `useEffect` body, so neither trips
// `react-hooks/set-state-in-effect` (error-level, transitive, no
// eslint-disable at this repo). React treats a setState call made this way
// as part of the SAME render pass, not a second commit, which is why this is
// documented React behaviour rather than a workaround.
export default function CodeLanguageField({ interviewType, isEmbedded, value, onChange }) {
  const [focused, setFocused] = useState(false);
  const [deferred, setDeferred] = useState(false);
  const boxRef = useRef(null);
  const pendingClearRef = useRef(null);

  const gateOpen = isCodeBearingInterviewType(interviewType) && !isEmbedded;
  const present = gateOpen || deferred;

  const languageBlocked = useCodeLanguageStorageBlocked();

  // Finding 4's transition latch. Initialized to the CURRENT `present` value
  // (not `false`) so a control that starts out showing — or starts out
  // absent — never announces a transition it did not witness.
  const [announcedPresent, setAnnouncedPresent] = useState(present);
  const [presenceAnnouncement, setPresenceAnnouncement] = useState("");
  if (present !== announcedPresent) {
    setAnnouncedPresent(present);
    setPresenceAnnouncement(
      present
        ? "A code language option is now available."
        : "The code language option is no longer shown.",
    );
  }

  // Finding 3's transition latch. Same shape, same reason for the initial
  // value: a tab that starts out already blocked (storage disabled from
  // load) never had a write of its own fail just now, so nothing is spoken
  // until a real attempt — made through this control — actually fails.
  const [announcedBlocked, setAnnouncedBlocked] = useState(languageBlocked);
  const [blockedAnnouncement, setBlockedAnnouncement] = useState("");
  if (languageBlocked !== announcedBlocked) {
    setAnnouncedBlocked(languageBlocked);
    setBlockedAnnouncement(languageBlocked ? STORAGE_SENTENCE : "");
  }

  const handleInterviewTypeChange = useCallback(
    (next, _prev, meta) => {
      const closesGate = !(isCodeBearingInterviewType(next) && !isEmbedded);
      if (meta?.origin === "foreign" && focused && closesGate) {
        setDeferred(true);
      }
    },
    [focused, isEmbedded],
  );

  useInterviewTypeChange(handleInterviewTypeChange);

  const cancelPendingClear = useCallback(() => {
    if (pendingClearRef.current !== null) {
      cancelAnimationFrame(pendingClearRef.current);
      pendingClearRef.current = null;
    }
  }, []);

  const handleFocus = useCallback(() => {
    cancelPendingClear();
    setFocused(true);
  }, [cancelPendingClear]);

  const handleBlur = useCallback(() => {
    cancelPendingClear();
    pendingClearRef.current = requestAnimationFrame(() => {
      pendingClearRef.current = null;
      const active = document.activeElement;
      const box = boxRef.current;
      const combobox = box?.querySelector('[role="combobox"]');
      const labelledBy = combobox?.getAttribute("aria-labelledby") || null;
      const listbox = active?.closest?.('[role="listbox"]') || null;
      const stillInside =
        !!box?.contains(active) ||
        (labelledBy !== null && listbox?.getAttribute("aria-labelledby") === labelledBy);
      if (stillInside) return;
      setFocused(false);
      setDeferred(false);
    });
  }, [cancelPendingClear]);

  // Only cancels an outstanding rAF on unmount — never sets state here, so
  // this does not trip `react-hooks/set-state-in-effect`.
  useEffect(() => cancelPendingClear, [cancelPendingClear]);

  return (
    <>
      {/* R-6 finding 4: always mounted, regardless of `present` — a region
          that vanishes in the same commit as the announcement it is meant to
          carry announces nothing. Only the text below ever changes. */}
      <Box
        component="span"
        role="status"
        aria-live="polite"
        data-testid="code-language-presence-live-region"
        sx={visuallyHidden}
      >
        {presenceAnnouncement}
      </Box>
      {/* R-6 finding 3: same reasoning — always mounted, so a write failure
          that happens right before the control itself disappears is still
          spoken. */}
      <Box
        component="span"
        role="status"
        aria-live="polite"
        data-testid="code-language-storage-live-region"
        sx={visuallyHidden}
      >
        {blockedAnnouncement}
      </Box>
      {present && (
        <Box ref={boxRef} sx={{ mb: 2 }} onFocus={handleFocus} onBlur={handleBlur}>
          <CodeLanguagePicker value={value} onChange={onChange} disabled={false} />
        </Box>
      )}
    </>
  );
}
