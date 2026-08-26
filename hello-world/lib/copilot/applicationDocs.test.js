import { describe, it, expect, vi, beforeEach } from "vitest";

import { fetchApplicationDocs, fetchPostingDescription, fetchPostingEmployer } from "./applicationDocs";

// Minimal chainable double for `supabase.from(table).select(...).eq(...).maybeSingle()`.
// Routes each `.from(table)` call to its own query builder and its own
// canned result, and logs every `.eq()` call per table so tests can assert
// the exact filter shape a query used (which is the point of the
// user_id-scoping test below), not just the value it resolved to.
function makeFakeSupabase({
  appResult = { data: null, error: null },
  resumeResult = { data: null, error: null },
  coverLetterResult = { data: null, error: null },
} = {}) {
  const calls = {
    from: [],
    applications: { select: [], eq: [] },
    generated_resumes: { select: [], eq: [] },
    generated_cover_letters: { select: [], eq: [] },
  };
  const resultByTable = {
    applications: appResult,
    generated_resumes: resumeResult,
    generated_cover_letters: coverLetterResult,
  };

  function makeQueryBuilder(table) {
    const log = calls[table];
    const builder = {
      select: vi.fn((...args) => {
        log.select.push(args);
        return builder;
      }),
      eq: vi.fn((...args) => {
        log.eq.push(args);
        return builder;
      }),
      maybeSingle: vi.fn(() => Promise.resolve(resultByTable[table])),
    };
    return builder;
  }

  return {
    calls,
    from: vi.fn((table) => {
      calls.from.push(table);
      return makeQueryBuilder(table);
    }),
  };
}

