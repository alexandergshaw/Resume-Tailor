import { describe, it, expect, vi, beforeEach } from "vitest";

// N93 (AC-B6) -- POST-APPLY UNDO of a confirmed smoothing. N92 Wave 3 shipped
// confirm-before-persist (produce -> show -> approve) but NOT the undo the
// settled AC-B6 promised (docs/loop/N92.ac.r1.md:255-258; the scope-out lived
// only in the W3 test notes, never the AC). This file is the MODULE-LEVEL
// contract for the undo primitive; the sibling
// app/components/preview/coverFactSmoothUndo.rc.test.js drives the REAL
// apply -> undo flow by mounting the strip and clicking Apply then Undo, and
// app/components/preview/smoothUndoSplice.rc.test.js reads the STORED docx bytes
// back on the byte-splice path.
//
// It drives the REAL produce -> confirm -> undo path through the module's own
// exported functions -- NOT a direct store write. `persist` is the store-write
// boundary, injected as a spy: the guarantee under test is precisely what an
// undo hands the persistence layer, and that it hands the PRE-smoothing state
// (never the post-smoothing text), so the restore is byte-exact.
//
// CONTRACT PINNED (design N92 section 3.3 "Post-apply undo (AC-B6)"; the
// internals are the implementer's):
//   undoSmoothTransition(candidate, { persist }) -> { ok:boolean }
//     * a genuinely applied ("proposed"->confirmed) candidate:
//         persist({ lines, records, edits }) where
//           lines   === candidate.before.lines   (byte-identical pre-smoothing)
//           records === candidate.before.records (pre-smoothing records)
//           edits    = candidate.after.edits with before/after SWAPPED, so
//                      applying them to the SMOOTHED lines yields the original
//                      (the byte-splice path re-splices back -- AC-B6 "download").
//         then recordDecision("fact-smooth", <closed outcome>, { ...code "undo" })
//         with NO letter/fact text (N77); returns { ok:true }.
//     * a null / non-"proposed" candidate: NO persist, returns { ok:false }
//       (undo when nothing was smoothed is a no-op -- AC-B6 edges).
//
// The dangerous mutants each red is built to kill (watched in the seat report,
// run against an isolated reference copy, never the working tree):
//   * stash-the-after -- undo persists candidate.after (the smoothed text) or
//     re-derives it, instead of candidate.before -> the restore is NOT the
//     original -> "restores byte-identical before" reds.
//   * no-inverted-edits -- undo reuses candidate.after.edits verbatim (not
//     swapped) -> reconstructing from them does not yield the original AND the
//     real splice would refuse them as stale -> "edits revert the splice" reds.
//   * undo-a-non-proposal -- undo persists for a rejected/failed/null candidate
//     -> the no-op edges red.
//   * no-decision -- undo records nothing / records it indistinguishably from
//     the apply -> the ledger red.
//
// RED ON HEAD: lib/coverFacts/smoothTransition.js exports no
// `undoSmoothTransition` (grep "undo" across the Wave-3 files = none), so the
// named import is undefined and every call throws -> collection/assertion red.

vi.mock("@/lib/activityLog/appActivityLog.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, recordDecision: vi.fn() };
});

import { recordDecision } from "@/lib/activityLog/appActivityLog.js";
import {
  requestSmoothTransition,
  confirmSmoothTransition,
  undoSmoothTransition,
} from "./smoothTransition.js";

const FACT_TEXT = "Acme opened a Dublin lab in 2021.";
const BEFORE_SENT = "I led the platform team.";
const AFTER_SENT = "We shipped quickly.";
// A distinct second body paragraph that a scoped restore must leave untouched.
const OTHER_PARAGRAPH = "I would relocate for the right team.";

function fullLetter() {
  const p1 = "Dear Hiring Manager,";
  const p2 = `${BEFORE_SENT} ${FACT_TEXT} ${AFTER_SENT}`;
  const p3 = OTHER_PARAGRAPH;
  const lines = [p1, p2, p3];
  const records = [
    { id: "f1", text: FACT_TEXT, lineIndex: 1, offset: p2.indexOf(FACT_TEXT), url: "https://x.test/a", title: "Dublin lab" },
  ];
  return { lines, records };
}

