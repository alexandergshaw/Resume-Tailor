// @vitest-environment jsdom
//
// Live mode's two hops to the code language: the request body and the answer
// cache key. Harness copied from `app/copilot/useDraftAnswer.interviewType.test.js`
// next door, which is chunk A's version of this same file.
//
// Written BEFORE the implementation exists (step 4b): the whole file fails on
// the missing `./useCodeLanguage.js` module until wave 2 lands, and then on
// the unwired hook until wave 3 does.
//
// AC-C26'S FALSIFIABILITY CLAUSE IS THE WHOLE POINT OF THE FIRST BLOCK, and it
// is stated in the criterion rather than left to be discovered: **a test that
// merely asserts the request body carries the selected language PASSES AGAINST
// A REF IMPLEMENTATION**, because a ref mirrored during render is correct one
// tick later and any test that awaits anything before asserting gives it that
// tick for free. The only test that distinguishes the two changes the language
// and starts a draft IN ONE SYNCHRONOUS TURN, reading the outbound body BEFORE
// any flush.
//
// The mechanism is React semantics, not a timing accident: the store notifies
// SYNCHRONOUSLY inside the click, `useSyncExternalStore`'s subscribe callback
// only SCHEDULES a render, and `useEffect` is passive and commits after paint.
// It holds under every flush mode, `flushSync` included. (And a ref read for
// render output fails this repo's gate outright — `react-hooks/refs` is at
// ERROR level.)

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/copilot/answerClient", () => ({
  draftAnswer: vi.fn(),
  draftAnswerStreaming: vi.fn(),
}));

// A SPY that delegates to the real implementation, not a stub. Asserting the
// grounding key's observable behaviour cannot catch a FORKED PIPELINE: a
// `runDraft` that folds the fields by hand at its own call site produces an
// identical key today and silently stops matching the moment
// `answerGrounding.js` grows another field. `sameGrounding` then returns false
// forever, and every repeated question costs a second billed call with no
// error and no visible symptom — "silently doubling the cost of every repeated
// question", in that module's own words.
vi.mock("@/lib/copilot/answerGrounding", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, groundingFor: vi.fn(actual.groundingFor) };
});

import { useDraftAnswer } from "./useDraftAnswer.js";
import { setCodeLanguage, __resetCodeLanguageForTests } from "./useCodeLanguage.js";
import { setInterviewType, __resetInterviewTypeForTests } from "./useInterviewType.js";
import { draftAnswerStreaming } from "@/lib/copilot/answerClient";
import { groundingFor } from "@/lib/copilot/answerGrounding";

// Deliberately NOT `fileURLToPath(new URL(rel, import.meta.url))` — under
// `@vitest-environment jsdom` the global `URL` is jsdom's own class and
// `fileURLToPath` rejects an instance of it with "must be of scheme file".
const HERE = dirname(fileURLToPath(import.meta.url));
const readSource = (rel) => readFileSync(join(HERE, rel), "utf8");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const QUESTION = "Implement a cache that evicts the least recently used entry.";

function frame(label) {
  return {
    points: [`Point from ${label}.`],
    cues: [label],
    buzzwords: [],
    resumeAnchor: null,
    idealProject: null,
    pageSources: [],
    type: "technical",
  };
}

const FRAME_A = frame("draft A");

function seedQuestion(id, question) {
  return {
    id,
    question,
    at: Date.now(),
    status: "idle",
    points: null,
    cues: [],
    buzzwords: [],
    anchor: null,
    idealProject: null,
    pageSources: [],
    type: null,
    error: "",
  };
}

// `answerCacheRef`/`draftGenRef` are PROPS of `useDraftAnswer`, not state it
// owns, so they are plain `{ current }` holders driven directly — this repo's
// `react-hooks/refs` rule is at ERROR level and rejects handing a `useRef`
// result out of a component during render, which a probe exposing real refs
// would have to do.
function Probe({ onState, answerCacheRef, draftGenRef }) {
  const [questions, setQuestions] = useState([]);
  const runDraft = useDraftAnswer({
    profile: "Senior engineer, dispatch and logistics.",
    posting: null,
    answerCacheRef,
    draftGenRef,
    buildContext: () => "",
    setQuestions,
    logEvent: () => {},
  });
  onState({ questions, setQuestions, runDraft });
  return null;
}

const mounted = [];

