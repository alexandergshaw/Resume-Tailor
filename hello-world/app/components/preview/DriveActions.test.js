// @vitest-environment jsdom
//
// DriveActions is presentational: state comes from props, every activation
// dispatches straight to a callback with no network call of its own
// (ARCH.md §11 -- `useDriveDocuments`, not built in this wave, owns the
// state machine). So these tests render real markup and assert on it --
// the JobDescriptionTab.test.js idiom (createRoot + act, no
// @testing-library/react in this repo) -- rather than mocking anything.
//
// jsdom traps this suite deliberately works around (UX.md §12/§7):
//   - jsdom does not move focus on a synthetic MouseEvent. This component
//     does no focus management of its own (the popup-return restore is the
//     future dialog wave's job), so no test here claims a focus outcome.
//   - `container.textContent` does not see a portal. This component
//     renders no MUI Popper/Tooltip/Dialog (deliberately -- UX.md §2.2), so
//     there is no portal to miss; still, `document.body.textContent`
//     is used as a tripwire instead of a container query in one place.
//   - No `vi.mock` factories are used, so `mockReset` vs
//     `vi.restoreAllMocks()` is not in play here -- plain `vi.fn()`s are
//     created fresh in each test's own props.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import DriveActions from "./DriveActions.js";
import {
  DRIVE_CONVERSION_CAPTION,
  DRIVE_STALE_CAPTION,
  DRIVE_RECONNECT_TO_DOWNLOAD_CAPTION,
  hiringEmailDriveNote,
  DRIVE_DOWNLOAD_LABEL,
} from "@/lib/drive/driveMessages";

const HERE = dirname(fileURLToPath(import.meta.url));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

async function render(props) {
  await act(async () => {
    root.render(createElement(DriveActions, props));
  });
}

function buttons() {
  return [...container.querySelectorAll("button")];
}

function buttonNamed(pattern) {
  return buttons().find((b) => pattern.test(accessibleName(b)));
}

// AC-A1's model: aria-labelledby -> aria-label -> textContent (with
// aria-hidden/[hidden]/display:none stripped) -> title.
function accessibleName(el) {
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const target = container.querySelector(`#${CSS.escape(labelledBy)}`) || document.body.querySelector(`#${CSS.escape(labelledBy)}`);
    if (target) return visibleText(target);
  }
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel;
  const text = visibleText(el);
  if (text) return text;
  return el.getAttribute("title") || "";
}

function visibleText(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll('[aria-hidden="true"], [hidden]').forEach((n) => n.remove());
  return clone.textContent.trim();
}

