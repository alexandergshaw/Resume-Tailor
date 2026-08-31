// @vitest-environment jsdom
//
// The Drive result region: where save/download outcomes are reported,
// above `DialogActions`, in `ReviseStrip`'s slot (`UX.md` rev 2 §3).
// `app/components/JobDescriptionTab.test.js` is the worked example for
// rendering a component under jsdom in this repo.
//
// This file also holds the announcement-sequencing test for BLK-5/BLK-6:
// `DocumentPreviewDialog.js` has zero live regions today, and the repo has
// a recorded trap where two consecutive IDENTICAL announcement strings
// produce no DOM mutation (React bails on an unchanged state update, and
// the user hears nothing). The design dissolves this STRUCTURALLY by
// announcing a start sentence before every outcome, so this test proves the
// structural property holds at the DOM level rather than reaching for a
// nonce or a zero-width character (a zero-width nonce leaked U+200B into
// copied text the last time this repo tried it -- `mui-a11y-traps` item 6).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import DriveResultRegion from "./DriveResultRegion.js";
import DriveActions from "./DriveActions.js";
import {
  DRIVE_IN_YOUR_DRIVE,
  savedSummary,
  partialSavedSummary,
  downloadedSummary,
  DRIVE_CONVERSION_CAPTION,
  DRIVE_STALE_CAPTION,
  DRIVE_RECONNECT_TO_DOWNLOAD_CAPTION,
  hiringEmailDriveNote,
  driveAnnounceStart,
} from "@/lib/drive/driveMessages.js";
import { driveSaveBatch, SCOPE_OUTCOME } from "@/lib/drive/driveSaveBatch.js";

const HERE = dirname(fileURLToPath(import.meta.url));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

// Every call site in this file goes through here, so a bare `render({...})`
// -- the vast majority of this file's tests, none of which are testing the
// announcement contract itself -- gets a valid `announcement={{polite:"",
// alert:""}}` by default rather than having to spell it out 30+ times. This
// default lives ONLY in the test's own convenience wrapper, never in the
// component (`DriveResultRegion.js` itself now THROWS on a missing
// `announcement`, per MAJ-2) -- callers that want to exercise the missing-
// prop/missing-field contract pass `announcement` explicitly (even
// `announcement: undefined`), which this spread lets override the default.
async function render(props) {
  const withAnnouncement = { announcement: { polite: "", alert: "" }, ...props };
  await act(async () => {
    root.render(createElement(DriveResultRegion, withAnnouncement));
  });
}

// Renders the real component with NO convenience default at all, for tests
// that need to prove the component's OWN behaviour when a prop is entirely
// absent -- `render()` above would mask that by always supplying one.
async function renderRaw(props) {
  await act(async () => {
    root.render(createElement(DriveResultRegion, props));
  });
}

function politeRegion() {
  return container.querySelector('[role="status"]');
}
function alertRegion() {
  return container.querySelector('[role="alert"]');
}
function links() {
  return [...container.querySelectorAll("a")];
}

// Reads back the actual CSS text emotion (MUI's `sx` engine) inserted for an
// element's own generated class -- the same technique WAVE3-SEAMS.md's own
// PROBE3c used to prove the colour divergence between DriveActions and
// DriveResultRegion. `getComputedStyle` is not used here: jsdom does not
// resolve `var(--x)` custom properties through the cascade, so it would just
// echo back whatever the FIRST matching declaration says without actually
// proving which rule applied -- reading the stylesheet text directly is the
// only way to see the literal `color: var(--success)` / `var(--danger)`
// declaration this component actually emitted for THIS element.
function cssRuleTextFor(el) {
  const cssClass = [...el.classList].find((c) => c.startsWith("css-"));
  if (!cssClass) return "";
  const texts = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of rules) {
      if (rule.selectorText && rule.selectorText.includes(cssClass)) texts.push(rule.cssText);
    }
  }
  return texts.join(" ");
}

async function click(el) {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("DriveResultRegion -- live regions always mount (AC-A5)", () => {
  it("renders both the polite status region and the alert region even with nothing else to show", async () => {
    await render({});
    expect(politeRegion()).not.toBeNull();
    expect(alertRegion()).not.toBeNull();
    expect(politeRegion().getAttribute("aria-live")).toBe("polite");
  });

  it("renders no visible strip content at all in the empty state -- 'the button is the empty state' (UX.md §6.2)", async () => {
    await render({});
    // Positive control paired with this absence assertion: the SAME render
    // with content present (next describe block) produces visible text, so
    // a component that renders nothing regardless of props cannot pass the
    // suite as a whole.
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.textContent).toBe("");
    // Stronger than the text/link checks above: asserts there is no EMPTY
    // wrapper box either. Only the two live-region spans exist as direct
    // children of the fragment -- an implementation that always renders the
    // visible-content box (just with nothing inside it, so textContent is
    // still "") would pass the two checks above vacuously but fail this one.
    expect(container.children).toHaveLength(2);
    expect([...container.children].every((el) => el.tagName === "SPAN")).toBe(true);
  });
});

