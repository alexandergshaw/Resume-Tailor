import { describe, it, expect, vi, beforeEach } from "vitest";

// Route-level wiring for feeding the caller's own "Professional Experience"
// project pages into the GEMINI tailoring prompt as context. The pure
// budgeting/formatting rules already have their own gate
// (lib/experience/tailorContext.test.js); these tests exercise the actual
// wiring — that a fetched page's title/body genuinely reaches the prompt
// Gemini receives (reading generateContent.mock.calls[...][0].contents, not
// merely that some helper was called) — and the server-side exclusions
// (generated_kind, archived_at) and budget-truncation warning that only make
// sense at the route layer.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/experiencePages", () => ({ listPages: vi.fn() }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { listPages } from "@/lib/supabase/experiencePages";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { POST } from "./route.js";

function fakeSupabase(userId) {
  return {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }) },
  };
}

function signedIn(userId = "user-1") {
  createClient.mockResolvedValue(fakeSupabase(userId));
}

function signedOut() {
  createClient.mockResolvedValue(fakeSupabase(null));
}

function textFile(name, content, type = "text/plain") {
  const f = new File([content], name, { type });
  // Node's built-in File.text() already returns the right bytes for a plain
  // string Blob part, but pin it explicitly (matches the pattern other route
  // tests in this repo use for File stand-ins) so this test never depends on
  // the runtime's Blob/File implementation details.
  f.text = async () => content;
  return f;
}

function tailorRequest({
  jobPosting = "We need a payments engineer to rebuild our settlement pipeline.",
  resumeText = "Jane Doe\nSoftware Engineer\nBuilt things.",
  templateLines = ["Jane Doe", "Software Engineer", "Built things."],
  coverLetterTemplateLines = null,
  coverLetterText = null,
  engine = "gemini",
} = {}) {
  const fd = new FormData();
  fd.append("jobPosting", jobPosting);
  fd.append("resume", textFile("resume.txt", resumeText));
  fd.append("templateLines", JSON.stringify(templateLines));
  if (engine) fd.append("engine", engine);
  if (coverLetterTemplateLines) {
    fd.append("coverLetterTemplateLines", JSON.stringify(coverLetterTemplateLines));
    fd.append("coverLetter", textFile("cover.txt", coverLetterText || "Dear Hiring Manager,\nI am excited.\nSincerely, Jane"));
  }
  return { formData: async () => fd };
}

function mockGeminiOk(resultLines = ["Jane Doe", "Software Engineer", "Built things."]) {
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  const generateContent = vi.fn().mockResolvedValue({
    text: JSON.stringify({ jobTitle: "Payments Engineer", companyName: "Acme", resultLines }),
  });
  getGeminiClient.mockReturnValue({ models: { generateContent } });
  return generateContent;
}

