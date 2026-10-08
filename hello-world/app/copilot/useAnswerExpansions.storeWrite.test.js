// @vitest-environment jsdom
//
// A STORE WRITE MUST RE-RENDER THE PANEL, NOT MERELY CHANGE WHAT getExpansion
// RETURNS.
//
// THE DEFECT THIS PINS. useAnswerExpansions() subscribes to the store, so the
// scope re-renders on every write, but it returns a memoised api whose
// dependencies used to be only `resolve` and `open`. A request settling writes
// a record without touching either, so the api kept its identity, the context
// value did not change, and every consumer (the panel, rendered as a CHILD
// element the scope does not recreate) bailed out. The panel stayed on
// "Finding more detail" with a settled record sitting in the store. Clicking
// the control a second time "fixed" it only because a click changes `open`.
//
// WHY AnswerLines.expansion.test.js DID NOT SEE IT. Its end-to-end case clicks
// open, collapses and re-opens before it reads the DOM, and the re-open changes
// `open`, which re-renders the panel for an unrelated reason. Every other case
// there injects a stand-in api and never exercises the store at all. This file
// therefore reads the DOM after the write and does NOTHING else first: no
// second click, no rerender call, no props change.
//
// THE INSTRUMENT HAS TO BE HELD OPEN BY THE TEST. The fetch is gated on a
// promise the test releases inside its own act(), so "loading" is observed
// before the write and the write is the only thing that happens between the
// two reads.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, createContext, useContext, useMemo, useSyncExternalStore, act } from "react";
import { createRoot } from "react-dom/client";

import AnswerLines from "./AnswerLines.js";
import { ExpansionScope, useExpansionApi } from "./useAnswerExpansions.js";
import { getSnapshot, resetExpansionStore, subscribe } from "@/lib/copilot/expansionStore.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LINES = [
  {
    label: "",
    cue: "",
    point: "I ran the postmortem with the payments group the next morning.",
    pageSource: null,
    emphasis: null,
    sourceIndex: 0,
  },
];

const QUESTIONS = [
  {
    id: 1,
    question: "Tell me about a failure.",
    points: ["I ran the postmortem with the payments group the next morning."],
    status: "done",
  },
];

const REQUEST = { applicationId: "app-1", profile: "", interviewType: "behavioral", codeLanguage: "auto", engine: "embedded" };

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  resetExpansionStore();
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function render(element) {
  await act(async () => {
    root.render(element);
  });
  return container;
}

