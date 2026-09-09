// @vitest-environment jsdom
//
// AC-M2, AC-T10, AC-T11, AC-T7 -- the context, the single read, and the ruling
// AGAINST polling.
//
// The polling ruling is the one worth stating as a test rather than a comment.
// This repo CAN poll (useDriveDocuments.js does, for an OAuth popup the user is
// staring at) and it is the wrong shape here: a 3-second poll during a live
// interview is network traffic, re-renders and a moving panel, in exchange for
// watching "61 of 120" become "73 of 120" -- which no candidate needs
// mid-answer. Written as an executable assertion so an implementer does not add
// it back reflexively.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

import {
  GlossaryProvider,
  GlossaryScope,
  useGlossaryIndex,
  useGlossaryMarks,
  useGlossaryPanel,
} from "./GlossaryProvider.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const TERMS = [
  {
    term: "covering index",
    kind: "explicit",
    evidence: "You will tune covering indexes.",
    definition: "An index carrying every column a query needs, answered without visiting the table.",
    provenance: "recalled",
  },
];

function Probe({ report }) {
  const index = useGlossaryIndex();
  const marksFor = useGlossaryMarks();
  const panel = useGlossaryPanel({ now: Date.parse("2026-09-09T12:00:00.000Z") });
  report({ size: index.size, marks: marksFor("The covering index fixed it.", null), panel });
  return null;
}

async function mount(element) {
  await act(async () => root.render(element));
}

describe("AC-M2 -- the default is a FROZEN EMPTY index, and nothing throws without a provider", () => {
  it("yields zero terms, zero marks and the no-row panel line", async () => {
    let seen = null;
    await mount(createElement(Probe, { report: (v) => { seen = v; } }));
    expect(seen.size).toBe(0);
    expect(seen.marks).toEqual([]);
    expect(seen.panel.key).toBe("none");
  });

  it("a populated scope marks, so the empty default is not the only path", async () => {
    let seen = null;
    await mount(createElement(GlossaryScope, { terms: TERMS }, createElement(Probe, { report: (v) => { seen = v; } })));
    expect(seen.size).toBe(1);
    expect(seen.marks).toHaveLength(1);
  });

  it("a scope carrying a row exposes that row's panel line", async () => {
    let seen = null;
    await mount(
      createElement(
        GlossaryScope,
        {
          terms: TERMS,
          row: { status: "ready", terms: TERMS, researched_count: 1, recalled_count: 0, research_cursor: 1, research_total: 1, researched_at: "2026-09-08T00:00:00.000Z" },
        },
        createElement(Probe, { report: (v) => { seen = v; } }),
      ),
    );
    expect(seen.panel.key).toBe("ready");
  });
});

describe("AC-T10 / AC-T11 -- one read per posting, and no polling", () => {
  function stubFetch(body) {
    const calls = [];
    vi.stubGlobal("fetch", (url) => {
      calls.push(String(url));
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    });
    return calls;
  }

  it("fetches ONCE when a posting is selected, and never again on re-render", async () => {
    const calls = stubFetch({ glossary: { status: "partial", terms: TERMS, researched_count: 0, recalled_count: 1, research_cursor: 0, research_total: 1 } });
    let seen = null;
    const tree = () =>
      createElement(GlossaryProvider, { applicationId: "app-1" }, createElement(Probe, { report: (v) => { seen = v; } }));
    await mount(tree());
    await mount(tree());
    await mount(tree());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe("/api/copilot/glossary?applicationId=app-1");
    expect(seen.size).toBe(1);
  });

  it("sets NO interval and NO timeout: a row still being researched is not polled", async () => {
    vi.useFakeTimers();
    const setInterval = vi.spyOn(globalThis, "setInterval");
    const calls = stubFetch({ glossary: { status: "partial", terms: TERMS, research_cursor: 0, research_total: 10 } });
    await mount(createElement(GlossaryProvider, { applicationId: "app-1" }, createElement("i", null)));
    await act(async () => vi.advanceTimersByTime(120_000));
    expect(setInterval).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    vi.useRealTimers();
  });

  it("re-reads when the posting CHANGES, which is what makes 'once per posting' a real bound", async () => {
    const calls = stubFetch({ glossary: { terms: TERMS } });
    await mount(createElement(GlossaryProvider, { applicationId: "app-1" }, createElement("i", null)));
    await mount(createElement(GlossaryProvider, { applicationId: "app-2" }, createElement("i", null)));
    expect(calls).toEqual([
      "/api/copilot/glossary?applicationId=app-1",
      "/api/copilot/glossary?applicationId=app-2",
    ]);
  });

  it("falls back to positionId, and reads nothing at all with neither", async () => {
    const calls = stubFetch({ glossary: { terms: TERMS } });
    await mount(createElement(GlossaryProvider, { positionId: "pos-9" }, createElement("i", null)));
    expect(calls).toEqual(["/api/copilot/glossary?positionId=pos-9"]);
    await mount(createElement(GlossaryProvider, {}, createElement("i", null)));
    expect(calls).toHaveLength(1);
  });
});