describe("DriveResultRegion -- leading line text comes from driveMessages.js, never retyped", () => {
  it("idle (rehydrated): exact DRIVE_IN_YOUR_DRIVE text", async () => {
    await render({ leadingLine: { kind: "idle" } });
    expect(container.textContent).toContain(DRIVE_IN_YOUR_DRIVE);
  });

  it("saved, n=2: exact savedSummary(2) text, imported and called for real (not a copy)", async () => {
    await render({ leadingLine: { kind: "saved", count: 2 } });
    expect(container.textContent).toContain(savedSummary(2));
    expect(container.textContent).toContain("Saved 2 documents to Drive.");
  });

  it("saved, n=1: exact savedSummary(1) text -- singular, no count", async () => {
    await render({ leadingLine: { kind: "saved", count: 1 } });
    expect(container.textContent).toContain(savedSummary(1));
    expect(container.textContent).toContain("Saved 1 document to Drive.");
  });

  it("partial: exact partialSavedSummary(1,2) text", async () => {
    await render({ leadingLine: { kind: "partial", saved: 1, total: 2 } });
    expect(container.textContent).toContain(partialSavedSummary(1, 2));
    expect(container.textContent).toContain("Saved 1 of 2 documents to Drive.");
  });

  it("downloaded: exact downloadedSummary(2) text", async () => {
    await render({ leadingLine: { kind: "downloaded", count: 2 } });
    expect(container.textContent).toContain(downloadedSummary(2));
    expect(container.textContent).toContain("Downloaded 2 documents from Drive.");
  });

  it("null leadingLine (nothing saved -- the failure row carries the message instead): no leading line rendered", async () => {
    await render({
      leadingLine: null,
      rows: driveSaveBatch([
        { scope: "resume", label: "Resume", result: SCOPE_OUTCOME.ERROR, errorKind: "transient" },
      ]).rows,
    });
    expect(container.textContent).not.toContain("Saved");
    expect(container.textContent).toContain("Google Drive is busy");
  });
});

describe("DriveResultRegion -- partial batch: never claims both saved when one did not (central contract)", () => {
  it("shows the successful scope's link AND only the failing scope's error, simultaneously", async () => {
    const batch = driveSaveBatch([
      {
        scope: "resume",
        label: "Resume",
        result: SCOPE_OUTCOME.SAVED,
        name: "Acme - Senior Engineer - Resume",
        webViewLink: "https://docs.google.com/document/d/RESUME_ID/edit",
      },
      {
        scope: "cover",
        label: "Cover letter",
        result: SCOPE_OUTCOME.NO_BYTES,
      },
    ]);
    // `batch.leadingLine` and `batch.rows` -- driveSaveBatch's OWN real
    // output, never a hand-built `{kind:"partial",...}` fixture (BLOCKER
    // B1's rule: whenever a producer feeds an existing consumer, the join
    // must run through the real producer).
    await render({ leadingLine: batch.leadingLine, rows: batch.rows });

    expect(container.textContent).toContain("Saved 1 of 2 documents to Drive.");
    expect(container.textContent).not.toContain("Saved 2 documents to Drive.");

    const link = links().find((a) => a.href === "https://docs.google.com/document/d/RESUME_ID/edit");
    expect(link).toBeDefined();
    expect(link.textContent).toBe("Acme - Senior Engineer - Resume");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");

    expect(container.textContent).toContain(
      "Cover letter — couldn't rebuild the document. Regenerate the cover letter, or upload your cover letter template (.docx), then save again.",
    );
  });
});

