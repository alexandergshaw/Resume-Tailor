import { describe, it, expect, vi, beforeEach } from "vitest";

// N92 Wave 3 (Control B) -- CONFIRM-BEFORE-PERSIST, the central guarantee of
// the whole owner ruling (D7, AC-B10/B11/B12), plus egress scope (AC-B7),
// automated auto-reject (AC-B5), the two-codes/no-leak posture (design section
// 3.2), and the embedded refusal (AC-B9 module half).
//
// This drives the REAL produce -> show -> approve/decline flow through the
// module's own exported functions -- NOT a direct store write. `persist` is the
// store-write boundary, injected as a spy: the guarantee under test is precisely
// that persist is NEVER reached until the user confirms the shown diff, and that
// what is applied IS the shown diff. A test that reached past produce/confirm
// and wrote the store directly would measure nothing about the ruling.
//
// The dangerous mutants each of these red assertions is built to kill (watched
// in the seat report, run against a reference copy, never the working tree):
//   * persist-on-produce  -- requestSmoothTransition writes before confirm  -> "no persist until confirm" reds
//   * show-one-apply-another -- confirm regenerates/paraphrases instead of applying candidate.after -> B12 reds
//   * over-egress -- the smooth request carries the whole letter -> B7 reds
//   * show-an-auto-rejected-rewrite -- an added-token/oos candidate is proposed instead of discarded -> B5 reds
//   * embedded-not-refused -- embedded fires an engine call -> B9 reds
//
// CONTRACT PINNED (design N92 section 3.2/3.3; internals are the implementer's):
//   requestSmoothTransition({ engine, lines, records, id, fetchImpl }) -> candidate
//     proposed  -> { status:"proposed", span, preview:{originalText,smoothedText},
//                    before:{lines,records}, after:{lines,records,edits} }  (NO persist, NO "acted" record)
//     rejected  -> { status:"rejected", reason }  + recordDecision refused(scope|added-token|stale)
//     failed    -> { status:"failed" }            + recordDecision failed
//     embedded  -> { status:"unavailable_embedded" } + recordDecision skipped(embedded), NO fetch
//   confirmSmoothTransition(candidate, { persist }) -> persists candidate.after, records acted
//   declineSmoothTransition(candidate) -> records refused(declined), never persists
//
// RED ON HEAD: lib/coverFacts/smoothTransition.js does not exist -> collection red.

vi.mock("@/lib/activityLog/appActivityLog.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, recordDecision: vi.fn() };
});

import { recordDecision } from "@/lib/activityLog/appActivityLog.js";
import {
  requestSmoothTransition,
  confirmSmoothTransition,
  declineSmoothTransition,
  SMOOTH_ENDPOINT,
} from "./smoothTransition.js";

const FACT_TEXT = "Acme opened a Dublin lab in 2021.";
const BEFORE_SENT = "I led the platform team.";
const AFTER_SENT = "We shipped quickly.";
// A full letter: a greeting, a body paragraph with the fact, and a DISTINCT
// second body paragraph that carries text that must NEVER reach the engine.
const SECRET_PARAGRAPH = "My salary expectation is ninety thousand dollars and I have a competing offer.";
function fullLetter() {
  const p1 = "Dear Hiring Manager,";
  const p2 = `${BEFORE_SENT} ${FACT_TEXT} ${AFTER_SENT}`;
  const p3 = SECRET_PARAGRAPH;
  const lines = [p1, p2, p3];
  const records = [{ id: "f1", text: FACT_TEXT, lineIndex: 1, offset: p2.indexOf(FACT_TEXT), url: "https://x.test/a", title: "Dublin lab" }];
  return { lines, records };
}

// A faithful smoothed triple -- reuses only tokens already in scope, so the
// added-token guard passes and the candidate is genuinely "proposed".
const SMOOTHED_OK = {
  before: "Leading the platform team,",
  fact: "I watched Acme open a Dublin lab in 2021,",
  after: "which let us ship quickly.",
};

