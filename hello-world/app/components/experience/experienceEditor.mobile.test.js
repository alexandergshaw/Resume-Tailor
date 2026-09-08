// @vitest-environment jsdom
//
// SURFACE F, PART 3 -- THE EXPERIENCE TAB'S CONTENT PANELS AT 375px.
//
// Findings from the mobile audit (MOBILE-F) that live below the tree:
//
//   F-01  `AttachmentCard`'s row is a non-wrapping `Stack direction="row"`
//         holding a FIXED 96px thumbnail, a content column, and two
//         IconButtons. The fixed items spend ~204px of a ~237px card interior,
//         leaving the filename, the kind/size line, the notes field and three
//         error Alerts with Retry buttons about 33px. At 320px the fixed items
//         exceed the interior outright, and `html { overflow-x: hidden }`
//         deletes the excess rather than offering it.
//   F-05  Nothing here imports the shared touch contract, so every control is
//         at its MUI default -- `IconButton size="small"` ~30px, `Button
//         size="small"` ~31px, `Checkbox size="small" p:0.5` = 28px.
//   F-08  `ImportToLibraryDialog`'s slot picker is a REAL native `<select>` at
//         `fontSize: 13`, so it triggers iOS Safari's focus zoom.
//   F-09  `PageEditor`'s body is `multiline minRows={12}` with NO `maxRows`.
//         MUI's textarea auto-grows without bound, so a long project page
//         becomes one enormous textarea and everything under it (the
//         attachments panel, the knowledge panel) is pushed unreachably down.
//   F-12  `TechWatchItemCard`'s `affected` line and `TechWatchPanel`'s
//         failed-source line render externally-sourced strings -- version
//         ranges and URLs, both single unbroken tokens -- with no
//         `overflowWrap`.
//   F-15  Three fixed-height nested scrollers inside dialogs that are already
//         fullScreen on a phone: an inner scroller inside an outer one steals
//         the page-scroll gesture and hides its content from find-in-page.
//
// Every size assertion is a DECLARED-value read at an emulated width through
// `app/theme/computedStyleAtWidth.js`, never a laid-out box: jsdom has no
// layout engine and `getBoundingClientRect()` returns zeros here. See
// `experienceTree.mobile.test.js`'s header for the full statement of that
// limit.
//
// BROWSER-ONLY, not simulated by anything here:
//   MC-F7  `getBoundingClientRect().width` of AttachmentCard's content column
//          at 375 and 320. Predicted ~33px and <= 0 before the column layout.
//   MC-F8  paste 400 lines into the body field and read
//          `textarea.getBoundingClientRect().height`. Predicted > 6000px
//          before the cap. This file can only assert that a cap is DECLARED --
//          `45dvh` has no resolvable pixel value without a viewport.
//   MC-F9  render an `affected` value that is a 60-character unbroken token
//          and compare `el.scrollWidth` to `el.clientWidth`. Both are 0 in
//          jsdom, so the property, not the effect, is what is asserted below.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import Button from "@mui/material/Button";

vi.mock("../../hooks/useTechWatch", () => ({ useTechWatch: vi.fn() }));

import { useTechWatch } from "../../hooks/useTechWatch";
import AttachmentCard from "./AttachmentCard.js";
import PageEditor from "./PageEditor.js";
import TechWatchItemCard from "./TechWatchItemCard.js";
import TechWatchPanel from "./TechWatchPanel.js";
import ImportToLibraryDialog from "./ImportToLibraryDialog.js";
import BulkActionsBar from "./BulkActionsBar.js";
import { BTN_SX } from "./knowledgePanelStyles.js";
import { makeTheme } from "../../theme/index.js";
import { atWidth } from "../../theme/computedStyleAtWidth.js";
import { MOBILE_TAP_MIN } from "../../theme/mobileSx.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PHONE = 375;
const DESKTOP = 1000;

let container;
let root;
let phone = true;