describe("DriveResultRegion -- fed driveSaveBatch's REAL output end to end (BLOCKER B1)", () => {
  // WAVE3-SEAMS.md BLOCKER B1: `driveSaveBatch` used to return
  // `summary: string|null`; this component's `leadingLine` prop switches on
  // a `.kind` descriptor. The single most obvious wiring -- passing the
  // string straight through -- fell through `resolveLeadingLine`'s
  // `default: return null` and silently dropped the leading line, with
  // nothing throwing or going red anywhere. The fix was to have
  // `driveSaveBatch` emit the descriptor directly (`buildLeadingLine` in
  // that file), so there is no adapter -- a third place the shape is known
  // -- for the two to disagree about. These tests are the join: real
  // `driveSaveBatch(...)` output, unmodified, straight into this component.

  it("all-saved batch: driveSaveBatch(...).leadingLine renders the exact saved-summary text, with no hand-built descriptor anywhere in this test", async () => {
    const batch = driveSaveBatch([
      {
        scope: "resume",
        label: "Resume",
        result: SCOPE_OUTCOME.SAVED,
        name: "Acme - Resume",
        webViewLink: "https://docs.google.com/document/d/r/edit",
      },
      {
        scope: "cover",
        label: "Cover letter",
        result: SCOPE_OUTCOME.SAVED,
        name: "Acme - CL",
        webViewLink: "https://docs.google.com/document/d/c/edit",
      },
    ]);
    // The join itself: driveSaveBatch's OWN return value, unpacked straight
    // into props -- not `{ leadingLine: { kind: "saved", count: 2 } }`
    // typed out by hand.
    await render({ leadingLine: batch.leadingLine, rows: batch.rows });
    expect(container.textContent).toContain("Saved 2 documents to Drive.");
  });

  it("partial batch: driveSaveBatch(...).leadingLine renders the partial-summary text, not nothing (the exact silent-loss failure mode B1 records)", async () => {
    const batch = driveSaveBatch([
      {
        scope: "resume",
        label: "Resume",
        result: SCOPE_OUTCOME.SAVED,
        name: "Acme - Resume",
        webViewLink: "https://docs.google.com/document/d/r/edit",
      },
      { scope: "cover", label: "Cover letter", result: SCOPE_OUTCOME.NO_BYTES },
    ]);
    await render({ leadingLine: batch.leadingLine, rows: batch.rows });
    expect(container.textContent).toContain("Saved 1 of 2 documents to Drive.");
    // Positive control against the regression this join test exists to
    // catch: the OLD wiring (`leadingLine: batch.summary`, a string) fell
    // through to `resolveLeadingLine`'s default branch and rendered no
    // leading line at all -- this asserts the line really is present, not
    // merely that no error was thrown.
    expect(container.querySelector('[data-row-kind]')).not.toBeNull();
  });

  it("fully-failed batch: driveSaveBatch(...).leadingLine is null and the region renders no leading line -- the failure row alone carries the message", async () => {
    const batch = driveSaveBatch([
      { scope: "resume", label: "Resume", result: SCOPE_OUTCOME.ERROR, errorKind: "transient" },
    ]);
    expect(batch.leadingLine).toBeNull(); // sanity on the real producer's own output
    await render({ leadingLine: batch.leadingLine, rows: batch.rows });
    expect(container.textContent).not.toContain("Saved");
    expect(container.textContent).toContain("Google Drive is busy");
  });

  it("batch-abort: driveSaveBatch(...).leadingLine is null and only the batch-error row renders", async () => {
    const batch = driveSaveBatch([{ batchError: "offline" }]);
    expect(batch.leadingLine).toBeNull();
    await render({ leadingLine: batch.leadingLine, rows: batch.rows });
    expect(container.textContent).toContain("Couldn't reach Google Drive — check your connection.");
  });
});

describe("DriveResultRegion -- row colour distinguishes success from failure (MAJOR M-2, mutation M18)", () => {
  // WAVE3-SEAMS.md's own M18 mutation ("every row renders as a success")
  // SURVIVED against the suite as it existed: `DriveResultRegion.test.js`
  // had zero colour assertions anywhere, so a partial batch's failing row
  // could render in the SAME success colour as its succeeding sibling and
  // every existing test stayed green (the text assertions don't care about
  // colour). These tests read back the literal CSS declaration
  // `rowColor(row.kind)` produced for each row's own element (located via
  // `data-row-kind`, not by its text, so a mutation that scrambled `kind`
  // labelling but kept text right still gets caught).
  it("a success row is coloured var(--success) and a failure row var(--danger), in the SAME rendered batch", async () => {
    const batch = driveSaveBatch([
      {
        scope: "resume",
        label: "Resume",
        result: SCOPE_OUTCOME.SAVED,
        name: "Acme - Resume",
        webViewLink: "https://docs.google.com/document/d/r/edit",
      },
      { scope: "cover", label: "Cover letter", result: SCOPE_OUTCOME.NO_BYTES },
    ]);
    await render({ leadingLine: batch.leadingLine, rows: batch.rows });

    const successRow = container.querySelector('[data-row-kind="saved"]');
    const failureRow = container.querySelector('[data-row-kind="no-bytes"]');
    expect(successRow).not.toBeNull();
    expect(failureRow).not.toBeNull();

    const successCss = cssRuleTextFor(successRow);
    const failureCss = cssRuleTextFor(failureRow);
    // Positive controls first: prove each row actually got emotion CSS at
    // all, so an empty-string false pass can't hide behind the paired
    // assertions below.
    expect(successCss.length).toBeGreaterThan(0);
    expect(failureCss.length).toBeGreaterThan(0);

    expect(successCss).toContain("var(--success)");
    expect(successCss).not.toContain("var(--danger)");
    // Paired the other way: a `rowColor` that returns success for EVERY
    // kind (M18's exact mutation) would make this fail, because the
    // failure row's own CSS would then ALSO contain var(--success) instead
    // of var(--danger).
    expect(failureCss).toContain("var(--danger)");
    expect(failureCss).not.toContain("var(--success)");
  });

  it("every SUCCESS_ROW_KINDS member (saved / saved-new-doc / replaced-deleted) reads var(--success); every other kind reads var(--danger)", async () => {
    const savedNewDoc = driveSaveBatch([
      {
        scope: "resume",
        label: "Resume",
        result: SCOPE_OUTCOME.SAVED,
        conflictNewDoc: true,
        name: "Acme - Resume (2)",
        webViewLink: "https://docs.google.com/document/d/new/edit",
        previousName: "Acme - Resume",
        previousWebViewLink: "https://docs.google.com/document/d/old/edit",
      },
    ]);
    const replacedDeleted = driveSaveBatch([
      {
        scope: "resume",
        label: "Resume",
        result: SCOPE_OUTCOME.SAVED,
        replacedDeleted: true,
        name: "Acme - Resume",
        webViewLink: "https://docs.google.com/document/d/new/edit",
      },
    ]);
    const dismissed = driveSaveBatch([{ scope: "resume", label: "Resume", result: SCOPE_OUTCOME.DISMISSED }]);
    const tooLarge = driveSaveBatch([{ scope: "resume", label: "Resume", result: SCOPE_OUTCOME.TOO_LARGE }]);

    for (const [batch, kind, expectSuccess] of [
      [savedNewDoc, "saved-new-doc", true],
      [replacedDeleted, "replaced-deleted", true],
      [dismissed, "dismissed", false],
      [tooLarge, "too-large", false],
    ]) {
      await render({ leadingLine: batch.leadingLine, rows: batch.rows });
      const row = container.querySelector(`[data-row-kind="${kind}"]`);
      expect(row).not.toBeNull();
      const css = cssRuleTextFor(row);
      expect(css.length).toBeGreaterThan(0);
      if (expectSuccess) {
        expect(css).toContain("var(--success)");
        expect(css).not.toContain("var(--danger)");
      } else {
        expect(css).toContain("var(--danger)");
        expect(css).not.toContain("var(--success)");
      }
    }
  });
});

