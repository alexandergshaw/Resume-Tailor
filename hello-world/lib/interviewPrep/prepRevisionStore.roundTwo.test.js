// ---------------------------------------------------------------------------
// readLiveSectionRevisions' own round-two read -- verify.r10.md's F-B1
// (BLOCKER), F-A1/F-A2/F-A3 (MAJOR, test power) and F-m1 (minor).
//
// A SEPARATE file from prepSectionRevisions.test.js -- not a scope choice, a
// line-budget one (F-m6, verify.r10.md): that file is at 858 lines, 142 from
// the 1000-line cap, and every one of the four findings below adds its own
// fixture. Same harness discipline as that file's own header: the real
// exports, against test/helpers/supabaseFake.js's stateful in-memory
// PostgREST, so every filter/projection assertion below means what it says.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { makeStatefulSupabase } from "../../test/helpers/supabaseFake.js";
import { readLiveSectionRevisions, listSectionRevisions } from "./prepRevisionStore.js";
import { restorePayload } from "./prepMerge.js";

const APP_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_APP_ID = "99999999-9999-9999-9999-999999999999";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const REVISIONS_TABLE = "interview_prep_section_revisions";
const PACKS_TABLE = "interview_prep_packs";

function sectionBody(text) {
  return { answer: { lines: [{ text, support: null }] } };
}

function revisionRow({ applicationId = APP_ID, userId = USER_ID, section, revision, text, createdAt }) {
  return {
    id: `rev-${applicationId}-${section}-${revision}`,
    application_id: applicationId,
    user_id: userId,
    section,
    revision,
    content: sectionBody(text),
    claims: [],
    engine: "gemini",
    restored_from: null,
    content_version: 1,
    created_at: createdAt,
  };
}

function packRow({ pointer, pack = { version: 1, sections: {}, claims: [] }, status = "ready" }) {
  return {
    id: "pack-1",
    application_id: APP_ID,
    user_id: USER_ID,
    status,
    pack,
    live_revisions: pointer,
  };
}

function revisionSelects(sb) {
  return sb.calls.filter((c) => c.table === REVISIONS_TABLE && c.verb === "select");
}

function targetedSelects(sb) {
  return revisionSelects(sb).filter((c) => c.filters.some((f) => f.operator === "eq" && f.column === "revision"));
}

// A `.maybeSingle()` read whose statement carries a `revision` eq filter is
// exactly round two's own targeted body read (readSectionRevision) -- never
// round one's narrow scan, which carries no `revision` filter at all.
function failTargetedRevisionReads(sb) {
  const realFrom = sb.from;
  sb.from = vi.fn((table) => {
    const builder = realFrom(table);
    if (table !== REVISIONS_TABLE) return builder;
    let targeted = false;
    const realEq = builder.eq;
    builder.eq = vi.fn((column, value) => {
      if (column === "revision") targeted = true;
      return realEq(column, value);
    });
    const realMaybeSingle = builder.maybeSingle;
    builder.maybeSingle = vi.fn(() => {
      if (targeted) return Promise.resolve({ data: null, error: { message: "connection reset" } });
      return realMaybeSingle();
    });
    return builder;
  });
}

// ---------------------------------------------------------------------------
// F-B1 (fix round r10, BLOCKER) -- a round-two read failure must refuse the
// WHOLE read, never a silently incomplete one.
// ---------------------------------------------------------------------------

describe("readLiveSectionRevisions -- F-B1: a round-two read failure is a terminal refusal, never a silently incomplete base", () => {
  function seedOneLiveSection() {
    return makeStatefulSupabase({
      [PACKS_TABLE]: [packRow({ pointer: { aboutYou: 1 } })],
      [REVISIONS_TABLE]: [revisionRow({ section: "aboutYou", revision: 1, text: "live", createdAt: "2026-09-01T00:00:00.000Z" })],
    });
  }

  it("a round-two read error is reported as `error`, never swallowed into an empty `sections`", async () => {
    const sb = seedOneLiveSection();
    failTargetedRevisionReads(sb);
    const base = await readLiveSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(base.error, "a round-two read failure returned error: null -- the old, swallowed behaviour").toBeTruthy();
    expect(base.error).toContain("connection reset");
  });

  it("a round-two read error never admits the errored section into `sections` (R5's own mutation)", async () => {
    const sb = seedOneLiveSection();
    failTargetedRevisionReads(sb);
    const base = await readLiveSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(base.sections, "an errored round-two entry still resolved into `sections`").toEqual({});
  });

  it("[no-op control] the SAME fixture, with round two healthy, resolves the live body and carries no error", async () => {
    const sb = seedOneLiveSection();
    const base = await readLiveSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(base.error).toBeNull();
    expect(base.sections.aboutYou.content.answer.lines[0].text).toBe("live");
  });
});

