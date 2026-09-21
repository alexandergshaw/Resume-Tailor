// @vitest-environment jsdom
//
// ---------------------------------------------------------------------------
// THE REACHABILITY TEST for N45's per-section regeneration (plan step S10).
// AC-N45.1's user-facing half, and the reason this round exists.
// ---------------------------------------------------------------------------
//
// `c14a155` landed the whole storage substrate -- the revisions table, the
// section-owned claims, the merge, the restore, the complete N47 fix -- and
// SHIPPED NO WAY FOR A CANDIDATE TO ASK FOR ANY OF IT. Verified on this tree:
// `app/hooks/usePrepGeneration.js` contains zero occurrences of `section`
// (canary: `body?.applicationId` occurs 4 times in route.js, so the same
// search over the same roots does find real things), and `PrepPackPanel.js`
// renders exactly one Generate/Regenerate control, for the WHOLE pack
// (`GenerateControl`, PrepPackPanel.js:498-517, rendered once at :658).
//
// THIS FILE DOES NOT CALL `generateNow`, `handleGenerateNow`, or any
// `onRegenerateSection` prop DIRECTLY. Per this repo's standing bar -- and
// after FIVE separate defects this session in which a correct mechanism
// shipped with the last hop to a human missing, each past a fully green suite
// -- a test that calls the handler backing a control does not establish that
// the control exists or is wired to it. Every case below mounts the REAL
// AppViewDialog, finds a REAL rendered <button> by its accessible name, and
// dispatches a REAL click MouseEvent, then reads what went out over `fetch`.
// That is the same idiom AppViewDialog.prepGenerate.reachability.test.js used
// for N29's whole-pack control (:143-153, :160-184), reused deliberately so
// the two files' power is comparable.
//
// WHY EACH CASE IS RED ON HEAD: there is no per-section control in the
// rendered DOM at all, so `findSectionButton(...)` returns undefined and the
// first expect in each case fails with its own message. Not a fixture defect
// -- the same harness finds the WHOLE-PACK button in the last describe block
// below, which is the positive control proving the finder and the mount work.
//
// CONTRACTS THIS FILE BINDS, because the plan (§S10) named the surface but not
// its shape:
//   1. The per-section control's ACCESSIBLE NAME contains both the word
//      "Regenerate" and that section's own visible label (PrepPackPanel.js:83's
//      SECTION_LABELS). A bare "Regenerate" four times over is four controls
//      a screen-reader user cannot tell apart, and it would also collide with
//      the whole-pack control's own name.
//   2. The request is POST /api/interview-prep with body
//      {applicationId, triggerClass, section} -- `section` ADDED to the
//      existing body, never a new endpoint and never a second POST shape.
//   3. A WHOLE-PACK regeneration's body still carries NO `section` key at all.
//      This is not decoration: AppViewDialog.prepGenerate.reachability.test.js:183
//      asserts that body with `toEqual({applicationId, triggerClass})`, so an
//      implementation that always sends `section: null` turns a landed test
//      red. Pinned here too, in this round's own file, so the constraint is
//      stated where the new code is written rather than discovered by breaking
//      someone else's file.
//
// WHAT THIS FILE CANNOT ASSERT, stated rather than faked:
//   * That the server honours `section`. That is route.section.test.js's job;
//     here the network is stubbed and only the OUTGOING request is read.
//   * Anything about rendered geometry or focus order. jsdom has no layout,
//     and MUI's Dialog portals to document.body (hence every query below
//     reads document.body, with the portal tripwire asserted in the last
//     block).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import AppViewDialog from "./AppViewDialog.js";

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
  vi.unstubAllGlobals();
});

// PrepPackPanel.js:83, restated as literals rather than imported. Restating
// pins the exact copy a candidate reads; an import would only pin that the two
// files agree with each other. (Exporting the constant purely so a test could
// reach it is forbidden and would move lib/sourceScan/exportReachability.)
const SECTION_LABELS = {
  aboutYou: "Tell me about yourself",
  whyRole: "Why this role",
  askThem: "Questions to ask them",
  stages: "Interview stages",
};

const APP = {
  id: "app-1",
  status: "applied",
  applied_at: "2026-01-05T00:00:00.000Z",
  application_url: null,
  positions: {
    id: "pos-1",
    company: "Stripe",
    title: "Frontend Engineer",
    url: null,
    description: "Build payment surfaces.",
  },
  generated_resumes: null,
};

const READY_PACK = {
  version: 1,
  sections: {
    aboutYou: { answer: { lines: [{ text: "I led three cross-functional launches.", support: null }] } },
    whyRole: { answer: { lines: [{ text: "This role matches my background.", support: null }] } },
    askThem: { questions: [{ text: "How is this team's work measured?", support: null }] },
    stages: {
      stages: [{ name: "Screen", questions: ["Walk me through a project."], recommendedAnswer: null, support: null }],
    },
  },
  claims: [],
};

/** The shape GET /api/interview-prep really returns today (route.js:705-716),
 *  including the two fields `c14a155` already added. */
