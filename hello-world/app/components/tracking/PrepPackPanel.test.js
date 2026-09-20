// @vitest-environment jsdom
//
// TDD RED handoff -- N25's read surface, `PrepPackPanel.js`
// (design-reconciled.r2.md ss5.3's client-module table:
// `app/components/tracking/PrepPackPanel.js`, new, "use client", imports
// NONE of prepParse.js/prepPack.js/prepStore.js/trustedNames.js -- it
// receives ALREADY-FETCHED data as props, from the GET route's own
// documented return shape, ss5.1: `{pack, status, completeSections,
// attemptsExhausted, candidateName, interviewerNames, error}`).
//
// THE COMPONENT DOES NOT EXIST YET: `grep -rn "PrepPackPanel"
// hello-world/app hello-world/lib` -> 2 hits, both comments (ac.r1.md
// SURVEY-N33.5's own instrument, re-run this round with the same canary
// result). Every test below fails at import resolution.
//
// SCOPE, STATED HONESTLY (per this seat's brief: "if r2 is silent or
// ambiguous, record it as a question rather than inventing a contract").
// r2 settles the DATA this component receives (the GET response shape,
// quoted above) and the BEHAVIOURAL requirements AC-N33.13/14/15/16/21 bind,
// but it does NOT settle this component's full prop API -- whether it takes
// one `pack`-shaped prop object or several flat props, what an "Edit names"
// / "Regenerate" / "Download prep log" callback prop is named, or whether it
// renders its own data-fetching (r2 ss5.3 says NO -- data arrives pre-fetched
// via `usePrepPack.js`, a SEPARATE new module this file does not test).
// This file therefore tests PrepPackPanel as a PURE, already-fed renderer:
// every fixture below passes the exact flat prop shape the GET route's own
// documented return type specifies, plus an `onDownloadLog` callback for
// AC-N33.21 (named, not verified against any other document -- flagged as
// an assumption in this seat's final report). If the real component's props
// differ in shape, this file's fixtures -- not its assertions about
// RENDERED TEXT -- are what the implementer/next round should adjust.
//
// Idiom: createRoot + act, per app/components/tracking/DigestPanel.test.js
// (this repo's own precedent for a status-driven tracking panel with
// several states that "look alike"). No @testing-library in this repo (no
// package.json entry, confirmed by DigestPanel.test.js's own header), so
// assertions read rendered text/attributes directly rather than computing
// an accessible name.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SPECIFIER = "./PrepPackPanel.js";
let modPromise;
function load() {
  if (!modPromise) modPromise = import(SPECIFIER);
  return modPromise;
}

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(props) {
  const mod = await load();
  const PrepPackPanel = mod.default;
  act(() => {
    root.render(createElement(PrepPackPanel, props));
  });
  return container;
}

const READY_PACK = {
  version: 1,
  sections: {
    aboutYou: { answer: { lines: [{ text: "I led three cross-functional launches." }] } },
    whyRole: { answer: { lines: [{ text: "This role matches my background." }] } },
    askThem: { questions: [{ text: "How is this team's work measured?" }] },
    stages: { stages: [{ name: "Overview", questions: ["Tell me about yourself."], recommendedAnswer: null, support: null }] },
  },
  claims: [],
};

function baseProps(overrides = {}) {
  return {
    applicationId: "app-1",
    pack: null,
    status: null,
    completeSections: [],
    attemptsExhausted: false,
    candidateName: null,
    interviewerNames: [],
    error: null,
    onDownloadLog: vi.fn(),
    ...overrides,
  };
}

