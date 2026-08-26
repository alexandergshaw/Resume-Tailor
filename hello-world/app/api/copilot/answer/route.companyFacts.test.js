// Two bands of app/api/copilot/answer/route.test.js's own cases, split out
// here to keep that file under this project's hard 1000-line limit:
//
//   1. AC-K1 — the three reading aids (cues/buzzwords/resumeAnchor/
//      idealProject) that sit beside a drafted answer.
//   2. AC-V4 — verified company facts: the company-facts search, its
//      corroboration, the company-directed gate, and factIds/factSources.
//
// WHY THESE TWO, TOGETHER: route.test.js had grown to 1201 lines (seven new
// AC-V4 cases pushed it over the cap). AC-V4 alone — the newest band, and
// the one with its own dedicated mock (fetchUrlContent, for corroboration)
// — was the obvious first cut, but moving it alone still left the original
// file short of "comfortably under" the cap. AC-K1 was the next whole
// `describe` block that could leave cleanly: unlike "project pages" (which
// pulls in draftSampleAnswerLocal/normalizeInterviewType) or "answer mode"
// (the base mode itself), it depends on nothing beyond the same
// mockUser/mockGemini/mockUserWithApplicationDocs fixtures AC-V4 already
// needs here, so pairing them keeps this file's own header short.
//
// Both bands are otherwise unrelated — this file is a mechanical split, not
// a new feature area — so each keeps its original describe title and every
// assertion unchanged. See route.test.js's header for the rest of the
// route's cases.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
// AC-V4: buildCompanyFacts' corroboration step (lib/copilot/companyFactsSource.js)
// resolves every grounded URI through lib/meeting/referenceContract.js's
// resolveGroundedSources, which reaches the real network via
// lib/scrape/fetchUrlContent.js's fetchUrlContent (15s timeout on a real
// miss). Mocked here to an identity fetch (finalUrl === the uri it was
// given) so the AC-V4 cases below corroborate deterministically and fast,
// with no real request ever leaving the process.
vi.mock("@/lib/scrape/fetchUrlContent", () => ({ fetchUrlContent: vi.fn(async (url) => ({ finalUrl: url })) }));

import { POST } from "./route.js";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { createClient } from "@/lib/supabase/server";
// AC-V5.2: the route now caches its Supabase fan-out per (userId,
// applicationId) for the life of a server instance (lib/copilot/
// answerSessionCache.js). Cleared before every test below because this file
// reuses the SAME synthetic user id ("user-1") and application id ("app-1")
// across many independent `it()` blocks, each with its own, DIFFERENT
// mocked Supabase content — a real product behaviour (this cache is correct
// to serve a second question of one interview from the first question's
// fetch) that would otherwise leak between unrelated test cases and serve
// one test's mocked résumé/pages to the next.
// AC-V4.9: `companyFactsCache` is the route's SECOND module-scope cache and
// it needs clearing here for exactly the same reason — see the case at the
// bottom of this file, and answerSessionCache.js's own header on why both
// instances belong beside each other rather than one of them being private
// to the route.
import { answerContextCache, companyFactsCache } from "@/lib/copilot/answerSessionCache";

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
  companyFactsCache.clear();
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

