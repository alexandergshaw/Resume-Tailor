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
  // N162: `force` is now the SEVENTH positional argument, after the new
  // `includeCodingSolution` sixth argument. These calls pass includeCodingSolution
  // (false here — the toggle matches the fixture, so it is not what drives the
  // result) in the sixth slot and `force` in the seventh.
  it("redrafts even when status is done and every comparison key matches", () => {
    const active = {
      question: "Q",
      status: "done",
      profile: "profile-A",
      interviewType: "behavioral",
      applicationId: "app-1",
      codeLanguage: "auto",
      includeCodingSolution: false,
    };
    expect(needsRedraft(active, "profile-A", "behavioral", "app-1", "auto", false, true)).toBe(true);
  });

  it("redrafts even when a request for this question is already loading", () => {
    const active = {
      question: "Q",
      status: "loading",
      profile: "profile-A",
      interviewType: "behavioral",
      applicationId: "app-1",
      codeLanguage: "auto",
      includeCodingSolution: false,
    };
    expect(needsRedraft(active, "profile-A", "behavioral", "app-1", "auto", false, true)).toBe(true);
  });
});

describe("needsRedraft — idle and error always redraft", () => {
  it("redrafts from idle even with no force and nothing to compare against", () => {
    const active = emptySampleAnswer();
    expect(active.status).toBe("idle");
    expect(needsRedraft(active, "profile-A", "behavioral", "app-1", "auto", false)).toBe(true);
  });

  it("redrafts from error even when every comparison key matches what's cached", () => {
    const active = {
      question: "Q",
      status: "error",
      profile: "profile-A",
      interviewType: "behavioral",
      applicationId: "app-1",
      codeLanguage: "auto",
    };
    expect(needsRedraft(active, "profile-A", "behavioral", "app-1", "auto", false)).toBe(true);
  });

  it("treats a missing/null active as idle-like and redrafts", () => {
    expect(needsRedraft(null, "profile-A", "behavioral", "app-1", "auto", false)).toBe(true);
    expect(needsRedraft(undefined, "profile-A", "behavioral", "app-1", "auto", false)).toBe(true);
  });
});

describe("needsRedraft — loading never starts a second request", () => {
  it("does not redraft while loading even when profile, interviewType, applicationId, and codeLanguage have all since changed", () => {
    const active = {
      question: "Q",
      status: "loading",
      profile: "profile-A",
      interviewType: "behavioral",
      applicationId: "app-1",
      codeLanguage: "auto",
    };
    expect(needsRedraft(active, "profile-B", "technical", "app-2", "java", false)).toBe(false);
  });

  it("does not redraft while loading even when nothing has changed", () => {
    const active = {
      question: "Q",
      status: "loading",
      profile: "profile-A",
      interviewType: "behavioral",
      applicationId: "app-1",
      codeLanguage: "auto",
    };
    expect(needsRedraft(active, "profile-A", "behavioral", "app-1", "auto", false)).toBe(false);
  });
});

