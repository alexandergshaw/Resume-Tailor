// ---------------------------------------------------------------------------
// The per-section revision store -- plan steps S5/S6, AC-CONC.2/CONC.4,
// AC-RET.1/RET.2/RET.3, plan risk R5, and the G1 contract delta
// (readLiveSectionRevisions gains `status`).
//
// RED BECAUSE NONE OF THESE EXPORTS EXIST YET. The import below fails at
// link time, which is the hand-off state: every assertion is written against
// the signatures plan §6.1 fixes.
//
// ---------------------------------------------------------------------------
// INSTRUMENT I2 (plan §6.3): a scripted client that can fail on a SPECIFIC
// statement AND hold one open.
// ---------------------------------------------------------------------------
// finishAttempt.test.js's injected-dependency pattern is the model, but it
// cannot express either half of what the concurrency criteria need:
//
//   * "the SECOND insert raises 23505" needs per-statement scripting, not a
//     per-table canned result -- a mock that always returns 23505 would make
//     a conflict test pass while proving nothing (which is exactly why
//     AC-CONC.4's no-op control exists).
//   * "two writers are in flight at once" cannot be asserted synchronously.
//     A same-tick assertion tests sequencing, not concurrency: it stays green
//     for an implementation that serializes everything, and green for one
//     that loses a write. The `deferred` script entry below holds the first
//     statement's promise open so the second genuinely runs while the first
//     has not resolved.

import { describe, it, expect, vi } from "vitest";
import { makeSupabase } from "../../test/helpers/supabaseMock.js";
import { makeStatefulSupabase } from "../../test/helpers/supabaseFake.js";
import { readPrepPack } from "./prepStore.js";
import {
  appendSectionRevisions,
  listSectionRevisions,
  readSectionRevision,
  pruneSectionRevisions,
  readLiveSectionRevisions,
} from "./prepRevisionStore.js";
import { PREP_SECTION_REVISIONS_MAX } from "./prepConstants.js";
import { PREP_SECTION_NAMES } from "./prepContract.js";

const APP_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const REVISIONS_TABLE = "interview_prep_section_revisions";

const UNIQUE_VIOLATION = { code: "23505", message: 'duplicate key value violates unique constraint "interview_prep_section_revisions_pkey"' };

function sectionBody(text) {
  return { answer: { lines: [{ text, support: null }] } };
}

// ---------------------------------------------------------------------------
// I2 itself.
// ---------------------------------------------------------------------------

/**
 * A chainable PostgREST stand-in whose statements resolve from an ORDERED
 * script rather than a per-table canned value.
 *
 * Script entry forms:
 *   {data, error}              resolve this statement with that result
 *   (statement) => ({data,error})  compute it from the statement itself
 *   {deferred: true}           HOLD the promise open; the test releases it
 *                              through `client.pending`
 *   {reject: <error>}          REJECT this statement's own promise (F-A4:
 *                              a dropped connection, not a returned
 *                              `{error}`) -- never silently downgraded to a
 *                              resolved result.
 * A statement beyond the end of the script resolves `{data: null, error: null}`.
 */
function makeScriptedClient(script = []) {
  const queue = [...script];
  const statements = [];
  const pending = [];

  function resolveStatement(statement) {
    statements.push(statement);
    const spec = queue.shift();
    if (spec === undefined) return Promise.resolve({ data: null, error: null });
    if (typeof spec === "function") return Promise.resolve(spec(statement));
    if (spec && spec.reject) return Promise.reject(spec.reject);
    if (spec && spec.deferred) {
      let release;
      const promise = new Promise((res) => {
        release = res;
      });
      pending.push({ statement, release });
      return promise;
    }
    return Promise.resolve(spec);
  }

  function builderFor(table) {
    const statement = { table, verb: "select", payload: null, select: null, filters: [] };
    const builder = {};
    const setVerb = (verb) =>
      vi.fn((payload) => {
        statement.verb = verb;
        statement.payload = payload;
        return builder;
      });
    const filter = (op) =>
      vi.fn((column, value) => {
        statement.filters.push({ op, column, value });
        return builder;
      });

    builder.select = vi.fn((columns) => {
      statement.select = columns ?? null;
      if (statement.verb === "select") statement.select = columns ?? null;
      return builder;
    });
    builder.insert = setVerb("insert");
    builder.update = setVerb("update");
    builder.upsert = setVerb("upsert");
    builder.delete = vi.fn(() => {
      statement.verb = "delete";
      return builder;
    });
    for (const op of ["eq", "neq", "in", "lt", "lte", "gt", "gte", "is"]) builder[op] = filter(op);
    builder.order = vi.fn((column, options) => {
      statement.filters.push({ op: "order", column, value: options });
      return builder;
    });
    builder.limit = vi.fn((count) => {
      statement.filters.push({ op: "limit", column: null, value: count });
      return builder;
    });
    builder.maybeSingle = vi.fn(() => resolveStatement(statement));
    builder.single = vi.fn(() => resolveStatement(statement));
    builder.then = (onOk, onErr) => resolveStatement(statement).then(onOk, onErr);
    return builder;
  }

  return { from: vi.fn(builderFor), statements, pending };
}

