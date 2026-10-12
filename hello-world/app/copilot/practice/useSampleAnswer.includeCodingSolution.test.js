// @vitest-environment jsdom
//
// N162 Wave C (step 4b) — PRACTICE mode threads the "include coding solution"
// toggle through every hop of useSampleAnswer: the draftAnswer request (both
// the user-requested `request` path and the silent `queue` pre-fetch), the
// needsRedraft gate, and the cachedSampleAnswerFor cache read. Written BEFORE
// Wave C lands; the current hook neither accepts the toggle nor passes it, and
// its two stale call sites are MIS-SLOTTED after Wave A moved the signatures:
//
//   useSampleAnswer.js:366  needsRedraft(active, profile, interviewType,
//       applicationId, codeLanguage, force)
//     -> `force` now lands in the SIXTH (includeCodingSolution) slot, and the
//        real `force` seventh param defaults false, so force stops forcing.
//   useSampleAnswer.js:381  cachedSampleAnswerFor(entry, question, profile,
//       interviewType, applicationId, codeLanguage)
//     -> the SEVENTH (includeCodingSolution) param is missing, so a reveal
//        folds to the OFF grounding regardless of the live toggle.
//
// HOW THE PRACTICE HOOK GETS THE TOGGLE (arch N162.arch.r1.md §6.4): UNLIKE the
// live hook (which reads the store itself, §6.3), the practice hook takes the
// toggle the SAME WAY it takes codeLanguage — handed in by the caller
// (PracticeClient reads the store), as the `includeCodingSolution` PROP, and
// threaded by identifier into request/queue/needsRedraft/cachedSampleAnswerFor.
// So this file DRIVES THE PROP and asserts the hook forwards the value it is
// given — a build that hardcodes the field reds the ON case (or the OFF
// control). `queue` gains the toggle as a trailing argument (its caller passes
// it), so the queue cases pass it positionally.
//
// Harness copied from useSampleAnswer.codingSolution.test.js next door.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/copilot/answerClient", () => ({
  draftAnswer: vi.fn(),
}));

import { useSampleAnswer } from "./useSampleAnswer.js";
import * as answerClient from "@/lib/copilot/answerClient.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const QUESTION = "Code a function that checks if a string is a palindrome.";
const OTHER_QUESTION = "Tell me about an incident you handled.";

// BASE carries the toggle OFF; individual cases override includeCodingSolution.
const BASE = {
  question: QUESTION,
  profile: "",
  interviewType: "technical",
  applicationId: "app-1",
  codeLanguage: "auto",
  includeCodingSolution: false,
};

// An ordinary non-coding answer — the response shape is not what these cases
// pin (they pin the REQUEST and the cache key), so one plain body serves all.
const plainResponse = () => ({
  points: ["I led the response."],
  cues: ["the response"],
  buzzwords: [],
  resumeAnchor: null,
  pageSources: [{ id: "p1", title: "Payments migration" }],
  grounding: { resume: false, coverLetter: false, pages: false },
});

let api;
function Probe(props) {
  api = useSampleAnswer(props);
  return null;
}

let root;
async function mount(props = BASE) {
  const container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root.render(createElement(Probe, props)));
}
async function rerender(props) {
  await act(async () => root.render(createElement(Probe, props)));
}

beforeEach(() => {
  answerClient.draftAnswer.mockReset();
});

describe("practice `request` forwards the toggle to draftAnswer (AC-N162-5)", () => {
  it("sends includeCodingSolution:true when the prop is ON", async () => {
    // RED on HEAD: the hook does not accept the prop and `request` does not
    // pass it, so the body carries no such key. Kills the hardcode-false mutant.
    answerClient.draftAnswer.mockResolvedValue(plainResponse());
    await mount({ ...BASE, includeCodingSolution: true });
    await act(async () => api.toggle());

    expect(answerClient.draftAnswer).toHaveBeenCalledTimes(1);
    expect(answerClient.draftAnswer.mock.calls[0][0].includeCodingSolution).toBe(true);
    // Positive control: the known-good neighbour field threads through the same
    // call, so a true here is about the TOGGLE, not a broken harness.
    expect(answerClient.draftAnswer.mock.calls[0][0].codeLanguage).toBe("auto");
  });

  it("sends includeCodingSolution:false when the prop is OFF — the over-fire control", async () => {
    // Kills the hardcode-true mutant: the prop is OFF, so a hook that hardwires
    // true reds here.
    answerClient.draftAnswer.mockResolvedValue(plainResponse());
    await mount({ ...BASE, includeCodingSolution: false });
    await act(async () => api.toggle());
    expect(answerClient.draftAnswer.mock.calls[0][0].includeCodingSolution).toBe(false);
  });
});

describe("practice `queue` forwards the toggle to draftAnswer (AC-N162-5)", () => {
  it("sends the toggle it is handed as the trailing argument", async () => {
    // RED on HEAD: queue's signature stops at `cl`, so the sixth argument is
    // dropped and the body carries no key.
    answerClient.draftAnswer.mockResolvedValue(plainResponse());
    await mount(BASE);
    await act(async () => api.queue(QUESTION, "", "technical", "app-1", "auto", true));

    expect(answerClient.draftAnswer).toHaveBeenCalledTimes(1);
    expect(answerClient.draftAnswer.mock.calls[0][0].includeCodingSolution).toBe(true);
  });

  it("sends false when handed false — the over-fire control", async () => {
    answerClient.draftAnswer.mockResolvedValue(plainResponse());
    await mount(BASE);
    await act(async () => api.queue(QUESTION, "", "technical", "app-1", "auto", false));
    expect(answerClient.draftAnswer.mock.calls[0][0].includeCodingSolution).toBe(false);
  });
});