// ---------------------------------------------------------------------------
// F-A1 (fix round r10, MAJOR test power) -- round two must read the
// POINTER's own revision, never the section's newest. The source is already
// correct (`pointerEntries` supplies `revision`, never `newestBySection`);
// what was missing is a fixture where the two numbers DIFFER, since every
// landed fixture before this round set them equal, which is exactly why
// mutant R2 (swap the pointer's revision for `newestBySection[section]`)
// survived 764/764.
// ---------------------------------------------------------------------------

describe("readLiveSectionRevisions -- F-A1: round two reads the POINTER's own revision, never the newest", () => {
  function seedOrphanedNewest() {
    return makeStatefulSupabase({
      [PACKS_TABLE]: [packRow({ pointer: { aboutYou: 1 } })],
      [REVISIONS_TABLE]: [
        revisionRow({ section: "aboutYou", revision: 1, text: "The live body every reader has already seen.", createdAt: "2026-09-01T00:00:00.000Z" }),
        // Exists, but was never adopted -- the shape a POST leaves when its
        // append lands and its own pack write then loses the concurrent-
        // restore race (F-m15), or that F-A1's own fix direction names.
        revisionRow({ section: "aboutYou", revision: 2, text: "An orphaned revision nobody ever made live.", createdAt: "2026-09-02T00:00:00.000Z" }),
      ],
    });
  }

  it("the targeted read's own revision filter equals the pointer's value (1), not the section's newest (2)", async () => {
    const sb = seedOrphanedNewest();
    await readLiveSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID });
    const targeted = targetedSelects(sb);
    expect(targeted).toHaveLength(1);
    const eqFilters = targeted[0].filters.filter((f) => f.operator === "eq").map((f) => [f.column, f.value]);
    expect(eqFilters, "round two read the orphaned newest revision instead of the pointer's own").toContainEqual(["revision", 1]);
  });

  it("base.sections adopts the pointer's own live body, never the orphaned newest one", async () => {
    const sb = seedOrphanedNewest();
    const base = await readLiveSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(base.error).toBeNull();
    expect(base.sections.aboutYou.content.answer.lines[0].text).toBe("The live body every reader has already seen.");
    // The narrow scan itself must still see BOTH rows -- only round two's
    // own targeted read is pinned to the pointer.
    expect(base.newestBySection.aboutYou).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// F-A2 (fix round r10, MAJOR test power) -- the narrow scan's own tenancy
// filters. The source already carries both `.eq("application_id")` and
// `.eq("user_id")`; what was missing is a test that would fail if either
// were dropped, and a fixture with two applications of the SAME user (RLS
// scopes this table by user_id alone, so `application_id` is the only thing
// scoping this read to ONE application).
// ---------------------------------------------------------------------------

describe("readLiveSectionRevisions -- F-A2: the narrow scan's own tenancy filters are pinned", () => {
  it("the narrow scan is scoped to both application_id and user_id", async () => {
    const sb = makeStatefulSupabase({
      [PACKS_TABLE]: [packRow({ pointer: {} })],
      [REVISIONS_TABLE]: [],
    });
    await readLiveSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID });
    const narrow = revisionSelects(sb).find((c) => !c.filters.some((f) => f.operator === "eq" && f.column === "revision"));
    expect(narrow, "no narrow scan was issued at all").toBeTruthy();
    const eqFilters = narrow.filters.filter((f) => f.operator === "eq").map((f) => [f.column, f.value]);
    expect(eqFilters, "the narrow scan is missing its application_id scope").toContainEqual(["application_id", APP_ID]);
    expect(eqFilters, "the narrow scan is missing its user_id scope").toContainEqual(["user_id", USER_ID]);
  });

  it("two applications of the SAME user do not leak rows into each other's newestBySection (R7's own mutation)", async () => {
    const sb = makeStatefulSupabase({
      [PACKS_TABLE]: [packRow({ pointer: {} })],
      [REVISIONS_TABLE]: [
        revisionRow({ section: "aboutYou", revision: 1, text: "app one, v1", createdAt: "2026-09-01T00:00:00.000Z" }),
        revisionRow({ section: "aboutYou", revision: 2, text: "app one, v2", createdAt: "2026-09-02T00:00:00.000Z" }),
        revisionRow({ applicationId: OTHER_APP_ID, section: "aboutYou", revision: 99, text: "app two, v99", createdAt: "2026-09-03T00:00:00.000Z" }),
      ],
    });
    const base = await readLiveSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(base.error).toBeNull();
    expect(base.newestBySection.aboutYou, "another application's own revision leaked into this one's newestBySection").toBe(2);
  });
});

