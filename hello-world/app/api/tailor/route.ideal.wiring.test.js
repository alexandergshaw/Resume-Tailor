// N105 Step 4 - the route's Ideal branch wired to the REAL pipeline. The landed
// route.ideal.test.js stubs tailorIdeal and reads the response shape; this file
// runs the real decompose / gate / chronology / recompose behind the route with a
// stubbed ENGINE, so it proves the route hands the pipeline usable real material
// (the resume's own spans AND its employers and school), not just that it calls it.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/experiencePages", () => ({ listPages: vi.fn() }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/scrape/fetchUrlContent", () => ({ fetchUrlContent: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { getServerEnv } from "@/lib/config/env";
import { listPages } from "@/lib/supabase/experiencePages";
import { fetchUrlContent } from "@/lib/scrape/fetchUrlContent";
import { registerEngine } from "@/lib/llm/engines";
import { stageError } from "@/lib/llm/ideal/idealStageResult";
import { POST } from "./route.js";

const RESUME = [
  "Jane Doe",
  "jane@example.com",
  "",
  "PROFESSIONAL EXPERIENCE",
  "Senior Engineer, Acme Corp | Jan 2019 - Present",
  "- Reduced support tickets by 40%",
  "",
  "EDUCATION",
  "State University — B.S. Computer Science (2011-2015)",
].join("\n");

const REAL_EMPLOYER_LINE = "Acme Corp — Senior Engineer (Jan 2019 - Present)";
const REAL_SCHOOL_LINE = "State University — B.S. Computer Science (2011-2015)";
const REAL_BULLET = "Reduced support tickets by 40%";
const FABRICATION = "Scaled the platform to 10,000,000 users";
const INVENTED_EMPLOYER_LINE = "Initech — Principal Engineer (2012-2016)";
const INVENTED_BULLET = "Ran search quality for billions of queries";

const CANDIDATE = [
  "Jane Doe",
  "jane@example.com",
  "",
  "PROFESSIONAL EXPERIENCE",
  REAL_EMPLOYER_LINE,
  REAL_BULLET,
  FABRICATION,
  INVENTED_EMPLOYER_LINE,
  INVENTED_BULLET,
  "",
  "EDUCATION",
  REAL_SCHOOL_LINE,
];

function textFile(name, content) {
  const f = new File([content], name, { type: "text/plain" });
  f.text = async () => content;
  return f;
}

function request(fields = {}, { resume = RESUME } = {}) {
  const fd = new FormData();
  fd.append("resume", textFile("resume.txt", resume));
  fd.append("templateLines", JSON.stringify(CANDIDATE));
  const defaults = { jobPosting: "We need a payments engineer.", engine: "gemini", tailorMode: "ideal" };
  for (const [key, value] of Object.entries({ ...defaults, ...fields })) {
    if (value !== null) fd.append(key, value);
  }
  return { formData: async () => fd };
}

function geminiStub(overrides = {}) {
  const engine = {
    name: "gemini",
    supportsIdeal: true,
    tailorResume: vi.fn(async () => ({ engine: "gemini", result: "STANDARD", resultLines: ["STANDARD"] })),
    tailorCoverLetter: vi.fn(async () => ({ resultLines: [], result: "" })),
    tailorHiringEmail: vi.fn(async () => null),
    tailorIdeal: vi.fn(async () => ({
      engine: "gemini",
      postingAnalysis: { requirements: [] },
      keywordMap: { entries: [] },
      hypothetical: { result: "HYPO", resultLines: ["HYPO"], jobTitle: "Payments Engineer", companyName: "Acme Corp" },
      applicationReadyCandidate: {
        result: CANDIDATE.join("\n"),
        resultLines: CANDIDATE,
        jobTitle: "Payments Engineer",
        companyName: "Acme Corp",
      },
    })),
    ...overrides,
  };
  registerEngine(engine);
  return engine;
}

beforeEach(() => {
  vi.clearAllMocks();
  createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } });
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash", resumeEngine: "gemini" });
});

describe("the route supplies real material built from the uploaded resume (AC-4, AC-10)", () => {
  it("keeps the real employer line, the real school line and the supported bullet", async () => {
    geminiStub();
    const body = await (await POST(request())).json();
    expect(body.resultLines).toContain(REAL_EMPLOYER_LINE);
    expect(body.resultLines).toContain(REAL_SCHOOL_LINE);
    expect(body.resultLines).toContain(REAL_BULLET);
  });

  it("removes the fabrication and the invented employer with its content", async () => {
    geminiStub();
    const body = await (await POST(request())).json();
    const emitted = body.resultLines.join("\n");
    expect(emitted).not.toContain("10,000,000");
    expect(emitted).not.toContain("Initech");
    expect(emitted).not.toContain("billions of queries");
    // They left the file, and the response accounts for them.
    const accounted = [...body.ideal.removed, ...body.ideal.leftOut].map((r) => r.text).join("\n");
    expect(accounted).toContain("10,000,000");
    expect(accounted).toContain("Initech");
  });

  it("hands the pipeline NOTHING when the resume names no employer: every employer line is removed (fails closed)", async () => {
    geminiStub();
    const body = await (await POST(request({}, { resume: "Jane Doe\njane@example.com" }))).json();
    const emitted = body.resultLines.join("\n");
    expect(emitted).not.toContain("Acme Corp —");
    expect(emitted).not.toContain(REAL_BULLET);
  });
});