describe("FIXED CALL SITE — force stays the SEVENTH needsRedraft arg (:366)", () => {
  it("retry redrafts even while a request is still in flight (force beats loading)", async () => {
    // needsRedraft returns `if (force) return true` BEFORE `if (loading) return
    // false`, so a forced Retry/Regenerate must redraft on top of an in-flight
    // request. On HEAD `force` is mis-slotted into the includeCodingSolution
    // slot and the real seventh param defaults false, so a loading state short-
    // circuits to "no redraft" and Retry does nothing — draftAnswer stays at 1.
    // A first draft that never resolves holds the panel in `loading`.
    answerClient.draftAnswer.mockImplementation(() => new Promise(() => {}));
    await mount({ ...BASE, includeCodingSolution: false });

    await act(async () => api.toggle()); // request -> status "loading"
    expect(answerClient.draftAnswer).toHaveBeenCalledTimes(1);
    expect(api.status).toBe("loading");

    await act(async () => api.retry()); // force === true must win over loading

    // RED on HEAD: force never reaches the force slot, loading returns false,
    // no second request. GREEN against the reference: force (7th) returns true.
    expect(answerClient.draftAnswer).toHaveBeenCalledTimes(2);
  });

  it("does NOT start a second request on a plain reveal while loading — the control", async () => {
    // The companion that keeps the case above about FORCE and not about reveal
    // over-firing: a non-forced reveal of a question already loading must NOT
    // start a second request. Green on HEAD and after.
    answerClient.draftAnswer.mockImplementation(() => new Promise(() => {}));
    await mount({ ...BASE, includeCodingSolution: false });

    await act(async () => api.toggle()); // request -> loading
    expect(answerClient.draftAnswer).toHaveBeenCalledTimes(1);
    // Hiding then showing is a plain reveal(false); loading must not refetch.
    await act(async () => api.toggle()); // hide
    await act(async () => api.toggle()); // show -> reveal(false), still loading
    expect(answerClient.draftAnswer).toHaveBeenCalledTimes(1);
  });
});

describe("FIXED CALL SITE — cachedSampleAnswerFor gets the toggle (7th, :381)", () => {
  it("a queue drafted under ON is NOT served to an OFF reveal (cross-toggle miss)", async () => {
    // The queue writes a cache entry grounded ON; a reveal while the live
    // toggle is OFF must MISS and refetch, exactly like a codeLanguage flip
    // does. RED on HEAD: queue drops the trailing arg (entry grounds OFF) AND
    // cachedSampleAnswerFor is called with no seventh arg (reveal grounds OFF),
    // so the two agree by accident and the reveal HITS — no refetch.
    answerClient.draftAnswer.mockResolvedValue(plainResponse());
    await mount({ ...BASE, includeCodingSolution: false });
    await act(async () => api.queue(QUESTION, "", "technical", "app-1", "auto", true));

    answerClient.draftAnswer.mockClear();
    await act(async () => api.toggle()); // reveal(false): prop OFF

    // Correct build: entry ON vs request OFF -> miss -> refetch.
    expect(answerClient.draftAnswer).toHaveBeenCalled();
  });

  it("a queue drafted under ON IS served to an ON reveal — the under-fire control", async () => {
    // Without this, a build whose reveal cache never hits passes the miss case
    // above and every reveal pays for a fresh request.
    answerClient.draftAnswer.mockResolvedValue(plainResponse());
    await mount({ ...BASE, includeCodingSolution: true });
    await act(async () => api.queue(QUESTION, "", "technical", "app-1", "auto", true));

    answerClient.draftAnswer.mockClear();
    await act(async () => api.toggle()); // reveal(false): prop ON, entry ON

    expect(answerClient.draftAnswer).not.toHaveBeenCalled();
    expect(api.status).toBe("done");
  });

  it("a `request`-path entry drafted under ON misses an OFF reveal after a flip", async () => {
    // The `request` path's OWN cache write (:317) must also carry the toggle,
    // not just `queue`'s (:446). Reveal ON (caches), hide, flip the prop OFF,
    // reveal again -> the done entry's ON grounding must miss the OFF request.
    // RED on HEAD: the request cache write omits the toggle (entry grounds OFF)
    // and the reveal grounds OFF, so the flipped reveal HITS stale.
    answerClient.draftAnswer.mockResolvedValue(plainResponse());
    await mount({ ...BASE, includeCodingSolution: true });
    await act(async () => api.toggle()); // request ON -> done, cached
    expect(api.status).toBe("done");
    await act(async () => api.toggle()); // hide

    await rerender({ ...BASE, includeCodingSolution: false }); // user flips OFF
    answerClient.draftAnswer.mockClear();
    await act(async () => api.toggle()); // show -> reveal(false), prop OFF

    expect(answerClient.draftAnswer).toHaveBeenCalled();
  });

  it("re-reveals the SAME-toggle request entry for free after moving away and back — control", async () => {
    // Over-fire control for the request-path cache: nothing flipped, so a
    // move-away-and-back reveal is still free.
    answerClient.draftAnswer.mockResolvedValue(plainResponse());
    await mount({ ...BASE, includeCodingSolution: true });
    await act(async () => api.toggle()); // request ON -> done

    await rerender({ ...BASE, question: OTHER_QUESTION, includeCodingSolution: true });
    await rerender({ ...BASE, includeCodingSolution: true });

    answerClient.draftAnswer.mockClear();
    await act(async () => api.toggle());
    expect(answerClient.draftAnswer).not.toHaveBeenCalled();
    expect(api.status).toBe("done");
  });
});
