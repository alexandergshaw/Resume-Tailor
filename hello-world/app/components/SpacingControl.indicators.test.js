// @vitest-environment jsdom
//
// N96 (SPACING INDICATORS) — REACHABILITY: every indicator is observed on the
// REAL mounted DocumentPreviewDialog, driving the REAL SpacingControl the way a
// candidate does (the control mounts at DocumentPreviewDialog.js:748 for both
// DOCX scope tabs). A direct render of SpacingControl, or a direct setter call,
// would not prove the indicator is reachable where the candidate meets it, and
// would not let us assert the B-1 [role="status"] document-order invariant that
// only exists in the full dialog. jsdom does NO layout (N74), so nothing here
// reads geometry — only declared attributes and textContent. The rendered
// VISUAL spacing (lines look more spaced) is AC-8, owner-judged in a real
// browser, and is deliberately NOT asserted here.
//
// RED-on-HEAD: SpacingControl today (app/components/SpacingControl.js) exposes
// ONLY the MUI variant=contained highlight (:52,:68). There is no readout
// (data-testid="spacing-current"), no default/custom state word, no
// aria-pressed on presets, no reset control (data-testid="spacing-reset"), and
// no whole-document caption (data-testid="spacing-scope-note"). Every query for
// those below resolves to null, so each assertion is red by absence.
//
// THE INDICATOR CONTRACT these tests define for the implementer (the tests ARE
// the interface — production edits live ONLY in SpacingControl.js):
//   * data-testid="spacing-current": a single readout region, aria-live="polite"
//     aria-atomic="true", and — CRITICALLY (B-1) — WITHOUT role="status". Its
//     textContent conveys BOTH axes' active values (e.g. "1.5x", "12pt") and a
//     DEFAULT vs CUSTOM state word. For an unset axis it names the document's own
//     spacing, NEVER a fabricated number.
//   * Each preset [data-testid="spacing-line-<m>"] / [data-testid="spacing-para-<pt>"]
//     carries aria-pressed, true on the active preset (same predicate as the
//     variant highlight) and explicitly false on inactive peers.
//   * data-testid="spacing-reset": a reset control, present+enabled only when a
//     custom spacing is applied, that calls onSetSpacing(scope, null) — literal
//     null, never {1,0} and never {null,null}.
//   * data-testid="spacing-scope-note": text conveying whole-document scope.
//
// The predicate that ties Default/Custom (and the reset's presence) to reality:
//   isApplied(spacing) === spacing != null &&
//       (spacing.lineSpacing != null || spacing.paragraphSpacingPt != null)
// This MUST equal applySpacingToHtml's own non-no-op condition
// (lib/document/docxPreview.js:356,358) — so the indicator never claims Custom
// while the transform applies nothing, nor Default while it applies something.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import DocumentPreviewDialog from "./DocumentPreviewDialog.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// A <p> and a <li> with source-default margins, so a reset back to null is a
// visible non-change (the source style is restored) and an applied override is
// a visible change.
const PREVIEW_HTML =
  `<p data-preview="body" style="text-align:left;margin:0pt 0 0pt;white-space:pre-wrap;">SPACING BODY LINE</p>` +
  `<ul style="margin:0;padding-left:40px;"><li data-preview="bullet" style="margin:0;white-space:pre-wrap;">SPACING BULLET</li></ul>`;

function driveProps(overrides = {}) {
  return {
    status: "connected",
    scopeCount: 2,
    connected: true,
    hasDriveReference: false,
    isStale: false,
    downloadStatus: "idle",
    onRefocusConsent: vi.fn(),
    onDownload: vi.fn(),
    leadingLine: null,
    rows: [],
    showConversionCaption: false,
    stale: false,
    reconnectCaption: false,
    hiringEmail: null,
    prompt: null,
    announcement: { polite: "", alert: "" },
    saveToDrive: vi.fn(),
    ...overrides,
  };
}

function scopesFor({ resumeAvailable = true } = {}) {
  return {
    resume: { available: resumeAvailable, text: "SPACING BODY LINE\nSPACING BULLET", html: PREVIEW_HTML, fileName: "Resume File" },
    cover: { available: true, text: "Dear Hiring Manager,", html: PREVIEW_HTML, fileName: "Cover File" },
    email: { available: false, text: "" },
  };
}

