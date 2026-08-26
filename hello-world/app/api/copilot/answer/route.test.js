import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { POST } from "./route.js";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { createClient } from "@/lib/supabase/server";
import { draftSampleAnswerLocal } from "@/lib/copilot/sampleAnswerLocal";
import { normalizeInterviewType } from "@/lib/copilot/interviewTypes";
// AC-V5.2: the route now caches its Supabase fan-out per (userId,
// applicationId) for the life of a server instance (lib/copilot/
// answerSessionCache.js). Cleared before every test below because this file
// reuses the SAME synthetic user id ("user-1") and application id ("app-1")
// across many independent `it()` blocks, each with its own, DIFFERENT
// mocked Supabase content — a real product behaviour (this cache is correct
// to serve a second question of one interview from the first question's
// fetch) that would otherwise leak between unrelated test cases and serve
// one test's mocked résumé/pages to the next.
import { answerContextCache } from "@/lib/copilot/answerSessionCache";

function jsonRequest(body) {
  return { json: async () => body };
}

function mockUser(id = "user-1") {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: id ? { id } : null } }) },
  });
}

// A fake Supabase client that also answers the `.from(...)` chain
// fetchApplicationDocs (lib/copilot/applicationDocs.js) issues for "answer"
// mode's grounding lookup: one scoped select against `applications`, then
// one each against `generated_resumes` / `generated_cover_letters` for
// whichever ids that row carries. `application` is the row the applications
// lookup finds (or null for "no such application"); `resumeContent` /
// `coverLetterContent` are what the two document tables hand back for the
// row's resume_used_id / cover_letter_id.
//
// Also answers lib/supabase/experiencePages.js's listPages query against
// `experience_pages` — `.select("*").eq("user_id", ...).is("archived_at",
// null).order("position", ...)` — which the applications/resumes/cover-
// letters lookups above never call, so `is`/`order` are additions rather than
// a replacement for the existing `maybeSingle` terminator. Real supabase-js
// query builders are themselves awaitable (no `.single()`/`.maybeSingle()`
// needed at the end), so `order` here returns a THENABLE — a plain resolved
// value works the same under `await`, and is simplest — carrying
// `{ data: pages, error: null }` rather than another link in the chain.
// `pages` defaults to `[]`, so every one of the ~15 existing callers of this
// helper that never pass it keep asserting exactly what they asserted before
// project pages existed as a source.
function mockUserWithApplicationDocs({
  id = "user-1",
  application = null,
  resumeContent = null,
  coverLetterContent = null,
  pages = [],
} = {}) {
  const from = vi.fn((table) => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      is: vi.fn(() => chain),
      order: vi.fn(async () => ({ data: table === "experience_pages" ? pages : null, error: null })),
      maybeSingle: vi.fn(async () => {
        if (table === "applications") return { data: application, error: null };
        if (table === "generated_resumes") {
          return { data: resumeContent != null ? { content: resumeContent } : null, error: null };
        }
        if (table === "generated_cover_letters") {
          return { data: coverLetterContent != null ? { content: coverLetterContent } : null, error: null };
        }
        return { data: null, error: null };
      }),
    };
    return chain;
  });
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: id ? { id } : null } }) },
    from,
  });
}

// Mocks the Gemini path to return exactly the given payload, the same shape
// the route asks the model for via buildPointsPrompt/buildAnswerPrompt's JSON
// contract.
function mockGemini(payload) {
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  getGeminiClient.mockReturnValue({
    models: {
      generateContent: vi.fn().mockResolvedValue({ text: JSON.stringify(payload) }),
    },
  });
}

const PROFILE = [
  "Senior Software Engineer, Acme Corp",
  "Jan 2020 – Present",
  "Built a React and Node.js platform serving 2M users.",
].join("\n");

// A résumé-shaped document distinct from PROFILE, so an assertion that this
// text (and not the prep-notes profile) shaped the answer is unambiguous.
const RESUME_DOC = [
  "Senior Software Engineer, Quantum Robotics",
  "Jan 2020 – Present",
  "Led the checkout redesign, cutting cart abandonment by 18%.",
].join("\n");

const COVER_LETTER_DOC =
  "I'm excited about this role because of your focus on sustainable robotics.";

