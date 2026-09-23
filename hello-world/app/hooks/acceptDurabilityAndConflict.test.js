// @vitest-environment jsdom
//
// N35 fix round -- verify.r1.md B4, B5 (client half), M2 and M3.
//
// B5 (client half). `getFacts.test.js` pins the route; this pins that
// `useCompanyResearch#openCompanyResearch` actually CALLS it and seeds
// `acceptedFactsByJob`, and that a 409's own revision/facts/removed are
// adopted so the very next attempt is not doomed to repeat the same
// conflict ("Reload and try again" must actually do something).
//
// M2. `acceptFacts` used to send `facts: selection.facts` -- only the
// CURRENT click's facts -- so a second accept REPLACED the stored set
// instead of adding to it. This pins that two sequential accepts leave BOTH
// facts in what gets sent to the store.
//
// M3. The dialog has no removal UI yet, so `declinedUrls` was always `[]`;
// sent through unchanged that WIPES any existing retracted log on every
// accept (the RPC replaces, never appends). This pins that the CURRENT
// retracted set (as seeded by the GET) is resent unchanged rather than an
// empty array.
//
// B4. An accept that successfully splices the fact into the in-session docx
// bytes showed NO notice at all -- silently implying the styled letter is
// now durably part of the application, when in fact there is still no
// mechanism that persists those bytes past a reload (B4 in verify.r1.md;
// `lib/document/docx.js`'s cover branch hard-codes `docxPath: ""` and is not
// one of this chunk's allowed files, so full persistence is out of scope for
// this round -- see the accept-time notice this pins instead). This pins
// that the candidate is told so AT ACCEPT TIME.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    storage: { from: () => ({ download: async () => ({ data: null, error: { message: "nf" } }) }) },
  }),
}));
vi.mock("@/lib/supabase/documentVersions", () => ({
  fetchDocumentVersions: vi.fn(async () => []),
  pointApplicationAtVersion: vi.fn(async () => true),
}));
vi.mock("@/lib/supabase/persistGeneration", () => ({
  persistGeneratedDocuments: vi.fn(async () => undefined),
}));

import { useDocumentPreview } from "./useDocumentPreview.js";
import { useCompanyResearch } from "./useCompanyResearch.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node." };

function factSelection(over = {}) {
  return {
    facts: [
      {
        id: "art-dublin-lab",
        text: "Acme opened a Dublin telemetry lab in 2026.",
        url: "https://acme.example.com/newsroom/dublin-lab",
        title: "Acme opens Dublin telemetry lab",
        source: "Acme Newsroom",
        placement: "current",
        textOrigin: "template",
      },
    ],
    declinedUrls: [],
    ...over,
  };
}
function factSelection2() {
  return {
    facts: [
      {
        id: "art-berlin-office",
        text: "Acme also opened a Berlin engineering office in 2026.",
        url: "https://acme.example.com/newsroom/berlin-office",
        title: "Acme opens Berlin office",
        source: "Acme Newsroom",
        placement: "current",
        textOrigin: "template",
      },
    ],
    declinedUrls: [],
  };
}

let ENGINE_B64 = "";
let ENGINE_LINES = [];

beforeAll(async () => {
  const cl = await embeddedEngine.tailorCoverLetter({
    jobPosting: "Staff Engineer at Acme. React, Node, telemetry.",
    jobTitle: "Staff Engineer",
    companyName: "Acme",
  });
  ENGINE_B64 = cl.docxB64;
  ENGINE_LINES = cl.resultLines;
});

function entryInSession() {
  return {
    status: "done",
    result: "",
    resultLines: [],
    docxB64: "",
    docxPath: "",
    coverLetterResultLines: [...ENGINE_LINES],
    coverLetterPreviewHtml: undefined,
    coverLetterDocxB64: ENGINE_B64,
    coverVersionId: "ver-1",
  };
}

let api = null;
let research = null;
let currentMap = null;
let container = null;
let root = null;
let fetchCalls = [];
let getResponder = null;
let putResponder = null;

