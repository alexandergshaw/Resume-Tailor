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
import { registerEngine } from "@/lib/llm/engines";
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

  // The owner saw "some of your project pages ... were left out" and asked
  // "which ones?" — the app could not answer. These pin that the warning
  // itself now names them (buildTailorContextBlock's own in-block notice
  // stays a count — see tailorContext.js's header — but the warning surfaced
  // to the human must not be).
  it("names the specific pages it left out in the warning, not just how many", async () => {
    signedIn("user-1");
    listPages.mockResolvedValue({
      pages: [
        page({ id: "keep", title: "Keeper", body: "short body" }),
        page({ id: "huge1", title: "Alpha Overflow", body: "x".repeat(25000) }),
        page({ id: "huge2", title: "Beta Overflow", body: "y".repeat(25000) }),
      ],
      error: null,
    });
    const generateContent = mockGeminiOk();

    const res = await POST(tailorRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    const warning = data.warnings.find((w) => /project page/i.test(w) && /left out/i.test(w));
    expect(warning).toBeTruthy();
    expect(warning).toContain("Alpha Overflow");
    expect(warning).toContain("Beta Overflow");
    // The included page's own name has no business in a warning about what
    // was excluded.
    expect(warning).not.toContain("Keeper");
  });

  it("stays readable when five pages are dropped — names every one", async () => {
    signedIn("user-1");
    const droppedTitles = ["Proj A", "Proj B", "Proj C", "Proj D", "Proj E"];
    listPages.mockResolvedValue({
      pages: [
        page({ id: "keep", title: "Keeper", body: "short body" }),
        ...droppedTitles.map((title, i) => page({ id: `huge${i}`, title, body: "x".repeat(25000) })),
      ],
      error: null,
    });
    const generateContent = mockGeminiOk();

    const res = await POST(tailorRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    const warning = data.warnings.find((w) => /project page/i.test(w) && /left out/i.test(w));
    expect(warning).toBeTruthy();
    for (const title of droppedTitles) {
      expect(warning).toContain(title);
    }
  });

  it("does not let the warning sprawl when dozens of pages are dropped — caps the named list and counts the rest", async () => {
    signedIn("user-1");
    const droppedTitles = Array.from({ length: 15 }, (_, i) => `Overflow Project ${i}`);
    listPages.mockResolvedValue({
      pages: [
        page({ id: "keep", title: "Keeper", body: "short body" }),
        ...droppedTitles.map((title, i) => page({ id: `huge${i}`, title, body: "x".repeat(25000) })),
      ],
      error: null,
    });
    const generateContent = mockGeminiOk();

    const res = await POST(tailorRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    const warning = data.warnings.find((w) => /project page/i.test(w) && /left out/i.test(w));
    expect(warning).toBeTruthy();
    // Not every one of the 15 names is spelled out verbatim...
    expect(warning).not.toContain("Overflow Project 14");
    // ...but the remainder is still accounted for, not silently dropped a
    // second time.
    expect(warning).toMatch(/\d+ more/);
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

// The gap left open by 7d0f1c2: /api/tailor's `warnings` aggregated only the
// résumé result's own warnings, so a cover-letter- (or hiring-email-) specific
// degradation from the embedded engine's producers (resolveSteering,
// focusOutputs, resolveKeywordEdits, editRuleOutputs in
// lib/llm/engines/tailor-lite/engine.js) was silently dropped at the route
// before any client could render it. These tests exercise the REAL embedded
// engine (deterministic, offline, no mocking needed) so the warning text is
// exactly what a user would see, and pin: (1) a cover-letter-only warning
// reaches the response, attributed with a "Cover letter:" prefix; (2) a
// warning the résumé and cover letter both legitimately raise for the
// identical reason (steeringInstructions/focusArea/keywordEdits are threaded
// unchanged into both engine calls) is not shown twice; (3) a résumé-only run
// is byte-identical to the pre-existing (unprefixed) behavior; (4) the same
// attribution applies to a hiring-email warning, via a fake engine registered
// through the public registerEngine() contract (lib/llm/engines/index.js) —
// no real engine populates tailorHiringEmail's warnings today, so this is the
// only way to pin the route's handling of that field without touching
// lib/llm/engines internals.
describe("POST /api/tailor aggregates and attributes cover-letter / hiring-email warnings (DEFECT: known gap in 7d0f1c2)", () => {
  const EMBEDDED_POSTING = [
    "Senior Software Engineer.",
    "Requirements:",
    "React, JavaScript, TypeScript, SQL, PostgreSQL, REST APIs, Agile, leadership.",
    "Nice to have: Kubernetes, Docker.",
  ].join("\n");

  function embeddedRequest({
    engine = "embedded",
    steeringInstructions = "",
    focusArea = "",
    editRules = null,
    withCoverLetter = true,
  } = {}) {
    const fd = new FormData();
    fd.append("jobPosting", EMBEDDED_POSTING);
    fd.append("resume", textFile("resume.txt", "Jane Doe\nSoftware Engineer\nBuilt things."));
    fd.append("templateLines", JSON.stringify(["Jane Doe", "Software Engineer", "Built things."]));
    fd.append("engine", engine);
    if (steeringInstructions) fd.append("steeringInstructions", steeringInstructions);
    if (focusArea) fd.append("focusArea", focusArea);
    if (editRules) fd.append("editRules", JSON.stringify(editRules));
    if (withCoverLetter) {
      fd.append(
        "coverLetterTemplateLines",
        JSON.stringify(["Dear Hiring Manager,", "I am excited.", "Sincerely, Jane"]),
      );
      fd.append("coverLetter", textFile("cover.txt", "Dear Hiring Manager,\nI am excited.\nSincerely, Jane"));
    }
    return { formData: async () => fd };
  }

  it("surfaces a cover-letter-only degradation in `warnings`, attributed to the cover letter", async () => {
    signedOut();
    // This edit-rule's `before` text ("I lead an engineering team of five")
    // only occurs in the embedded engine's cover-letter template (industry
    // variant) — never in the résumé template's digit-form "team of 5" — so
    // this is a genuine cover-letter-ONLY degradation, confirmed against the
    // real engine before writing this assertion.
    const res = await POST(
      embeddedRequest({
        editRules: [
          { before: "I lead an engineering team of five", after: "I lead an engineering team of six" },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.warnings).toContain(
      'Cover letter: Applied your recurring edit: "I lead an engineering team of five" → "I lead an engineering team of six".',
    );
    // The résumé's own run over the same edit rule produces no such warning
    // (the phrase never appears there), so nothing unprefixed should smuggle
    // the same text in under the résumé's name.
    expect(data.warnings).not.toContain(
      'Applied your recurring edit: "I lead an engineering team of five" → "I lead an engineering team of six".',
    );
  });

  it("does not duplicate a warning the résumé and cover letter both legitimately raise for the identical reason", async () => {
    signedOut();
    // steeringInstructions is threaded unchanged into both the tailorResume and
    // tailorCoverLetter calls (see app/api/tailor/route.js), so an unparseable
    // note deterministically raises the identical warning text on both — this
    // is confirmed identical byte-for-byte against the real engine, not
    // assumed.
    const res = await POST(
      embeddedRequest({ steeringInstructions: "make it generally nicer somehow" }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    const matches = data.warnings.filter((w) => /couldn't find any in your note/i.test(w));
    expect(matches.length).toBe(1);
    // Kept in the résumé's own (unprefixed) form — it is genuinely, equally
    // true of the document the user is looking at, whichever one that is.
    expect(matches[0]).not.toMatch(/^Cover letter:/i);
  });

  it("leaves a résumé-only run's warnings exactly as before (no cover letter in the request)", async () => {
    signedOut();
    const res = await POST(
      embeddedRequest({ focusArea: "Underwater Basket Weaving", withCoverLetter: false }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.warnings).toEqual([
      "Focus area \"Underwater Basket Weaving\" isn't in your library — auto-detection was used instead.",
    ]);
  });

  it("attributes a hiring-email warning the same way, via the public registerEngine() contract", async () => {
    signedOut();
    registerEngine({
      name: "test-hiring-email-warnings",
      isConfigured: () => true,
      async tailorResume() {
        return {
          engine: "test-hiring-email-warnings",
          result: "Jane Doe\nSoftware Engineer",
          resultLines: ["Jane Doe", "Software Engineer"],
          jobTitle: "Software Engineer",
          companyName: "Acme",
          docxB64: "",
          report: null,
          warnings: [],
          degraded: false,
        };
      },
      async tailorCoverLetter() {
        return {
          engine: "test-hiring-email-warnings",
          result: "",
          resultLines: [],
          docxB64: "",
          report: null,
          warnings: [],
          degraded: false,
        };
      },
      async tailorHiringEmail() {
        return {
          engine: "test-hiring-email-warnings",
          subject: "Application",
          bodyLines: ["Dear Hiring Committee,"],
          warnings: ["Couldn't confirm a matching capability in your library."],
        };
      },
    });

    const res = await POST(embeddedRequest({ engine: "test-hiring-email-warnings", withCoverLetter: false }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.warnings).toContain(
      "Hiring email: Couldn't confirm a matching capability in your library.",
    );
  });
});
