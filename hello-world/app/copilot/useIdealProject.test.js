// @vitest-environment jsdom
//
// N125 L10 (the useIdealProject hook, deferred from the 4b pass until step 7
// pinned its interface): the single display source for the worked example
// beside an answer. Mounts the REAL hook, and the REAL client module under it,
// against a stubbed `fetch` — the only seam — so what is asserted is what
// actually leaves the browser and what the hook exposes, not what a mocked
// client was told.
//
// What this file pins that the render tests cannot:
//  - READY is asked for first and exposed the moment it lands; TAILORED is a
//    SECOND request, issued only after READY, and never blocks it;
//  - the three TAILORED outcomes (pending / arrived / failed) and that a
//    failure NEVER clears READY and is never an error;
//  - the embedded engine is suppressed AT THE DISPATCH: exactly one request is
//    ever made and it is not a `tailored:true` one, and the status never
//    leaves "idle" — so no "Tailoring…" cue can flash for a result that can
//    never arrive;
//  - nothing is asked when there is no posting or no question;
//  - a late response for a PREVIOUS question never lands on the current one.
//
// THE TRAP: "no tailored call was made" is satisfied by a hook that makes no
// calls at all. Every absence assertion below is paired with the READY
// request having been made and exposed, so a gutted hook fails.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { useIdealProject } from "./useIdealProject.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const QUESTION = "Tell me about a project you owned.";

// The aid shape the endpoint returns. The hook never inspects it, so only a
// distinguishing title matters here.
const aid = (title) => ({ shape: "Education", summary: "S", metrics: ["m"], project: { title } });

let container;
let root;
let latest;
let requests;
const originalFetch = globalThis.fetch;

function Probe(props) {
  latest = useIdealProject(props);
  return null;
}

// Every request the stub sees, in order, each left PENDING until the test
// settles it — which is how the READY-before-TAILORED ordering and the
// non-blocking property are observable rather than assumed. An abort rejects
// the request, exactly as a real fetch does.
function installFetch() {
  requests = [];
  globalThis.fetch = vi.fn(
    (url, init) =>
      new Promise((resolve, reject) => {
        const request = {
          url,
          body: JSON.parse(init.body),
          settled: false,
          respond: (payload, ok = true) => {
            request.settled = true;
            resolve({ ok, json: async () => payload });
          },
          fail: (error = new Error("network gone")) => {
            request.settled = true;
            reject(error);
          },
        };
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        requests.push(request);
      }),
  );
}

beforeEach(() => {
  latest = null;
  installFetch();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  globalThis.fetch = originalFetch;
});

async function flush(times = 6) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {});
  }
}

async function render(props) {
  await act(async () => {
    root.render(createElement(Probe, props));
  });
  await flush();
}

// Settles one stubbed request inside act, then lets the hook's continuation
// (res.json(), the state write) run.
async function settle(request, payload, ok = true) {
  await act(async () => {
    request.respond(payload, ok);
  });
  await flush();
}

const readyPayload = (title) => ({ tier: "ready", source: "model", idealProject: aid(title) });
const tailoredPayload = (title) => ({ tier: "tailored", source: "model", idealProject: aid(title) });

