// D1 — CRITICAL. The bounded, `overflow: hidden` live wrapper (the
// `liveWrapperRef` Box in CopilotClient.js) clips everything past its
// measured height on desktop while `live`. <LiveHearingStrip> and
// <QuestionFeed> used to render OUTSIDE that wrapper (only inside a
// trailing `{live ? ... : ...}` block below it), which put both below the
// fold by construction: a working copilot and a completely deaf one looked
// identical on the default screen.
//
// The property under test IS the shape of the source — where a JSX element
// sits relative to another — so a source-text test is the right tool: no
// jsdom, no React rendering, just string positions. CopilotClient.js itself
// only has to get <LiveHearingStrip inside its own bounded wrapper right;
// <QuestionFeed>'s placement inside the transcript <Collapse> now lives one
// level down, in TranscriptDisclosure.js (split out purely to keep
// CopilotClient.js under this project's 1000-line cap — see that file's own
// module doc), so this file checks both pieces where each actually lives:
//   1. <LiveHearingStrip appears INSIDE CopilotClient.js's bounded wrapper
//      (before it closes), so it is mounted whether or not a session is
//      live.
//   2. CopilotClient.js renders <TranscriptDisclosure OUTSIDE that wrapper
//      (after it closes) — the component that owns the transcript/question
//      disclosure at all.
//   3. TranscriptDisclosure.js itself renders <QuestionFeed inside its own
//      <Collapse>, not as a sibling rendered before it opens.
//
// Each assertion is paired with a control proving it can actually fail —
// run against a snippet shaped like the OLD, broken layout — so a change
// that silently stopped checking anything (e.g. an index of -1 compared
// against another -1) would be caught here, not just in this file's own
// prose.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CLIENT_SOURCE = readFileSync(fileURLToPath(new URL("./CopilotClient.js", import.meta.url)), "utf8");
const DISCLOSURE_SOURCE = readFileSync(
  fileURLToPath(new URL("./TranscriptDisclosure.js", import.meta.url)),
  "utf8",
);

// The comment that immediately follows the bounded wrapper's own closing
// `</Box>` in CopilotClient.js — used here purely as a source-position
// anchor, not asserted on for its own content.
const WRAPPER_CLOSE_MARKER = "{/* D1/AC-S3.11: split into its own file";

function span(text, openMarker, closeMarker, fromIndex = 0) {
  const openIdx = text.indexOf(openMarker, fromIndex);
  const closeIdx = closeMarker == null ? text.length : text.indexOf(closeMarker, openIdx);
  return { openIdx, closeIdx };
}