// A faithful smoothed triple -- reuses only in-scope tokens, so the added-token
// guard passes and the candidate is genuinely "proposed".
const SMOOTHED_OK = {
  before: "Leading the platform team,",
  fact: "I watched Acme open a Dublin lab in 2021,",
  after: "which let us ship quickly.",
};
const SMOOTHED_FRAGMENT = "I watched Acme open a Dublin lab in 2021";

function smoothFetch({ smoothed = { status: "ok", ...SMOOTHED_OK } } = {}) {
  return vi.fn(async () => new Response(JSON.stringify({ smoothed }), { status: 200, headers: { "Content-Type": "application/json" } }));
}

// FAITHFUL model of what the byte-splice does with these edits
// (lib/acceptedFacts/factDocx.js#applyCoverDocxEdits + docxModel#applyTextEdits):
// each edit is a whole-paragraph { before, after } rewrite, REFUSED unless
// baseLines[edit.lineIndex] === edit.before (the staleness guard,
// factDocx.js:33-34). This helper HARD-THROWS on that mismatch, so an
// un-swapped edit set (which targets the ORIGINAL line, not the smoothed one
// present at undo time) makes it throw -- exactly as the real splice would
// refuse it as stale-plan -- rather than silently agree.
function reconstructFromEdits(baseLines, edits) {
  const out = [...baseLines];
  for (const e of Array.isArray(edits) ? edits : []) {
    if (out[e.lineIndex] !== e.before) {
      throw new Error(`undo edit for line ${e.lineIndex} does not target the SMOOTHED paragraph present at undo time (the real splice would refuse it as stale-plan)`);
    }
    out[e.lineIndex] = e.after;
  }
  return out;
}

async function produceAndConfirm() {
  const { lines, records } = fullLetter();
  const candidate = await requestSmoothTransition({ engine: "gemini", lines, records, id: "f1", fetchImpl: smoothFetch() });
  expect(candidate.status, "the fixture smoothing did not reach 'proposed' -- the undo tests would be vacuous").toBe("proposed");
  // confirm the smoothing (this is the state an undo reverts). A separate spy so
  // the undo's own persist payload is unambiguous.
  await confirmSmoothTransition(candidate, { persist: vi.fn(async () => {}) });
  return { candidate, original: { lines, records } };
}

beforeEach(() => {
  recordDecision.mockClear();
});