describe("useIdealProject — READY first, TAILORED added after it (N125 L10)", () => {
  it("asks for READY first, with no tailored flag, and exposes it the moment it lands", async () => {
    await render({ applicationId: "app-1", question: QUESTION, engine: "gemini" });

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("/api/copilot/ideal-project");
    expect(requests[0].body).toEqual({ applicationId: "app-1", question: QUESTION, engine: "gemini" });
    expect(requests[0].body).not.toHaveProperty("tailored");
    // Nothing is exposed until the request lands, and the status is idle.
    expect(latest.ready).toBeNull();
    expect(latest.tailoredStatus).toBe("idle");

    await settle(requests[0], readyPayload("READY"));
    expect(latest.ready.project.title).toBe("READY");
  });

  it("asks for TAILORED only AFTER READY, as its own request, and shows 'loading' meanwhile", async () => {
    await render({ applicationId: "app-1", question: QUESTION, engine: "gemini" });
    // READY still pending: TAILORED has not been requested at all.
    expect(requests).toHaveLength(1);

    await settle(requests[0], readyPayload("READY"));
    expect(requests).toHaveLength(2);
    expect(requests[1].body).toEqual({ applicationId: "app-1", question: QUESTION, engine: "gemini", tailored: true });
    // READY is on screen while TAILORED is still in flight: non-blocking.
    expect(latest.ready.project.title).toBe("READY");
    expect(latest.tailored).toBeNull();
    expect(latest.tailoredStatus).toBe("loading");
  });

  it("ADDS the tailored example when it lands and leaves READY exactly as it was", async () => {
    await render({ applicationId: "app-1", question: QUESTION, engine: "gemini" });
    await settle(requests[0], readyPayload("READY"));
    const readyBefore = latest.ready;

    await settle(requests[1], tailoredPayload("TAILORED"));
    expect(latest.tailored.project.title).toBe("TAILORED");
    expect(latest.tailoredStatus).toBe("done");
    expect(latest.ready).toBe(readyBefore);
    expect(requests).toHaveLength(2);
  });
});

describe("useIdealProject — a failed TAILORED is nothing, never an error (N125 L10/L12)", () => {
  it.each([
    ["a non-2xx response", (r) => r.respond({ error: "boom" }, false)],
    ["an empty idealProject (the server's timeout / failure shape)", (r) => r.respond({ tier: "tailored", source: null, idealProject: null })],
    ["a rejected request", (r) => r.fail()],
  ])("%s -> 'failed', tailored null, READY intact", async (_label, fail) => {
    await render({ applicationId: "app-1", question: QUESTION, engine: "gemini" });
    await settle(requests[0], readyPayload("READY"));
    expect(latest.tailoredStatus).toBe("loading");

    await act(async () => {
      fail(requests[1]);
    });
    await flush();

    expect(latest.tailoredStatus).toBe("failed");
    expect(latest.tailored).toBeNull();
    expect(latest.ready.project.title).toBe("READY");
  });

  it("survives READY itself failing: nothing exposed, no throw, TAILORED still gets its try", async () => {
    await render({ applicationId: "app-1", question: QUESTION, engine: "gemini" });
    await act(async () => {
      requests[0].fail();
    });
    await flush();

    expect(latest.ready).toBeNull();
    expect(requests).toHaveLength(2);
    expect(requests[1].body.tailored).toBe(true);

    await settle(requests[1], tailoredPayload("TAILORED"));
    expect(latest.ready).toBeNull();
    expect(latest.tailored.project.title).toBe("TAILORED");
  });
});

describe("useIdealProject — the embedded engine is suppressed at the dispatch (N125 L10)", () => {
  it("makes exactly ONE request, never a tailored one, and never leaves 'idle'", async () => {
    await render({ applicationId: "app-1", question: QUESTION, engine: "embedded" });
    // Positive control first: READY WAS asked for, and is exposed — a hook
    // that did nothing at all would pass every absence assertion below.
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toEqual({ applicationId: "app-1", question: QUESTION, engine: "embedded" });
    expect(latest.tailoredStatus).toBe("idle");

    await settle(requests[0], { tier: "ready", source: "fallback", idealProject: aid("DETERMINISTIC") });
    expect(latest.ready.project.title).toBe("DETERMINISTIC");

    // No "loading" flash, no second request, no tailored example — ever.
    expect(latest.tailoredStatus).toBe("idle");
    expect(requests).toHaveLength(1);
    expect(requests.some((r) => r.body.tailored === true)).toBe(false);
    expect(latest.tailored).toBeNull();
  });
});

