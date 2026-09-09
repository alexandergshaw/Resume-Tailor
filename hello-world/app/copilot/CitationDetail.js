"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Popper from "@mui/material/Popper";
import Typography from "@mui/material/Typography";

import { BREAK_LONG_WORDS_SX, TOUCH_TARGET_SX } from "@/app/theme/mobileSx";

// ALL OF THIS FEATURE'S MARKUP AND INTERACTION, in one file that is 100% its
// own — exactly as ExpansionPanel.js is for the sibling chunk, and for the same
// reason: AnswerLines.js gains one import and the three lines between its
// citation sentinels, so the point-rendering region and the single <strong>
// that region produces are byte-identical afterwards.
//
// WHAT THE USER ASKED FOR: "the sources that show up under each of the overall
// bullets (i.e. 'From your Management Experience page') ... should actually be
// hoverable, and hovering over them should reveal a modal that shows the page
// and section in question", plus "a 3-4 word blurb as to what that section
// summarizes/entails".
//
// A POPOVER, NOT A MODAL — the one deliberate deviation from the literal
// request. MUI Modal/Dialog/Popover (Popover renders inside Modal) trap focus,
// set aria-hidden on the rest of the app and lock page scroll. Mid-interview
// the answer BEHIND the overlay is the sentence the candidate is reading
// aloud, and a modal is the one shape that guarantees they lose it; a
// hover-opened focus trap is unusable by construction. MUI Popper is a bare
// positioned portal: no focus trap, no scroll lock, no aria-hidden, and no
// accessible-name theft. PORTALLED, never disablePortal, because the desktop
// answer pane is its own scroll container at md and up and an in-flow overlay
// would be clipped by its edge.
//
// AND NOT A MUI Tooltip: a Tooltip overrides its child control's accessible
// name in this repo's MUI version. Here the trigger's accessible name IS the
// visible citation sentence, so a Tooltip would silently destroy WCAG 2.5.3
// Label in Name. Popper has no dismissal of its own, so dismissal is assembled
// explicitly below from two document listeners — Escape must work while the
// pointer hovers and focus is somewhere else entirely, which a listener bound
// to the trigger could never see.
//
// THE CAPTION IS THE CONTROL, deviating from ExpansionPanel's own ruling.
// That ruling refuses to make the bullet's SENTENCE a button because
// ButtonBase sets `user-select: none` and the answer text must stay selectable
// mid-interview. The citation caption is not the spoken sentence; losing
// selection on it is the price of the affordance the user explicitly asked
// for. The three ButtonBase layout hazards that ruling also names —
// uppercasing, centring, and the 64px min-width floor — are declared away in
// `sx` below and measured in this component's tests.
//
// NO FOCUS STYLING OF ITS OWN. app/theme/index.js draws the app-wide ring in
// four longhands on .Mui-focusVisible under .MuiButtonBase-root; a second ring
// on a different selector in shorthand form silently undoes it, and a bare
// styled <button> would get none at all. That is also why this is a MUI
// <Button> rather than a hand-rolled element.
//
// NO BOLD AND NO ITALIC ANYWHERE, panel included: AnswerLines.emphasis.test.js
// counts <strong> with a DESCENDANT selector and pins it at exactly one per
// emphasised <li>. Weight, where it is wanted, is `fontWeight` on an ordinary
// element — the same device AnswerLines uses for the STAR label.
//
// NO LINK TO THE PAGE. Navigating away from the answer mid-interview is the
// wrong affordance, and its absence keeps this feature entirely clear of
// app/components/hrefSafety.sweep.test.js's gate.
//
// COLOUR: --text-secondary and --text-primary only. --text-muted measures
// 3.90:1 on this surface's fill against the 4.5:1 WCAG 1.4.3 requires at
// caption size (R-228).

// How long the panel survives the pointer leaving the trigger, so the pointer
// can travel onto the panel itself (WCAG 1.4.13 "hoverable"). It is a close
// DELAY, never an auto-hide: nothing here closes on a timer while the pointer
// or focus is still on it.
const CLOSE_DELAY_MS = 200;

