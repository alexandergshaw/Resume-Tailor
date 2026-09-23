// @vitest-environment jsdom
//
// ---------------------------------------------------------------------------
// THE REACHABILITY TEST for N46's per-section version history (plan step S10).
// AC-N46.1's user-facing half, plus AC-UX.1, AC-UX.2 and AC-UX.3.
// ---------------------------------------------------------------------------
//
// The server half of restore is BUILT AND TESTED: `PATCH /api/interview-prep`
// exists (route.js:791-885), appends a copy with `restored_from` set, screens
// against current stored names, and is guarded by an optimistic `updated_at`
// precondition read in the same request. `route.restorePatch.test.js` covers
// all of that and this file deliberately re-tests NONE of it.
//
// What does not exist is any way for a candidate to reach it. The GET response
// already carries `sectionRevisions` and `liveRevisions` (route.js:714-715),
// and NOTHING renders them: `AppViewDialog.js:376-389` passes neither to
// `PrepPackPanel`, and `PrepPackPanel.js` has no revision UI at all. A history
// nobody can see is the same defect as no history.
//
// EVERY CASE MOUNTS THE REAL DIALOG AND CLICKS A REAL BUTTON. No case calls a
// restore handler, a prop, or `fetch` directly. The last describe block is the
// positive control: it finds and clicks the whole-pack Regenerate button with
// this exact harness, so an "undefined button" above is a statement about the
// missing feature and not about the mount.
//
// ---------------------------------------------------------------------------
// THE REQUEST BODY, and a deliberate DEPARTURE from this round's brief.
// ---------------------------------------------------------------------------
// The brief asked that activating a restore "issues the PATCH with
// `expectedUpdatedAt`". It must NOT, and this file pins the opposite:
//
//     PATCH /api/interview-prep  {applicationId, section, revision}
//
// `expectedUpdatedAt` is read SERVER-SIDE, in the same request, from the row
// itself (route.js:815 reads the base, :880 passes `base.updatedAt` to
// writePrepPackResult). Plan risk R13 is explicit that a client-supplied
// precondition is one the client can get wrong or replay, which turns an
// optimistic guard into a decoration -- and the landed handler already reads
// no such body field, so requiring one would make this red UNSATISFIABLE
// without reopening a settled, tested server contract. Recorded here, and in
// this round's notes, rather than silently obeyed or silently ignored.
//
// WHAT THIS FILE CANNOT ASSERT:
//   * That the PATCH restores anything. route.restorePatch.test.js owns that.
//   * Rendered geometry, focus rings, or scroll position (no layout in jsdom).
//   * Whether a screen reader announces the list as a list; what is asserted
//     is the DOM precondition (distinct accessible names per control).

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

// aboutYou has THREE revisions and the newest is live, so two are restorable.
// whyRole has exactly one, which is live, so none is -- that asymmetry is the
// over-fire control: a build that renders a restore control per revision
// unconditionally offers a candidate the version they are already reading.
const SECTION_REVISIONS = {
  aboutYou: [
    { revision: 3, engine: "gemini", restoredFrom: null, createdAt: "2026-09-03T00:00:00.000Z" },
    { revision: 2, engine: "gemini", restoredFrom: 1, createdAt: "2026-09-02T00:00:00.000Z" },
    { revision: 1, engine: "embedded", restoredFrom: null, createdAt: "2026-09-01T00:00:00.000Z" },
  ],
  whyRole: [{ revision: 1, engine: "gemini", restoredFrom: null, createdAt: "2026-09-01T00:00:00.000Z" }],
  askThem: [{ revision: 1, engine: "gemini", restoredFrom: null, createdAt: "2026-09-01T00:00:00.000Z" }],
  stages: [{ revision: 1, engine: "gemini", restoredFrom: null, createdAt: "2026-09-01T00:00:00.000Z" }],
};

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
    liveRevisions: { aboutYou: 3, whyRole: 1, askThem: 1, stages: 1 },
    sectionRevisions: SECTION_REVISIONS,
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

async function flush(times = 5) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

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

/** Controls that RESTORE a specific revision of `section`. The bound contract:
 *  the accessible name carries "restore", the section's own visible label, and
 *  the revision number -- so two entries in the same list are distinguishable
 *  by name alone, and a control in the aboutYou list cannot be confused with
 *  one in another section's. */
function restoreControls(section) {
  const label = SECTION_LABELS[section];
  return allButtons()
    .map((node) => ({ node, name: accessibleName(node) }))
    .filter((row) => /restore/i.test(row.name) && row.name.includes(label));
}

