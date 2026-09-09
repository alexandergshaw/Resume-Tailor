"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Popper from "@mui/material/Popper";
import Typography from "@mui/material/Typography";

import { safeExternalHref } from "@/lib/url/safeExternalHref";
import { citationHost } from "@/lib/tracking/citationHref";
import { servesVendorRedirect, isThirdPartyIntermediary } from "@/lib/copilot/glossaryResearch";
import { glossaryCardModel } from "@/lib/copilot/glossaryCard";
import { BREAK_LONG_WORDS_SX, TOUCH_TARGET_SX } from "@/app/theme/mobileSx";

// ONE MARKED TERM IN A DRAFTED ANSWER, AND THE CARD BEHIND IT.
//
// What the user asked for: "pull all of the explicitly stated buzzwords from
// the posting and 50-100 implicitly anticipated buzzwords ... research them
// all, and store the terms and definitions for an interview. THESE DEFINITIONS
// ARE WHAT COME UP ON HOVER."
//
// ---------------------------------------------------------------------------
// WHY THIS IS A BARE <button> AND NOT A MUI ONE
// ---------------------------------------------------------------------------
// This control sits INSIDE the sentence a candidate reads aloud. MUI's
// ButtonBase is a centred `inline-flex` that sets `user-select: none`, so
// wrapping a word of the answer in one would (a) break the line box the word
// lives in and (b) make that word unselectable -- ExpansionPanel.js refused to
// make a bullet's sentence a button for exactly those two measured reasons, and
// the same reasons apply harder to a single word inside it. So this is a plain
// element with the UA button box declared away, and it draws the app's
// canonical focus ring itself (2px solid var(--accent) at 2px offset -- the
// values app/globals.css's `.skip-link:focus-visible` and
// knowledgePanelStyles.js's FOCUS_SX both carry, restated here as the theme
// itself restates them, because the theme's ring is keyed on
// `.MuiButtonBase-root.Mui-focusVisible` and cannot reach a bare button).
//
// AND NOT A MUI Tooltip: a Tooltip OVERRIDES its child control's accessible
// name in this repo's MUI version. Here the accessible name must BE the term
// text -- that is the whole of AC-H2 -- so a Tooltip would silently destroy it.
//
// AND NOT A Modal/Dialog/Popover: all three trap focus, set aria-hidden on the
// rest of the app and lock page scroll. Mid-interview the thing behind the
// overlay is the sentence the candidate is about to say out loud. Popper is a
// bare positioned portal: no focus trap, no scroll lock, no aria-hidden, no
// accessible-name theft. Portalled, never disablePortal, because the desktop
// answer pane is its own scroll container at md and up.
//
// ---------------------------------------------------------------------------
// THE TAP-TARGET RULING (WCAG 2.5.8), BOTH HALVES
// ---------------------------------------------------------------------------
// The INLINE TERM is exempt and must NOT be padded. 2.5.8 carries an explicit
// inline exception for a target in a sentence or block of text, and a 44px
// minimum on an inline word destroys the line box around it. The popover's own
// close control and its source link get no such exception and both carry
// TOUCH_TARGET_SX, measured at 375px and again at 1000px.
//
// ---------------------------------------------------------------------------
// THE ROW IS NEVER TRUSTED
// ---------------------------------------------------------------------------
// `position_glossaries` has no user_id and every authenticated account can read
// every row, so `source_url` is model-influenced text written by somebody
// else's browser. It is re-validated HERE, at render, against the href gate AND
// both redirector rules -- not only at ingest -- so a row written by an older,
// weaker ingest, or by a future regression, cannot put a grounding redirect or
// a link-shortener in front of a reader mid-interview. If any of the three
// refuses, the card renders the UNSOURCED wording ENTIRELY, first line
// included: a first line naming a host for a URL the card then declines to link
// is worse than either honest answer.
//
// The displayed host comes from the anchor's OWN href, in the same expression
// that produces the href (SEC-F2) -- never from the stored `source_host`, which
// is a second copy that can drift. `source_title` is not rendered anywhere at
// all, which deletes an attacker-controlled string rather than escaping it.

/** Hover only. A sweep of the pointer across a sentence must open no cascade. */
const OPEN_DELAY_MS = 120;
/** WCAG 1.4.13 "hoverable": time to travel from the word onto the card. */
const CLOSE_DELAY_MS = 200;

const CLOSE_LABEL = "Close";

// AC-H9. One card at a time, app-wide. A module-level registry rather than
// shared state, because the terms that compete are siblings in different <li>s
// with no common owner short of the whole answer list.
//
// Keyed on `useId()` and populated in an EFFECT, never in render: a ref read or
// written during render is a real correctness hazard (React may render twice,
// or throw the first render away) and this repo's lint rule refuses it outright.
// Only OPEN cards are registered, so revealing one walks a map with at most one
// entry in it.
const openCards = new Map();