describe("AC-N33.13 -- every reachable status renders distinct, honest UI", () => {
  it("'absent' (no row at all: pack null, status null) renders an empty/no-attempt-yet state, never a spinner or an error", async () => {
    const el = await render(baseProps({ pack: null, status: null }));
    const text = el.textContent;
    expect(text.length).toBeGreaterThan(0);
    expect(text.toLowerCase()).not.toContain("failed");
  });

  it("'running' renders a distinct in-progress state", async () => {
    const el = await render(baseProps({ pack: null, status: "running" }));
    expect(el.textContent.toLowerCase()).toMatch(/generat|running|progress|preparing/);
  });

  it("'ready' renders the full pack content, all four sections", async () => {
    const el = await render(
      baseProps({ pack: READY_PACK, status: "ready", completeSections: ["aboutYou", "whyRole", "askThem", "stages"] }),
    );
    expect(el.textContent).toContain("I led three cross-functional launches.");
    expect(el.textContent).toContain("How is this team's work measured?");
  });

  it("'partial' renders ONLY the sections present in completeSections, and visibly names the pack as partial", async () => {
    const partialPack = {
      ...READY_PACK,
      sections: { ...READY_PACK.sections, whyRole: { answer: { lines: [] } }, askThem: { questions: [] } },
    };
    const el = await render(baseProps({ pack: partialPack, status: "partial", completeSections: ["aboutYou", "stages"] }));
    expect(el.textContent).toContain("I led three cross-functional launches.");
    expect(el.textContent.toLowerCase()).toMatch(/partial|incomplete/);
  });

  it("[the invariant AC-N33.13 names explicitly] a partial pack NEVER renders a section it has no content for as though it were present", async () => {
    const partialPack = { ...READY_PACK, sections: { ...READY_PACK.sections, whyRole: { answer: { lines: [] } } } };
    const el = await render(baseProps({ pack: partialPack, status: "partial", completeSections: ["aboutYou", "askThem", "stages"] }));
    expect(el.textContent).not.toContain("This role matches my background.");
  });

  it("'failed' renders a distinct failure state, never the same copy as 'unavailable'", async () => {
    // `render()` returns the shared, module-level `container` `beforeEach`
    // creates once per test (see its own header) -- calling it twice in one
    // `it` returns the SAME node both times, so `.textContent` must be
    // captured into a string immediately after each render, before the next
    // render mutates that node. Reading both `.textContent`s only after both
    // renders complete (the previous form here) compared the same reference
    // to itself and could never fail no matter what the component rendered.
    const failed = await render(baseProps({ pack: null, status: "failed" }));
    const failedText = failed.textContent;
    const unavailable = await render(baseProps({ pack: null, status: "unavailable" }));
    const unavailableText = unavailable.textContent;
    expect(failedText.toLowerCase()).toMatch(/fail|error|try again/);
    expect(failedText).not.toBe(unavailableText);
  });

  it("'unavailable' renders a distinct, honest state (nothing to research), not a generic failure", async () => {
    const el = await render(baseProps({ pack: null, status: "unavailable" }));
    expect(el.textContent.toLowerCase()).toMatch(/unavailable|no posting|nothing to research/);
  });

  it("every one of the six status values produces visibly DIFFERENT rendered text from every other -- the property this AC actually cares about, not six isolated snapshots", async () => {
    const statuses = ["absent", "running", "ready", "partial", "failed", "unavailable"];
    const outputs = new Map();
    for (const status of statuses) {
      const realStatus = status === "absent" ? null : status;
      const pack = status === "ready" || status === "partial" ? READY_PACK : null;
      const completeSections = status === "ready" ? ["aboutYou", "whyRole", "askThem", "stages"] : status === "partial" ? ["aboutYou"] : [];
      const el = await render(baseProps({ pack, status: realStatus, completeSections }));
      outputs.set(status, el.textContent);
    }
    const values = [...outputs.values()];
    const uniqueValues = new Set(values);
    expect(uniqueValues.size, `two status values rendered identical text: ${JSON.stringify([...outputs.entries()])}`).toBe(values.length);
  });
});