// AC-V4 (Group V record, Evidence D / architecture doc §2). "What do you
// know about Purple Wave?" used to get answered with "My research indicates
// a strong focus on continuous improvement" — an invented claim about a
// company nobody researched. These cases exercise the live wiring: the
// employer fetched via fetchPostingEmployer (already cached by
// answerContextCache — AC-V4/C8), the company-facts search
// (lib/copilot/companyFactsSource.js), corroboration
// (lib/llm/grounding.js + lib/meeting/referenceContract.js), the
// company-directed gate (lib/copilot/companyDirected.js) that decides
// whether THIS question waits for it, and factIds/factSources
// (lib/copilot/factCitations.js) end to end through the real route.
//
// Most tests below use their OWN applicationId. That started as a WORKAROUND
// rather than a choice: companyFactsCache was instantiated privately inside
// route.js, so unlike answerContextCache there was no handle to clear it
// with, and a unique key per test was the only way to stop one case's cached
// search result reaching the next. AC-V4.9 exported it beside its sibling
// (answerSessionCache.js's own header already argued for that placement) and
// `beforeEach` above now clears both, so the unique ids are belt-and-braces
// rather than the mechanism. The last case in this file is the one that
// depends on the clear, deliberately sharing an id with its neighbour.
//
// Distinguishes the company-facts SEARCH call (tools: googleSearch, no
// responseMimeType) from the points DRAFT call (responseMimeType: json) by
// `args.config.tools`, since the single fixed `mockGemini` helper above
// cannot tell two different generateContent calls in one request apart.
// AC-V4.8: `config.tools`, not `args.tools` — the SDK's own
// `GenerateContentParameters` has only `model`/`contents`/`config`, so
// `tools` at the top level never reaches the wire (see lib/copilot/
// companyFactsSource.wire.test.js). This discriminator has to read the
// position the module actually uses, or every request below takes the DRAFT
// branch for its facts search and these cases silently stop testing AC-V4. None of
// these requests set a posting `description`, so generateIdealProjectExample
// (lib/copilot/answerAids.js) always returns null without its own
// generateContent call — see that function's own "no posting to build a
// prompt from" contract — which is what keeps each request's call count to
// exactly the facts search plus the draft, no third call to account for.
function mockGeminiWithFacts({ draft, facts = [], groundedUris = [] }) {
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  const generateContent = vi.fn(async (args) => {
    if (args?.config?.tools) {
      return {
        // The same fenced-JSON-around-prose shape parseFactsResponse is
        // written to tolerate (googleSearch is incompatible with a JSON
        // response mime type).
        text: `Here is what I found.\n\`\`\`json\n${JSON.stringify({ facts })}\n\`\`\``,
        candidates: [{ groundingMetadata: { groundingChunks: groundedUris.map((uri) => ({ web: { uri } })) } }],
      };
    }
    return { text: JSON.stringify(draft) };
  });
  getGeminiClient.mockReturnValue({ models: { generateContent } });
}

function purpleWaveApplication(id) {
  return {
    id,
    resume_used_id: null,
    cover_letter_id: null,
    positions: { company: "Purple Wave", title: "Director of Platform Engineering" },
  };
}

const PURPLE_WAVE_FACT = {
  claim: "Purple Wave is an online marketplace for heavy equipment and farm machinery auctions.",
  url: "https://www.purplewave.com/about",
  kind: "what",
};