describe("the Ideal branch is resume-only, atomic and never builds a file", () => {
  it("does not call tailorResume, tailorCoverLetter or tailorHiringEmail, even with a cover letter uploaded", async () => {
    const engine = geminiStub();
    const req = request();
    const fd = await req.formData();
    fd.append("coverLetter", textFile("cover.txt", "Dear team"));
    fd.append("coverLetterTemplateLines", JSON.stringify(["Dear team"]));
    const body = await (await POST({ formData: async () => fd })).json();
    expect(engine.tailorIdeal).toHaveBeenCalledTimes(1);
    expect(engine.tailorResume).not.toHaveBeenCalled();
    expect(engine.tailorCoverLetter).not.toHaveBeenCalled();
    expect(engine.tailorHiringEmail).not.toHaveBeenCalled();
    expect(body.coverLetterResultLines).toEqual([]);
    expect(body.emailResultLines).toEqual([]);
  });

  it("returns no bytes for the application-ready resume (the candidate's pre-gate bytes are never forwarded)", async () => {
    geminiStub({
      tailorIdeal: vi.fn(async () => ({
        postingAnalysis: {},
        keywordMap: {},
        hypothetical: { result: "H", resultLines: ["H"], jobTitle: "T", companyName: "C" },
        applicationReadyCandidate: {
          result: CANDIDATE.join("\n"),
          resultLines: CANDIDATE,
          jobTitle: "T",
          companyName: "C",
          docxB64: "PRE-GATE-BYTES",
        },
      })),
    });
    const body = await (await POST(request())).json();
    expect(body.docxB64).toBe("");
    expect(JSON.stringify(body)).not.toContain("PRE-GATE-BYTES");
  });

  it("a chain failure is an error with the failed stage and NO artifact", async () => {
    geminiStub({
      tailorIdeal: vi.fn(async () => {
        throw stageError("hypothetical", "truncated", "The hypothetical step was cut off. Nothing was produced.");
      }),
    });
    const res = await POST(request());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("The hypothetical step was cut off. Nothing was produced.");
    expect(body.failure).toEqual({ stage: "hypothetical", code: "truncated" });
    expect(body).not.toHaveProperty("result");
    expect(body).not.toHaveProperty("ideal");
  });

  it("passes the signed-in user's project pages to the chain and names any that did not fit", async () => {
    createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) } });
    const huge = Array.from({ length: 20 }, (_, i) => ({
      id: `p${i}`,
      title: `Project ${i}`,
      body: "x".repeat(3000),
      generated_kind: null,
      archived_at: null,
    }));
    listPages.mockResolvedValue({ pages: huge, error: null });
    const engine = geminiStub();
    const body = await (await POST(request())).json();
    const sent = engine.tailorIdeal.mock.calls[0][0];
    expect(sent.contextDocuments.some((d) => /project pages/i.test(d.name))).toBe(true);
    expect(body.warnings.some((w) => /project pages/i.test(w) && /left out/i.test(w))).toBe(true);
  });

  it("an unexpected error is still the generic 500, not a leaked message", async () => {
    geminiStub({
      tailorIdeal: vi.fn(async () => {
        throw new Error("secret internal detail");
      }),
    });
    const res = await POST(request());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret internal detail");
  });
});

describe("refusals spend nothing", () => {
  it("an embedded Ideal request is refused before the posting URL is scraped", async () => {
    registerEngine({ name: "embedded", supportsIdeal: false, tailorResume: vi.fn() });
    const res = await POST(request({ engine: "embedded", jobPosting: null, jobPostingUrl: "https://jobs.example.com/1" }));
    expect(res.status).toBe(422);
    expect((await res.json()).refusal.code).toBe("engine-unsupported");
    expect(fetchUrlContent).not.toHaveBeenCalled();
  });

  it("the engine-unsupported message names the engine the user is on", async () => {
    registerEngine({ name: "embedded", supportsIdeal: false, tailorResume: vi.fn() });
    const body = await (await POST(request({ engine: "embedded" }))).json();
    expect(body.error).toContain("Embedded (no AI)");
    expect(body.refusal).toMatchObject({ engine: "embedded", requires: "gemini" });
  });

  it("the empty-resume message names the uploaded file", async () => {
    geminiStub();
    const res = await POST(request({}, { resume: "" }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("resume.txt");
  });

  it("an unconfigured external service falls back to Gemini and says so", async () => {
    const prev = process.env.RESUME_TAILOR_API_URL;
    delete process.env.RESUME_TAILOR_API_URL;
    try {
      registerEngine({ name: "external", supportsIdeal: false, tailorResume: vi.fn() });
      const engine = geminiStub();
      const res = await POST(request({ engine: "external" }));
      expect(res.status).toBe(200);
      expect(engine.tailorIdeal).toHaveBeenCalledTimes(1);
      expect((await res.json()).warnings).toContain("Resume Tailor API is not configured; generated with Gemini instead.");
    } finally {
      if (prev !== undefined) process.env.RESUME_TAILOR_API_URL = prev;
    }
  });
});

describe("a request without tailorMode=ideal takes the unchanged standard path", () => {
  it.each([[null], ["standard"], ["IDEAL-ish"]])("tailorMode=%s runs tailorResume, never tailorIdeal", async (mode) => {
    const engine = geminiStub();
    const res = await POST(request({ tailorMode: mode, aggressiveness: "5" }));
    expect(res.status).toBe(200);
    expect(engine.tailorResume).toHaveBeenCalledTimes(1);
    expect(engine.tailorIdeal).not.toHaveBeenCalled();
    expect(await res.json()).not.toHaveProperty("ideal");
  });
});
