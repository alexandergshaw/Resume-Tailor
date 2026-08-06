import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}));

vi.mock("./applicationDocs", () => ({
  fetchApplicationDocs: vi.fn(),
}));

import { loadApplicationDocs } from "./applicationDocsClient.js";
import { createClient } from "@/lib/supabase/client";
import { fetchApplicationDocs } from "./applicationDocs";

function makeFakeSupabase({ user = null, userError = null } = {}) {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user }, error: userError })),
    },
  };
}

describe("loadApplicationDocs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty docs and never calls createClient for an empty-string applicationId", async () => {
    const result = await loadApplicationDocs("");

    expect(result).toEqual({ resume: "", coverLetter: "" });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("returns empty docs and never calls createClient for a null applicationId", async () => {
    const result = await loadApplicationDocs(null);

    expect(result).toEqual({ resume: "", coverLetter: "" });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("returns empty docs and never calls createClient for an undefined applicationId", async () => {
    const result = await loadApplicationDocs(undefined);

    expect(result).toEqual({ resume: "", coverLetter: "" });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("throws an Error carrying the auth error message when auth.getUser() errors", async () => {
    const fake = makeFakeSupabase({ user: null, userError: { message: "session expired" } });
    createClient.mockReturnValue(fake);

    await expect(loadApplicationDocs("app-1")).rejects.toThrow("session expired");
    expect(fetchApplicationDocs).not.toHaveBeenCalled();
  });

  it("degrades to empty docs, without throwing, when there is no signed-in user and no auth error", async () => {
    const fake = makeFakeSupabase({ user: null, userError: null });
    createClient.mockReturnValue(fake);

    const result = await loadApplicationDocs("app-1");

    expect(result).toEqual({ resume: "", coverLetter: "" });
    expect(fetchApplicationDocs).not.toHaveBeenCalled();
  });

  it("degrades to empty docs when data.user itself is absent (no `user` key at all)", async () => {
    const fake = {
      auth: {
        getUser: vi.fn(async () => ({ data: {}, error: null })),
      },
    };
    createClient.mockReturnValue(fake);

    const result = await loadApplicationDocs("app-1");

    expect(result).toEqual({ resume: "", coverLetter: "" });
    expect(fetchApplicationDocs).not.toHaveBeenCalled();
  });

  it("delegates to fetchApplicationDocs with the supabase client and { applicationId, userId } on the happy path", async () => {
    const fake = makeFakeSupabase({ user: { id: "user-1" }, userError: null });
    createClient.mockReturnValue(fake);
    const fetchResult = { resume: "resume text", coverLetter: "cover letter text" };
    fetchApplicationDocs.mockResolvedValue(fetchResult);

    const result = await loadApplicationDocs("app-1");

    // The userId filter is a security control -- it is what stops one
    // user's browser-side load from reading another user's submitted
    // documents even if RLS were misconfigured -- so pin the exact
    // arguments, not just that fetchApplicationDocs was called.
    expect(fetchApplicationDocs).toHaveBeenCalledWith(fake, {
      applicationId: "app-1",
      userId: "user-1",
    });
    expect(fetchApplicationDocs).toHaveBeenCalledTimes(1);
    expect(result).toBe(fetchResult);
  });
});