function mountProbe() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const state = {};
  const answerCacheRef = { current: new Map() };
  const draftGenRef = { current: 0 };
  mounted.push({ root, container });
  act(() => {
    root.render(
      createElement(Probe, {
        answerCacheRef,
        draftGenRef,
        onState: (s) => Object.assign(state, s),
      }),
    );
  });
  return { state, answerCacheRef, draftGenRef };
}

const entryOf = (state, id) => state.questions.find((q) => q.id === id);

beforeEach(() => {
  // `vi.restoreAllMocks()` does NOT clear a `vi.fn()` created in a `vi.mock`
  // factory, and this repo sets neither `clearMocks` nor `restoreMocks`.
  draftAnswerStreaming.mockReset();
  draftAnswerStreaming.mockResolvedValue(FRAME_A);
  // `mockClear`, NOT `mockReset`: a delegating spy loses its implementation to
  // `mockReset`.
  groundingFor.mockClear();
  window.localStorage.clear();
  __resetCodeLanguageForTests();
  __resetInterviewTypeForTests();
});

afterEach(() => {
  while (mounted.length) {
    const m = mounted.pop();
    act(() => m.root.unmount());
    m.container.remove();
  }
  vi.unstubAllGlobals();
  window.localStorage.clear();
  __resetCodeLanguageForTests();
  __resetInterviewTypeForTests();
});

// A streaming `Response` good enough for the real `draftAnswerStreaming`:
// `ok`, and a `body.getReader()` yielding one NDJSON chunk ending in a
// terminal `done` frame.
function ndjsonResponse(frames) {
  const chunk = new TextEncoder().encode(`${frames.map((f) => JSON.stringify(f)).join("\n")}\n`);
  let sent = false;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          if (sent) return { done: true, value: undefined };
          sent = true;
          return { done: false, value: chunk };
        },
      }),
    },
  };
}

