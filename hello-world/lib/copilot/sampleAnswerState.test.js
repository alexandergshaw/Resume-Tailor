import { describe, it, expect } from "vitest";
import {
  emptySampleAnswer,
  activeSampleAnswer,
  needsRedraft,
  cachedSampleAnswerFor,
} from "./sampleAnswerState.js";

describe("activeSampleAnswer", () => {
  it("discards a stored draft built for a different question", () => {
    const state = {
      question: "Tell me about a time you led a project.",
      visible: true,
      status: "done",
      points: ["Situation: Sure, at my last job..."],
      grounding: { resume: true, coverLetter: false },
      error: "",
      profile: "profile-A",
      interviewType: "behavioral",
      applicationId: "app-1",
    };
    const active = activeSampleAnswer(state, "Why do you want this role?");
    expect(active).toEqual(emptySampleAnswer());
  });

  it("returns the stored state as-is when the question matches exactly", () => {
    const state = {
      question: "Tell me about a time you led a project.",
      visible: true,
      status: "done",
      points: ["Situation: Sure, at my last job..."],
      grounding: { resume: true, coverLetter: false },
      error: "",
      profile: "profile-A",
      interviewType: "behavioral",
      applicationId: "app-1",
    };
    const active = activeSampleAnswer(state, "Tell me about a time you led a project.");
    expect(active).toBe(state);
    expect(active.points).toEqual(["Situation: Sure, at my last job..."]);
  });

  it("returns emptySampleAnswer() when state is null", () => {
    const active = activeSampleAnswer(null, "Why do you want this role?");
    expect(active).toEqual(emptySampleAnswer());
  });

  it("returns emptySampleAnswer() when state is undefined", () => {
    const active = activeSampleAnswer(undefined, "Why do you want this role?");
    expect(active).toEqual(emptySampleAnswer());
  });

  it("matches an empty-string question against a state stored for the empty string", () => {
    const state = {
      question: "",
      visible: true,
      status: "done",
      points: ["Fallback answer"],
      grounding: null,
      error: "",
      profile: "profile-A",
      interviewType: "behavioral",
      applicationId: "app-1",
    };
    const active = activeSampleAnswer(state, "");
    expect(active).toBe(state);
  });

  it("discards a stored draft when the current question is empty but the draft was for a real question", () => {
    const state = {
      question: "Why do you want this role?",
      visible: true,
      status: "done",
      points: ["Because..."],
      grounding: null,
      error: "",
      profile: "profile-A",
      interviewType: "behavioral",
      applicationId: "app-1",
    };
    const active = activeSampleAnswer(state, "");
    expect(active).toEqual(emptySampleAnswer());
  });
});

describe("emptySampleAnswer", () => {
  it("carries points (an empty array) rather than a prose answer string (AC-H9.37)", () => {
    const empty = emptySampleAnswer();
    expect(empty.points).toEqual([]);
    expect(empty).not.toHaveProperty("answer");
  });
});

describe("needsRedraft — force", () => {
  it("redrafts even when status is done and every comparison key matches", () => {
    const active = {
      question: "Q",
      status: "done",
      profile: "profile-A",
      interviewType: "behavioral",
      applicationId: "app-1",
    };
    expect(needsRedraft(active, "profile-A", "behavioral", "app-1", true)).toBe(true);
  });

  it("redrafts even when a request for this question is already loading", () => {
    const active = {
      question: "Q",
      status: "loading",
      profile: "profile-A",
      interviewType: "behavioral",
      applicationId: "app-1",
    };
    expect(needsRedraft(active, "profile-A", "behavioral", "app-1", true)).toBe(true);
  });
});

