import { describe, it, expect } from "vitest";

import { makeStatefulSupabase } from "@/test/helpers/supabaseFake.js";
import { persistGeneratedDocuments } from "@/lib/supabase/persistGeneration.js";

// ---------------------------------------------------------------------------
// persistGeneratedDocuments's pointer update
// (`.from("applications").update(updates)` when `applicationId` is supplied)
// carried NO tenant filter at all — its only predicate was the id:
//
//   supabase.from("applications").update(updates).eq("id", applicationId)
//
// Same defect class as `deleteApplicationForUser`
// (lib/supabase/applicationStatusWriter.js): whether the missing filter was
// exploitable depends on RLS state on `applications`, which is unknown and
// must not be assumed either way — which is exactly why the filter belongs
// on the statement. This only writes `resume_used_id` / `cover_letter_id`,
// never `status`, so this is a tenancy concern, not a status-integrity one.
//
// `makeStatefulSupabase` (test/helpers/supabaseFake.js) is a STATEFUL fake —
// `.eq()` genuinely filters the in-memory rows — so an other-user row seeded
// here is truly reachable by the unfixed statement: with only `.eq("id", …)`
// on the WHERE, the fake's `applyFilters` keeps it regardless of who owns
// it, and the `Object.assign` in the fake's `update` branch mutates it in
// place. That is the mechanism this file's first test is red against.
// ---------------------------------------------------------------------------

function seedApplications(rows) {
  return makeStatefulSupabase({
    applications: rows,
    generated_resumes: [],
    generated_cover_letters: [],
  });
}

describe("persistGeneratedDocuments -- the applicationId pointer update's tenant filter", () => {
  it("does NOT update another user's application row, even though its id matches", async () => {
    // Seeded under a DIFFERENT user than the caller. If the pointer update's
    // only predicate is the id (the unfixed statement), the stateful fake's
    // `.eq("id", "app-1")` alone matches this row regardless of `user_id`,
    // and `Object.assign` overwrites `resume_used_id` on it.
    const sb = seedApplications([
      { id: "app-1", user_id: "user-2", position_id: "pos-2", resume_used_id: null, cover_letter_id: null },
    ]);

    const outcome = await persistGeneratedDocuments(sb, {
      userId: "user-1",
      applicationId: "app-1",
      resume: { content: "Tailored resume text", contentLines: ["Tailored resume text"] },
    });

    // The resume itself is still generated and saved (that insert carries its
    // own, already-correct, user_id) -- only the OTHER user's application row
    // must be left alone.
    expect(outcome.resumeId).toBeTruthy();

    const otherUsersRow = sb.row("applications", (r) => r.id === "app-1");
    expect(otherUsersRow.user_id).toBe("user-2");
    expect(otherUsersRow.resume_used_id).toBeNull();
    expect(otherUsersRow.cover_letter_id).toBeNull();
  });

  it("updates the caller's OWN application row with the new resume id (legitimate path)", async () => {
    const sb = seedApplications([
      { id: "app-1", user_id: "user-1", position_id: "pos-1", resume_used_id: null, cover_letter_id: null },
    ]);

    const outcome = await persistGeneratedDocuments(sb, {
      userId: "user-1",
      applicationId: "app-1",
      resume: { content: "Tailored resume text", contentLines: ["Tailored resume text"] },
    });

    expect(outcome.resumeId).toBeTruthy();
    const ownRow = sb.row("applications", (r) => r.id === "app-1");
    expect(ownRow.resume_used_id).toBe(outcome.resumeId);
  });

  it("updates the caller's OWN row for a cover letter too, carrying the same tenant filter", async () => {
    const sb = seedApplications([
      { id: "app-1", user_id: "user-1", position_id: "pos-1", resume_used_id: null, cover_letter_id: null },
    ]);

    const outcome = await persistGeneratedDocuments(sb, {
      userId: "user-1",
      applicationId: "app-1",
      coverLetter: { content: "Dear hiring team", contentLines: ["Dear hiring team"] },
    });

    expect(outcome.coverLetterId).toBeTruthy();
    const ownRow = sb.row("applications", (r) => r.id === "app-1");
    expect(ownRow.cover_letter_id).toBe(outcome.coverLetterId);
    expect(ownRow.resume_used_id).toBeNull();
  });

  it("carries both the id and the user_id filter on the pointer UPDATE statement itself", async () => {
    const sb = seedApplications([
      { id: "app-1", user_id: "user-1", position_id: "pos-1", resume_used_id: null, cover_letter_id: null },
    ]);

    await persistGeneratedDocuments(sb, {
      userId: "user-1",
      applicationId: "app-1",
      resume: { content: "Tailored resume text" },
    });

    const pointerUpdate = sb.calls.find(
      (c) => c.table === "applications" && c.verb === "update",
    );
    expect(pointerUpdate).toBeTruthy();
    expect(pointerUpdate.filters).toContainEqual({
      column: "id",
      operator: "eq",
      value: "app-1",
      negated: false,
    });
    expect(pointerUpdate.filters).toContainEqual({
      column: "user_id",
      operator: "eq",
      value: "user-1",
      negated: false,
    });
  });
});