const LOCATED_STATUS = "These words appear on this page word for word.";
const UNLOCATED_STATUS = "We could not match this line word for word to one part of this page.";
const OUTLINE_LABEL = "Sections on this page:";
// A literal, deliberately NOT knowledgeBase.js's EXCERPT_HEADING_SUFFIX: that
// constant is MODEL-facing and byte-locked by its own tests, and must not gain
// a human reader.
const TRUNCATED_NOTE = "This section continues beyond what is shown here.";

// The comma-and-"under" form, not the em dash the request typed: an em dash is
// silent at default screen-reader punctuation settings, and this sentence has
// to survive being read aloud.
function sentenceFor(title, section) {
  return section ? `From your ${title} page, under ${section}.` : `From your ${title} page.`;
}

const CAPTION_SX = { m: 0, mt: 0.5, color: "var(--text-secondary)", ...BREAK_LONG_WORDS_SX };

export default function CitationDetail({ source }) {
  // One per instance, so three citations on one screen cannot collide. Never
  // derived from the page title, the section or the quote: those are user-
  // supplied strings.
  const generatedId = useId();
  const [anchor, setAnchor] = useState(null);
  const [open, setOpen] = useState(false);
  // Activation LATCHES. A latched panel ignores mouseleave entirely, which is
  // what makes this usable on a phone, where `hover` does not exist at all and
  // a spurious mouseleave arrives right after the tap.
  const [latched, setLatched] = useState(false);
  const panelRef = useRef(null);
  const timer = useRef(null);

  const cancelClose = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    cancelClose();
    setOpen(false);
    setLatched(false);
  }, [cancelClose]);

  const scheduleClose = useCallback(() => {
    cancelClose();
    timer.current = setTimeout(() => {
      timer.current = null;
      setOpen(false);
    }, CLOSE_DELAY_MS);
  }, [cancelClose]);

  useEffect(() => cancelClose, [cancelClose]);

  // WCAG 1.4.13 DISMISSIBLE, plus outside click/tap. Both on `document`
  // because neither event is guaranteed to reach the trigger: Escape has to
  // work while the pointer hovers and focus is elsewhere, and a tap outside
  // lands on a node this component does not own. Escape moves NO focus.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") dismiss();
    };
    const onPointerDismiss = (event) => {
      if (anchor && anchor.contains(event.target)) return;
      if (panelRef.current && panelRef.current.contains(event.target)) return;
      dismiss();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("click", onPointerDismiss);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("click", onPointerDismiss);
    };
  }, [open, anchor, dismiss]);

  // Every hook above this line runs unconditionally.
  const title = typeof source?.title === "string" ? source.title : "";
  const section = typeof source?.section === "string" && source.section.trim() ? source.section : null;
  const headings = Array.isArray(source?.outline)
    ? source.outline.filter((h) => typeof h === "string" && h.trim())
    : [];
  const more = Number.isInteger(source?.outlineMore) && source.outlineMore > 0 ? source.outlineMore : 0;
  const located = source?.located === true;
  const quote = typeof source?.quote === "string" ? source.quote : "";
  const sentence = sentenceFor(title, section);

  // A citation with nothing to reveal renders exactly what this line rendered
  // before the feature existed: inert text, no control, no attribute. A
  // control whose panel would be empty is worse than no control — and this is
  // what keeps AnswerLines.expansion.test.js's "exactly one button per <li>"
  // green against its bare {id, title} fixture.
  if (!located && headings.length === 0) return <>{sentence}</>;

  const panelId = `citation-${generatedId}`;

  return (
    <>
      <Button
        type="button"
        variant="text"
        size="small"
        data-citation="control"
        ref={setAnchor}
        aria-expanded={open ? "true" : "false"}
        // Set ONLY while the panel exists — the panel is not mounted while
        // closed, so a collapsed aria-controls would be a dangling IDREF. Same
        // mechanism the sibling disclosure in this <li> uses, so a screen
        // reader meets one pattern twice rather than two patterns once.
        aria-controls={open ? panelId : undefined}
        // No aria-label: the accessible name is the visible sentence, so WCAG
        // 2.5.3 holds by construction. No aria-describedby either — it would
        // fold the whole panel into the button's description and replay it on
        // every focus.
        onClick={() => {
          cancelClose();
          setLatched(!latched);
          setOpen(!latched);
        }}
        onMouseEnter={() => {
          cancelClose();
          setOpen(true);
        }}
        onMouseLeave={() => {
          if (!latched) scheduleClose();
        }}
        onFocus={() => {
          cancelClose();
          setOpen(true);
        }}
        onBlur={() => {
          if (!latched) dismiss();
        }}
        sx={{
          ...TOUCH_TARGET_SX,
          p: 0,
          // The four ButtonBase layout hazards, declared away and measured.
          textTransform: "none",
          justifyContent: "flex-start",
          minWidth: 0,
          whiteSpace: "normal",
          textAlign: "left",
          // The caption's own type, not the Button variant's: this control IS
          // the caption, and it sits inside a `variant="caption"` span.
          fontSize: "inherit",
          fontWeight: "inherit",
          lineHeight: "inherit",
          letterSpacing: "inherit",
          color: "var(--text-secondary)",
          ...BREAK_LONG_WORDS_SX,
        }}
      >
        {sentence}
      </Button>
      {open && anchor ? (
        <Popper open anchorEl={anchor} placement="bottom-start" sx={{ zIndex: (t) => t.zIndex.tooltip }}>
          <Box
            data-citation="panel"
            id={panelId}
            ref={panelRef}
            // WCAG 1.4.13 HOVERABLE: the pointer may travel from the trigger
            // onto the panel and read it.
            onMouseEnter={cancelClose}
            onMouseLeave={() => {
              if (!latched) scheduleClose();
            }}
            sx={{
              maxWidth: { xs: "calc(100vw - 32px)", sm: 420 },
              maxHeight: "60vh",
              overflowY: "auto",
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
              {title}
            </Typography>
            {located ? (
              <>
                {section ? (
                  <Typography component="p" variant="caption" sx={CAPTION_SX}>{`Under ${section}.`}</Typography>
                ) : null}
                {/* THE WHOLE SAFETY ARGUMENT. "This block is where the point
                    came from" is an inference, not a fact, and the candidate
                    can only check it if the words are on screen. */}
                <Box
                  component="p"
                  sx={{
                    m: 0,
                    mt: 0.5,
                    p: 1,
                    whiteSpace: "pre-wrap",
                    maxHeight: 220,
                    overflowY: "auto",
                    fontSize: "0.8125rem",
                    bgcolor: "var(--bg-soft)",
                    border: "1px solid var(--border)",
                    borderRadius: 1,
                    color: "var(--text-primary)",
                    ...BREAK_LONG_WORDS_SX,
                  }}
                >
                  {quote}
                </Box>
                {source?.quoteTruncated === true ? (
                  <Typography component="p" variant="caption" sx={CAPTION_SX}>
                    {TRUNCATED_NOTE}
                  </Typography>
                ) : null}
                <Typography component="p" variant="caption" sx={CAPTION_SX}>
                  {LOCATED_STATUS}
                </Typography>
              </>
            ) : (
              <>
                <Typography component="p" variant="caption" sx={CAPTION_SX}>
                  {UNLOCATED_STATUS}
                </Typography>
                <Typography component="p" variant="caption" sx={CAPTION_SX}>
                  {OUTLINE_LABEL}
                </Typography>
                {/* Document order, explicitly NOT a relevance ranking, so no
                    section is implied to be the source. No listStyle and no
                    role: `listStyle: "none"` costs the list its role in WebKit
                    and a presentation role propagates to the items. */}
                <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
                  {headings.map((heading, index) => (
                    <Typography
                      component="li"
                      variant="caption"
                      key={index}
                      sx={{ color: "var(--text-secondary)", ...BREAK_LONG_WORDS_SX }}
                    >
                      {heading}
                    </Typography>
                  ))}
                </Box>
                {more > 0 ? (
                  <Typography component="p" variant="caption" sx={CAPTION_SX}>{`and ${more} more.`}</Typography>
                ) : null}
              </>
            )}
          </Box>
        </Popper>
      ) : null}
    </>
  );
}