function Probe({ initialMap }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
  currentMap = tailoringMap;
  const updateTailoringJob = (jobId, updater) =>
    setTailoringMap((c) => ({
      ...c,
      [jobId]: typeof updater === "function" ? updater(c[jobId] || {}) : { ...(c[jobId] || {}), ...updater },
    }));
  api = useDocumentPreview({
    tailoringMap,
    setTailoringMap,
    updateTailoringJob,
    resumeFile: null,
    coverLetterFile: null,
    additionalContext: "",
    aggressiveness: 3,
    contextFiles: [],
    downloadDocxFiles: async () => null,
    startBackgroundResearch: () => {},
    setPreviewReloadKey: () => {},
    onDocumentEdited: () => {},
    currentUser: { id: "user-1" },
  });
  research = useCompanyResearch({ tailoringMap, setTailoringMap, setPreviewReloadKey: () => {} });
  return null;
}

async function mountAndOpen(entry) {
  await act(async () => {
    root.render(createElement(Probe, { initialMap: { [JOB_ID]: entry } }));
  });
  await act(async () => {
    api.openResumePreview(JOB, { tab: "cover" });
    research.openCompanyResearch(JOB);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function acceptedFactsCalls(method) {
  return fetchCalls.filter((c) => c.url.includes("/api/accepted-facts") && c.method === method);
}

beforeEach(() => {
  api = null;
  research = null;
  currentMap = null;
  fetchCalls = [];
  getResponder = null;
  putResponder = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const urlStr = String(url);
    fetchCalls.push({ url: urlStr, method, body: init.body });
    if (urlStr.includes("/api/company-research")) {
      return new Response(JSON.stringify({ articles: [], warnings: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (urlStr.includes("/api/accepted-facts")) {
      if (method === "GET") {
        if (getResponder) return getResponder({ url: urlStr, method });
        return new Response(JSON.stringify({ facts: [], removed: [], revision: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (putResponder) return putResponder({ url: urlStr, method, body: init.body });
      return new Response(
        JSON.stringify({ facts: [], removed: [], revision: 1, versionSaved: false, previousFacts: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete globalThis.fetch;
});

// ---------------------------------------------------------------------------
// B5 (client half): opening research seeds acceptedFactsByJob from a GET.
// ---------------------------------------------------------------------------

describe("opening company research seeds the current revision from a GET (B5)", () => {
  it("fires a GET for this job and stores its facts/removed/revision", async () => {
    getResponder = async () =>
      new Response(
        JSON.stringify({ facts: [{ id: "f0", text: "Acme is hiring." }], removed: ["https://old.example.com"], revision: 5 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    await mountAndOpen(entryInSession());
    expect(acceptedFactsCalls("GET").length).toBeGreaterThan(0);
    expect(acceptedFactsCalls("GET")[0].url).toContain(encodeURIComponent(JOB_ID));
    expect(research.acceptedFactsByJob[JOB_ID]?.revision).toBe(5);
    expect(research.acceptedFactsByJob[JOB_ID]?.removed).toEqual(["https://old.example.com"]);
  });

  it("an accept after that seed sends the seeded revision as baseRevision, not null", async () => {
    getResponder = async () =>
      new Response(JSON.stringify({ facts: [], removed: [], revision: 7 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    await mountAndOpen(entryInSession());
    expect(research.acceptedFactsByJob[JOB_ID]?.revision).toBe(7);

    await act(async () => {
      await research.acceptFacts(factSelection());
    });
    const put = acceptedFactsCalls("PUT")[0];
    expect(JSON.parse(put.body).baseRevision).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// B5: a 409's own revision/facts/removed are adopted.
// ---------------------------------------------------------------------------

describe("a 409 conflict adopts the winner's revision/facts/removed (B5)", () => {
  it("stores the conflict response's revision/facts/removed onto acceptedFactsByJob", async () => {
    await mountAndOpen(entryInSession());
    putResponder = async () =>
      new Response(
        JSON.stringify({
          error: "Someone else changed these facts first. Reload and try again.",
          revision: 9,
          facts: [{ id: "winner", text: "The winning fact." }],
          removed: ["https://winner.example.com"],
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      );
    let result;
    await act(async () => {
      result = await research.acceptFacts(factSelection());
    });
    expect(result.ok).toBe(false);
    expect(research.acceptedFactsByJob[JOB_ID]?.revision).toBe(9);
    expect(research.acceptedFactsByJob[JOB_ID]?.facts).toEqual([{ id: "winner", text: "The winning fact." }]);
    expect(research.acceptedFactsByJob[JOB_ID]?.removed).toEqual(["https://winner.example.com"]);
  });
});

// ---------------------------------------------------------------------------
// M2: two sequential accepts merge, they do not replace.
// ---------------------------------------------------------------------------

describe("a second accept does not drop the first accept's facts from the store (M2)", () => {
  it("the second PUT's facts field carries BOTH accepted facts", async () => {
    await mountAndOpen(entryInSession());
    putResponder = async ({ body }) => {
      const parsed = JSON.parse(body);
      return new Response(
        JSON.stringify({ facts: parsed.facts, removed: parsed.declinedUrls || [], revision: (parsed.baseRevision || 0) + 1, versionSaved: false }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    await act(async () => {
      await research.acceptFacts(factSelection());
    });
    await act(async () => {
      await research.acceptFacts(factSelection2());
    });
    const puts = acceptedFactsCalls("PUT");
    expect(puts).toHaveLength(2);
    const secondBody = JSON.parse(puts[1].body);
    const texts = secondBody.facts.map((f) => f.text);
    expect(texts).toContain(factSelection().facts[0].text);
    expect(texts).toContain(factSelection2().facts[0].text);
  });
});

// ---------------------------------------------------------------------------
// M3: the retracted log is resent unchanged, not wiped.
// ---------------------------------------------------------------------------

describe("an accept resends the CURRENT retracted log instead of an empty array (M3)", () => {
  it("declinedUrls in the PUT body equals the log seeded by the GET", async () => {
    getResponder = async () =>
      new Response(JSON.stringify({ facts: [], removed: ["https://declined.example.com/a"], revision: 2 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    await mountAndOpen(entryInSession());
    expect(research.acceptedFactsByJob[JOB_ID]?.removed).toEqual(["https://declined.example.com/a"]);

    await act(async () => {
      await research.acceptFacts(factSelection());
    });
    const put = acceptedFactsCalls("PUT")[0];
    expect(JSON.parse(put.body).declinedUrls).toEqual(["https://declined.example.com/a"]);
  });
});

// ---------------------------------------------------------------------------
// B4: a fresh in-session accept discloses the session-only limit.
// ---------------------------------------------------------------------------

describe("a successful in-session accept discloses that the styled copy is not yet durable (B4)", () => {
  it("acceptNotice is non-empty after a fresh, successful splice", async () => {
    await mountAndOpen(entryInSession());
    let result;
    await act(async () => {
      result = await research.acceptFacts(factSelection());
    });
    expect(result.ok).toBe(true);
    expect(research.companyResearch.acceptNotice).toBeTruthy();
    expect(typeof research.companyResearch.acceptNotice).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// M1, end to end: accepting the SAME selection twice (a re-click on a dialog
// that stays open with the same rows checked) must not duplicate the fact in
// either the live entry's text or its spliced docx bytes.
// lib/acceptedFacts/factInsertion.test.js pins the same property at the
// pure-planner level; this drives it through the real hook and the real
// docx splice so a regression at either seam is caught.
// ---------------------------------------------------------------------------

describe("accepting the identical selection twice does not duplicate the fact (M1, end to end)", () => {
  it("the second accept is a no-op: one occurrence in the text, unchanged bytes, and no second cover version", async () => {
    await mountAndOpen(entryInSession());
    let first;
    await act(async () => {
      first = await research.acceptFacts(factSelection());
    });
    expect(first.ok).toBe(true);
    const afterFirst = currentMap[JOB_ID];
    const firstText = afterFirst.coverLetterResultLines.join("\n");
    const firstBytes = afterFirst.coverLetterDocxB64;
    expect(firstText.split(factSelection().facts[0].text).length - 1).toBe(1);

    let second;
    await act(async () => {
      second = await research.acceptFacts(factSelection());
    });
    expect(second.ok).toBe(true);
    const afterSecond = currentMap[JOB_ID];
    const secondText = afterSecond.coverLetterResultLines.join("\n");
    expect(secondText.split(factSelection().facts[0].text).length - 1).toBe(1);
    // Nothing changed: same text, same bytes -- a no-op accept, not a
    // second (silently identical) splice.
    expect(secondText).toBe(firstText);
    expect(afterSecond.coverLetterDocxB64).toBe(firstBytes);
    // Only ONE PUT actually carried a coverVersion -- the second accept's
    // plan had zero edits, so `coverChanged` was false.
    const puts = acceptedFactsCalls("PUT");
    expect(puts).toHaveLength(2);
    expect(JSON.parse(puts[0].body).coverVersion).not.toBeNull();
    expect(JSON.parse(puts[1].body).coverVersion).toBeNull();
  });
});