describe("fetchApplicationDocs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the résumé and cover letter content for a matching application", async () => {
    const fake = makeFakeSupabase({
      appResult: { data: { id: "app-1", resume_used_id: "res-1", cover_letter_id: "cl-1" }, error: null },
      resumeResult: { data: { content: "resume text" }, error: null },
      coverLetterResult: { data: { content: "cover letter text" }, error: null },
    });

    const result = await fetchApplicationDocs(fake, { applicationId: "app-1", userId: "user-1" });

    expect(result).toEqual({ resume: "resume text", coverLetter: "cover letter text" });
  });

  it("scopes the applications lookup to both the application id and the user id", async () => {
    const fake = makeFakeSupabase({
      appResult: { data: { id: "app-1", resume_used_id: null, cover_letter_id: null }, error: null },
    });

    await fetchApplicationDocs(fake, { applicationId: "app-1", userId: "user-1" });

    expect(fake.calls.from).toContain("applications");
    // This is the filter that stops one user's submitted documents from
    // being read for another: both id and user_id must be present.
    expect(fake.calls.applications.eq).toContainEqual(["id", "app-1"]);
    expect(fake.calls.applications.eq).toContainEqual(["user_id", "user-1"]);
  });

  it("degrades to empty strings, without querying anything, when applicationId is missing", async () => {
    const fake = makeFakeSupabase();

    const result = await fetchApplicationDocs(fake, { applicationId: undefined, userId: "user-1" });

    expect(result).toEqual({ resume: "", coverLetter: "" });
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("degrades to empty strings, without querying anything, when userId is missing", async () => {
    const fake = makeFakeSupabase();

    const result = await fetchApplicationDocs(fake, { applicationId: "app-1", userId: undefined });

    expect(result).toEqual({ resume: "", coverLetter: "" });
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("degrades to empty strings, without throwing, when no application row matches", async () => {
    const fake = makeFakeSupabase({ appResult: { data: null, error: null } });

    const result = await fetchApplicationDocs(fake, { applicationId: "app-missing", userId: "user-1" });

    expect(result).toEqual({ resume: "", coverLetter: "" });
    // Neither document table should be queried once the application lookup
    // itself came back empty.
    expect(fake.calls.from).toEqual(["applications"]);
  });

  it("degrades to empty strings, without throwing, when the applications query errors", async () => {
    const fake = makeFakeSupabase({
      appResult: { data: null, error: { message: "connection reset" } },
    });

    const result = await fetchApplicationDocs(fake, { applicationId: "app-1", userId: "user-1" });

    expect(result).toEqual({ resume: "", coverLetter: "" });
    expect(fake.calls.from).toEqual(["applications"]);
  });

  it("degrades to an empty résumé, without throwing, when resume_used_id is null", async () => {
    const fake = makeFakeSupabase({
      appResult: { data: { id: "app-1", resume_used_id: null, cover_letter_id: "cl-1" }, error: null },
      coverLetterResult: { data: { content: "cover letter text" }, error: null },
    });

    const result = await fetchApplicationDocs(fake, { applicationId: "app-1", userId: "user-1" });

    expect(result).toEqual({ resume: "", coverLetter: "cover letter text" });
    // A null id means fetchDocContent should never even query that table.
    expect(fake.calls.from).not.toContain("generated_resumes");
  });

  it("degrades to an empty cover letter, without throwing, when cover_letter_id is null", async () => {
    const fake = makeFakeSupabase({
      appResult: { data: { id: "app-1", resume_used_id: "res-1", cover_letter_id: null }, error: null },
      resumeResult: { data: { content: "resume text" }, error: null },
    });

    const result = await fetchApplicationDocs(fake, { applicationId: "app-1", userId: "user-1" });

    expect(result).toEqual({ resume: "resume text", coverLetter: "" });
    expect(fake.calls.from).not.toContain("generated_cover_letters");
  });

  it("degrades the résumé to empty, without throwing, when the résumé query errors", async () => {
    const fake = makeFakeSupabase({
      appResult: { data: { id: "app-1", resume_used_id: "res-1", cover_letter_id: "cl-1" }, error: null },
      resumeResult: { data: null, error: { message: "boom" } },
      coverLetterResult: { data: { content: "cover letter text" }, error: null },
    });

    const result = await fetchApplicationDocs(fake, { applicationId: "app-1", userId: "user-1" });

    expect(result).toEqual({ resume: "", coverLetter: "cover letter text" });
  });

  it("degrades the cover letter to empty, without throwing, when the cover letter query errors", async () => {
    const fake = makeFakeSupabase({
      appResult: { data: { id: "app-1", resume_used_id: "res-1", cover_letter_id: "cl-1" }, error: null },
      resumeResult: { data: { content: "resume text" }, error: null },
      coverLetterResult: { data: null, error: { message: "boom" } },
    });

    const result = await fetchApplicationDocs(fake, { applicationId: "app-1", userId: "user-1" });

    expect(result).toEqual({ resume: "resume text", coverLetter: "" });
  });
});

// AC-K1.2. Deliberately a SEPARATE function from fetchApplicationDocs above,
// not a third field on its result: that result is what gets interpolated into
// both answer prompts, and the posting description must never reach either
// one (AC-H7.27). Splitting the lookup is what makes that structural rather
// than a rule someone has to remember.
describe("fetchPostingDescription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the joined position's description", async () => {
    const fake = makeFakeSupabase({
      appResult: { data: { id: "app-1", positions: { description: "We need a platform engineer." } }, error: null },
    });

    expect(await fetchPostingDescription(fake, { applicationId: "app-1", userId: "user-1" })).toBe(
      "We need a platform engineer.",
    );
  });

  it("accepts the embedded relation as an array as well as an object", async () => {
    // PostgREST returns a one-to-many embed as an array; which shape comes
    // back depends on the schema's foreign key, not on this caller.
    const fake = makeFakeSupabase({
      appResult: { data: { id: "app-1", positions: [{ description: "Array-shaped embed." }] }, error: null },
    });

    expect(await fetchPostingDescription(fake, { applicationId: "app-1", userId: "user-1" })).toBe(
      "Array-shaped embed.",
    );
  });

  it("scopes the lookup to both the application id and the user id", async () => {
    const fake = makeFakeSupabase({ appResult: { data: { id: "app-1", positions: null }, error: null } });

    await fetchPostingDescription(fake, { applicationId: "app-1", userId: "user-1" });

    // The same control fetchApplicationDocs relies on: one user's posting
    // must never be readable through another user's request.
    expect(fake.calls.applications.eq).toContainEqual(["id", "app-1"]);
    expect(fake.calls.applications.eq).toContainEqual(["user_id", "user-1"]);
  });

  it("degrades to an empty string, without querying anything, when applicationId or userId is missing", async () => {
    const noApp = makeFakeSupabase();
    expect(await fetchPostingDescription(noApp, { applicationId: undefined, userId: "user-1" })).toBe("");
    expect(noApp.from).not.toHaveBeenCalled();

    const noUser = makeFakeSupabase();
    expect(await fetchPostingDescription(noUser, { applicationId: "app-1", userId: undefined })).toBe("");
    expect(noUser.from).not.toHaveBeenCalled();
  });

  it("degrades to an empty string, without throwing, for every other failure mode", async () => {
    // No matching row, a query error, no joined position, and a null or
    // non-string description all mean the same thing to the caller: no
    // buzzword section. None of them may break the answer around it.
    const cases = [
      { data: null, error: null },
      { data: null, error: { message: "connection reset" } },
      { data: { id: "app-1" }, error: null },
      { data: { id: "app-1", positions: null }, error: null },
      { data: { id: "app-1", positions: [] }, error: null },
      { data: { id: "app-1", positions: { description: null } }, error: null },
      { data: { id: "app-1", positions: { description: 42 } }, error: null },
    ];
    for (const appResult of cases) {
      const fake = makeFakeSupabase({ appResult });
      expect(await fetchPostingDescription(fake, { applicationId: "app-1", userId: "user-1" })).toBe("");
    }
  });
});

