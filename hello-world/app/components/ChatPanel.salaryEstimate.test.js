// @vitest-environment jsdom
//
// N65 step 2 — the ChatPanel affordance and estimate block (S4/S5/S12).
//
// These acceptance criteria ARE the markup, so they are rendered rather than
// extracted: which control appears on the pinned-posting bar, whether the
// estimate is visibly LABELLED and distinct from a stated figure (S4), whether a
// citation becomes a resolvable anchor (S5), and whether one click on the real
// button reaches the real request path with the pinned posting flowing in (S12
// reachability — the button is DRIVEN, never the handler called directly).
//
// RED ON HEAD: ChatPanel.js renders `m.content` and a pinned-context bar with no
// "Estimate salary" button and no salaryEstimate block, so every positive
// assertion here fails as a clean assertion (the file collects — ChatPanel and
// all its imports exist). The two ABSENCE controls (button hidden when pay is
// stated / no posting; no chip on a withhold) pass VACUOUSLY at HEAD because the
// feature does not exist yet; the seat's report proves they bite once built, via
// the paired positive and a mutant that removes the `!salaryStated` gate.
//
// MANUAL / BROWSER-ONLY (not claimed here): focus-ring visibility and real
// colour distinctness — jsdom has no layout or computed style.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import ChatPanel from "./ChatPanel.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
let originalFetch;

beforeEach(() => {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = vi.fn(() => ({
      matches: false,
      media: "",
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    }));
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  originalFetch = globalThis.fetch;
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function accessibleName(node) {
  if (!node) return "";
  return (node.getAttribute("aria-label") || (node.textContent || "").trim() || node.getAttribute("title") || "").trim();
}

function estimateButton() {
  return Array.from(container.querySelectorAll('button, [role="button"]')).find((n) =>
    /estimate salary/i.test(accessibleName(n)),
  );
}

const POSTING = { title: "Senior Platform Engineer", company: "Acme", location: "Remote (US)", salaryStated: false };

const ESTIMATED = {
  status: "estimated",
  reason: "ok",
  range: { min: 100000, max: 120000 },
  basisKind: "comparable",
  sourceCount: 1,
  citations: [{ url: "https://www.levels.fyi/company/acme", title: "Levels.fyi — Acme", host: "levels.fyi" }],
  searched: true,
  truncated: false,
};

const WITHHELD = {
  status: "insufficient_sources",
  reason: "no_sources",
  range: null,
  basisKind: "none",
  sourceCount: 0,
  citations: [],
  searched: true,
  truncated: false,
};

function baseProps(overrides = {}) {
  return {
    chatPanelRef: { current: null },
    chatScrollRef: { current: null },
    chatInputRef: { current: null },
    chatDragActive: false,
    setChatDragActive: vi.fn(),
    addChatAttachments: vi.fn(),
    fabPos: { bottom: 24, right: 24 },
    chatSize: { width: 380, height: 520 },
    startChatResize: vi.fn(),
    chatMessages: [],
    setChatMessages: vi.fn(),
    chatError: "",
    setChatError: vi.fn(),
    chatPinnedContext: null,
    setChatPinnedContext: vi.fn(),
    chatSending: false,
    chatCopiedIndex: null,
    setChatCopiedIndex: vi.fn(),
    resendUserMessage: vi.fn(),
    chatAttachedFiles: [],
    setChatAttachedFiles: vi.fn(),
    chatAttachError: "",
    setChatAttachError: vi.fn(),
    chatInput: "",
    setChatInput: vi.fn(),
    sendChatMessage: vi.fn(),
    onClose: vi.fn(),
    returnFocusRef: { current: null },
    ...overrides,
  };
}

async function render(props) {
  await act(async () => {
    root.render(createElement(ChatPanel, props));
  });
  return container;
}

describe("ChatPanel — the 'Estimate salary' affordance (S12)", () => {
  it("offers 'Estimate salary' when a posting with no stated pay is pinned", async () => {
    await render(baseProps({ chatPinnedContext: { label: "Senior Platform Engineer", posting: POSTING } }));
    expect(estimateButton(), "no 'Estimate salary' control on the pinned-posting bar").toBeTruthy();
  });

  it("CONTROL: hides the affordance when the posting already STATES its pay (S1)", async () => {
    // Vacuous at HEAD (no button exists at all); paired with the positive above
    // and the removed-`!salaryStated`-gate mutant, which makes it bite once
    // built. The failure direction that matters: offering an estimate over pay
    // the posting already states.
    await render(
      baseProps({ chatPinnedContext: { label: "Senior Platform Engineer", posting: { ...POSTING, salaryStated: true } } }),
    );
    expect(estimateButton()).toBeFalsy();
  });

  it("CONTROL: no affordance when the pinned subject is not a posting", async () => {
    await render(baseProps({ chatPinnedContext: { label: "My resume", content: "..." } }));
    expect(estimateButton()).toBeFalsy();
  });

  it("one click reaches the real /api/salary-estimate path with the posting (reachability)", async () => {
    // Drives the REAL control end to end: the button's onClick must reach the
    // real requestSalaryEstimate, which POSTs to the route. A direct handler
    // call would not prove the button is wired. fetch is stubbed so no network
    // is touched.
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ salaryEstimate: WITHHELD }) });
    globalThis.fetch = fetchSpy;
    const props = baseProps({ chatPinnedContext: { label: "Senior Platform Engineer", posting: POSTING } });
    await render(props);
    const btn = estimateButton();
    expect(btn).toBeTruthy();
    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(fetchSpy).toHaveBeenCalled();
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain("/api/salary-estimate");
  });
});

