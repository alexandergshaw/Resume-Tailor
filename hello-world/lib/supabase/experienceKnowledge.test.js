// The falsifier for the knowledge-page scope summary/question storage layer.
// WRITTEN BEFORE THE MODULE EXISTED, against the plan's stated contract
// (3-plan-knowledge.md, Wave 4) and the migration's own header
// (supabase/migrations/20260906010000_experience_knowledge.sql), which is
// the authority for every claim below about what Postgres will and will not
// accept.
//
// Two doubling strategies, deliberately, mirroring the plan's own split:
//
//   * A hand-rolled call-recording chain (`chainDouble`, the shape
//     lib/supabase/applicationDigests.test.js's `supabaseDouble` uses) for
//     everything about WHICH keys reach the row PostgREST is handed, and the
//     exact `onConflict` string — a recorder proves what was SENT, which is
//     all a payload-shape assertion needs.
//   * `test/helpers/supabaseFake.js`'s real, stateful `makeStatefulSupabase`
//     for the one claim a call recorder cannot prove at all: that
//     REGENERATING A SUMMARY REPLACES THE STORED ROW RATHER THAN APPENDING A
//     SECOND ONE. That fake now models a `GENERATED ALWAYS ... STORED`
//     column as an upsert conflict target via `opts.generatedColumns` — see
//     its own header, item [8] — specifically so a payload that CORRECTLY
//     omits `scope_key` still resolves to the one existing row instead of
//     silently becoming a second INSERT. Declaring that generator here is
//     what makes the replace-semantics test meaningful instead of
//     accidentally measuring the append bug the harness fix exists to catch.

import { describe, it, expect, vi } from "vitest";
import { makeStatefulSupabase } from "../../test/helpers/supabaseFake.js";
import { scopeKeyFor } from "@/lib/experience/knowledgeScope.js";
import {
  SUMMARY_TABLE,
  QUESTION_TABLE,
  SUMMARY_CONFLICT,
  QUESTION_PAGE_SIZE,
  getSummary,
  upsertSummary,
  listQuestions,
  insertQuestion,
  deleteQuestion,
  clearQuestions,
} from "./experienceKnowledge.js";

const USER_ID = "user-1";
const PAGE_ID = "11111111-1111-1111-1111-111111111111";

// A double for exactly the shape lib/supabase/applicationDigests.test.js's
// own `supabaseDouble` uses, generalised the way
// test/helpers/supabaseFake.js's real builder is: every method returns the
// SAME chain object so a statement can terminate at any position
// (`.maybeSingle()` for getSummary/upsertSummary/insertQuestion, a bare
// `.limit()` for listQuestions, a bare `.eq()` for deleteQuestion, a bare
// `.select()` for clearQuestions' RETURNING read) — the chain itself is
// thenable, resolving to the ONE configured `{ data, error }` no matter
// which method was called last. Records every call so a test can assert the
// row/onConflict/filters PostgREST was actually handed.
function chainDouble({ data = null, error = null } = {}) {
  const resolved = { data, error };
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    upsert: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => resolved),
    then: (resolve, reject) => Promise.resolve(resolved).then(resolve, reject),
  };
  const client = { from: vi.fn(() => chain) };
  return { client, chain };
}

// The row object actually handed to PostgREST by upsertSummary.
async function summaryRowFrom(fields) {
  const { client, chain } = chainDouble({ data: { id: "row-1", ...fields } });
  await upsertSummary(client, USER_ID, fields);
  expect(chain.upsert).toHaveBeenCalledTimes(1);
  return chain.upsert.mock.calls[0][0];
}

// The row object actually handed to PostgREST by insertQuestion.
async function questionRowFrom(fields) {
  const { client, chain } = chainDouble({ data: { id: "row-1", ...fields } });
  await insertQuestion(client, USER_ID, fields);
  expect(chain.insert).toHaveBeenCalledTimes(1);
  return chain.insert.mock.calls[0][0];
}

