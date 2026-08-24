import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/experiencePages", () => ({
  createPage: vi.fn(),
  updatePage: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import * as store from "@/lib/supabase/experiencePages";
import { POST } from "./route.js";

function jsonRequest(body) {
  return { json: async () => body };
}

function mockUser(id = "user-1") {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: id ? { id } : null } }) },
  });
}

function page(over = {}) {
  return {
    id: "page-1",
    user_id: "user-1",
    parent_id: null,
    title: "Weekly sync",
    body: "",
    position: 0,
    archived_at: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/meeting/save", () => {
  it("401s when signed out, and never touches the data layer", async () => {
    mockUser(null);
    const res = await POST(jsonRequest({ title: "Weekly sync", body: "Notes." }));
    expect(res.status).toBe(401);
    expect(store.createPage).not.toHaveBeenCalled();
  });

  it("400s when title is missing or blank", async () => {
    mockUser();
    const res = await POST(jsonRequest({ title: "   ", body: "Notes." }));
    expect(res.status).toBe(400);
    expect(store.createPage).not.toHaveBeenCalled();
  });

  it("400s on invalid JSON", async () => {
    mockUser();
    const res = await POST({
      json: async () => {
        throw new SyntaxError("bad json");
      },
    });
    expect(res.status).toBe(400);
  });

  it("creates the page as a top-level page, then writes its body, and returns the saved page", async () => {
    mockUser("user-1");
    store.createPage.mockResolvedValue({ page: page({ id: "new-page" }), error: null });
    store.updatePage.mockResolvedValue({
      page: page({ id: "new-page", body: "Discussed the Q3 roadmap." }),
      error: null,
    });

    const res = await POST(jsonRequest({ title: "  Weekly sync  ", body: "Discussed the Q3 roadmap." }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(store.createPage).toHaveBeenCalledWith(expect.anything(), "user-1", {
      title: "Weekly sync",
      parentId: null,
    });
    expect(store.updatePage).toHaveBeenCalledWith(expect.anything(), "user-1", "new-page", {
      body: "Discussed the Q3 roadmap.",
    });
    expect(json.page.id).toBe("new-page");
    expect(json.page.body).toBe("Discussed the Q3 roadmap.");
  });

  it("NEVER sets generated_kind or generated_at — a recorded meeting must stay eligible for tailoring and interview prep", async () => {
    // Positive control for the honesty rule this route's own header comment
    // explains at length: lib/copilot/projectStories.js's isGeneratedPage and
    // lib/experience/tailorSources.js's isGeneratedPage BOTH exclude any page
    // whose generated_kind column is set — the opposite of
    // app/api/experience/research/route.js, which explicitly stamps its own
    // output that way (see that route's own test asserting the update DOES
    // carry generated_kind). If this route ever grew that same stamp, this is
    // where it would show up: neither the patch handed to updatePage nor the
    // page this route hands back to the caller may carry the field.
    mockUser("user-1");
    store.createPage.mockResolvedValue({ page: page({ id: "new-page" }), error: null });
    store.updatePage.mockResolvedValue({ page: page({ id: "new-page", body: "Notes." }), error: null });

    const res = await POST(jsonRequest({ title: "Weekly sync", body: "Notes." }));
    const json = await res.json();

    expect(res.status).toBe(200);
    const updatePatch = store.updatePage.mock.calls[0][3];
    expect(updatePatch).not.toHaveProperty("generated_kind");
    expect(updatePatch).not.toHaveProperty("generated_at");
    expect(json.page).not.toHaveProperty("generated_kind");
    expect(json.page).not.toHaveProperty("generated_at");
  });

  it("returns a clear, retryable error when the create step fails, and never calls updatePage", async () => {
    mockUser("user-1");
    store.createPage.mockResolvedValue({ page: null, error: "insert failed" });

    const res = await POST(jsonRequest({ title: "Weekly sync", body: "Notes." }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(typeof json.error).toBe("string");
    expect(json.error.length).toBeGreaterThan(0);
    expect(store.updatePage).not.toHaveBeenCalled();
  });

  it("returns a clear, retryable error when the body write fails, after the page was already created", async () => {
    mockUser("user-1");
    store.createPage.mockResolvedValue({ page: page({ id: "new-page" }), error: null });
    store.updatePage.mockResolvedValue({ page: null, error: "update failed" });

    const res = await POST(jsonRequest({ title: "Weekly sync", body: "Notes." }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(typeof json.error).toBe("string");
    expect(json.error.length).toBeGreaterThan(0);
  });
});