// ---------------------------------------------------------------------------
// F-A3 (fix round r10, MAJOR test power) -- the WHOLE set of queries this
// function issues against the revisions table must be bounded, not just the
// targeted-read count: a landed mutation that keeps the four targeted reads
// exactly as they are and adds one MORE, unbounded, full-body scan survived
// every prior test, because nothing walked the full set.
// ---------------------------------------------------------------------------

describe("readLiveSectionRevisions -- F-A3: the whole query set is bounded, never an extra unbounded scan riding alongside it", () => {
  function seedTwoLiveSections() {
    return makeStatefulSupabase({
      [PACKS_TABLE]: [packRow({ pointer: { aboutYou: 2, whyRole: 1 } })],
      [REVISIONS_TABLE]: [
        revisionRow({ section: "aboutYou", revision: 1, text: "aboutYou v1", createdAt: "2026-09-01T00:00:00.000Z" }),
        revisionRow({ section: "aboutYou", revision: 2, text: "aboutYou v2", createdAt: "2026-09-02T00:00:00.000Z" }),
        revisionRow({ section: "whyRole", revision: 1, text: "whyRole v1", createdAt: "2026-09-03T00:00:00.000Z" }),
      ],
    });
  }

  it("every select against the revisions table either omits content or carries a revision eq -- and the total is 1 + the pointer's size", async () => {
    const sb = seedTwoLiveSections();
    await readLiveSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID });
    const selects = revisionSelects(sb);
    for (const call of selects) {
      const hasRevisionEq = call.filters.some((f) => f.operator === "eq" && f.column === "revision");
      const projection = call.select || "";
      expect(
        hasRevisionEq || !projection.includes("content"),
        "a select against the revisions table carries full-body content with no revision eq -- an unbounded scan is riding alongside the targeted reads",
      ).toBe(true);
    }
    expect(selects, "the total query count against the revisions table drifted from 1 (narrow scan) + the pointer's own size").toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// F-m1 (fix round r10, minor) -- `withBodies: false` skips round two
// entirely, for a caller (PATCH) that never reads `sections`.
// ---------------------------------------------------------------------------

describe("readLiveSectionRevisions -- F-m1: withBodies:false skips round two entirely", () => {
  function seedLiveSection() {
    return makeStatefulSupabase({
      [PACKS_TABLE]: [packRow({ pointer: { aboutYou: 2 } })],
      [REVISIONS_TABLE]: [
        revisionRow({ section: "aboutYou", revision: 1, text: "aboutYou v1", createdAt: "2026-09-01T00:00:00.000Z" }),
        revisionRow({ section: "aboutYou", revision: 2, text: "aboutYou v2", createdAt: "2026-09-02T00:00:00.000Z" }),
      ],
    });
  }

  it("issues no targeted body read at all, and `sections` stays {} -- liveRevisions/newestBySection are unaffected", async () => {
    const sb = seedLiveSection();
    const base = await readLiveSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID, withBodies: false });
    expect(base.error).toBeNull();
    expect(base.sections).toEqual({});
    expect(base.liveRevisions).toEqual({ aboutYou: 2 });
    expect(base.newestBySection).toEqual({ aboutYou: 2 });
    expect(targetedSelects(sb), "withBodies:false still issued a targeted body read").toHaveLength(0);
  });

  it("[no-op control] withBodies defaults to true -- the SAME fixture without the option still resolves the live body", async () => {
    const sb = seedLiveSection();
    const base = await readLiveSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(base.sections.aboutYou.content.answer.lines[0].text).toBe("aboutYou v2");
  });
});

