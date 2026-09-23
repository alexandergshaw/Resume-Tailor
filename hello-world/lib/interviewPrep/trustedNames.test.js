// TDD RED handoff -- lib/interviewPrep/trustedNames.js, the I/O module
// design-reconciled.r2.md ss3.3 specifies. THE MODULE DOES NOT EXIST YET:
// `grep -rln "trustedNames" hello-world/lib` -> 0 files under
// lib/interviewPrep this round (canary: `grep -rln "prepParse"
// hello-world/lib/interviewPrep` -> hits, confirming the search root/tool
// are live). Every test below that imports from "./trustedNames.js" is RED
// because the module resolution itself fails.
//
// FIVE EXPORTS UNDER TEST, per design-reconciled.r2.md ss3.3's own
// docstrings (quoted, not paraphrased, where load-bearing):
//   readTrustedNames(supabase, {applicationId, userId})
//     -> {candidateName, interviewerNames, error} -- two independent PK
//     lookups via Promise.all (candidate_identity keyed on user_id alone;
//     application_trusted_names keyed on application_id AND user_id).
//     "FAILS CLOSED on any query error: returns {candidateName: null,
//     interviewerNames: [], error: <message>}."
//   flattenTrustedNames({candidateName, interviewerNames}) -> string[]
//     "Pure. ... Empty/whitespace-only entries are dropped ... Order:
//     candidate name first, then interviewer names in stored order."
//   saveCandidateName(supabase, {userId, candidateName}) -> {written, error}
//     ".upsert(row, {onConflict: 'user_id'}) ... An empty/whitespace-only
//     candidateName is stored as an explicit '' ... never coerced to a
//     sentinel."
//   saveInterviewerNames(supabase, {applicationId, userId, interviewerNames})
//     -> {written, error} -- ".upsert(row, {onConflict: 'application_id'})."
//   buildTrustedNamesPayload({form, stored}) -> {candidateNamePayload,
//     interviewerNamesPayload, changed} -- "Pure, no IO. ... `changed` is
//     true iff at least one payload is non-null ... A `null` payload on
//     either field means 'no write needed' -- an intentional empty-string/
//     empty-array value is NEVER represented as `null`."
//
// makeStatefulSupabase (test/helpers/supabaseFake.js) is this repo's own
// stateful PostgREST fake -- reused here rather than the call-recorder
// supabaseMock.js, because these tests need to assert WHAT THE ROWS LOOK
// LIKE AFTERWARDS (one row per account, upsert-merge semantics), which a
// canned-result recorder cannot show.
//
// AN OPEN QUESTION THIS FILE FLAGS RATHER THAN INVENTS (per this seat's
// brief: "if r2 is silent or ambiguous, record it as a question"):
// buildTrustedNamesPayload's docstring does not state whether
// `form.candidateName` is trimmed before being compared to
// `stored.candidateName`, nor whether a candidateNamePayload that IS written
// is itself trimmed. The tests below assume trimming (consistent with
// saveCandidateName's own explicit trim-to-"" discipline and with
// AC-N33.6's write-side trim-then-reject rule generalized to this field),
// but this is this seat's own reasonable reading, not a literal quote from
// r2 -- flagged in this seat's final report as a question for the
// implementer/next design round, not silently assumed as settled.

import { describe, it, expect, vi } from "vitest";
import { makeStatefulSupabase } from "../../test/helpers/supabaseFake.js";

const SPECIFIER = "./trustedNames.js";
let modPromise;
function load() {
  if (!modPromise) modPromise = import(SPECIFIER);
  return modPromise;
}