async function click(el) {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function baseProps(overrides) {
  return {
    status: "connected",
    scopeCount: 2,
    connected: false,
    hasDriveReference: false,
    isStale: false,
    downloadStatus: "idle",
    onSave: () => {},
    onRefocusConsent: () => {},
    onDownload: () => {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Absence states -- each paired with a positive control (task instruction:
// "renders nothing" is meaningless without a configured case proving the
// component CAN render).
// ---------------------------------------------------------------------------

describe("DriveActions -- absence states (AC-C21/AC-R8, §6.2)", () => {
  it("renders nothing when unconfigured", async () => {
    await render(baseProps({ status: "unconfigured" }));
    expect(container.innerHTML).toBe("");
  });

  it("positive control: renders when connected and configured", async () => {
    await render(baseProps({ status: "connected" }));
    expect(container.innerHTML).not.toBe("");
    expect(buttonNamed(/save 2 to drive/i)).toBeDefined();
  });

  it("renders nothing while the status call is pending (no skeleton, no flash)", async () => {
    await render(baseProps({ status: "checking" }));
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when no DOCX_SCOPES scope is available (AC-S25/AC-S29)", async () => {
    await render(baseProps({ status: "connected", scopeCount: 0 }));
    expect(buttonNamed(/to drive/i)).toBeUndefined();
  });

  it("positive control: with a résumé present (scopeCount 1) the save control renders", async () => {
    await render(baseProps({ status: "connected", scopeCount: 1 }));
    expect(buttonNamed(/^save to drive$/i)).toBeDefined();
  });

  it("status === 'noScopes' hides the save control even if scopeCount is inconsistent", async () => {
    await render(baseProps({ status: "noScopes", scopeCount: 2 }));
    expect(buttonNamed(/to drive/i)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AC-S2 -- the save control's label, one state at a time.
// ---------------------------------------------------------------------------

describe("DriveActions -- save control label (AC-S2, driveMessages.js verbatim)", () => {
  it("statusFailed degrades to the disconnected label, not to absence (B-5/AC-C26)", async () => {
    await render(baseProps({ status: "statusFailed" }));
    expect(buttonNamed(/^connect drive & save$/i)).toBeDefined();
  });

  it("connected + 2 scopes reads 'Save 2 to Drive'", async () => {
    await render(baseProps({ status: "connected", scopeCount: 2 }));
    expect(buttonNamed(/^save 2 to drive$/i)).toBeDefined();
  });

  it("connected + 1 scope reads 'Save to Drive', never 'Save 1 to Drive'", async () => {
    await render(baseProps({ status: "connected", scopeCount: 1 }));
    expect(buttonNamed(/^save to drive$/i)).toBeDefined();
    expect(buttonNamed(/save 1 to drive/i)).toBeUndefined();
  });

  it("disconnected reads 'Connect Drive & save'", async () => {
    await render(baseProps({ status: "disconnected" }));
    expect(buttonNamed(/^connect drive & save$/i)).toBeDefined();
  });

  it("tokenRejected reads 'Reconnect Drive & save'", async () => {
    await render(baseProps({ status: "tokenRejected" }));
    expect(buttonNamed(/^reconnect drive & save$/i)).toBeDefined();
  });

  it("consentPending reads 'Waiting for Google…'", async () => {
    await render(baseProps({ status: "consentPending" }));
    expect(buttonNamed(/^waiting for google…$/i)).toBeDefined();
  });

  it("saving reads 'Saving…'", async () => {
    await render(baseProps({ status: "saving" }));
    expect(buttonNamed(/^saving…$/i)).toBeDefined();
  });

  it("promptPending reads the same 'Saving…' label as saving (§5.8)", async () => {
    await render(baseProps({ status: "promptPending" }));
    expect(buttonNamed(/^saving…$/i)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Click behaviour -- one activation per journey (AC-K1/AC-K2), the
// consent-window re-focus trap (B-1/AC-C14), and the in-flight no-op
// (§5.8).
// ---------------------------------------------------------------------------

describe("DriveActions -- click dispatch", () => {
  it("cold start: one click on 'Connect Drive & save' calls onSave exactly once (AC-K1)", async () => {
    let saveCalls = 0;
    await render(baseProps({ status: "disconnected", onSave: () => { saveCalls += 1; } }));
    await click(buttonNamed(/^connect drive & save$/i));
    expect(saveCalls).toBe(1);
  });

  it("warm save: one click on 'Save 2 to Drive' calls onSave exactly once (AC-K2)", async () => {
    let saveCalls = 0;
    await render(baseProps({ status: "connected", scopeCount: 2, onSave: () => { saveCalls += 1; } }));
    await click(buttonNamed(/^save 2 to drive$/i));
    expect(saveCalls).toBe(1);
  });

  it("reconnect: clicking 'Reconnect Drive & save' calls onSave, not a separate handler", async () => {
    let saveCalls = 0;
    await render(baseProps({ status: "tokenRejected", onSave: () => { saveCalls += 1; } }));
    await click(buttonNamed(/^reconnect drive & save$/i));
    expect(saveCalls).toBe(1);
  });

  it("a click while awaiting consent RE-FOCUSES the window (onRefocusConsent), and never calls onSave again", async () => {
    let saveCalls = 0;
    let refocusCalls = 0;
    await render(
      baseProps({
        status: "consentPending",
        onSave: () => { saveCalls += 1; },
        onRefocusConsent: () => { refocusCalls += 1; },
      }),
    );
    await click(buttonNamed(/waiting for google/i));
    expect(refocusCalls).toBe(1);
    // The trap this test exists to catch: a naive implementation that
    // routes the consent-pending click back through onSave would open a
    // SECOND consent window rather than re-focusing the first one.
    expect(saveCalls).toBe(0);
  });

  it("the consent-pending control is never disabled -- a second click keeps working (B-1)", async () => {
    let refocusCalls = 0;
    await render(baseProps({ status: "consentPending", onRefocusConsent: () => { refocusCalls += 1; } }));
    const btn = buttonNamed(/waiting for google/i);
    expect(btn.disabled).toBe(false);
    await click(btn);
    await click(btn);
    expect(refocusCalls).toBe(2);
  });

  it("clicking while saving is a no-op: onSave is not called (§5.8)", async () => {
    let saveCalls = 0;
    await render(baseProps({ status: "saving", onSave: () => { saveCalls += 1; } }));
    await click(buttonNamed(/saving/i));
    expect(saveCalls).toBe(0);
  });

  it("clicking while a conflict prompt is pending is also a no-op", async () => {
    let saveCalls = 0;
    await render(baseProps({ status: "promptPending", onSave: () => { saveCalls += 1; } }));
    await click(buttonNamed(/saving/i));
    expect(saveCalls).toBe(0);
  });

  it("download: one click downloads every referenced scope (AC-K3/AC-D2)", async () => {
    let downloadCalls = 0;
    await render(
      baseProps({
        status: "connected",
        connected: true,
        hasDriveReference: true,
        onDownload: () => { downloadCalls += 1; },
      }),
    );
    await click(buttonNamed(/^download from drive$/i));
    expect(downloadCalls).toBe(1);
  });

  it("clicking the download control while exporting is a no-op", async () => {
    let downloadCalls = 0;
    await render(
      baseProps({
        status: "connected",
        connected: true,
        hasDriveReference: true,
        downloadStatus: "exporting",
        onDownload: () => { downloadCalls += 1; },
      }),
    );
    await click(buttonNamed(/downloading/i));
    expect(downloadCalls).toBe(0);
  });

  it("clicking the download control while blocked by a pending save prompt is a no-op", async () => {
    let downloadCalls = 0;
    await render(
      baseProps({
        status: "promptPending",
        connected: true,
        hasDriveReference: true,
        onDownload: () => { downloadCalls += 1; },
      }),
    );
    await click(buttonNamed(/^download from drive$/i));
    expect(downloadCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Download control gating (AC-D1 amended, B-6).
// ---------------------------------------------------------------------------

describe("DriveActions -- download control gating (AC-D1, B-6)", () => {
  it("absent for a posting never saved (no stored reference)", async () => {
    await render(baseProps({ status: "connected", connected: true, hasDriveReference: false }));
    expect(buttonNamed(/download/i)).toBeUndefined();
    expect(document.body.textContent).not.toContain(DRIVE_RECONNECT_TO_DOWNLOAD_CAPTION);
  });

  it("positive control: present with a stored reference and a live connection", async () => {
    await render(baseProps({ status: "connected", connected: true, hasDriveReference: true }));
    expect(buttonNamed(/^download from drive$/i)).toBeDefined();
  });

  // WAVE3-SEAMS.md BLOCKER B2: this component used to render the reconnect
  // caption itself when disconnected but the posting has Docs. Ruling:
  // `DriveResultRegion` is now the SOLE owner of every caption (see this
  // component's own header), so this component renders NOTHING for the
  // download path in this state -- no button (would 401) and no caption.
  it("disconnected but the posting has Docs: no download button, and NO caption of its own (DriveResultRegion owns that caption now, B-6/B2)", async () => {
    await render(baseProps({ status: "disconnected", connected: false, hasDriveReference: true }));
    expect(buttonNamed(/download/i)).toBeUndefined();
    expect(container.textContent).not.toContain(DRIVE_RECONNECT_TO_DOWNLOAD_CAPTION);
  });

  it("stale copy: the label changes to DRIVE_DOWNLOAD_LABEL.downloadStale, but the control stays enabled and shows NO caption of its own (AC-P7/AC-G3, B2)", async () => {
    await render(baseProps({ status: "connected", connected: true, hasDriveReference: true, isStale: true }));
    const btn = buttonNamed(/^download older drive copy$/i);
    expect(btn).toBeDefined();
    expect(btn.textContent.trim()).toBe(DRIVE_DOWNLOAD_LABEL.downloadStale);
    expect(btn.disabled).toBe(false);
    expect(btn.hasAttribute("aria-disabled")).toBe(false);
    // The staleness CAPTION (as opposed to the label swap above) is
    // DriveResultRegion's job now -- this component renders none of it.
    expect(container.textContent).not.toContain(DRIVE_STALE_CAPTION);
  });

  it("this component renders NO conversion caption -- that's DriveResultRegion's job now (AC-D7 moved to B2's ruling)", async () => {
    await render(baseProps({ status: "connected", connected: true, hasDriveReference: true }));
    expect(container.textContent).not.toContain(DRIVE_CONVERSION_CAPTION);
    // Positive control: the download button itself is still there --
    // proves this isn't "the component renders nothing at all".
    expect(buttonNamed(/^download from drive$/i)).toBeDefined();
  });

  it("exporting swaps the label to 'Downloading…' and sets aria-busy + aria-disabled (AC-D8)", async () => {
    await render(
      baseProps({ status: "connected", connected: true, hasDriveReference: true, downloadStatus: "exporting" }),
    );
    const btn = buttonNamed(/^downloading…$/i);
    expect(btn).toBeDefined();
    expect(btn.getAttribute("aria-busy")).toBe("true");
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(btn.disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-G3 -- no native `disabled` attribute anywhere this feature renders,
// swept across the enumerated states, with the busy/disabled aria pattern
// asserted per state so a no-op implementation can't pass by accident.
// ---------------------------------------------------------------------------

describe("DriveActions -- AC-G3 sweep: no disabled attribute in any state", () => {
  const states = [
    { name: "idle-connected", props: { status: "connected", connected: true, hasDriveReference: true } },
    { name: "idle-disconnected", props: { status: "disconnected", connected: false, hasDriveReference: false } },
    { name: "awaiting-consent", props: { status: "consentPending", connected: false, hasDriveReference: false } },
    { name: "save-in-flight", props: { status: "saving", connected: true, hasDriveReference: true } },
    { name: "prompt-pending", props: { status: "promptPending", connected: true, hasDriveReference: true } },
    // This component owns no separate "failed" visual: a failed batch is
    // reported by the sibling result region (ARCH.md §11's state-ownership
    // table -- "result rows + summary" is `DriveResultRegion`'s, not
    // DriveActions'), so the save control simply returns to idle.
    { name: "save-failed", props: { status: "connected", connected: true, hasDriveReference: true } },
    {
      name: "export-in-flight",
      props: { status: "connected", connected: true, hasDriveReference: true, downloadStatus: "exporting" },
    },
    {
      name: "stale-copy",
      props: { status: "connected", connected: true, hasDriveReference: true, isStale: true },
    },
  ];

  it.each(states)("$name: no button carries the disabled attribute", async ({ props }) => {
    await render(baseProps(props));
    for (const btn of buttons()) {
      expect(btn.disabled).toBe(false);
      expect(btn.hasAttribute("disabled")).toBe(false);
    }
  });

  // Positive control for the sweep above: a deliberate native-disabled
  // write WOULD be caught by it, proving the assertion isn't vacuous.
  it("positive control: a genuinely disabled button fails the same assertion the sweep relies on", async () => {
    await act(async () => {
      root.render(createElement("button", { disabled: true }, "control"));
    });
    const btn = container.querySelector("button");
    expect(btn.disabled).toBe(true);
    expect(btn.hasAttribute("disabled")).toBe(true);
  });

  it("save-in-flight carries aria-disabled AND aria-busy (AM-14)", async () => {
    await render(baseProps({ status: "saving", connected: true, hasDriveReference: true }));
    const btn = buttonNamed(/saving/i);
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(btn.getAttribute("aria-busy")).toBe("true");
  });

  it("awaiting-consent carries aria-busy but deliberately NOT aria-disabled (its click still works)", async () => {
    await render(baseProps({ status: "consentPending" }));
    const btn = buttonNamed(/waiting for google/i);
    expect(btn.getAttribute("aria-busy")).toBe("true");
    expect(btn.hasAttribute("aria-disabled")).toBe(false);
  });

  it("idle-connected carries neither aria-disabled nor aria-busy", async () => {
    await render(baseProps({ status: "connected", connected: true, hasDriveReference: true }));
    const saveBtn = buttonNamed(/save 2 to drive/i);
    expect(saveBtn.hasAttribute("aria-disabled")).toBe(false);
    expect(saveBtn.hasAttribute("aria-busy")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The download-blocked-by-pending-save reason: a visible sibling via
// aria-describedby, never folded into the label (task's accessibility
// section; the trap `mui-a11y-traps` records is a Tooltip stealing a name --
// this component uses neither).
// ---------------------------------------------------------------------------

describe("DriveActions -- aria-describedby for the download-blocked-by-save reason", () => {
  it("prompt-pending: the download control's aria-describedby resolves to VISIBLE text explaining why", async () => {
    await render(baseProps({ status: "promptPending", connected: true, hasDriveReference: true }));
    const downloadBtn = buttonNamed(/^download from drive$/i);
    expect(downloadBtn.getAttribute("aria-disabled")).toBe("true");
    const describedBy = downloadBtn.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const referenced = container.querySelector(`#${CSS.escape(describedBy)}`);
    expect(referenced).toBeDefined();
    expect(referenced.textContent.trim().length).toBeGreaterThan(0);
    // Never folded into the download button's OWN label.
    expect(downloadBtn.textContent).not.toContain(referenced.textContent.trim());
  });

  it("idle: the download control carries no aria-describedby at all", async () => {
    await render(baseProps({ status: "connected", connected: true, hasDriveReference: true }));
    const downloadBtn = buttonNamed(/^download from drive$/i);
    expect(downloadBtn.hasAttribute("aria-describedby")).toBe(false);
  });

  it("exporting: no aria-describedby either -- 'Downloading…' plus aria-busy is self-explanatory", async () => {
    await render(
      baseProps({ status: "connected", connected: true, hasDriveReference: true, downloadStatus: "exporting" }),
    );
    const downloadBtn = buttonNamed(/^downloading…$/i);
    expect(downloadBtn.hasAttribute("aria-describedby")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WCAG 2.5.3 -- visible text is a substring of the accessible name, for
// every rendered control in every state (AC-A2). No Tooltip is used
// anywhere in this component (UX.md §2.2), so accessible name === visible
// text/textContent by construction; this proves it rather than assuming it.
// ---------------------------------------------------------------------------

describe("DriveActions -- AC-A1/AC-A2: accessible name contains the visible text", () => {
  const cases = [
    { name: "save, disconnected", props: { status: "disconnected" } },
    { name: "save, connected 2 scopes", props: { status: "connected", scopeCount: 2 } },
    { name: "save, consentPending", props: { status: "consentPending" } },
    { name: "save, saving", props: { status: "saving" } },
    {
      name: "download, idle",
      props: { status: "connected", connected: true, hasDriveReference: true },
    },
    {
      name: "download, stale",
      props: { status: "connected", connected: true, hasDriveReference: true, isStale: true },
    },
    {
      name: "download, exporting",
      props: { status: "connected", connected: true, hasDriveReference: true, downloadStatus: "exporting" },
    },
  ];

  it.each(cases)("$name", async ({ props }) => {
    await render(baseProps(props));
    for (const btn of buttons()) {
      const visible = visibleText(btn);
      const name = accessibleName(btn);
      expect(name.length).toBeGreaterThan(0);
      expect(name).toContain(visible);
    }
  });
});

// ---------------------------------------------------------------------------
// Real <button>s, no wrapper, no Tooltip, no non-native Select (AC-A3/AC-A9/
// AC-A10). Enter and Space are native on a real <button> -- nothing to test
// beyond "it really is one".
// ---------------------------------------------------------------------------

describe("DriveActions -- structure (AC-A3/AC-A9/AC-A10, UX.md §2.2)", () => {
  it("both controls are real <button> elements with no <span> wrapper stealing the name", async () => {
    await render(baseProps({ status: "connected", connected: true, hasDriveReference: true }));
    for (const btn of buttons()) {
      expect(btn.tagName).toBe("BUTTON");
      expect(btn.parentElement.tagName).not.toBe("SPAN");
    }
  });

  it("renders no [role=combobox] (no MUI non-native Select introduced)", async () => {
    await render(baseProps({ status: "connected", connected: true, hasDriveReference: true, isStale: true }));
    expect(container.querySelectorAll('[role="combobox"]').length).toBe(0);
  });

  it("renders no MUI Tooltip popper markup anywhere", async () => {
    await render(baseProps({ status: "connected", connected: true, hasDriveReference: true }));
    expect(container.querySelectorAll(".MuiTooltip-popper, [role='tooltip']").length).toBe(0);
    expect(document.body.querySelectorAll(".MuiTooltip-popper, [role='tooltip']").length).toBe(0);
  });

  it("tripwire: nothing in this component portals outside the container (no Tooltip/Popper/Dialog used)", async () => {
    await render(baseProps({ status: "connected", connected: true, hasDriveReference: true, isStale: true }));
    expect(document.body.textContent).toBe(container.textContent);
  });
});

// ---------------------------------------------------------------------------
// Hiring-email note (UX.md §6.5, M-10, WAVE3-SEAMS.md BLOCKER B2): this used
// to be rendered by BOTH this component (gated on `activeScope === "email"`)
// and DriveResultRegion, so every hiring-email user saw it twice. Ruling:
// DriveResultRegion is the sole owner now (see this file's header comment);
// this component takes no `activeScope` prop at all any more and never
// renders this note in any state.
// ---------------------------------------------------------------------------

describe("DriveActions -- hiring-email note is NOT this component's job any more (B2)", () => {
  it("never renders the hiring-email note, in any scopeCount, even though DriveResultRegion's version of it would say the same words", async () => {
    await render(baseProps({ status: "connected", scopeCount: 2 }));
    expect(container.textContent).not.toContain(hiringEmailDriveNote(2));
    expect(container.textContent).not.toContain(hiringEmailDriveNote(1));
    expect(container.textContent).not.toContain("isn't a document");
    // Positive control: the save button itself still renders -- this isn't
    // "the component renders nothing at all".
    expect(buttonNamed(/save 2 to drive/i)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// WAVE3-SEAMS.md MAJOR M-1 (third recurrence of this defect class): the
// three download-control labels used to be re-derived inline in this file
// instead of imported from driveMessages.js. Source-level sweep, following
// `lib/drive/driveSourceSweep.test.js`'s comment-stripping discipline so a
// header comment mentioning these labels in prose can't defeat the check.
// ---------------------------------------------------------------------------

function stripComments(src) {
  const noBlockComments = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noBlockComments
    .split("\n")
    .map((line) => (line.trim().startsWith("//") ? "" : line))
    .join("\n");
}

describe("DriveActions -- download labels come from driveMessages.js, never retyped (MAJOR M-1)", () => {
  it("imports DRIVE_DOWNLOAD_LABEL from driveMessages.js and reads all three fields off it", () => {
    const src = stripComments(readFileSync(join(HERE, "DriveActions.js"), "utf8"));
    expect(src).toContain('from "@/lib/drive/driveMessages"');
    expect(src).toContain("DRIVE_DOWNLOAD_LABEL");
    expect(src).toMatch(/DRIVE_DOWNLOAD_LABEL\.download\b/);
    expect(src).toMatch(/DRIVE_DOWNLOAD_LABEL\.downloadStale\b/);
    expect(src).toMatch(/DRIVE_DOWNLOAD_LABEL\.downloading\b/);
  });

  it("no longer hardcodes the three download-control string literals", () => {
    const src = stripComments(readFileSync(join(HERE, "DriveActions.js"), "utf8"));
    expect(src).not.toContain('"Download from Drive"');
    expect(src).not.toContain('"Download older Drive copy"');
    expect(src).not.toContain('"Downloading…"');
  });

  it("the rendered labels are byte-identical to the live DRIVE_DOWNLOAD_LABEL export", async () => {
    await render(baseProps({ status: "connected", connected: true, hasDriveReference: true }));
    expect(buttonNamed(/^download from drive$/i).textContent.trim()).toBe(DRIVE_DOWNLOAD_LABEL.download);

    await render(baseProps({ status: "connected", connected: true, hasDriveReference: true, isStale: true }));
    expect(buttonNamed(/^download older drive copy$/i).textContent.trim()).toBe(
      DRIVE_DOWNLOAD_LABEL.downloadStale,
    );

    await render(
      baseProps({ status: "connected", connected: true, hasDriveReference: true, downloadStatus: "exporting" }),
    );
    expect(buttonNamed(/^downloading…$/i).textContent.trim()).toBe(DRIVE_DOWNLOAD_LABEL.downloading);
  });
});

// ---------------------------------------------------------------------------
// AC-G1-shaped liveness anchor for this file: with both callbacks replaced
// by no-ops, the click tests above still exercise real DOM state (label
// text, aria attributes) that a dead component (one that renders nothing,
// or a static shell) cannot produce -- the absence-state tests already
// double as this file's liveness gate, so this test only pins that a
// no-callback render still produces the expected label, catching an
// implementation that quietly stopped rendering when callbacks are missing.
// ---------------------------------------------------------------------------

describe("DriveActions -- renders correctly with no callbacks supplied", () => {
  it("does not throw and still shows the label when onSave/onDownload are omitted", async () => {
    await render({ status: "connected", scopeCount: 2, connected: true, hasDriveReference: true });
    expect(buttonNamed(/^save 2 to drive$/i)).toBeDefined();
    expect(buttonNamed(/^download from drive$/i)).toBeDefined();
  });
});