describe("the generated column is NEVER written — scope_key is absent from every payload", () => {
  it("[control] upsertSummary never sends scope_key, even for the root scope", async () => {
    const row = await summaryRowFrom({ scopePageId: null, summary: "x" });
    expect(Object.prototype.hasOwnProperty.call(row, "scope_key")).toBe(false);
    expect(row.scope_page_id).toBe(null);
  });

  it("upsertSummary drops a caller-supplied scope_key/scopeKey rather than forwarding it", async () => {
    // Positive control: proves the omission is deliberate filtering, not an
    // accident of `fields` never containing the key in the first place.
    const row = await summaryRowFrom({ scopePageId: PAGE_ID, scope_key: "evil", scopeKey: "evil", summary: "x" });
    expect(Object.prototype.hasOwnProperty.call(row, "scope_key")).toBe(false);
    expect(row.scope_page_id).toBe(PAGE_ID);
  });

  it("insertQuestion never sends scope_key either", async () => {
    const row = await questionRowFrom({ scopePageId: PAGE_ID, question: "What is the comp band?" });
    expect(Object.prototype.hasOwnProperty.call(row, "scope_key")).toBe(false);
  });

  it("insertQuestion drops a caller-supplied scope_key/scopeKey", async () => {
    const row = await questionRowFrom({
      scopePageId: null,
      scope_key: "evil",
      scopeKey: "evil",
      question: "q",
    });
    expect(Object.prototype.hasOwnProperty.call(row, "scope_key")).toBe(false);
  });

  it("upsertSummary conflicts on exactly \"user_id,scope_key\"", async () => {
    const { client, chain } = chainDouble({ data: { id: "row-1" } });
    await upsertSummary(client, USER_ID, { scopePageId: null, summary: "x" });
    expect(chain.upsert.mock.calls[0][1]).toEqual({ onConflict: SUMMARY_CONFLICT });
    expect(SUMMARY_CONFLICT).toBe("user_id,scope_key");
  });
});

describe("upsertSummary — the writable-column whitelist", () => {
  it("carries summary, source_pages, retrieval_outcome and generated_at together on a success write", async () => {
    const outcome = { version: 1, counts: { pagesInScope: 3 } };
    const row = await summaryRowFrom({
      scopePageId: PAGE_ID,
      summary: "# Overview",
      source_pages: [{ id: "p1", included: true }],
      retrieval_outcome: outcome,
      model: "gemini-2.5-flash",
      engine: "gemini",
      status: "ready",
      error: null,
      generated_at: "2026-09-06T00:00:00.000Z",
    });
    expect(row).toMatchObject({
      user_id: USER_ID,
      scope_page_id: PAGE_ID,
      summary: "# Overview",
      source_pages: [{ id: "p1", included: true }],
      retrieval_outcome: outcome,
      model: "gemini-2.5-flash",
      engine: "gemini",
      status: "ready",
      error: null,
      generated_at: "2026-09-06T00:00:00.000Z",
    });
    expect(typeof row.updated_at).toBe("string");
  });

  it("a failure write never includes generated_at — omitted, not null", async () => {
    const row = await summaryRowFrom({
      scopePageId: PAGE_ID,
      status: "failed",
      error: "model timed out",
      retrieval_outcome: null,
    });
    expect(Object.prototype.hasOwnProperty.call(row, "generated_at")).toBe(false);
    expect(row.status).toBe("failed");
    expect(row.error).toBe("model timed out");
  });

  it("generated_at is refused (omitted) for null, a Date, an epoch number and an empty string", async () => {
    for (const bad of [null, new Date(), Date.now(), ""]) {
      const row = await summaryRowFrom({ scopePageId: PAGE_ID, status: "ready", generated_at: bad });
      expect(Object.prototype.hasOwnProperty.call(row, "generated_at")).toBe(false);
    }
  });

  it("writes an EXPLICIT null for retrieval_outcome — NULL and absent mean different things", async () => {
    const row = await summaryRowFrom({ scopePageId: PAGE_ID, status: "failed", retrieval_outcome: null });
    expect(Object.prototype.hasOwnProperty.call(row, "retrieval_outcome")).toBe(true);
    expect(row.retrieval_outcome).toBe(null);
  });

  it("refuses a retrieval_outcome that is not a plain object (and not null)", async () => {
    for (const bad of ["{}", 7, true, undefined, [1, 2, 3]]) {
      const row = await summaryRowFrom({ scopePageId: PAGE_ID, status: "ready", retrieval_outcome: bad });
      expect(Object.prototype.hasOwnProperty.call(row, "retrieval_outcome")).toBe(false);
    }
  });

  it("writes an EXPLICIT null for error, clearing a previous failure", async () => {
    const row = await summaryRowFrom({ scopePageId: PAGE_ID, status: "ready", error: null });
    expect(Object.prototype.hasOwnProperty.call(row, "error")).toBe(true);
    expect(row.error).toBe(null);
  });

  it("[positive control] drops a field the whitelist does not name", async () => {
    const row = await summaryRowFrom({
      scopePageId: PAGE_ID,
      status: "ready",
      notARealColumn: "x",
      id: "attacker-supplied",
    });
    expect(row.notARealColumn).toBeUndefined();
    expect(row.id).toBeUndefined();
  });

  it("returns the error rather than throwing", async () => {
    const { client } = chainDouble({ data: null, error: { message: "nope" } });
    await expect(upsertSummary(client, USER_ID, { scopePageId: PAGE_ID, status: "ready" })).resolves.toEqual({
      summary: null,
      error: "nope",
    });
  });

  it("never throws even when the client itself throws synchronously", async () => {
    const client = {
      from: vi.fn(() => {
        throw new Error("boom");
      }),
    };
    await expect(upsertSummary(client, USER_ID, { scopePageId: PAGE_ID, status: "ready" })).resolves.toMatchObject({
      summary: null,
    });
  });
});

