"use client";

import { useCallback, useId, useRef, useState } from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import SendIcon from "@mui/icons-material/Send";
import CloseIcon from "@mui/icons-material/Close";
import { TOUCH_FIELD_SX, TOUCH_ICON_SX, BREAK_LONG_WORDS_SX } from "@/app/theme/mobileSx";
import { MAX_QUESTION_CHARS } from "@/lib/copilot/questionVocabulary";
import { visuallyHidden } from "@/lib/copilot/answerStatus";

// The ask-AI box in the sticky strip: one text field, always open, answering
// from this application's tracking row, the résumé and cover letter actually
// submitted for it, and the candidate's own knowledge base.
//
// ---------------------------------------------------------------------------
// WHY IT IS AN OPEN FIELD AND NOT A COLLAPSED TRIGGER.
//
// The standing directive is one action with good defaults over a wizard, a
// nested menu or a needless confirmation, and the request was for "an ask ai
// textbox in the sticky header" -- a textbox. A collapsed icon that expands
// into a field puts a click in front of every question, and the field is what
// was asked for. So: type, press Enter. No trigger, no dialog, no confirm step.
//
// WHAT THAT COSTS, MEASURED, because it is not free. app/copilot/useStickyTop.js
// decides two things and this row changes NEITHER of them: `isHostable` reads
// `document.documentElement.clientHeight`, the app header's own rect height and
// the root font size, and `isStatsHostable` adds only the strip's WIDTH. None
// of the four is a function of the strip's own height, so adding this row
// CANNOT flip the strip from sticky to static -- `stickyTop` is bit-identical
// with and without it, at every geometry.
//
// What it does spend is the 60%-of-the-space-below-the-header share those
// predicates reason about (`STRIP_MAX_SHARE`). Against the design's own
// reference phone (375x812, root 16, header 51) the strip currently spends
// 296.5px of a 456.6px budget, leaving 160.1px; this row costs 52px at `xs`
// (44px touch floor + `mt: 1`) and 48px at `sm`+ (a 40px `size="small"` field +
// `mt: 1`), so it fits there with 108px to spare. Swept over 15 real device
// viewports x 4 root sizes x 3 header heights, 120 configurations host the
// stats row today and 15 of them go over the 60% share once this row is added
// -- all of them a 320px-wide phone or an iPhone SE at an enlarged root size,
// where the strip ends up occupying ~67% rather than ~60% of the space under
// the header. Nothing is clipped and nothing stops sticking; the page simply
// gets less of the screen on the smallest phone at the largest text size.
//
// TWO THINGS KEEP THAT COST CONSTANT rather than letting it drift:
//   * The field is SINGLE-LINE. A multiline field grows the sticky strip as the
//     candidate types, pushing the interviewer's question down the screen
//     mid-answer -- the exact failure the strip exists to prevent. A long
//     question scrolls inside the field instead.
//   * The ANSWER is an absolutely positioned overlay (see `data-ask-answer`
//     below), so it is out of flow and contributes zero to the strip's height.
//     The strip measures identically with an answer on screen and without one.
// ---------------------------------------------------------------------------

const ASK_LABEL = "Ask AI about this application";

// EVERY ACCESSIBLE NAME IN THIS COMPONENT IS A REAL LABEL OR VISUALLY-HIDDEN
// TEXT -- not one `aria-label` anywhere, and that is a constraint, not a
// preference. StickyQuestionStrip.test.js's AC-31 case asserts that every
// `[aria-label]` inside the strip reads exactly "Speaking stats", which is the
// guard that stops the stats row from ever growing an interpolated label that
// re-announces a wpm figure over an interviewer while still passing a
// "no aria-live" grep. An `aria-label` here would break that guard for a reason
// that has nothing to do with what it protects. A `<label for>` and hidden
// button text give the same accessible names without touching it -- and are the
// better technique anyway, since a name in the accessibility tree that is also
// real text cannot silently diverge from what a sighted user sees.
//
// There is deliberately NO Tooltip on any control here. A MUI Tooltip STEALS a
// control's accessible name, which is why this repo's rule is that an icon-only
// control carries its own name regardless -- these carry theirs as hidden text.

// The panel is anchored to THIS wrapper, not to the strip: the strip's outer
// box is `position: static` on any viewport that cannot host a sticky strip
// (useStickyTop.js returns `stickyTop: null` for both "not measured yet" and
// "not hostable"), and an absolutely positioned child of a static box escapes
// to whatever positioned ancestor it finds -- which is not the strip. A
// `relative` wrapper of our own makes the anchor unconditional.
const WRAPPER_SX = { position: "relative", mt: 1 };

const PANEL_SX = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 0,
  right: 0,
  // Above ordinary page content and above the strip's own children, but far
  // below AppHeader's zIndex: 1100 -- a panel painted over the header would
  // hide the engine picker and the settings control from a keyboard user
  // tabbing into them (WCAG 2.4.11).
  zIndex: 3,
  maxHeight: "40vh",
  overflowY: "auto",
  p: 1.5,
  borderRadius: 1,
  border: "1px solid var(--border-subtle, rgba(0,0,0,0.12))",
  bgcolor: "var(--bg-canvas)",
  boxShadow: 3,
  ...BREAK_LONG_WORDS_SX,
};