describe("[canaries] instrument I2 is alive -- a scripted client that cannot script is worse than none", () => {
  it("consumes its script IN ORDER, statement by statement", async () => {
    const sb = makeScriptedClient([{ data: [{ n: 1 }], error: null }, { data: null, error: UNIQUE_VIOLATION }]);
    const first = await sb.from("t").insert({ a: 1 }).select();
    const second = await sb.from("t").insert({ a: 2 }).select();
    expect(first.data).toEqual([{ n: 1 }]);
    expect(second.error).toBe(UNIQUE_VIOLATION);
    expect(sb.statements.map((s) => s.verb)).toEqual(["insert", "insert"]);
  });

  it("[canary] a deferred entry really does hold its promise open", async () => {
    const sb = makeScriptedClient([{ deferred: true }]);
    let settled = false;
    const inFlight = sb.from("t").insert({ a: 1 }).then((r) => {
      settled = true;
      return r;
    });
    await Promise.resolve();
    expect(settled, "the deferred statement resolved on its own -- I2 is not holding anything").toBe(false);
    sb.pending[0].release({ data: [{ ok: true }], error: null });
    await inFlight;
    expect(settled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-CONC.2 / AC-CONC.4 -- the revision-number race
// ---------------------------------------------------------------------------

describe("appendSectionRevisions -- the PK is the concurrency guard", () => {
  it("[RED: export absent -- AC-CONC.4, the no-op control] an unconflicted append succeeds and reports the real new revision number", async () => {
    // Stated FIRST and deliberately: without it, a harness that always
    // returns 23505 makes the conflict test below pass while measuring
    // nothing at all.
    const sb = makeScriptedClient([{ data: [{ section: "aboutYou", revision: 4 }], error: null }]);
    const result = await appendSectionRevisions(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      sections: { aboutYou: { content: sectionBody("new text"), claims: [], engine: "gemini", revision: 4 } },
    });

    expect(result.reason).toBeNull();
    expect(result.error).toBeNull();
    expect(result.revisions).toEqual({ aboutYou: 4 });
  });

  it("[RED: export absent -- AC-CONC.2] a 23505 on the insert is reported as reason 'conflict': never retried, never thrown", async () => {
    // Two processes both read newest = N and both try N + 1. The PK
    // (application_id, section, revision) makes the loser's insert raise
    // 23505. The loser must be TOLD, not silently retried into a revision
    // number it did not allocate and not handed an exception its caller has
    // to remember to catch.
    const sb = makeScriptedClient([{ data: null, error: UNIQUE_VIOLATION }]);
    let thrown = null;
    const result = await appendSectionRevisions(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      sections: { aboutYou: { content: sectionBody("new text"), claims: [], engine: "gemini", revision: 4 } },
    }).catch((err) => {
      thrown = err;
      return null;
    });

    expect(thrown, "appendSectionRevisions threw instead of reporting").toBeNull();
    expect(result.reason).toBe("conflict");
    expect(result.revisions).toBeNull();
    const inserts = sb.statements.filter((s) => s.verb === "insert");
    expect(inserts, "a conflict was silently retried").toHaveLength(1);
  });

  it("[RED: export absent -- the DELAYED-PROMISE half of AC-CONC.2] two appends genuinely in flight at once yield exactly one winner", async () => {
    // This is the assertion a same-tick test cannot make. The first insert's
    // promise is held open while the second is issued, so the second really
    // does run against a database the first has not finished writing.
    const sb = makeScriptedClient([
      { deferred: true },
      { data: null, error: UNIQUE_VIOLATION },
    ]);
    const args = {
      applicationId: APP_ID,
      userId: USER_ID,
      sections: { aboutYou: { content: sectionBody("racer"), claims: [], engine: "gemini", revision: 4 } },
    };

    const winner = appendSectionRevisions(sb, args);
    await Promise.resolve();
    const loser = await appendSectionRevisions(sb, args);

    expect(sb.pending, "the first insert was not held open -- this test is not concurrent").toHaveLength(1);
    expect(loser.reason).toBe("conflict");

    sb.pending[0].release({ data: [{ section: "aboutYou", revision: 4 }], error: null });
    const winnerResult = await winner;
    expect(winnerResult.reason).toBeNull();
    expect(winnerResult.revisions).toEqual({ aboutYou: 4 });
  });

  it("[RED: export absent] an over-budget section is refused BEFORE any statement runs", async () => {
    const sb = makeScriptedClient([]);
    const huge = { answer: { lines: [{ text: "x".repeat(200_000), support: null }] } };
    const result = await appendSectionRevisions(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      sections: { aboutYou: { content: huge, claims: [], engine: "gemini", revision: 1 } },
    });
    expect(result.reason).toBe("too-large");
    expect(sb.statements, "a refused append still issued a statement").toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC-RET.1 / AC-RET.2 / AC-RET.3 -- retention
// ---------------------------------------------------------------------------
//
// HARNESS BOUND, stated rather than discovered: these run against
// test/helpers/supabaseFake.js, which throws on `.or()` by design ("a fake
// that silently answers a query it does not understand is worse than no fake
// at all"). If the prune is expressed with `.or(...)`, this harness refuses
// loudly rather than guessing -- express it with `.lte(...)`/`.neq(...)`/
// `.in(...)`, or extend the fake with a citation for `.or()`'s NULL
// semantics. A refusal here is an instrument failure, not a red.

function seedRevisions(count, { section = "aboutYou" } = {}) {
  return makeStatefulSupabase({
    [REVISIONS_TABLE]: Array.from({ length: count }, (_, i) => ({
      id: `rev-${i + 1}`,
      application_id: APP_ID,
      user_id: USER_ID,
      section,
      revision: i + 1,
      content: sectionBody(`revision ${i + 1}`),
      claims: [],
      engine: "gemini",
      content_version: 1,
      restored_from: null,
      created_at: new Date(1_700_000_000_000 + i * 1000).toISOString(),
    })),
  });
}

function survivingRevisions(sb, section = "aboutYou") {
  return sb
    .rows(REVISIONS_TABLE)
    .filter((r) => r.section === section)
    .map((r) => r.revision)
    .sort((a, b) => a - b);
}

describe("pruneSectionRevisions -- retention that can never eat the live revision", () => {
  it("[RED: export absent -- AC-RET.1] a 13th revision leaves exactly the newest 10; 1-3 are gone", async () => {
    const sb = seedRevisions(13);
    await pruneSectionRevisions(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      section: "aboutYou",
      newest: 13,
      liveRevision: 13,
      keep: 10,
    });
    expect(survivingRevisions(sb)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it("[RED: export absent -- AC-RET.2, the contrived guard] the live revision INSIDE the naive prune window is never deleted", async () => {
    // newest=20, keep=10 means the naive window is `revision <= 10`, and the
    // live revision IS 10. Ordinary flows never reach this branch -- restore
    // appends, so the live revision is normally the newest -- which is
    // precisely why it must be driven directly. An unexercised guard is
    // unverified, not proven.
    const sb = seedRevisions(20);
    await pruneSectionRevisions(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      section: "aboutYou",
      newest: 20,
      liveRevision: 10,
      keep: 10,
    });
    const surviving = survivingRevisions(sb);
    expect(surviving, "the prune deleted the revision live_revisions points at").toContain(10);
    expect(surviving).not.toContain(9);
  });

  it("[no-op control] a prune with nothing over the retention bound deletes nothing at all", async () => {
    const sb = seedRevisions(5);
    const result = await pruneSectionRevisions(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      section: "aboutYou",
      newest: 5,
      liveRevision: 5,
      keep: 10,
    });
    expect(result.deleted).toBe(0);
    expect(survivingRevisions(sb)).toEqual([1, 2, 3, 4, 5]);
  });

  it("[RED: export absent -- AC-RET.3] a failed prune reports itself and never throws", async () => {
    const sb = makeScriptedClient([{ data: null, error: { message: "delete blew up" } }]);
    let thrown = null;
    const result = await pruneSectionRevisions(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      section: "aboutYou",
      newest: 20,
      liveRevision: 20,
      keep: 10,
    }).catch((err) => {
      thrown = err;
      return null;
    });
    expect(thrown).toBeNull();
    expect(result.deleted).toBe(0);
    expect(result.error).toContain("delete blew up");
  });
});

// ---------------------------------------------------------------------------
// G1 -- readLiveSectionRevisions' contract, including the `status` delta
// ---------------------------------------------------------------------------

describe("readLiveSectionRevisions -- the pre-claim base read (plan §2.5 G1)", () => {
  function seedLiveTree({ status = "ready", pointer = { aboutYou: 2 }, pack = { version: 1, sections: {}, claims: [] } } = {}) {
    return makeStatefulSupabase({
      interview_prep_packs: [
        {
          id: "pack-1",
          application_id: APP_ID,
          user_id: USER_ID,
          status,
          pack,
          live_revisions: pointer,
        },
      ],
      [REVISIONS_TABLE]: [
        {
          id: "rev-1",
          application_id: APP_ID,
          user_id: USER_ID,
          section: "aboutYou",
          revision: 1,
          content: sectionBody("older"),
          claims: [],
          engine: "gemini",
          created_at: "2026-09-01T00:00:00.000Z",
        },
        {
          id: "rev-2",
          application_id: APP_ID,
          user_id: USER_ID,
          section: "aboutYou",
          revision: 2,
          content: sectionBody("live"),
          claims: [],
          engine: "embedded",
          created_at: "2026-09-02T00:00:00.000Z",
        },
      ],
    });
  }

  it("[RED: export absent] returns `status` -- WITHOUT it restorePayload cannot tell 'no content' from 'blanked mid-attempt'", () => {
    // The whole of G1 rests on this one field. A read that omits it forces
    // the caller to guess, and the guess that loses data -- reading a blanked
    // pack as "this row has nothing, so restore nothing" -- is the one that
    // looks correct from every angle except the candidate's.
    return readLiveSectionRevisions(seedLiveTree({ status: "running" }), {
      applicationId: APP_ID,
      userId: USER_ID,
    }).then((base) => {
      expect(base.status).toBe("running");
    });
  });

  it("[RED: export absent] resolves the live body per section from the pointer, with its own engine", async () => {
    const base = await readLiveSectionRevisions(seedLiveTree(), { applicationId: APP_ID, userId: USER_ID });
    expect(base.liveRevisions).toEqual({ aboutYou: 2 });
    expect(base.sections.aboutYou.revision).toBe(2);
    expect(base.sections.aboutYou.engine).toBe("embedded");
    expect(base.sections.aboutYou.content.answer.lines[0].text).toBe("live");
    // newestBySection counts every revision, live or not.
    expect(base.newestBySection.aboutYou).toBe(2);
  });

  it("[RED: export absent] a PRE-N45 row (empty pointer) returns empty sections AND the stored pack, so the caller has a base at all", async () => {
    const stored = { version: 1, sections: { aboutYou: sectionBody("legacy") }, claims: [] };
    const base = await readLiveSectionRevisions(seedLiveTree({ pointer: {}, pack: stored }), {
      applicationId: APP_ID,
      userId: USER_ID,
    });
    expect(base.sections).toEqual({});
    expect(base.liveRevisions).toEqual({});
    expect(JSON.stringify(base.pack)).toBe(JSON.stringify(stored));
  });
});

// ---------------------------------------------------------------------------
// F-R9-2 (fix round, MAJOR) -- readLiveSectionRevisions' own second read must
// be narrowed and targeted, not full-projection over every row: unbounded,
// it cost 471KB on a single PATCH and 481KB on a single POST at a 48-row
// history (verify.r9.md), exactly the shape r8 blocked GET's own read on,
// unnoticed on this function because no GET probe ever reaches it (GET's own
// packs read is readPrepPack's, not this one).
// ---------------------------------------------------------------------------

describe("readLiveSectionRevisions -- F-R9-2: the second read is narrowed and targeted, not every row in full", () => {
  function seedManyRevisions(perSectionCount) {
    const rows = [];
    let n = 0;
    for (const section of PREP_SECTION_NAMES) {
      for (let i = 1; i <= perSectionCount; i += 1) {
        n += 1;
        rows.push({
          id: `rev-${n}`,
          application_id: APP_ID,
          user_id: USER_ID,
          section,
          revision: i,
          content: sectionBody(`${section} revision ${i}`),
          claims: [],
          engine: "gemini",
          restored_from: null,
          content_version: 1,
          created_at: new Date(1_700_000_000_000 + n * 1000).toISOString(),
        });
      }
    }
    return makeStatefulSupabase({
      interview_prep_packs: [
        {
          id: "pack-1",
          application_id: APP_ID,
          user_id: USER_ID,
          status: "ready",
          pack: { version: 1, sections: {}, claims: [] },
          live_revisions: Object.fromEntries(PREP_SECTION_NAMES.map((s) => [s, perSectionCount])),
        },
      ],
      [REVISIONS_TABLE]: rows,
    });
  }

  it("the narrow scan never selects content or claims", async () => {
    const sb = seedManyRevisions(12);
    await readLiveSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID });
    const revisionSelects = sb.calls.filter((c) => c.table === REVISIONS_TABLE && c.verb === "select");
    const narrowCall = revisionSelects.find((c) => !c.filters.some((f) => f.operator === "eq" && f.column === "revision"));
    expect(narrowCall, "no unscoped scan over the revisions table was issued at all").toBeTruthy();
    expect(narrowCall.select).not.toContain("content");
    expect(narrowCall.select).not.toContain("claims");
  });

  it("a 4-section, 12-revisions-each history (48 rows) reads exactly 4 targeted bodies, never 48", async () => {
    const sb = seedManyRevisions(12);
    await readLiveSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID });
    const revisionSelects = sb.calls.filter((c) => c.table === REVISIONS_TABLE && c.verb === "select");
    const targetedCalls = revisionSelects.filter((c) => c.filters.some((f) => f.operator === "eq" && f.column === "revision"));
    expect(
      targetedCalls,
      "the pointer names one revision per section (4 total) -- the targeted-body reads must equal that, not the table's row count",
    ).toHaveLength(PREP_SECTION_NAMES.length);
    for (const call of targetedCalls) {
      expect(call.select).toContain("content");
      const eqFilters = call.filters.filter((f) => f.operator === "eq").map((f) => [f.column, f.value]);
      expect(eqFilters).toContainEqual(["revision", 12]);
    }
  });

  it("newestBySection and the live bodies both stay correct under the split read", async () => {
    const sb = seedManyRevisions(12);
    const base = await readLiveSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(base.error).toBeNull();
    for (const name of PREP_SECTION_NAMES) {
      expect(base.newestBySection[name]).toBe(12);
      expect(base.liveRevisions[name]).toBe(12);
      expect(base.sections[name].content.answer.lines[0].text).toBe(`${name} revision 12`);
    }
  });
});

// ---------------------------------------------------------------------------
// Plan risk R5 -- readPrepPack's projection literal
// ---------------------------------------------------------------------------

describe("readPrepPack -- the widened projection (plan risk R5)", () => {
  it("[RED on HEAD: the literal is still 'status, pack'] the packs projection names live_revisions", () => {
    // R5 is silent: widen the docstring and not the literal, and
    // `liveRevisions` is `{}` forever -- every restore then writes `{}` and
    // history quietly stops working with no error anywhere. No test in the
    // tree asserts this literal today (measured: zero hits for "status, pack"
    // in prepStore.test.js).
    const sb = makeSupabase({
      interview_prep_packs: { data: { status: "ready", pack: null, live_revisions: { aboutYou: 3 } } },
      interview_prep_spend: { data: null },
    });
    return readPrepPack(sb, { applicationId: APP_ID, userId: USER_ID }).then(() => {
      const projections = sb.calls.interview_prep_packs.select.map(([columns]) => columns);
      expect(projections[0]).toContain("live_revisions");
      expect(projections[0]).not.toBe("*");
    });
  });

  it("[RED on HEAD: the field does not exist on the return] the returned row carries liveRevisions from the column", async () => {
    const sb = makeSupabase({
      interview_prep_packs: { data: { status: "ready", pack: null, live_revisions: { aboutYou: 3 } } },
      interview_prep_spend: { data: null },
    });
    const result = await readPrepPack(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(result.liveRevisions).toEqual({ aboutYou: 3 });
  });
});

// ---------------------------------------------------------------------------
// AC-UX.1 / AC-UX.2 -- what a revision LIST may and may not carry
// ---------------------------------------------------------------------------

describe("listSectionRevisions / readSectionRevision -- the picker's data, and only the picker's data", () => {
  it("[RED: export absent -- AC-UX.2] a revision list never ships content or claims bodies", async () => {
    const sb = makeScriptedClient([
      {
        data: [
          { section: "aboutYou", revision: 2, engine: "gemini", restored_from: null, created_at: "2026-09-02T00:00:00.000Z" },
          { section: "aboutYou", revision: 1, engine: "embedded", restored_from: null, created_at: "2026-09-01T00:00:00.000Z" },
        ],
        error: null,
      },
    ]);
    const { revisions } = await listSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID });

    const projection = sb.statements[0].select;
    expect(projection, "the list used select('*') -- ten full bodies for a picker").not.toBe("*");
    expect(projection).not.toContain("content");
    expect(projection).not.toContain("claims");
    for (const entry of revisions.aboutYou) {
      expect(entry).not.toHaveProperty("content");
      expect(entry).not.toHaveProperty("claims");
    }
  });

  it("[RED: export absent -- AC-UX.1] every listed revision carries restoredFrom, non-null exactly when it came from a restore", async () => {
    const sb = makeScriptedClient([
      {
        data: [
          { section: "aboutYou", revision: 3, engine: "gemini", restored_from: 1, created_at: "2026-09-03T00:00:00.000Z" },
          { section: "aboutYou", revision: 2, engine: "gemini", restored_from: null, created_at: "2026-09-02T00:00:00.000Z" },
        ],
        error: null,
      },
    ]);
    const { revisions } = await listSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(revisions.aboutYou[0].restoredFrom).toBe(1);
    expect(revisions.aboutYou[1].restoredFrom).toBeNull();
  });

  it("[RED: export absent] readSectionRevision fetches ONE exact (section, revision) and returns its body", async () => {
    const sb = makeScriptedClient([
      {
        data: {
          content: sectionBody("the old one"),
          claims: [],
          engine: "gemini",
          restored_from: null,
          content_version: 1,
        },
        error: null,
      },
    ]);
    const result = await readSectionRevision(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      section: "aboutYou",
      revision: 2,
    });
    expect(result.content.answer.lines[0].text).toBe("the old one");
    const filters = sb.statements[0].filters.filter((f) => f.op === "eq").map((f) => [f.column, f.value]);
    expect(filters).toContainEqual(["section", "aboutYou"]);
    expect(filters).toContainEqual(["revision", 2]);
    expect(filters).toContainEqual(["user_id", USER_ID]);
  });
});