beforeEach(() => {
  phone = true;
  window.matchMedia = vi.fn((query) => ({
    matches: /max-width/.test(String(query)) ? phone : false,
    media: String(query),
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  delete window.matchMedia;
  vi.restoreAllMocks();
});

async function render(element) {
  await act(async () => {
    root.render(createElement(ThemeProvider, { theme: makeTheme("light") }, element));
  });
}

const pxOf = (value) => {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};
const styleAt = (node, width, prop) => atWidth(width, () => window.getComputedStyle(node)[prop]);
const name = (node) =>
  node.getAttribute("aria-label") || (node.textContent || "").replace(/\s+/g, " ").trim() || node.tagName;

function undersized(nodes, width, min) {
  return nodes
    .filter((node) => pxOf(styleAt(node, width, "minHeight")) < min)
    .map((node) => `${name(node)} ${styleAt(node, width, "minHeight")}`);
}

// ============================================================================
// F-01 / F-05 -- the attachment card.
// ============================================================================

describe("F-01 -- the attachment card stacks instead of squeezing its content column", () => {
  const ATTACHMENT = {
    id: "a1",
    name: "demo-walkthrough.mp4",
    kind: "video",
    bytes: 4_100_000,
    notes: "",
    url: "blob:demo",
  };

  const cardProps = (overrides = {}) => ({
    attachment: ATTACHMENT,
    downloading: false,
    notesErrorText: "",
    deleteErrorText: "",
    downloadErrorText: "",
    onNotesInput: vi.fn(),
    onSaveNotes: vi.fn(),
    onRetryNotes: vi.fn(),
    onDownload: vi.fn(),
    onRetryDownload: vi.fn(),
    onDelete: vi.fn(),
    onRetryDelete: vi.fn(),
    ...overrides,
  });

  const outerStack = () => container.querySelector(".MuiCardContent-root > .MuiStack-root");
  const thumbBox = () => outerStack().firstElementChild;

  it("[control] renders the thumbnail box, the content column and both icon buttons", async () => {
    await render(createElement(AttachmentCard, cardProps()));
    expect(outerStack()).not.toBeNull();
    expect(container.querySelector('[aria-label^="Download"]')).not.toBeNull();
    expect(container.querySelector('[aria-label^="Delete"]')).not.toBeNull();
  });

  it("lays the card out as a column at 375 and keeps the shipped row above sm", async () => {
    await render(createElement(AttachmentCard, cardProps()));
    expect(styleAt(outerStack(), PHONE, "flexDirection")).toBe("column");
    expect(styleAt(outerStack(), DESKTOP, "flexDirection")).toBe("row");
  });

  it("gives the media the full card width on a phone instead of a 96px column", async () => {
    await render(createElement(AttachmentCard, cardProps()));
    // The audit proposed shrinking the thumbnail to 56px, which was the right
    // answer for a ROW: the 96px column was stealing width from the content
    // beside it. In a COLUMN nothing is beside it, and 56px would be actively
    // worse -- a `<video controls>` at 56px has no room for its own play
    // button, and uploading a demo video from a camera roll is the most
    // phone-first action on this whole surface (its notes field is the only
    // description the tailoring engine ever sees, since video bytes are never
    // forwarded). Full width is the fix the column layout makes available.
    expect(styleAt(thumbBox(), PHONE, "width")).toBe("100%");
    expect(styleAt(thumbBox(), DESKTOP, "width")).toBe("96px");
  });

  it("bounds the media's height so a tall portrait capture cannot take over the card", async () => {
    await render(createElement(AttachmentCard, cardProps()));
    const media = container.querySelector("video");
    expect(media, "the video preview did not render").not.toBeNull();
    // A phone camera shoots portrait. At full card width an unbounded 9:16
    // capture is ~550px tall, pushing the notes field -- the only thing the
    // engine actually reads -- off the bottom of the screen.
    expect(pxOf(styleAt(media, PHONE, "maxHeight"))).toBeGreaterThan(0);
    expect(styleAt(media, PHONE, "objectFit")).toBe("contain");
    expect(styleAt(media, DESKTOP, "maxHeight")).toBe("none");
  });

  it("floors the download and delete buttons and the notes field at 44px", async () => {
    await render(createElement(AttachmentCard, cardProps()));
    const targets = [
      container.querySelector('[aria-label^="Download"]'),
      container.querySelector('[aria-label^="Delete"]'),
      container.querySelector(".MuiInputBase-root"),
    ];
    expect(targets.every(Boolean)).toBe(true);
    expect(undersized(targets, PHONE, MOBILE_TAP_MIN)).toEqual([]);
  });

  it("floors the three error Alerts' Retry buttons too -- the recovery path is the one that must be tappable", async () => {
    await render(
      createElement(
        AttachmentCard,
        cardProps({
          notesErrorText: "Could not save your note.",
          deleteErrorText: "Could not delete.",
          downloadErrorText: "Could not download.",
        }),
      ),
    );
    const retries = [...container.querySelectorAll("button")].filter((b) => /^Retry$/.test(b.textContent.trim()));
    expect(retries).toHaveLength(3);
    expect(undersized(retries, PHONE, MOBILE_TAP_MIN)).toEqual([]);
  });
});

// ============================================================================
// F-09 -- the unbounded body textarea.
// ============================================================================

describe("F-09 -- the markdown body is bounded on a phone so what follows it stays reachable", () => {
  const editorProps = () => ({
    page: { id: "p1", title: "Payments migration", body: "line\n".repeat(50) },
    onChange: vi.fn(),
    onAskAi: vi.fn(),
  });

  const bodyTextarea = () =>
    [...container.querySelectorAll("textarea")].find((t) => !t.getAttribute("aria-hidden"));

  it("[control] renders the body field", async () => {
    await render(createElement(PageEditor, editorProps()));
    expect(bodyTextarea()).not.toBeNull();
  });

  it("declares a viewport-relative height cap at 375 and none above sm", async () => {
    await render(createElement(PageEditor, editorProps()));
    const area = bodyTextarea();

    // Keyed on a VIEWPORT unit, never on `rem`: a rem-based cap scales with
    // the very text it is capping, so it stops being a cap the moment the
    // user raises their font size. `dvh` also tracks iOS Safari's collapsing
    // URL bar, which `vh` does not.
    const capped = styleAt(area, PHONE, "maxHeight");
    expect(capped).toMatch(/dvh$/);
    expect(styleAt(area, DESKTOP, "maxHeight")).toBe("none");
  });

  it("keeps the capped field scrollable rather than clipping the text inside it", async () => {
    await render(createElement(PageEditor, editorProps()));
    // A max-height with `overflow: hidden` would DELETE the tail of a long
    // page. This is the one nested scroller on this surface that is correct:
    // it is the text-entry control itself, not a layout pane wrapping others.
    expect(styleAt(bodyTextarea(), PHONE, "overflowY")).toBe("auto");
  });
});

// ============================================================================
// F-12 -- externally-sourced unbroken tokens.
// ============================================================================

describe("F-12 -- model- and feed-sourced strings can break rather than being clipped away", () => {
  it("lets the affected-versions line break inside an unbroken token", async () => {
    await render(
      createElement(TechWatchItemCard, {
        item: {
          category: "vulnerability",
          severity: "critical",
          technology: "libfoo",
          title: "Heap overflow",
          occurredAt: "2026-01-05T00:00:00.000Z",
          timePrecision: "day",
          affected: ">=1.2.3-alpha.4+build.567,<2.0.0-rc.11+sha.abcdef0123456789",
          sources: [],
        },
      }),
    );
    const affected = [...container.querySelectorAll("p, span, div")].find((el) =>
      /^>=1\.2\.3-alpha/.test((el.textContent || "").trim()),
    );
    expect(affected, "the affected-versions line did not render").toBeDefined();
    // `overflowWrap: anywhere` at EVERY width, not just on phones: a single
    // unbroken token can overflow a narrow container at any breakpoint, and
    // `html { overflow-x: hidden }` clips rather than scrolls.
    expect(styleAt(affected, PHONE, "overflowWrap")).toBe("anywhere");
    expect(styleAt(affected, DESKTOP, "overflowWrap")).toBe("anywhere");
  });
});

// ============================================================================
// F-08 / F-15 -- the import-to-library dialog.
// ============================================================================

describe("F-08 / F-15 -- the add-to-library review dialog on a phone", () => {
  const FRAGMENTS = [
    { text: "Cut settlement from three days to one", sourcePageId: "p1", sourceTitle: "Payments migration" },
    { text: "Retired the legacy processor", sourcePageId: "p1", sourceTitle: "Payments migration" },
  ];

  const dialogProps = () => ({ open: true, onClose: vi.fn(), fragments: FRAGMENTS });

  // MUI portals a Dialog onto document.body, not under `container`.
  const slotSelect = () => document.querySelector('select[aria-label="Slot"]');
  const checkboxes = () => [...document.querySelectorAll(".MuiCheckbox-root")];
  const scroller = () => document.querySelector(".MuiDialogContent-root .MuiStack-root");

  it("[control] renders one row per fragment, each with a checkbox and a slot picker", async () => {
    await render(createElement(ImportToLibraryDialog, dialogProps()));
    expect(checkboxes()).toHaveLength(2);
    expect(slotSelect()).not.toBeNull();
  });

  it("raises the native slot picker to 16px on a phone so focusing it does not zoom the viewport", async () => {
    await render(createElement(ImportToLibraryDialog, dialogProps()));
    expect(styleAt(slotSelect(), PHONE, "fontSize")).toBe("16px");
    expect(styleAt(slotSelect(), DESKTOP, "fontSize")).toBe("13px");
  });

  it("floors the row checkboxes and the native select itself at 44px", async () => {
    await render(createElement(ImportToLibraryDialog, dialogProps()));
    expect(undersized([...checkboxes(), slotSelect()], PHONE, MOBILE_TAP_MIN)).toEqual([]);
  });

  it("drops its inner 420px scroller on a phone so the fullScreen dialog body is the only scroller", async () => {
    await render(createElement(ImportToLibraryDialog, dialogProps()));
    const list = scroller();
    expect(list, "the fragment list did not render").not.toBeNull();
    expect(styleAt(list, PHONE, "maxHeight")).toBe("none");
    expect(styleAt(list, PHONE, "overflow")).toBe("visible");
    // Above sm the bounded, internally-scrolling list is unchanged.
    expect(styleAt(list, DESKTOP, "maxHeight")).toBe("420px");
    expect(styleAt(list, DESKTOP, "overflow")).toBe("auto");
  });
});

// ============================================================================
// F-05 / F-07 / F-10 -- the bulk actions bar and its own move dialog.
// ============================================================================
//
// THE RULING ON F-07, which the audit proposed differently. The audit wanted
// four of the six actions folded behind an overflow `Menu` on phones. That is
// refused here: this project's standing UX directive is one action with good
// defaults over a nested menu, and an overflow menu adds a tap to four of the
// six. What made the six-button strip unusable was not the count, it was that
// F-02 put the whole bar ~1500px away from the checkbox that summons it. With
// the bar now rendered directly above the tree, a wrapping strip of 44px
// buttons is a legible ~3 rows -- and every action stays one tap away.
describe("F-05 / F-07 -- the bulk actions bar", () => {
  const PAGES = [
    { id: "p1", parent_id: null, title: "Payments migration", body: "- Cut settlement time", position: 0 },
    { id: "p2", parent_id: "p1", title: "Ledger rewrite", body: "- Rebuilt the ledger", position: 0 },
  ];

  const barProps = () => ({
    pages: PAGES,
    selectedIds: new Set(["p2"]),
    onDeleteSelected: vi.fn(),
    onMoveSelected: vi.fn(),
    onPagesChanged: vi.fn(),
  });

  const strip = () => container.querySelector('[role="region"][aria-label="Bulk actions"]');
  const actionButtons = () => [...strip().querySelectorAll("button")];

  it("[control] renders all six actions once something is selected", async () => {
    await render(createElement(BulkActionsBar, barProps()));
    const labels = actionButtons().map((b) => b.textContent.trim());
    for (const label of ["Delete selected", "Move selected", "Research report", "PowerPoint", "Add to library", "Template"]) {
      expect(labels, `no "${label}" action`).toContain(label);
    }
  });

  it("floors every action at 44px on a phone and leaves them at their desktop size above sm", async () => {
    await render(createElement(BulkActionsBar, barProps()));
    expect(undersized(actionButtons(), PHONE, MOBILE_TAP_MIN)).toEqual([]);
    for (const node of actionButtons()) {
      expect(styleAt(node, DESKTOP, "minHeight"), name(node)).toBe("auto");
    }
  });

  it("wraps the strip rather than clipping it -- html{overflow-x:hidden} deletes what does not fit", async () => {
    await render(createElement(BulkActionsBar, barProps()));
    const row = strip().querySelector(".MuiStack-root");
    expect(styleAt(row, PHONE, "flexWrap")).toBe("wrap");
  });

  it("takes its own move dialog fullScreen on a phone, with the same capped indent as the tree", async () => {
    await render(createElement(BulkActionsBar, barProps()));
    const move = actionButtons().find((b) => /Move selected/.test(b.textContent));
    await act(async () => {
      move.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(document.querySelector(".MuiDialog-paperFullScreen")).not.toBeNull();
    const rows = [...document.querySelectorAll(".MuiListItemButton-root")];
    expect(rows.length).toBeGreaterThan(0);
    for (const node of rows) {
      // MOVE_INDENT caps at 2 + 3 * 2 spacing units = 64px.
      expect(pxOf(styleAt(node, PHONE, "paddingLeft")), node.textContent).toBeLessThanOrEqual(64);
    }
    expect(undersized(rows, PHONE, MOBILE_TAP_MIN)).toEqual([]);
  });
});

// ============================================================================
// F-05 -- the tech watch panel and the knowledge panel's shared button style.
// ============================================================================

describe("F-05 -- TechWatchPanel's window selector", () => {
  const hookState = (overrides = {}) => ({
    lifecycleGaps: { rows: [], loading: false, error: "" },
    data: {
      generatedAt: "2026-08-17T15:29:00.000Z",
      windowHours: 24,
      items: [],
      lifecycle: [],
      watchlist: { entries: [], usedDefaults: false, truncated: false },
      sources: [
        {
          id: "osv",
          label: "OSV",
          ok: false,
          // A single unbroken token, which is what a real transport error
          // carries -- this is the string F-12 says gets clipped away.
          error: "https://api.osv.dev/v1/querybatch?ecosystem=npm&timeout=30000",
        },
      ],
    },
    loading: false,
    error: "",
    signedOut: false,
    lastLoadedAt: "2026-08-17T15:29:00.000Z",
    windowHours: 24,
    setWindowHours: vi.fn(),
    reload: vi.fn(),
    ...overrides,
  });

  async function renderExpanded() {
    useTechWatch.mockReturnValue(hookState());
    await render(createElement(TechWatchPanel, null));
    // The panel's disclosure defaults to EXPANDED (readStoredExpanded returns
    // true with no stored key), so the briefing body is already on screen.
    const toggle = [...container.querySelectorAll("button")].find((b) => /Tech watch/.test(b.textContent));
    expect(toggle, "no Tech watch disclosure").toBeDefined();
    expect(toggle.getAttribute("aria-expanded"), "the panel did not start expanded").toBe("true");
  }

  it("floors the window buttons and Refresh at 44px", async () => {
    await renderExpanded();
    const controls = [...container.querySelectorAll("button")].filter((b) =>
      /hours|days|Refresh/i.test(b.textContent),
    );
    expect(controls.length).toBeGreaterThan(2);
    expect(undersized(controls, PHONE, MOBILE_TAP_MIN)).toEqual([]);
  });

  it("lets a failed source's error -- which carries a URL -- break instead of being clipped", async () => {
    await renderExpanded();
    // Anchored at the start of the trimmed text, so this picks the Typography
    // itself and not the wrapper Box above it -- whose textContent also
    // contains the phrase, and which is NOT the element the rule belongs on.
    const line = [...container.querySelectorAll("p, span, div")].find((el) =>
      /^OSV: could not be reached/.test((el.textContent || "").trim()),
    );
    expect(line, "no failed-source line rendered").toBeDefined();
    expect(styleAt(line, PHONE, "overflowWrap")).toBe("anywhere");
  });
});

describe("F-05 -- the knowledge panel's shared BTN_SX covers all three of its consumers at once", () => {
  it("floors a button carrying BTN_SX at 375 and leaves it auto above sm", async () => {
    // KnowledgePanel, KnowledgeQuestionBox and KnowledgeHistory all style their
    // buttons through this one exported constant, so the floor belongs there
    // rather than being repeated at each call site.
    await render(createElement(Button, { variant: "outlined", sx: BTN_SX }, "Regenerate summary"));
    const button = container.querySelector("button");
    expect(pxOf(styleAt(button, PHONE, "minHeight"))).toBeGreaterThanOrEqual(MOBILE_TAP_MIN);
    expect(styleAt(button, DESKTOP, "minHeight")).toBe("auto");
  });
});
