// completeSections/packStatus — the status predicate derived directly from
// `interview_prep_packs_ready_is_complete`
// (supabase/migrations/20260914000000_interview_prep.sql ~:194-211): a
// section counts as complete only when its exact nested array path is
// non-empty, not merely when the section object is present. Pure, no IO;
// every fixture here is fed through `normalizePack` first (lib/interviewPrep/
// prepParse.js) so these tests exercise the same shape a real caller would
// hand `packStatus`, per prepPack.js's own header ("callers are expected to
// pass a pack that has already been through normalizePack").
import { describe, it, expect } from "vitest";
import { completeSections, packStatus, buildEmbeddedPack } from "@/lib/interviewPrep/prepPack.js";
import { normalizePack } from "@/lib/interviewPrep/prepParse.js";

const PUBLISHER_URL = "https://acme.example/leadership";

function answerLine(text, support) {
  return { text, support };
}

function question(text, support) {
  return { text, support };
}

function stageEntry(name, recommendedAnswer) {
  return { name, questions: [`Tell me about ${name}.`], recommendedAnswer };
}

/** A pack with all four sections populated with content that survives
 *  normalizePack untouched (no detected names, so nothing is refused). */
function fourSectionPack() {
  return {
    sections: {
      aboutYou: { answer: { lines: [answerLine("Shipped three major releases last year.")] } },
      whyRole: { answer: { lines: [answerLine("The mission lines up with my own background.")] } },
      askThem: { questions: [question("What does success look like in 90 days?")] },
      stages: { stages: [stageEntry("Recruiter screen", "Focus on impact and scope.")] },
    },
    claims: [],
  };
}

describe("normalizePack -> packStatus — AC-N16.1: four/three/zero complete sections", () => {
  it('a fixture with all four sections non-empty is "ready"', () => {
    const normalized = normalizePack(fourSectionPack());
    expect(completeSections(normalized)).toEqual(new Set(["aboutYou", "whyRole", "askThem", "stages"]));
    expect(packStatus(normalized)).toBe("ready");
  });

  it('a fixture with exactly three of the four sections non-empty is "partial"', () => {
    const raw = fourSectionPack();
    raw.sections.askThem = { questions: [] };
    const normalized = normalizePack(raw);
    expect(completeSections(normalized)).toEqual(new Set(["aboutYou", "whyRole", "stages"]));
    expect(packStatus(normalized)).toBe("partial");
  });

  it("an empty pack (all four sections empty) is null, signalling the caller should write 'failed'", () => {
    const normalized = normalizePack({ sections: {}, claims: [] });
    expect(completeSections(normalized)).toEqual(new Set());
    expect(packStatus(normalized)).toBeNull();
  });
});

describe("normalizePack -> packStatus — AC-N16.3: every AnswerLine refused yields partial, never ready", () => {
  it("drops (not nulls) every aboutYou line, so a four-section-shaped pack still reports partial", () => {
    // Kills: an applier that NULLS a refused AnswerLine's `text` in place
    // instead of dropping the entry -- jsonb_array_length (and this
    // predicate's own `.length > 0` mirror of it) would stay > 0 for a
    // section whose every line is blank, so `packStatus` would wrongly say
    // "ready" for a pack a candidate would open to find an empty section.
    const raw = fourSectionPack();
    raw.sections.aboutYou = {
      answer: {
        lines: [
          answerLine("I previously worked with Jane Doe on the platform team.", undefined),
          answerLine("Jane Doe and I shipped the checkout rewrite together.", undefined),
        ],
      },
    };
    const normalized = normalizePack(raw);
    // Confirms the mechanism actually engaged (drop, not null-in-place):
    // the array itself is now empty, not merely its texts absent.
    expect(normalized.sections.aboutYou.answer.lines).toHaveLength(0);
    expect(completeSections(normalized)).toEqual(new Set(["whyRole", "askThem", "stages"]));
    expect(packStatus(normalized)).toBe("partial");
    expect(packStatus(normalized)).not.toBe("ready");
  });
});

