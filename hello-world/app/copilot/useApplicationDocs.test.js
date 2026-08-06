import { describe, it, expect } from "vitest";
import { resolveDocs } from "./useApplicationDocs.js";

// state.forId holds a settled result for a DIFFERENT application than the
// one being asked about in most of these cases, to make sure resolveDocs
// never leaks a previous posting's documents into the current one.
const SETTLED_FOR_OTHER = {
  forId: "app-other",
  outcome: "done",
  resume: "other resume",
  coverLetter: "other cover letter",
  error: "",
};

describe("resolveDocs", () => {
  it("reports idle with empty documents for a falsy applicationId, even when state holds a settled result for a different id", () => {
    expect(resolveDocs(SETTLED_FOR_OTHER, "")).toEqual({
      status: "idle",
      resume: "",
      coverLetter: "",
      error: "",
    });
  });

  it("reports idle for a null applicationId", () => {
    expect(resolveDocs(SETTLED_FOR_OTHER, null)).toEqual({
      status: "idle",
      resume: "",
      coverLetter: "",
      error: "",
    });
  });

  it("reports idle for an undefined applicationId", () => {
    expect(resolveDocs(SETTLED_FOR_OTHER, undefined)).toEqual({
      status: "idle",
      resume: "",
      coverLetter: "",
      error: "",
    });
  });

  it("reports loading with empty documents when state belongs to a different application id", () => {
    // state holds a COMPLETED load for "app-other" -- resolveDocs must not
    // surface app-other's documents while app-1's own load is in flight.
    expect(resolveDocs(SETTLED_FOR_OTHER, "app-1")).toEqual({
      status: "loading",
      resume: "",
      coverLetter: "",
      error: "",
    });
  });

  it("reports loading with no error even when the other id's settled state was an error", () => {
    const settledError = {
      forId: "app-other",
      outcome: "error",
      resume: "",
      coverLetter: "",
      error: "other application's load failed",
    };
    expect(resolveDocs(settledError, "app-1")).toEqual({
      status: "loading",
      resume: "",
      coverLetter: "",
      error: "",
    });
  });

  it("returns the stored documents when forId matches and outcome is done", () => {
    const state = {
      forId: "app-1",
      outcome: "done",
      resume: "resume text",
      coverLetter: "cover letter text",
      error: "",
    };
    expect(resolveDocs(state, "app-1")).toEqual({
      status: "done",
      resume: "resume text",
      coverLetter: "cover letter text",
      error: "",
    });
  });

  it("returns the stored error when forId matches and outcome is error", () => {
    const state = {
      forId: "app-1",
      outcome: "error",
      resume: "",
      coverLetter: "",
      error: "Could not load the submitted documents.",
    };
    expect(resolveDocs(state, "app-1")).toEqual({
      status: "error",
      resume: "",
      coverLetter: "",
      error: "Could not load the submitted documents.",
    });
  });

  // BUG-H2: retry() sets outcome to "loading" on the existing entry (rather
  // than resetting state back to INITIAL_STATE) so the panel stops showing
  // a stale error while the retry is in flight. Pin that resolveDocs
  // reports "loading" for this case rather than falling through to
  // whatever a naive implementation might do with an unrecognized outcome.
  it("reports loading when forId matches and outcome is loading (the retry-in-flight state)", () => {
    const state = {
      forId: "app-1",
      outcome: "loading",
      resume: "",
      coverLetter: "",
      error: "",
    };
    expect(resolveDocs(state, "app-1")).toEqual({
      status: "loading",
      resume: "",
      coverLetter: "",
      error: "",
    });
  });

  it("reports loading for the retry-in-flight state even when stale resume/coverLetter/error fields linger on the entry", () => {
    // retry() only overwrites `outcome`, via `{ ...prev, outcome: "loading" }`
    // -- prev's resume/coverLetter/error fields (from the failed load) are
    // still sitting on the object. resolveDocs must report status
    // "loading" here regardless of what those stale fields hold.
    const state = {
      forId: "app-1",
      outcome: "loading",
      resume: "",
      coverLetter: "",
      error: "stale error from the previous failed load",
    };
    const result = resolveDocs(state, "app-1");
    expect(result.status).toBe("loading");
  });
});
