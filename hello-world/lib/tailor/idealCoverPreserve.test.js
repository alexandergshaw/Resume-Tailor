// N111 gap #1 (UX-39, DATA LOSS) -- a both-scope (resume+cover) Ideal chip
// REGENERATE must not blank the session cover letter.
//
// An Ideal run produces a resume pair and returns NO cover letter. The chip
// regenerate path (app/page.js#handleTailorJob) builds its tailoring-entry
// update with `...(applyCover ? { coverLetterResultLines, coverLetterDocxB64 } : {})`.
// For a both-scope run on a job that HAD a cover letter, applyCover is true and
// the Ideal payload carries no cover, so coverLetterResultLines resolves to []
// and coverLetterDocxB64 to "" -- and that empty pair is spread over the entry,
// overwriting (blanking) the user's existing cover letter. That is the data loss.
//
// The fix lives in a NEW pure helper on lib/tailor/idealDelivery.js that decides
// which cover fields (if any) the entry update should carry, so the handler's
// blank-write becomes a no-op on an Ideal run. "Pin the behavior, not the helper
// name" (idealChipDelivery.test.js): the implementer may rename
// resolveIdealCoverEntryFields, but a renamed function must keep this truth table
// AND be wired at handleTailorJob's cover write (see
// app/page.idealGaps.wiring.test.js, the call-site join).
//
//   applyCover   payload       returns                                   meaning
//   false        any           {}                                        resume-only: never touch cover (as today)
//   true         standard      { coverLetterResultLines, coverLetterDocxB64 }  write fresh cover (as today -- CONTROL)
//   true         Ideal (obj)   {}                                        preserve existing cover (THE FIX)
//
// RED on HEAD: resolveIdealCoverEntryFields does not exist. This file carries the
// data-loss teeth as a PURE instrument; the call-site join proves the handler
// consults it. DISCLOSED LIMIT (step-6 flag): neither layer proves the branch is
// TAKEN at runtime -- app/page.js cannot mount in jsdom (god component) -- so a
// verifier mounting the live app and regenerating a both-scope Ideal run on a job
// with a cover is the missing instrument.

import { describe, it, expect } from "vitest";
import { resolveIdealCoverEntryFields, regeneratedEditedScopes } from "./idealDelivery.js";
import { withEditedScope, editedForScope } from "../document/previewBlob.js";

// An object `ideal` block is what marks a run Ideal, mirroring the existing
// resolveIdealChipDelivery check. A real review block rides along.
const IDEAL = { result: "r", ideal: { applicationReady: { result: "r" }, hypothetical: { result: "h" } } };
const IDEAL_EMPTY = { result: "r", ideal: {} };
const STANDARD = { result: "r", resultLines: ["r"] };

// A tailoring entry the user already has, with a real cover letter attached.
const entryWithCover = () => ({
  result: "old resume",
  resultLines: ["old resume"],
  coverLetterResultLines: ["Dear Hiring Manager,", "I am excited to apply.", "Sincerely, Alex"],
  coverLetterDocxB64: "EXISTING_COVER_B64",
});