function page(over = {}) {
  return {
    id: "p1",
    title: "Payments migration",
    body: "Rebuilt the settlement pipeline end to end, cutting settlement time from three days to one.",
    generated_kind: null,
    archived_at: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/tailor feeds project pages into the Gemini prompt", () => {
  it("puts the caller's own project page title and body into the prompt actually sent to Gemini", async () => {
    signedIn("user-1");
    listPages.mockResolvedValue({ pages: [page()], error: null });
    const generateContent = mockGeminiOk();

    const res = await POST(tailorRequest());
    expect(res.status).toBe(200);

    expect(listPages).toHaveBeenCalledWith(expect.anything(), "user-1");
    const sentPrompt = generateContent.mock.calls[0][0].contents;
    expect(sentPrompt).toContain("Payments migration");
    expect(sentPrompt).toContain("Rebuilt the settlement pipeline end to end");
  });

  it("never reads pages from the request body — only formData fields the route already parses reach the engine", async () => {
    signedIn("user-1");
    listPages.mockResolvedValue({ pages: [page()], error: null });
    const generateContent = mockGeminiOk();

    const fd = new FormData();
    fd.append("jobPosting", "We need an engineer.");
    fd.append("resume", textFile("resume.txt", "Jane Doe\nEngineer"));
    fd.append("templateLines", JSON.stringify(["Jane Doe", "Engineer"]));
    fd.append("engine", "gemini");
    // A client-supplied "pages" field must be ignored — pages only ever come
    // from the server-side listPages(supabase, userId) fetch above.
    fd.append("pages", JSON.stringify([{ title: "Injected", body: "should never appear" }]));

    const res = await POST({ formData: async () => fd });
    expect(res.status).toBe(200);
    const sentPrompt = generateContent.mock.calls[0][0].contents;
    expect(sentPrompt).not.toContain("Injected");
    expect(sentPrompt).not.toContain("should never appear");
    // The real, server-fetched page still made it in.
    expect(sentPrompt).toContain("Payments migration");
  });

  it("produces a prompt with no Supporting-documents content when the caller has no eligible pages, same as an upload-only request", async () => {
    signedIn("user-1");
    listPages.mockResolvedValue({ pages: [], error: null });
    const generateContent = mockGeminiOk();

    const res = await POST(tailorRequest());
    expect(res.status).toBe(200);
    const sentPrompt = generateContent.mock.calls[0][0].contents;
    // buildContextDocumentsBlock's own literal output for an empty array —
    // proof nothing was appended, not just an absence of page text.
    expect(sentPrompt).toContain("Supporting documents:\nNone provided.");
  });

  it("never fetches pages for a signed-out caller, and the prompt matches the signed-in-with-no-pages case exactly", async () => {
    signedOut();
    const generateContent = mockGeminiOk();

    const res = await POST(tailorRequest());
    expect(res.status).toBe(200);
    expect(listPages).not.toHaveBeenCalled();
    const sentPrompt = generateContent.mock.calls[0][0].contents;
    expect(sentPrompt).toContain("Supporting documents:\nNone provided.");
  });

  it("excludes a generated page and an archived page, keeping only the ordinary one", async () => {
    signedIn("user-1");
    listPages.mockResolvedValue({
      pages: [
        page(),
        page({ id: "r1", title: "Research: Payments (2026-08-12)", generated_kind: "research" }),
        page({ id: "a1", title: "Old archived idea", archived_at: "2026-08-01T00:00:00.000Z" }),
      ],
      error: null,
    });
    const generateContent = mockGeminiOk();

    const res = await POST(tailorRequest());
    expect(res.status).toBe(200);
    const sentPrompt = generateContent.mock.calls[0][0].contents;
    expect(sentPrompt).toContain("Payments migration");
    expect(sentPrompt).not.toContain("Research: Payments");
    expect(sentPrompt).not.toContain("Old archived idea");
  });

  it("warns the caller and notes it in the prompt when project pages had to be truncated to fit budget", async () => {
    signedIn("user-1");
    const huge = Array.from({ length: 20 }, (_, i) =>
      page({ id: `p${i}`, title: `Project ${i}`, body: "x".repeat(3000) }),
    );
    listPages.mockResolvedValue({ pages: huge, error: null });
    const generateContent = mockGeminiOk();

    const res = await POST(tailorRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.warnings.some((w) => /project page/i.test(w) && /budget|truncat|left out/i.test(w))).toBe(true);
    const sentPrompt = generateContent.mock.calls[0][0].contents;
    expect(sentPrompt.toLowerCase()).toMatch(/not included/);
  });

  it("also grounds the cover letter in the project pages (contextDocuments is shared with tailorCoverLetter)", async () => {
    signedIn("user-1");
    listPages.mockResolvedValue({ pages: [page()], error: null });
    const generateContent = mockGeminiOk();

    const res = await POST(
      tailorRequest({
        coverLetterTemplateLines: ["Dear Hiring Manager,", "I am excited.", "Sincerely, Jane"],
      }),
    );
    expect(res.status).toBe(200);
    // Second generateContent call is the cover letter draft.
    expect(generateContent.mock.calls.length).toBeGreaterThanOrEqual(2);
    const coverLetterPrompt = generateContent.mock.calls[1][0].contents;
    expect(coverLetterPrompt).toContain("Payments migration");
  });
});