// N125 fresh-verify F2. The client cannot compute wantsEmbedded (it needs the
// server's RESUME_ENGINE and key), so the READY response carries the server's
// own verdict as `tailoredAvailable`, and the hook gates the TAILORED dispatch
// AND the "Tailoring to this question..." cue on it. A server-forced embedded
// deployment (RESUME_ENGINE=embedded, or no key) with the client engine still
// reading "gemini" must therefore make no TAILORED request and flash no cue.
describe("useIdealProject — the SERVER's wantsEmbedded verdict gates TAILORED (N125 F2)", () => {
  it("tailoredAvailable:false with a non-embedded client engine: no TAILORED request, no 'loading' cue, READY still shows", async () => {
    await render({ applicationId: "app-1", question: QUESTION, engine: "gemini" });
    // Positive control: READY WAS asked for, and the client engine is not
    // "embedded" — so the only thing that can suppress TAILORED below is the
    // server's flag.
    expect(requests).toHaveLength(1);
    expect(requests[0].body.engine).toBe("gemini");

    await settle(requests[0], { ...readyPayload("READY"), source: "fallback", tailoredAvailable: false });

    expect(latest.ready.project.title).toBe("READY");
    expect(latest.tailoredStatus).toBe("idle");
    expect(latest.tailored).toBeNull();
    expect(requests).toHaveLength(1);
    expect(requests.some((r) => r.body.tailored === true)).toBe(false);
  });

  it("tailoredAvailable:true still asks for TAILORED (the gate is not simply 'never')", async () => {
    await render({ applicationId: "app-1", question: QUESTION, engine: "gemini" });
    await settle(requests[0], { ...readyPayload("READY"), tailoredAvailable: true });

    expect(requests).toHaveLength(2);
    expect(requests[1].body.tailored).toBe(true);
    expect(latest.tailoredStatus).toBe("loading");
  });

  it("the user-picked embedded engine stays suppressed whatever the server flag says", async () => {
    await render({ applicationId: "app-1", question: QUESTION, engine: "embedded" });
    await settle(requests[0], { ...readyPayload("READY"), tailoredAvailable: true });

    expect(latest.ready.project.title).toBe("READY");
    expect(latest.tailoredStatus).toBe("idle");
    expect(requests).toHaveLength(1);
  });
});

describe("useIdealProject — nothing is asked when there is nothing to ask about (N125 L10)", () => {
  it.each([
    ["no application selected", { applicationId: "", question: QUESTION }],
    ["no application id at all", { question: QUESTION }],
    ["a blank question", { applicationId: "app-1", question: "   " }],
    ["no question at all", { applicationId: "app-1" }],
  ])("%s: no request, nothing exposed, idle", async (_label, props) => {
    await render({ ...props, engine: "gemini" });
    expect(requests).toHaveLength(0);
    expect(latest).toEqual({ ready: null, tailored: null, tailoredStatus: "idle" });
  });

  it("a READY that answers OK with no example (no posting) does not go on to ask for TAILORED", async () => {
    await render({ applicationId: "app-1", question: QUESTION, engine: "gemini" });
    await settle(requests[0], { tier: "ready", source: "fallback", idealProject: null });

    expect(requests).toHaveLength(1);
    expect(latest.ready).toBeNull();
    expect(latest.tailoredStatus).toBe("idle");
  });
});

describe("useIdealProject — a late response never lands on a different question (N125 L10)", () => {
  it("drops the previous question's READY when it resolves after the new question started", async () => {
    await render({ applicationId: "app-1", question: "First question here.", engine: "gemini" });
    const firstReady = requests[0];

    await render({ applicationId: "app-1", question: "Second question here.", engine: "gemini" });
    // The first request was superseded (aborted); the second is the live one.
    const secondReady = requests[1];
    expect(secondReady.body.question).toBe("Second question here.");

    await settle(secondReady, readyPayload("SECOND READY"));
    expect(latest.ready.project.title).toBe("SECOND READY");

    // The first question's response limps in late: it must write nothing.
    await act(async () => {
      if (!firstReady.settled) firstReady.respond(readyPayload("FIRST READY"));
    });
    await flush();
    expect(latest.ready.project.title).toBe("SECOND READY");
  });

  it("never shows the previous question's example for the new question while it loads", async () => {
    await render({ applicationId: "app-1", question: "First question here.", engine: "gemini" });
    await settle(requests[0], readyPayload("FIRST READY"));
    expect(latest.ready.project.title).toBe("FIRST READY");

    await render({ applicationId: "app-1", question: "Second question here.", engine: "gemini" });
    // The new question's READY is still pending: the old example is gone, not
    // left standing under the wrong question.
    expect(latest.ready).toBeNull();
    expect(latest.tailored).toBeNull();
    expect(latest.tailoredStatus).toBe("idle");
  });
});
