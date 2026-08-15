"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import Stack from "@mui/material/Stack";
import TranscriptView from "./TranscriptView";
import QuestionFeed from "./QuestionFeed";
import { TOUCH_TARGET_SX } from "./mobileSx";

// Step 4: links the transcript disclosure's Button (aria-controls) to the
// region it shows/hides. D1: covers BOTH <TranscriptView> and
// <QuestionFeed> — see this component's own module doc below for why.
const HISTORY_REGION_ID = "copilot-history-region";

// D1/AC-S3.11: extracted out of CopilotClient.js purely to keep that file
// under this project's 1000-line cap (the same reason useLiveSession.js and
// useCopilotDashboard.js were themselves split out of it — see
// CopilotClient.js's own module doc). Every value here is a prop; the only
// state this owns is none — `showHistory`/`onToggleHistory` are
// CopilotClient's, reset per-session there.
//
// D1: the transcript disclosure — the tallest content on this page, and
// (reverted) the ONLY thing this disclosure now covers along with
// <QuestionFeed>. An earlier change (AC-S3.8) pulled <QuestionFeed> out to
// render "unconditionally" above this button, alongside the hearing strip
// — but that placement was itself INSIDE CopilotClient.js's bounded,
// `overflow: hidden` live wrapper (`liveWrapperRef`). On desktop, while
// live, that wrapper's content past its measured height is clipped, not
// scrolled — so a QuestionFeed rendered "unconditionally" there was in
// practice rendered below the fold, exactly the failure this feature exists
// to fix, just relocated. D1 moves it back here, inside this Collapse,
// where CopilotDashboard's own current-question panel (rendered
// unconditionally INSIDE the bounded wrapper, see CopilotDashboard.js's
// CurrentQuestionPanel) already covers "a detected question is never
// hidden" — an honest disclosure beats a feed nobody is told exists.
// Rendered OUTSIDE that bounded wrapper (this component's own call site in
// CopilotClient.js) so opting in to either is free to scroll — only DEFAULT
// scrolling must stop, and the hearing strip (LiveHearingStrip, at the TOP
// of the wrapper, not here) already gives that default screen a working
// session's actual signal.
export default function TranscriptDisclosure({
  live,
  showHistory,
  onToggleHistory,
  finals,
  interims,
  startedAt,
  identityProps,
  questions,
  onDraft,
}) {
  if (!live) {
    return (
      <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ alignItems: "stretch", mt: 2 }}>
        <TranscriptView finals={finals} interims={interims} startedAt={startedAt} {...identityProps} />
        <QuestionFeed questions={questions} onDraft={onDraft} />
      </Stack>
    );
  }
  return (
    <>
      <Button
        size="small"
        variant="text"
        onClick={onToggleHistory}
        aria-expanded={showHistory}
        aria-controls={HISTORY_REGION_ID}
        sx={{ mt: 2, color: "var(--text-secondary)", textTransform: "none", ...TOUCH_TARGET_SX }}
      >
        {/* D11: the glyph is wrapped `aria-hidden` — unwrapped, it is part
            of this button's computed accessible name (read aloud as "black
            right-pointing small triangle", or dropped outright, depending
            on the screen reader), and it is redundant with `aria-expanded`
            above regardless. */}
        <Box component="span" aria-hidden="true">
          {showHistory ? "▾" : "▸"}
        </Box>{" "}
        {showHistory ? "Hide transcript and question history" : "Show transcript and question history"}
      </Button>
      <Collapse in={showHistory}>
        <Stack
          id={HISTORY_REGION_ID}
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          sx={{ alignItems: "stretch", mt: 2 }}
        >
          <TranscriptView finals={finals} interims={interims} startedAt={startedAt} {...identityProps} />
          <QuestionFeed questions={questions} onDraft={onDraft} />
        </Stack>
      </Collapse>
    </>
  );
}