describe("upsertSummary — REGENERATION REPLACES, NEVER APPENDS", () => {
  // This is the one test in the whole feature that only means what it says
  // because of the Wave 1b harness fix. `SUMMARY_CONFLICT` is
  // "user_id,scope_key", and `upsertSummary` — correctly — never sends
  // `scope_key` in its payload, because Postgres refuses a value for a
  // generated column. Without `opts.generatedColumns` declared below, the
  // fake's conflict resolution reads `payload["scope_key"]`, gets
  // `undefined`, never finds the existing row, and BOTH calls insert —
  // which is exactly the defect this migration's header and Wave 1b's own
  // canary (test/helpers/supabaseFake.generated.test.js) exist to name. So
  // this generator function is not a test convenience; it is the fake
  // standing in for the one thing only Postgres itself can otherwise prove.
  function makeSb() {
    return makeStatefulSupabase(
      { [SUMMARY_TABLE]: [] },
      {
        generatedColumns: {
          [SUMMARY_TABLE]: {
            scope_key: (row) => scopeKeyFor(row.scope_page_id),
          },
        },
      },
    );
  }

  it("regenerating the ROOT scope's summary replaces the one stored row", async () => {
    const sb = makeSb();
    await upsertSummary(sb, USER_ID, { scopePageId: null, summary: "first draft", status: "ready" });
    await upsertSummary(sb, USER_ID, { scopePageId: null, summary: "second draft", status: "ready" });

    const rows = sb.rows(SUMMARY_TABLE).filter((r) => r.user_id === USER_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0].summary).toBe("second draft");
  });

  it("regenerating a PAGE scope's summary replaces the one stored row", async () => {
    const sb = makeSb();
    await upsertSummary(sb, USER_ID, { scopePageId: PAGE_ID, summary: "v1", status: "ready" });
    await upsertSummary(sb, USER_ID, { scopePageId: PAGE_ID, summary: "v2", status: "ready" });
    await upsertSummary(sb, USER_ID, { scopePageId: PAGE_ID, summary: "v3", status: "ready" });

    const rows = sb.rows(SUMMARY_TABLE).filter((r) => r.user_id === USER_ID && r.scope_page_id === PAGE_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0].summary).toBe("v3");
  });

  it("root scope and a page scope are DIFFERENT rows — replace never crosses scopes", async () => {
    const sb = makeSb();
    await upsertSummary(sb, USER_ID, { scopePageId: null, summary: "root summary", status: "ready" });
    await upsertSummary(sb, USER_ID, { scopePageId: PAGE_ID, summary: "page summary", status: "ready" });

    const rows = sb.rows(SUMMARY_TABLE).filter((r) => r.user_id === USER_ID);
    expect(rows).toHaveLength(2);
  });

  it("a regeneration that fails still replaces the prior row's status, not appends a failed sibling", async () => {
    const sb = makeSb();
    await upsertSummary(sb, USER_ID, {
      scopePageId: PAGE_ID,
      summary: "good summary",
      status: "ready",
      generated_at: "2026-09-06T00:00:00.000Z",
    });
    await upsertSummary(sb, USER_ID, { scopePageId: PAGE_ID, status: "failed", error: "model timed out" });

    const rows = sb.rows(SUMMARY_TABLE).filter((r) => r.user_id === USER_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("failed");
    // The column-wise upsert means the PRIOR summary text and generated_at
    // survive a failure write that never mentioned them — this is the
    // documented, intentional behaviour, not a bug this test is hunting for.
    expect(rows[0].summary).toBe("good summary");
    expect(rows[0].generated_at).toBe("2026-09-06T00:00:00.000Z");
  });

  it("getSummary reads back exactly the replaced row by its scope key", async () => {
    const sb = makeSb();
    await upsertSummary(sb, USER_ID, { scopePageId: PAGE_ID, summary: "v1", status: "ready" });
    await upsertSummary(sb, USER_ID, { scopePageId: PAGE_ID, summary: "v2", status: "ready" });

    const { summary, error } = await getSummary(sb, USER_ID, scopeKeyFor(PAGE_ID));
    expect(error).toBeNull();
    expect(summary.summary).toBe("v2");
  });
});

