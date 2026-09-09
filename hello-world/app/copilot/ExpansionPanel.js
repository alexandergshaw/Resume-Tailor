"use client";

import { useId } from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";

import { BREAK_LONG_WORDS_SX, TOUCH_TARGET_SX, WRAP_ROW_SX } from "@/app/theme/mobileSx";
import { EXPANSION_MIN_HEIGHT } from "@/lib/copilot/expansionContract";

import { useExpansionApi } from "./useAnswerExpansions";

// ALL OF THE EXPANSION MARKUP, in one file that is 100% this feature's.
//
// WHY IT IS NOT INLINE IN AnswerLines.js. That file's render body produces
// exactly one `<strong>` per line, over a character range answerLines computed,
// and AnswerLines.emphasis.test.js pins the count with a DESCENDANT selector at
// exactly 1 on the emphasis branch and 0 on the bare branch. Keeping every
// piece of new markup here means AnswerLines gains one import, one prop and one
// element, and the point-rendering region is byte-identical afterwards. It also
// gives every whole-file assertion below a file to be whole about, instead of a
// slice of a file two other chunks also edit.
//
// SO: NOTHING HERE MAY BE BOLD OR ITALIC. Not the control's label, not the
// glyph, not the loading caption, not a sub-bullet. Weight, where it is wanted,
// is `fontWeight` on an ordinary element.
//
// WHAT THIS COMPONENT RETURNS IS A FRAGMENT, NOT ONE WRAPPER. The nested list
// has to be a DIRECT child of the parent `<li>` -- `li.querySelector(":scope >
// ul > li")` is the contract, and it is also why there is no MUI `<Collapse>`,
// which renders three intervening `<div>`s. So each top-level node carries
// `data-expansion` instead, and every assertion that needs "the bullet's own
// text" removes `[data-expansion]` nodes: one mechanism, one attribute, rather
// than five hand-written exclusions that drift.
//
// THE CONTROL IS NOT THE BULLET'S OWN SENTENCE, which is a deliberate deviation
// from the literal request and the one thing here worth an owner's ruling.
// Three measured reasons: MUI ButtonBase sets `user-select: none`, so the
// answer text would stop being selectable mid-interview; ButtonBase is a
// centred inline-flex, which breaks a multi-sentence paragraph at the app's
// 320px floor; and the bare rendering has no head to wrap.
//
// NO LOCAL FOCUS STYLING. The app-wide theme already draws a ring, in four
// longhands, on the class MUI emits for every ButtonBase root. A second one on
// a different selector in shorthand form would undo that deliberate choice --
// and a bare styled `<button>` would get none at all, which is why this is a
// MUI `<Button>` and not a hand-rolled element.

const LABEL = "More detail";
const GLYPH_OPEN = "▾"; // down-pointing triangle
const GLYPH_CLOSED = "▸"; // right-pointing triangle

const LOADING_TEXT = "Finding more detail…";
const EMPTY_TEXT = "Nothing more we can back up from your resume or project pages.";
const ERROR_TEXT = "Could not get more detail for this point.";
const TIMEOUT_TEXT = "That took too long to look up.";
const DISABLED_TEXT = "More detail is unavailable on this server right now.";

// How many words of a bullet stand in for it when nothing shorter exists.
const NAME_WORDS = 8;

/**
 * A short name for one bullet, for the control's accessible name.
 *
 * In order: the emphasised run, then the cue, then the point's opening words.
 *
 * The emphasised run comes first because it is the same words the cue used to
 * carry, in the point's own casing, already computed -- a better short name
 * than eight arbitrary words. The cue is next for the lines that still have one
 * (a genuinely paraphrasing cue has no run to locate). The opening words are
 * the floor.
 */
function shortName(line) {
  const point = typeof line?.point === "string" ? line.point : "";
  const span = line?.emphasis;
  if (
    span &&
    Number.isInteger(span.start) &&
    Number.isInteger(span.end) &&
    span.start >= 0 &&
    span.end > span.start &&
    span.end <= point.length
  ) {
    return point.slice(span.start, span.end);
  }
  if (typeof line?.cue === "string" && line.cue.trim()) return line.cue.trim();
  const words = point.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, NAME_WORDS).join(" ");
}

function errorTextFor(code) {
  if (code === "timeout") return TIMEOUT_TEXT;
  if (code === "disabled") return DISABLED_TEXT;
  return ERROR_TEXT;
}