describe("D1: the hearing strip and question feed are not below the fold", () => {
  it("mounts <LiveHearingStrip inside the bounded, no-scroll live wrapper", () => {
    const { openIdx: wrapperOpen, closeIdx: wrapperClose } = span(
      CLIENT_SOURCE,
      "ref={liveWrapperRef}",
      WRAPPER_CLOSE_MARKER,
    );
    const stripIdx = CLIENT_SOURCE.indexOf("<LiveHearingStrip", wrapperOpen);

    expect(wrapperOpen).toBeGreaterThan(-1);
    expect(wrapperClose).toBeGreaterThan(wrapperOpen);
    expect(stripIdx).toBeGreaterThan(wrapperOpen);
    expect(stripIdx).toBeLessThan(wrapperClose);
  });

  it("[control] the LiveHearingStrip-inside-wrapper check fails against the old (broken) shape", () => {
    // Models the pre-D1 file: the wrapper closes, then LOTS of other JSX,
    // and only THEN does <LiveHearingStrip appear (inside a later `{live ?
    // ... : ...}` block, not the wrapper).
    const broken = `
      <Box ref={liveWrapperRef}>
        <Typography>share instructions</Typography>
      </Box>
      {/* D1/AC-S3.11: split into its own file */}
      {live ? (
        <LiveHearingStrip live={live} />
      ) : null}
    `;
    const { openIdx: wrapperOpen, closeIdx: wrapperClose } = span(
      broken,
      "ref={liveWrapperRef}",
      "{/* D1/AC-S3.11: split into its own file",
    );
    const stripIdx = broken.indexOf("<LiveHearingStrip", wrapperOpen);
    expect(stripIdx > wrapperOpen && stripIdx < wrapperClose).toBe(false);
  });

  it("renders <TranscriptDisclosure OUTSIDE the bounded wrapper, after it closes", () => {
    const { closeIdx: wrapperClose } = span(CLIENT_SOURCE, "ref={liveWrapperRef}", WRAPPER_CLOSE_MARKER);
    const disclosureIdx = CLIENT_SOURCE.indexOf("<TranscriptDisclosure", wrapperClose);
    expect(wrapperClose).toBeGreaterThan(-1);
    expect(disclosureIdx).toBeGreaterThan(wrapperClose);
  });

  it("mounts <QuestionFeed inside TranscriptDisclosure's transcript Collapse, not before it opens", () => {
    const collapseOpen = DISCLOSURE_SOURCE.indexOf("<Collapse in={showHistory}>");
    const collapseClose = DISCLOSURE_SOURCE.indexOf("</Collapse>", collapseOpen);
    const feedIdx = DISCLOSURE_SOURCE.indexOf("<QuestionFeed", collapseOpen);

    expect(collapseOpen).toBeGreaterThan(-1);
    expect(collapseClose).toBeGreaterThan(collapseOpen);
    expect(feedIdx).toBeGreaterThan(collapseOpen);
    expect(feedIdx).toBeLessThan(collapseClose);
  });

  it("[control] the QuestionFeed-inside-Collapse check fails against the old (broken) shape", () => {
    // Models the pre-D1 file: <QuestionFeed rendered as a sibling BEFORE
    // the Collapse even opens, unconditionally "visible" but, in practice,
    // inside the clipped wrapper in CopilotClient.js.
    const broken = `
      <QuestionFeed questions={questions} onDraft={onDraft} />
      <Collapse in={showHistory}>
        <TranscriptView />
      </Collapse>
    `;
    const collapseOpen = broken.indexOf("<Collapse in={showHistory}>");
    const collapseClose = broken.indexOf("</Collapse>", collapseOpen);
    const feedIdx = broken.indexOf("<QuestionFeed", collapseOpen);
    expect(feedIdx > collapseOpen && feedIdx < collapseClose).toBe(false);
  });

  it("CopilotDashboard's current-question panel is reachable unconditionally inside the bounded wrapper", () => {
    // The whole D1 justification depends on this being true: "a detected
    // question is never hidden" has to already hold true SOMEWHERE inside
    // the clipped wrapper for pulling QuestionFeed back behind the
    // disclosure to be the right call rather than a regression. See
    // dashboard/CopilotDashboard.js's own CurrentQuestionPanel — rendered
    // directly (no `live`/`showHistory` gate of its own) inside
    // <CopilotDashboard>, which this file renders inside the wrapper.
    const { openIdx: wrapperOpen, closeIdx: wrapperClose } = span(
      CLIENT_SOURCE,
      "ref={liveWrapperRef}",
      WRAPPER_CLOSE_MARKER,
    );
    const dashboardIdx = CLIENT_SOURCE.indexOf("<CopilotDashboard", wrapperOpen);
    expect(dashboardIdx).toBeGreaterThan(wrapperOpen);
    expect(dashboardIdx).toBeLessThan(wrapperClose);

    const dashboardSource = readFileSync(
      fileURLToPath(new URL("./dashboard/CopilotDashboard.js", import.meta.url)),
      "utf8",
    );
    // CurrentQuestionPanel's own call site inside the default export —
    // not behind any local `if`/`&&`/ternary gate of its own.
    const callIdx = dashboardSource.indexOf("<CurrentQuestionPanel current={current}");
    expect(callIdx).toBeGreaterThan(-1);
  });
});