describe("AC-T7 -- a failed read leaves the answer exactly as it would have been", () => {
  it("a rejected fetch yields an empty index rather than an error", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    let seen = null;
    await mount(
      createElement(GlossaryProvider, { applicationId: "app-1" }, createElement(Probe, { report: (v) => { seen = v; } })),
    );
    expect(seen.size).toBe(0);
    expect(seen.marks).toEqual([]);
  });

  it("a non-ok response does the same", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve({ ok: false, json: () => Promise.reject(new Error("no")) }));
    let seen = null;
    await mount(
      createElement(GlossaryProvider, { applicationId: "app-1" }, createElement(Probe, { report: (v) => { seen = v; } })),
    );
    expect(seen.size).toBe(0);
  });

  it("a row whose terms are missing or malformed marks nothing and throws nothing", async () => {
    for (const glossary of [null, {}, { terms: null }, { terms: "x" }, { terms: [null, 7] }]) {
      vi.stubGlobal("fetch", () => Promise.resolve({ ok: true, json: () => Promise.resolve({ glossary }) }));
      let seen = null;
      await mount(
        createElement(GlossaryProvider, { applicationId: "app-1" }, createElement(Probe, { report: (v) => { seen = v; } })),
      );
      expect({ glossary, size: seen.size }).toEqual({ glossary, size: 0 });
    }
  });
});

// ---------------------------------------------------------------------------
// AC-T5 -- THE LAZY BACKSTOP
// ---------------------------------------------------------------------------
// The four apply seams only reach postings applied to from now on. Every job
// already in the tracker -- the ones the owner asked to backfill -- arrives
// through here instead: opening the posting is what enqueues it.
//
// These are SEAM cases, and that is the point. glossaryTrigger.test.js already
// proves the predicate decides correctly; only these prove the provider calls
// it. That distinction has cost this feature twice already -- the ask-AI box
// shipped sending an empty application id, and this very provider shipped
// mounted nowhere -- each with a thorough suite one level too deep to see it.
describe("AC-T5 -- opening a posting backfills it, and only when that can help", () => {
  function stubFetch(body, { ok = true } = {}) {
    const calls = [];
    vi.stubGlobal("fetch", (url, init) => {
      calls.push({ url: String(url), method: init?.method || "GET", body: init?.body });
      return Promise.resolve({ ok, json: () => Promise.resolve(body) });
    });
    return calls;
  }

  const posts = (calls) => calls.filter((c) => c.method === "POST");

  it("enqueues a posting that has NO row -- the backfill the owner asked for", async () => {
    const calls = stubFetch({ glossary: null });
    await mount(createElement(GlossaryProvider, { applicationId: "bf-none" }, createElement("i", null)));
    expect(posts(calls)).toHaveLength(1);
    expect(posts(calls)[0].url).toBe("/api/copilot/glossary");
    expect(JSON.parse(posts(calls)[0].body)).toEqual({ applicationId: "bf-none" });
  });

  it("sends the positionId key when that is what it was given", async () => {
    const calls = stubFetch({ glossary: null });
    await mount(createElement(GlossaryProvider, { positionId: "bf-pos" }, createElement("i", null)));
    expect(JSON.parse(posts(calls)[0].body)).toEqual({ positionId: "bf-pos" });
  });

  it("enqueues a finished row stuck below the research floor", async () => {
    const calls = stubFetch({
      glossary: { status: "partial", terms: TERMS, research_cursor: 8, research_total: 8, researched_count: 1, recalled_count: 7 },
    });
    await mount(createElement(GlossaryProvider, { applicationId: "bf-low" }, createElement("i", null)));
    expect(posts(calls)).toHaveLength(1);
  });

  it("does NOT enqueue a row the worker is still researching", async () => {
    const calls = stubFetch({
      glossary: { status: "partial", terms: TERMS, research_cursor: 2, research_total: 9 },
    });
    await mount(createElement(GlossaryProvider, { applicationId: "bf-inflight" }, createElement("i", null)));
    expect(posts(calls), "re-enqueuing would roll the term list out from under the cursor").toHaveLength(0);
  });

  it("does NOT enqueue a ready row", async () => {
    const calls = stubFetch({
      glossary: { status: "ready", terms: TERMS, research_cursor: 4, research_total: 4, researched_count: 4, recalled_count: 0 },
    });
    await mount(createElement(GlossaryProvider, { applicationId: "bf-ready" }, createElement("i", null)));
    expect(posts(calls)).toHaveLength(0);
  });

  it("A FAILED READ IS NOT A CACHE MISS: a non-ok GET enqueues nothing", async () => {
    // The trap this seam was built around. Folding !ok to `null` -- which is
    // what the code did before the backstop existed -- makes a 500 on the read
    // indistinguishable from "never researched", and every such load would then
    // buy a fresh generation for a posting that already had one.
    const calls = stubFetch({ glossary: null }, { ok: false });
    await mount(createElement(GlossaryProvider, { applicationId: "bf-500" }, createElement("i", null)));
    expect(posts(calls)).toHaveLength(0);
  });

  it("a rejected GET enqueues nothing either", async () => {
    const calls = [];
    vi.stubGlobal("fetch", (url, init) => {
      calls.push({ url: String(url), method: init?.method || "GET" });
      return Promise.reject(new Error("offline"));
    });
    await mount(createElement(GlossaryProvider, { applicationId: "bf-offline" }, createElement("i", null)));
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("enqueues at most once, however many times the tree re-renders", async () => {
    const calls = stubFetch({ glossary: null });
    const tree = () => createElement(GlossaryProvider, { applicationId: "bf-once" }, createElement("i", null));
    await mount(tree());
    await mount(tree());
    await mount(tree());
    expect(posts(calls)).toHaveLength(1);
  });

  it("[control] the POST filter can see a POST at all", async () => {
    // Every negative case above passes trivially if `posts()` never matches.
    const calls = stubFetch({ glossary: null });
    await mount(createElement(GlossaryProvider, { applicationId: "bf-control" }, createElement("i", null)));
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST"]);
  });
});