describe("undo hands the persistence layer the PRE-smoothing state (AC-B6 core)", () => {
  it("persists candidate.before.lines byte-identically -- never the smoothed text", async () => {
    const { candidate, original } = await produceAndConfirm();
    // sanity: the smoothed 'after' really differs from the original (else a
    // "restore" would be indistinguishable from doing nothing).
    expect(candidate.after.lines.join("\n"), "the smoothed candidate did not change the letter").not.toBe(original.lines.join("\n"));
    expect(candidate.after.lines.join("\n"), "the smoothed candidate did not carry the smoothed text").toContain(SMOOTHED_FRAGMENT);

    const persist = vi.fn(async () => {});
    const res = await undoSmoothTransition(candidate, { persist });

    expect(res?.ok, "undo of a confirmed smoothing did not succeed").toBe(true);
    expect(persist, "undo never reached the persistence layer -- nothing was restored").toHaveBeenCalledTimes(1);
    const restored = persist.mock.calls[0][0];
    // THE CORE: the restored lines are byte-identical to the pre-smoothing lines.
    expect(restored.lines, "undo restored a different lines reference than candidate.before.lines (stash-the-after mutant)").toBe(candidate.before.lines);
    expect(restored.lines.join("\n"), "undo did not restore the original letter byte-for-byte").toBe(original.lines.join("\n"));
    // and it does NOT carry the smoothed text.
    expect(restored.lines.join("\n"), "the restored letter still carries the smoothed sentence -- undo restored stale/wrong text").not.toContain(SMOOTHED_FRAGMENT);
    expect(restored.lines.join("\n"), "the restored letter lost the original fact sentence").toContain(FACT_TEXT);
    // records restored to the pre-smoothing records too (span re-located).
    expect(restored.records, "undo did not restore the pre-smoothing records").toBe(candidate.before.records);
  });

  it("hands edits that, applied to the SMOOTHED lines, reconstruct the original (the byte-splice reverts too)", async () => {
    const { candidate, original } = await produceAndConfirm();
    const persist = vi.fn(async () => {});
    await undoSmoothTransition(candidate, { persist });
    const restored = persist.mock.calls[0][0];

    expect(Array.isArray(restored.edits) && restored.edits.length > 0, "undo carried no edits -- the byte-splice path has nothing to revert (a lines-only revert leaves stale docx bytes)").toBe(true);
    // The edits must target the SMOOTHED paragraphs (present in the stored docx
    // at undo time) and rewrite them back to the original. reconstructFromEdits
    // hard-throws if an edit's `before` is not the smoothed line -- which is
    // exactly what the un-swapped after.edits (before=original) would trigger,
    // and what the real splice returns as stale-plan.
    const rebuilt = reconstructFromEdits(candidate.after.lines, restored.edits);
    expect(rebuilt.join("\n"), "applying the undo edits to the smoothed letter did not reproduce the original -- the download would keep the smoothed docx bytes").toBe(original.lines.join("\n"));
  });

  it("records a fact-smooth decision distinguishable from the apply, carrying no letter text (AC-X1/N77)", async () => {
    const { candidate } = await produceAndConfirm();
    recordDecision.mockClear();
    const persist = vi.fn(async () => {});
    await undoSmoothTransition(candidate, { persist });

    const smoothCalls = recordDecision.mock.calls.filter((c) => c[0] === "fact-smooth");
    expect(smoothCalls.length, "undo recorded no fact-smooth decision").toBeGreaterThan(0);
    const [, outcome, fields] = smoothCalls[smoothCalls.length - 1];
    expect(["acted", "skipped", "refused", "failed"], `undo recorded an outcome '${outcome}' outside the closed fact-smooth vocabulary`).toContain(outcome);
    // distinguishable from the plain apply (which records code "smoothed"), so a
    // downloaded log can tell an undo from an apply.
    expect(fields?.code, "undo is not distinguished from the apply in the decision log").toBe("undo");
    // N77: no letter/fact/url/title text in the recorded fields.
    const serialized = JSON.stringify(fields || {});
    expect(serialized, "the undo decision leaked the fact text into the shared log").not.toContain(FACT_TEXT);
    expect(serialized, "the undo decision leaked the smoothed text").not.toContain(SMOOTHED_FRAGMENT);
    expect(serialized, "the undo decision leaked the source url").not.toContain("x.test");
  });
});

describe("undo is a no-op on anything but a confirmed proposal (AC-B6 edges)", () => {
  it("does nothing and persists nothing for a null candidate (nothing was smoothed)", async () => {
    const persist = vi.fn(async () => {});
    const res = await undoSmoothTransition(null, { persist });
    expect(persist, "undo wrote to the store when nothing had been smoothed").not.toHaveBeenCalled();
    expect(res?.ok, "undo of nothing reported success").not.toBe(true);
  });

  it("does nothing for a rejected candidate (an auto-rejected rewrite was never applied, so there is nothing to undo)", async () => {
    // An added-token candidate is auto-rejected, never applied -- undoing it must
    // not resurrect anything.
    const { lines, records } = fullLetter();
    const fetchImpl = smoothFetch({
      smoothed: { status: "ok", before: "Leading the platform team,", fact: "I watched Acme open a Dublin lab in 2021 with 400 staff,", after: "which let us ship quickly." },
    });
    const rejected = await requestSmoothTransition({ engine: "gemini", lines, records, id: "f1", fetchImpl });
    expect(rejected.status, "the added-token candidate was not auto-rejected -- this edge would be vacuous").toBe("rejected");

    const persist = vi.fn(async () => {});
    const res = await undoSmoothTransition(rejected, { persist });
    expect(persist, "undo persisted for a candidate that was never applied").not.toHaveBeenCalled();
    expect(res?.ok, "undo of a rejected proposal reported success").not.toBe(true);
  });
});