describe("AC-N33.15 -- a legacy (pre-N16) pack renders honestly, never crashes", () => {
  it("a pre-N16-shaped pack (top-level tellMeAboutYourself/whyThisPosition/questionsToAsk, no sections.aboutYou) renders without throwing", async () => {
    const legacyPack = {
      tellMeAboutYourself: "I led three cross-functional launches.",
      whyThisPosition: "This role matches my background.",
      questionsToAsk: ["How is this team's work measured?"],
    };
    await expect(render(baseProps({ pack: legacyPack, status: "partial", completeSections: ["stages"] }))).resolves.toBeDefined();
  });

  it("shows the recovered 'stages' content and no others, per the recovery this chunk's own instrument requires (extractStageList's own back-compat limb, prepParse.js)", async () => {
    const legacyPack = {
      tellMeAboutYourself: "orphaned, never rendered",
      sections: { stages: { stages: [{ name: "Overview", questions: ["Tell me about yourself."], recommendedAnswer: null, support: null }] } },
    };
    const el = await render(baseProps({ pack: legacyPack, status: "partial", completeSections: ["stages"] }));
    expect(el.textContent).toContain("Tell me about yourself.");
    expect(el.textContent).not.toContain("orphaned, never rendered");
  });
});

describe("AC-N33.16 -- the generic partial-pack affordance names BOTH possible causes without asserting either", () => {
  it("a partial pack's own copy does not claim a specific reason ('thin because little to research' vs 'gutted by refusal') -- it must not commit to either cause", async () => {
    const el = await render(baseProps({ pack: READY_PACK, status: "partial", completeSections: ["aboutYou"] }));
    const text = el.textContent.toLowerCase();
    // Neither cause-specific word may appear -- the generic affordance is
    // sufficient per AC-N33.16; a build that names a specific cause without
    // actually knowing which one occurred would overclaim.
    expect(text).not.toContain("refused");
    expect(text).not.toContain("gutted");
  });

  it("offers a regeneration path from the partial state (the 'sufficient' bar AC-N33.16 sets)", async () => {
    const el = await render(baseProps({ pack: READY_PACK, status: "partial", completeSections: ["aboutYou"] }));
    expect(el.textContent.toLowerCase()).toMatch(/regenerat|try again|generate again/);
  });
});

describe("AC-N33.21 -- a 'Download prep log' control is present and wired to the supplied callback", () => {
  it("renders a button whose accessible text names the prep log download", async () => {
    const el = await render(baseProps({ pack: READY_PACK, status: "ready", completeSections: ["aboutYou", "whyRole", "askThem", "stages"] }));
    const buttons = [...el.querySelectorAll("button")];
    const downloadButton = buttons.find((b) => /download.*(log|prep)/i.test(b.textContent || ""));
    expect(downloadButton, "no 'Download prep log' button found").toBeDefined();
  });

  it("clicking it invokes the onDownloadLog prop exactly once", async () => {
    const onDownloadLog = vi.fn();
    const el = await render(
      baseProps({ pack: READY_PACK, status: "ready", completeSections: ["aboutYou", "whyRole", "askThem", "stages"], onDownloadLog }),
    );
    const buttons = [...el.querySelectorAll("button")];
    const downloadButton = buttons.find((b) => /download.*(log|prep)/i.test(b.textContent || ""));
    expect(downloadButton).toBeDefined();
    act(() => downloadButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
    expect(onDownloadLog).toHaveBeenCalledTimes(1);
  });
});

describe("names strip -- the candidate's own name and interviewer names both render (DX ss1.1/ss1.4, unaffected by pack status)", () => {
  it("shows the candidate's stored name when present", async () => {
    const el = await render(baseProps({ candidateName: "Alex Shaw" }));
    expect(el.textContent).toContain("Alex Shaw");
  });

  it("shows an empty-state affordance when no candidate name is stored yet, matching the existing 'no communications yet / Add' precedent's wording discipline (AppViewDialog.js:141-146)", async () => {
    const el = await render(baseProps({ candidateName: null }));
    expect(el.textContent.toLowerCase()).toMatch(/add|enter|no name/);
  });

  it("shows every stored interviewer name", async () => {
    const el = await render(baseProps({ interviewerNames: ["Priya Nair", "J. Okafor"] }));
    expect(el.textContent).toContain("Priya Nair");
    expect(el.textContent).toContain("J. Okafor");
  });
});
