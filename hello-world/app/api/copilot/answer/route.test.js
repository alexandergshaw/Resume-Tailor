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
    // AC-K1: points mode gained the reading aids, and nothing else —
    // `answer` and `grounding` are still answer mode's alone, which is what
    // this case has always been about.
    expect(Object.keys(data).sort()).toEqual([
      "buzzwords",
      "cues",
      "idealProject",
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
    expect(data.points).toEqual(expected.points);
    expect(data.answer).toBe(expected.answer);
    expect(data.grounding).toEqual({ resume: true, coverLetter: true });
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
      grounding: { resume: true, coverLetter: true },
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
    expect(data.grounding).toEqual({ resume: false, coverLetter: false });

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
    expect(data.grounding).toEqual({ resume: false, coverLetter: false });
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
    // after AC-K1 added the reading aids to both modes.
    expect(Object.keys(data).sort()).toEqual([
      "buzzwords",
      "cues",
      "idealProject",
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

// AC-K1: the three reading aids that sit beside a drafted answer. The load-
// bearing case in here is the LAST one: the posting description became an
// input to this route for the first time, and it must reach the buzzword
// list and nothing else.
describe("POST /api/copilot/answer (reading aids, AC-K1)", () => {
  const POSTING_DESC = [
    "Senior Platform Engineer",
    "Requirements:",
    "- Deep experience with Kubernetes and Terraform",
    "- 5+ years of Python",
  ].join("\n");

  // The same fake row shape mockUserWithApplicationDocs already resolves for
  // the `applications` table, plus the joined position fetchPostingDescription
  // reads. One row serves both lookups, exactly as the real query does.
  const APPLICATION_WITH_POSTING = {
    id: "app-1",
    resume_used_id: "resume-1",
    cover_letter_id: "cl-1",
    positions: { description: POSTING_DESC },
  };

  it("uses the model's own cues when it returns one per point", async () => {
    mockUser();
    mockGemini({
      points: ["Situation: I led the checkout redesign.", "Result: We cut cart abandonment by 18%."],
      cues: ["Situation: Checkout redesign", "Result: Cart abandonment down 18%"],
      type: "behavioral",
    });
    const res = await POST(
      jsonRequest({ question: "Tell me about a project you led.", mode: "answer", engine: "gemini" }),
    );
    const data = await res.json();
    expect(data.cues).toEqual(["Situation: Checkout redesign", "Result: Cart abandonment down 18%"]);
    // The full sentences are untouched — the cues are an ADDITION, not a
    // replacement, which is what keeps the derived `answer` speakable.
    expect(data.points).toEqual([
      "Situation: I led the checkout redesign.",
      "Result: We cut cart abandonment by 18%.",
    ]);
  });

  it("falls back to derived cues when the model returns a mismatched number of them", async () => {
    mockUser();
    mockGemini({
      points: ["Situation: I led the checkout redesign.", "Result: We cut cart abandonment by 18%."],
      cues: ["Only one cue"],
      type: "behavioral",
    });
    const res = await POST(
      jsonRequest({ question: "Tell me about a project you led.", mode: "answer", engine: "gemini" }),
    );
    const data = await res.json();
    expect(data.cues).toEqual(["Situation: Led the checkout redesign", "Result: Cut cart abandonment by 18%"]);
  });

  it("names the role and project out of the SUBMITTED résumé, not the prep profile", async () => {
    mockUserWithApplicationDocs({
      application: APPLICATION_WITH_POSTING,
      resumeContent: RESUME_DOC,
      coverLetterContent: COVER_LETTER_DOC,
    });
    const res = await POST(
      jsonRequest({
        question: "Tell me about the checkout work you led.",
        profile: PROFILE,
        mode: "answer",
        engine: "embedded",
        applicationId: "app-1",
      }),
    );
    const data = await res.json();
    // PROFILE names Acme Corp; RESUME_DOC names Quantum Robotics. The résumé
    // wins because it is what the candidate actually submitted here.
    expect(data.resumeAnchor.company).toBe("Quantum Robotics");
    expect(data.resumeAnchor.project).toContain("checkout redesign");
  });

  // AC-K1.2 correction: postingBuzzwords used to return the SAME terms for
  // every question against a given posting — the only per-question signal
  // was an almost-never-firing substring test, so three unrelated questions
  // came back with one byte-identical six-term list. It now requires the
  // term to actually be relevant to the question/draft (taxonomy-canonical
  // intersection, or full word overlap), so the question below has to
  // genuinely be about the posting's own vocabulary — a real candidate could
  // easily be asked this against a posting requiring Kubernetes/Terraform —
  // rather than a generic question the old, unfiltered list would have
  // padded out regardless of topic.
  it("mines buzzwords from the selected posting WITHOUT the description reaching either prompt", async () => {
    mockUserWithApplicationDocs({
      application: APPLICATION_WITH_POSTING,
      resumeContent: RESUME_DOC,
    });
    mockGemini({ points: ["Point one.", "Point two."], type: "general" });
    const res = await POST(
      jsonRequest({
        question: "How would you use Kubernetes and Terraform to manage this team's infrastructure?",
        mode: "answer",
        engine: "gemini",
        applicationId: "app-1",
      }),
    );
    const data = await res.json();
    expect(data.buzzwords).toContain("Kubernetes");
    expect(data.buzzwords).toContain("Terraform");

    // idealProject present in answer mode too, mined from the SAME posting
    // description. `shape` is still grounded — every term literally occurs
    // in the posting. `metrics` is NOT: mining the posting's own numbers into
    // metrics is exactly the bug this module now permanently forbids (see
    // idealProject.js's header comment on the reported "Metrics to have
    // ready: $78,496, $105,974..." failure — the posting's SALARY BAND,
    // rendered back as if it were a project metric). What used to be
    // `metrics).toContain("5+ years")` pinned the old, now-impossible
    // behaviour; the contract worth pinning now is that NO metric ever
    // carries a digit, and none of the posting's own stated figures
    // (including its "5+ years" experience floor) ever resurface as one.
    expect(data.idealProject).not.toBeNull();
    for (const metric of data.idealProject.metrics) {
      expect(metric).not.toMatch(/\d/);
    }
    expect(data.idealProject.metrics.join(" | ")).not.toContain("5+ years");
    for (const term of data.idealProject.shape.split(", ")) {
      expect(POSTING_DESC.toLowerCase()).toContain(term.toLowerCase());
    }
    // `summary` is the new advisory sentence alongside shape/metrics — always
    // third person, never first, so a candidate under interview pressure
    // reading it next to a real quote from their own résumé cannot mistake
    // it for something to claim (R-087, idealProject.js header comment).
    expect(data.idealProject.summary).toMatch(/^They want a project built around/);
    for (const term of data.idealProject.shape.split(", ")) {
      expect(data.idealProject.summary).toContain(term);
    }

    // AC-H7.27 is unchanged: the description grounds NOTHING. It is fetched
    // through its own call and handed only to the buzzword/idealProject
    // miners, so no wording from it can leak into the answer the model
    // writes.
    const client = getGeminiClient();
    const promptText = client.models.generateContent.mock.calls[0][0].contents[0].parts[0].text;
    expect(promptText).not.toContain("Senior Platform Engineer");
    expect(promptText).not.toContain("Deep experience with Kubernetes");
  });

  // AC-K1.2 headline case: the user-reported bug itself. A posting WITH a
  // description, but a question that shares none of the posting's
  // vocabulary, must come back with buzzwords: [] — not the old fixed list
  // padded out regardless of relevance. The other aids are independent of
  // buzzwords being empty: idealProject only RANKS on question relevance (it
  // never filters shapeTerms out for being off-topic — see idealProject.js),
  // and resumeAnchor reads the candidate's own résumé, not the posting, so
  // neither degrades just because this question has nothing to do with
  // Kubernetes/Terraform/Python.
  it("returns buzzwords: [] for a posting with a description when the question shares none of its vocabulary", async () => {
    mockUserWithApplicationDocs({
      application: APPLICATION_WITH_POSTING,
      resumeContent: RESUME_DOC,
    });
    mockGemini({ points: ["Point one.", "Point two."], type: "general" });
    const res = await POST(
      jsonRequest({
        question: "How do you handle conflict with a difficult coworker?",
        mode: "answer",
        engine: "gemini",
        applicationId: "app-1",
      }),
    );
    const data = await res.json();
    expect(data.buzzwords).toEqual([]);
    expect(data.idealProject).not.toBeNull();
    expect(data.resumeAnchor).not.toBeNull();
    expect(data.points.length).toBeGreaterThan(0);
  });

  // Same relevance-gated buzzwords as the answer-mode case above — the
  // question has to actually be about the posting's own vocabulary
  // (Python/Kubernetes, both stated in POSTING_DESC) for `buzzwords` to come
  // back non-empty, rather than any generic "tell me about yourself" opener.
  it("keeps the posting description out of the points-mode prompt too", async () => {
    mockUserWithApplicationDocs({
      application: APPLICATION_WITH_POSTING,
      resumeContent: RESUME_DOC,
    });
    mockGemini({ points: ["Point one."], type: "general" });
    const res = await POST(
      jsonRequest({
        question: "Tell me about your Python and Kubernetes background.",
        engine: "gemini",
        applicationId: "app-1",
      }),
    );
    const data = await res.json();
    expect(data.buzzwords.length).toBeGreaterThan(0);
    // idealProject present in points mode too — the same aid, the same
    // posting-description-only input, on the mode that has no `answer` field
    // at all.
    expect(data.idealProject).not.toBeNull();

    const client = getGeminiClient();
    const promptText = client.models.generateContent.mock.calls[0][0].contents[0].parts[0].text;
    expect(promptText).not.toContain("Deep experience with Kubernetes");
  });

  it("degrades every aid to absent — never to an empty section — when there is nothing to build one from", async () => {
    mockUser();
    mockGemini({ points: ["A generic point."], type: "general" });
    const res = await POST(jsonRequest({ question: "Tell me about yourself.", engine: "gemini" }));
    const data = await res.json();
    expect(data.buzzwords).toEqual([]);
    expect(data.resumeAnchor).toBeNull();
    expect(data.idealProject).toBeNull();
    expect(data.cues).toEqual(["A generic point"]);
  });
});