// Build a fetchImpl that answers the smooth endpoint with a given `smoothed`
// payload (or throws / non-ok). Records every request body it saw.
function smoothFetch({ smoothed = { status: "ok", ...SMOOTHED_OK }, throws = false, ok = true } = {}) {
  const bodies = [];
  const impl = vi.fn(async (url, init = {}) => {
    bodies.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
    if (throws) throw new Error("network exploded: " + SECRET_PARAGRAPH); // the raw error even carries letter text
    if (!ok) return new Response("no", { status: 502 });
    return new Response(JSON.stringify({ smoothed }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  impl.bodies = bodies;
  return impl;
}

beforeEach(() => {
  recordDecision.mockClear();
});

describe("produce persists NOTHING -- the confirm gate is the only write path (AC-B10)", () => {
  it("requestSmoothTransition returns a proposal and never calls persist or records 'acted'", async () => {
    const { lines, records } = fullLetter();
    const fetchImpl = smoothFetch();
    const candidate = await requestSmoothTransition({ engine: "gemini", lines, records, id: "f1", fetchImpl });

    expect(candidate.status, "a faithful smoothing did not reach the 'proposed' state").toBe("proposed");
    // the letter it would apply is carried on the candidate, NOT applied.
    expect(candidate.after.lines.join("\n"), "the proposal carries no applied text").toContain("Dublin lab in 2021");
    // NOTHING acted was recorded at produce time (only confirm/decline are terminal).
    const acted = recordDecision.mock.calls.filter((c) => c[0] === "fact-smooth" && c[1] === "acted");
    expect(acted.length, "producing a proposal recorded an 'acted' decision before the user confirmed").toBe(0);
  });

  it("nothing is persisted WHILE the request is in flight or after it resolves, until confirm (delayed promise)", async () => {
    const { lines, records } = fullLetter();
    let resolveSmooth;
    const gate = new Promise((r) => {
      resolveSmooth = r;
    });
    const fetchImpl = vi.fn(async () => {
      await gate;
      return new Response(JSON.stringify({ smoothed: { status: "ok", ...SMOOTHED_OK } }), { status: 200 });
    });
    const persist = vi.fn(async () => {});

    const pending = requestSmoothTransition({ engine: "gemini", lines, records, id: "f1", fetchImpl });
    // in flight: persist must be untouched.
    await Promise.resolve();
    expect(persist, "persist ran while the smoothing request was still in flight").not.toHaveBeenCalled();
    resolveSmooth();
    const candidate = await pending;
    // resolved but NOT confirmed: still no persist.
    expect(persist, "persist ran on produce, before the user confirmed the diff").not.toHaveBeenCalled();

    // only the explicit confirm reaches persist.
    await confirmSmoothTransition(candidate, { persist });
    expect(persist, "confirm did not reach the persist path").toHaveBeenCalledTimes(1);
  });
});

describe("the shown diff IS the applied change (AC-B12)", () => {
  it("confirm applies EXACTLY candidate.after -- the same object shown, not a regenerated one", async () => {
    const { lines, records } = fullLetter();
    const candidate = await requestSmoothTransition({ engine: "gemini", lines, records, id: "f1", fetchImpl: smoothFetch() });
    expect(candidate.status).toBe("proposed");

    const persist = vi.fn(async () => {});
    await confirmSmoothTransition(candidate, { persist });

    expect(persist).toHaveBeenCalledTimes(1);
    const applied = persist.mock.calls[0][0];
    // identity: the applied payload is the SAME after the user saw, not a fresh
    // generation (show-one-apply-another mutant dies here).
    expect(applied, "confirm applied a different object than the one shown").toBe(candidate.after);
    // and the previewed "after" text is exactly what the applied lines contain.
    expect(applied.lines.join("\n"), "the applied lines do not equal the previewed smoothed text").toContain(candidate.preview.smoothedText);
  });
});

describe("decline discards and restores; distinct from an automated rejection (AC-B11)", () => {
  it("declineSmoothTransition persists nothing and logs a negative outcome", async () => {
    const { lines, records } = fullLetter();
    const candidate = await requestSmoothTransition({ engine: "gemini", lines, records, id: "f1", fetchImpl: smoothFetch() });
    const persist = vi.fn(async () => {});

    await declineSmoothTransition(candidate, { persist });
    expect(persist, "a decline wrote to the store").not.toHaveBeenCalled();

    const refused = recordDecision.mock.calls.filter((c) => c[0] === "fact-smooth" && c[1] === "refused");
    expect(refused.length, "a decline recorded no negative outcome").toBeGreaterThan(0);
    expect(refused[refused.length - 1][2]?.code, "a decline is not distinguished from an auto-reject").toBe("declined");
  });
});

describe("egress is scoped to the three sentences + the fact text (AC-B7)", () => {
  it("the smooth request carries ONLY the in-scope sentences, never the whole letter", async () => {
    const { lines, records } = fullLetter();
    const fetchImpl = smoothFetch();
    await requestSmoothTransition({ engine: "gemini", lines, records, id: "f1", fetchImpl });

    expect(fetchImpl.bodies.length, "no request was made -- the positive-control half is vacuous").toBe(1);
    const req = fetchImpl.bodies[0];
    expect(req.url).toContain(SMOOTH_ENDPOINT);
    const wire = JSON.stringify(req.body);
    // POSITIVE CONTROL: the fact and its neighbour sentences DID cross the wire
    // (else "nothing over-sent" would be trivially, vacuously true).
    expect(wire, "the fact text never reached the engine -- the request is empty").toContain("Dublin lab in 2021");
    expect(wire, "the 'before' sentence was not sent").toContain(BEFORE_SENT);
    expect(wire, "the 'after' sentence was not sent").toContain(AFTER_SENT);
    // THE GUARD: the unrelated paragraph (salary, competing offer) must NOT leave.
    expect(wire, "the whole letter (or an unrelated paragraph) leaked to the engine -- a privacy defect").not.toContain("ninety thousand");
    expect(wire, "an unrelated paragraph leaked to the engine").not.toContain("competing offer");
  });
});

describe("automated auto-reject discards without persisting (AC-B5) -- before the confirm gate", () => {
  it("an added-token candidate is REJECTED, never proposed, nothing persisted", async () => {
    const { lines, records } = fullLetter();
    // The engine returns a candidate that invents a fabricated headcount.
    const fetchImpl = smoothFetch({
      smoothed: { status: "ok", before: "Leading the platform team,", fact: "I watched Acme open a Dublin lab in 2021 with 400 staff,", after: "which let us ship quickly." },
    });
    const candidate = await requestSmoothTransition({ engine: "gemini", lines, records, id: "f1", fetchImpl });

    expect(candidate.status, "a rewrite that fabricated a number was PROPOSED to the user instead of discarded").toBe("rejected");
    const persist = vi.fn(async () => {});
    // a rejected candidate cannot be confirmed into a write.
    await confirmSmoothTransition(candidate, { persist });
    expect(persist, "an auto-rejected rewrite was persisted").not.toHaveBeenCalled();
    const refused = recordDecision.mock.calls.filter((c) => c[0] === "fact-smooth" && c[1] === "refused");
    expect(refused.length, "the auto-reject logged no negative outcome").toBeGreaterThan(0);
  });

  it("an engine error becomes a failed proposal, nothing persisted, and the RAW error never surfaces (two codes / no leak)", async () => {
    const { lines, records } = fullLetter();
    const fetchImpl = smoothFetch({ throws: true });
    const candidate = await requestSmoothTransition({ engine: "gemini", lines, records, id: "f1", fetchImpl });

    expect(candidate.status, "an engine failure did not degrade to a failed proposal").toBe("failed");
    // no raw error / letter text on the coarse envelope handed back to the caller.
    const surfaced = JSON.stringify(candidate);
    expect(surfaced, "the raw engine error leaked to the client").not.toContain("network exploded");
    expect(surfaced, "letter text leaked through the failure envelope").not.toContain("ninety thousand");

    const persist = vi.fn(async () => {});
    await confirmSmoothTransition(candidate, { persist });
    expect(persist, "a failed smoothing was persisted").not.toHaveBeenCalled();

    // the recorded decision carries only enums/codes -- no letter/fact text (N77).
    const failed = recordDecision.mock.calls.filter((c) => c[0] === "fact-smooth" && c[1] === "failed");
    expect(failed.length, "a failed smoothing recorded nothing").toBeGreaterThan(0);
    const fields = JSON.stringify(failed[failed.length - 1][2] || {});
    expect(fields, "the decision record leaked the fact text").not.toContain("Dublin lab in 2021");
    expect(fields, "the decision record leaked an unrelated paragraph").not.toContain("ninety thousand");
  });

  it("a candidate whose reconstruction escaped the span is REJECTED (AC-B1 runtime guard)", async () => {
    const { lines, records } = fullLetter();
    // A degenerate engine answer whose 'after' bleeds a foreign paragraph's text
    // in -- checkScope must catch that the candidate lines differ outside the span.
    const fetchImpl = smoothFetch({
      smoothed: { status: "ok", before: "Leading the platform team,", fact: "I watched Acme open a Dublin lab in 2021,", after: "which let us ship quickly. Dear Hiring Manager, extra." },
    });
    const candidate = await requestSmoothTransition({ engine: "gemini", lines, records, id: "f1", fetchImpl });
    // Either it is rejected outright, or (if reconstruction kept it in-paragraph)
    // it is proposed but the applied lines still touch only line 1 -- assert the
    // strong property: paragraph 0 and 2 are byte-identical to the original.
    if (candidate.status === "proposed") {
      expect(candidate.after.lines[0], "smoothing changed the greeting paragraph").toBe(lines[0]);
      expect(candidate.after.lines[2], "smoothing changed an unrelated body paragraph").toBe(lines[2]);
    } else {
      expect(candidate.status).toBe("rejected");
    }
  });
});

describe("embedded engine fires NO engine call and refuses honestly (AC-B9 module half)", () => {
  it("requestSmoothTransition on embedded makes zero requests and records a skip", async () => {
    const { lines, records } = fullLetter();
    const fetchImpl = smoothFetch();
    const candidate = await requestSmoothTransition({ engine: "embedded", lines, records, id: "f1", fetchImpl });

    expect(fetchImpl, "embedded fired a paid engine call -- the de-escalation was not honored").not.toHaveBeenCalled();
    expect(candidate.status).toBe("unavailable_embedded");
    const skipped = recordDecision.mock.calls.filter((c) => c[0] === "fact-smooth" && c[1] === "skipped");
    expect(skipped.length, "embedded recorded no decision").toBeGreaterThan(0);
    expect(skipped[skipped.length - 1][2]?.code).toBe("embedded");
  });
});