describe("needsRedraft — idle and error always redraft", () => {
  it("redrafts from idle even with no force and nothing to compare against", () => {
    const active = emptySampleAnswer();
    expect(active.status).toBe("idle");
    expect(needsRedraft(active, "profile-A", "behavioral", "app-1", false)).toBe(true);
  });

  it("redrafts from error even when every comparison key matches what's cached", () => {
    const active = {
      question: "Q",
      status: "error",
      profile: "profile-A",
      interviewType: "behavioral",
      applicationId: "app-1",
    };
    expect(needsRedraft(active, "profile-A", "behavioral", "app-1", false)).toBe(true);
  });

  it("treats a missing/null active as idle-like and redrafts", () => {
    expect(needsRedraft(null, "profile-A", "behavioral", "app-1", false)).toBe(true);
    expect(needsRedraft(undefined, "profile-A", "behavioral", "app-1", false)).toBe(true);
  });
});

describe("needsRedraft — loading never starts a second request", () => {
  it("does not redraft while loading even when profile, interviewType, and applicationId have all since changed", () => {
    const active = {
      question: "Q",
      status: "loading",
      profile: "profile-A",
      interviewType: "behavioral",
      applicationId: "app-1",
    };
    expect(needsRedraft(active, "profile-B", "technical", "app-2", false)).toBe(false);
  });

  it("does not redraft while loading even when nothing has changed", () => {
    const active = {
      question: "Q",
      status: "loading",
      profile: "profile-A",
      interviewType: "behavioral",
      applicationId: "app-1",
    };
    expect(needsRedraft(active, "profile-A", "behavioral", "app-1", false)).toBe(false);
  });
});

describe("needsRedraft — done redrafts only when profile, interviewType, or applicationId differs", () => {
  const doneActive = {
    question: "Q",
    status: "done",
    points: ["Cached point"],
    profile: "profile-A",
    interviewType: "behavioral",
    applicationId: "app-1",
  };

  it("serves the cache when profile, interviewType, and applicationId all still match", () => {
    expect(needsRedraft(doneActive, "profile-A", "behavioral", "app-1", false)).toBe(false);
  });

  it("redrafts when only profile differs", () => {
    expect(needsRedraft(doneActive, "profile-B", "behavioral", "app-1", false)).toBe(true);
  });

  it("redrafts when only interviewType differs", () => {
    expect(needsRedraft(doneActive, "profile-A", "technical", "app-1", false)).toBe(true);
  });

  it("redrafts when only applicationId differs", () => {
    expect(needsRedraft(doneActive, "profile-A", "behavioral", "app-2", false)).toBe(true);
  });

  it("redrafts when applicationId changes from null to a real id", () => {
    const activeWithNullApp = { ...doneActive, applicationId: null };
    expect(needsRedraft(activeWithNullApp, "profile-A", "behavioral", "app-1", false)).toBe(true);
  });
});

