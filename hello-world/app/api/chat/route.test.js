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

  // Returns the exact object handed to the SDK (`{ model, contents, config }`)
  // -- never an intermediate function's return value. Recorded lesson
  // (MEMORY: gemini-tools-nesting): an injected fake cannot see the layer
  // that drops your argument, so every assertion below reads the wire.
  async function wireFor(body) {
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
    return spy.mock.calls[0][0];
  }

  // Every text-bearing part on the wire, tagged with the role of the content
  // it belongs to. Mirrors route.promptInjection.test.js's own `textParts`.
  function contentsTextParts(wire) {
    return (wire?.contents ?? []).flatMap((c) =>
      (c?.parts ?? [])
        .filter((p) => typeof p?.text === "string")
        .map((p) => ({ role: c.role, text: p.text })),
    );
  }

  // AC-9 (implementer's note in AC-chat-injection.md): `buildContextBlock`'s
  // rendering used to be concatenated onto `SYSTEM_PROMPT` under this exact
  // sentinel line (route.js, pre-fix). The renderer itself (labels, order,
  // separators, truncation) did not change -- only its DESTINATION did, from
  // `config.systemInstruction` to a wrapped, delimited part on the latest
  // user turn (route.js's `wrapUntrustedContext`). This sentinel still
  // prefixes that relocated block verbatim, so it is what every case below
  // uses to find it -- without asserting anything about the wrapper's own
  // wording, which is route.promptInjection.test.js's job (AC-4/AC-5), not
  // this file's.
  const CONTEXT_INTRO = "Context about this user (do not repeat verbatim; use to personalize answers):";

  function dataBlockFor(wire) {
    const hits = contentsTextParts(wire).filter((p) => p.text.includes(CONTEXT_INTRO));
    expect(hits, "expected exactly one user-turn part carrying the relocated context block").toHaveLength(1);
    expect(hits[0].role).toBe("user");
    return hits[0].text;
  }

  it("[golden-applications] the system instruction is the constant prompt, and the applications block reaches the model byte-for-byte in the relocated user-turn data block", async () => {
    // FROZEN LITERAL. Captured on 2026-09-03 from the UNMODIFIED tree -- before
    // any of the caps, `truncate`, or the applications block moved out of
    // route.js -- by running this exact case against a deliberately wrong
    // expectation and pasting the printed actual. That provenance is the whole
    // value of the pin: a golden captured AFTER the extraction only proves the
    // extraction agrees with itself.
    //
    // REPOINTED (security fix, AC-chat-injection.md AC-9): this literal used
    // to be asserted whole against `config.systemInstruction`. The untrusted
    // context block that made up its second half no longer lives there --
    // see route.js's `wrapUntrustedContext` -- so the literal is now SPLIT at
    // the exact sentinel line the pre-fix code used to join the two halves
    // with (`CONTEXT_MARKER` below), and each half is asserted where it
    // actually lands now: the first half against `config.systemInstruction`
    // (now a constant, never varying with request content -- the fix's core
    // property), the second half as a substring of the relocated data block.
    // The literal itself, and its hash, are UNCHANGED -- this still proves the
    // exact same bytes the pre-change tree produced still reach the model,
    // just at their new, safe destination.
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

    // Split the (unchanged) golden literal at the exact sentinel the pre-fix
    // code used to join SYSTEM_PROMPT and the context block with -- this
    // computes the two expected halves FROM the frozen literal rather than
    // retyping them, so there is no second place for them to drift from it.
    const CONTEXT_MARKER = "\n\nContext about this user (do not repeat verbatim; use to personalize answers):\n";
    const markerAt = GOLDEN_SYSTEM_INSTRUCTION.indexOf(CONTEXT_MARKER);
    expect(markerAt).toBeGreaterThan(-1);
    const expectedSystemPrompt = GOLDEN_SYSTEM_INSTRUCTION.slice(0, markerAt);
    const expectedContextPayload = GOLDEN_SYSTEM_INSTRUCTION.slice(markerAt + 2); // drop the leading "\n\n" only

    const wire = await wireFor({ applications: GOLDEN_APPLICATIONS });

    // AC-1: the system instruction no longer varies with request content --
    // it is exactly the SYSTEM_PROMPT half of the old golden, byte for byte.
    expect(wire.config.systemInstruction).toBe(expectedSystemPrompt);

    // The relocated half: the exact same applications rendering the
    // pre-change tree produced -- same labels, same separators, same
    // truncation -- still reaches the model, just in the user turn instead
    // of the system instruction (AC-2/AC-3).
    expect(dataBlockFor(wire)).toContain(expectedContextPayload);
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
    const wire = spy.mock.calls[0][0];

    // REPOINTED (security fix, AC-9): same split as [golden-applications]
    // above -- the SYSTEM_PROMPT half stays on `config.systemInstruction`
    // (now constant), and the context half is asserted against the
    // relocated user-turn data block instead. The frozen literal and its
    // hash are unchanged.
    const CONTEXT_MARKER = "\n\nContext about this user (do not repeat verbatim; use to personalize answers):\n";
    const markerAt = GOLDEN_FIVE_SECTION.indexOf(CONTEXT_MARKER);
    expect(markerAt).toBeGreaterThan(-1);
    const expectedSystemPrompt = GOLDEN_FIVE_SECTION.slice(0, markerAt);
    const expectedContextPayload = GOLDEN_FIVE_SECTION.slice(markerAt + 2);

    expect(wire.config.systemInstruction).toBe(expectedSystemPrompt);
    const dataBlock = dataBlockFor(wire);
    expect(dataBlock).toContain(expectedContextPayload);

    // Legibility, not extra coverage: when the whole-string containment above
    // fails, these say WHICH property broke instead of handing the reader a
    // 3 KB diff. Order first...
    const at = (marker) => dataBlock.indexOf(marker);
    expect(at("PINNED-SECTION-MARKER")).toBeGreaterThan(-1);
    expect(at("PINNED-SECTION-MARKER")).toBeLessThan(at("FETCHED-SECTION-MARKER"));
    expect(at("FETCHED-SECTION-MARKER")).toBeLessThan(at("ATTACHED-SECTION-MARKER"));
    expect(at("ATTACHED-SECTION-MARKER")).toBeLessThan(at("RESUME-SECTION-MARKER"));
    expect(at("RESUME-SECTION-MARKER")).toBeLessThan(at("--- USER'S APPLICATIONS ---"));
    // ...then the separator between sections: a blank line, not one newline.
    expect(dataBlock).toContain("\n\n--- FETCHED URLS (");
    expect(dataBlock).toContain("\n\n--- USER-ATTACHED FILES (");
    expect(dataBlock).toContain("\n\n--- USER'S UPLOADED RESUME ---");
    expect(dataBlock).toContain("\n\n--- USER'S APPLICATIONS ---");
    // ...and each argument landed in its own parameter slot: the label the
    // renderer only ever prints for THAT section carries that section's text.
    expect(dataBlock).toContain("[PINNED-LABEL-MARKER]\nPINNED-SECTION-MARKER");
    expect(dataBlock).toContain("[FETCHED-TITLE-MARKER — https://example.com/posting]\nFETCHED-SECTION-MARKER");
    expect(dataBlock).toContain("[ATTACHED-NAME-MARKER.md]\nATTACHED-SECTION-MARKER");
  });

  it("[R08] a resume and ZERO applications: the context block ends at the resume, with no trailing separator", async () => {
    // The case that makes the extracted renderer's `null` return load-bearing.
    // route.js today only pushes the applications section when the array is
    // non-empty; an extraction that pushes unconditionally --
    // `parts.push(renderApplicationsSection(applications))` -- appends a null,
    // and `[resume, null].join("\n\n")` leaves a TRAILING BLANK SEPARATOR on
    // every context block sent for a user who has uploaded a resume and
    // tracks no applications. That is a real, shipped, user-affecting change
    // to the model's input, and every other Gemini case in this file passes a
    // non-empty applications array, so nothing else here can see it.
    //
    // REPOINTED (security fix, AC-9): the block now lives in the user-turn
    // data block, which the fix wraps in a fixed closing tag -- so the block
    // no longer literally ENDS the string on the wire. The property under
    // test is unchanged (nothing but the wrapper's own, constant closing
    // boundary may follow the resume text): checked here as "no blank-line
    // separator, and no applications header, follow the resume sentinel",
    // which is exactly what a reintroduced trailing "\n\n" (or a literal
    // "null") would produce and the fixed wrapper never does.
    const wire = await wireFor({
      resumeText: "RESUME-SECTION-MARKER\nAlex Shaw — Data Engineer · Zürich",
      applications: [],
    });
    const dataBlock = dataBlockFor(wire);
    const resumeEnding = "RESUME-SECTION-MARKER\nAlex Shaw — Data Engineer · Zürich";
    const resumeAt = dataBlock.indexOf(resumeEnding);
    expect(resumeAt).toBeGreaterThan(-1);
    const remainder = dataBlock.slice(resumeAt + resumeEnding.length);

    // No trailing blank-line separator and no applications header -- the
    // wrapper's own (single-newline) closing boundary is the only thing
    // allowed to follow the resume text now.
    expect(remainder).not.toMatch(/\n\n/);
    expect(remainder).not.toContain("--- USER'S APPLICATIONS ---");
    // PAIRED POSITIVE CONTROL: the resume section really is in there -- an
    // "ends with the resume" assertion is otherwise satisfiable by a build
    // that dropped every section but this one.
    expect(dataBlock).toContain("--- USER'S UPLOADED RESUME ---");
    // ABSENCE: no empty applications header anywhere in the block.
    expect(dataBlock).not.toContain("--- USER'S APPLICATIONS ---");
    // No trailing whitespace between the resume text and the remainder
    // (the remainder itself is either empty or the wrapper's own close tag,
    // never bare whitespace).
    expect(remainder).not.toMatch(/^\s+$/);
  });

  it("[R08 control] the same fixture WITH one application still renders both sections, in order", async () => {
    // The other half of the pair: [R08] asserts an absence, so this proves the
    // applications section is still reachable from the same code path and that
    // the separator between resume and applications is exactly one blank line.
    const wire = await wireFor({
      resumeText: "RESUME-SECTION-MARKER\nAlex Shaw — Data Engineer · Zürich",
      applications: [{ company: "Northwind Analytics" }],
    });
    const dataBlock = dataBlockFor(wire);

    expect(dataBlock).toContain(
      "RESUME-SECTION-MARKER\nAlex Shaw — Data Engineer · Zürich\n\n--- USER'S APPLICATIONS ---\nApplication 1:\n  Company: Northwind Analytics",
    );
    // REPOINTED (AC-9): the block no longer ends the wire string (the
    // wrapper's closing tag now follows it), so "nothing else follows in the
    // payload" is checked the same way [R08] checks it -- via the remainder
    // after the last expected line, rather than via `.endsWith` on the whole
    // part.
    const companyLine = "  Company: Northwind Analytics";
    const companyAt = dataBlock.indexOf(companyLine);
    expect(companyAt).toBeGreaterThan(-1);
    const remainder = dataBlock.slice(companyAt + companyLine.length);
    expect(remainder).not.toMatch(/\n\n/);
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

    const wire = await wireFor({
      applications: [{ company: "Helvetica Systems", jobDescription: jd, tailoredResume: resume }],
    });
    const dataBlock = dataBlockFor(wire);

    expect(dataBlock).toContain(`  Job Description: ${jd.slice(0, 1500)}…`);
    expect(dataBlock).toContain(`  Tailored Resume: ${resume.slice(0, 2000)}…`);
    // PAIRED POSITIVE CONTROL: the block is really there and really carries the
    // posting text -- an assertion about what was truncated is also satisfied
    // by a renderer that emitted nothing at all.
    expect(dataBlock).toContain("--- USER'S APPLICATIONS ---");
    expect(dataBlock).toContain("  Company: Helvetica Systems");
    // ABSENCE: the 1501st character never reaches the model. (A byte-based
    // bound fails the two `toContain`s above instead -- it keeps ~1311
    // characters, which `truncate` then leaves un-ellipsised because 1311 is
    // under the cap, so the JD line is short AND loses its "…".)
    expect(dataBlock).not.toContain(jd.slice(0, 1501));
  });

  it("[slice] only the first MAX_APPLICATIONS applications are rendered, in order", async () => {
    const applications = Array.from({ length: 26 }, (_, i) => ({
      company: `Company ${String(i).padStart(3, "0")}`,
      role: `Role ${i}`,
      status: "applied",
    }));

    const wire = await wireFor({ applications });
    const dataBlock = dataBlockFor(wire);

    expect(dataBlock.match(/^Application \d+:$/gm)).toHaveLength(25);
    // PAIRED POSITIVE CONTROL for the absence below: the ones that ARE rendered.
    expect(dataBlock).toContain("  Company: Company 000");
    expect(dataBlock).toContain("  Company: Company 024");
    // The 26th is beyond the slice.
    expect(dataBlock).not.toContain("  Company: Company 025");
    // Order is part of the contract: 000 renders before 024.
    expect(dataBlock.indexOf("Company 000")).toBeLessThan(dataBlock.indexOf("Company 024"));
  });
});