describe("needsRedraft — done redrafts only when profile, interviewType, applicationId, or codeLanguage differs", () => {
  // N162: the fixture now records the coding toggle it was drafted under
  // (false), so a reveal that matches it is served and a flip redrafts. These
  // calls pass includeCodingSolution in the SIXTH slot and `force` in the
  // SEVENTH.
  const doneActive = {
    question: "Q",
    status: "done",
    points: ["Cached point"],
    profile: "profile-A",
    interviewType: "behavioral",
    applicationId: "app-1",
    codeLanguage: "auto",
    includeCodingSolution: false,
  };

  it("serves the cache when profile, interviewType, applicationId, codeLanguage, and the coding toggle all still match", () => {
    expect(needsRedraft(doneActive, "profile-A", "behavioral", "app-1", "auto", false, false)).toBe(false);
  });

  it("redrafts when only profile differs", () => {
    expect(needsRedraft(doneActive, "profile-B", "behavioral", "app-1", "auto", false, false)).toBe(true);
  });

  it("redrafts when only interviewType differs", () => {
    expect(needsRedraft(doneActive, "profile-A", "technical", "app-1", "auto", false, false)).toBe(true);
  });

  it("redrafts when only applicationId differs", () => {
    expect(needsRedraft(doneActive, "profile-A", "behavioral", "app-2", "auto", false, false)).toBe(true);
  });

  it("redrafts when applicationId changes from null to a real id", () => {
    const activeWithNullApp = { ...doneActive, applicationId: null };
    expect(needsRedraft(activeWithNullApp, "profile-A", "behavioral", "app-1", "auto", false, false)).toBe(true);
  });

  // AC-C27: codeLanguage is a fourth comparison field, driven off the exact
  // same "done" branch as profile/interviewType/applicationId.
  it("redrafts when only codeLanguage differs", () => {
    expect(needsRedraft(doneActive, "profile-A", "behavioral", "app-1", "java", false, false)).toBe(true);
  });

  // N162: the coding toggle is a fifth comparison field, driven off the same
  // "done" branch. A flip alone redrafts (FD-3 at the practice reveal).
  it("redrafts when only the coding toggle differs", () => {
    expect(needsRedraft(doneActive, "profile-A", "behavioral", "app-1", "auto", true, false)).toBe(true);
  });

  // AC-C27c + N162: the ordering rule the arity trap exists for. `force` stays
  // the LAST positional argument; `codeLanguage` is fifth and the coding toggle
  // sixth, both BEFORE `force`. Were the toggle appended after `force` instead,
  // the toggle value would land in the `force` slot and redraft unconditionally
  // regardless of what matches — this pins all three positions at once:
  //   - no force, everything matches  -> false
  //   - force in the seventh slot      -> true
  //   - a toggle flip in the sixth slot (no force) -> true (not via force)
  it("keeps force LAST, with codeLanguage and the coding toggle before it", () => {
    expect(needsRedraft(doneActive, "profile-A", "behavioral", "app-1", "auto", false, false)).toBe(false);
    expect(needsRedraft(doneActive, "profile-A", "behavioral", "app-1", "auto", false, true)).toBe(true);
    expect(needsRedraft(doneActive, "profile-A", "behavioral", "app-1", "auto", true, false)).toBe(true);
  });
});