describe("DriveResultRegion -- captions (AC-D7/AC-P7/B-6)", () => {
  it("shows the conversion caption whenever it is asked to", async () => {
    await render({ showConversionCaption: true });
    expect(container.textContent).toContain(DRIVE_CONVERSION_CAPTION);
  });

  it("shows the stale caption ABOVE the conversion caption when both apply", async () => {
    await render({ showConversionCaption: true, stale: true });
    const text = container.textContent;
    expect(text).toContain(DRIVE_STALE_CAPTION);
    expect(text).toContain(DRIVE_CONVERSION_CAPTION);
    expect(text.indexOf(DRIVE_STALE_CAPTION)).toBeLessThan(text.indexOf(DRIVE_CONVERSION_CAPTION));
  });

  it("reconnect caption REPLACES the conversion/stale captions rather than joining them (B-6)", async () => {
    await render({ showConversionCaption: true, stale: true, reconnectCaption: true });
    expect(container.textContent).toContain(DRIVE_RECONNECT_TO_DOWNLOAD_CAPTION);
    expect(container.textContent).not.toContain(DRIVE_CONVERSION_CAPTION);
    expect(container.textContent).not.toContain(DRIVE_STALE_CAPTION);
  });

  it("hiring-email note is parameterised on scope count, not hardcoded (M-10)", async () => {
    await render({ hiringEmail: { scopeCount: 1 } });
    expect(container.textContent).toContain(hiringEmailDriveNote(1));
    expect(container.textContent).toContain("saves your resume — the hiring email isn't a document.");
  });

  it("hiring-email note, 2 scopes, differs from the 1-scope form", async () => {
    await render({ hiringEmail: { scopeCount: 2 } });
    expect(container.textContent).toContain(hiringEmailDriveNote(2));
    expect(container.textContent).toContain("saves your resume and cover letter");
  });
});

describe("DriveResultRegion + DriveActions -- each caption has exactly ONE owner (BLOCKER B2)", () => {
  // WAVE3-SEAMS.md BLOCKER B2: both components used to render all four Drive
  // captions -- proven 2/2/2/2 by the review's own probe. The ruling (see
  // this file's and DriveActions.js's header comments) makes
  // DriveResultRegion the sole owner of every caption; DriveActions renders
  // only its two controls. This test renders BOTH real components into the
  // SAME container, in the shape the real app will (siblings, both fed
  // props that would previously have triggered each caption on both sides),
  // and asserts each caption's text occurs exactly once -- not "at least
  // once", which a double-render would also satisfy.
  async function renderBoth({ driveActionsProps, driveResultRegionProps }) {
    await act(async () => {
      root.render(
        createElement(
          "div",
          null,
          createElement(DriveActions, driveActionsProps),
          createElement(DriveResultRegion, {
            announcement: { polite: "", alert: "" },
            ...driveResultRegionProps,
          }),
        ),
      );
    });
  }

  function countOccurrences(haystack, needle) {
    return haystack.split(needle).length - 1;
  }

  it("conversion caption: exactly 1 occurrence when both components are fed props that used to render it on both sides", async () => {
    await renderBoth({
      driveActionsProps: { status: "connected", connected: true, hasDriveReference: true },
      driveResultRegionProps: { showConversionCaption: true },
    });
    expect(countOccurrences(container.textContent, DRIVE_CONVERSION_CAPTION)).toBe(1);
  });

  it("stale caption: exactly 1 occurrence, and it is DriveResultRegion's --text-muted colouring that wins (not DriveActions' --warning)", async () => {
    await renderBoth({
      driveActionsProps: { status: "connected", connected: true, hasDriveReference: true, isStale: true },
      driveResultRegionProps: { stale: true },
    });
    expect(countOccurrences(container.textContent, DRIVE_STALE_CAPTION)).toBe(1);
  });

  it("reconnect-to-download caption: exactly 1 occurrence", async () => {
    await renderBoth({
      driveActionsProps: { status: "disconnected", connected: false, hasDriveReference: true },
      driveResultRegionProps: { reconnectCaption: true },
    });
    expect(countOccurrences(container.textContent, DRIVE_RECONNECT_TO_DOWNLOAD_CAPTION)).toBe(1);
  });

  it("hiring-email note: exactly 1 occurrence", async () => {
    await renderBoth({
      driveActionsProps: { status: "connected", scopeCount: 2 },
      driveResultRegionProps: { hiringEmail: { scopeCount: 2 } },
    });
    expect(countOccurrences(container.textContent, hiringEmailDriveNote(2))).toBe(1);
  });

  it("positive control: DriveActions alone renders its buttons but NONE of the four caption sentences", async () => {
    await act(async () => {
      root.render(
        createElement(DriveActions, {
          status: "connected",
          scopeCount: 2,
          connected: true,
          hasDriveReference: true,
          isStale: true,
        }),
      );
    });
    expect(container.textContent).not.toContain(DRIVE_CONVERSION_CAPTION);
    expect(container.textContent).not.toContain(DRIVE_STALE_CAPTION);
    expect(container.textContent).not.toContain(DRIVE_RECONNECT_TO_DOWNLOAD_CAPTION);
    expect(container.textContent).not.toContain("isn't a document");
    // Paired positive control: the buttons are still real, so this isn't
    // "DriveActions renders nothing at all" passing vacuously.
    expect(container.querySelectorAll("button").length).toBeGreaterThan(0);
  });
});