describe("resolveIdealCoverEntryFields -- the cover fields a regenerate writes to the entry", () => {
  it("exports a function (RED on HEAD -- the preserve decision is unbuilt)", () => {
    expect(typeof resolveIdealCoverEntryFields).toBe("function");
  });

  it("a both-scope IDEAL run writes NO cover fields, so an existing cover survives", () => {
    // The Ideal payload carries no cover, so the handler's locals are [] and "".
    expect(
      resolveIdealCoverEntryFields({ payload: IDEAL, applyCover: true, coverLetterResultLines: [], coverLetterDocxB64: "" }),
    ).toEqual({});
  });

  it("DATA-LOSS WITNESS -- {...entry, ...decision} preserves the session cover on an Ideal both-scope run", () => {
    // This composes the helper the exact way handleTailorJob merges it:
    // updateTailoringJob(id, (entry) => ({ ...entry, ...<cover decision> })).
    const entry = entryWithCover();
    const merged = {
      ...entry,
      status: "done",
      // the resume half of a both-scope Ideal run (unchanged by this fix)
      result: "ideal resume",
      resultLines: ["ideal resume"],
      ideal: IDEAL.ideal,
      // the cover half -- the only thing this helper governs
      ...resolveIdealCoverEntryFields({ payload: IDEAL, applyCover: true, coverLetterResultLines: [], coverLetterDocxB64: "" }),
    };
    expect(merged.coverLetterResultLines).toEqual(["Dear Hiring Manager,", "I am excited to apply.", "Sincerely, Alex"]);
    expect(merged.coverLetterDocxB64).toBe("EXISTING_COVER_B64");
    // and the resume half still landed
    expect(merged.resultLines).toEqual(["ideal resume"]);
  });

  it("CONTROL (over-fire) -- a STANDARD both-scope run DOES write its fresh cover, overwriting the old one", () => {
    // A build that preserved the cover on EVERY run (not just Ideal) reds here:
    // a standard both-scope regenerate must replace the cover with the new one.
    const fields = resolveIdealCoverEntryFields({
      payload: STANDARD,
      applyCover: true,
      coverLetterResultLines: ["Fresh cover line"],
      coverLetterDocxB64: "FRESH_COVER_B64",
    });
    expect(fields).toEqual({ coverLetterResultLines: ["Fresh cover line"], coverLetterDocxB64: "FRESH_COVER_B64" });
    const merged = { ...entryWithCover(), ...fields };
    expect(merged.coverLetterResultLines).toEqual(["Fresh cover line"]);
    expect(merged.coverLetterDocxB64).toBe("FRESH_COVER_B64");
  });

  it("CONTROL (scope) -- a resume-only run writes no cover fields whatever the payload", () => {
    // applyCover false is the resume-only scope; it must never touch the cover,
    // exactly as today's `applyCover ? {...} : {}` does.
    expect(
      resolveIdealCoverEntryFields({ payload: STANDARD, applyCover: false, coverLetterResultLines: ["x"], coverLetterDocxB64: "y" }),
    ).toEqual({});
    expect(
      resolveIdealCoverEntryFields({ payload: IDEAL, applyCover: false, coverLetterResultLines: ["x"], coverLetterDocxB64: "y" }),
    ).toEqual({});
  });

  it("CONTROL (under-fire) -- a non-object `ideal` is NOT an Ideal run, so the cover is written as standard", () => {
    // Guards against a build that preserves whenever payload.ideal is merely
    // present/truthy: a null/string/array ideal is a standard run and must write.
    for (const ideal of [null, "yes", []]) {
      expect(
        resolveIdealCoverEntryFields({
          payload: { result: "r", ideal },
          applyCover: true,
          coverLetterResultLines: ["c"],
          coverLetterDocxB64: "b",
        }),
        `ideal=${JSON.stringify(ideal)} must write`,
      ).toEqual({ coverLetterResultLines: ["c"], coverLetterDocxB64: "b" });
    }
  });

  it("CLASS GUARD -- EVERY object-`ideal` payload preserves, including a shape no special-case named", () => {
    // Over the CLASS of Ideal runs, not one instance (loop-traps-tests #12). The
    // third member is freshly built here and matches no fixture above, so a fix
    // that special-cased only the known shapes reds. What this CANNOT catch: a
    // handler that writes the preserved fields to the WRONG key, a handler that
    // ignores the helper (the call-site join's job), or a runtime where the
    // branch is never taken (a real-app mount's job).
    const NEW_MEMBER = { result: "r", ideal: { applicationReady: {}, hypothetical: {}, review: { bands: [{ id: "b1" }] } } };
    for (const payload of [IDEAL, IDEAL_EMPTY, NEW_MEMBER]) {
      expect(
        resolveIdealCoverEntryFields({ payload, applyCover: true, coverLetterResultLines: [], coverLetterDocxB64: "" }),
      ).toEqual({});
    }
  });

  it("is safe to call with no argument (a resume-only no-op: writes nothing)", () => {
    expect(resolveIdealCoverEntryFields()).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// N111 follow-up -- the FEED path is the third cover-blank site, and the edit
// flag is the other half of "preserve the cover".
//
// handleTailorFeedPosting has no applyResume/applyCover scoping: it always
// writes both documents (applyCover is always true there), and a feed posting
// can be tailored twice (the entry key is `feed-<posting id>`), so an Ideal
// re-tailor after a standard one finds a real cover on the entry. Its merge is
// `(entry) => ({ ...entry, ...resume fields, ...<cover decision>, edited })`.
//
// DISCLOSED LIMIT (same as the top of this file): this proves the DECISIONS a
// feed handler composes, not that app/page.js composes them; the join over the
// real handler is page.idealGaps.wiring.test.js, and the runtime proof is a
// verifier tailoring an Ideal feed posting twice in the live app.

// A feed entry after a STANDARD tailor whose cover the user then hand-edited.
const feedEntryWithEditedCover = () => ({
  status: "done",
  result: "old resume",
  resultLines: ["old resume"],
  coverLetterResultLines: ["Dear Hiring Manager,", "My own hand-edited line.", "Sincerely, Alex"],
  coverLetterDocxB64: "ENGINE_COVER_B64_PRE_EDIT",
  edited: { resume: false, cover: true },
});

// What the feed handler's merge does with the two decisions, over an entry.
// (previewBlob's withEditedScope is the same helper page.js's
// withClearedEditedScopes is built from.)
function mergeFeedRun(entry, payload, fresh) {
  const edited = regeneratedEditedScopes({ payload, applyResume: true, applyCover: true }).reduce(
    (flags, scope) => withEditedScope({ edited: flags }, scope, false),
    entry.edited,
  );
  return {
    ...entry,
    status: "done",
    result: fresh.result,
    resultLines: fresh.resultLines,
    ...resolveIdealCoverEntryFields({
      payload,
      applyCover: true,
      coverLetterResultLines: fresh.coverLetterResultLines,
      coverLetterDocxB64: fresh.coverLetterDocxB64,
    }),
    edited,
  };
}

describe("the FEED path -- an Ideal re-tailor of the same posting keeps the session cover (third cover-blank site)", () => {
  it("DATA-LOSS WITNESS -- an Ideal feed run over an entry with a cover leaves the cover and its edit flag intact", () => {
    const merged = mergeFeedRun(feedEntryWithEditedCover(), IDEAL, {
      result: "ideal resume",
      resultLines: ["ideal resume"],
      // the Ideal payload carries no cover, so the handler's locals are [] and ""
      coverLetterResultLines: [],
      coverLetterDocxB64: "",
    });
    expect(merged.coverLetterResultLines).toEqual(["Dear Hiring Manager,", "My own hand-edited line.", "Sincerely, Alex"]);
    expect(merged.coverLetterDocxB64).toBe("ENGINE_COVER_B64_PRE_EDIT");
    // the hand-edit flag travels with the preserved cover: if it were cleared,
    // the cover's next download would serve the stale pre-edit engine document
    expect(editedForScope(merged, "cover")).toBe(true);
    // and the resume half still landed, its flag cleared
    expect(merged.resultLines).toEqual(["ideal resume"]);
    expect(editedForScope(merged, "resume")).toBe(false);
  });

  it("CONTROL (over-fire) -- a STANDARD feed re-tailor replaces the cover and clears BOTH edit flags, as today", () => {
    // A build that preserved the cover or its flag on EVERY run reds here.
    const merged = mergeFeedRun(feedEntryWithEditedCover(), STANDARD, {
      result: "fresh resume",
      resultLines: ["fresh resume"],
      coverLetterResultLines: ["Fresh cover line"],
      coverLetterDocxB64: "FRESH_COVER_B64",
    });
    expect(merged.coverLetterResultLines).toEqual(["Fresh cover line"]);
    expect(merged.coverLetterDocxB64).toBe("FRESH_COVER_B64");
    expect(editedForScope(merged, "cover")).toBe(false);
    expect(editedForScope(merged, "resume")).toBe(false);
  });

  it("the FIRST feed tailor of a posting under Ideal (no earlier cover) writes no cover and invents no edited flag", () => {
    const first = { status: "tailoring" };
    const merged = mergeFeedRun(first, IDEAL, { result: "r", resultLines: ["r"], coverLetterResultLines: [], coverLetterDocxB64: "" });
    expect(merged).not.toHaveProperty("coverLetterResultLines");
    expect(merged).not.toHaveProperty("coverLetterDocxB64");
    expect(editedForScope(merged, "cover")).toBe(false);
    expect(editedForScope(merged, "resume")).toBe(false);
  });
});

describe("regeneratedEditedScopes -- which edit flags a regenerate clears", () => {
  it("exports a function (RED on HEAD -- the edit-flag decision is unbuilt)", () => {
    expect(typeof regeneratedEditedScopes).toBe("function");
  });

  it("a STANDARD both-scope run clears both flags (CONTROL -- today's behavior)", () => {
    expect(regeneratedEditedScopes({ payload: STANDARD, applyResume: true, applyCover: true })).toEqual(["resume", "cover"]);
  });

  it("an IDEAL both-scope run clears the resume flag only -- the cover it preserved keeps its edit state (THE FIX)", () => {
    expect(regeneratedEditedScopes({ payload: IDEAL, applyResume: true, applyCover: true })).toEqual(["resume"]);
  });

  it("CONTROL (scope) -- resume-only and cover-only standard runs clear only what they regenerated", () => {
    expect(regeneratedEditedScopes({ payload: STANDARD, applyResume: true, applyCover: false })).toEqual(["resume"]);
    expect(regeneratedEditedScopes({ payload: STANDARD, applyResume: false, applyCover: true })).toEqual(["cover"]);
  });

  it("CONTROL (under-fire) -- a non-object `ideal` is a standard run and clears the cover flag", () => {
    for (const ideal of [null, "yes", []]) {
      expect(
        regeneratedEditedScopes({ payload: { result: "r", ideal }, applyResume: true, applyCover: true }),
        `ideal=${JSON.stringify(ideal)} must clear both`,
      ).toEqual(["resume", "cover"]);
    }
  });

  it("CLASS GUARD -- EVERY object-`ideal` payload leaves the cover flag alone, including a shape no special-case named", () => {
    const NEW_MEMBER = { result: "r", ideal: { applicationReady: {}, hypothetical: {}, review: { bands: [{ id: "b1" }] } } };
    for (const payload of [IDEAL, IDEAL_EMPTY, NEW_MEMBER]) {
      expect(regeneratedEditedScopes({ payload, applyResume: true, applyCover: true })).toEqual(["resume"]);
    }
  });

  it("AGREES WITH THE COVER DECISION -- over the whole grid, 'cover' is cleared exactly when a fresh cover is written", () => {
    // The two decisions are read by different lines of one handler; if they ever
    // disagree the entry holds either a blanked-but-"edited" cover or a
    // preserved-but-"unedited" one. Pin them to the same truth table.
    const payloads = [undefined, STANDARD, { result: "r", ideal: null }, { result: "r", ideal: "yes" }, { result: "r", ideal: [] }, IDEAL, IDEAL_EMPTY];
    for (const payload of payloads) {
      for (const applyCover of [true, false]) {
        const writesCover =
          Object.keys(resolveIdealCoverEntryFields({ payload, applyCover, coverLetterResultLines: ["c"], coverLetterDocxB64: "b" })).length > 0;
        const clearsCoverFlag = regeneratedEditedScopes({ payload, applyResume: true, applyCover }).includes("cover");
        expect(clearsCoverFlag, `payload=${JSON.stringify(payload)} applyCover=${applyCover}`).toBe(writesCover);
      }
    }
  });

  it("is safe to call with no argument (clears nothing)", () => {
    expect(regeneratedEditedScopes()).toEqual([]);
  });
});
