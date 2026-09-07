"use client";

import { useId } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import MarkdownPreview from "./MarkdownPreview.js";
import { citationView, answerShortfallFor } from "@/lib/experience/knowledgeView";
import {
  BTN_SX,
  BODY_SX,
  CAPTION_SX,
  FAILED_SX,
  FIELD_SX,
  PROSE_SX,
  SUBHEAD_SX,
  renderInertLink,
} from "./knowledgePanelStyles.js";

// The grounded question box: a multiline field, a submit, and the answer that
// came back — with everything the user needs to calibrate that answer sitting
// next to it rather than in a notice further up the panel.
//
// ------------------------------------------------------------------------
// WHY THIS CONTROL LOOKS AND READS NOTHING LIKE THE "Ask AI" ALREADY IN THIS
// TAB. PageEditor renders an `Ask AI` button inside this very component tree,
// and it does something completely different: it pins one page into the
// global chat panel, which the user must then switch to. Two outlined small
// buttons a few hundred pixels apart doing unrelated things is a defect, and
// a rename alone does not fix it because they would still be the same object
// with different words on it.
//
// The two cheapest disambiguations are BOTH defects, measured:
//
//   * A naming Tooltip. MUI 9.0.1's Tooltip writes its title onto the child as
//     `aria-label`, so wrapping a text-labelled button STEALS its accessible
//     name — "Ask AI" becomes "Pin this page into the chat panel", a WCAG
//     2.5.3 Label in Name failure that makes the control unreachable by voice
//     ("click Ask AI" then matches nothing). And the tooltip text is not in
//     the DOM before hover at all, so a touch user never sees it.
//   * An `aria-label` that differs from the visible text. Same failure without
//     the wrapper.
//
// So the fix is three real differences, none of them a hint:
//   WORDS  — "Answer from these pages", a verb phrase that states the
//            grounding constraint in the control itself. Never the token AI,
//            which already means "hand this to the chat" in six other places.
//   SHAPE  — a multiline field plus a submit. A text input is not confusable
//            with a one-press pin at a glance, which no relabelling achieves.
//   PLACE  — a bordered region with its own heading, below the editor. The
//            two are never on the same row.
//
// ------------------------------------------------------------------------
// A BLOCKED SUBMIT IS `aria-disabled`, NOT `disabled`, AND IS NEVER DIMMED.
// `aria-disabled` keeps tabIndex 0 and THE CLICK HANDLER STILL FIRES, so the
// early return below is the actual control — the attribute only tells
// assistive tech. Dimming is refused outright: it lands the label at
// 1.81–2.36:1 against a 4.5 floor, and 1.4.3's "inactive user interface
// components" exemption cannot be claimed for a control deliberately kept
// reachable so its reason can be read. The label swaps instead, at full
// contrast.
//
// ------------------------------------------------------------------------
// THE FIELD SPELLS OUT BOTH DESCRIBEDBY TARGETS. `helperText` auto-wires
// `aria-describedby` to a GENERATED id, and supplying
// `slotProps.htmlInput["aria-describedby"]` REPLACES it silently — so a field
// that names only the live caption loses the helper, and one that names
// neither loses both.

// The reasons a citation resolves to something other than a live page. Both
// render as inert text — never a dead button, never a greyed-out link, and
// never a strikethrough, because colour and decoration alone are not a
// channel.
const GONE_SENTENCE = "A page this answer used has since been deleted.";

function refusedCitationCount(outcome) {
  const refused = outcome && Array.isArray(outcome.refused) ? outcome.refused : [];
  let total = 0;
  for (const entry of refused) {
    // `residue-removed` is a different disclosure (links stripped out of the
    // prose), reported by the panel, not a source that failed to resolve.
    if (entry && entry.reason !== "residue-removed" && Number.isInteger(entry.count)) total += entry.count;
  }
  return total;
}

function SourceList({ answer, pages, onSelectPage }) {
  const sources = citationView(answer.citations, pages);
  const answered = answer.answered_from_pages;

  if (sources.length === 0) {
    // THREE STATES, THREE SENTENCES, and the discriminator is WHAT HAPPENED
    // rather than what is absent. Collapsing them into one "no sources" line
    // would report "we could not read the sources" as "the model named none".
    let sentence;
    if (answered === true) {
      sentence = "The model answered from these pages but did not name which ones it used.";
    } else if (answered === false) {
      sentence = "The model said it could not answer this from these pages.";
    } else {
      sentence =
        "The model answered but did not return its sources in a form we could read, so no pages are listed. That is different from an answer with no sources.";
    }
    return (
      <Typography data-kb-sources sx={CAPTION_SX}>
        {sentence}
      </Typography>
    );
  }

  return (
    <Box data-kb-sources sx={{ mt: 1 }}>
      <Typography component="h4" sx={SUBHEAD_SX}>
        Pages this answer used
      </Typography>
      <Stack sx={{ gap: 0.25, alignItems: "flex-start" }}>
        {sources.map((source) =>
          source.state === "live" ? (
            <Button
              key={source.pageId}
              size="small"
              onClick={() => onSelectPage(source.pageId)}
              sx={{ ...BTN_SX, justifyContent: "flex-start", px: 0.75, py: 0.25, fontSize: 12.5 }}
            >
              {source.title}
            </Button>
          ) : (
            <Typography key={source.pageId} sx={CAPTION_SX}>
              {source.state === "archived" ? `${source.title} — this page has been archived` : GONE_SENTENCE}
            </Typography>
          )
        )}
        {answered === false ? (
          <Typography sx={CAPTION_SX}>The model said it could not answer this from these pages.</Typography>
        ) : null}
      </Stack>
    </Box>
  );
}

