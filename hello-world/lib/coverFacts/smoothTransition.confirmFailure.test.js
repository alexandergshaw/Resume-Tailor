import { describe, it, expect, vi, beforeEach } from "vitest";

// N94 (N92 Wave 3 follow-up) -- the activity log must tell the TRUTH about a
// confirmed smoothing whose write did not land. confirmSmoothTransition used to
// call `persist` and then record "acted" UNCONDITIONALLY, so a stale-revision
// refusal (the real PUT answers 409 -> applySmoothedFact resolves
// { ok:false, reason }) was logged as a success.
//
// Driven through the module's own exported functions with `persist` injected as
// the store-write boundary (the confirmPersist.rc.test.js idiom). The ledger is
// observed through the recordDecision seam -- never through internals.
//
// Two failure shapes are pinned because both exist in production:
//   * persist RESOLVES { ok:false, reason } -- applySmoothedFact's refusal shape
//     (commitSmoothedFact returns it for a refused/failed save);
//   * persist THROWS -- an unexpected I/O error escaping the hook.
// Vocabulary: the outcome is the existing "failed" and the code is the
// existing "save-failed" the sibling `fact-position` entry already uses for a
// failed save (useCompanyResearch.js moveInsertedFact) -- nothing new is minted.

vi.mock("@/lib/activityLog/appActivityLog.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, recordDecision: vi.fn() };
});

import { recordDecision } from "@/lib/activityLog/appActivityLog.js";
import { requestSmoothTransition, confirmSmoothTransition } from "./smoothTransition.js";

const FACT_TEXT = "Acme opened a Dublin lab in 2021.";
const BEFORE_SENT = "I led the platform team.";
const AFTER_SENT = "We shipped quickly.";
const PERSIST_REASON = "The letter's saved copy is out of date: Acme Dublin salary draft.";

const SMOOTHED_OK = {
  before: "Leading the platform team,",
  fact: "I watched Acme open a Dublin lab in 2021,",
  after: "which let us ship quickly.",
};

function fullLetter() {
  const p2 = `${BEFORE_SENT} ${FACT_TEXT} ${AFTER_SENT}`;
  const lines = ["Dear Hiring Manager,", p2, "Sincerely,"];
  const records = [{ id: "f1", text: FACT_TEXT, lineIndex: 1, offset: p2.indexOf(FACT_TEXT), url: "https://x.test/a", title: "Dublin lab" }];
  return { lines, records };
}

async function proposedCandidate() {
  const { lines, records } = fullLetter();
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ smoothed: { status: "ok", ...SMOOTHED_OK } }), { status: 200 }));
  const candidate = await requestSmoothTransition({ engine: "gemini", lines, records, id: "f1", fetchImpl });
  expect(candidate.status, "fixture did not produce a proposed candidate -- every test below would be vacuous").toBe("proposed");
  return candidate;
}

const smoothCalls = (outcome) => recordDecision.mock.calls.filter((c) => c[0] === "fact-smooth" && (outcome ? c[1] === outcome : true));

beforeEach(() => {
  recordDecision.mockClear();
});

describe("[control] a persist that lands is still logged as acted, exactly once", () => {
  it.each([
    ["resolves { ok:true }", async () => ({ ok: true })],
    ["resolves nothing (a bare spy)", async () => {}],
  ])("persist %s -> one 'acted' / 'smoothed' record, no failure", async (_label, impl) => {
    const candidate = await proposedCandidate();
    recordDecision.mockClear(); // the produce step recorded nothing here, but isolate the confirm anyway
    const persist = vi.fn(impl);

    const res = await confirmSmoothTransition(candidate, { persist });

    expect(persist, "the persist boundary was never reached -- the control is vacuous").toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(true);
    expect(smoothCalls().length, "a confirm must record exactly one decision").toBe(1);
    expect(smoothCalls("acted")[0]?.[2]?.code).toBe("smoothed");
    expect(smoothCalls("failed").length).toBe(0);
  });
});

describe("a persist that FAILS is logged as failed, never as acted (N94)", () => {
  it("persist resolves { ok:false, reason } -> no 'acted', one 'failed' / 'save-failed', ok:false returned", async () => {
    const candidate = await proposedCandidate();
    recordDecision.mockClear();
    const persist = vi.fn(async () => ({ ok: false, reason: PERSIST_REASON }));

    const res = await confirmSmoothTransition(candidate, { persist });

    expect(persist, "the persist boundary was never reached -- the failure was not simulated").toHaveBeenCalledTimes(1);
    expect(smoothCalls("acted").length, "the log claims a smoothing was applied although the write failed").toBe(0);
    const failed = smoothCalls("failed");
    expect(failed.length, "a failed save left no 'failed' decision in the log").toBe(1);
    expect(failed[0][2]?.code, "a failed save must carry the existing 'save-failed' code").toBe("save-failed");
    expect(res.ok, "confirm reported success for a write that did not land").toBe(false);
  });

  it("persist THROWS -> no 'acted', one 'failed' / 'save-failed', ok:false returned, nothing escapes", async () => {
    const candidate = await proposedCandidate();
    recordDecision.mockClear();
    const persist = vi.fn(async () => {
      throw new Error(PERSIST_REASON);
    });

    let res;
    await expect(
      (async () => {
        res = await confirmSmoothTransition(candidate, { persist });
      })(),
      "a throwing persist escaped confirmSmoothTransition (the caller's handler would reject unhandled)",
    ).resolves.toBeUndefined();

    expect(persist).toHaveBeenCalledTimes(1);
    expect(smoothCalls("acted").length, "the log claims success although persist threw").toBe(0);
    const failed = smoothCalls("failed");
    expect(failed.length, "a throwing persist left no 'failed' decision in the log").toBe(1);
    expect(failed[0][2]?.code).toBe("save-failed");
    expect(res.ok).toBe(false);
  });

  it("the failure record is text-free: the persist's own reason string never reaches the log (N77)", async () => {
    const candidate = await proposedCandidate();
    recordDecision.mockClear();
    await confirmSmoothTransition(candidate, { persist: vi.fn(async () => ({ ok: false, reason: PERSIST_REASON })) });

    const wire = JSON.stringify(smoothCalls().map((c) => c[2] || {}));
    expect(wire, "the persist's reason text leaked into the shared log").not.toContain("Dublin");
    expect(wire, "the persist's reason text leaked into the shared log").not.toContain("salary");
    expect(smoothCalls("failed").length, "no failure record -- the leak check above is vacuous").toBe(1);
  });
});

describe("a non-proposed candidate stays a no-op (unchanged by N94)", () => {
  it("never calls persist and records nothing, whatever persist would answer", async () => {
    const persist = vi.fn(async () => ({ ok: false }));
    const res = await confirmSmoothTransition({ status: "rejected", reason: "scope" }, { persist });
    expect(persist).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    expect(smoothCalls().length).toBe(0);
  });
});