// ---------------------------------------------------------------------------
// F-m14 (fix round) -- `restorable`: whether PATCH's own gate
// (sectionRevisionIsIntact, prepMerge.js) would actually restore this row,
// so a picker can skip offering a Restore control known to only ever 409.
// ---------------------------------------------------------------------------

describe("listSectionRevisions -- F-m14: a restorable flag for a picker that must not offer a dead Restore button", () => {
  it("marks an intact revision restorable:true -- its own claims cover everything its own content cites", async () => {
    const CLAIM_ID = "c/aboutYou/aaaa1111bbbb2222";
    const sb = makeScriptedClient([
      {
        data: [{ section: "aboutYou", revision: 1, engine: "gemini", restored_from: null, created_at: "2026-09-01T00:00:00.000Z" }],
        error: null,
      },
      {
        data: [
          {
            section: "aboutYou",
            revision: 1,
            content: { answer: { lines: [{ text: "Cited.", support: { kind: "claim", claimId: CLAIM_ID } }] } },
            claims: [{ id: CLAIM_ID, text: "Cited.", sourceUrl: "https://acme.example/x" }],
          },
        ],
        error: null,
      },
    ]);
    const { revisions } = await listSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(revisions.aboutYou[0].restorable, "an intact revision must be marked restorable").toBe(true);
  });

  it("marks a degraded revision restorable:false -- its content cites a claim its own claims do not carry", async () => {
    const CLAIM_ID = "c/aboutYou/cccc3333dddd4444";
    const sb = makeScriptedClient([
      {
        data: [{ section: "aboutYou", revision: 1, engine: "gemini", restored_from: null, created_at: "2026-09-01T00:00:00.000Z" }],
        error: null,
      },
      {
        data: [
          {
            section: "aboutYou",
            revision: 1,
            content: { answer: { lines: [{ text: "Cited but the claim is gone.", support: { kind: "claim", claimId: CLAIM_ID } }] } },
            claims: [],
          },
        ],
        error: null,
      },
    ]);
    const { revisions } = await listSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(revisions.aboutYou[0].restorable, "a degraded revision must not be marked restorable").toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F-A3 (fix round) -- the SECOND (intact-computing) read's own projection,
// filters, order and bound must be pinned, not just its returned boolean.
// Without this, a mutation of statements[1] alone -- the wrong columns, the
// wrong tenant scoping, the wrong breadth -- changes nothing this file's
// other tests can see.
// ---------------------------------------------------------------------------

describe("listSectionRevisions -- F-A3: the second read's own query is pinned, not just its answer", () => {
  function twoStatementScript() {
    return makeScriptedClient([
      { data: [], error: null },
      { data: [], error: null },
    ]);
  }

  it("the second statement selects content and claims -- never the list's own narrower projection", async () => {
    const sb = twoStatementScript();
    await listSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID });
    const second = sb.statements[1];
    expect(second.select, "the second read used the list's own projection -- content/claims never arrive, every row reads intact by default").toContain("content");
    expect(second.select).toContain("claims");
  });

  it("the second statement is scoped to both application_id and user_id", async () => {
    const sb = twoStatementScript();
    await listSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID });
    const filters = sb.statements[1].filters.filter((f) => f.op === "eq").map((f) => [f.column, f.value]);
    expect(filters, "the second read is missing its application_id scope").toContainEqual(["application_id", APP_ID]);
    expect(filters, "the second read is missing its user_id scope").toContainEqual(["user_id", USER_ID]);
  });

  // CORRECTED (fix round F-R9-1, authorized): this used to assert
  // `limitFilter.value === PREP_SECTION_REVISIONS_MAX * PREP_SECTION_NAMES.length`
  // -- the right total SIZE but the wrong SHAPE, pinning a single GLOBAL
  // `ORDER BY revision DESC LIMIT 40` as if it were correct. The display cap
  // is PER SECTION (`limit` rows each, see the per-section `.eq("section",
  // ...)` bound the fix adds below), so a global ordering hands the whole
  // budget to whichever section carries the highest revision numbers -- a
  // pack with 41 revisions of one section and 1 of each other left three of
  // four sections with no `restorable` key at all (verify.r9.md F-R9-1; the
  // coverage half of that regression is pinned directly by the 41/1/1/1 test
  // below). The corrected assertion is BEHAVIOURAL, not arithmetic: the
  // second statement is scoped to ONE section and bounded to `limit` rows
  // for THAT section alone, never multiplied by the section count.
  it("the second statement is scoped to one section and bounded to `limit` rows for that section (F-R9-1)", async () => {
    const sb = twoStatementScript();
    await listSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID });
    const second = sb.statements[1];
    const order = second.filters.find((f) => f.op === "order");
    expect(order, "the second read carries no ORDER BY -- a LIMIT with no order returns an arbitrary slice").toBeTruthy();
    expect(order.column).toBe("revision");
    expect(order.value).toMatchObject({ ascending: false });
    const sectionFilter = second.filters.find((f) => f.op === "eq" && f.column === "section");
    expect(sectionFilter, "the second read is not scoped to one section -- the bound is global again").toBeTruthy();
    const limitFilter = second.filters.find((f) => f.op === "limit");
    expect(limitFilter, "the second read carries no LIMIT -- it is unbounded again").toBeTruthy();
    expect(limitFilter.value, "the per-section bound was multiplied by the section count again").toBe(PREP_SECTION_REVISIONS_MAX);
  });
});