/**
 * The answer, its sources and the two disclosures that belong beside it rather
 * than in the panel's general coverage notice. Exported because the history
 * renders exactly the same thing for an earlier question, and a second copy
 * would be green against its own tests while disagreeing with this one about
 * which of the three no-citation states applies.
 */
export function AnswerBlock({ answer, pages, onSelectPage }) {
  if (!answer) return null;

  if (answer.status !== "ready") {
    return (
      <Box data-kb-answer sx={{ mt: 1 }}>
        <Typography sx={FAILED_SX}>
          {`That question could not be answered: ${answer.error || "the run did not complete."}`}
        </Typography>
      </Box>
    );
  }

  const shortfall = answerShortfallFor(answer.retrieval_outcome);
  const refused = refusedCitationCount(answer.retrieval_outcome);

  return (
    <Box data-kb-answer sx={{ mt: 1 }}>
      <Box sx={{ ...BODY_SX(true), ...PROSE_SX }}>
        <MarkdownPreview markdown={answer.answer} renderLink={renderInertLink} />
      </Box>

      <SourceList answer={answer} pages={pages} onSelectPage={onSelectPage} />

      {shortfall ? (
        // THE MEASURED CASE THIS SENTENCE EXISTS FOR: at 1500-character pages,
        // a generic question over a 20-page scope excludes the page holding
        // the answer at every size from 20 up, and the model's honest "I
        // cannot answer from these pages" is then TRUE ABOUT THE BLOCK and
        // FALSE ABOUT THE KNOWLEDGE BASE. A user reading the refusal without
        // this line has no way to tell those apart.
        <Typography data-kb-shortfall sx={{ ...CAPTION_SX, mt: 0.5 }}>
          {`Only ${shortfall.shown} of the ${shortfall.withMaterial} pages with anything written in them fitted into this answer — not finding it here does not mean it is not written down.`}
        </Typography>
      ) : null}

      {refused > 0 ? (
        <Typography sx={{ ...CAPTION_SX, mt: 0.5 }}>
          {`${refused} source${refused === 1 ? "" : "s"} the model named did not match any page in this scope, so ${
            refused === 1 ? "it is" : "they are"
          } not listed.`}
        </Typography>
      ) : null}
    </Box>
  );
}

export default function KnowledgeQuestionBox({
  pagesInScope,
  pages,
  draft,
  onDraftChange,
  onAsk,
  busy,
  askError,
  answer,
  onSelectPage,
}) {
  const fieldId = useId();
  const helperId = `${fieldId}-helper`;
  const captionId = `${fieldId}-caption`;

  const typed = (draft || "").trim();
  const blocked = busy || typed === "";
  const pageWord = `${pagesInScope} page${pagesInScope === 1 ? "" : "s"}`;

  // The live caption. It is an aria-describedby target of the field, so it is
  // always mounted even when it has nothing to say — a target that comes and
  // goes leaves the field pointing at an id that does not resolve.
  let caption = "";
  if (busy) caption = `Looking through ${pageWord}…`;
  else if (askError) caption = askError;
  else if (typed === "") caption = "Type a question to answer from these pages.";

  function submit() {
    // The real block. `aria-disabled` stops nothing on its own.
    if (blocked) return;
    onAsk();
  }

  return (
    <Box sx={{ mt: 1.5 }}>
      <TextField
        id={fieldId}
        label="Ask about these pages"
        value={draft || ""}
        onChange={(event) => onDraftChange(event.target.value)}
        multiline
        minRows={2}
        size="small"
        fullWidth
        helperText="Answers come only from the pages this panel covers."
        slotProps={{
          formHelperText: { id: helperId },
          // Both ids, spelled out — see this file's header for what supplying
          // this silently replaces.
          htmlInput: { "aria-describedby": `${helperId} ${captionId}` },
        }}
        sx={FIELD_SX}
      />

      <Typography id={captionId} sx={{ ...CAPTION_SX, mt: 0.5, minHeight: "1em" }}>
        {caption}
      </Typography>

      <Button
        variant="outlined"
        size="small"
        aria-disabled={blocked ? "true" : undefined}
        onClick={submit}
        sx={{ ...BTN_SX, mt: 0.5 }}
      >
        {busy ? `Looking through ${pageWord}…` : "Answer from these pages"}
      </Button>

      {/* A refusal that never became a row at all — an engine or key
          misconfiguration, or a transport failure — is already carried by the
          caption above, which the field points at. It is deliberately NOT
          repeated here: two copies of one sentence read as two problems. */}
      {answer ? <AnswerBlock answer={answer} pages={pages} onSelectPage={onSelectPage} /> : null}
    </Box>
  );
}