export default function ExpansionPanel({ line, api }) {
  // One per instance, so three answers on one screen cannot collide and no
  // index arithmetic is needed. Never derived from the point, the cue, the
  // page title or the question: those are model- and user-supplied strings.
  const generatedId = useId();
  const contextApi = useExpansionApi();
  const resolved = api ?? contextApi;

  // Every hook above this line runs unconditionally.
  if (!resolved) return null;
  if (typeof resolved.resolves === "function" && !resolved.resolves(line)) return null;

  const panelId = `expansion-${generatedId}`;
  const open = resolved.isOpen(line);
  const record = resolved.get(line) || { status: "idle", subBullets: [], caption: "", code: null };
  const status = open ? record.status : "idle";
  const name = shortName(line);

  const control = (
    <Box data-expansion="control" key="control" sx={{ mt: 0.25 }}>
      <Button
        type="button"
        size="small"
        variant="text"
        data-panel-id={panelId}
        onClick={() => resolved.toggle(line)}
        aria-expanded={open ? "true" : "false"}
        // Set ONLY while the panel exists. There is no hidden panel and no
        // <Collapse>, so a collapsed aria-controls would be a dangling IDREF,
        // which is invalid ARIA rather than merely untidy.
        aria-controls={open ? panelId : undefined}
        // WCAG 2.5.3 Label in Name: it begins with the words a speech-input
        // user can actually see on the control.
        aria-label={`${LABEL}: ${name}`}
        sx={{
          ...TOUCH_TARGET_SX,
          p: 0,
          justifyContent: "flex-start",
          textTransform: "none",
          color: "var(--text-secondary)",
        }}
      >
        {LABEL}
        {/* The non-colour half of the state affordance (WCAG 1.4.1). It is
            never replaced by a spinner during loading: aria-expanded is
            already "true" by then, which is exactly when the affordance is
            needed. */}
        <Box component="span" aria-hidden="true">{` ${open ? GLYPH_OPEN : GLYPH_CLOSED}`}</Box>
      </Button>
    </Box>
  );

  if (!open) return <>{control}</>;

  if (status === "done" && record.subBullets.length > 0) {
    return (
      <>
        {control}
        <Box
          component="ul"
          data-expansion="panel"
          id={panelId}
          key="panel"
          sx={{ m: 0, pl: 2.5 }}
        >
          {record.subBullets.map((sub, index) => (
            <Typography
              component="li"
              variant="body2"
              key={index}
              sx={{ color: "var(--text-primary)", ...BREAK_LONG_WORDS_SX }}
            >
              {sub.text}
              {sub.pageSource ? (
                <Typography
                  component="span"
                  variant="caption"
                  sx={{ display: "block", color: "var(--text-secondary)", ...BREAK_LONG_WORDS_SX }}
                >
                  From your {sub.pageSource.title} page.
                </Typography>
              ) : null}
            </Typography>
          ))}
        </Box>
        {record.caption ? (
          // A caption, never a sixth `<li>`: it is provenance for the list, not
          // an item in it, and an extra item inflates the count a screen reader
          // announces.
          <Typography
            data-expansion="caption"
            key="caption"
            variant="caption"
            component="p"
            sx={{ m: 0, color: "var(--text-secondary)", ...BREAK_LONG_WORDS_SX }}
          >
            {record.caption}
          </Typography>
        ) : null}
      </>
    );
  }

  return (
    <>
      {control}
      <Box
        data-expansion="panel"
        id={panelId}
        key="panel"
        sx={{ minHeight: EXPANSION_MIN_HEIGHT }}
      >
        {status === "error" ? (
          <Alert
            severity="error"
            action={
              record.code === "disabled" ? null : (
                <Button
                  type="button"
                  size="small"
                  color="inherit"
                  onClick={() => resolved.retry(line)}
                  aria-label={`Retry more detail for: ${name}`}
                  // The same floor the disclosure control above already takes.
                  // `size="small"` renders ~31px, and this is the control a
                  // candidate reaches for when an expansion has ALREADY failed
                  // -- the worst moment to hand them a target they miss.
                  sx={TOUCH_TARGET_SX}
                >
                  Retry
                </Button>
              )
            }
            // All three treatments are needed TOGETHER at 320px: flex wrapping
            // does nothing while the action keeps `margin-left: auto`, and
            // wrapping never triggers while the message cannot shrink below its
            // own content width. Measured inside a sub-bullet's container at
            // 320px, an untreated Alert leaves roughly 66px for the message,
            // about four characters per line.
            //
            // The two slot styles go through `slotProps` rather than a nested
            // selector on the root. Measured: a nested override has to out-rank
            // MUI's own class rule for the slot, and the doubled-ampersand form
            // that usually does silently did not apply here at all.
            sx={WRAP_ROW_SX}
            slotProps={{
              action: { sx: { marginLeft: 0, paddingLeft: 0 } },
              message: { sx: { minWidth: 0 } },
            }}
          >
            {errorTextFor(record.code)}
          </Alert>
        ) : status === "loading" ? (
          <Typography
            component="p"
            variant="body2"
            aria-busy="true"
            sx={{ m: 0, display: "flex", alignItems: "center", gap: 0.5, color: "var(--text-secondary)" }}
          >
            <CircularProgress size={16} sx={{ flexShrink: 0 }} />
            {LOADING_TEXT}
          </Typography>
        ) : (
          // The honest-empty state, and it is deliberately not painted as a
          // failure: no alert, no severity, no icon, no list marker. There is
          // also no Retry -- retrying an honest empty spends money to be told
          // the same thing.
          <Typography
            component="p"
            variant="body2"
            sx={{ m: 0, color: "var(--text-secondary)", ...BREAK_LONG_WORDS_SX }}
          >
            {EMPTY_TEXT}
          </Typography>
        )}
      </Box>
    </>
  );
}