// ---------------------------------------------------------------------------
// F-R9-1 (fix round, MAJOR) -- the bound must be per SECTION, not global: an
// uneven history (one section regenerated repeatedly, the others left at
// whatever depth a whole-pack generation gave them -- exactly what
// per-section regeneration produces) must never starve other sections' own
// `restorable` coverage.
// ---------------------------------------------------------------------------

describe("listSectionRevisions -- F-R9-1: the bound is per section, so an uneven history cannot starve it", () => {
  function seedUnevenRevisions(counts) {
    const rows = [];
    let n = 0;
    for (const [section, count] of Object.entries(counts)) {
      for (let i = 1; i <= count; i += 1) {
        n += 1;
        rows.push({
          id: `rev-${n}`,
          application_id: APP_ID,
          user_id: USER_ID,
          section,
          revision: i,
          content: sectionBody(`${section} revision ${i}`),
          claims: [],
          engine: "gemini",
          restored_from: null,
          content_version: 1,
          created_at: new Date(1_700_000_000_000 + n * 1000).toISOString(),
        });
      }
    }
    return makeStatefulSupabase({ [REVISIONS_TABLE]: rows });
  }

  it("a 41/1/1/1 history (44 rows, four over the old global bound) still carries a `restorable` key on every entry every section shows", async () => {
    const sb = seedUnevenRevisions({ aboutYou: 41, whyRole: 1, askThem: 1, stages: 1 });
    const { revisions, error } = await listSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(error).toBeNull();
    for (const name of PREP_SECTION_NAMES) {
      const list = revisions[name];
      expect(list, `section "${name}" is missing from the list entirely`).toBeTruthy();
      expect(list.length, `section "${name}" shows no entries`).toBeGreaterThan(0);
      for (const entry of list) {
        expect(
          entry,
          `revision ${entry.revision} of "${name}" carries no 'restorable' key -- the per-section bound did not cover it`,
        ).toHaveProperty("restorable");
      }
    }
  });

  it("[no-op control] a level 10/10/10/10 history (within the old AND new bound) already carried coverage everywhere -- this is not a fixture artifact", async () => {
    const sb = seedUnevenRevisions({ aboutYou: 10, whyRole: 10, askThem: 10, stages: 10 });
    const { revisions } = await listSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID });
    for (const name of PREP_SECTION_NAMES) {
      for (const entry of revisions[name]) {
        expect(entry).toHaveProperty("restorable");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// F-A5 / F-B1's own minor (fix round) -- a row the second read never covers
// (a read error, or one outside the bound) carries NO `restorable` key at
// all: never `false`, which is a claim the code could not verify, and never
// `true` by silent default either.
// ---------------------------------------------------------------------------

describe("listSectionRevisions -- F-A5: an unknown row omits `restorable`, it never fails open OR closed by default", () => {
  it("a second-read ERROR leaves every entry without a `restorable` key -- not `false`", async () => {
    const sb = makeScriptedClient([
      {
        data: [{ section: "aboutYou", revision: 1, engine: "gemini", restored_from: null, created_at: "2026-09-01T00:00:00.000Z" }],
        error: null,
      },
      { data: null, error: { message: "connection reset" } },
    ]);
    const { revisions, error } = await listSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(error, "a failed SECOND read must not fail the whole list").toBeNull();
    expect(revisions.aboutYou[0]).not.toHaveProperty("restorable");
  });

  it("[F-A4] a second-read REJECTION (a dropped connection, not a returned error) is caught the same way -- GET must never die for this boolean", async () => {
    const sb = makeScriptedClient([
      {
        data: [{ section: "aboutYou", revision: 1, engine: "gemini", restored_from: null, created_at: "2026-09-01T00:00:00.000Z" }],
        error: null,
      },
      { reject: new Error("socket hang up") },
    ]);
    const { revisions, error } = await listSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(error, "a rejected SECOND read must not fail the whole list").toBeNull();
    expect(revisions.aboutYou[0]).not.toHaveProperty("restorable");
  });

  it("[negative control] a FIRST-read rejection is still a real failure -- this function's original contract for that read is unchanged", async () => {
    const sb = makeScriptedClient([{ reject: new Error("socket hang up") }]);
    await expect(listSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID })).rejects.toThrow("socket hang up");
  });

  it("[no-op control] a row the second read DOES cover still gets a real boolean, not an omission", async () => {
    // Without this, a "fix" that always omits `restorable` -- never computing
    // it at all -- would satisfy every assertion above for the wrong reason.
    const CLAIM_ID = "c/aboutYou/eeee5555ffff6666";
    const sb = makeScriptedClient([
      {
        data: [{ section: "aboutYou", revision: 1, engine: "gemini", restored_from: null, created_at: "2026-09-01T00:00:00.000Z" }],
        error: null,
      },
      {
        data: [
          {
            section: "aboutYou",
            revision: 1,
            content: { answer: { lines: [{ text: "Cited.", support: { kind: "claim", claimId: CLAIM_ID } }] } },
            claims: [{ id: CLAIM_ID, text: "Cited.", sourceUrl: "https://acme.example/x" }],
          },
        ],
        error: null,
      },
    ]);
    const { revisions } = await listSectionRevisions(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(revisions.aboutYou[0]).toHaveProperty("restorable", true);
  });
});