describe("ChatPanel — the estimate block (S4/S5)", () => {
  it("renders a labelled 'Estimate' chip carrying the formatted range", async () => {
    // S4: the estimate is visibly labelled an estimate and distinct from a
    // stated figure. The formatted range ($100k–$120k) is produced ONLY by the
    // block, never by the app-authored framing string.
    await render(
      baseProps({
        chatMessages: [{ role: "assistant", content: "Estimated compensation for this role, based on web sources:", salaryEstimate: ESTIMATED }],
      }),
    );
    const chip = Array.from(container.querySelectorAll(".MuiChip-root")).find((c) => /estimate/i.test(c.textContent || ""));
    expect(chip, "no 'Estimate'-labelled chip rendered for the estimate").toBeTruthy();
    expect(container.textContent).toContain("$100k");
    expect(container.textContent).toContain("$120k");
  });

  it("S5: renders each citation as a resolvable, safe anchor", async () => {
    await render(
      baseProps({
        chatMessages: [{ role: "assistant", content: "Estimated compensation for this role, based on web sources:", salaryEstimate: ESTIMATED }],
      }),
    );
    const anchor = container.querySelector('a[href="https://www.levels.fyi/company/acme"]');
    expect(anchor, "the citation did not render as an openable publisher link").toBeTruthy();
    expect((anchor.getAttribute("rel") || "")).toContain("noopener");
  });

  it("CONTROL: a withheld estimate shows NO chip and NO citation links", async () => {
    // Vacuous at HEAD; the positive above pairs it. Once built, a withhold must
    // never render a range chip or a source list — that is the S3/S14 boundary
    // (no number, no confident-looking negative).
    await render(
      baseProps({
        chatMessages: [{ role: "assistant", content: "I couldn't find enough salary data to estimate a range right now.", salaryEstimate: WITHHELD }],
      }),
    );
    const chip = Array.from(container.querySelectorAll(".MuiChip-root")).find((c) => /estimate/i.test(c.textContent || ""));
    expect(chip).toBeFalsy();
    expect(container.querySelector('a[href^="http"]')).toBeFalsy();
    // The app-authored framing is still shown as ordinary text.
    expect(container.textContent).toMatch(/couldn'?t find enough/i);
  });
});
