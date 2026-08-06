import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { POST } from "./route.js";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { createClient } from "@/lib/supabase/server";
import { nextPracticeQuestion } from "@/lib/copilot/practiceQuestions";
import { interviewType as getInterviewTypeDescriptor } from "@/lib/copilot/interviewTypes";

function jsonRequest(body) {
  return { json: async () => body };
}

function mockUser(id = "user-1") {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: id ? { id } : null } }) },
  });
}

// Mocks the Gemini path to return exactly the given { question, type }, the
// same shape the route asks the model for via buildPrompt's JSON contract.
function mockGemini(payload) {
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  getGeminiClient.mockReturnValue({
    models: {
      generateContent: vi.fn().mockResolvedValue({ text: JSON.stringify(payload) }),
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/copilot/question", () => {
  it("401s when not signed in, with the interview-copilot sign-in message", async () => {
    mockUser(null);
    const res = await POST(jsonRequest({ posting: null, asked: [], engine: "embedded" }));
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Sign in to use the interview copilot.");
  });
});

describe("POST /api/copilot/question (embedded engine)", () => {
  it("returns a bank question with source 'embedded' and never touches Gemini", async () => {
    mockUser();
    const posting = { title: "Software Engineer", company: "Acme", description: "" };
    const res = await POST(jsonRequest({ posting, asked: [], engine: "embedded" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    const expected = nextPracticeQuestion({ posting, asked: [] });
    expect(data.question).toBe(expected.question);
    expect(data.type).toBe(expected.type);
    expect(data.source).toBe("embedded");
    expect(data.exhausted).toBe(false);
    expect(getGeminiClient).not.toHaveBeenCalled();
    expect(getServerEnv).not.toHaveBeenCalled();
  });

  it("reports exhausted once every bank question for the posting has been asked", async () => {
    mockUser();
    const posting = { title: "Engineer", company: "Acme", description: "" };
    // Drain the bank for real via the same helper the route uses, so this
    // test doesn't hardcode the bank's size or wording.
    const asked = [];
    let next = nextPracticeQuestion({ posting, asked });
    while (!next.exhausted) {
      asked.push(next.question);
      next = nextPracticeQuestion({ posting, asked });
    }

    const res = await POST(jsonRequest({ posting, asked, engine: "embedded" }));
    const data = await res.json();
    expect(data.exhausted).toBe(true);
    expect(data.question).toBe("");
    expect(data.source).toBe("embedded");
  });
});

describe("POST /api/copilot/question (gemini engine)", () => {
  it("returns the model's question and type with source 'gemini'", async () => {
    mockUser();
    mockGemini({ question: "What is your greatest strength?", type: "technical" });
    const res = await POST(jsonRequest({ posting: null, asked: [], engine: "gemini" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.question).toBe("What is your greatest strength?");
    expect(data.type).toBe("technical");
    expect(data.source).toBe("gemini");
    expect(data.exhausted).toBe(false);
  });

  it("falls back to type 'general' when the model's type isn't one of the three valid values", async () => {
    mockUser();
    mockGemini({ question: "What is your greatest strength?", type: "philosophical" });
    const res = await POST(jsonRequest({ posting: null, asked: [], engine: "gemini" }));
    const data = await res.json();
    expect(data.type).toBe("general");
    expect(data.source).toBe("gemini");
  });

  it("falls back to type 'general' when the model omits type entirely", async () => {
    mockUser();
    mockGemini({ question: "What is your greatest strength?" });
    const res = await POST(jsonRequest({ posting: null, asked: [], engine: "gemini" }));
    const data = await res.json();
    expect(data.type).toBe("general");
    expect(data.source).toBe("gemini");
  });

  it("falls back to type 'general' when the model's type isn't a string at all", async () => {
    mockUser();
    mockGemini({ question: "What is your greatest strength?", type: 42 });
    const res = await POST(jsonRequest({ posting: null, asked: [], engine: "gemini" }));
    const data = await res.json();
    expect(data.type).toBe("general");
  });
});

describe("POST /api/copilot/question (Gemini failure falls back to the deterministic bank)", () => {
  it("falls back when Gemini throws, and never returns a 5xx", async () => {
    mockUser();
    getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
    getGeminiClient.mockReturnValue({
      models: { generateContent: vi.fn().mockRejectedValue(new Error("network down")) },
    });
    const posting = { title: "Engineer", company: "Acme", description: "" };
    const res = await POST(jsonRequest({ posting, asked: [], engine: "gemini" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.source).toBe("fallback");
    const expected = nextPracticeQuestion({ posting, asked: [] });
    expect(data.question).toBe(expected.question);
  });

  it("falls back when the model's response can't be parsed as JSON", async () => {
    mockUser();
    getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
    getGeminiClient.mockReturnValue({
      models: { generateContent: vi.fn().mockResolvedValue({ text: "sorry, here is your question" }) },
    });
    const res = await POST(jsonRequest({ posting: null, asked: [], engine: "gemini" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.source).toBe("fallback");
  });

  it("falls back when the model returns an empty question", async () => {
    mockUser();
    mockGemini({ question: "   ", type: "general" });
    const res = await POST(jsonRequest({ posting: null, asked: [], engine: "gemini" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.source).toBe("fallback");
  });

  it("falls back when the model repeats a question already asked this session", async () => {
    mockUser();
    const posting = { title: "Engineer", company: "Acme", description: "" };
    const asked = ["  What is your favorite programming language?  "];
    // Same question modulo whitespace/case — normalizeQuestion should still
    // catch this as a repeat.
    mockGemini({ question: "what is your favorite programming language?", type: "technical" });
    const res = await POST(jsonRequest({ posting, asked, engine: "gemini" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.source).toBe("fallback");
    expect(data.question).not.toBe("what is your favorite programming language?");
    const expected = nextPracticeQuestion({ posting, asked });
    expect(data.question).toBe(expected.question);
  });
});

describe("POST /api/copilot/question (input sanitation)", () => {
  it("treats a non-array asked value as no history, without throwing", async () => {
    mockUser();
    const posting = { title: "Engineer", company: "Acme", description: "" };
    const res = await POST(jsonRequest({ posting, asked: "not-an-array", engine: "embedded" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    const expected = nextPracticeQuestion({ posting, asked: [] });
    expect(data.question).toBe(expected.question);
    expect(data.exhausted).toBe(false);
  });

  it("stringifies a numeric title instead of throwing", async () => {
    mockUser();
    const posting = { title: 12345, company: "Acme", description: "" };
    const res = await POST(jsonRequest({ posting, asked: [], engine: "embedded" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.question).toContain("12345");
  });

  it("handles a posting with a missing title", async () => {
    mockUser();
    const posting = { company: "Acme", description: "We build things." };
    const res = await POST(jsonRequest({ posting, asked: [], engine: "embedded" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    const expected = nextPracticeQuestion({ posting: { title: "", company: "Acme", description: "We build things." }, asked: [] });
    expect(data.question).toBe(expected.question);
    expect(data.question).not.toContain("undefined");
  });

  it("handles a null posting the same as no posting at all", async () => {
    mockUser();
    const res = await POST(jsonRequest({ posting: null, asked: [], engine: "embedded" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    const expected = nextPracticeQuestion({ posting: null, asked: [] });
    expect(data.question).toBe(expected.question);
  });

  it("truncates an over-long title instead of embedding it in full", async () => {
    mockUser();
    const longTitle = "Q".repeat(400) + "TRUNCATION-MARKER";
    const posting = { title: longTitle, company: "", description: "" };
    const res = await POST(jsonRequest({ posting, asked: [], engine: "embedded" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.question).not.toContain("TRUNCATION-MARKER");
  });

  it("truncates an over-long description to the same 6000-char cap the bank uses, without throwing", async () => {
    mockUser();
    const longDescription = "We use JavaScript and React heavily. ".repeat(400); // well over 6000 chars
    expect(longDescription.length).toBeGreaterThan(6000);
    const posting = { title: "Engineer", company: "Acme", description: longDescription };
    const res = await POST(jsonRequest({ posting, asked: [], engine: "embedded" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    const truncated = {
      title: "Engineer",
      company: "Acme",
      description: longDescription.trim().slice(0, 6000),
    };
    const expected = nextPracticeQuestion({ posting: truncated, asked: [] });
    expect(data.question).toBe(expected.question);
    expect(data.type).toBe(expected.type);
  });
});

describe("POST /api/copilot/question (asked cap keeps the most recent entries)", () => {
  it("drops the oldest asked entries once the cap is exceeded, not the newest ones", async () => {
    mockUser();
    const posting = { title: "Engineer", company: "Acme", description: "" };
    const opening = nextPracticeQuestion({ posting, asked: [] }).question;
    const fillers = Array.from({ length: 40 }, (_, i) => `filler question number ${i}`);

    // The opening question is the OLDEST of 41 entries — past the 40-entry
    // cap, so it should be dropped and therefore handed back again.
    const askedOldFirst = [opening, ...fillers];
    const resOld = await POST(jsonRequest({ posting, asked: askedOldFirst, engine: "embedded" }));
    const dataOld = await resOld.json();
    expect(dataOld.question).toBe(opening);

    // Same 41-entry size, but the opening question is now the MOST RECENT
    // entry — it must survive the cap and therefore be skipped.
    const askedNewLast = [...fillers, opening];
    const resNew = await POST(jsonRequest({ posting, asked: askedNewLast, engine: "embedded" }));
    const dataNew = await resNew.json();
    expect(dataNew.question).not.toBe(opening);
  });
});

describe("POST /api/copilot/question (response shape)", () => {
  it("returns the same four keys — question, type, source, exhausted — on every path", async () => {
    mockUser();
    const posting = { title: "Engineer", company: "Acme", description: "" };

    const embeddedRes = await POST(jsonRequest({ posting, asked: [], engine: "embedded" }));
    const embeddedData = await embeddedRes.json();
    expect(Object.keys(embeddedData).sort()).toEqual(["exhausted", "question", "source", "type"]);

    mockGemini({ question: "What excites you about this role?", type: "general" });
    const geminiRes = await POST(jsonRequest({ posting, asked: [], engine: "gemini" }));
    const geminiData = await geminiRes.json();
    expect(Object.keys(geminiData).sort()).toEqual(["exhausted", "question", "source", "type"]);

    getGeminiClient.mockReturnValue({
      models: { generateContent: vi.fn().mockRejectedValue(new Error("boom")) },
    });
    const fallbackRes = await POST(jsonRequest({ posting, asked: [], engine: "gemini" }));
    const fallbackData = await fallbackRes.json();
    expect(Object.keys(fallbackData).sort()).toEqual(["exhausted", "question", "source", "type"]);
  });
});

describe("POST /api/copilot/question (interviewType, embedded engine)", () => {
  it("draws the next question from the requested format's own groups, not the general default", async () => {
    mockUser();
    const posting = { title: "Engineer", company: "Acme", description: "" };
    // The opening question is format-agnostic, so ask it first for both
    // formats to reach the part of the bank that actually differs.
    const opening = nextPracticeQuestion({ posting, asked: [] }).question;
    const askedOpening = [opening];

    const technicalRes = await POST(
      jsonRequest({ posting, asked: askedOpening, engine: "embedded", interviewType: "technical" }),
    );
    const technicalData = await technicalRes.json();
    expect(technicalData.type).toBe("technical");

    const behavioralRes = await POST(
      jsonRequest({ posting, asked: askedOpening, engine: "embedded", interviewType: "behavioral" }),
    );
    const behavioralData = await behavioralRes.json();
    expect(behavioralData.type).toBe("behavioral");

    // Different formats, same posting and asked-history, must diverge.
    expect(technicalData.question).not.toBe(behavioralData.question);

    // And each must match the deterministic bank computed for that exact
    // interview type, not just differ from each other.
    const expectedTechnical = nextPracticeQuestion({
      posting,
      asked: askedOpening,
      interviewType: "technical",
    });
    expect(technicalData.question).toBe(expectedTechnical.question);
    const expectedBehavioral = nextPracticeQuestion({
      posting,
      asked: askedOpening,
      interviewType: "behavioral",
    });
    expect(behavioralData.question).toBe(expectedBehavioral.question);
  });

  it("treats an unrecognized interviewType the same as omitting it (both resolve to general)", async () => {
    mockUser();
    const posting = { title: "Engineer", company: "Acme", description: "" };
    const withUnknownType = await POST(
      jsonRequest({ posting, asked: [], engine: "embedded", interviewType: "not-a-real-format" }),
    );
    const withUnknownTypeData = await withUnknownType.json();
    const withNoType = await POST(jsonRequest({ posting, asked: [], engine: "embedded" }));
    const withNoTypeData = await withNoType.json();
    expect(withUnknownTypeData.question).toBe(withNoTypeData.question);
    expect(withUnknownTypeData.type).toBe(withNoTypeData.type);

    const expected = nextPracticeQuestion({ posting, asked: [], interviewType: "general" });
    expect(withUnknownTypeData.question).toBe(expected.question);
  });
});

describe("POST /api/copilot/question (interviewType, gemini engine)", () => {
  it("includes the requested format's label and guidance in the Gemini prompt", async () => {
    mockUser();
    const generateContent = vi
      .fn()
      .mockResolvedValue({ text: JSON.stringify({ question: "A technical question?", type: "technical" }) });
    getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
    getGeminiClient.mockReturnValue({ models: { generateContent } });

    const res = await POST(
      jsonRequest({ posting: null, asked: [], engine: "gemini", interviewType: "technical" }),
    );
    expect(res.status).toBe(200);

    const promptText = generateContent.mock.calls[0][0].contents[0].parts[0].text;
    const descriptor = getInterviewTypeDescriptor("technical");
    expect(promptText).toContain(`Interview format: ${descriptor.label}`);
    expect(promptText).toContain(descriptor.guidance);
  });

  it("falls back to the general format's label and guidance when interviewType is unrecognized", async () => {
    mockUser();
    const generateContent = vi
      .fn()
      .mockResolvedValue({ text: JSON.stringify({ question: "Some question?", type: "general" }) });
    getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
    getGeminiClient.mockReturnValue({ models: { generateContent } });

    await POST(jsonRequest({ posting: null, asked: [], engine: "gemini", interviewType: "made-up-format" }));

    const promptText = generateContent.mock.calls[0][0].contents[0].parts[0].text;
    const general = getInterviewTypeDescriptor("general");
    const technical = getInterviewTypeDescriptor("technical");
    expect(promptText).toContain(`Interview format: ${general.label}`);
    expect(promptText).not.toContain(`Interview format: ${technical.label}`);
  });

  it("still falls back to the deterministic bank for the requested format when Gemini fails", async () => {
    mockUser();
    getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
    getGeminiClient.mockReturnValue({
      models: { generateContent: vi.fn().mockRejectedValue(new Error("network down")) },
    });
    const posting = { title: "Engineer", company: "Acme", description: "" };
    // Skip past the format-agnostic opening question so the fallback lands
    // on a question drawn from the "technical" format's own group.
    const opening = nextPracticeQuestion({ posting, asked: [] }).question;
    const askedOpening = [opening];

    const res = await POST(
      jsonRequest({ posting, asked: askedOpening, engine: "gemini", interviewType: "technical" }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.source).toBe("fallback");
    const expected = nextPracticeQuestion({
      posting,
      asked: askedOpening,
      interviewType: "technical",
    });
    expect(data.question).toBe(expected.question);
    expect(data.type).toBe("technical");
  });
});