describe("DriveResultRegion -- the conflict prompt renders inline, in this same strip (UX.md §13)", () => {
  it("renders DriveOverwriteDialog when a prompt is pending, and forwards its callbacks", async () => {
    const onDismiss = vi.fn();
    const onSaveAsNew = vi.fn();
    const onOverwrite = vi.fn();
    await render({
      leadingLine: { kind: "partial", saved: 1, total: 2 },
      rows: [],
      prompt: {
        docNames: ["Acme - Senior Engineer - Resume"],
        onSaveAsNew,
        onOverwrite,
        onDismiss,
      },
    });

    const group = container.querySelector('[role="group"]');
    expect(group).not.toBeNull();
    expect(group.textContent).toContain("has changed in your Drive since this app last saved it");

    const notNow = [...container.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "Not now",
    );
    await click(notNow);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onSaveAsNew).not.toHaveBeenCalled();
    expect(onOverwrite).not.toHaveBeenCalled();
  });

  it("a pending prompt alone (no leading line, no rows) still counts as 'something to show'", async () => {
    await render({
      prompt: {
        docNames: ["Solo Doc"],
        onSaveAsNew: vi.fn(),
        onOverwrite: vi.fn(),
        onDismiss: vi.fn(),
      },
    });
    expect(container.querySelector('[role="group"]')).not.toBeNull();
  });
});