export default function AskAiBox({ applicationId = "", engine = "" }) {
  const fieldId = useId();
  const panelLabelId = useId();
  const inputRef = useRef(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  // `asked` is the question that is (or was) in flight, kept separate from
  // `draft` so a candidate glancing back mid-interview can see WHAT is being
  // answered even after they have started typing the next one.
  const [asked, setAsked] = useState("");
  // One settled result, or null. Deliberately ONE state variable rather than
  // separate answer/error fields: the live region below must be written once,
  // on settle, and two fields is how a region ends up written twice.
  const [result, setResult] = useState(null);

  const close = useCallback(() => {
    setResult(null);
    setAsked("");
    // Focus is returned only because the user asked for the panel to go away.
    // It is never moved on an answer ARRIVING (see below).
    inputRef.current?.focus();
  }, []);

  const submit = useCallback(
    async (event) => {
      event?.preventDefault?.();
      const question = draft.trim();
      // No request, no spend, no state change for an empty ask.
      if (!question || pending) return;

      setAsked(question);
      setPending(true);
      // The previous answer is cleared here and NOT re-rendered until the next
      // one settles, so the live region carries exactly one write per answer
      // rather than one per pending transition.
      setResult(null);
      try {
        const res = await fetch("/api/copilot/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, applicationId, engine }),
        });
        const data = await res.json().catch(() => ({}));
        // The route's refusals are written for a person and are the honest
        // thing to show -- an over-cap question, a spent allowance, a switched
        // off endpoint and an empty context each have their own stated reason.
        // A blank panel would tell the candidate nothing at the one moment
        // they cannot investigate.
        setResult({
          text: (data?.answer || data?.error || "That question could not be answered right now.").toString(),
          sources: data?.sources || null,
        });
      } catch {
        setResult({ text: "The request did not go through. Check your connection and ask again.", sources: null });
      } finally {
        setPending(false);
      }
    },
    [applicationId, draft, engine, pending],
  );

  return (
    <Box sx={WRAPPER_SX}>
      <Box component="form" onSubmit={submit} sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
        {/* A real <label for>, visually hidden. Not a visible one: the strip
            has no height to spend on saying what the placeholder already says,
            and a placeholder is not an accessible name. */}
        <Box component="label" htmlFor={fieldId} sx={visuallyHidden}>
          {ASK_LABEL}
        </Box>
        <TextField
          id={fieldId}
          inputRef={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask AI about this application…"
          size="small"
          fullWidth
          // The same cap the route REFUSES past, so the field cannot produce a
          // request the route will reject.
          slotProps={{ htmlInput: { maxLength: MAX_QUESTION_CHARS } }}
          sx={TOUCH_FIELD_SX}
        />
        <IconButton
          type="submit"
          size="small"
          disabled={pending || draft.trim() === ""}
          sx={TOUCH_ICON_SX}
        >
          {pending ? <CircularProgress size={18} /> : <SendIcon fontSize="small" />}
          <Box component="span" sx={visuallyHidden}>
            {pending ? "Asking" : "Ask"}
          </Box>
        </IconButton>
      </Box>

      {pending || result ? (
        <Box
          data-ask-answer=""
          // Reachable by keyboard because it scrolls -- a scrollable region no
          // Tab can reach fails WCAG 2.1.1. The label is STATIC: one that
          // echoed the answer would re-announce on every arrival.
          tabIndex={0}
          role="group"
          aria-labelledby={panelLabelId}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
          }}
          sx={PANEL_SX}
        >
          {/* STATIC, and hidden. A label that echoed the answer or the question
              would re-announce the whole thing every time the panel changed. */}
          <Box component="span" id={panelLabelId} sx={visuallyHidden}>
            AI answer
          </Box>
          <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              {/* The question in flight, so a candidate glancing back knows
                  what is being answered. Not a skeleton that looks like an
                  answer.

                  DELIBERATELY OUTSIDE THE LIVE REGION BELOW. It was inside it
                  first, and the MutationObserver case in this component's suite
                  caught what that costs: submitting wrote the region four
                  times, not once, because this caption changes on every pending
                  transition. A screen reader user would have heard "Asking:
                  <the whole question>" read out before the answer -- over an
                  interviewer -- every single time. */}
              <Typography variant="caption" sx={{ color: "var(--text-secondary)", display: "block" }}>
                {pending ? `Asking: ${asked}` : asked}
              </Typography>
              {/* THE LIVE REGION, and it holds the settled answer and nothing
                  else. Polite, never assertive and never role="alert": this
                  text arrives while an interviewer may be speaking, and an
                  assertive region interrupts a screen reader mid-sentence.

                  PLAIN TEXT ONLY -- a text node, never dangerouslySetInnerHTML,
                  no markdown renderer and no link rendering. The route already
                  refuses an answer carrying a link or a tag; this is the second
                  half of the same guarantee, on the consumer side. */}
              <Box data-ask-live="" aria-live="polite">
                {result ? (
                  <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", mt: 0.5 }}>
                    {result.text}
                  </Typography>
                ) : null}
              </Box>
            </Box>
            <IconButton size="small" onClick={close} sx={TOUCH_ICON_SX}>
              <CloseIcon fontSize="small" />
              <Box component="span" sx={visuallyHidden}>
                Close the answer
              </Box>
            </IconButton>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}