function baseProps(overrides = {}) {
  return {
    open: true,
    jobTitle: "Staff Engineer",
    company: "Acme",
    initialTab: "resume",
    scopes: scopesFor(),
    engine: "embedded",
    loadModel: vi.fn(async () => ({ paragraphs: [] })),
    onSave: vi.fn(),
    onRenameFile: vi.fn(),
    onDownload: vi.fn(),
    onClose: vi.fn(),
    busy: {},
    notice: {},
    error: {},
    drive: driveProps(),
    onActiveScopeChange: vi.fn(),
    spacing: null,
    onSetSpacing: vi.fn(),
    ...overrides,
  };
}

// Wires onSetSpacing back into the `spacing` prop, exactly as page.js owns
// tailoringMap[jobId].spacing and feeds it down. Lets us drive a real click and
// observe the derived readout/aria re-render, and prove the reset's null flows
// back through the same prop the presets use.
function SpacingHost({ onSetSpacingSpy, initialSpacing = null, ...rest }) {
  const [spacing, setSpacing] = useState(initialSpacing);
  const onSetSpacing = useCallback(
    (scope, value) => {
      onSetSpacingSpy?.(scope, value);
      setSpacing(value);
    },
    [onSetSpacingSpy],
  );
  return createElement(DocumentPreviewDialog, { ...rest, spacing, onSetSpacing });
}

let container;
let root;