describe("normalizePack -> packStatus — D: a section of junk entries is not 'non-empty', and packStatus is not 'ready' for it", () => {
  // The exact executed exploit: every one of these four sections is
  // technically a non-empty ARRAY (so a bare `.length > 0` test -- and the
  // identical database CHECK, which only tests `jsonb_array_length > 0` --
  // would call it "ready"), but not one entry is a usable line: a raw
  // string, a null, a number, a boolean, and (for stages) a bare string
  // standing in for a whole Stage object. normalizePack must drop every one
  // of these before packStatus ever counts the array's length.
  //
  // N16-D3: the ORIGINAL fixture here (`"hi"`, `null`, `5`, `0`, `false`,
  // `"nope"`) is entirely non-objects, so every one of them is filtered by
  // `isUsableTextEntry`'s FIRST clause (`Boolean(entry) && typeof entry ===
  // "object"`) alone -- three more of that function's clauses (the
  // not-an-array guard, the `typeof entry.text === "string"` guard, and the
  // `.trim().length > 0` guard) never get exercised by anything reaching
  // past the first clause. `{ text: "   " }` and `{ text: 42 }` below each
  // clear the first clause and independently fail one of the remaining two
  // (the trim guard, then the string-type guard). `["x"]` does NOT add a
  // third, proven guard: a bare array has no own `text` property, so it
  // already fails `typeof entry.text === "string"` regardless of whether the
  // not-an-array guard runs first -- deleting `!Array.isArray(entry)` from
  // prepParse.js leaves this fixture, and this whole suite, unchanged. The
  // only input that would discriminate the not-an-array guard is an array
  // carrying its own `text` property (e.g. `Object.assign(["x"], { text:
  // "hi" })`), which `JSON.parse` can never produce from a stored pack. That
  // guard is harmless defence-in-depth against a hand-constructed object,
  // not a guard this fixture proves independently pulls its own weight.
  it('[mutant this kills] a pack of nothing but junk entries is null (not "ready"), and each section normalizes to a genuinely empty array', () => {
    const junkPack = {
      sections: {
        aboutYou: { answer: { lines: ["hi", null, 5, { text: "   " }] } },
        whyRole: { answer: { lines: [0, { text: 42 }] } },
        askThem: { questions: [false, ["x"]] },
        stages: { stages: ["nope"] },
      },
      claims: [],
    };
    const normalized = normalizePack(junkPack);
    expect(normalized.sections.aboutYou.answer.lines).toEqual([]);
    expect(normalized.sections.whyRole.answer.lines).toEqual([]);
    expect(normalized.sections.askThem.questions).toEqual([]);
    expect(normalized.sections.stages.stages).toEqual([]);
    expect(completeSections(normalized)).toEqual(new Set());
    expect(packStatus(normalized)).toBeNull();
  });

  it("[positive control] the same shapes with genuine content are 'ready'", () => {
    const normalized = normalizePack(fourSectionPack());
    expect(packStatus(normalized)).toBe("ready");
  });
});

