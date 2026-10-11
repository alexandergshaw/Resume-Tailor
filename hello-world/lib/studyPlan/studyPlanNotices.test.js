// N157 SC-C sub-chunk C-c (4b TDD seat) -- the pure egress notice builder.
// Binds to docs/loop/N157.SC-C.design.r2.md section 4.4 (egress disclosure, route
// x engine, over-stated) and the pinned strings of section 7. Ledger DES-N157-C13.
//
// WHY A PURE BUILDER AND NOT A SOURCE-TEXT ASSERTION. The egress notice is a
// privacy claim about what leaves the browser; it must be chosen by the CLIENT's
// engine, never leak the wrong leg, and over-state (claim MORE egress) rather
// than under-state when unsure. Testing the chosen string against the registry
// it names (STUDY_COPY.notice) is the registry instrument from loop-traps-tests
// ("assert the text against the registry it describes, not against a literal"):
// a mutant that returns today's English hard-coded would pass a literal check and
// fail here the day the copy is reworded.
//
// RED on HEAD: lib/studyPlan/studyPlanNotices.js does not exist yet, so the
// import throws and every `it` reds -- the honest greenfield red.

import { describe, it, expect } from "vitest";
import { STUDY_COPY } from "@/lib/studyPlan/studyPlanCopy.js";
import { buildStudyPlanNotice } from "@/lib/studyPlan/studyPlanNotices.js";

describe("buildStudyPlanNotice picks the notice by the client engine", () => {
  it("gemini -> the two-leg Gemini notice, verbatim from the registry", () => {
    expect(buildStudyPlanNotice({ engine: "gemini" })).toBe(STUDY_COPY.notice.gemini);
  });

  it("external -> the SAME Gemini notice (the external engine also sends to the service; over-stating is the safe direction)", () => {
    expect(buildStudyPlanNotice({ engine: "external" })).toBe(STUDY_COPY.notice.gemini);
  });

  it("embedded -> the no-AI-provider notice, verbatim from the registry", () => {
    expect(buildStudyPlanNotice({ engine: "embedded" })).toBe(STUDY_COPY.notice.embedded);
  });

  it("an unknown or missing engine -> the Gemini notice (over-state, never claim no egress on uncertainty)", () => {
    // Under-stating egress is the one dangerous direction: a false "nothing is
    // sent" claim. An unknown engine therefore resolves to the MORE-egress copy.
    expect(buildStudyPlanNotice({ engine: "mystery" })).toBe(STUDY_COPY.notice.gemini);
    expect(buildStudyPlanNotice({})).toBe(STUDY_COPY.notice.gemini);
    expect(buildStudyPlanNotice()).toBe(STUDY_COPY.notice.gemini);
  });
});

describe("The notices make the egress claim the privacy spec requires (behaviour, not just identity)", () => {
  it("the gemini notice names BOTH legs and states the resume / cover letter are not sent", () => {
    const notice = buildStudyPlanNotice({ engine: "gemini" });
    // Leg 1 (research) and leg 2 (writing) are named separately, and the
    // not-sent reassurance is present. These substrings come from the pinned
    // string; the point is the builder returns the string that CARRIES them.
    expect(notice).toContain("sent to Google (Gemini)");
    expect(notice).toContain("sent to Gemini again to write the plan");
    expect(notice).toContain("Your resume and cover letter are not sent.");
  });

  it("the embedded notice states NOTHING is sent to an AI provider -- and is NOT the gemini notice (over-fire control)", () => {
    const embedded = buildStudyPlanNotice({ engine: "embedded" });
    expect(embedded).toContain("nothing is sent to an AI provider");
    // The control that matters: a build that always returned the Gemini notice
    // would make a false "stuff is sent to Gemini" claim under the embedded
    // engine, or vice versa. The two outputs must be distinguishable.
    expect(embedded).not.toBe(buildStudyPlanNotice({ engine: "gemini" }));
  });
});