describe("END TO END: the language a user picks reaches the WIRE (AC-C24, B-1)", () => {
  // THE HOLE THIS CLOSES, and it is the largest one this suite had. Every
  // other case in this file stubs `@/lib/copilot/answerClient` out, and every
  // case in `route.codeLanguage.test.js` calls `POST` with a hand-written
  // body. The two halves were each tested against a fixture of the other, and
  // **nothing joined them** — so an implementation in which `useDraftAnswer`
  // passes `codeLanguage` into a client that never puts it on the wire is a
  // build where the control governs nothing, with the whole gate green.
  //
  // `answerClient.js:31-39` and `:70-79` do NOT spread the request bag; they
  // rebuild the JSON body field by field, so an added field is dropped by
  // default and only reaches the server if someone adds it in two places.
  // That is precisely the shape that needs a joining assertion rather than
  // two isolated ones.
  //
  // The real client is restored here with `vi.importActual` rather than by
  // un-mocking the module, because a `vi.mock` factory is file-scoped and
  // hoisted; the store, the hook, the real client and `fetch` are then all in
  // one chain.
  async function useRealClient() {
    const real = await vi.importActual("@/lib/copilot/answerClient");
    draftAnswerStreaming.mockImplementation(real.draftAnswerStreaming);
    const fetchSpy = vi.fn(async () =>
      ndjsonResponse([{ t: "done", points: ["Name the constraint first."], cues: ["Constraint"], type: "technical" }]),
    );
    vi.stubGlobal("fetch", fetchSpy);
    return fetchSpy;
  }

  it("posts the selected language in the request body", async () => {
    const fetchSpy = await useRealClient();
    const { state } = mountProbe();
    act(() => setCodeLanguage("java"));
    act(() => state.setQuestions([seedQuestion(1, QUESTION)]));
    await act(async () => {
      await state.runDraft(1, QUESTION);
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/copilot/answer");
    const body = JSON.parse(init.body);
    expect(body.codeLanguage).toBe("java");
    // The positive control that makes the assertion above about the LANGUAGE
    // and not about a broken harness: chunk A's field arrives on the same
    // body, through the same rebuild.
    expect(body.question).toBe(QUESTION);
    expect(body.stream).toBe(true);
  });

  it("posts the value it was GIVEN, not the value the store currently holds", async () => {
    // THE END-TO-END CASE'S ONE WAY TO LIE, and it is realistic rather than
    // contrived: the very object literal that builds this body already does
    // `engine: readEngine()`, so "the client reads the store itself" has a
    // precedent three lines away. With the store and the captured value equal
    // — which is every ordinary request — a client that ignores its argument
    // and calls `getCodeLanguage()` posts the right string and passes.
    //
    // What that destroys is AC-C26's single-capture-point guarantee: the
    // moment anything awaits between the capture and the body build, the wire
    // and the cache key describe different languages, with no error and no
    // symptom. Driving the client DIRECTLY with a value the store disagrees
    // with is what separates the two implementations.
    const real = await vi.importActual("@/lib/copilot/answerClient");
    const fetchSpy = vi.fn(async () =>
      ndjsonResponse([{ t: "done", points: ["Name the constraint first."], cues: ["Constraint"], type: "technical" }]),
    );
    vi.stubGlobal("fetch", fetchSpy);

    act(() => setCodeLanguage("java")); // the store says one thing…
    await real.draftAnswerStreaming({
      question: QUESTION,
      context: "",
      profile: "Senior engineer, dispatch and logistics.",
      interviewType: "technical",
      codeLanguage: "go", // …and the caller hands it another.
      applicationId: null,
      mode: "points",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).codeLanguage).toBe("go");
  });

  it("is a `lib/` module and reads no client store (§B.1's layering)", () => {
    // The structural half of the pair. `lib/copilot/answerClient.js` is handed
    // everything it sends; reaching into `app/copilot/useCodeLanguage.js` for
    // one field inverts the direction of that dependency and reintroduces the
    // race above by a route no behavioural case can reach once the two values
    // agree.
    const src = readSource("../../lib/copilot/answerClient.js");
    expect(src).not.toMatch(/useCodeLanguage/);
    expect(src).not.toMatch(/\bgetCodeLanguage\s*\(/);
  });

  it("reads the store EXACTLY ONCE per draft — one capture point (AC-C26, §C)", () => {
    // The mirror image of the case above, in this file rather than the client:
    // the hook can capture the language into `groundingFor` and then send a
    // SECOND, fresh read on the wire. Both strings are equal on every
    // reachable path today, so no assertion over either value can see it —
    // what can is that there is one read, on the line below
    // `getInterviewType()`, and that the body is built from the captured
    // grounding rather than from the store.
    const src = readSource("./useDraftAnswer.js");
    const reads = src.match(/\bgetCodeLanguage\s*\(\s*\)/g) || [];
    expect(reads).toHaveLength(1);
  });

  it("posts `auto` — never an omitted field — when the user has set no preference (AC-C27b)", async () => {
    // `undefined` is dropped by `JSON.stringify`, so an unplumbed field and a
    // deliberately-absent one are indistinguishable at the server, which
    // normalizes both to `auto`. The one spelling rule is what keeps them
    // apart, and it is only observable here.
    const fetchSpy = await useRealClient();
    const { state } = mountProbe();
    act(() => state.setQuestions([seedQuestion(1, QUESTION)]));
    await act(async () => {
      await state.runDraft(1, QUESTION);
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(Object.keys(body)).toContain("codeLanguage");
    expect(body.codeLanguage).toBe("auto");
  });
});

describe("the live request carries the code language (AC-C24, AC-C27b)", () => {
  it("carries `auto` on an untouched session — the positive control", async () => {
    const { state } = mountProbe();
    act(() => state.setQuestions([seedQuestion(1, QUESTION)]));
    await act(async () => {
      await state.runDraft(1, QUESTION);
    });
    expect(draftAnswerStreaming).toHaveBeenCalledTimes(1);
    expect(draftAnswerStreaming.mock.calls[0][0]).toMatchObject({
      question: QUESTION,
      codeLanguage: "auto",
    });
  });

  it("sends it even under a NON-code-bearing type (AC-C27b's one spelling rule)", async () => {
    // "Send it only under a code-bearing type" leaves the field `undefined` on
    // some paths and `"auto"` on others, which breaks `needsRedraft`'s stated
    // assumption that "the values it compares never include the
    // undefined/null/`""` call-sites that answerGrounding.js's normalisation
    // exists for" — and that failure "doesn't throw and doesn't fail loudly;
    // it just makes the cache miss forever, silently doubling the cost of
    // every repeated question".
    setInterviewType("behavioral");
    const { state } = mountProbe();
    act(() => state.setQuestions([seedQuestion(1, QUESTION)]));
    await act(async () => {
      await state.runDraft(1, QUESTION);
    });
    const body = draftAnswerStreaming.mock.calls[0][0];
    expect(body.codeLanguage).toBe("auto");
    expect(typeof body.codeLanguage).toBe("string");
    expect(body.codeLanguage).not.toBe("");
  });

  it("carries a language selected in the SAME SYNCHRONOUS TURN as the draft (AC-C26)", async () => {
    const { state } = mountProbe();
    act(() => state.setQuestions([seedQuestion(1, QUESTION)]));

    let bodyAtCallTime = null;
    let pending = null;
    // One synchronous `act` body. A ref mirrored during render still holds
    // "auto" at this exact point. The body is captured HERE, before `act`
    // returns and flushes anything — `await act()` would flush effects and
    // silently do the work under test.
    act(() => {
      setCodeLanguage("java");
      pending = state.runDraft(1, QUESTION);
      bodyAtCallTime = draftAnswerStreaming.mock.calls[0]?.[0];
    });
    await act(async () => {
      await pending;
    });

    expect(bodyAtCallTime).toBeTruthy();
    expect(bodyAtCallTime.codeLanguage).toBe("java");
  });
});

describe("the live answer cache key includes the code language (AC-C25, CONF-2)", () => {
  it("re-asking the same question under a NEW language is a miss", async () => {
    // A cached answer is in the OLD language. Serving it after a switch is the
    // same defect the grounding key exists to prevent for the interview type,
    // and chunk A already settled the ranking: the key is the only guard that
    // makes stale serving impossible; a cache clear is hygiene.
    //
    // Deliberately NOT clearing `answerCacheRef` here — in the app the change
    // also clears it, and this case isolates the KEY by leaving the `auto`
    // entry sitting in the cache to be rejected on its own.
    const { state } = mountProbe();
    act(() => state.setQuestions([seedQuestion(1, QUESTION)]));
    await act(async () => {
      await state.runDraft(1, QUESTION);
    });
    expect(draftAnswerStreaming).toHaveBeenCalledTimes(1);
    expect(entryOf(state, 1).status).toBe("done");

    act(() => setCodeLanguage("java"));
    act(() => state.setQuestions((prev) => [...prev, seedQuestion(2, QUESTION)]));
    await act(async () => {
      await state.runDraft(2, QUESTION);
    });

    expect(draftAnswerStreaming).toHaveBeenCalledTimes(2);
    expect(entryOf(state, 2).cached).not.toBe(true);
  });

  it("re-asking under the SAME language is still a hit — the positive control", async () => {
    // Without this, an implementation whose cache never hits at all passes the
    // case above and every repeated question silently costs a second call.
    const { state } = mountProbe();
    act(() => setCodeLanguage("java"));
    act(() => state.setQuestions([seedQuestion(1, QUESTION)]));
    await act(async () => {
      await state.runDraft(1, QUESTION);
    });

    act(() => state.setQuestions((prev) => [...prev, seedQuestion(2, QUESTION)]));
    await act(async () => {
      await state.runDraft(2, QUESTION);
    });

    expect(draftAnswerStreaming).toHaveBeenCalledTimes(1);
    expect(entryOf(state, 2).cached).toBe(true);
  });

  it("builds the key through groundingFor, the shared machinery — not a hand-fold", async () => {
    const { state } = mountProbe();
    act(() => setCodeLanguage("go"));
    act(() => state.setQuestions([seedQuestion(1, QUESTION)]));
    await act(async () => {
      await state.runDraft(1, QUESTION);
    });

    expect(groundingFor).toHaveBeenCalled();
    expect(groundingFor.mock.calls.some(([arg]) => arg?.codeLanguage === "go")).toBe(true);
  });

  it("reads the language at the SAME capture point as the interview type", async () => {
    // One capture point, before the `await` — the shape AC-A20 established and
    // AC-C26 mirrors. Both fields must come off the same synchronous read, or
    // one of them can be a tick stale.
    const { state } = mountProbe();
    act(() => state.setQuestions([seedQuestion(1, QUESTION)]));

    act(() => {
      setInterviewType("technical");
      setCodeLanguage("typescript");
      state.runDraft(1, QUESTION);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const call = groundingFor.mock.calls.find(([arg]) => arg?.codeLanguage === "typescript");
    expect(call, "groundingFor never saw the new language").toBeTruthy();
    expect(call[0].interviewType).toBe("technical");
  });
});