// AC-V4/C8. A separate function from fetchPostingDescription for the same
// reason that one is separate from fetchApplicationDocs: the description
// must never reach a prompt builder as part of a bag of other fields
// (AC-H7.27), so the employer's name/title come back from their own query
// instead of widening that one's return shape.
describe("fetchPostingEmployer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the joined position's company and title", async () => {
    const fake = makeFakeSupabase({
      appResult: {
        data: { id: "app-1", positions: { company: "Purple Wave", title: "Platform Engineer" } },
        error: null,
      },
    });

    expect(await fetchPostingEmployer(fake, { applicationId: "app-1", userId: "user-1" })).toEqual({
      company: "Purple Wave",
      title: "Platform Engineer",
    });
  });

  it("accepts the embedded relation as an array as well as an object", async () => {
    const fake = makeFakeSupabase({
      appResult: {
        data: { id: "app-1", positions: [{ company: "Array Co", title: "Engineer" }] },
        error: null,
      },
    });

    expect(await fetchPostingEmployer(fake, { applicationId: "app-1", userId: "user-1" })).toEqual({
      company: "Array Co",
      title: "Engineer",
    });
  });

  it("scopes the lookup to both the application id and the user id", async () => {
    const fake = makeFakeSupabase({ appResult: { data: { id: "app-1", positions: null }, error: null } });

    await fetchPostingEmployer(fake, { applicationId: "app-1", userId: "user-1" });

    expect(fake.calls.applications.eq).toContainEqual(["id", "app-1"]);
    expect(fake.calls.applications.eq).toContainEqual(["user_id", "user-1"]);
  });

  it("short-circuits to empty, without querying anything, when applicationId or userId is missing", async () => {
    const noApp = makeFakeSupabase();
    expect(await fetchPostingEmployer(noApp, { applicationId: undefined, userId: "user-1" })).toEqual({
      company: "",
      title: "",
    });
    expect(noApp.from).not.toHaveBeenCalled();

    const noUser = makeFakeSupabase();
    expect(await fetchPostingEmployer(noUser, { applicationId: "app-1", userId: undefined })).toEqual({
      company: "",
      title: "",
    });
    expect(noUser.from).not.toHaveBeenCalled();
  });

  it("degrades to empty, without throwing, for every other failure mode", async () => {
    const cases = [
      { data: null, error: null },
      { data: null, error: { message: "connection reset" } },
      { data: { id: "app-1" }, error: null },
      { data: { id: "app-1", positions: null }, error: null },
      { data: { id: "app-1", positions: [] }, error: null },
      { data: { id: "app-1", positions: { company: null, title: null } }, error: null },
      { data: { id: "app-1", positions: { company: 42, title: 42 } }, error: null },
    ];
    for (const appResult of cases) {
      const fake = makeFakeSupabase({ appResult });
      expect(await fetchPostingEmployer(fake, { applicationId: "app-1", userId: "user-1" })).toEqual({
        company: "",
        title: "",
      });
    }
  });
});