beforeEach(() => {
  vi.clearAllMocks();
  answerContextCache.clear();
});

describe("POST /api/copilot/answer (embedded engine)", () => {
  it("401s when not signed in", async () => {
    mockUser(null);
    const res = await POST(jsonRequest({ question: "Tell me about yourself.", engine: "embedded" }));
    expect(res.status).toBe(401);
  });

  it("drafts STAR talking points on-device — no Gemini call", async () => {
    mockUser();
    const res = await POST(
      jsonRequest({
        question: "Tell me about a time you handled a tight deadline.",
        profile: PROFILE,
        engine: "embedded",
      }),
    );
    const data = await res.json();
    expect(data.type).toBe("behavioral");
    expect(Array.isArray(data.points)).toBe(true);
    expect(data.points[0]).toMatch(/^Situation:/);
    expect(getGeminiClient).not.toHaveBeenCalled();
    expect(getServerEnv).not.toHaveBeenCalled();
  });

  it("400s when no question is provided", async () => {
    mockUser();
    const res = await POST(jsonRequest({ question: "  ", engine: "embedded" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/copilot/answer (points mode is unmoved by the answer-mode change)", () => {
  it("treats an unrecognized mode value the same as no mode at all — never {answer,grounding}", async () => {
    mockUser();
    const res = await POST(
      jsonRequest({
        question: "Tell me about a time you handled a tight deadline.",
        profile: PROFILE,
        engine: "embedded",
        mode: "sample-answer", // anything but the literal string "answer"
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    // AC-K1/AC-6.2: points mode gained the reading aids — the list has grown
    // again since this assertion was first written (cues, buzzwords,
    // resumeAnchor, idealProject, and now pageSources, each added the same
    // way). The rule this exact-key-set form protects was never "the list
    // stays this length" — it is that `answer` and `grounding` stay answer
    // mode's alone, which is what the two `not.toHaveProperty` checks right
    // below assert directly.
    expect(Object.keys(data).sort()).toEqual([
      "buzzwords",
      "cues",
      "idealProject",
      "pageSources",
      "points",
      "resumeAnchor",
      "type",
    ]);
    expect(data).not.toHaveProperty("answer");
    expect(data).not.toHaveProperty("grounding");
    expect(Array.isArray(data.points)).toBe(true);
    expect(data.points.length).toBeGreaterThan(0);
  });

  it("gemini points mode returns points, type and the reading aids — still no grounding key", async () => {
    mockUser();
    mockGemini({ points: ["Point one", "Point two", "Point three"], type: "technical" });
    const res = await POST(jsonRequest({ question: "How would you design a rate limiter?", engine: "gemini" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({
      points: ["Point one", "Point two", "Point three"],
      type: "technical",
      // Already short, so each cue is its point minus terminal punctuation.
      cues: ["Point one", "Point two", "Point three"],
      // No posting selected -> nothing to mine; no submitted résumé and no
      // prep profile -> no role to name. Both degrade to "section absent",
      // never to an empty header.
      buzzwords: [],
      resumeAnchor: null,
      idealProject: null,
      // No pages on file (mockUser() alone), so no `pageIds` request was
      // even made of the model — [] rather than an array of nulls, same
      // "nothing to cite" degrade as route.knowledgeBase.test.js pins.
      pageSources: [],
    });
  });
});

describe("POST /api/copilot/answer (answer mode)", () => {
  it("401s when not signed in", async () => {
    mockUser(null);
    const res = await POST(
      jsonRequest({ question: "Tell me about yourself.", mode: "answer", engine: "embedded" }),
    );
    expect(res.status).toBe(401);
  });

  it("400s when no question is provided", async () => {
    mockUser();
    const res = await POST(jsonRequest({ question: "   ", mode: "answer", engine: "embedded" }));
    expect(res.status).toBe(400);
  });

  it("embedded engine drafts the sample answer via draftSampleAnswerLocal and never constructs a Gemini client", async () => {
    mockUser();
    const question = "Tell me about a time you handled a tight deadline.";
    const res = await POST(jsonRequest({ question, profile: PROFILE, mode: "answer", engine: "embedded" }));
    expect(res.status).toBe(200);
    const data = await res.json();

    // No application was linked, so the route's own resume/coverLetter
    // inputs to draftSampleAnswerLocal are both "" — matched here exactly.
    const expected = draftSampleAnswerLocal({
      question,
      profile: PROFILE,
      resume: "",
      coverLetter: "",
      interviewType: normalizeInterviewType(undefined),
    });
    expect(data.points).toEqual(expected.points);
    expect(data.answer).toBe(expected.answer);
    expect(data.type).toBe(expected.type);
    expect(data.grounding).toEqual({ resume: false, coverLetter: false, pages: false });
    expect(getGeminiClient).not.toHaveBeenCalled();
    expect(getServerEnv).not.toHaveBeenCalled();
  });

  it("grounding is {resume:false,coverLetter:false} when the linked application has no documents on it", async () => {
    mockUserWithApplicationDocs({
      application: { id: "app-1", resume_used_id: null, cover_letter_id: null },
    });
    const res = await POST(
      jsonRequest({
        question: "Tell me about yourself.",
        mode: "answer",
        engine: "embedded",
        applicationId: "app-1",
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.grounding).toEqual({ resume: false, coverLetter: false, pages: false });
  });

  it("embedded engine: grounding is {resume:true,coverLetter:true} and the submitted documents actually shape the answer", async () => {
    mockUserWithApplicationDocs({
      application: { id: "app-1", resume_used_id: "resume-1", cover_letter_id: "cl-1" },
      resumeContent: RESUME_DOC,
      coverLetterContent: COVER_LETTER_DOC,
    });
    const question = "Tell me about a time you led a difficult project.";
    const res = await POST(
      jsonRequest({ question, mode: "answer", engine: "embedded", applicationId: "app-1" }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();

    const expected = draftSampleAnswerLocal({
      question,
      profile: "",
      resume: RESUME_DOC,
      coverLetter: COVER_LETTER_DOC,
      interviewType: normalizeInterviewType(undefined),
    });
    expect(data.points).toEqual(expected.points);
    expect(data.answer).toBe(expected.answer);
    expect(data.grounding).toEqual({ resume: true, coverLetter: true, pages: false });
    // Not just "grounding is true" — the résumé's own material is what
    // shaped the spoken answer.
    expect(data.answer).toContain("Quantum Robotics");
  });

  it("gemini engine: points come from the model, answer is derived from them (never a second model field), and the submitted docs reach the prompt", async () => {
    mockUserWithApplicationDocs({
      application: { id: "app-1", resume_used_id: "resume-1", cover_letter_id: "cl-1" },
      resumeContent: RESUME_DOC,
      coverLetterContent: COVER_LETTER_DOC,
    });
    mockGemini({
      points: ["Situation: I led the checkout redesign.", "Result: We cut cart abandonment by 18%."],
      type: "behavioral",
    });
    const res = await POST(
      jsonRequest({
        question: "Tell me about a time you led a difficult project.",
        mode: "answer",
        engine: "gemini",
        applicationId: "app-1",
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({
      points: ["Situation: I led the checkout redesign.", "Result: We cut cart abandonment by 18%."],
      // Derived: STAR labels stripped, joined with a single space — never a
      // second field the model was asked to generate (AC-H9.33).
      answer: "I led the checkout redesign. We cut cart abandonment by 18%.",
      type: "behavioral",
      // `pages` is the knowledge-base half of the same report — false here
      // because this fixture has no project pages. It is derived from what
      // reached the PROMPT (kb.includedPages), not from the citations the
      // model returned, so practice mode's caption can name the knowledge
      // base as a source instead of claiming "prep context only" beneath
      // bullets that cite a page. Still exact equality: the rule these
      // assertions protect is that `answer`/`grounding` stay answer-mode-only.
      grounding: { resume: true, coverLetter: true, pages: false },
      // AC-K1.1: this model response carried no `cues`, so they fall back to
      // the deterministic shortening of the points — STAR label kept, the
      // sentence behind it cut to a prompt.
      cues: ["Situation: Led the checkout redesign", "Result: Cut cart abandonment by 18%"],
      // AC-K1.2: the fake application row carries no joined position, so
      // there is no posting description to mine.
      buzzwords: [],
      // AC-K1.3: read out of the SUBMITTED résumé, not the prep profile.
      resumeAnchor: {
        title: "Senior Software Engineer",
        company: "Quantum Robotics",
        matched: true,
        project: "Led the checkout redesign, cutting cart abandonment by 18%",
        // RESUME_DOC has only one usable bullet for this role, so there is
        // no second one to describe it with.
        description: [],
        // AC-K1.3 correction: this anchor was mined from the SUBMITTED
        // résumé (RESUME_DOC), not the prep profile, so it is honestly
        // labeled "resume".
        source: "resume",
      },
      // No applicationId on this request -> no posting description -> no
      // benchmark to mine (same "nothing selected" degrade as buzzwords).
      idealProject: null,
      // AC-6.3: no eligible project pages on this request (no `pages` was
      // passed to mockUserWithApplicationDocs), so there was no page to cite
      // — [], not an array of nulls, mirroring
      // route.knowledgeBase.test.js's "reports no page sources at all when
      // no page reached the draft".
      pageSources: [],
    });

    const client = getGeminiClient();
    const promptText = client.models.generateContent.mock.calls[0][0].contents[0].parts[0].text;
    expect(promptText).toContain(RESUME_DOC);
    expect(promptText).toContain(COVER_LETTER_DOC);
  });

  it("gemini engine: with no linked application, grounding is false/false and neither submitted-document section reaches the prompt", async () => {
    mockUser();
    mockGemini({ points: ["A generic sample point."], type: "general" });
    const res = await POST(jsonRequest({ question: "Tell me about yourself.", mode: "answer", engine: "gemini" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.grounding).toEqual({ resume: false, coverLetter: false, pages: false });

    const client = getGeminiClient();
    const promptText = client.models.generateContent.mock.calls[0][0].contents[0].parts[0].text;
    expect(promptText).not.toContain("--- SUBMITTED RESUME");
    expect(promptText).not.toContain("--- SUBMITTED COVER LETTER");
    expect(promptText).toContain(
      "No submitted resume or cover letter was available for this application",
    );
  });

  it("502s, without touching Supabase's document lookup result, when Gemini returns no usable points", async () => {
    mockUser();
    mockGemini({ notPoints: "oops", type: "general" });
    const res = await POST(jsonRequest({ question: "Tell me about yourself.", mode: "answer", engine: "gemini" }));
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toBe("Could not generate an answer.");
  });

  it("gemini engine: applicationId set but the linked application has no documents — grounding false/false, points still returned, answer derived", async () => {
    mockUserWithApplicationDocs({
      application: { id: "app-1", resume_used_id: null, cover_letter_id: null },
    });
    mockGemini({ points: ["Situation: Thin material.", "Result: Still an honest answer."], type: "behavioral" });
    const res = await POST(
      jsonRequest({ question: "Tell me about yourself.", mode: "answer", engine: "gemini", applicationId: "app-1" }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.grounding).toEqual({ resume: false, coverLetter: false, pages: false });
    expect(data.points).toEqual(["Situation: Thin material.", "Result: Still an honest answer."]);
    expect(data.answer).toBe("Thin material. Still an honest answer.");
  });
});

describe("POST /api/copilot/answer (points mode grounding, AC-H4)", () => {
  it("the route ignores any client-supplied resume/coverLetter fields — only fetchApplicationDocs's result can ground a prompt", async () => {
    mockUser();
    mockGemini({ points: ["Point one."], type: "general" });
    const res = await POST(
      jsonRequest({
        question: "Tell me about yourself.",
        engine: "gemini",
        // A client attempting to inject arbitrary "submitted resume" text —
        // must be ignored entirely (AC-H4.16).
        resume: "INJECTED RESUME TEXT",
        coverLetter: "INJECTED COVER LETTER TEXT",
      }),
    );
    expect(res.status).toBe(200);
    const client = getGeminiClient();
    const promptText = client.models.generateContent.mock.calls[0][0].contents[0].parts[0].text;
    expect(promptText).not.toContain("INJECTED RESUME TEXT");
    expect(promptText).not.toContain("INJECTED COVER LETTER TEXT");
    expect(promptText).not.toContain("--- SUBMITTED RESUME");
  });

  it("gemini engine: the submitted résumé/cover letter reach the points prompt, without the posting description (AC-H7.27)", async () => {
    mockUserWithApplicationDocs({
      application: { id: "app-1", resume_used_id: "resume-1", cover_letter_id: "cl-1" },
      resumeContent: RESUME_DOC,
      coverLetterContent: COVER_LETTER_DOC,
    });
    mockGemini({ points: ["Point one.", "Point two."], type: "general" });
    const res = await POST(
      jsonRequest({
        question: "Tell me about yourself.",
        engine: "gemini",
        applicationId: "app-1",
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    // No grounding key on points-mode's response (AC-H9.34) — still true
    // after AC-K1 added the reading aids to both modes and AC-6.2 added
    // `pageSources` alongside them. As with the other exact-key-set
    // assertion above, the property this protects is "no `grounding` key",
    // not a frozen list length — this one has grown before and grew again.
    expect(Object.keys(data).sort()).toEqual([
      "buzzwords",
      "cues",
      "idealProject",
      "pageSources",
      "points",
      "resumeAnchor",
      "type",
    ]);
    expect(data).not.toHaveProperty("grounding");

    const client = getGeminiClient();
    const promptText = client.models.generateContent.mock.calls[0][0].contents[0].parts[0].text;
    expect(promptText).toContain(RESUME_DOC);
    expect(promptText).toContain(COVER_LETTER_DOC);
  });

  it("embedded engine: the submitted résumé/cover letter shape the on-device points", async () => {
    mockUserWithApplicationDocs({
      application: { id: "app-1", resume_used_id: "resume-1", cover_letter_id: "cl-1" },
      resumeContent: RESUME_DOC,
      coverLetterContent: COVER_LETTER_DOC,
    });
    const res = await POST(
      jsonRequest({
        question: "Tell me about a time you led a difficult project.",
        engine: "embedded",
        applicationId: "app-1",
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.points.join(" ")).toContain("Quantum Robotics");
  });
});

// AC-K1's "reading aids" cases (cues/buzzwords/resumeAnchor/idealProject)
// moved to route.companyFacts.test.js — this file was over the 1000-line
// cap and that band needed nothing beyond the fixtures already shared with
// the AC-V4 cases also living there. See that file's own header.

// The caller's own "Professional Experience" project pages
// (lib/copilot/projectStories.js) as material for "tell me about a time..."
// questions. Fetched server-side by the signed-in user's id, alongside the
// existing applications/posting lookups — never from the request body.
describe("POST /api/copilot/answer (project pages)", () => {
  const PROJECT_PAGE = {
    id: "page-1",
    title: "Payments migration",
    body: [
      "Led the settlement rewrite end to end.",
      "",
      "- Cut settlement time from three days to one",
      "- Mentored two junior engineers on the rollout",
    ].join("\n"),
    generated_kind: null,
    archived_at: null,
  };

  const GENERATED_PAGE = {
    id: "page-2",
    title: "Research: Payments industry",
    body: "- The payments industry grew 12% last year",
    generated_kind: "research",
    archived_at: null,
  };

  // Byte-identity, AC-style: with no eligible project pages (mockUser()'s
  // fake client has no `.from` at all, so listPages degrades to `pages: []`
  // exactly like a real "user has none" response), buildPointsPrompt and
  // buildAnswerPrompt must add NOTHING — every place either function's
  // output can change is gated on a truthy pages block, and
  // lib/experience/knowledgeBase.test.js already pins
  // buildKnowledgeBaseBlock's `block` as "" when no page is eligible.
  it("the points-mode prompt carries no trace of project pages when there are none", async () => {
    mockUser();
    mockGemini({ points: ["Point one."], type: "general" });
    const res = await POST(jsonRequest({ question: "Tell me about yourself.", engine: "gemini" }));
    expect(res.status).toBe(200);
    const client = getGeminiClient();
    const promptText = client.models.generateContent.mock.calls[0][0].contents[0].parts[0].text;
    expect(promptText).not.toContain("PROJECT PAGES");
  });

  it("the answer-mode prompt carries no trace of project pages when there are none", async () => {
    mockUser();
    mockGemini({ points: ["A generic sample point."], type: "general" });
    const res = await POST(jsonRequest({ question: "Tell me about yourself.", mode: "answer", engine: "gemini" }));
    expect(res.status).toBe(200);
    const client = getGeminiClient();
    const promptText = client.models.generateContent.mock.calls[0][0].contents[0].parts[0].text;
    expect(promptText).not.toContain("PROJECT PAGES");
    expect(promptText).toContain("CANDIDATE PREP NOTES, SUBMITTED RESUME, or SUBMITTED COVER LETTER");
  });

  it("a generated page never reaches either prompt, even though its row exists", async () => {
    mockUserWithApplicationDocs({ pages: [GENERATED_PAGE] });
    mockGemini({ points: ["Point one."], type: "general" });
    const res = await POST(jsonRequest({ question: "Tell me about yourself.", engine: "gemini" }));
    expect(res.status).toBe(200);
    const client = getGeminiClient();
    const promptText = client.models.generateContent.mock.calls[0][0].contents[0].parts[0].text;
    expect(promptText).not.toContain("Research: Payments industry");
    expect(promptText).not.toContain("payments industry grew 12%");
  });

  it("an eligible project page reaches the points-mode prompt, labelled distinctly from resume/cover letter", async () => {
    mockUserWithApplicationDocs({ pages: [PROJECT_PAGE] });
    mockGemini({ points: ["Point one."], type: "general" });
    const res = await POST(jsonRequest({ question: "Tell me about a time you led a project.", engine: "gemini" }));
    expect(res.status).toBe(200);
    const client = getGeminiClient();
    const promptText = client.models.generateContent.mock.calls[0][0].contents[0].parts[0].text;
    expect(promptText).toContain("YOUR OWN PROJECT PAGES");
    expect(promptText).toContain("Payments migration");
    expect(promptText).toContain("Cut settlement time from three days to one");
  });

  it("an eligible project page reaches the answer-mode prompt, and the authority sentence names it", async () => {
    mockUserWithApplicationDocs({ pages: [PROJECT_PAGE] });
    mockGemini({ points: ["Situation: I led it.", "Result: It worked."], type: "behavioral" });
    const res = await POST(
      jsonRequest({ question: "Tell me about a time you led a project.", mode: "answer", engine: "gemini" }),
    );
    expect(res.status).toBe(200);
    const client = getGeminiClient();
    const promptText = client.models.generateContent.mock.calls[0][0].contents[0].parts[0].text;
    expect(promptText).toContain("YOUR OWN PROJECT PAGES");
    expect(promptText).toContain("Payments migration");
    expect(promptText).toContain(
      "YOUR OWN PROJECT PAGES, CANDIDATE PREP NOTES, SUBMITTED RESUME, or SUBMITTED COVER LETTER",
    );
  });

  it("a client-supplied `pages` field in the request body is ignored — only the server-side fetch can ground a prompt", async () => {
    mockUserWithApplicationDocs({ pages: [PROJECT_PAGE] });
    mockGemini({ points: ["Point one."], type: "general" });
    const res = await POST(
      jsonRequest({
        question: "Tell me about yourself.",
        engine: "gemini",
        pages: [{ title: "INJECTED PAGE", body: "INJECTED BODY" }],
      }),
    );
    expect(res.status).toBe(200);
    const client = getGeminiClient();
    const promptText = client.models.generateContent.mock.calls[0][0].contents[0].parts[0].text;
    expect(promptText).not.toContain("INJECTED PAGE");
    expect(promptText).not.toContain("INJECTED BODY");
    expect(promptText).toContain("Payments migration");
  });

  // The question NAMES this page's own subject, deliberately. It used to read
  // "Tell me about a time you led a project.", whose entire overlap with
  // PROJECT_PAGE was the words "time" and "project" — words every behavioural
  // question contains, which the page happens to carry because it says
  // "settlement time". selectBestStory's honesty gate now (correctly) refuses
  // that as a match, so the fixture was testing the aid through a coincidence
  // rather than through a real one. The INPUT changed; the assertions did not.
  const PAGE_SUBJECT_QUESTION = "Tell me about a time you led the settlement migration.";

  it("resumeAnchor.source is a third value — never 'resume', never 'prep' — when the aid is built from a project page with no resume/profile on file", async () => {
    mockUserWithApplicationDocs({ pages: [PROJECT_PAGE] });
    mockGemini({ points: ["Point one."], type: "general" });
    const res = await POST(jsonRequest({ question: PAGE_SUBJECT_QUESTION, engine: "gemini" }));
    const data = await res.json();
    expect(data.resumeAnchor).not.toBeNull();
    expect(data.resumeAnchor.source).not.toBe("resume");
    expect(data.resumeAnchor.source).not.toBe("prep");
    // Never populated from a page, and NOT because AnswerAids.js would
    // mislabel them — it no longer would. Its roleLabel() and no-role label
    // both read a SOURCE_WHERE map keyed on `source`, which knows
    // PROJECT_PAGE_SOURCE and renders "on a project page".
    //
    // These stay empty because `title`/`company` model a job ROLE — the label
    // around them literally reads "Closest role" / "Most recent role" — and a
    // project page's title is a PROJECT name with no employer behind it.
    // Filling them would present a project as a role: a different category
    // error, not a leftover workaround. `description` has no second value to
    // put there either; the route computes exactly one shortened line and it
    // goes to `project`. See route.js's answerAids comment for the full
    // reasoning.
    expect(data.resumeAnchor.title).toBe("");
    expect(data.resumeAnchor.company).toBe("");
    expect(data.resumeAnchor.description).toEqual([]);
    expect(data.resumeAnchor.project).toBeTruthy();
  });

  it("resumeAnchor stays resume-sourced when a résumé is on file, even though eligible project pages also exist", async () => {
    mockUserWithApplicationDocs({
      application: { id: "app-1", resume_used_id: "resume-1", cover_letter_id: null },
      resumeContent: RESUME_DOC,
      pages: [PROJECT_PAGE],
    });
    mockGemini({ points: ["Point one."], type: "general" });
    const res = await POST(
      jsonRequest({ question: "Tell me about a time you led a project.", engine: "gemini", applicationId: "app-1" }),
    );
    const data = await res.json();
    expect(data.resumeAnchor.source).toBe("resume");
    expect(data.resumeAnchor.company).toBe("Quantum Robotics");
  });

  it("embedded engine, answer mode: a behavioral question with an eligible project page and no resume/profile speaks the page's own title and bullets as a STAR story", async () => {
    mockUserWithApplicationDocs({ pages: [PROJECT_PAGE] });
    const res = await POST(jsonRequest({ question: PAGE_SUBJECT_QUESTION, mode: "answer", engine: "embedded" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.points[0]).toBe("Situation: Payments migration.");
    expect(data.points).toContain("Action: Cut settlement time from three days to one.");
    expect(data.points).toContain("Result: Mentored two junior engineers on the rollout.");
    expect(data.answer).toContain("Payments migration");
    expect(data.answer).toContain("Cut settlement time from three days to one");
  });

  // `grounding.pages` is what practice mode's SampleAnswer caption is written
  // from, so it has to be true of the branch that actually answered.
  //
  // Every other grounding assertion in this file has zero eligible pages and
  // therefore pins `pages: false` — eight of them — so nothing covered the
  // true branch at all, and nothing could have caught the defect below.
  //
  // THE DEFECT: `pages` was `kb.includedPages.length > 0` for BOTH engines,
  // and the embedded branch never reads `kb`. It answers from `story`, and
  // only when `story.matched` is true. So an embedded draft that used nothing
  // from any page still claimed the pages as a source, purely because an
  // eligible page existed.
  it("grounding.pages is derived from the branch that actually answered, on both engines", async () => {
    // Gemini: derived from what went into the prompt.
    mockUserWithApplicationDocs({ pages: [PROJECT_PAGE] });
    mockGemini({ points: ["Situation: I led it."], type: "behavioral" });
    const gemini = await POST(
      jsonRequest({ question: PAGE_SUBJECT_QUESTION, mode: "answer", engine: "gemini" }),
    );
    expect((await gemini.json()).grounding).toEqual({ resume: false, coverLetter: false, pages: true });

    // Embedded, matched: the story cleared the honesty gate and its own words
    // are in the answer, so the claim is true.
    mockUserWithApplicationDocs({ pages: [PROJECT_PAGE] });
    const matched = await POST(
      jsonRequest({ question: PAGE_SUBJECT_QUESTION, mode: "answer", engine: "embedded" }),
    );
    const matchedData = await matched.json();
    expect(matchedData.points).toContain("Action: Cut settlement time from three days to one.");
    expect(matchedData.grounding).toEqual({ resume: false, coverLetter: false, pages: true });

    // Embedded, UNMATCHED: the same eligible page is on file, the question is
    // about something else entirely, nothing from the page reaches the
    // answer — so the caption must not claim it did. Under the old
    // derivation this returned `pages: true`.
    mockUserWithApplicationDocs({ pages: [PROJECT_PAGE] });
    const unmatched = await POST(
      jsonRequest({
        question: "Tell me about a time you disagreed with your manager.",
        mode: "answer",
        engine: "embedded",
      }),
    );
    const unmatchedData = await unmatched.json();
    expect(unmatchedData.points.join(" ")).not.toContain("Payments migration");
    expect(unmatchedData.grounding).toEqual({ resume: false, coverLetter: false, pages: false });
  });

  it("embedded engine, answer mode: a non-behavioral question ignores project pages and drafts exactly as before", async () => {
    mockUserWithApplicationDocs({ pages: [PROJECT_PAGE] });
    const question = "How would you design a rate limiter?";
    const res = await POST(jsonRequest({ question, mode: "answer", engine: "embedded" }));
    const data = await res.json();
    const expected = draftSampleAnswerLocal({
      question,
      profile: "",
      resume: "",
      coverLetter: "",
      interviewType: normalizeInterviewType(undefined),
    });
    expect(data.type).not.toBe("behavioral");
    expect(data.points).toEqual(expected.points);
    expect(data.answer).toBe(expected.answer);
  });

  it("embedded engine, answer mode: a project page with a title but no bullet lines never displaces the existing draft", async () => {
    const noBullets = { id: "p3", title: "No bullets here", body: "Just prose, no list at all.", generated_kind: null, archived_at: null };
    mockUserWithApplicationDocs({ pages: [noBullets] });
    const question = "Tell me about a time you led a project.";
    const res = await POST(jsonRequest({ question, mode: "answer", engine: "embedded" }));
    const data = await res.json();
    const expected = draftSampleAnswerLocal({
      question,
      profile: "",
      resume: "",
      coverLetter: "",
      interviewType: normalizeInterviewType(undefined),
    });
    expect(data.points).toEqual(expected.points);
    expect(data.answer).toBe(expected.answer);
  });
});

// lib/copilot/answerLocal.js's profileMetric fix: a team-size mention
// ("led a team of 6 engineers") is a statement of SCOPE, not an achieved
// OUTCOME, and must never be spoken as a "Result:" metric. Exercised here
// (not in a dedicated answerLocal.test.js case, which is out of scope for
// this change) through the public route, over the plain prep-profile path —
// independent of project pages, which never reach profileMetric at all.
describe("POST /api/copilot/answer (profileMetric team-size fix)", () => {
  it("a team-size mention in the prep profile is never presented as a Result metric", async () => {
    mockUser();
    const profile = [
      "Senior Engineer, Acme Corp",
      "Jan 2020 - Present",
      "Led a team of 6 engineers to rebuild the checkout system.",
    ].join("\n");
    const res = await POST(
      jsonRequest({ question: "Tell me about a time you led a team.", profile, engine: "embedded" }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    const resultPoint = data.points.find((p) => p.startsWith("Result:"));
    expect(resultPoint).toBeTruthy();
    expect(resultPoint).not.toMatch(/6 engineers/i);
  });
});

// AC-V4's "verified company facts" cases (companyFacts, factIds,
// factSources, companyDirected, fetchUrlContent, positions.company) moved
// to route.companyFacts.test.js — this file was over the 1000-line cap and
// AC-V4 was the newest, most self-contained band, with its own dedicated
// fetchUrlContent mock. See that file's own header for what else moved
// alongside it and why.