describe("normalizePack -> packStatus — stages is complete only when a stage carries USABLE content, not merely a structurally-present entry", () => {
  // normalizePack (prepParse.js) deliberately KEEPS a Stage entry even when
  // refusal blanked every field on it -- a landed prepParse.test.js case
  // (F-4's "nulls a stage's own name ... keeping the stage entry itself")
  // pins that a stage with a nulled name, an empty questions[], and a null
  // recommendedAnswer still survives as a length-1 array, and that test is
  // correct: normalization's job is to remove unsafe content, not to delete
  // structure a renderer may still want. But that means a `stages` array can
  // be structurally non-empty (`length > 0`) while carrying nothing a
  // candidate could read, and a bare length check -- the same one askThem/
  // aboutYou/whyRole never rely on, since normalizeDroppingList's
  // isUsableTextEntry already drops a contentless entry from THOSE arrays --
  // would wrongly call such a pack "ready". The fix belongs in packStatus's
  // own predicate, not in normalizeStage, precisely so the landed test above
  // stays exactly as it is.
  it('[mutant this kills] a pack whose four sections are structurally non-empty, but whose ONLY stage is entirely contentless after refusal, is "partial" -- never "ready"', () => {
    const raw = fourSectionPack();
    // Replace the one genuinely-usable stage with the EXACT shape the
    // landed prepParse.test.js case uses: an uncited name (refused and
    // nulled), an empty questions[], and a null recommendedAnswer from the
    // start -- structurally a length-1 array, semantically empty.
    raw.sections.stages = {
      stages: [{ name: "Panel with Jane Doe", questions: [], recommendedAnswer: null, support: undefined }],
    };
    const normalized = normalizePack(raw);
    // Confirms normalizeStage's OWN landed behaviour is exactly what this
    // test exercises: the stage entry survives (not dropped), only its name
    // is nulled -- the array is genuinely non-empty at the JSON level.
    expect(normalized.sections.stages.stages).toHaveLength(1);
    expect(normalized.sections.stages.stages[0].name).toBeNull();
    expect(completeSections(normalized)).toEqual(new Set(["aboutYou", "whyRole", "askThem"]));
    expect(packStatus(normalized)).toBe("partial");
    expect(packStatus(normalized)).not.toBe("ready");
  });

  it("[positive control] the identical pack with ONE usable field on that same stage (a real recommendedAnswer) is \"ready\"", () => {
    const raw = fourSectionPack();
    raw.sections.stages = {
      stages: [{ name: "Panel with Jane Doe", questions: [], recommendedAnswer: "Focus on scope and impact.", support: undefined }],
    };
    const normalized = normalizePack(raw);
    expect(completeSections(normalized)).toEqual(new Set(["aboutYou", "whyRole", "askThem", "stages"]));
    expect(packStatus(normalized)).toBe("ready");
  });

  // N16-D3: `stageHasUsableContent`'s own `.trim().length > 0` guards (on
  // `recommendedAnswer` and on each `questions[]` entry) were never
  // exercised by anything above -- every stage fixture so far either had a
  // genuinely empty field or a genuinely non-empty one, never a
  // whitespace-only string that only `.trim()` can tell apart from "usable".
  it('[mutant this kills] a stage whose only field is a whitespace-only recommendedAnswer is not usable content -- "partial", never "ready"', () => {
    const raw = fourSectionPack();
    raw.sections.stages = { stages: [{ recommendedAnswer: "   " }] };
    const normalized = normalizePack(raw);
    expect(normalized.sections.stages.stages).toHaveLength(1);
    expect(completeSections(normalized)).toEqual(new Set(["aboutYou", "whyRole", "askThem"]));
    expect(packStatus(normalized)).toBe("partial");
    expect(packStatus(normalized)).not.toBe("ready");
  });

  it('[mutant this kills] a stage whose only field is a questions[] of nothing but a whitespace-only string is not usable content -- "partial", never "ready"', () => {
    const raw = fourSectionPack();
    raw.sections.stages = { stages: [{ questions: ["   "] }] };
    const normalized = normalizePack(raw);
    expect(normalized.sections.stages.stages).toHaveLength(1);
    expect(completeSections(normalized)).toEqual(new Set(["aboutYou", "whyRole", "askThem"]));
    expect(packStatus(normalized)).toBe("partial");
    expect(packStatus(normalized)).not.toBe("ready");
  });
});

describe("completeSections / packStatus — defensive over malformed input", () => {
  it("never throws on null, undefined, or a non-object pack", () => {
    expect(() => completeSections(null)).not.toThrow();
    expect(() => completeSections(undefined)).not.toThrow();
    expect(() => completeSections("not a pack")).not.toThrow();
    expect(packStatus(null)).toBeNull();
    expect(packStatus(undefined)).toBeNull();
  });

  it("a section shaped wrong (not an object) is treated as incomplete, not thrown on", () => {
    const pack = { sections: { aboutYou: "not an object", askThem: { questions: "not an array" } } };
    expect(completeSections(pack)).toEqual(new Set());
    expect(packStatus(pack)).toBeNull();
  });
});