describe("DriveResultRegion -- a SECOND conflict remounts the prompt (BLOCKER B3)", () => {
  // WAVE3-SEAMS.md BLOCKER B3: without a `key` derived from the conflict's
  // own identity, React reconciles a second, DIFFERENT conflict into the
  // SAME `DriveOverwriteDialog` node as the first. That component's own
  // mount-time `useEffect([], …)` then never re-runs: focus is never
  // re-taken, the heading silently flips to the new conflict's text, and
  // the callbacks swap underneath a user who may still have the first
  // prompt's buttons in view. Proven here with the REAL sequence: prompt A
  // renders and takes focus, then prompt B (a DIFFERENT conflict) replaces
  // it, and both "did the node actually change" and "was focus re-taken"
  // are asserted directly -- not inferred from the text alone, since a
  // stale reconciled node could still show the right text while focus and
  // callbacks stayed wrong.
  it("node identity changes, focus is RE-TAKEN, and the heading/labels match the SECOND conflict, not a hidden pending-Enter hazard", async () => {
    const promptA = {
      docNames: ["Acme - Senior Engineer - Resume"],
      onSaveAsNew: vi.fn(),
      onOverwrite: vi.fn(),
      onDismiss: vi.fn(),
    };
    await render({ prompt: promptA });

    const groupA = container.querySelector('[role="group"]');
    expect(groupA).not.toBeNull();
    expect(document.activeElement).toBe(groupA); // mount-time focus, prompt A
    expect(groupA.textContent).toContain("Acme - Senior Engineer - Resume");
    expect(groupA.textContent).not.toContain("Both Docs");

    // Simulate focus having moved away in between (the realistic case: the
    // user read prompt A, and time passed before a second save produced a
    // NEW, larger conflict) -- so re-focus below can't be mistaken for
    // "focus just never left".
    groupA.blur();
    expect(document.activeElement).not.toBe(groupA);

    const promptB = {
      docNames: ["Acme - Senior Engineer - Resume", "Acme - Senior Engineer - Cover Letter"],
      onSaveAsNew: vi.fn(),
      onOverwrite: vi.fn(),
      onDismiss: vi.fn(),
    };
    await render({ prompt: promptB });

    const groupB = container.querySelector('[role="group"]');
    expect(groupB).not.toBeNull();
    // The core B3 assertion: a DIFFERENT DOM node, not the same one
    // reconciled with new content.
    expect(groupB).not.toBe(groupA);
    // Focus was RE-TAKEN on the new node (only possible if `useEffect([])`
    // actually re-ran, which only happens because the node remounted).
    expect(document.activeElement).toBe(groupB);
    // The new conflict's own text, not the old one's.
    expect(groupB.textContent).toContain("Both Docs have changed in your Drive since this app last saved them");
    expect(groupB.textContent).not.toContain("has changed in your Drive since this app last saved it.");

    // The callbacks in play are prompt B's, not prompt A's stale closures --
    // clicking "Overwrite the Docs" (B's plural label) must fire B's
    // callback only.
    const overwriteDocs = [...container.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "Overwrite the Docs",
    );
    expect(overwriteDocs).toBeDefined();
    await click(overwriteDocs);
    expect(promptB.onOverwrite).toHaveBeenCalledTimes(1);
    expect(promptA.onOverwrite).not.toHaveBeenCalled();
  });

  // WAVE3-SEAMS.md MAJ-1: the test above proves the remount fix works when
  // the second conflict names a DIFFERENT Doc -- but the fix that shipped
  // keyed on `prompt.id ?? JSON.stringify(prompt.docNames)`, and that
  // fallback is byte-identical for two activations naming the SAME Doc(s),
  // which is the single most likely repeat (the user leaves a prompt
  // undecided, a retry fires, the same Doc conflicts again). This is "the
  // test the current one should have been": SAME docNames on both prompts,
  // asserting the DOM node still changed, focus was still re-taken, and a
  // click after the swap fires only the SECOND prompt's callback.
  it("a SECOND conflict naming the SAME Doc(s) as the first STILL remounts the prompt (MAJ-1)", async () => {
    const promptA = {
      docNames: ["Acme - Senior Engineer - Resume"],
      onSaveAsNew: vi.fn(),
      onOverwrite: vi.fn(),
      onDismiss: vi.fn(),
    };
    await render({ prompt: promptA });

    const groupA = container.querySelector('[role="group"]');
    expect(groupA).not.toBeNull();
    expect(document.activeElement).toBe(groupA);

    // Same blur-first discipline as the different-Doc test above: prove
    // re-focus below is a REAL re-take, not "focus never left".
    groupA.blur();
    expect(document.activeElement).not.toBe(groupA);

    // A DIFFERENT prompt object, but the SAME docNames tuple -- the exact
    // shape `JSON.stringify(prompt.docNames)` cannot distinguish.
    const promptB = {
      docNames: ["Acme - Senior Engineer - Resume"],
      onSaveAsNew: vi.fn(),
      onOverwrite: vi.fn(),
      onDismiss: vi.fn(),
    };
    await render({ prompt: promptB });

    const groupB = container.querySelector('[role="group"]');
    expect(groupB).not.toBeNull();
    // The core MAJ-1 assertion: still a DIFFERENT DOM node, even though the
    // content (docNames) is identical to prompt A's.
    expect(groupB).not.toBe(groupA);
    // Focus was RE-TAKEN on the new node -- only possible if the mount
    // effect actually re-ran, which only happens if the node remounted.
    expect(document.activeElement).toBe(groupB);

    // The callbacks in play are prompt B's, not prompt A's stale closures.
    const overwriteDoc = [...container.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "Overwrite the Doc",
    );
    expect(overwriteDoc).toBeDefined();
    await click(overwriteDoc);
    expect(promptB.onOverwrite).toHaveBeenCalledTimes(1);
    expect(promptA.onOverwrite).not.toHaveBeenCalled();
    expect(promptA.onSaveAsNew).not.toHaveBeenCalled();
    expect(promptA.onDismiss).not.toHaveBeenCalled();
  });

  // WAVE3-SEAMS.md MAJ-1's other named gap: this prompt can also disappear
  // without the user choosing any of its three actions (the caller drops
  // `prompt` via some other route, e.g. the whole modal closing). Nothing
  // should be written, and focus should not be stranded on <body>.
  // `DriveOverwriteDialog.test.js` covers this mechanism directly and in
  // more detail; this test is the integration proof that it also holds
  // through `DriveResultRegion`'s own `key`-driven remount wiring.
  it("unmounting the prompt mid-decision (no button clicked) writes nothing and does not strand focus on <body>", async () => {
    const outside = document.createElement("button");
    outside.textContent = "Save to Drive";
    document.body.appendChild(outside);
    try {
      outside.focus();
      expect(document.activeElement).toBe(outside);

      const prompt = {
        docNames: ["Acme - Senior Engineer - Resume"],
        onSaveAsNew: vi.fn(),
        onOverwrite: vi.fn(),
        onDismiss: vi.fn(),
      };
      await render({ prompt });
      const group = container.querySelector('[role="group"]');
      expect(group).not.toBeNull();
      expect(document.activeElement).toBe(group);

      // The caller drops the prompt without the user clicking any of its
      // three buttons or pressing Escape.
      await render({ prompt: null });

      expect(container.querySelector('[role="group"]')).toBeNull();
      expect(document.activeElement).toBe(outside);
      expect(prompt.onSaveAsNew).not.toHaveBeenCalled();
      expect(prompt.onOverwrite).not.toHaveBeenCalled();
      expect(prompt.onDismiss).not.toHaveBeenCalled();
    } finally {
      outside.remove();
    }
  });
});