// ---------------------------------------------------------------------------
// F-R11-1 (fix round r11, MAJOR test power) -- a pointer entry naming a
// revision no row carries (a DANGLING `live_revisions` entry -- the shape a
// manual row deletion, or any future pruner wired without the pointer guard,
// would leave) must survive `liveRevisions` unchanged, never be silently
// dropped. Nothing in the 779-test target gate seeded this shape before this
// round; `pointerEntries.forEach` (round two's own loop above) is total over
// EVERY pointer entry regardless of whether its own body resolved, but
// nothing pinned that.
// ---------------------------------------------------------------------------

describe("readLiveSectionRevisions -- F-R11-1: a dangling pointer entry survives the base read", () => {
  it("liveRevisions keeps a pointer entry whose revision has no row; sections resolves nothing for it", async () => {
    const sb = makeStatefulSupabase({
      [PACKS_TABLE]: [packRow({ pointer: { aboutYou: 9 } })],
      [REVISIONS_TABLE]: [revisionRow({ section: "aboutYou", revision: 1, text: "aboutYou v1", createdAt: "2026-09-01T00:00:00.000Z" })],
    });
    const base = await readLiveSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(base.error).toBeNull();
    expect(base.liveRevisions, "a dangling pointer entry was dropped instead of surviving unchanged").toEqual({ aboutYou: 9 });
    expect(base.sections).toEqual({});
  });

  it("[no-op control] the SAME fixture with the pointer naming a row that DOES exist resolves the live body as usual", async () => {
    const sb = makeStatefulSupabase({
      [PACKS_TABLE]: [packRow({ pointer: { aboutYou: 1 } })],
      [REVISIONS_TABLE]: [revisionRow({ section: "aboutYou", revision: 1, text: "aboutYou v1", createdAt: "2026-09-01T00:00:00.000Z" })],
    });
    const base = await readLiveSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(base.liveRevisions).toEqual({ aboutYou: 1 });
    expect(base.sections.aboutYou.content.answer.lines[0].text).toBe("aboutYou v1");
  });
});

// ---------------------------------------------------------------------------
// F-R12-2 (fix round r12, MAJOR, verify.r12.md) -- `bodiesRead` had zero test
// power AT THE PRODUCER: deleting `bodiesRead: withBodies,` from either of
// readLiveSectionRevisions' own two return sites (the success return and
// `failure()`) survived the full landed suite, because every existing test
// of the field used a hand-built object literal, never a value this
// function actually returned. The four tests below pin the field directly
// at the producer (killing MARK1/MARK2/MARK3, <scratch>/r12/mutants.json);
// the describe block after this one is the JOIN -- the real return fed
// straight into the real restorePayload, not two independently-tested
// halves.
// ---------------------------------------------------------------------------

function seedOneLiveAboutYou() {
  return makeStatefulSupabase({
    [PACKS_TABLE]: [packRow({ pointer: { aboutYou: 1 } })],
    [REVISIONS_TABLE]: [revisionRow({ section: "aboutYou", revision: 1, text: "live", createdAt: "2026-09-01T00:00:00.000Z" })],
  });
}

function seedFailingPacksRead() {
  return makeStatefulSupabase(
    { [PACKS_TABLE]: [packRow({ pointer: { aboutYou: 1 } })], [REVISIONS_TABLE]: [] },
    { errors: { [PACKS_TABLE]: { select: { message: "boom" } } } },
  );
}