describe("readTrustedNames -- two independent PK lookups, fails closed", () => {
  it("returns the account's candidate name and the application's interviewer names when both rows exist", async () => {
    const { readTrustedNames } = await load();
    const sb = makeStatefulSupabase({
      candidate_identity: [{ user_id: "u1", candidate_name: "Alex Shaw" }],
      application_trusted_names: [{ application_id: "app-1", user_id: "u1", interviewer_names: ["Priya Nair"] }],
    });
    const result = await readTrustedNames(sb, { applicationId: "app-1", userId: "u1" });
    expect(result).toEqual({ candidateName: "Alex Shaw", interviewerNames: ["Priya Nair"], error: null });
  });

  it("returns nulls/[] with no error when NEITHER row exists yet -- the 'never entered a name' state is not an error", async () => {
    const { readTrustedNames } = await load();
    const sb = makeStatefulSupabase({ candidate_identity: [], application_trusted_names: [] });
    const result = await readTrustedNames(sb, { applicationId: "app-1", userId: "u1" });
    expect(result).toEqual({ candidateName: null, interviewerNames: [], error: null });
  });

  it("the candidate name is readable even when no application_trusted_names row exists for THIS application yet", async () => {
    const { readTrustedNames } = await load();
    const sb = makeStatefulSupabase({
      candidate_identity: [{ user_id: "u1", candidate_name: "Alex Shaw" }],
      application_trusted_names: [],
    });
    const result = await readTrustedNames(sb, { applicationId: "app-1", userId: "u1" });
    expect(result.candidateName).toBe("Alex Shaw");
    expect(result.interviewerNames).toEqual([]);
  });

  it("application_trusted_names is scoped by BOTH application_id AND user_id -- a row for this application belonging to a DIFFERENT user_id never surfaces", async () => {
    const { readTrustedNames } = await load();
    const sb = makeStatefulSupabase({
      application_trusted_names: [{ application_id: "app-1", user_id: "someone-else", interviewer_names: ["Injected"] }],
    });
    const result = await readTrustedNames(sb, { applicationId: "app-1", userId: "u1" });
    expect(result.interviewerNames).toEqual([]);
    expect(result.error).toBe(null);
  });

  it("candidate_identity is scoped by user_id -- a DIFFERENT account's row never surfaces", async () => {
    const { readTrustedNames } = await load();
    const sb = makeStatefulSupabase({
      candidate_identity: [{ user_id: "someone-else", candidate_name: "Not Me" }],
    });
    const result = await readTrustedNames(sb, { applicationId: "app-1", userId: "u1" });
    expect(result.candidateName).toBe(null);
  });

  it("FAILS CLOSED: a query error on candidate_identity returns {candidateName: null, interviewerNames: [], error}", async () => {
    const { readTrustedNames } = await load();
    const sb = makeStatefulSupabase(
      { application_trusted_names: [{ application_id: "app-1", user_id: "u1", interviewer_names: ["Priya Nair"] }] },
      { errors: { candidate_identity: { select: { message: "boom" } } } },
    );
    const result = await readTrustedNames(sb, { applicationId: "app-1", userId: "u1" });
    expect(result.candidateName).toBe(null);
    expect(result.interviewerNames).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  it("FAILS CLOSED: a query error on application_trusted_names ALSO returns candidateName: null (never the account name, even though that query itself succeeded) -- the more restrictive default", async () => {
    const { readTrustedNames } = await load();
    const sb = makeStatefulSupabase(
      { candidate_identity: [{ user_id: "u1", candidate_name: "Alex Shaw" }] },
      { errors: { application_trusted_names: { select: { message: "boom" } } } },
    );
    const result = await readTrustedNames(sb, { applicationId: "app-1", userId: "u1" });
    expect(result).toEqual({ candidateName: null, interviewerNames: [], error: expect.any(String) });
  });

  // F-R13-1 (fix round r13, MAJOR, verify.r13.md) -- the tenth leak: this
  // module's own `error` field used to be the query's raw PostgREST message
  // (errMessage(candidateResult.error)), which route.js's GET handler
  // (:821) then handed straight to the candidate on an otherwise-200
  // response. Fixed AT THE SOURCE, here, not by patching the route: the raw
  // detail goes to logDbFailure (prepStore.js) instead, and `error` is
  // always this one generic sentence.
  it("[RED before this fix round] a query error's `error` field is a GENERIC sentence, never the raw database text -- the raw detail is logged server-side instead", async () => {
    const { readTrustedNames } = await load();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sb = makeStatefulSupabase(
      { application_trusted_names: [{ application_id: "app-1", user_id: "u1", interviewer_names: ["Priya Nair"] }] },
      { errors: { candidate_identity: { select: { message: "PGRST301 relation candidate_identity does not exist at char 42" } } } },
    );
    const result = await readTrustedNames(sb, { applicationId: "app-1", userId: "u1" });
    expect(result.error).toBe("Could not verify saved names for this application.");
    expect(result.error).not.toContain("PGRST301");
    expect(spy).toHaveBeenCalledTimes(1);
    const [, loggedMeta] = spy.mock.calls[0];
    expect(loggedMeta.error.message).toContain("PGRST301");
    spy.mockRestore();
  });
});

describe("flattenTrustedNames -- pure, drops blanks, candidate name first", () => {
  it("puts the candidate name first, then interviewer names in stored order", async () => {
    const { flattenTrustedNames } = await load();
    expect(flattenTrustedNames({ candidateName: "Alex Shaw", interviewerNames: ["Priya Nair", "J. Okafor"] })).toEqual([
      "Alex Shaw",
      "Priya Nair",
      "J. Okafor",
    ]);
  });

  it("drops a null/empty/whitespace-only candidate name rather than including it as a blank entry", async () => {
    const { flattenTrustedNames } = await load();
    expect(flattenTrustedNames({ candidateName: null, interviewerNames: ["Priya Nair"] })).toEqual(["Priya Nair"]);
    expect(flattenTrustedNames({ candidateName: "", interviewerNames: ["Priya Nair"] })).toEqual(["Priya Nair"]);
    expect(flattenTrustedNames({ candidateName: "   ", interviewerNames: ["Priya Nair"] })).toEqual(["Priya Nair"]);
  });

  it("drops empty/whitespace-only interviewer name entries individually, keeping the real ones", async () => {
    const { flattenTrustedNames } = await load();
    expect(flattenTrustedNames({ candidateName: "Alex Shaw", interviewerNames: ["", "Priya Nair", "   "] })).toEqual([
      "Alex Shaw",
      "Priya Nair",
    ]);
  });

  it("returns [] when nothing is stored at all", async () => {
    const { flattenTrustedNames } = await load();
    expect(flattenTrustedNames({ candidateName: null, interviewerNames: [] })).toEqual([]);
  });

  it("is total -- never throws on a degenerate input", async () => {
    const { flattenTrustedNames } = await load();
    for (const v of [{}, { candidateName: undefined, interviewerNames: undefined }, { interviewerNames: "not-an-array" }]) {
      expect(() => flattenTrustedNames(v)).not.toThrow();
    }
  });
});

describe("saveCandidateName -- one row per account, upserted on the user_id primary key", () => {
  it("writes a NEW row for a first-time save", async () => {
    const { saveCandidateName } = await load();
    const sb = makeStatefulSupabase({ candidate_identity: [] }, { primaryKeys: { candidate_identity: ["user_id"] } });
    const result = await saveCandidateName(sb, { userId: "u1", candidateName: "Alex Shaw" });
    expect(result).toEqual({ written: true, error: null });
    expect(sb.rows("candidate_identity")).toEqual([expect.objectContaining({ user_id: "u1", candidate_name: "Alex Shaw" })]);
  });

  it("upserts the SAME row on a second save -- exactly one row for this account, never two, structurally (PK is user_id)", async () => {
    const { saveCandidateName } = await load();
    const sb = makeStatefulSupabase({ candidate_identity: [] }, { primaryKeys: { candidate_identity: ["user_id"] } });
    await saveCandidateName(sb, { userId: "u1", candidateName: "Alex Shaw" });
    await saveCandidateName(sb, { userId: "u1", candidateName: "Alexandra Shaw" });
    const rows = sb.rows("candidate_identity");
    expect(rows.length).toBe(1);
    expect(rows[0].candidate_name).toBe("Alexandra Shaw");
  });

  it("an empty or whitespace-only candidateName is stored as the literal '' -- a legitimate state, never dropped or coerced to null/undefined", async () => {
    const { saveCandidateName } = await load();
    const sb = makeStatefulSupabase({ candidate_identity: [] }, { primaryKeys: { candidate_identity: ["user_id"] } });
    await saveCandidateName(sb, { userId: "u1", candidateName: "   " });
    expect(sb.rows("candidate_identity")[0].candidate_name).toBe("");
  });

  it("issues the upsert with onConflict: 'user_id' -- the PK-on-user_id idiom, matching driveConnections.js's own precedent", async () => {
    const { saveCandidateName } = await load();
    const sb = makeStatefulSupabase({ candidate_identity: [] }, { primaryKeys: { candidate_identity: ["user_id"] } });
    await saveCandidateName(sb, { userId: "u1", candidateName: "Alex Shaw" });
    const upsertCall = sb.calls.find((c) => c.table === "candidate_identity" && c.verb === "upsert");
    expect(upsertCall, "no upsert call was issued against candidate_identity").toBeDefined();
    expect(upsertCall.options.onConflict).toBe("user_id");
  });

  it("reports a write failure honestly on a forced database error", async () => {
    const { saveCandidateName } = await load();
    const sb = makeStatefulSupabase({ candidate_identity: [] }, { errors: { candidate_identity: { upsert: { message: "boom" } } } });
    const result = await saveCandidateName(sb, { userId: "u1", candidateName: "Alex Shaw" });
    expect(result.written).toBe(false);
    expect(result.error).toBeTruthy();
  });

  // F-R14-2 (fix round r14, MINOR, verify.r14.md): readTrustedNames got the
  // fix-at-source treatment (F-R13-1), but this sibling did not -- it still
  // returned errMessage(error) verbatim. Today that is safe only because
  // route.js's own PUT caller feeds the result into dbFailureResponse's
  // `meta` (logged, never returned), but nothing here stopped a different
  // future caller from surfacing `result.error` directly.
  it("[RED before this fix round] a write failure's `error` field is a GENERIC sentence, never the raw database text -- the raw detail is logged server-side instead", async () => {
    const { saveCandidateName } = await load();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sb = makeStatefulSupabase(
      { candidate_identity: [] },
      { errors: { candidate_identity: { upsert: { message: "PGRST301 relation candidate_identity does not exist at char 42" } } } },
    );
    const result = await saveCandidateName(sb, { userId: "u1", candidateName: "Alex Shaw" });
    expect(result.written).toBe(false);
    expect(result.error).toBe("Could not save your name.");
    expect(result.error).not.toContain("PGRST301");
    expect(spy).toHaveBeenCalledTimes(1);
    const [, loggedMeta] = spy.mock.calls[0];
    expect(loggedMeta.error.message).toContain("PGRST301");
    spy.mockRestore();
  });
});

describe("saveInterviewerNames -- one row per application, upserted on the application_id primary key", () => {
  it("writes a NEW row for a first-time save, carrying the owning user_id", async () => {
    const { saveInterviewerNames } = await load();
    const sb = makeStatefulSupabase({ application_trusted_names: [] }, { primaryKeys: { application_trusted_names: ["application_id"] } });
    const result = await saveInterviewerNames(sb, { applicationId: "app-1", userId: "u1", interviewerNames: ["Priya Nair"] });
    expect(result).toEqual({ written: true, error: null });
    expect(sb.rows("application_trusted_names")).toEqual([
      expect.objectContaining({ application_id: "app-1", user_id: "u1", interviewer_names: ["Priya Nair"] }),
    ]);
  });

  it("upserts the SAME row on a second save for the same application -- never a second row", async () => {
    const { saveInterviewerNames } = await load();
    const sb = makeStatefulSupabase({ application_trusted_names: [] }, { primaryKeys: { application_trusted_names: ["application_id"] } });
    await saveInterviewerNames(sb, { applicationId: "app-1", userId: "u1", interviewerNames: ["Priya Nair"] });
    await saveInterviewerNames(sb, { applicationId: "app-1", userId: "u1", interviewerNames: ["Priya Nair", "J. Okafor"] });
    const rows = sb.rows("application_trusted_names");
    expect(rows.length).toBe(1);
    expect(rows[0].interviewer_names).toEqual(["Priya Nair", "J. Okafor"]);
  });

  it("issues the upsert with onConflict: 'application_id'", async () => {
    const { saveInterviewerNames } = await load();
    const sb = makeStatefulSupabase({ application_trusted_names: [] }, { primaryKeys: { application_trusted_names: ["application_id"] } });
    await saveInterviewerNames(sb, { applicationId: "app-1", userId: "u1", interviewerNames: ["Priya Nair"] });
    const upsertCall = sb.calls.find((c) => c.table === "application_trusted_names" && c.verb === "upsert");
    expect(upsertCall, "no upsert call was issued against application_trusted_names").toBeDefined();
    expect(upsertCall.options.onConflict).toBe("application_id");
  });

  it("a save for a DIFFERENT application never touches the first application's row", async () => {
    const { saveInterviewerNames } = await load();
    const sb = makeStatefulSupabase({ application_trusted_names: [] }, { primaryKeys: { application_trusted_names: ["application_id"] } });
    await saveInterviewerNames(sb, { applicationId: "app-1", userId: "u1", interviewerNames: ["Priya Nair"] });
    await saveInterviewerNames(sb, { applicationId: "app-2", userId: "u1", interviewerNames: ["J. Okafor"] });
    const rows = sb.rows("application_trusted_names");
    expect(rows.length).toBe(2);
    expect(rows.find((r) => r.application_id === "app-1").interviewer_names).toEqual(["Priya Nair"]);
    expect(rows.find((r) => r.application_id === "app-2").interviewer_names).toEqual(["J. Okafor"]);
  });

  it("reports a write failure honestly on a forced database error", async () => {
    const { saveInterviewerNames } = await load();
    const sb = makeStatefulSupabase({ application_trusted_names: [] }, { errors: { application_trusted_names: { upsert: { message: "boom" } } } });
    const result = await saveInterviewerNames(sb, { applicationId: "app-1", userId: "u1", interviewerNames: ["Priya Nair"] });
    expect(result.written).toBe(false);
    expect(result.error).toBeTruthy();
  });

  // F-R14-2 (fix round r14, MINOR, verify.r14.md): same asymmetry as
  // saveCandidateName's own sibling test above -- this function still
  // returned errMessage(error) verbatim before this fix round.
  it("[RED before this fix round] a write failure's `error` field is a GENERIC sentence, never the raw database text -- the raw detail is logged server-side instead", async () => {
    const { saveInterviewerNames } = await load();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sb = makeStatefulSupabase(
      { application_trusted_names: [] },
      { errors: { application_trusted_names: { upsert: { message: "PGRST301 relation application_trusted_names does not exist at char 42" } } } },
    );
    const result = await saveInterviewerNames(sb, { applicationId: "app-1", userId: "u1", interviewerNames: ["Priya Nair"] });
    expect(result.written).toBe(false);
    expect(result.error).toBe("Could not save the interviewer names.");
    expect(result.error).not.toContain("PGRST301");
    expect(spy).toHaveBeenCalledTimes(1);
    const [, loggedMeta] = spy.mock.calls[0];
    expect(loggedMeta.error.message).toContain("PGRST301");
    spy.mockRestore();
  });
});

describe("buildTrustedNamesPayload -- pure diff, zero writes when nothing changed", () => {
  it("issues NEITHER payload, changed: false, when the form matches what is already stored", async () => {
    const { buildTrustedNamesPayload } = await load();
    const result = buildTrustedNamesPayload({
      form: { candidateName: "Alex Shaw", interviewerNamesText: "Priya Nair, J. Okafor" },
      stored: { candidateName: "Alex Shaw", interviewerNames: ["Priya Nair", "J. Okafor"] },
    });
    expect(result).toEqual({ candidateNamePayload: null, interviewerNamesPayload: null, changed: false });
  });

  it("issues ONLY the candidateNamePayload when just the candidate name changed", async () => {
    const { buildTrustedNamesPayload } = await load();
    const result = buildTrustedNamesPayload({
      form: { candidateName: "Alexandra Shaw", interviewerNamesText: "Priya Nair" },
      stored: { candidateName: "Alex Shaw", interviewerNames: ["Priya Nair"] },
    });
    expect(result.candidateNamePayload).toBe("Alexandra Shaw");
    expect(result.interviewerNamesPayload).toBe(null);
    expect(result.changed).toBe(true);
  });

  it("issues ONLY the interviewerNamesPayload when just the interviewer list changed, parsed via split(',').map(trim).filter(Boolean) -- the same shape already shipped for interview_stages.interviewer_names", async () => {
    const { buildTrustedNamesPayload } = await load();
    const result = buildTrustedNamesPayload({
      form: { candidateName: "Alex Shaw", interviewerNamesText: "Priya Nair,  J. Okafor ,," },
      stored: { candidateName: "Alex Shaw", interviewerNames: ["Priya Nair"] },
    });
    expect(result.candidateNamePayload).toBe(null);
    expect(result.interviewerNamesPayload).toEqual(["Priya Nair", "J. Okafor"]);
    expect(result.changed).toBe(true);
  });

  it("clearing the candidate name to blank issues the literal '' payload, NEVER null (null means 'no write needed', not 'write empty')", async () => {
    const { buildTrustedNamesPayload } = await load();
    const result = buildTrustedNamesPayload({
      form: { candidateName: "   ", interviewerNamesText: "" },
      stored: { candidateName: "Alex Shaw", interviewerNames: [] },
    });
    expect(result.candidateNamePayload).toBe("");
    expect(result.changed).toBe(true);
  });

  it("clearing the interviewer list to blank issues the literal [] payload, never null", async () => {
    const { buildTrustedNamesPayload } = await load();
    const result = buildTrustedNamesPayload({
      form: { candidateName: "Alex Shaw", interviewerNamesText: "" },
      stored: { candidateName: "Alex Shaw", interviewerNames: ["Priya Nair"] },
    });
    expect(result.interviewerNamesPayload).toEqual([]);
    expect(result.changed).toBe(true);
  });

  it("both fields changing issues BOTH payloads", async () => {
    const { buildTrustedNamesPayload } = await load();
    const result = buildTrustedNamesPayload({
      form: { candidateName: "Alexandra Shaw", interviewerNamesText: "J. Okafor" },
      stored: { candidateName: "Alex Shaw", interviewerNames: ["Priya Nair"] },
    });
    expect(result.candidateNamePayload).toBe("Alexandra Shaw");
    expect(result.interviewerNamesPayload).toEqual(["J. Okafor"]);
    expect(result.changed).toBe(true);
  });

  it("is total -- never throws on a degenerate input", async () => {
    const { buildTrustedNamesPayload } = await load();
    expect(() =>
      buildTrustedNamesPayload({ form: {}, stored: {} }),
    ).not.toThrow();
  });
});
