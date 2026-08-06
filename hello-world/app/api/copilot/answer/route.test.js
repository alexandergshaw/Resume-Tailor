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
function mockUserWithApplicationDocs({
  id = "user-1",
  application = null,
  resumeContent = null,
  coverLetterContent = null,
} = {}) {
  const from = vi.fn((table) => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
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
  it("treats an unrecognized mode value the same as no mode at all — still {points,type}, never {answer,grounding}", async () => {
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
    expect(Object.keys(data).sort()).toEqual(["points", "type"]);
    expect(Array.isArray(data.points)).toBe(true);
    expect(data.points.length).toBeGreaterThan(0);
  });

  it("gemini points mode still returns exactly {points,type} — no grounding key added", async () => {
    mockUser();
    mockGemini({ points: ["Point one", "Point two", "Point three"], type: "technical" });
    const res = await POST(jsonRequest({ question: "How would you design a rate limiter?", engine: "gemini" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ points: ["Point one", "Point two", "Point three"], type: "technical" });
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
    expect(data.answer).toBe(expected.answer);
    expect(data.type).toBe(expected.type);
    expect(data.grounding).toEqual({ resume: false, coverLetter: false });
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
    expect(data.grounding).toEqual({ resume: false, coverLetter: false });
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
    expect(data.answer).toBe(expected.answer);
    expect(data.grounding).toEqual({ resume: true, coverLetter: true });
    // Not just "grounding is true" — the résumé's own material is what
    // shaped the spoken answer.
    expect(data.answer).toContain("Quantum Robotics");
  });

  it("gemini engine: the submitted resume and cover letter actually reach the prompt, and grounding reports both found", async () => {
    mockUserWithApplicationDocs({
      application: { id: "app-1", resume_used_id: "resume-1", cover_letter_id: "cl-1" },
      resumeContent: RESUME_DOC,
      coverLetterContent: COVER_LETTER_DOC,
    });
    mockGemini({ answer: "A spoken sample answer.", type: "behavioral" });
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
      answer: "A spoken sample answer.",
      type: "behavioral",
      grounding: { resume: true, coverLetter: true },
    });

    const client = getGeminiClient();
    const promptText = client.models.generateContent.mock.calls[0][0].contents[0].parts[0].text;
    expect(promptText).toContain(RESUME_DOC);
    expect(promptText).toContain(COVER_LETTER_DOC);
  });

  it("gemini engine: with no linked application, grounding is false/false and neither submitted-document section reaches the prompt", async () => {
    mockUser();
    mockGemini({ answer: "A generic sample answer.", type: "general" });
    const res = await POST(jsonRequest({ question: "Tell me about yourself.", mode: "answer", engine: "gemini" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.grounding).toEqual({ resume: false, coverLetter: false });

    const client = getGeminiClient();
    const promptText = client.models.generateContent.mock.calls[0][0].contents[0].parts[0].text;
    expect(promptText).not.toContain("--- SUBMITTED RESUME");
    expect(promptText).not.toContain("--- SUBMITTED COVER LETTER");
    expect(promptText).toContain(
      "No submitted resume or cover letter was available for this application",
    );
  });

  it("502s, without touching Supabase's document lookup result, when Gemini returns no usable answer text", async () => {
    mockUser();
    mockGemini({ notAnswer: "oops", type: "general" });
    const res = await POST(jsonRequest({ question: "Tell me about yourself.", mode: "answer", engine: "gemini" }));
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toBe("Could not generate an answer.");
  });
});