describe("readLiveSectionRevisions -- F-R12-2: `bodiesRead` is pinned at the producer, both branches", () => {
  it("a SUCCESSFUL read with withBodies:false reports bodiesRead:false, not merely absent -- kills MARK1 (field dropped) and MARK3 (hard-coded true)", async () => {
    const sb = seedOneLiveAboutYou();
    const base = await readLiveSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID, withBodies: false });
    expect(base.error).toBeNull();
    expect(Object.hasOwn(base, "bodiesRead"), "bodiesRead was dropped from the return entirely").toBe(true);
    expect(base.bodiesRead).toBe(false);
  });

  it("[no-op control] a SUCCESSFUL read with withBodies:true (the default) reports bodiesRead:true", async () => {
    const sb = seedOneLiveAboutYou();
    const base = await readLiveSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(base.bodiesRead).toBe(true);
  });

  it("a FAILED read (round one's own packs select errors) still reports bodiesRead exactly as requested -- withBodies:false -- kills MARK2 (field dropped from failure())", async () => {
    const sb = seedFailingPacksRead();
    const base = await readLiveSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID, withBodies: false });
    expect(base.error, "the injected packs-read failure did not reach `error` -- this fixture is not exercising failure() at all").toBeTruthy();
    expect(base.bodiesRead).toBe(false);
  });

  it("[no-op control] the SAME failed read with withBodies:true reports bodiesRead:true", async () => {
    const sb = seedFailingPacksRead();
    const base = await readLiveSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(base.error).toBeTruthy();
    expect(base.bodiesRead).toBe(true);
  });
});

describe("readLiveSectionRevisions -> restorePayload -- F-R12-2: the JOIN, not two independently-tested halves", () => {
  it("a withBodies:false base, read for real and handed to the real restorePayload untouched, throws -- the shape PATCH's own base takes", async () => {
    const sb = seedOneLiveAboutYou();
    const base = await readLiveSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID, withBodies: false });
    expect(base.bodiesRead).toBe(false);
    expect(() => restorePayload(base)).toThrow();
  });

  it("[no-op control] the SAME pointer, read with withBodies:true (the default, POST's own shape), does not throw and builds a real merged pack from the real body", async () => {
    const sb = seedOneLiveAboutYou();
    const base = await readLiveSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(base.bodiesRead).toBe(true);
    let out;
    expect(() => {
      out = restorePayload(base);
    }).not.toThrow();
    expect(out.pack.sections.aboutYou.answer.lines[0].text).toBe("live");
  });

  it("[no-op control] an EMPTY pointer with withBodies:false does not throw -- the guard only fires on a POPULATED pointer (F-R11-3's own carve-out, exercised here against the real producer)", async () => {
    const sb = makeStatefulSupabase({ [PACKS_TABLE]: [packRow({ pointer: {} })], [REVISIONS_TABLE]: [] });
    const base = await readLiveSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID, withBodies: false });
    expect(base.bodiesRead).toBe(false);
    expect(() => restorePayload(base)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// F-R15-1 (fix round r15, MINOR, verify.r15.md): listSectionRevisions was the
// one of this file's four source-sanitised functions with no regression
// test -- reverting its own `error` field to the raw PostgREST text
// (`errMessage(listResult.error)`, the shape LIST_SECTION_REVISIONS_FAILED
// replaced) survived the whole landed suite. Same discipline as
// prepStore.test.js's and trustedNames.test.js's own
// "[RED before this fix round]" tests: the raw detail goes to
// logRevisionFailure, never to the caller.
// ---------------------------------------------------------------------------

describe("listSectionRevisions -- F-R15-1: a list-read error's `error` field is a GENERIC sentence, never the raw database text", () => {
  it("[RED before this fix round] the raw detail is logged server-side instead", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sb = makeStatefulSupabase(
      {},
      {
        errors: {
          [REVISIONS_TABLE]: {
            select: { message: "PGRST301 relation interview_prep_section_revisions does not exist at char 42" },
          },
        },
      },
    );
    const { revisions, error } = await listSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(revisions).toBeNull();
    expect(error).toBe("Could not load revision history for this application.");
    expect(error).not.toContain("PGRST301");
    expect(spy).toHaveBeenCalledTimes(1);
    const [, loggedMeta] = spy.mock.calls[0];
    expect(loggedMeta.error.message).toContain("PGRST301");
    spy.mockRestore();
  });
});