beforeEach(() => {
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

async function render(Component, props) {
  await act(async () => {
    root.render(createElement(Component, props));
  });
  expect(document.querySelectorAll(".MuiDialogActions-root")).toHaveLength(1);
}

// MUI Dialog portals to document.body, so query the whole document.
const q = (sel) => document.querySelector(sel);
const readout = () => q('[data-testid="spacing-current"]');
const previewEl = (attr) =>
  [...document.querySelectorAll(`[data-preview="${attr}"]`)].find((n) => n.textContent.includes("SPACING"));
async function click(el) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}
function findByText(role, text) {
  return [...document.querySelectorAll(role)].find((n) => n.textContent.trim() === text);
}

// ---------------------------------------------------------------------------
// AC-1 / D-2 — the readout shows the CURRENT line multiplier AND paragraph pt,
// matching the applied spacing; null reads as source-default, never fabricated.
// ---------------------------------------------------------------------------
describe("AC-1 — explicit readout of the current spacing (RED on HEAD: no readout exists)", () => {
  it("renders both active values for a full custom, and two different customs read DIFFERENTLY (anti-constant discriminator)", async () => {
    // Rows that can fail: 3 (region exists; contains both numbers; two customs differ).
    await render(DocumentPreviewDialog, baseProps({ spacing: { lineSpacing: 1.5, paragraphSpacingPt: 12 } }));
    const region1 = readout();
    expect(region1, "no spacing readout region (data-testid=spacing-current)").toBeTruthy();
    const text1 = region1.textContent;
    expect(text1).toContain("1.5");
    expect(text1).toContain("12");

    await render(DocumentPreviewDialog, baseProps({ spacing: { lineSpacing: 2, paragraphSpacingPt: 6 } }));
    const text2 = readout().textContent;
    expect(text2).toContain("2");
    expect(text2).toContain("6");

    // DISCRIMINATOR: a readout that prints a constant label would make these
    // equal. They must differ, and neither may bleed the other's numbers.
    expect(text2).not.toBe(text1);
    expect(text2).not.toContain("1.5");
    expect(text1).not.toContain("6pt");
  });

  it("null reads as source-default and asserts NO fabricated 1x/0pt number (kills the null-as-{1,0} readout mutant)", async () => {
    await render(DocumentPreviewDialog, baseProps({ spacing: null }));
    const region = readout();
    expect(region, "no spacing readout region").toBeTruthy();
    const text = region.textContent;
    // Under-claim: name the document's own spacing, never assert values we do
    // not know and are not applying (AC §1 domain trap).
    expect(text).toMatch(/default/i);
    expect(text).toMatch(/your document|source/i);
    // The failure direction made concrete: null must NOT print "1x"/"1.0"/"0pt".
    expect(text).not.toMatch(/\b1(\.0)?x?\b/);
    expect(text).not.toMatch(/\b0\s*pt\b/);
  });

  it("a PARTIAL override names the set axis but does NOT fabricate the unset axis (no '0pt' for an unset paragraph)", async () => {
    await render(DocumentPreviewDialog, baseProps({ spacing: { lineSpacing: 1.5, paragraphSpacingPt: null } }));
    const text = readout().textContent;
    expect(text).toContain("1.5");
    // The unset paragraph axis must read as source-default, never "0pt".
    expect(text).not.toMatch(/\b0\s*pt\b/);
    expect(text).toMatch(/your document|source|default/i);
  });
});

// ---------------------------------------------------------------------------
// AC-3 / D-2 — DEFAULT vs CUSTOM, pinned to applySpacingToHtml's EXACT non-no-op
// condition. This is the load-bearing predicate (design D-2).
// ---------------------------------------------------------------------------
describe("AC-3 — Default vs Custom equals the transform's applied predicate (RED on HEAD: no state word)", () => {
  // isApplied(spacing) === spacing != null && (lineSpacing != null || paragraphSpacingPt != null)
  // Rows that can fail: 5 (one per spacing case below).
  const APPLIED = [
    { name: "full custom", spacing: { lineSpacing: 1.5, paragraphSpacingPt: 12 } },
    { name: "line-only override", spacing: { lineSpacing: 1.5, paragraphSpacingPt: null } },
    { name: "paragraph-only override", spacing: { lineSpacing: null, paragraphSpacingPt: 12 } },
  ];
  const DEFAULT = [
    { name: "null", spacing: null },
    // Degenerate all-null object: applySpacingToHtml treats this as a NO-OP
    // (docxPreview.js:358), so the indicator MUST read Default. A mutant using
    // `spacing != null` alone would wrongly show Custom here.
    { name: "all-null object", spacing: { lineSpacing: null, paragraphSpacingPt: null } },
  ];

  for (const c of APPLIED) {
    it(`${c.name} => CUSTOM (kills a &&-instead-of-|| predicate mutant)`, async () => {
      await render(DocumentPreviewDialog, baseProps({ spacing: c.spacing }));
      const text = readout().textContent;
      expect(text).toMatch(/custom/i);
      expect(text).not.toMatch(/\bdefault\b/i);
    });
  }

  for (const c of DEFAULT) {
    it(`${c.name} => DEFAULT (kills a spacing!=null-alone predicate mutant)`, async () => {
      await render(DocumentPreviewDialog, baseProps({ spacing: c.spacing }));
      const text = readout().textContent;
      expect(text).toMatch(/default/i);
      expect(text).not.toMatch(/custom/i);
    });
  }
});

// ---------------------------------------------------------------------------
// AC-2 / D-3 — the active value is PROGRAMMATICALLY DETERMINABLE (aria-pressed),
// with the SAME predicate as the visual variant, so drawn and announced cannot
// drift (N84 class). Announced through the polite live region on change.
// ---------------------------------------------------------------------------
describe("AC-2(i) — aria-pressed on presets, drawn≡announced (RED on HEAD: MUI variant sets no aria state)", () => {
  it("the active preset is aria-pressed=true AND visually contained; an inactive peer is aria-pressed=false AND outlined", async () => {
    await render(DocumentPreviewDialog, baseProps({ spacing: { lineSpacing: 1.5, paragraphSpacingPt: 12 } }));

    const activeLine = q('[data-testid="spacing-line-1.5"]');
    const inactiveLine = q('[data-testid="spacing-line-1"]');
    expect(activeLine, "no line presets").toBeTruthy();
    // Announced state.
    expect(activeLine.getAttribute("aria-pressed")).toBe("true");
    expect(inactiveLine.getAttribute("aria-pressed")).toBe("false"); // canary: a false peer must exist
    // Drawn state — MUST agree with the announced state (same predicate).
    expect(activeLine.className).toMatch(/MuiButton-contained/);
    expect(inactiveLine.className).toMatch(/MuiButton-outlined/);

    const activePara = q('[data-testid="spacing-para-12"]');
    const inactivePara = q('[data-testid="spacing-para-6"]');
    expect(activePara.getAttribute("aria-pressed")).toBe("true");
    expect(inactivePara.getAttribute("aria-pressed")).toBe("false");
    expect(activePara.className).toMatch(/MuiButton-contained/);
    expect(inactivePara.className).toMatch(/MuiButton-outlined/);
  });

  it("null => every preset aria-pressed=false (null is NOT '1x'; kills a mutant mapping null->1x active)", async () => {
    await render(DocumentPreviewDialog, baseProps({ spacing: null }));
    expect(q('[data-testid="spacing-line-1"]').getAttribute("aria-pressed")).toBe("false");
    expect(q('[data-testid="spacing-para-0"]').getAttribute("aria-pressed")).toBe("false");
  });
});

describe("AC-2(ii) — a change is announced through a polite live region (RED on HEAD: no live region)", () => {
  it("the readout region is a polite live region and its text updates in place when a preset is operated", async () => {
    await render(SpacingHost, { ...baseProps(), initialSpacing: null, onSetSpacingSpy: vi.fn() });
    const region = readout();
    expect(region, "no readout region").toBeTruthy();
    // A bare polite live region announces in-place text changes; aria-atomic
    // restores whole-region semantics without role="status" (B-1).
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.getAttribute("aria-atomic")).toBe("true");

    // Control: before the change the region is Default and carries no "12".
    expect(region.textContent).toMatch(/default/i);
    expect(region.textContent).not.toContain("12");

    const opt = q('[data-testid="spacing-para-12"]');
    expect(opt, "no paragraph preset to operate").toBeTruthy();
    await click(opt);

    // The SAME node updated in place (that is what a screen reader announces).
    const after = readout();
    expect(after).toBe(region);
    expect(after.textContent).toContain("12");
    expect(after.textContent).toMatch(/custom/i);
  });
});

