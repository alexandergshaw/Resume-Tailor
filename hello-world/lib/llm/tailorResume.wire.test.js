import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));

import { GoogleGenAI } from "@google/genai";
import {
  generateTailoredResumeDraft,
  generateTailoredCoverLetterDraft,
  generateTailoredHiringEmailDraft,
} from "./tailorResume";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { captureGeminiRequests, toolsOf } from "./geminiWireProbe";

// AC-Y1. The three résumé-tailoring calls actually request `urlContext` when
// they have a posting URL to read.
//
// THE DEFECT. `GenerateContentParameters` has exactly three properties —
// `model`, `contents`, `config` — and `tools` belongs to
// `GenerateContentConfig`. All three call sites in `tailorResume.js` spread
// `{ tools: [{ urlContext: {} }] }` at the TOP LEVEL, where the SDK's
// parameter transformer silently discards it. Nothing errors; the tool is
// simply never requested.
//
// WHY THIS FILE IS THE ONE THAT MATTERS MOST OF THE ELEVEN. The two
// conditional sites carry a comment explaining that "urlContext tool isn't
// compatible with response_mime_type, so only force JSON when we are not also
// fetching a URL". Today, with `tools` dropped, the URL branch sends NEITHER
// tools NOR a JSON mime type — and it survives only because
// `parseStructuredResult` is defensive about prose. So the branch has been
// quietly running in a third mode nobody designed: no tool, no schema. Fixing
// it makes the model genuinely fetch the posting URL on the core résumé path,
// which is a real output change on the app's main workflow, not a no-op.
//
// WHY IT DRIVES THE REAL SDK. The tests that were supposed to pin this shape
// elsewhere in the repo assert against an INJECTED FAKE CLIENT, which sees
// whatever object the caller hands it and cannot observe the layer that drops
// the key — five such assertions are green today against requests that never
// carried `tools`. Only the real transformer can catch this, so this file
// stubs `fetch` and reads the bytes. See `lib/llm/geminiWireProbe.js`.

const TEMPLATE_LINES = ["NAME", "Summary", "Experience"];
const BASE = {
  jobPosting: "We need a platform engineer.",
  resumeText: "Alex Shaw — platform engineer.",
  resumeFileName: "resume.docx",
  templateLines: TEMPLATE_LINES,
  additionalContext: "",
  steeringInstructions: "",
};
const WITH_URL = { ...BASE, jobPostingUrl: "https://example.test/job/123" };

beforeEach(() => {
  vi.clearAllMocks();
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash", geminiApiKey: "test-key" });
  // The REAL client. This is the whole point of the file — a fake here would
  // reproduce exactly the blindness that let the defect ship.
  getGeminiClient.mockReturnValue(new GoogleGenAI({ apiKey: "test-key" }));
});

const CASES = [
  ["resume", generateTailoredResumeDraft],
  ["cover letter", generateTailoredCoverLetterDraft],
  ["hiring email", generateTailoredHiringEmailDraft],
];

describe("urlContext is requested on the wire when there is a posting URL (AC-Y1)", () => {
  for (const [label, fn] of CASES) {
    it(`asks for urlContext on the ${label} draft`, async () => {
      const bodies = await captureGeminiRequests(() => fn(WITH_URL));
      expect(bodies).toHaveLength(1);
      expect(toolsOf(bodies[0])).toEqual([{ urlContext: {} }]);
    });
  }
});

describe("nothing is requested that the URL branch must not carry (AC-Y1)", () => {
  for (const [label, fn] of CASES) {
    it(`does not force a JSON mime type alongside urlContext on the ${label} draft`, async () => {
      // The constraint the existing comment names, asserted rather than
      // assumed — and now actually reachable, since before this fix the branch
      // sent no tool at all and the question could not arise.
      const bodies = await captureGeminiRequests(() => fn(WITH_URL));
      expect(bodies[0]?.generationConfig?.responseMimeType).toBeUndefined();
    });
  }
});

describe("the no-URL branch is unchanged (AC-Y1)", () => {
  it("requests no tools and keeps JSON mode on the cover letter draft", async () => {
    // The negative control for the change. These two callers deliberately
    // force JSON when there is no URL to read; a fix that moved `tools` into
    // `config` by rewriting the whole conditional could easily lose that.
    const bodies = await captureGeminiRequests(() => generateTailoredCoverLetterDraft(BASE));
    expect(toolsOf(bodies[0])).toBeUndefined();
    expect(bodies[0]?.generationConfig?.responseMimeType).toBe("application/json");
  });

  it("requests no tools on the hiring email draft", async () => {
    const bodies = await captureGeminiRequests(() => generateTailoredHiringEmailDraft(BASE));
    expect(toolsOf(bodies[0])).toBeUndefined();
    expect(bodies[0]?.generationConfig?.responseMimeType).toBe("application/json");
  });

  it("requests no tools on the resume draft, which never forced JSON either way", async () => {
    const bodies = await captureGeminiRequests(() => generateTailoredResumeDraft(BASE));
    expect(toolsOf(bodies[0])).toBeUndefined();
  });
});

describe("the top-level position is pinned as dropped (AC-Y1)", () => {
  it("proves the SDK discards a top-level tools key", async () => {
    // A standing negative control against the shape eleven call sites in this
    // repo still use. If a future SDK starts honouring the top-level key this
    // goes red — which is the right outcome: it means the rule changed and
    // every comment written about it is stale.
    const bodies = await captureGeminiRequests(() =>
      new GoogleGenAI({ apiKey: "test-key" }).models.generateContent({
        model: "gemini-2.5-flash",
        contents: "hi",
        tools: [{ urlContext: {} }],
        config: { systemInstruction: "sys" },
      }),
    );
    expect(toolsOf(bodies[0])).toBeUndefined();
  });
});