function revisionInName(name) {
  const digits = name.match(/\d+/g) || [];
  return digits.length ? Number(digits[digits.length - 1]) : null;
}

/** AC-UX.3's own bar, made mechanical: restoring an already-identified
 *  revision takes at most ONE activation beyond selecting it. So the restore
 *  controls are either already on screen (0 activations) or reachable behind a
 *  SINGLE disclosure (1). Anything deeper is the multi-step wizard AC-UX.3
 *  forbids. Returns the number of activations this helper had to spend. */
async function openHistory(section) {
  if (restoreControls(section).length > 0) return 0;
  const label = SECTION_LABELS[section];
  const disclosures = Array.from(document.body.querySelectorAll('button, [role="button"], summary'))
    .map((node) => ({ node, name: accessibleName(node) }))
    .filter((row) => /version|history|earlier|previous/i.test(row.name));
  const mine = disclosures.filter((row) => row.name.includes(label));
  const target = (mine.length ? mine : disclosures)[0];
  if (!target) return 0;
  await act(async () => {
    target.node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await flush(2);
  return 1;
}

function click(node) {
  return act(async () => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

function patchBodies(fetchMock, fromIndex = 0) {
  return fetchMock.mock.calls
    .slice(fromIndex)
    .filter(([url, init]) => url === "/api/interview-prep" && init && init.method === "PATCH")
    .map(([, init]) => JSON.parse(init.body));
}

function getCalls(fetchMock, fromIndex = 0) {
  return fetchMock.mock.calls
    .slice(fromIndex)
    .filter(([url, init]) => String(url).startsWith("/api/interview-prep?") && (!init || init.method === undefined));
}

function stubFetch(getBody, writeBody = { status: "restored" }) {
  const fetchMock = vi.fn().mockImplementation((url, init) => {
    if (!init || init.method === undefined) return Promise.resolve(jsonResponse(getBody));
    return Promise.resolve(jsonResponse(writeBody));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// ---------------------------------------------------------------------------

describe("AC-N46.1 / AC-UX.1 (reachability) -- a candidate can SEE a section's earlier versions", () => {
  it("a section with three stored revisions shows an entry per restorable revision, each with its own distinct name", async () => {
    stubFetch(readyGetResponse());
    await render(baseProps());
    await flush();

    const activations = await openHistory("aboutYou");
    expect(activations, "the revision list took more than one activation to reach").toBeLessThanOrEqual(1);

    const controls = restoreControls("aboutYou");
    expect(
      controls.length,
      "no restore control for 'Tell me about yourself': the GET already carries sectionRevisions and nothing renders it",
    ).toBe(2);

    const names = controls.map((row) => row.name);
    expect(new Set(names).size, `two restore controls share an accessible name: ${names.join(" | ")}`).toBe(2);
    expect(names.map(revisionInName).sort()).toEqual([1, 2]);
  });

  it("[over-fire control] a section whose ONLY revision is the live one offers no restore control", async () => {
    // whyRole has exactly one revision and it is live. A build that renders a
    // control per revision row, or one that ignores `liveRevisions`, offers a
    // candidate the version they are already looking at.
    stubFetch(readyGetResponse());
    await render(baseProps());
    await flush();

    await openHistory("whyRole");
    expect(restoreControls("whyRole").map((row) => row.name)).toEqual([]);
  });

  it("AC-UX.1: a revision that was itself created by a restore is disclosed as one", async () => {
    // `restoredFrom` is in the response for exactly this reason (AC-UX.1).
    // aboutYou revision 2 carries restoredFrom: 1; nothing else does.
    stubFetch(readyGetResponse());
    await render(baseProps());
    await flush();
    await openHistory("aboutYou");

    const text = (document.body.textContent || "").replace(/\s+/g, " ");
    expect(text, "no rendered text distinguishes a restored revision from a generated one").toMatch(/restored/i);
  });

  it("AC-UX.2: no revision BODY is rendered -- the list is metadata only", async () => {
    // The GET list projection carries no content/claims (prepStore.js:724), so
    // the only way a body could appear here is if a later build starts
    // shipping them. Asserting the live section's own text renders exactly
    // once keeps the list from quietly becoming a diff viewer.
    stubFetch(readyGetResponse());
    await render(baseProps());
    await flush();
    await openHistory("aboutYou");

    const text = document.body.textContent || "";
    const occurrences = text.split("I led three cross-functional launches.").length - 1;
    expect(occurrences).toBe(1);
  });
});

describe("AC-N46.1 / AC-UX.3 (reachability) -- activating a restore issues the PATCH, with no confirmation step", () => {
  it("one click on a restore control issues exactly one PATCH naming this application, that section and that revision", async () => {
    const fetchMock = stubFetch(readyGetResponse());
    await render(baseProps());
    await flush();
    await openHistory("aboutYou");

    const controls = restoreControls("aboutYou");
    expect(controls.length, "no restore control to activate").toBeGreaterThan(0);
    const target = controls.find((row) => revisionInName(row.name) === 1);
    expect(target, "no restore control identifiably for revision 1").toBeTruthy();

    const before = fetchMock.mock.calls.length;
    await click(target.node);
    await flush();

    const patches = patchBodies(fetchMock, before);
    // ONE click, ONE request: if a confirmation dialog were in the way this
    // would be zero. That is AC-UX.3's whole content, and it is why this
    // assertion is written as "after the single click" rather than "after the
    // flow completes".
    expect(patches, "one click on the restore control issued no PATCH (a confirmation step in the way?)").toHaveLength(1);
    expect(patches[0]).toEqual({ applicationId: "app-1", section: "aboutYou", revision: 1 });
  });

  it("[discrimination control] the OTHER entry restores the OTHER revision", async () => {
    // Without this, a build that hardwires `revision: 1` (or "the oldest")
    // passes the case above while being wrong for every other entry.
    const fetchMock = stubFetch(readyGetResponse());
    await render(baseProps());
    await flush();
    await openHistory("aboutYou");

    const target = restoreControls("aboutYou").find((row) => revisionInName(row.name) === 2);
    expect(target, "no restore control identifiably for revision 2").toBeTruthy();

    const before = fetchMock.mock.calls.length;
    await click(target.node);
    await flush();

    expect(patchBodies(fetchMock, before)[0]).toEqual({ applicationId: "app-1", section: "aboutYou", revision: 2 });
  });

  it("a successful restore is followed by a GET refetch, so the restored section actually appears", async () => {
    // PATCH returns {status:"restored"} and no content (route.js:884), so
    // without the refetch the candidate clicks and nothing changes on screen.
    const fetchMock = stubFetch(readyGetResponse());
    await render(baseProps());
    await flush();
    await openHistory("aboutYou");

    const target = restoreControls("aboutYou")[0];
    expect(target, "no restore control to activate").toBeTruthy();

    const before = fetchMock.mock.calls.length;
    await click(target.node);
    await flush();

    expect(getCalls(fetchMock, before).length, "no GET refetch followed the restore").toBeGreaterThan(0);
  });

  it("a restore is NOT offered while an attempt is running -- the server would refuse it with 409", async () => {
    // route.js:818 returns {status:"refused", reason:"in-flight"} for a
    // running row. Offering the control anyway spends a round trip to be told
    // no.
    stubFetch(readyGetResponse({ status: "running" }));
    await render(baseProps());
    await flush();
    await openHistory("aboutYou");

    expect(restoreControls("aboutYou").map((row) => row.name)).toEqual([]);
  });
});

describe("[harness positive control] the same mount, finder and fetch reader work on a control that EXISTS today", () => {
  it("finds and clicks the whole-pack Regenerate button and reads its POST", async () => {
    // GREEN ON HEAD BY DESIGN. Not coverage of N46 -- it is the evidence that
    // every "no control found" above is about the feature.
    const fetchMock = stubFetch(readyGetResponse(), { status: "ready" });
    await render(baseProps());
    await flush();

    expect(document.body.textContent).not.toBe(container.textContent); // the portal tripwire

    // B1 (N50 fix round 2): was `/^regenerate$/i` -- M1 (fix round 1) renamed
    // the whole-pack control's own accessible name to "Regenerate whole
    // pack", which left this harness's own positive control unable to find
    // it (a defect the fix round's own gate run missed by running only
    // app/components/tracking, not app/components).
    const button = allButtons().find((node) => /^regenerate whole pack$/i.test(accessibleName(node)));
    expect(button, "the whole-pack Regenerate control is missing -- this harness is broken, not the feature").toBeTruthy();

    const before = fetchMock.mock.calls.length;
    await click(button);
    await flush();

    const posts = fetchMock.mock.calls
      .slice(before)
      .filter(([url, init]) => url === "/api/interview-prep" && init && init.method === "POST");
    expect(posts).toHaveLength(1);
  });
});