// ---------------------------------------------------------------------------
// B-1 / D-4 (BLOCKER) — the spacing live region MUST NOT carry role="status".
// SpacingControl mounts EARLIER in document order than DriveResultRegion and
// CopyFeedbackStrip; a role="status" here would become the document-order-first
// [role="status"], silently hijacking the drive/copy suites' lookups.
// ---------------------------------------------------------------------------
describe("B-1 — spacing live region carries no role=status; the first [role=status] stays DriveResultRegion's", () => {
  it("the readout region uses aria-live=polite but NOT role=status (kills the role=status mutant)", async () => {
    await render(DocumentPreviewDialog, baseProps());
    const region = readout();
    expect(region, "no readout region").toBeTruthy();
    expect(region.getAttribute("role")).not.toBe("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
  });

  it("the readout is EARLIER in the DOM than the first [role=status], yet the first [role=status] is NOT the readout (invariant guard)", async () => {
    // This is the class guard: it protects the drive/copy DOM-order invariant
    // from a role="status" added anywhere in SpacingControl, not just today's
    // one region. What it cannot catch: a role="status" on a NEW element the
    // implementer might add that is placed AFTER DriveResultRegion — but the
    // whole point of B-1 is that SpacingControl mounts at :748, before it.
    await render(DocumentPreviewDialog, baseProps());
    const region = readout();
    const firstStatus = document.querySelector('[role="status"]');
    expect(region, "no readout region").toBeTruthy();
    expect(firstStatus, "DriveResultRegion's [role=status] should exist").toBeTruthy();

    // The readout precedes the first [role=status] in document order: so IF the
    // readout carried role="status", it WOULD win the querySelector — proving
    // the danger is real and that this guard would then bite.
    const pos = region.compareDocumentPosition(firstStatus);
    expect(Boolean(pos & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);

    // ...and yet the first [role=status] is DriveResultRegion's, not the
    // readout, and carries no copy-status marker. Adding role="status" to the
    // readout makes firstStatus === region and reds this assertion.
    expect(firstStatus).not.toBe(region);
    expect(firstStatus.hasAttribute("data-copy-status")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-4 / D-5 — a reachable reset writes literal null (NOT {1,0}, NOT {null,null}).
// ---------------------------------------------------------------------------
describe("AC-4 — reachable reset writes onSetSpacing(scope, null) (RED on HEAD: no reset control)", () => {
  it("operating the reset calls onSetSpacing with literal null and returns the preview <p> to its source style", async () => {
    const spy = vi.fn();
    await render(SpacingHost, {
      ...baseProps(),
      initialSpacing: { lineSpacing: 1.5, paragraphSpacingPt: 12 },
      onSetSpacingSpy: spy,
    });
    // Custom is applied first: the <p> carries the forced 12pt margin.
    expect(previewEl("body").getAttribute("style")).toMatch(/12pt/);

    const reset = q('[data-testid="spacing-reset"]');
    expect(reset, "no reset control while a custom spacing is applied").toBeTruthy();
    expect(reset.hasAttribute("disabled")).toBe(false);
    await click(reset);

    // LITERAL null — not {1,0} (N82 one-way door), not {null,null} (setPartial).
    expect(spy).toHaveBeenCalledWith("resume", null);
    const arg = spy.mock.calls[spy.mock.calls.length - 1][1];
    expect(arg).toBeNull();

    // Source fidelity restored: displayHtml falls back to baseHtml, so the <p>
    // returns to its source margin and carries no forced line-height:1.
    const style = previewEl("body").getAttribute("style");
    expect(style).toMatch(/margin:0pt 0 0pt/);
    expect(style).not.toMatch(/12pt/);
    expect(style).not.toMatch(/line-height:\s*1(\D|$)/);
  });

  it("CANARY: the reset is absent or disabled when spacing===null already (nothing to reset)", async () => {
    // The control that separates an over-firing build (reset always live) from
    // a correct one.
    await render(DocumentPreviewDialog, baseProps({ spacing: null }));
    const reset = q('[data-testid="spacing-reset"]');
    const inertOrAbsent =
      !reset || reset.hasAttribute("disabled") || reset.getAttribute("aria-disabled") === "true";
    expect(inertOrAbsent, "reset must not be live when there is nothing to reset").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-5 / D-6 — whole-document scope, and one value governs both documents.
// ---------------------------------------------------------------------------
describe("AC-5 — whole-document framing and shared value across tabs (RED on HEAD: bare labels)", () => {
  it("(a) a caption conveys whole-document scope", async () => {
    await render(DocumentPreviewDialog, baseProps());
    const note = q('[data-testid="spacing-scope-note"]');
    expect(note, "no whole-document scope caption").toBeTruthy();
    expect(note.textContent).toMatch(/whole/i);
    expect(note.textContent).toMatch(/document/i);
  });

  it("(b) INVARIANT: a value set on the résumé tab shows the SAME on the cover tab (one shared entry.spacing)", async () => {
    await render(SpacingHost, { ...baseProps(), initialSpacing: null, initialTab: "resume", onSetSpacingSpy: vi.fn() });
    await click(q('[data-testid="spacing-para-12"]'));
    expect(readout().textContent).toContain("12");

    // Switch to the cover-letter tab the way the candidate does.
    const coverTab = findByText('[role="tab"]', "Cover letter");
    expect(coverTab, "no cover-letter tab").toBeTruthy();
    await click(coverTab);

    // Same shared value is reflected on the cover tab — never a divergent
    // per-tab spacing.
    expect(readout().textContent).toContain("12");
    expect(readout().textContent).toMatch(/custom/i);
  });
});

// ---------------------------------------------------------------------------
// AC-6 / D-7 — synchronous update, no fabricated pending spinner.
// ---------------------------------------------------------------------------
describe("AC-6 — the readout updates synchronously with the preview; no spinner (RED on HEAD by absence)", () => {
  it("operating a preset updates the readout AND the preview <p> in the same act, with no progressbar in the control", async () => {
    await render(SpacingHost, { ...baseProps(), initialSpacing: null, onSetSpacingSpy: vi.fn() });
    await click(q('[data-testid="spacing-para-12"]'));

    // No extra await: both reflect the change within the single interaction.
    expect(readout().textContent).toContain("12");
    expect(previewEl("body").getAttribute("style")).toMatch(/12pt/);

    // Negative: the synchronous transform warrants no pending indicator.
    const control = q('[data-testid="spacing-control"]');
    expect(control.querySelector('[role="progressbar"]')).toBeNull();
    expect(control.querySelector('[data-testid="spacing-pending"]')).toBeNull();
    expect(control.querySelector('[aria-busy="true"]')).toBeNull();
  });
});