describe("buildEmbeddedPack — N16-E1(a): the fallback sentence is grammatical for every combination of resolved/unresolved title and company", () => {
  // The exact executed regression: the OLD fallback strings ("this
  // position" / "the company") were spliced into a sentence that already
  // supplied its own "the", producing "Lead with the experience most
  // relevant to the this position role at the company." for any title with
  // no recognized organization suffix -- since that reads exactly like a
  // person's name to `containsDetectedName`. No fixture below may ever
  // produce that string.
  it('[mutant this kills] both title and company fall back -- grammatical generic wording, never "the this position role"', () => {
    const pack = buildEmbeddedPack({ position: { title: "Jane Doe", company: "Jane Smith" }, digest: null });
    const aboutYouText = pack.sections.aboutYou.answer.lines[0].text;
    expect(aboutYouText).toContain("this role at this company");
    expect(aboutYouText).not.toContain("the this position role");
    expect(aboutYouText).not.toContain("Jane Doe");
    expect(aboutYouText).not.toContain("Jane Smith");
  });

  it("[mutant this kills] title resolves but company falls back -- no double article across the two fields", () => {
    // A single Title-Case word can never form the two-word pair
    // `containsDetectedName` looks for, so "Manager" alone always resolves
    // -- unlike a two-word title, which now falls back uniformly with
    // `company` (see the "N16 wave G" describe below for why).
    const pack = buildEmbeddedPack({ position: { title: "Manager", company: "Jane Smith" }, digest: null });
    const aboutYouText = pack.sections.aboutYou.answer.lines[0].text;
    expect(aboutYouText).toContain("the Manager role at this company");
  });

  it("[mutant this kills] company resolves but title falls back -- no double article across the two fields", () => {
    const pack = buildEmbeddedPack({ position: { title: "Jane Doe", company: "Acme Robotics" }, digest: null });
    const aboutYouText = pack.sections.aboutYou.answer.lines[0].text;
    expect(aboutYouText).toContain("this role at Acme Robotics");
  });

  // N16-D3 (mutant 6): `safeInterpolationValue`'s own `.trim()` is what
  // turns a whitespace-only value into nothing -- without it, `!trimmed`
  // never fires (a string of spaces is truthy) and `containsDetectedName`
  // never flags plain whitespace either, so the raw spaces would be
  // interpolated verbatim instead of falling back.
  it("[mutant this kills] a whitespace-only title is treated as absent, not interpolated verbatim", () => {
    const pack = buildEmbeddedPack({ position: { title: "   ", company: "Acme Robotics" }, digest: null });
    const aboutYouText = pack.sections.aboutYou.answer.lines[0].text;
    expect(aboutYouText).toContain("this role at Acme Robotics");
  });
});