function readyGetResponse(overrides = {}) {
  return {
    pack: READY_PACK,
    status: "ready",
    completeSections: ["aboutYou", "whyRole", "askThem", "stages"],
    attemptsExhausted: false,
    events: [],
    candidateName: null,
    interviewerNames: [],
    error: null,
    liveRevisions: { aboutYou: 1, whyRole: 1, askThem: 1, stages: 1 },
    sectionRevisions: {
      aboutYou: [{ revision: 1, engine: "gemini", restoredFrom: null, createdAt: "2026-09-01T00:00:00.000Z" }],
      whyRole: [{ revision: 1, engine: "gemini", restoredFrom: null, createdAt: "2026-09-01T00:00:00.000Z" }],
      askThem: [{ revision: 1, engine: "gemini", restoredFrom: null, createdAt: "2026-09-01T00:00:00.000Z" }],
      stages: [{ revision: 1, engine: "gemini", restoredFrom: null, createdAt: "2026-09-01T00:00:00.000Z" }],
    },
    ...overrides,
  };
}

function baseProps(overrides = {}) {
  return {
    appDialog: { open: true, rowIndex: 0, kind: "prep" },
    setAppDialog: vi.fn(),
    applicationData: [APP],
    communicationsDialog: { open: false, items: [] },
    loadCommunicationsForApp: vi.fn(),
    openAddCommunicationDialog: vi.fn(),
    digestsById: {},
    researchingIds: new Set(),
    researchOne: vi.fn(),
    ...overrides,
  };
}

async function render(props) {
  await act(async () => {
    root.render(createElement(AppViewDialog, props));
  });
}

// A macrotask-based flush (the sibling reachability file's own reasoning,
// :116-128): the GET effect chains fetch().then(json).then(setState), which is
// more microtask hops than a single bare `await act(...)` drains.
async function flush(times = 5) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Accessible name, in the order a browser resolves it for a <button>:
 *  aria-labelledby, then aria-label, then the rendered text content with
 *  aria-hidden subtrees dropped. Deliberately NOT a tooltip read: a MUI
 *  Tooltip renders describing markup that never becomes the control's own
 *  accessible name, which is exactly the trap this repo's a11y notes record. */
function accessibleName(node) {
  const labelledBy = node.getAttribute("aria-labelledby");
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter(Boolean)
      .map((el) => el.textContent || "");
    if (parts.length) return parts.join(" ").replace(/\s+/g, " ").trim();
  }
  const label = node.getAttribute("aria-label");
  if (label) return label.replace(/\s+/g, " ").trim();
  const clone = node.cloneNode(true);
  for (const hidden of clone.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return (clone.textContent || "").replace(/\s+/g, " ").trim();
}

function allButtons() {
  return Array.from(document.body.querySelectorAll('button, [role="button"]'));
}

/** The per-section control: a button whose accessible name carries BOTH the
 *  word "regenerate" and that section's own label. */
function findSectionButton(section) {
  const label = SECTION_LABELS[section];
  return allButtons().find((node) => {
    const name = accessibleName(node);
    return /regenerate/i.test(name) && name.includes(label);
  });
}

function findButton(pattern) {
  return allButtons().find((node) => pattern.test(accessibleName(node)));
}