const FOCUS_RING_SX = {
  // Four longhands, never the `outline` shorthand: jsdom does not implement
  // the shorthand and reads it back as `none`, so a ring written that way is
  // unmeasurable here. The theme's own rule makes the same choice.
  outlineWidth: "2px",
  outlineStyle: "solid",
  outlineColor: "var(--accent)",
  outlineOffset: "2px",
};

const CARD_TEXT_SX = { m: 0, mt: 0.5, color: "var(--text-secondary)", ...BREAK_LONG_WORDS_SX };

/**
 * @param {{term: object, surface: string}} props `surface` is the run of the
 *   POINT that matched -- the candidate's own characters, in the point's own
 *   case -- never the stored term. That is what keeps `li.textContent`
 *   byte-identical to the unmarked rendering.
 */
export default function GlossaryTerm({ term, surface }) {
  const generatedId = useId();
  const [anchor, setAnchor] = useState(null);
  const [open, setOpen] = useState(false);
  // Activation LATCHES: a latched card ignores mouseleave entirely, which is
  // what makes this usable on a phone, where `hover` does not exist and a
  // spurious mouseleave arrives right after the tap.
  const [latched, setLatched] = useState(false);
  const cardRef = useRef(null);
  const timer = useRef(null);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearTimer();
    setOpen(false);
    setLatched(false);
  }, [clearTimer]);

  const reveal = useCallback(() => {
    clearTimer();
    // Called only from an event handler or a timeout, never during render.
    for (const [id, close] of openCards) {
      if (id !== generatedId) close();
    }
    setOpen(true);
  }, [clearTimer, generatedId]);

  const scheduleOpen = useCallback(() => {
    clearTimer();
    timer.current = setTimeout(() => {
      timer.current = null;
      reveal();
    }, OPEN_DELAY_MS);
  }, [clearTimer, reveal]);

  const scheduleClose = useCallback(() => {
    clearTimer();
    timer.current = setTimeout(() => {
      timer.current = null;
      setOpen(false);
    }, CLOSE_DELAY_MS);
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  // AC-H9's registration. In an effect, so nothing is written to module state
  // during render, and only while this card is actually open.
  useEffect(() => {
    if (!open) return undefined;
    openCards.set(generatedId, dismiss);
    return () => {
      openCards.delete(generatedId);
    };
  }, [open, generatedId, dismiss]);

  // WCAG 1.4.13 DISMISSIBLE, plus outside tap. Both on `document`, because
  // neither event is guaranteed to reach the trigger: Escape has to work while
  // the pointer hovers and focus is somewhere else entirely, and a tap outside
  // lands on a node this component does not own. Escape moves NO focus.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") dismiss();
    };
    const onPointerDismiss = (event) => {
      if (anchor && anchor.contains(event.target)) return;
      if (cardRef.current && cardRef.current.contains(event.target)) return;
      dismiss();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("click", onPointerDismiss);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("click", onPointerDismiss);
    };
  }, [open, anchor, dismiss]);

  // AC-H22, in ONE expression, and it governs the WHOLE card rather than only
  // the anchor. Every hook above this line runs unconditionally.
  const href = safeExternalHref(term?.source_url);
  const host = href ? citationHost(href) : null;
  const sourced =
    host !== null && !servesVendorRedirect(host, href) && !isThirdPartyIntermediary(host, href);

  const card = glossaryCardModel(term, { sourced, host });
  const cardId = `glossary-${generatedId}`;
  const text = typeof surface === "string" && surface ? surface : String(term?.term ?? "");

  return (
    <>
      <Box
        component="button"
        type="button"
        data-glossary="term"
        ref={setAnchor}
        aria-expanded={open ? "true" : "false"}
        // Set ONLY while the card exists: the card is not mounted while
        // closed, so a collapsed aria-controls would be a dangling IDREF. No
        // aria-label -- it would REPLACE the term text and the accessible name
        // must be the visible word. No aria-describedby either: it would make
        // a screen reader read the whole definition every time focus lands on
        // the term, mid-sentence.
        aria-controls={open ? cardId : undefined}
        // Activation toggles the LATCH, never the raw open state: a term the
        // pointer already revealed must LATCH on click rather than close, or
        // clicking what you are looking at makes it disappear.
        onClick={() => {
          if (latched) {
            dismiss();
            return;
          }
          setLatched(true);
          reveal();
        }}
        onMouseEnter={scheduleOpen}
        onMouseLeave={() => {
          if (!latched) scheduleClose();
        }}
        onFocus={reveal}
        onBlur={(event) => {
          if (latched) return;
          // AC-H11: Tab moves INTO the card's own focusables -- which now
          // include the source link -- and then out. Closing on any blur would
          // make the link unreachable by keyboard.
          if (cardRef.current && event.relatedTarget && cardRef.current.contains(event.relatedTarget)) return;
          dismiss();
        }}
        sx={{
          // The UA button box, declared away so the word sits in the sentence
          // rather than in a control. `inline` and not `inline-block`: a
          // multiword term must be able to WRAP across a line break rather
          // than pushing a gap to the next line.
          display: "inline",
          m: 0,
          p: 0,
          border: 0,
          background: "none",
          font: "inherit",
          color: "inherit",
          textAlign: "inherit",
          // WCAG 1.4.1: never colour alone. A dotted underline is the
          // conventional glossary affordance, it survives greyscale, and it is
          // deliberately NOT a link's solid underline -- the card now contains
          // a real link and the marked word must not look like one.
          textDecoration: "underline dotted",
          textDecorationThickness: "1px",
          textUnderlineOffset: "2px",
          cursor: "help",
          // NO minHeight and NO minWidth, deliberately: WCAG 2.5.8's inline
          // exception. See this file's header.
          "&:focus-visible": FOCUS_RING_SX,
        }}
      >
        {text}
      </Box>
      {open && anchor ? (
        <Popper open anchorEl={anchor} placement="bottom-start" sx={{ zIndex: (t) => t.zIndex.tooltip }}>
          <Box
            data-glossary="card"
            id={cardId}
            ref={cardRef}
            // WCAG 1.4.13 HOVERABLE: the pointer may travel from the word onto
            // the card, read it, scroll it, and reach the link.
            onMouseEnter={clearTimer}
            onMouseLeave={() => {
              if (!latched) scheduleClose();
            }}
            sx={{
              maxWidth: { xs: "calc(100vw - 32px)", sm: 380 },
              p: 1.5,
              bgcolor: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: 1,
              ...BREAK_LONG_WORDS_SX,
            }}
          >
            <Typography
              component="p"
              variant="caption"
              sx={{ m: 0, fontWeight: 600, color: "var(--text-primary)", ...BREAK_LONG_WORDS_SX }}
            >
              {card.heading}
            </Typography>
            {/* AC-Q9. The provenance -- what KIND of term this is and whether
                it has a source -- is the first thing after the term, so a
                screen reader hears it BEFORE the definition rather than
                discovering it in a footer. In words, never by colour, position
                or omission (WCAG 1.4.1). */}
            <Typography component="p" variant="caption" sx={CARD_TEXT_SX}>
              {card.provenanceLine}
            </Typography>
            {/* AC-H12. The scrollable region, which is what survives of the
                original request's "scrollable preview of a site", and it is
                keyboard-reachable so a keyboard user can actually scroll it. */}
            <Box
              data-glossary="body"
              tabIndex={0}
              sx={{ maxHeight: 220, overflowY: "auto", mt: 0.5, ...BREAK_LONG_WORDS_SX }}
            >
              {card.quote ? (
                <Typography
                  component="p"
                  variant="caption"
                  sx={{ m: 0, color: "var(--text-primary)", ...BREAK_LONG_WORDS_SX }}
                >
                  {/* The posting's own line, VERBATIM -- this is what lets a
                      candidate judge whether an anticipated term is really
                      relevant to THIS job. `<q>` puts the quotation marks in
                      the UA stylesheet rather than in the string, so the
                      stored sentence reaches the DOM with not one character
                      added to it. */}
                  <Box component="q">{card.quote}</Box>
                </Typography>
              ) : null}
              {card.definition ? (
                <Typography
                  component="p"
                  variant="caption"
                  sx={{ m: 0, mt: 0.5, color: "var(--text-primary)", ...BREAK_LONG_WORDS_SX }}
                >
                  {card.definition}
                </Typography>
              ) : null}
            </Box>
            {card.linkLabel ? (
              <Typography component="p" variant="caption" sx={CARD_TEXT_SX}>
                <Box
                  component="a"
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{
                    ...TOUCH_TARGET_SX,
                    display: "inline-block",
                    color: "var(--accent)",
                    "&:focus-visible": FOCUS_RING_SX,
                  }}
                >
                  {card.linkLabel}
                </Box>
              </Typography>
            ) : null}
            {card.closingLine ? (
              // AC-Q8. The absence stated POSITIVELY. A missing link is not a
              // signal a reader can perceive -- they cannot know a link was
              // possible -- so the card says so in a sentence, which survives
              // being read aloud and printed in black and white.
              <Typography component="p" variant="caption" sx={CARD_TEXT_SX}>
                {card.closingLine}
              </Typography>
            ) : null}
            <Button
              type="button"
              data-glossary="close"
              variant="text"
              size="small"
              onClick={dismiss}
              sx={{ ...TOUCH_TARGET_SX, mt: 0.5, color: "var(--text-secondary)" }}
            >
              {CLOSE_LABEL}
            </Button>
          </Box>
        </Popper>
      ) : null}
    </>
  );
}