describe("buildEmbeddedPack — N16 wave G: the title job-noun allow-list is deleted; every leak it produced now falls back", () => {
  // OWNER RULING (N16 wave G): `JOB_NOUN_WORDS`, `TITLE_WORD_PAIR_RE`, and
  // `looksLikeJobTitle` are DELETED from prepPack.js, not patched a third
  // time -- see that file's own header for the full measurement. The
  // allow-list failed in two independent ways: its pair scan was
  // non-overlapping, so an odd-length run of Title-Case words left its
  // final word in no pair and never screened; and its override fired
  // whenever EITHER word of a pair was a job noun, so the job noun itself
  // ("Director" in "Director Maria") satisfied its own override. `title` is
  // now screened by `containsDetectedName` exactly like `company` -- no
  // per-field exception -- so every fixture below must fall back, and any
  // one of them starting to contain a real, uncited name again means the
  // uniform screen has been narrowed back into a per-field allow-list.
  it('[mutant this kills] the exact leaks the real file produced now fall back -- including ODD-length Title-Case runs no prior fixture in this suite could represent', () => {
    // "Director Maria Garcia", "Engineer Jane Doe", "Nurse Maria Garcia",
    // "Analyst Robert Klein", and "Lead Software Engineer Jane Doe" are each
    // a single, ODD-length run of Title-Case words. Every fixture this
    // suite had before N16 wave G happened to split into even-length runs
    // (e.g. "Executive Assistant to Jane Doe" splits on the lowercase "to"
    // into two runs of two) -- "alignment luck", not a property of the fix
    // -- so none of them could have caught the non-overlapping-scan half of
    // the bug on its own. These make sure a future re-introduction of a
    // pair-based allow-list cannot hide behind only even-length fixtures
    // again.
    const leakingTitles = [
      "Executive Assistant to Jane Doe",
      "Director Maria Garcia",
      "Lead Software Engineer Jane Doe",
      "Engineer Jane Doe",
      "Nurse Maria Garcia",
      "Analyst Robert Klein",
    ];
    for (const title of leakingTitles) {
      const pack = buildEmbeddedPack({ position: { title, company: "Acme Robotics" }, digest: null });
      const aboutYouText = pack.sections.aboutYou.answer.lines[0].text;
      expect(aboutYouText).toContain("this role at Acme Robotics");
      expect(aboutYouText).not.toContain(title);
    }
  });

  // The remaining leaks the original bug report named, kept as regression
  // fixtures even though the mechanism that let any of them through no
  // longer exists in any form.
  it("[regression] the rest of the originally reported leaks fall back the same way", () => {
    const leakingTitles = [
      "Executive Assistant to Jane Doe, CEO",
      "Chief of Staff to John Smith",
      "Research Associate - Lab of Maria Garcia",
      "Nurse - Dr Robert Klein Clinic",
      "Associate Attorney at Baker Hostetler",
    ];
    for (const title of leakingTitles) {
      const pack = buildEmbeddedPack({ position: { title, company: "Acme Robotics" }, digest: null });
      const aboutYouText = pack.sections.aboutYou.answer.lines[0].text;
      expect(aboutYouText).toContain("this role at Acme Robotics");
      expect(aboutYouText).not.toContain(title);
    }
  });

  // [disclosed cost of the N16 wave G ruling] Named on its own, with this
  // comment, so nobody "fixes" this back into an allow-list without reading
  // why the allow-list was deleted (this describe's own header, and
  // prepPack.js's own header): "Senior Data Scientist" is an ordinary,
  // harmless title with no detected name in it at all, and it now falls
  // back to generic wording anyway, because `containsDetectedName` cannot
  // tell it apart from a person's name. That is the accepted price of
  // closing the leak above, not a bug, until backlog N26 replaces the
  // detector with something that can tell the two apart.
  it('[disclosed cost] "Senior Data Scientist" now falls back too, exactly like any other detected-name-shaped title', () => {
    const pack = buildEmbeddedPack({
      position: { title: "Senior Data Scientist", company: "Acme Robotics" },
      digest: null,
    });
    expect(pack.sections.aboutYou.answer.lines[0].text).toContain("this role at Acme Robotics");
  });

  it("[disclosed cost] the other ordinary clean titles the deleted allow-list used to resolve now fall back too, uniformly", () => {
    const ordinaryTitles = [
      "Software Engineer",
      "Data Scientist",
      "Product Manager",
      "Registered Nurse",
      "Engineering Manager",
      "Account Executive",
      "Marketing Lead",
      "Senior Staff Machine Learning Engineer",
    ];
    for (const title of ordinaryTitles) {
      const pack = buildEmbeddedPack({ position: { title, company: "Acme Robotics" }, digest: null });
      expect(pack.sections.aboutYou.answer.lines[0].text).toContain("this role at Acme Robotics");
    }
  });
});

describe("buildEmbeddedPack — E-F3: the resolved title reaches askThem, not just aboutYou", () => {
  // prepPack.js:248's `asTitlePhrase` only ever fed the FIRST askThem
  // question -- nothing in this file asserted on it, so a mutant replacing
  // the resolved branch with the fallback string "in this role" survived.
  it('[mutant this kills] a resolved title appears in askThem\'s first question as "as a <title>"', () => {
    const pack = buildEmbeddedPack({ position: { title: "Manager", company: "Acme Robotics" }, digest: null });
    expect(pack.sections.askThem.questions[0].text).toContain("as a Manager");
    expect(pack.sections.askThem.questions[0].text).not.toContain("in this role");
  });

  it("[positive control] an unresolved title falls back to \"in this role\" in that same question", () => {
    const pack = buildEmbeddedPack({ position: { title: "Jane Doe", company: "Acme Robotics" }, digest: null });
    expect(pack.sections.askThem.questions[0].text).toContain("in this role");
  });
});