describe("POST /api/copilot/answer (AC-V4: verified company facts)", () => {
  it("a company-directed question waits for the search and cites the corroborated fact, never the raw URL", async () => {
    mockUserWithApplicationDocs({ application: purpleWaveApplication("app-purple-1") });
    mockGeminiWithFacts({
      draft: {
        points: ["Purple Wave runs online auctions for heavy equipment.", "A second point."],
        factIds: ["fact-0", null],
        type: "general",
      },
      facts: [PURPLE_WAVE_FACT],
      groundedUris: [PURPLE_WAVE_FACT.url],
    });
    const res = await POST(
      jsonRequest({ question: "What do you know about Purple Wave?", engine: "gemini", applicationId: "app-purple-1" }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.factSources).toEqual([
      { id: "fact-0", claim: PURPLE_WAVE_FACT.claim, url: PURPLE_WAVE_FACT.url },
      null,
    ]);

    const client = getGeminiClient();
    const draftCall = client.models.generateContent.mock.calls.find((c) => !c[0]?.config?.tools);
    const promptText = draftCall[0].contents[0].parts[0].text;
    expect(promptText).toContain("VERIFIED COMPANY FACTS");
    expect(promptText).toContain(PURPLE_WAVE_FACT.claim);
    expect(promptText).toContain("(fact id: fact-0)");
    // AC-V4.3: the URL never reaches the prompt — the candidate gets it
    // through resolveFactSources' whitelist, not the model's echo of it.
    expect(promptText).not.toContain(PURPLE_WAVE_FACT.url);
  });

  it("a question NOT about the employer answers immediately on the very first question of the session — no wait, honest no-facts instruction", async () => {
    mockUserWithApplicationDocs({ application: purpleWaveApplication("app-purple-2") });
    mockGeminiWithFacts({
      draft: { points: ["A generic point about teamwork."], type: "general" },
      // The search WOULD find this — but nothing here should wait for it.
      facts: [PURPLE_WAVE_FACT],
      groundedUris: [PURPLE_WAVE_FACT.url],
    });
    const res = await POST(
      jsonRequest({
        question: "Tell me about a time you handled a tight deadline.",
        engine: "gemini",
        applicationId: "app-purple-2",
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    // AC-V4.7: the employer IS known, but the search had no time to settle
    // on the first question of a session — the honest "no facts yet"
    // instruction, never a wait and never a placeholder fact.
    expect(data.factSources).toEqual([]);

    const client = getGeminiClient();
    const draftCall = client.models.generateContent.mock.calls.find((c) => !c[0]?.config?.tools);
    const promptText = draftCall[0].contents[0].parts[0].text;
    expect(promptText).not.toContain("VERIFIED COMPANY FACTS");
    expect(promptText).toMatch(/no verified facts about the employer/i);
  });

  it("no employer on file at all: no factSources key, and the facts search never runs", async () => {
    mockUser();
    mockGemini({ points: ["Point one.", "Point two."], type: "general" });
    const res = await POST(jsonRequest({ question: "What do you know about Purple Wave?", engine: "gemini" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).not.toHaveProperty("factSources");
    // Exactly one generateContent call — the draft. No facts search, no
    // ideal-project call (no posting description on this request).
    const client = getGeminiClient();
    expect(client.models.generateContent).toHaveBeenCalledTimes(1);
  });

  it("the embedded engine never triggers a company-facts search, even with an employer on file", async () => {
    mockUserWithApplicationDocs({ application: purpleWaveApplication("app-purple-3") });
    const res = await POST(
      jsonRequest({
        question: "What do you know about Purple Wave?",
        profile: PROFILE,
        engine: "embedded",
        applicationId: "app-purple-3",
      }),
    );
    expect(res.status).toBe(200);
    // This repo's established rule: engine choice governs every AI feature.
    // A company-facts SEARCH is itself a Gemini call with no deterministic
    // equivalent, so an embedded session must never trigger one.
    expect(getGeminiClient).not.toHaveBeenCalled();
  });

  it("practice ('answer') mode never triggers a company-facts search, even with an employer on file", async () => {
    mockUserWithApplicationDocs({ application: purpleWaveApplication("app-purple-4") });
    mockGemini({ points: ["A generic answer point."], type: "general" });
    const res = await POST(
      jsonRequest({
        question: "What do you know about Purple Wave?",
        mode: "answer",
        engine: "gemini",
        applicationId: "app-purple-4",
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    // V4.3's own scoping: buildAnswerPrompt is untouched, so there is
    // nowhere for a facts result to go on this path.
    expect(data).not.toHaveProperty("factSources");
    const client = getGeminiClient();
    expect(client.models.generateContent).toHaveBeenCalledTimes(1);
    const promptText = client.models.generateContent.mock.calls[0][0].contents[0].parts[0].text;
    expect(promptText).not.toContain("VERIFIED COMPANY FACTS");
  });

  it("a fact id the model was never shown resolves to null, not a trusted citation", async () => {
    mockUserWithApplicationDocs({ application: purpleWaveApplication("app-purple-5") });
    mockGeminiWithFacts({
      draft: { points: ["A point about Purple Wave."], factIds: ["fact-9-does-not-exist"], type: "general" },
      facts: [PURPLE_WAVE_FACT],
      groundedUris: [PURPLE_WAVE_FACT.url],
    });
    const res = await POST(
      jsonRequest({ question: "What do you know about Purple Wave?", engine: "gemini", applicationId: "app-purple-5" }),
    );
    const data = await res.json();
    expect(data.factSources).toEqual([null]);
  });

  // AC-V4.9, a PAIR — these two cases deliberately share one applicationId,
  // and therefore one companyFactsCache key, with different search results
  // mocked behind it. Nothing else in this file does that, because until
  // companyFactsCache was exported nothing COULD: the cache was private to
  // route.js, `beforeEach` had no handle to clear it, and the second of any
  // such pair would have been answered out of the first one's cached search.
  // Split in two rather than written as one `it` with two POSTs on purpose:
  // a single test would exercise the cache doing its job (which is correct
  // behaviour within one interview), not the isolation between tests, which
  // is the thing the export exists to make possible.
  it("caches a company's facts under its application id (AC-V4.9, first half)", async () => {
    mockUserWithApplicationDocs({ application: purpleWaveApplication("app-purple-shared") });
    mockGeminiWithFacts({
      draft: { points: ["A point about Purple Wave."], factIds: ["fact-0"], type: "general" },
      facts: [PURPLE_WAVE_FACT],
      groundedUris: [PURPLE_WAVE_FACT.url],
    });
    const res = await POST(
      jsonRequest({
        question: "What do you know about Purple Wave?",
        engine: "gemini",
        applicationId: "app-purple-shared",
      }),
    );
    const data = await res.json();
    expect(data.factSources).toEqual([
      { id: "fact-0", claim: PURPLE_WAVE_FACT.claim, url: PURPLE_WAVE_FACT.url },
    ]);
  });

  it("does not serve the previous test's cached search under the same application id (AC-V4.9, second half)", async () => {
    // Same key, a search that finds something completely different. Without
    // the `companyFactsCache.clear()` in `beforeEach` this returns the case
    // above's fact — a leak that looks exactly like the cache working.
    const OTHER_FACT = {
      claim: "Purple Wave was founded in Manhattan, Kansas.",
      url: "https://www.purplewave.com/history",
      kind: "history",
    };
    mockUserWithApplicationDocs({ application: purpleWaveApplication("app-purple-shared") });
    mockGeminiWithFacts({
      draft: { points: ["A point about Purple Wave."], factIds: ["fact-0"], type: "general" },
      facts: [OTHER_FACT],
      groundedUris: [OTHER_FACT.url],
    });
    const res = await POST(
      jsonRequest({
        question: "What do you know about Purple Wave?",
        engine: "gemini",
        applicationId: "app-purple-shared",
      }),
    );
    const data = await res.json();
    expect(data.factSources).toEqual([{ id: "fact-0", claim: OTHER_FACT.claim, url: OTHER_FACT.url }]);
  });

  it("a claim the search returns but never corroborates is dropped, and never reaches the prompt", async () => {
    mockUserWithApplicationDocs({ application: purpleWaveApplication("app-purple-6") });
    mockGeminiWithFacts({
      draft: { points: ["A point."], type: "general" },
      // The claim's own url points at a page the search never grounded on.
      facts: [{ claim: "An invented claim nobody actually checked.", url: "https://invented.test/page", kind: "what" }],
      groundedUris: ["https://www.purplewave.com/about"],
    });
    const res = await POST(
      jsonRequest({ question: "What do you know about Purple Wave?", engine: "gemini", applicationId: "app-purple-6" }),
    );
    const data = await res.json();
    expect(data.factSources).toEqual([]);
    const client = getGeminiClient();
    const draftCall = client.models.generateContent.mock.calls.find((c) => !c[0]?.config?.tools);
    const promptText = draftCall[0].contents[0].parts[0].text;
    expect(promptText).not.toContain("An invented claim nobody actually checked.");
    expect(promptText).toMatch(/no verified facts about the employer/i);
  });
});