describe("getSummary — a failed read is NOT a cache miss", () => {
  it("no row yet: { summary: null, error: null }", async () => {
    const { client } = chainDouble({ data: null, error: null });
    await expect(getSummary(client, USER_ID, scopeKeyFor(null))).resolves.toEqual({ summary: null, error: null });
  });

  it("a read failure: { summary: null, error: <message> } — DIFFERENT from the no-row case", async () => {
    const { client } = chainDouble({ data: null, error: { message: "connection reset" } });
    const result = await getSummary(client, USER_ID, scopeKeyFor(null));
    expect(result.error).toBe("connection reset");
    expect(result.summary).toBeNull();
    // The discriminating assertion: this result must NOT equal the no-row
    // result above, or a caller cannot tell "generate one" from "retry".
    expect(result).not.toEqual({ summary: null, error: null });
  });

  it("scopes the read by user_id AND scope_key explicitly", async () => {
    const { client, chain } = chainDouble({ data: null, error: null });
    await getSummary(client, USER_ID, "scope-key-1");
    expect(chain.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(chain.eq).toHaveBeenCalledWith("scope_key", "scope-key-1");
  });

  it("never throws", async () => {
    const client = {
      from: vi.fn(() => {
        throw new Error("boom");
      }),
    };
    await expect(getSummary(client, USER_ID, "k")).resolves.toEqual({
      summary: null,
      error: "boom",
    });
  });
});

describe("insertQuestion — appends, never upserts", () => {
  it("calls insert, never upsert", async () => {
    const { client, chain } = chainDouble({ data: { id: "q1" } });
    await insertQuestion(client, USER_ID, { scopePageId: PAGE_ID, question: "q" });
    expect(chain.insert).toHaveBeenCalledTimes(1);
    expect(chain.upsert).not.toHaveBeenCalled();
  });

  it("requires question text", async () => {
    const { client } = chainDouble();
    const result = await insertQuestion(client, USER_ID, { scopePageId: PAGE_ID, question: "   " });
    expect(result.question).toBeNull();
    expect(typeof result.error).toBe("string");
  });

  it("carries answer, citations, model, engine, status through", async () => {
    const row = await questionRowFrom({
      scopePageId: PAGE_ID,
      question: "What is the comp band?",
      answer: "Between L4 and L5.",
      citations: [{ pageId: "p1" }],
      model: "gemini-2.5-flash",
      engine: "gemini",
      status: "ready",
    });
    expect(row).toMatchObject({
      user_id: USER_ID,
      scope_page_id: PAGE_ID,
      question: "What is the comp band?",
      answer: "Between L4 and L5.",
      citations: [{ pageId: "p1" }],
      model: "gemini-2.5-flash",
      engine: "gemini",
      status: "ready",
    });
  });

  it("writes all THREE states of answered_from_pages explicitly, including false", async () => {
    for (const value of [true, false, null]) {
      const row = await questionRowFrom({ scopePageId: PAGE_ID, question: "q", answered_from_pages: value });
      expect(Object.prototype.hasOwnProperty.call(row, "answered_from_pages")).toBe(true);
      expect(row.answered_from_pages).toBe(value);
    }
  });

  it("a whitelist gated on truthiness would drop `false` — this proves it does not", async () => {
    const row = await questionRowFrom({ scopePageId: PAGE_ID, question: "q", answered_from_pages: false });
    expect(row.answered_from_pages).toBe(false);
  });

  it("writes an explicit null retrieval_outcome", async () => {
    const row = await questionRowFrom({ scopePageId: PAGE_ID, question: "q", retrieval_outcome: null });
    expect(Object.prototype.hasOwnProperty.call(row, "retrieval_outcome")).toBe(true);
    expect(row.retrieval_outcome).toBeNull();
  });

  it("a failure write still carries the question and error, with no answer required", async () => {
    const row = await questionRowFrom({
      scopePageId: PAGE_ID,
      question: "What is the comp band?",
      status: "failed",
      error: "model timed out",
    });
    expect(row.question).toBe("What is the comp band?");
    expect(row.status).toBe("failed");
    expect(row.error).toBe("model timed out");
    expect(row.answer).toBeUndefined();
  });

  it("[positive control] drops a field the whitelist does not name", async () => {
    const row = await questionRowFrom({ scopePageId: PAGE_ID, question: "q", notARealColumn: "x" });
    expect(row.notARealColumn).toBeUndefined();
  });

  it("returns the error rather than throwing", async () => {
    const { client } = chainDouble({ data: null, error: { message: "nope" } });
    await expect(insertQuestion(client, USER_ID, { scopePageId: PAGE_ID, question: "q" })).resolves.toEqual({
      question: null,
      error: "nope",
    });
  });
});

describe("listQuestions — newest first, with hasMore computed off a +1 fetch", () => {
  it("hasMore is true when the fetch returns one more row than the page size", async () => {
    const rows = Array.from({ length: QUESTION_PAGE_SIZE + 1 }, (_, i) => ({ id: `q${i}` }));
    const { client } = chainDouble({ data: rows, error: null });
    const result = await listQuestions(client, USER_ID, "scope-key-1");
    expect(result.questions).toHaveLength(QUESTION_PAGE_SIZE);
    expect(result.hasMore).toBe(true);
  });

  it("hasMore is false when the fetch returns exactly the page size", async () => {
    const rows = Array.from({ length: QUESTION_PAGE_SIZE }, (_, i) => ({ id: `q${i}` }));
    const { client } = chainDouble({ data: rows, error: null });
    const result = await listQuestions(client, USER_ID, "scope-key-1");
    expect(result.questions).toHaveLength(QUESTION_PAGE_SIZE);
    expect(result.hasMore).toBe(false);
  });

  it("respects a caller-supplied limit for the +1 trick", async () => {
    const rows = [{ id: "q0" }, { id: "q1" }, { id: "q2" }];
    const { client, chain } = chainDouble({ data: rows, error: null });
    const result = await listQuestions(client, USER_ID, "scope-key-1", { limit: 2 });
    expect(result.questions).toHaveLength(2);
    expect(result.hasMore).toBe(true);
    expect(chain.limit).toHaveBeenCalledWith(3);
  });

  it("scopes by user_id AND scope_key, ordered newest first", async () => {
    const { client, chain } = chainDouble({ data: [], error: null });
    await listQuestions(client, USER_ID, "scope-key-1");
    expect(chain.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(chain.eq).toHaveBeenCalledWith("scope_key", "scope-key-1");
    expect(chain.order).toHaveBeenCalledWith("created_at", { ascending: false });
  });

  it("returns the error rather than throwing", async () => {
    const { client } = chainDouble({ data: null, error: { message: "nope" } });
    await expect(listQuestions(client, USER_ID, "scope-key-1")).resolves.toEqual({
      questions: null,
      hasMore: false,
      error: "nope",
    });
  });
});

describe("deleteQuestion / clearQuestions — tenancy asserted on the call chain", () => {
  it("deleteQuestion filters by user_id AND id — deleting only the caller's own row", async () => {
    const { client, chain } = chainDouble({ data: null, error: null });
    await deleteQuestion(client, USER_ID, "q1");
    expect(chain.delete).toHaveBeenCalledTimes(1);
    expect(chain.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(chain.eq).toHaveBeenCalledWith("id", "q1");
  });

  it("deleteQuestion requires an id", async () => {
    const { client } = chainDouble();
    const result = await deleteQuestion(client, USER_ID, "");
    expect(result).toEqual({ ok: false, error: "Missing question id." });
  });

  it("deleteQuestion returns the error rather than throwing", async () => {
    const { client } = chainDouble({ data: null, error: { message: "nope" } });
    await expect(deleteQuestion(client, USER_ID, "q1")).resolves.toEqual({ ok: false, error: "nope" });
  });

  it("clearQuestions filters by user_id AND scope_key, and counts off the RETURNING projection", async () => {
    const { client, chain } = chainDouble({ data: [{ id: "q1" }, { id: "q2" }], error: null });
    const result = await clearQuestions(client, USER_ID, "scope-key-1");
    expect(chain.delete).toHaveBeenCalledTimes(1);
    expect(chain.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(chain.eq).toHaveBeenCalledWith("scope_key", "scope-key-1");
    expect(result).toEqual({ cleared: 2, error: null });
  });

  it("clearQuestions returns the error rather than throwing", async () => {
    const { client } = chainDouble({ data: null, error: { message: "nope" } });
    await expect(clearQuestions(client, USER_ID, "scope-key-1")).resolves.toEqual({ cleared: 0, error: "nope" });
  });
});
