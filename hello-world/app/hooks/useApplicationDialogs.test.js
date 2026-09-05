import { describe, it, expect, vi } from "vitest";

import { makeStatefulSupabase } from "@/test/helpers/supabaseFake.js";
import { uploadAndLinkResumeForApplication } from "./useApplicationDialogs.js";

// ---------------------------------------------------------------------------
// uploadAndLinkResumeForApplication's final statement --
// `.from("applications").update({ resume_used_id }).eq("id", applicationId)`
// -- carried NO tenant filter at all: the id was its only predicate. Same
// defect class as `deleteApplicationForUser`
// (lib/supabase/applicationStatusWriter.js) and
// persistGeneratedDocuments's pointer update
// (lib/supabase/persistGeneration.js): whether the missing filter was
// exploitable depends on RLS state on `applications`, which is unknown and
// must not be assumed either way -- which is exactly why the filter belongs
// on the statement.
//
// `makeStatefulSupabase` (test/helpers/supabaseFake.js) is a STATEFUL fake:
// `.eq()` genuinely filters the in-memory rows, so an other-user row seeded
// below is truly reachable by the unfixed statement -- with only
// `.eq("id", …)` on the WHERE, `applyFilters` keeps it regardless of who
// owns it, and the fake's `update` branch `Object.assign`s onto it in place.
// That reachability is the mechanism this file's first test is red against,
// not merely an assumption.
//
// `uploadAndLinkResumeForApplication` is exported at module scope (moved out
// of the `useApplicationDialogs` hook body) specifically so it is directly
// unit-testable without mounting the hook or a DOM: it closes over none of
// the hook's state, every value it needs travels through its own params.
// ---------------------------------------------------------------------------

// A real File (not a plain object) so `buildTemplateLinesForUpload` ->
// `file.text()` in lib/document/docx.js has something real to read, and
// `isTextResume` sees a genuine ".txt" name.
function resumeFile(body = "Line one\nLine two") {
  return new File([body], "resume.txt", { type: "text/plain" });
}

// The stateful fake models `.storage.from().download()` but not `.upload()`
// (see supabaseFake.js's header -- storage upload is outside what it claims
// to model). Stubbing it here, on top of the fake's real `applications`
// table semantics, keeps the fake itself untouched while still exercising
// the real UPDATE statement this test is about.
function withStorageStub(sb) {
  sb.storage.from = vi.fn(() => ({
    upload: vi.fn(async () => ({ error: null })),
  }));
  return sb;
}

function seedApplications(rows) {
  return withStorageStub(
    makeStatefulSupabase({
      applications: rows,
      generated_resumes: [],
    }),
  );
}

describe("uploadAndLinkResumeForApplication -- the applications UPDATE's tenant filter", () => {
  it("does NOT link the resume to another user's application row, even though its id matches", async () => {
    const sb = seedApplications([
      { id: "app-1", user_id: "user-2", resume_used_id: null },
    ]);

    const result = await uploadAndLinkResumeForApplication(sb, {
      file: resumeFile(),
      userId: "user-1",
      applicationId: "app-1",
      positionId: null,
    });

    expect(result.error).toBeNull();

    const otherUsersRow = sb.row("applications", (r) => r.id === "app-1");
    expect(otherUsersRow.user_id).toBe("user-2");
    expect(otherUsersRow.resume_used_id).toBeNull();
  });

  it("links the resume to the caller's OWN application row (legitimate path)", async () => {
    const sb = seedApplications([
      { id: "app-1", user_id: "user-1", resume_used_id: null },
    ]);

    const result = await uploadAndLinkResumeForApplication(sb, {
      file: resumeFile(),
      userId: "user-1",
      applicationId: "app-1",
      positionId: null,
    });

    expect(result.error).toBeNull();
    const ownRow = sb.row("applications", (r) => r.id === "app-1");
    expect(ownRow.resume_used_id).toBeTruthy();
  });

  it("carries both the id and the user_id filter on the UPDATE statement itself", async () => {
    const sb = seedApplications([
      { id: "app-1", user_id: "user-1", resume_used_id: null },
    ]);

    await uploadAndLinkResumeForApplication(sb, {
      file: resumeFile(),
      userId: "user-1",
      applicationId: "app-1",
      positionId: null,
    });

    const update = sb.calls.find((c) => c.table === "applications" && c.verb === "update");
    expect(update).toBeTruthy();
    expect(update.filters).toContainEqual({ column: "id", operator: "eq", value: "app-1", negated: false });
    expect(update.filters).toContainEqual({ column: "user_id", operator: "eq", value: "user-1", negated: false });
  });
});