function click(node) {
  return act(async () => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

/** Every POST issued to the prep route, as parsed bodies. */
function postBodies(fetchMock, fromIndex = 0) {
  return fetchMock.mock.calls
    .slice(fromIndex)
    .filter(([url, init]) => url === "/api/interview-prep" && init && init.method === "POST")
    .map(([, init]) => JSON.parse(init.body));
}

function getCalls(fetchMock, fromIndex = 0) {
  return fetchMock.mock.calls
    .slice(fromIndex)
    .filter(([url, init]) => String(url).startsWith("/api/interview-prep?") && (!init || init.method === undefined));
}

/** A stub that answers the GET with `getBody` and every POST with `postBody`. */
function stubFetch(getBody, postBody = { status: "ready", section: null, sectionProduced: true }) {
  const fetchMock = vi.fn().mockImplementation((url, init) => {
    if (!init || init.method === undefined) return Promise.resolve(jsonResponse(getBody));
    return Promise.resolve(jsonResponse(postBody));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// ---------------------------------------------------------------------------

describe("AC-N45.1 (reachability) -- a candidate can ASK for one section to be regenerated", () => {
  it("clicking the REAL rendered per-section control for 'Questions to ask them' issues exactly one POST carrying that section and this application", async () => {
    const fetchMock = stubFetch(readyGetResponse());
    await render(baseProps());
    await flush();

    const before = fetchMock.mock.calls.length;
    const button = findSectionButton("askThem");
    expect(
      button,
      "no rendered control regenerates ONE section: no button's accessible name contains both 'Regenerate' and 'Questions to ask them'",
    ).toBeTruthy();

    await click(button);
    await flush();

    const posts = postBodies(fetchMock, before);
    expect(posts, "clicking the per-section control issued no POST (or more than one)").toHaveLength(1);
    expect(posts[0].applicationId).toBe("app-1");
    expect(posts[0].section).toBe("askThem");
    expect(typeof posts[0].triggerClass).toBe("string");
  });

  it("[discrimination control] each section's own control names its OWN section -- two different controls do not send the same value", async () => {
    // Without this, a build that hardwires `section: "aboutYou"` into a single
    // shared handler passes the case above and is wrong for three sections out
    // of four. The two clicks are separate requests, so the in-flight guard
    // (keyed per section, AC-UX.7) must not swallow the second either.
    const fetchMock = stubFetch(readyGetResponse());
    await render(baseProps());
    await flush();

    const first = findSectionButton("aboutYou");
    const second = findSectionButton("stages");
    expect(first, "no per-section control for 'Tell me about yourself'").toBeTruthy();
    expect(second, "no per-section control for 'Interview stages'").toBeTruthy();

    const before = fetchMock.mock.calls.length;
    await click(first);
    await flush();
    await click(second);
    await flush();

    expect(postBodies(fetchMock, before).map((b) => b.section)).toEqual(["aboutYou", "stages"]);
  });

  it("all four sections carry their own control, so no section is regenerable only by regenerating the whole pack", async () => {
    stubFetch(readyGetResponse());
    await render(baseProps());
    await flush();

    const missing = Object.keys(SECTION_LABELS).filter((section) => !findSectionButton(section));
    expect(missing, `sections with no per-section regenerate control: ${missing.join(", ")}`).toEqual([]);
  });

  it("a successful per-section POST is followed by a GET refetch, so the new section actually appears", async () => {
    // route.js's POST never returns pack content (:612 returns {status}
    // only), so a regeneration a candidate cannot SEE is the same defect in a
    // different place.
    const fetchMock = stubFetch(readyGetResponse(), { status: "ready", section: "askThem", sectionProduced: true });
    await render(baseProps());
    await flush();

    const button = findSectionButton("askThem");
    expect(button, "no per-section control to click").toBeTruthy();

    const before = fetchMock.mock.calls.length;
    await click(button);
    await flush();

    expect(getCalls(fetchMock, before).length, "no GET refetch followed the section regeneration").toBeGreaterThan(0);
  });
});

describe("AC-N45.1 -- the per-section controls are absent exactly when regeneration is impossible", () => {
  it("while an attempt is already running, no per-section control renders and a click on the panel issues no POST", async () => {
    // The lease serializes any two attempts on one row (AC-CONC.1), so a
    // second request during a running one can only ever be a 409. Offering the
    // control anyway is an invitation to a refusal.
    stubFetch(readyGetResponse({ status: "running" }));
    const fetchMock = globalThis.fetch;
    await render(baseProps());
    await flush();

    const present = Object.keys(SECTION_LABELS).filter((section) => findSectionButton(section));
    expect(present, `per-section controls rendered while status is 'running': ${present.join(", ")}`).toEqual([]);

    const before = fetchMock.mock.calls.length;
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(postBodies(fetchMock, before)).toHaveLength(0);
  });

  it("an application with no job description renders no per-section control either", async () => {
    const NO_DESCRIPTION_APP = { ...APP, positions: { ...APP.positions, description: "" } };
    stubFetch(readyGetResponse());
    await render(baseProps({ applicationData: [NO_DESCRIPTION_APP] }));
    await flush();

    const present = Object.keys(SECTION_LABELS).filter((section) => findSectionButton(section));
    expect(present, `per-section controls rendered with no job description: ${present.join(", ")}`).toEqual([]);
  });
});

describe("[regression guard] the WHOLE-PACK control keeps its exact request shape", () => {
  it("clicking 'Regenerate' sends {applicationId, triggerClass} and NO `section` key", async () => {
    // GREEN ON HEAD BY DESIGN, and it is the positive control for this whole
    // file: it proves the mount, the portal, the finder and the fetch reader
    // all work, so an "undefined button" above is a statement about the
    // per-section control and not about this harness.
    //
    // It is also a real constraint on the new code:
    // AppViewDialog.prepGenerate.reachability.test.js:183 pins this body with
    // toEqual, so sending `section: null` on the whole-pack path turns a
    // LANDED test red. `section` is added only when a section was asked for.
    const fetchMock = stubFetch(readyGetResponse());
    await render(baseProps());
    await flush();

    expect(document.body.textContent).not.toBe(container.textContent); // the portal tripwire

    const button = findButton(/^regenerate$/i);
    expect(button, "the whole-pack Regenerate control is missing -- this harness is broken, not the feature").toBeTruthy();

    const before = fetchMock.mock.calls.length;
    await click(button);
    await flush();

    const posts = postBodies(fetchMock, before);
    expect(posts).toHaveLength(1);
    expect(Object.prototype.hasOwnProperty.call(posts[0], "section")).toBe(false);
    expect(posts[0].applicationId).toBe("app-1");
  });
});