// A fetch whose response the test releases. `respond` is the final response
// object; nothing resolves until `release()` runs.
function gatedFetch(respond) {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const fetchMock = vi.fn(async () => {
    await gate;
    return respond;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, release: () => release() };
}

const okResponse = (body) => ({ ok: true, status: 200, json: async () => body });

function scoped(children) {
  return createElement(ExpansionScope, { questions: QUESTIONS, request: REQUEST }, children);
}

// A bare consumer that records every api it is rendered with. It is a CHILD
// element created once by the test, exactly as the real panel is a child the
// scope never recreates, so the only thing that can wake it is a changed
// context value.
function makeProbe() {
  const seen = [];
  function Probe() {
    const api = useExpansionApi();
    seen.push(api);
    const status = api?.get(LINES[0])?.status ?? "none";
    return createElement(
      "div",
      null,
      createElement("output", { "data-status": "" }, status),
      createElement("button", { type: "button", "data-open": "", onClick: () => api.toggle(LINES[0]) }, "open"),
    );
  }
  return { seen, element: createElement(Probe) };
}

describe("a store write re-renders the consumers of the real scope", () => {
  it("shows the fetched sub-bullets in the real panel with no interaction after the write", async () => {
    const { fetchMock, release } = gatedFetch(
      okResponse({
        subBullets: [{ text: "I reconciled every settlement by hand.", pageSource: null, source: null }],
        caption: "Found on this server with no AI provider in your Ledger page.",
        empty: false,
      }),
    );
    await render(scoped(createElement(AnswerLines, { lines: LINES })));

    await act(async () => container.querySelector("li button").click());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The loading state is observed FIRST, so the later read is a transition
    // and not a coincidence of timing.
    expect(container.querySelector("li").textContent).toContain("Finding more detail");
    expect(container.querySelector("li").textContent).not.toContain("I reconciled every settlement by hand.");

    await act(async () => release());

    const li = container.querySelector("li");
    expect(li.textContent).toContain("I reconciled every settlement by hand.");
    expect(li.textContent).not.toContain("Finding more detail");
    expect(li.querySelector(":scope > ul > li")).not.toBeNull();
  });

  it.each([
    ["an honest empty", okResponse({ subBullets: [], caption: "", empty: true }), "Nothing more we can back up"],
    ["a failure", { ok: false, status: 500, json: async () => ({}) }, "Could not get more detail"],
  ])("replaces loading when the request settles as %s", async (_name, response, expected) => {
    const { release } = gatedFetch(response);
    await render(scoped(createElement(AnswerLines, { lines: LINES })));
    await act(async () => container.querySelector("li button").click());
    expect(container.querySelector("li").textContent).toContain("Finding more detail");

    await act(async () => release());

    expect(container.querySelector("li").textContent).toContain(expected);
    expect(container.querySelector("li").textContent).not.toContain("Finding more detail");
  });

  it("gives a bare context consumer a new api, and a fresh read, on the write", async () => {
    const { release } = gatedFetch(okResponse({ subBullets: [{ text: "x", pageSource: null, source: null }], caption: "", empty: false }));
    const probe = makeProbe();
    await render(scoped(probe.element));
    expect(container.querySelector("[data-status]").textContent).toBe("idle");

    await act(async () => container.querySelector("[data-open]").click());
    expect(container.querySelector("[data-status]").textContent).toBe("loading");
    const apiWhileLoading = probe.seen[probe.seen.length - 1];

    await act(async () => release());

    expect(container.querySelector("[data-status]").textContent).toBe("done");
    expect(probe.seen[probe.seen.length - 1]).not.toBe(apiWhileLoading);
  });

  it("does not loop: once settled, the consumer stops rendering until something else changes", async () => {
    // getSnapshot is stable BETWEEN writes, so the extra dependency cannot cause
    // a render loop; a loop would throw "Maximum update depth exceeded" from the
    // act() above, and this additionally pins that the count goes quiet.
    const { release } = gatedFetch(okResponse({ subBullets: [{ text: "x", pageSource: null, source: null }], caption: "", empty: false }));
    const probe = makeProbe();
    await render(scoped(probe.element));
    await act(async () => container.querySelector("[data-open]").click());
    await act(async () => release());

    const settledRenders = probe.seen.length;
    await act(async () => {});
    await act(async () => {});
    expect(probe.seen).toHaveLength(settledRenders);
    expect(settledRenders).toBeLessThan(10);
  });
});

// [control] The shape of the defect, rebuilt from the store's public exports:
// subscribe, discard the snapshot, memoise an api on dependencies a write does
// not change. If the probe-and-release technique above could not tell this from
// the fixed scope, the cases above would prove nothing. The real hook is
// covered by the cases above; this only shows the instrument has power.
describe("[control] the technique detects a scope that discards the snapshot", () => {
  it("leaves a consumer on 'idle' after a write when the api memo ignores the snapshot", async () => {
    const Ctx = createContext(null);
    function DiscardingScope({ children }) {
      useSyncExternalStore(subscribe, getSnapshot, getSnapshot); // result discarded, as in the defect
      const api = useMemo(() => ({ read: () => getSnapshot().version }), []);
      return createElement(Ctx.Provider, { value: api }, children);
    }
    function Reader() {
      const api = useContext(Ctx);
      return createElement("output", { "data-version": "" }, String(api.read()));
    }
    await render(createElement(DiscardingScope, null, createElement(Reader)));
    const before = container.querySelector("[data-version]").textContent;

    await act(async () => {
      resetExpansionStore(); // any store write notifies subscribers
    });

    // The scope re-rendered (it is subscribed) but the consumer did not, so it
    // still shows the version it rendered with, while the store has moved on.
    expect(getSnapshot().version).not.toBe(Number(before));
    expect(container.querySelector("[data-version]").textContent).toBe(before);
  });
});