// AC-J2.9: cachedSampleAnswerFor is the reveal-time cache lookup for a
// pre-draft made by the dashboard's prediction hook, before the reveal ever
// asks for one. Every "return null" branch here matters because a false hit
// serves a stale or blank draft as if it were a real answer.
describe("cachedSampleAnswerFor", () => {
  const CURRENT_QUESTION = "Tell me about a time you led a project.";
  const CURRENT_PROFILE = "profile-A";
  const CURRENT_TYPE = "behavioral";
  const CURRENT_APP = "app-1";

  function validEntry(overrides = {}) {
    return {
      points: ["Situation: Sure, at my last job..."],
      grounding: { resume: true, coverLetter: false },
      profile: CURRENT_PROFILE,
      interviewType: CURRENT_TYPE,
      applicationId: CURRENT_APP,
      ...overrides,
    };
  }

  it("returns null for a missing entry", () => {
    expect(
      cachedSampleAnswerFor(null, CURRENT_QUESTION, CURRENT_PROFILE, CURRENT_TYPE, CURRENT_APP),
    ).toBeNull();
  });

  it("returns null for an undefined entry", () => {
    expect(
      cachedSampleAnswerFor(undefined, CURRENT_QUESTION, CURRENT_PROFILE, CURRENT_TYPE, CURRENT_APP),
    ).toBeNull();
  });

  it("returns null when points is an empty array", () => {
    const entry = validEntry({ points: [] });
    expect(
      cachedSampleAnswerFor(entry, CURRENT_QUESTION, CURRENT_PROFILE, CURRENT_TYPE, CURRENT_APP),
    ).toBeNull();
  });

  it("returns null when points is not an array at all (a malformed cache entry)", () => {
    for (const badPoints of ["not an array", 42, {}, null, undefined]) {
      const entry = validEntry({ points: badPoints });
      expect(
        cachedSampleAnswerFor(entry, CURRENT_QUESTION, CURRENT_PROFILE, CURRENT_TYPE, CURRENT_APP),
      ).toBeNull();
    }
  });

  it("returns null when points contains only blank/non-string values — a blank answer must not render as a finished one", () => {
    const entry = validEntry({ points: ["", "   ", null, undefined, 0, false] });
    expect(
      cachedSampleAnswerFor(entry, CURRENT_QUESTION, CURRENT_PROFILE, CURRENT_TYPE, CURRENT_APP),
    ).toBeNull();
  });

  it("returns null when the entry's profile differs from the current profile (interviewType and applicationId both still match)", () => {
    const entry = validEntry({ profile: "profile-B" });
    expect(
      cachedSampleAnswerFor(entry, CURRENT_QUESTION, CURRENT_PROFILE, CURRENT_TYPE, CURRENT_APP),
    ).toBeNull();
  });

  it("returns null when the entry's interviewType differs from the current interviewType (profile and applicationId both still match)", () => {
    const entry = validEntry({ interviewType: "technical" });
    expect(
      cachedSampleAnswerFor(entry, CURRENT_QUESTION, CURRENT_PROFILE, CURRENT_TYPE, CURRENT_APP),
    ).toBeNull();
  });

  it("returns null when the entry's applicationId differs from the current applicationId (profile and interviewType both still match)", () => {
    const entry = validEntry({ applicationId: "app-2" });
    expect(
      cachedSampleAnswerFor(entry, CURRENT_QUESTION, CURRENT_PROFILE, CURRENT_TYPE, CURRENT_APP),
    ).toBeNull();
  });

  it("returns null when the entry's applicationId is null but the current applicationId is a real id", () => {
    const entry = validEntry({ applicationId: null });
    expect(
      cachedSampleAnswerFor(entry, CURRENT_QUESTION, CURRENT_PROFILE, CURRENT_TYPE, CURRENT_APP),
    ).toBeNull();
  });

  it("on a hit, returns a complete state slot: visible true, status done, no error, the entry's points, and the CURRENT question/profile/interviewType/applicationId", () => {
    const entry = validEntry();
    const result = cachedSampleAnswerFor(
      entry,
      CURRENT_QUESTION,
      CURRENT_PROFILE,
      CURRENT_TYPE,
      CURRENT_APP,
    );
    expect(result).toEqual({
      question: CURRENT_QUESTION,
      visible: true,
      status: "done",
      points: entry.points,
      grounding: { resume: true, coverLetter: false },
      error: "",
      profile: CURRENT_PROFILE,
      interviewType: CURRENT_TYPE,
      applicationId: CURRENT_APP,
    });
  });

  // BUG-J6: cachedSampleAnswerFor only filters a COPY of `entry.points` to
  // decide whether there's anything usable at all (see the "blank/non-string
  // values" test above) — it must keep returning the entry's RAW `points`
  // array on a hit, not the filtered copy. This is a pinned contract, not an
  // oversight: the render layer (CopilotDashboard.js's CurrentAnswerPanel/
  // PredictedAnswerPanel, both via cleanAnswerPoints) is where blank entries
  // actually get stripped before display, so a future change here that
  // starts "helpfully" cleaning the array would be a deliberate decision,
  // not a silent accident this test lets slip through.
  it("returns the entry's points array unchanged on a hit, not a filtered copy", () => {
    const entry = validEntry();
    const result = cachedSampleAnswerFor(entry, CURRENT_QUESTION, CURRENT_PROFILE, CURRENT_TYPE, CURRENT_APP);
    expect(result.points).toBe(entry.points);
  });

  // BUG-J6's exact reachable-bad-data case: a cache entry that is MOSTLY
  // blank but has at least one real point still passes the emptiness check
  // (`points.length === 0` after filtering is false), so it's a hit — and
  // that hit must carry the ORIGINAL unfiltered array (with the blank entry
  // still in it) forward, not a cleaned one. If this ever changed to return
  // a cleaned array, CurrentAnswerPanel's own filtering would become
  // redundant dead code instead of the last line of defense it actually is.
  it("returns a partly-malformed points array as-is on a hit, rather than silently cleaning it", () => {
    const entry = validEntry({ points: ["", "real point"] });
    const result = cachedSampleAnswerFor(entry, CURRENT_QUESTION, CURRENT_PROFILE, CURRENT_TYPE, CURRENT_APP);
    expect(result).not.toBeNull();
    expect(result.points).toEqual(["", "real point"]);
    expect(result.points).toBe(entry.points);
  });

  it("defaults grounding to null when the entry carries no grounding", () => {
    const entry = validEntry({ grounding: undefined });
    const result = cachedSampleAnswerFor(
      entry,
      CURRENT_QUESTION,
      CURRENT_PROFILE,
      CURRENT_TYPE,
      CURRENT_APP,
    );
    expect(result.grounding).toBeNull();
  });

  // AC-G1-6/AC-G2-C-5/AC-G2-C-9: needsRedraft's "done" branch and
  // cachedSampleAnswerFor's own comparison encode the SAME staleness rule in
  // two different places (one for the on-screen draft, one for a pre-draft
  // cache entry). A test that only exercised them separately would not catch
  // the two drifting apart — e.g. one gaining a comparison the other lacks.
  // This drives both functions off the SAME table of entries and asserts
  // they agree on every combination of matching/mismatching profile,
  // interviewType, and applicationId.
  describe("agrees with needsRedraft on every combination of matching/mismatching fields", () => {
    const combinations = [
      { profileMatches: true, typeMatches: true, appMatches: true },
      { profileMatches: false, typeMatches: true, appMatches: true },
      { profileMatches: true, typeMatches: false, appMatches: true },
      { profileMatches: true, typeMatches: true, appMatches: false },
      { profileMatches: false, typeMatches: false, appMatches: true },
      { profileMatches: false, typeMatches: true, appMatches: false },
      { profileMatches: true, typeMatches: false, appMatches: false },
      { profileMatches: false, typeMatches: false, appMatches: false },
    ];

    for (const { profileMatches, typeMatches, appMatches } of combinations) {
      const label = `profile ${profileMatches ? "matches" : "differs"}, interviewType ${
        typeMatches ? "matches" : "differs"
      }, applicationId ${appMatches ? "matches" : "differs"}`;

      it(label, () => {
        const entry = validEntry({
          profile: profileMatches ? CURRENT_PROFILE : "profile-B",
          interviewType: typeMatches ? CURRENT_TYPE : "technical",
          applicationId: appMatches ? CURRENT_APP : "app-2",
        });

        const cached = cachedSampleAnswerFor(
          entry,
          CURRENT_QUESTION,
          CURRENT_PROFILE,
          CURRENT_TYPE,
          CURRENT_APP,
        );

        // The same entry, reshaped as an "active" state slot the way the
        // hook would hold it after a real draft landed — needsRedraft only
        // looks at status/profile/interviewType/applicationId, never points.
        const active = {
          question: CURRENT_QUESTION,
          status: "done",
          points: entry.points,
          profile: entry.profile,
          interviewType: entry.interviewType,
          applicationId: entry.applicationId,
        };
        const stale = needsRedraft(active, CURRENT_PROFILE, CURRENT_TYPE, CURRENT_APP, false);

        // A cache hit (non-null) must mean "not stale", and a cache miss
        // (null) must mean "stale" — the two functions must never disagree.
        expect(cached !== null).toBe(!stale);
      });
    }
  });
});