// AC-J2.9: cachedSampleAnswerFor is the reveal-time cache lookup for a draft
// queued by useSampleAnswer.queue before the reveal ever asks for one. Every
// "return null" branch here matters because a false hit serves a stale or
// blank draft as if it were a real answer.
describe("cachedSampleAnswerFor", () => {
  const CURRENT_QUESTION = "Tell me about a time you led a project.";
  const CURRENT_PROFILE = "profile-A";
  const CURRENT_TYPE = "behavioral";
  const CURRENT_APP = "app-1";
  const CURRENT_LANG = "auto";

  function validEntry(overrides = {}) {
    return {
      points: ["Situation: Sure, at my last job..."],
      grounding: { resume: true, coverLetter: false },
      profile: CURRENT_PROFILE,
      interviewType: CURRENT_TYPE,
      applicationId: CURRENT_APP,
      codeLanguage: CURRENT_LANG,
      ...overrides,
    };
  }

  it("returns null for a missing entry", () => {
    expect(
      cachedSampleAnswerFor(null, CURRENT_QUESTION, CURRENT_PROFILE, CURRENT_TYPE, CURRENT_APP, CURRENT_LANG),
    ).toBeNull();
  });

  it("returns null for an undefined entry", () => {
    expect(
      cachedSampleAnswerFor(undefined, CURRENT_QUESTION, CURRENT_PROFILE, CURRENT_TYPE, CURRENT_APP, CURRENT_LANG),
    ).toBeNull();
  });

  it("returns null when points is an empty array", () => {
    const entry = validEntry({ points: [] });
    expect(
      cachedSampleAnswerFor(entry, CURRENT_QUESTION, CURRENT_PROFILE, CURRENT_TYPE, CURRENT_APP, CURRENT_LANG),
    ).toBeNull();
  });

  it("returns null when points is not an array at all (a malformed cache entry)", () => {
    for (const badPoints of ["not an array", 42, {}, null, undefined]) {
      const entry = validEntry({ points: badPoints });
      expect(
        cachedSampleAnswerFor(entry, CURRENT_QUESTION, CURRENT_PROFILE, CURRENT_TYPE, CURRENT_APP, CURRENT_LANG),
      ).toBeNull();
    }
  });

  it("returns null when points contains only blank/non-string values — a blank answer must not render as a finished one", () => {
    const entry = validEntry({ points: ["", "   ", null, undefined, 0, false] });
    expect(
      cachedSampleAnswerFor(entry, CURRENT_QUESTION, CURRENT_PROFILE, CURRENT_TYPE, CURRENT_APP, CURRENT_LANG),
    ).toBeNull();
  });

  it("returns null when the entry's profile differs from the current profile (interviewType, applicationId, and codeLanguage all still match)", () => {
    const entry = validEntry({ profile: "profile-B" });
    expect(
      cachedSampleAnswerFor(entry, CURRENT_QUESTION, CURRENT_PROFILE, CURRENT_TYPE, CURRENT_APP, CURRENT_LANG),
    ).toBeNull();
  });

  it("returns null when the entry's interviewType differs from the current interviewType (profile, applicationId, and codeLanguage all still match)", () => {
    const entry = validEntry({ interviewType: "technical" });
    expect(
      cachedSampleAnswerFor(entry, CURRENT_QUESTION, CURRENT_PROFILE, CURRENT_TYPE, CURRENT_APP, CURRENT_LANG),
    ).toBeNull();
  });

  it("returns null when the entry's applicationId differs from the current applicationId (profile, interviewType, and codeLanguage all still match)", () => {
    const entry = validEntry({ applicationId: "app-2" });
    expect(
      cachedSampleAnswerFor(entry, CURRENT_QUESTION, CURRENT_PROFILE, CURRENT_TYPE, CURRENT_APP, CURRENT_LANG),
    ).toBeNull();
  });

  it("returns null when the entry's applicationId is null but the current applicationId is a real id", () => {
    const entry = validEntry({ applicationId: null });
    expect(
      cachedSampleAnswerFor(entry, CURRENT_QUESTION, CURRENT_PROFILE, CURRENT_TYPE, CURRENT_APP, CURRENT_LANG),
    ).toBeNull();
  });

  // AC-C27: codeLanguage is a fourth comparison field, on the same footing as
  // profile/interviewType/applicationId.
  it("returns null when the entry's codeLanguage differs from the current codeLanguage (profile, interviewType, and applicationId all still match)", () => {
    const entry = validEntry({ codeLanguage: "java" });
    expect(
      cachedSampleAnswerFor(entry, CURRENT_QUESTION, CURRENT_PROFILE, CURRENT_TYPE, CURRENT_APP, CURRENT_LANG),
    ).toBeNull();
  });

  // A-15/AC-C27: the sixth argument is deliberately NOT defaulted. An omitted
  // argument folds to "" through groundingFor's normalizeField and must miss
  // against an entry that explicitly carries CURRENT_LANG — never a false
  // hit, which is the fail-safe direction.
  it("treats an omitted sixth argument as a miss, never as a false hit", () => {
    const entry = validEntry();
    expect(
      cachedSampleAnswerFor(entry, CURRENT_QUESTION, CURRENT_PROFILE, CURRENT_TYPE, CURRENT_APP),
    ).toBeNull();
  });

  it("on a hit, returns a complete state slot: visible true, status done, no error, the entry's points, and the CURRENT question/profile/interviewType/applicationId/codeLanguage", () => {
    const entry = validEntry();
    const result = cachedSampleAnswerFor(
      entry,
      CURRENT_QUESTION,
      CURRENT_PROFILE,
      CURRENT_TYPE,
      CURRENT_APP,
      CURRENT_LANG,
    );
    expect(result).toEqual({
      question: CURRENT_QUESTION,
      visible: true,
      status: "done",
      points: entry.points,
      // AC-K1: an entry cached before the reading aids existed carries none
      // of them, and resolves to the empty shapes rather than `undefined` —
      // the render layer then falls back to the full points and omits both
      // subsections, instead of rendering a header with nothing under it.
      cues: [],
      buzzwords: [],
      anchor: null,
      // ARCH §4f: an entry cached before `pageSources` existed resolves the
      // same way every other reading aid above does — the empty shape, not
      // `undefined`.
      pageSources: [],
      grounding: { resume: true, coverLetter: false },
      error: "",
      profile: CURRENT_PROFILE,
      interviewType: CURRENT_TYPE,
      applicationId: CURRENT_APP,
      codeLanguage: CURRENT_LANG,
    });
  });

  it("carries the reading aids through on a hit when the cached entry has them", () => {
    const entry = validEntry({
      cues: ["Situation: Checkout redesign"],
      buzzwords: ["Kubernetes"],
      anchor: { title: "Senior Engineer", company: "Quantum Robotics", matched: true, project: "Checkout redesign" },
    });
    const result = cachedSampleAnswerFor(
      entry,
      CURRENT_QUESTION,
      CURRENT_PROFILE,
      CURRENT_TYPE,
      CURRENT_APP,
      CURRENT_LANG,
    );
    expect(result.cues).toEqual(["Situation: Checkout redesign"]);
    expect(result.buzzwords).toEqual(["Kubernetes"]);
    expect(result.anchor).toEqual({
      title: "Senior Engineer",
      company: "Quantum Robotics",
      matched: true,
      project: "Checkout redesign",
    });
  });

  // BUG-J6: cachedSampleAnswerFor only filters a COPY of `entry.points` to
  // decide whether there's anything usable at all (see the "blank/non-string
  // values" test above) — it must keep returning the entry's RAW `points`
  // array on a hit, not the filtered copy. This is a pinned contract, not an
  // oversight: the render layer (SampleAnswer.js's use of cleanAnswerPoints)
  // is where blank entries actually get stripped before display, so a future
  // change here that starts "helpfully" cleaning the array would be a
  // deliberate decision, not a silent accident this test lets slip through.
  it("returns the entry's points array unchanged on a hit, not a filtered copy", () => {
    const entry = validEntry();
    const result = cachedSampleAnswerFor(
      entry,
      CURRENT_QUESTION,
      CURRENT_PROFILE,
      CURRENT_TYPE,
      CURRENT_APP,
      CURRENT_LANG,
    );
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
    const result = cachedSampleAnswerFor(
      entry,
      CURRENT_QUESTION,
      CURRENT_PROFILE,
      CURRENT_TYPE,
      CURRENT_APP,
      CURRENT_LANG,
    );
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
      CURRENT_LANG,
    );
    expect(result.grounding).toBeNull();
  });

  // AC-G1-6/AC-G2-C-5/AC-G2-C-9: needsRedraft's "done" branch and
  // cachedSampleAnswerFor's own comparison encode the SAME staleness rule in
  // two different places (one for the on-screen draft, one for an entry
  // queued ahead of reveal). A test that only exercised them separately
  // would not catch the two drifting apart — e.g. one gaining a comparison
  // the other lacks.
  // This drives both functions off the SAME table of entries and asserts
  // they agree on every combination of matching/mismatching profile,
  // interviewType, applicationId, and (AC-C27) codeLanguage.
  // N162: the matrix gains a fifth dimension — the coding toggle — so the two
  // functions are proven to agree on it too (the design's "the agreement block
  // adds the new field"). CURRENT_INC is the current reveal's toggle; an entry
  // that "differs" was drafted under the opposite toggle state.
  describe("agrees with needsRedraft on every combination of matching/mismatching fields", () => {
    const CURRENT_INC = false;
    const combinations = [];
    for (const profileMatches of [true, false]) {
      for (const typeMatches of [true, false]) {
        for (const appMatches of [true, false]) {
          for (const langMatches of [true, false]) {
            for (const incMatches of [true, false]) {
              combinations.push({ profileMatches, typeMatches, appMatches, langMatches, incMatches });
            }
          }
        }
      }
    }

    for (const { profileMatches, typeMatches, appMatches, langMatches, incMatches } of combinations) {
      const label = `profile ${profileMatches ? "matches" : "differs"}, interviewType ${
        typeMatches ? "matches" : "differs"
      }, applicationId ${appMatches ? "matches" : "differs"}, codeLanguage ${
        langMatches ? "matches" : "differs"
      }, codingToggle ${incMatches ? "matches" : "differs"}`;

      it(label, () => {
        const entry = validEntry({
          profile: profileMatches ? CURRENT_PROFILE : "profile-B",
          interviewType: typeMatches ? CURRENT_TYPE : "technical",
          applicationId: appMatches ? CURRENT_APP : "app-2",
          codeLanguage: langMatches ? CURRENT_LANG : "java",
          includeCodingSolution: incMatches ? CURRENT_INC : !CURRENT_INC,
        });

        const cached = cachedSampleAnswerFor(
          entry,
          CURRENT_QUESTION,
          CURRENT_PROFILE,
          CURRENT_TYPE,
          CURRENT_APP,
          CURRENT_LANG,
          CURRENT_INC,
        );

        // The same entry, reshaped as an "active" state slot the way the
        // hook would hold it after a real draft landed — needsRedraft only
        // looks at status/profile/interviewType/applicationId/codeLanguage/
        // includeCodingSolution, never points.
        const active = {
          question: CURRENT_QUESTION,
          status: "done",
          points: entry.points,
          profile: entry.profile,
          interviewType: entry.interviewType,
          applicationId: entry.applicationId,
          codeLanguage: entry.codeLanguage,
          includeCodingSolution: entry.includeCodingSolution,
        };
        const stale = needsRedraft(active, CURRENT_PROFILE, CURRENT_TYPE, CURRENT_APP, CURRENT_LANG, CURRENT_INC, false);

        // A cache hit (non-null) must mean "not stale", and a cache miss
        // (null) must mean "stale" — the two functions must never disagree.
        expect(cached !== null).toBe(!stale);
      });
    }
  });
});