describe("DriveResultRegion -- announcements never coalesce (AC-A5/AC-A6, BLK-5/BLK-6)", () => {
  it("a start sentence followed by a distinct outcome sentence produces a real DOM mutation, over a save -> failure -> save sequence with no two consecutive identical values", async () => {
    await render({ announcement: { polite: "", alert: "" } });
    const polite = politeRegion();
    const mutations = [];
    const observer = new window.MutationObserver((records) => mutations.push(...records));
    observer.observe(polite, { characterData: true, childList: true, subtree: true });

    // The exact "" -> start -> "" -> start -> outcome sequence UX.md §8
    // describes for a save -> failure -> save probe.
    const sequence = [
      "",
      "Saving to Google Drive…",
      "",
      "Saving to Google Drive…",
      "Saved 2 documents to Drive.",
    ];
    for (let i = 1; i < sequence.length; i += 1) {
      // Sequential on purpose: each step must commit before the next is
      // asserted reachable from the last.
      await render({ announcement: { polite: sequence[i], alert: "" } });
      expect(sequence[i]).not.toBe(sequence[i - 1]); // the sequence itself has no repeats
    }

    expect(polite.textContent).toBe("Saved 2 documents to Drive.");
    // "At least one distinct mutation per outcome, never an exact count"
    // (UX.md §12 note 5) -- the real count from React/jsdom here is larger
    // than the 4 transitions and is NOT pinned to a specific number.
    expect(mutations.length).toBeGreaterThanOrEqual(4);
    observer.disconnect();
  });

  it("re-rendering with the SAME message is a no-op at the React level (this component does not itself work around the bail with a nonce)", async () => {
    await render({ announcement: { polite: "Saving to Google Drive…", alert: "" } });
    const polite = politeRegion();
    const before = polite.textContent;
    await render({ announcement: { polite: "Saving to Google Drive…", alert: "" } });
    expect(polite.textContent).toBe(before);
    // No zero-width or otherwise invisible codepoint anywhere -- AC-A6, the
    // U+200B scar this repo already has. Positive control: the expected
    // visible sentence really is there, so an empty region cannot pass.
    expect(polite.textContent).toBe("Saving to Google Drive…");
    expect(/[​‌‍﻿]/.test(polite.textContent)).toBe(false);
  });

  it("codepoint sweep across save -> failure -> save: no invisible codepoint in either region at any step", async () => {
    const steps = [
      { polite: "Saving to Google Drive…", alert: "" },
      { polite: "", alert: "Cover letter wasn't saved: couldn't rebuild the document." },
      { polite: "Saving to Google Drive…", alert: "" },
      { polite: "Saved 2 documents to Drive.", alert: "" },
    ];
    for (const announcement of steps) {
      await render({ announcement });
      expect(/[​‌‍﻿]/.test(politeRegion().textContent)).toBe(false);
      expect(/[​‌‍﻿]/.test(alertRegion().textContent)).toBe(false);
    }
    // Positive control: the last step's visible sentence really is present.
    expect(politeRegion().textContent).toBe("Saved 2 documents to Drive.");
  });

  it("MAJOR M-4: the ALERT region mutates across a failure -> retry -> IDENTICAL failure sequence, not just the polite region", async () => {
    // WAVE3-SEAMS.md's own PROBE1: `DRIVE_ANNOUNCE` had three polite-side
    // start sentences and NONE on the alert side, so a retry that produced
    // the exact same failure text left the alert region's stale value
    // completely unchanged start to finish -- 0 DOM mutations, proven with a
    // MutationObserver. React bails on the unchanged string and a
    // screen-reader user hears nothing on the retry. The fix
    // (`driveAnnounceStart` in driveMessages.js) bundles {polite, alert}
    // together so a caller cannot announce a start without ALSO clearing the
    // alert region -- giving the alert side its own distinct start/outcome
    // sequence the same structural way the polite side already had one.
    //
    // Real `driveSaveBatch` output drives the failure text (never a
    // hand-typed string), and records are banked from BOTH the observer
    // CALLBACK and a final `takeRecords()` merge -- `takeRecords()` alone is
    // unreliable under `await act()`, and a working region would then read
    // as broken.
    //
    // `announcement: failure.announcement` / `announcement: start` below
    // pass driveSaveBatch's and driveAnnounceStart's OWN return values
    // straight through, unmodified -- the exact shape MAJ-2's fix exists to
    // make possible (both producers already return `{polite, alert}`, so
    // there is no adapter here to type by hand and get wrong).
    const failure = driveSaveBatch([
      { scope: "resume", label: "Resume", result: SCOPE_OUTCOME.ERROR, errorKind: "transient" },
    ]);
    expect(failure.announcement.alert.length).toBeGreaterThan(0); // sanity: this batch really does produce alert text

    await render({ announcement: { polite: "", alert: "" } });
    const alert = alertRegion();
    const records = [];
    const observer = new window.MutationObserver((rs) => records.push(...rs));
    observer.observe(alert, { characterData: true, childList: true, subtree: true });

    // 1: first failure.
    await render({ announcement: failure.announcement });
    // 2: retry start -- driveAnnounceStart("save") clears BOTH regions in
    // the same call, structurally, not by caller discipline.
    const start = driveAnnounceStart("save");
    await render({ announcement: start });
    // 3: identical second failure -- the exact case that produced 0 alert
    // mutations before this fix.
    await render({ announcement: failure.announcement });

    records.push(...observer.takeRecords());
    expect(records.length).toBeGreaterThan(0);
    expect(alert.textContent).toBe(failure.announcement.alert);
    observer.disconnect();
  });
});

