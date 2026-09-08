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
//   1. <LiveHearingStrip appears AHEAD of the bounded wrapper — and
//      therefore ahead of the sticky question strip, SessionSetup and the
//      dashboard — mounted unconditionally, so it is in the DOM whether or
//      not a session is live. (ARCH-sticky §2.3: this used to say "INSIDE
//      the bounded wrapper". A `position: sticky` element can only occlude
//      what FOLLOWS it in flow, so once <StickyQuestionStrip mounts above
//      that wrapper, anything left inside it would be covered for the whole
//      session at `sm` and `xs` — which is the exact below-the-fold
//      condition D1 exists to prevent, reintroduced by a different
//      mechanism. Hoisting it above the strip closes that structurally and
//      costs zero column height, because useLiveColumnHeight.js:32 sizes
//      the wrapper from its own `rect.top`.)
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

// ARCH-sticky pin 9b. Every property the D1 guard asserts about
// <LiveHearingStrip's position, evaluated as DATA rather than as inline
// `expect`s, so the [control] runs below execute the byte-identical code
// path against deliberately broken sources. That is what makes the control
// a control: mutating this function is mutating the shipped guard.
//
// The searches deliberately start at index 0, not at `wrapperOpen`. The old
// shape searched forward from the wrapper, so hoisting the element above
// the wrapper turned its index into -1 — which made `:64` red but left
// `:65` (`-1 < wrapperClose`) VACUOUSLY TRUE for any file forever. The
// `missing` and `duplicated` entries below are what stop the same class of
// -1-compared-against--1 collapse here; see MUTATION 1 / MUTATION 2 in the
// [control] runs.
function liveHearingStripFailures(source) {
  const { openIdx: wrapperOpen, closeIdx: wrapperClose } = span(
    source,
    "ref={liveWrapperRef}",
    WRAPPER_CLOSE_MARKER,
  );
  const stripIdx = source.indexOf("<LiveHearingStrip");
  const stickyIdx = source.indexOf("<StickyQuestionStrip");
  const preamble = stripIdx > -1 ? source.slice(Math.max(0, stripIdx - 40), stripIdx) : "";

  const failures = [];
  if (!(wrapperOpen > -1 && wrapperClose > wrapperOpen)) failures.push("no-bounded-wrapper");
  // MUTATION 1 guards this line.
  if (!(stripIdx > -1)) failures.push("missing");
  // MUTATION 2 guards this line.
  if (source.lastIndexOf("<LiveHearingStrip") !== stripIdx) failures.push("duplicated");
  // Ahead of SessionSetup, the dashboard and everything else the session UI
  // puts on screen — the D1 property itself.
  if (!(stripIdx < wrapperOpen)) failures.push("not-ahead-of-the-session-ui");
  // …and ahead of the sticky question strip, because a sticky element can
  // only occlude what follows it in flow (ARCH-sticky §2.3).
  if (!(stripIdx < stickyIdx)) failures.push("behind-the-sticky-strip");
  // MINOR-3: "mounted unconditionally" is half of the stated property and
  // nothing used to check it. A `{live ? <LiveHearingStrip … /> : null}`
  // placed ABOVE the wrapper satisfies every positional assertion while
  // still breaking D5, which needs the element MOUNTED before a session
  // starts so its hidden live regions are already in the DOM.
  if (/(\?|&&)\s*\(?\s*$/.test(preamble)) failures.push("conditionally-mounted");
  return failures;
}

describe("D1: the hearing strip and question feed are not below the fold", () => {
  it("mounts <LiveHearingStrip unconditionally, ahead of both the bounded wrapper and the sticky strip", () => {
    expect(liveHearingStripFailures(CLIENT_SOURCE)).toEqual([]);
  });

  it("[control] the shipped guard passes against the shape it is asking for", () => {
    // Not decoration: the assertion above is RED until the hoist lands, and
    // a guard nobody has ever seen go green may simply be unsatisfiable.
    // This is the same file's own anti-vacuity discipline, run in the
    // positive direction.
    const fixed = `
      <>
        <LiveHearingStrip live={live} finals={finals} />
        {mountStrip ? <StickyQuestionStrip current={current} /> : null}
        <Box ref={liveWrapperRef}>
          <SessionSetup />
        </Box>
        {/* D1/AC-S3.11: split into its own file */}
      </>
    `;
    expect(liveHearingStripFailures(fixed)).toEqual([]);
  });

  it("[control] fails against the pre-D1 shape: the strip below the wrapper in a trailing {live ? … } block", () => {
    // The original D1 bug: the wrapper closes, then LOTS of other JSX, and
    // only THEN does <LiveHearingStrip appear — inside a later
    // `{live ? … : …}` block, not ahead of anything.
    const broken = `
      {mountStrip ? <StickyQuestionStrip current={current} /> : null}
      <Box ref={liveWrapperRef}>
        <Typography>share instructions</Typography>
      </Box>
      {/* D1/AC-S3.11: split into its own file */}
      {live ? (
        <LiveHearingStrip live={live} />
      ) : null}
    `;
    expect(liveHearingStripFailures(broken)).toEqual(
      expect.arrayContaining(["not-ahead-of-the-session-ui", "behind-the-sticky-strip", "conditionally-mounted"]),
    );
  });

  it("[control] fails against the shape this change replaces: the strip INSIDE the bounded wrapper", () => {
    // The shape that shipped between D1 and ARCH-sticky. It is not the
    // pre-D1 bug — the element IS mounted unconditionally inside the
    // wrapper — but with a sticky strip above the wrapper it is occluded
    // for the whole session at `sm` and `xs`. The pre-existing [control]
    // modelled only the trailing-`{live ? }` shape and PASSED this one, so
    // this run is an extension of it, not an edit.
    const broken = `
      {mountStrip ? <StickyQuestionStrip current={current} /> : null}
      <Box ref={liveWrapperRef}>
        <LiveHearingStrip live={live} />
        <SessionSetup />
      </Box>
      {/* D1/AC-S3.11: split into its own file */}
    `;
    expect(liveHearingStripFailures(broken)).toEqual(
      expect.arrayContaining(["not-ahead-of-the-session-ui", "behind-the-sticky-strip"]),
    );
  });

  it("[control] MUTATION 1 — with <LiveHearingStrip deleted, the `missing` check is the only thing that fires", () => {
    // Delete the component's call site entirely and every POSITIONAL check
    // above passes on -1: `-1 < wrapperOpen` and `-1 < stickyIdx` are both
    // true. Drop `missing` from liveHearingStripFailures and this guard can
    // never fail again — the exact -1-vs--1 collapse this file's header
    // comment names. Asserted here so a future edit that removes it turns
    // this run red rather than going quietly vacuous.
    const deleted = `
      {mountStrip ? <StickyQuestionStrip current={current} /> : null}
      <Box ref={liveWrapperRef}>
        <SessionSetup />
      </Box>
      {/* D1/AC-S3.11: split into its own file */}
    `;
    expect(liveHearingStripFailures(deleted)).toEqual(["missing"]);
  });

  it("[control] MUTATION 2 — a second <LiveHearingStrip site is invisible to every first-index check", () => {
    // Both call sites here are correctly placed by every positional test,
    // because all of them read indexOf() — the FIRST index — only. The
    // duplicate is real breakage: the second copy sits inside the wrapper,
    // below the sticky strip, where it is occluded. Drop
    // `lastIndexOf(…) !== stripIdx` and this returns [].
    const duplicated = `
      <LiveHearingStrip live={live} />
      {mountStrip ? <StickyQuestionStrip current={current} /> : null}
      <Box ref={liveWrapperRef}>
        <LiveHearingStrip live={live} />
        <SessionSetup />
      </Box>
      {/* D1/AC-S3.11: split into its own file */}
    `;
    expect(liveHearingStripFailures(duplicated)).toEqual(["duplicated"]);
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

  // ARCH-sticky pin 9a. Before the relocation, "a detected question is
  // never hidden" held true because CurrentQuestionPanel rendered
  // unconditionally INSIDE CopilotDashboard, itself unconditionally inside
  // this bounded wrapper (see this test's own prior shape, in source
  // control history, for exactly that check). That call site is gone —
  // dashboard/CopilotDashboard.js no longer renders CurrentQuestionPanel at
  // all (ARCH-sticky §2.1: relocation, not duplication) — so the property
  // this D1-adjacent test guards has to be restated for where the question
  // panel actually lives now: mounted from <StickyQuestionStrip, AHEAD of
  // the bounded wrapper rather than inside it, so it is reachable
  // regardless of whatever the wrapper's own `overflow: hidden` clips.
  it("mounts <StickyQuestionStrip ahead of the bounded, overflow:hidden wrapper", () => {
    const stickyIdx = CLIENT_SOURCE.indexOf("<StickyQuestionStrip");
    const wrapperOpen = CLIENT_SOURCE.indexOf("ref={liveWrapperRef}");
    expect(stickyIdx).toBeGreaterThan(-1);
    expect(wrapperOpen).toBeGreaterThan(-1);
    expect(stickyIdx).toBeLessThan(wrapperOpen);
  });

  it("[control] fails once <StickyQuestionStrip is missing entirely", () => {
    const broken = `
      <LiveHearingStrip live={live} />
      <Box ref={liveWrapperRef}>
        <SessionSetup />
      </Box>
    `;
    const stickyIdx = broken.indexOf("<StickyQuestionStrip");
    const wrapperOpen = broken.indexOf("ref={liveWrapperRef}");
    expect(stickyIdx > -1 && stickyIdx < wrapperOpen).toBe(false);
  });

  it("[control] fails once <StickyQuestionStrip moves INSIDE the bounded wrapper", () => {
    // The shape this change replaces at the OLD call site's own level: the
    // panel reachable only through a container the CSS can clip.
    const broken = `
      <LiveHearingStrip live={live} />
      <Box ref={liveWrapperRef}>
        {mountStrip ? <StickyQuestionStrip current={current} /> : null}
        <SessionSetup />
      </Box>
    `;
    const stickyIdx = broken.indexOf("<StickyQuestionStrip");
    const wrapperOpen = broken.indexOf("ref={liveWrapperRef}");
    expect(stickyIdx > -1 && stickyIdx < wrapperOpen).toBe(false);
  });

  // The question panel itself no longer renders through CopilotDashboard.js
  // at all — see app/copilot/dashboard/StickyQuestionStrip.test.js and
  // app/copilot/predictionsRemoved.test.js for that coverage.
  it("dashboard/CopilotDashboard.js no longer calls <CurrentQuestionPanel", () => {
    const dashboardSource = readFileSync(
      fileURLToPath(new URL("./dashboard/CopilotDashboard.js", import.meta.url)),
      "utf8",
    );
    expect(dashboardSource.indexOf("<CurrentQuestionPanel")).toBe(-1);
  });
});
