import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/scrape/fetchUrlContent", () => ({
  fetchUrlContent: vi.fn(),
  extractUrls: vi.fn(() => []),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/logChatMessage", () => ({ logChatMessage: vi.fn(async () => {}) }));

import { createHash } from "node:crypto";
import { POST } from "./route.js";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { createClient } from "@/lib/supabase/server";
import { extractUrls, fetchUrlContent } from "@/lib/scrape/fetchUrlContent";

function jsonRequest(body) {
  return { json: async () => body };
}

beforeEach(() => {
  vi.clearAllMocks();
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
  });
});

describe("POST /api/chat (embedded engine)", () => {
  it("400s when no messages are provided", async () => {
    const res = await POST(jsonRequest({ messages: [], engine: "embedded" }));
    expect(res.status).toBe(400);
  });

  it("answers from context offline — no Gemini call or key", async () => {
    const res = await POST(
      jsonRequest({
        messages: [{ role: "user", content: "how many applications do I have?" }],
        applications: [{ company: "Acme", status: "applied", stages: [] }],
        engine: "embedded",
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.reply).toMatch(/tracking 1 application/i);
    expect(getGeminiClient).not.toHaveBeenCalled();
    expect(getServerEnv).not.toHaveBeenCalled();
  });

  it("analyzes a pinned posting offline", async () => {
    const res = await POST(
      jsonRequest({
        messages: [{ role: "user", content: "I need help with this job: what should I emphasize?" }],
        pinnedContext: {
          label: "Backend Engineer",
          content: "Design scalable APIs in Node.js and TypeScript with PostgreSQL and AWS.",
        },
        engine: "embedded",
      }),
    );
    const data = await res.json();
    expect(data.reply).toMatch(/this posting leans most on/i);
    expect(getGeminiClient).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The applications block, pinned END TO END on the REAL Gemini path.
//
// Everything above this line drives only the embedded branch, so
// `buildContextBlock` -- the code that turns `body.applications` into what the
// model actually reads -- had ZERO coverage. A property test over an extracted
// renderer cannot close that hole: it proves the extracted function agrees
// with itself, not that `route.js` still calls it correctly. `route.js:233`
// passes FIVE positional arrays/objects (resumeText, applications,
// pinnedContext, attachedFiles, fetchedUrls); swapping two of them during an
// extraction is caught by nothing else in this suite.
//
// Four things that silently degrade this pin if they are ever "tidied":
//   1. `engine: "gemini"` is MANDATORY. `@/lib/llm/featureEngine` is not
//      mocked, and `wantsEmbedded(undefined)` with no RESUME_ENGINE and no
//      Gemini_LLM_API_Key returns TRUE -- route.js:185 would short-circuit at
//      the embedded branch and `buildContextBlock` would never run, leaving
//      these assertions testing nothing.
//   2. `getServerEnv` must be given a return value; it is a bare `vi.fn()`
//      returning undefined, so `const { geminiModel } = getServerEnv()` throws
//      and POST answers 500 from its catch-all with the spy never called.
//   3. The `extractUrls: vi.fn(() => [])` mock at the top of this file must
//      stay, or `resolveFetchedUrls` attempts real network fetches.
//   4. The mocked response is `{ text: "ok" }` -- a PROPERTY, not a function
//      (route.js:246 reads `response.text?.trim()`).
// ---------------------------------------------------------------------------

// Real resume/posting text: accents, an em dash, curly quotes, a bullet, a
// euro sign. `.length` (UTF-16 code units) differs from the UTF-8 byte length,
// which is the whole point -- an ASCII fixture cannot tell a correct
// code-unit bound from a byte-based one (AC-6, AC-8).
const ACCENTED_LINE = "Résumé — led “growth” • €1.2M ARR · naïve café über Zurück ";
// A DIFFERENT repeating base for the tailored resume. With one shared base the
// 2001-character resume string trivially contains the 1501-character job
// description as a substring, and a "this text never reached the model"
// assertion about the JD is then satisfied (or defeated) by the resume line
// instead -- the assertion would be about the wrong string.
const RESUME_LINE = "Alex Shaw — Ingénieur données · piloté 4 équipes • €4M ARR ↑ naïve→robuste ";

function multibyte(n, line = ACCENTED_LINE) {
  let out = "";
  while (out.length < n) out += line;
  return out.slice(0, n);
}

// Structurally COMPLETE and small: application 1 carries all seven rendered
// fields plus two stages (one "pending" -- which route.js suppresses -- and
// one "passed" -- which it renders); application 2 carries only `company`;
// application 3 carries only `stages`, with a stage that has no `name` (so the
// `type` fallback branch renders) and a null outcome.
const GOLDEN_APPLICATIONS = [
  {
    company: "Northwind Analytics",
    role: "Senior Data Engineer",
    status: "interviewing",
    appliedAt: "2026-02-11",
    applicationUrl: "https://boards.example.com/northwind/senior-data-engineer",
    jobDescription: "Own the ingestion pipeline — Airflow, dbt, Snowflake. Résumé bullets that quantify impact win here.",
    tailoredResume: "Alex Shaw — Data Engineer\n• Cut nightly ETL runtime 62% (naïve joins → partitioned merges).",
    stages: [
      { name: "Recruiter screen", type: "phone_screen", scheduledAt: "2026-02-18T15:00:00Z", outcome: "passed" },
      { name: "System design", type: "onsite", scheduledAt: "2026-03-02T17:30:00Z", outcome: "pending" },
    ],
  },
  { company: "Café Lumière" },
  { stages: [{ name: null, type: "take_home", scheduledAt: "2026-02-20T12:00:00Z", outcome: null }] },
];

describe("POST /api/chat (Gemini path): the applications block is byte-identical", () => {
  beforeEach(() => {
    // vitest.config.js sets neither `clearMocks` nor `restoreMocks`, and
    // `vi.clearAllMocks()` (the file-level beforeEach) clears CALL HISTORY
    // only -- an implementation installed by an earlier test in this file
    // survives it. Reset, don't clear, so a stale return value can never make
    // one of these cases pass for the wrong reason.
    getServerEnv.mockReset();
    getGeminiClient.mockReset();
    // The URL mocks matter for the same reason. `mockReturnValueOnce` queues a
    // value that `vi.clearAllMocks()` does NOT drain, so an unconsumed one
    // would leak into the next case and fetch a URL it never asked for.
    // Reset, then reinstate the file-level default explicitly rather than
    // relying on mockReset's restore-the-original-implementation semantics.
    extractUrls.mockReset();
    extractUrls.mockReturnValue([]);
    fetchUrlContent.mockReset();
  });

  // sha256 of the golden string. Recorded so the next reviewer can re-derive
  // the pin in one command instead of trusting a 2-3 KB literal by eye -- and,
  // more importantly, so a RE-CAPTURE is loud: pasting a new actual over the
  // literal goes red here too, and repairing that requires editing a hash,
  // which no one does by accident.
  const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");

  function geminiHarness() {
    const generateContent = vi.fn(async () => ({ text: "ok" }));
    getServerEnv.mockReturnValue({ geminiModel: "gemini-test" });
    getGeminiClient.mockReturnValue({ models: { generateContent } });
    return generateContent;
  }

  async function systemInstructionFor(body) {
    const spy = geminiHarness();
    const res = await POST(
      jsonRequest({
        engine: "gemini",
        messages: [{ role: "user", content: "how am I doing overall?" }],
        ...body,
      }),
    );
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    return spy.mock.calls[0][0].config.systemInstruction;
  }

  it("[golden-applications] the whole systemInstruction is byte-for-byte what the pre-change tree produced", async () => {
    // FROZEN LITERAL. Captured on 2026-09-03 from the UNMODIFIED tree -- before
    // any of the caps, `truncate`, or the applications block moved out of
    // route.js -- by running this exact case against a deliberately wrong
    // expectation and pasting the printed actual. That provenance is the whole
    // value of the pin: a golden captured AFTER the extraction only proves the
    // extraction agrees with itself.
    //
    // What it catches: a lost or reworded label, a changed line prefix or
    // separator INSIDE the applications block, a `.trim()` slipped into
    // `truncate`, a dropped field, a changed slice size, and an argument swap
    // at `route.js:233` THAT INVOLVES `applications` (e.g. resumeText <->
    // applications). What it does NOT catch, stated plainly because the
    // previous wording overclaimed it: a swap of two arguments this fixture
    // leaves empty -- `attachedFiles` <-> `fetchedUrls` produces an IDENTICAL
    // string here. That gap is what [golden-five-section] below closes; this
    // case survives alongside it because a failure confined to the
    // applications block reads much more legibly against a 2 KB string than
    // against a 3 KB one.
    //
    // sha256 (recomputed independently from route.js's own source by
    // plan-a1-verify.mjs, which anchor-slices the file rather than replicating
    // it): f2c4b8d2506669af12c65e8ae88d51290e4ccb4cd8358ebadffc4a310e57f3f1
    //
    // If this goes red, the change under review altered what the model reads.
    // DO NOT re-capture the literal to make it green.
    const GOLDEN_SYSTEM_INSTRUCTION =
      "You are a concise, friendly career assistant inside the Resume Tailor app. Help the user with resume writing, job search strategy, interview prep, and using this tool. Answer briefly. Use plain language. No markdown headings unless asked. Never use bold or italic formatting (no **bold**, no __bold__, no *italic*, no _italic_). Write in plain prose only. When the user has uploaded a resume or has applications, use that context to give specific, personalized advice. Reference specific companies, roles, or resume bullets from the provided context when relevant. If the user pastes a URL in their message, the page contents are fetched server-side and provided to you under '--- FETCHED URLS ---'. Use that fetched text instead of saying you cannot open links. The '--- PINNED CONTEXT ---' block is the user's currently-selected subject (typically a job posting they just clicked 'Ask AI' on). Treat any text after a 'Description:' header inside it as the authoritative job description and answer questions about that description directly. If the pinned context references a URL, the fetched page content for that URL appears under '--- FETCHED URLS ---' and should be treated as the job description as well. Never tell the user you do not have access to the job description when a pinned context or fetched URL is present — instead answer using whatever description text is provided, and only if the description text is literally empty say something like 'the posting did not include a description; here is what I can infer from the title/company'.\n\nContext about this user (do not repeat verbatim; use to personalize answers):\n--- USER'S APPLICATIONS ---\nApplication 1:\n  Company: Northwind Analytics\n  Role: Senior Data Engineer\n  Status: interviewing\n  Applied: 2026-02-11\n  URL: https://boards.example.com/northwind/senior-data-engineer\n  Job Description: Own the ingestion pipeline — Airflow, dbt, Snowflake. Résumé bullets that quantify impact win here.\n  Tailored Resume: Alex Shaw — Data Engineer\n• Cut nightly ETL runtime 62% (naïve joins → partitioned merges).\n  Interview Stages: Recruiter screen @ 2026-02-18T15:00:00Z (passed); System design @ 2026-03-02T17:30:00Z\n\nApplication 2:\n  Company: Café Lumière\n\nApplication 3:\n  Interview Stages: take_home @ 2026-02-20T12:00:00Z";

    expect(sha256(GOLDEN_SYSTEM_INSTRUCTION)).toBe(
      "f2c4b8d2506669af12c65e8ae88d51290e4ccb4cd8358ebadffc4a310e57f3f1",
    );
    const systemInstruction = await systemInstructionFor({ applications: GOLDEN_APPLICATIONS });
    expect(systemInstruction).toBe(GOLDEN_SYSTEM_INSTRUCTION);
  });

  it("[golden-five-section] every section, in order, with the separator between them", async () => {
    // FROZEN LITERAL, captured 2026-09-03 from the UNMODIFIED tree (git status
    // clean for route.js and chatbot.js at capture time), by the same
    // wrong-expectation-then-paste method as the case above.
    //
    // sha256 a194cfe95a341c2a7d5607722d6a90b3d0e991f5ade73730d5bf1a376eac87c9
    // 2,895 UTF-16 code units / 2,924 UTF-8 bytes. Both the hash and the length
    // were predicted by PLAN-A1 §5.2a from a second, independent instrument
    // that anchor-slices route.js, and this capture matched it exactly -- so
    // the pin is corroborated, not merely self-consistent.
    //
    // WHY FIVE SECTIONS. `buildContextBlock` takes five positional parameters
    // (`resumeText, applications, pinnedContext, attachedFiles, fetchedUrls`,
    // declared at route.js:27 and called at :233) and joins its output with
    // "\n\n" in a fixed push order (`parts.join` at :76). A
    // fixture that populates only ONE of them leaves an extraction free to
    // reorder the pushes, change the separator, or swap two of the arguments
    // -- all silently. Specifically: with the applications-only fixture,
    // swapping `attachedFiles` and `fetchedUrls` produces an IDENTICAL string.
    // This fixture populates all five, so order, separator and every argument
    // position are pinned at once.
    //
    // DO NOT re-capture the literal to make it green: the hash assertion below
    // is here so that repairing a red pin that way takes two deliberate edits
    // rather than one invisible paste.
    const GOLDEN_FIVE_SECTION =
      "You are a concise, friendly career assistant inside the Resume Tailor app. Help the user with resume writing, job search strategy, interview prep, and using this tool. Answer briefly. Use plain language. No markdown headings unless asked. Never use bold or italic formatting (no **bold**, no __bold__, no *italic*, no _italic_). Write in plain prose only. When the user has uploaded a resume or has applications, use that context to give specific, personalized advice. Reference specific companies, roles, or resume bullets from the provided context when relevant. If the user pastes a URL in their message, the page contents are fetched server-side and provided to you under '--- FETCHED URLS ---'. Use that fetched text instead of saying you cannot open links. The '--- PINNED CONTEXT ---' block is the user's currently-selected subject (typically a job posting they just clicked 'Ask AI' on). Treat any text after a 'Description:' header inside it as the authoritative job description and answer questions about that description directly. If the pinned context references a URL, the fetched page content for that URL appears under '--- FETCHED URLS ---' and should be treated as the job description as well. Never tell the user you do not have access to the job description when a pinned context or fetched URL is present — instead answer using whatever description text is provided, and only if the description text is literally empty say something like 'the posting did not include a description; here is what I can infer from the title/company'.\n\nContext about this user (do not repeat verbatim; use to personalize answers):\n--- PINNED CONTEXT (user just clicked \"Ask AI\" on this; treat as the primary subject of the question) ---\n[PINNED-LABEL-MARKER]\nPINNED-SECTION-MARKER\nDescription:\nOwn the café ingestion pipeline.\n\n--- FETCHED URLS (content the user linked in their message; treat as primary reference material) ---\n[FETCHED-TITLE-MARKER — https://example.com/posting]\nFETCHED-SECTION-MARKER — Résumé keywords\n\n--- USER-ATTACHED FILES (dropped into chat as context) ---\n[ATTACHED-NAME-MARKER.md]\nATTACHED-SECTION-MARKER — naïve notes\n\n--- USER'S UPLOADED RESUME ---\nRESUME-SECTION-MARKER\nAlex Shaw — Data Engineer · Zürich\n\n--- USER'S APPLICATIONS ---\nApplication 1:\n  Company: Northwind Analytics\n  Role: Senior Data Engineer\n  Status: interviewing\n  Applied: 2026-02-11\n  URL: https://boards.example.com/northwind/senior-data-engineer\n  Job Description: Own the ingestion pipeline — Airflow, dbt, Snowflake. Résumé bullets that quantify impact win here.\n  Tailored Resume: Alex Shaw — Data Engineer\n• Cut nightly ETL runtime 62% (naïve joins → partitioned merges).\n  Interview Stages: Recruiter screen @ 2026-02-18T15:00:00Z (passed); System design @ 2026-03-02T17:30:00Z\n\nApplication 2:\n  Company: Café Lumière\n\nApplication 3:\n  Interview Stages: take_home @ 2026-02-20T12:00:00Z";

    expect(sha256(GOLDEN_FIVE_SECTION)).toBe(
      "a194cfe95a341c2a7d5607722d6a90b3d0e991f5ade73730d5bf1a376eac87c9",
    );
    expect(GOLDEN_FIVE_SECTION).toHaveLength(2_895);

    const spy = geminiHarness();
    extractUrls.mockReturnValueOnce(["https://example.com/posting"]);
    fetchUrlContent.mockResolvedValueOnce({
      title: "FETCHED-TITLE-MARKER",
      description: "FETCHED-SECTION-MARKER — Résumé keywords",
    });
    const res = await POST(
      jsonRequest({
        engine: "gemini",
        messages: [{ role: "user", content: "how am I doing overall?" }],
        resumeText: "RESUME-SECTION-MARKER\nAlex Shaw — Data Engineer · Zürich",
        pinnedContext: {
          label: "PINNED-LABEL-MARKER",
          content: "PINNED-SECTION-MARKER\nDescription:\nOwn the café ingestion pipeline.",
        },
        attachedFiles: [{ name: "ATTACHED-NAME-MARKER.md", content: "ATTACHED-SECTION-MARKER — naïve notes" }],
        applications: GOLDEN_APPLICATIONS,
      }),
    );
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    const systemInstruction = spy.mock.calls[0][0].config.systemInstruction;

    expect(systemInstruction).toBe(GOLDEN_FIVE_SECTION);

    // Legibility, not extra coverage: when the whole-string equality above
    // fails, these say WHICH property broke instead of handing the reader a
    // 3 KB diff. Order first...
    const at = (marker) => systemInstruction.indexOf(marker);
    expect(at("PINNED-SECTION-MARKER")).toBeGreaterThan(-1);
    expect(at("PINNED-SECTION-MARKER")).toBeLessThan(at("FETCHED-SECTION-MARKER"));
    expect(at("FETCHED-SECTION-MARKER")).toBeLessThan(at("ATTACHED-SECTION-MARKER"));
    expect(at("ATTACHED-SECTION-MARKER")).toBeLessThan(at("RESUME-SECTION-MARKER"));
    expect(at("RESUME-SECTION-MARKER")).toBeLessThan(at("--- USER'S APPLICATIONS ---"));
    // ...then the separator between sections: a blank line, not one newline.
    expect(systemInstruction).toContain("\n\n--- FETCHED URLS (");
    expect(systemInstruction).toContain("\n\n--- USER-ATTACHED FILES (");
    expect(systemInstruction).toContain("\n\n--- USER'S UPLOADED RESUME ---");
    expect(systemInstruction).toContain("\n\n--- USER'S APPLICATIONS ---");
    // ...and each argument landed in its own parameter slot: the label the
    // renderer only ever prints for THAT section carries that section's text.
    expect(systemInstruction).toContain("[PINNED-LABEL-MARKER]\nPINNED-SECTION-MARKER");
    expect(systemInstruction).toContain("[FETCHED-TITLE-MARKER — https://example.com/posting]\nFETCHED-SECTION-MARKER");
    expect(systemInstruction).toContain("[ATTACHED-NAME-MARKER.md]\nATTACHED-SECTION-MARKER");
  });

  it("[R08] a resume and ZERO applications: the instruction ends at the resume, with no trailing separator", async () => {
    // The case that makes the extracted renderer's `null` return load-bearing.
    // route.js today only pushes the applications section when the array is
    // non-empty; an extraction that pushes unconditionally --
    // `parts.push(renderApplicationsSection(applications))` -- appends a null,
    // and `[resume, null].join("\n\n")` leaves a TRAILING BLANK SEPARATOR on
    // every Gemini system instruction sent by a user who has uploaded a resume
    // and tracks no applications. That is a real, shipped, user-affecting
    // change to the model's input, and every other Gemini case in this file
    // passes a non-empty applications array, so nothing else here can see it.
    //
    // Asserting the string ENDS at the resume sentinel is the whole test: a
    // trailing "\n\n" (or a literal "null") breaks `endsWith` immediately.
    const systemInstruction = await systemInstructionFor({
      resumeText: "RESUME-SECTION-MARKER\nAlex Shaw — Data Engineer · Zürich",
      applications: [],
    });

    expect(systemInstruction.endsWith("RESUME-SECTION-MARKER\nAlex Shaw — Data Engineer · Zürich")).toBe(true);
    // PAIRED POSITIVE CONTROL: the resume section really is in there -- an
    // "ends with the resume" assertion is otherwise satisfiable by a build
    // that dropped every section but this one.
    expect(systemInstruction).toContain("--- USER'S UPLOADED RESUME ---");
    // ABSENCE: no empty applications header, and no trailing whitespace.
    expect(systemInstruction).not.toContain("--- USER'S APPLICATIONS ---");
    expect(systemInstruction).not.toMatch(/\s$/);
  });

  it("[R08 control] the same fixture WITH one application still renders both sections, in order", async () => {
    // The other half of the pair: [R08] asserts an absence, so this proves the
    // applications section is still reachable from the same code path and that
    // the separator between resume and applications is exactly one blank line.
    const systemInstruction = await systemInstructionFor({
      resumeText: "RESUME-SECTION-MARKER\nAlex Shaw — Data Engineer · Zürich",
      applications: [{ company: "Northwind Analytics" }],
    });

    expect(systemInstruction).toContain(
      "RESUME-SECTION-MARKER\nAlex Shaw — Data Engineer · Zürich\n\n--- USER'S APPLICATIONS ---\nApplication 1:\n  Company: Northwind Analytics",
    );
    expect(systemInstruction.endsWith("  Company: Northwind Analytics")).toBe(true);
  });

  it("[cap] a JD of MAX_JD_CHARS+1 and a resume of MAX_TAILORED_CHARS+1 MULTIBYTE characters keep 1500/2000 characters and the ellipsis", async () => {
    // The case an ASCII golden structurally cannot see. `"d".repeat(1501)` has
    // a UTF-8 byte length equal to its `.length`, so a byte-based bound is
    // indistinguishable from a correct code-unit one against it -- while on
    // this fixture a byte bound drops ~190 characters AND the trailing "…".
    // The expected strings are computed here from the fixture, not pasted, so
    // the case still describes the rule if the caps ever move (AC-6, AC-8).
    const jd = multibyte(1501);
    const resume = multibyte(2001, RESUME_LINE);
    expect(new TextEncoder().encode(jd).length).not.toBe(jd.length);
    expect(new TextEncoder().encode(resume).length).not.toBe(resume.length);

    const systemInstruction = await systemInstructionFor({
      applications: [{ company: "Helvetica Systems", jobDescription: jd, tailoredResume: resume }],
    });

    expect(systemInstruction).toContain(`  Job Description: ${jd.slice(0, 1500)}…`);
    expect(systemInstruction).toContain(`  Tailored Resume: ${resume.slice(0, 2000)}…`);
    // PAIRED POSITIVE CONTROL: the block is really there and really carries the
    // posting text -- an assertion about what was truncated is also satisfied
    // by a renderer that emitted nothing at all.
    expect(systemInstruction).toContain("--- USER'S APPLICATIONS ---");
    expect(systemInstruction).toContain("  Company: Helvetica Systems");
    // ABSENCE: the 1501st character never reaches the model. (A byte-based
    // bound fails the two `toContain`s above instead -- it keeps ~1311
    // characters, which `truncate` then leaves un-ellipsised because 1311 is
    // under the cap, so the JD line is short AND loses its "…".)
    expect(systemInstruction).not.toContain(jd.slice(0, 1501));
  });

  it("[slice] only the first MAX_APPLICATIONS applications are rendered, in order", async () => {
    const applications = Array.from({ length: 26 }, (_, i) => ({
      company: `Company ${String(i).padStart(3, "0")}`,
      role: `Role ${i}`,
      status: "applied",
    }));

    const systemInstruction = await systemInstructionFor({ applications });

    expect(systemInstruction.match(/^Application \d+:$/gm)).toHaveLength(25);
    // PAIRED POSITIVE CONTROL for the absence below: the ones that ARE rendered.
    expect(systemInstruction).toContain("  Company: Company 000");
    expect(systemInstruction).toContain("  Company: Company 024");
    // The 26th is beyond the slice.
    expect(systemInstruction).not.toContain("  Company: Company 025");
    // Order is part of the contract: 000 renders before 024.
    expect(systemInstruction.indexOf("Company 000")).toBeLessThan(systemInstruction.indexOf("Company 024"));
  });
});