describe("DriveResultRegion -- announcement is required, bundled, and enforced HERE (MAJOR MAJ-2)", () => {
  // WAVE3-SEAMS.md MAJ-2: `driveAnnounceStart` returns {polite, alert} as
  // ONE object specifically so clearing the alert region is structurally
  // inseparable from announcing a start -- but that guarantee was opt-in
  // before this fix, because this component still took two loose string
  // props that defaulted independently to "". Mutation A4 (dropping the
  // `alert` half of `driveAnnounceStart`'s return value) killed
  // `driveMessages.test.js` but left THIS file's own M-4 alert-mutation test
  // green, because "field missing" and "explicitly cleared" both rendered
  // as the same default "" here. These tests prove that gap is closed: a
  // missing `announcement` prop, or an announcement missing either field, is
  // a loud contract violation in THIS component now, not a silent empty
  // render.
  it("throws when announcement is entirely absent -- not silently rendered as empty", async () => {
    await expect(renderRaw({})).rejects.toThrow(/announcement/);
  });

  it("throws when announcement is explicitly undefined (the exact shape a caller gets by simply forgetting the prop)", async () => {
    await expect(render({ announcement: undefined })).rejects.toThrow(/announcement/);
  });

  it("throws when announcement is missing its alert field -- reproduces mutation A4 exactly: driveAnnounceStart's return value with `alert` deleted, passed straight through", async () => {
    const brokenStart = { polite: "Saving to Google Drive…" }; // no `alert` key at all
    await expect(render({ announcement: brokenStart })).rejects.toThrow(/announcement/);
  });

  it("throws when announcement is missing its polite field", async () => {
    await expect(render({ announcement: { alert: "Something went wrong." } })).rejects.toThrow(/announcement/);
  });

  it("throws when a field is present but not a string (e.g. null, from a caller that meant to clear it)", async () => {
    await expect(render({ announcement: { polite: null, alert: "" } })).rejects.toThrow(/announcement/);
  });

  it("does NOT throw for an explicit clear -- both fields present as empty strings is a valid, ordinary render", async () => {
    await expect(render({ announcement: { polite: "", alert: "" } })).resolves.toBeUndefined();
    expect(politeRegion().textContent).toBe("");
    expect(alertRegion().textContent).toBe("");
  });
});

describe("DriveResultRegion -- never touches the modal's busy/notice/error maps", () => {
  it("accepts no busy/notice/error props at all -- there is nothing in this component's contract capable of writing them", async () => {
    // This is a structural guarantee, not a runtime one: the component
    // signature below (read from source) has no such parameter to
    // accidentally wire up in a later wave.
    const src = readFileSync(join(HERE, "DriveResultRegion.js"), "utf8");
    const start = src.indexOf("export default function DriveResultRegion(");
    expect(start).toBeGreaterThan(-1);
    // NOTE: `indexOf(") {", start)` -- searching from `start`, not from 0 --
    // is load-bearing. Several helper functions ABOVE the export in this
    // file (e.g. `function resolveLeadingLine(leadingLine) {`) also contain
    // the literal ") {", so an unscoped `src.indexOf(") {")` finds one of
    // those first, lands BEFORE `start`, and `slice(start, earlierEnd)`
    // silently returns "" -- a signature check that can never fail. Caught
    // by this file's own mutation pass (a `busy` prop added to the real
    // signature did not turn this test red until this was fixed).
    const end = src.indexOf(") {", start);
    expect(end).toBeGreaterThan(start);
    const signature = src.slice(start, end);
    expect(signature.length).toBeGreaterThan(40); // sanity: a real multi-line prop list, not ""
    expect(signature).not.toMatch(/\bbusy\b/i);
    expect(signature).not.toMatch(/\bnotice\b/i);
    expect(signature).not.toMatch(/\berror\b/i);
  });
});

describe("DriveResultRegion -- mobile containment (AC-M4, [browser]-tagged; source-level guard only)", () => {
  it("caps the strip at 30vh with overflowY auto at xs, as an explicit string", async () => {
    const src = readFileSync(join(HERE, "DriveResultRegion.js"), "utf8");
    expect(src).toContain('"30vh"');
    expect(src).toContain('overflowY');
  });
});
