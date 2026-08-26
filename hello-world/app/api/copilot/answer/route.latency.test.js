import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/copilot/applicationDocs", () => ({
  fetchApplicationDocs: vi.fn(),
  fetchPostingDescription: vi.fn(),
  fetchPostingEmployer: vi.fn(),
}));
vi.mock("@/lib/supabase/experiencePages", () => ({ listPages: vi.fn() }));
vi.mock("@/lib/supabase/experienceAttachments", () => ({ listAttachmentsByPage: vi.fn() }));
// AC-V4.6: buildCompanyFacts' corroboration step reaches the real network
// through lib/scrape/fetchUrlContent.js (15s timeout on a real miss). Mocked
// to an identity fetch so the facts cases at the bottom of this file resolve
// deterministically, with no request ever leaving the process.
vi.mock("@/lib/scrape/fetchUrlContent", () => ({ fetchUrlContent: vi.fn(async (url) => ({ finalUrl: url })) }));

import { POST } from "./route.js";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { createClient } from "@/lib/supabase/server";
import {
  fetchApplicationDocs,
  fetchPostingDescription,
  fetchPostingEmployer,
} from "@/lib/copilot/applicationDocs";
import { listPages } from "@/lib/supabase/experiencePages";
import { listAttachmentsByPage } from "@/lib/supabase/experienceAttachments";
// The very thing under test in "the per-question data fan-out runs once per
// session" is this cache (lib/copilot/answerSessionCache.js) reusing its
// entry ACROSS the two POST calls inside one `it()` block. It must NOT reuse
// an entry ACROSS `it()` blocks, though — several cases below share the
// same synthetic userId/applicationId on purpose, and each expects its own
// fresh fetch count, so the cache is cleared in `beforeEach`.
import { answerContextCache, companyFactsCache } from "@/lib/copilot/answerSessionCache";

// AC-V5.1 / AC-V5.2 / AC-V5.3. What the candidate actually waits on, measured
// from the session the user recorded on 2026-08-25: 4-10 seconds from a
// detected question to a drafted answer, with three contributors in front of
// the first token.
//
// 1. Gemini 2.5 Flash defaults to DYNAMIC THINKING. The route never passes a
//    thinkingConfig, so every live answer burns thinking time before it emits
//    anything — and because the response is streamed JSON, that is time the
//    candidate spends looking at an empty card. Verified against Google's own
//    documentation for the Generate Content API this route calls:
//    config.thinkingConfig.thinkingBudget, range 0-24576 for this model, 0
//    documented as turning thinking off and reducing latency.
//    (The newer Interactions API's `thinking_level` is a DIFFERENT API with no
//    "off" for this model. This route calls models.generateContent(Stream),
//    so thinkingBudget is the correct field. Do not swap it.)
// 2. Four Supabase queries plus an auth round trip on EVERY question, for data
//    that does not change during an interview.
// 3. Two model calls per spoken question, because every final transcript
//    arrived twice (AC-V1).
//
// These cases pin 1 and 2. 3 is pinned at the provider layer, in
// lib/copilot/stt/elevenlabs.commitPair.test.js.

// Every request below names the engine explicitly. `wantsEmbedded` reads
// process.env directly — not the mocked getServerEnv — so a request that omits
// `engine` takes the embedded, no-model branch on any machine without a Gemini
// key, and these cases would then pass or fail by accident of whose .env.local
// was present. streaming.test.js documents the same trap.
function jsonRequest(body) {
  return { json: async () => ({ engine: "gemini", ...body }) };
}

const POINTS_DOC = JSON.stringify({
  points: ["Led the migration.", "Cut p95 latency by half."],
  type: "behavioral",
});

function chunkStream(chunks) {
  return (async function* () {
    for (const text of chunks) yield { text };
  })();
}

let generateContentStream;
let generateContent;

function mockUser(id = "user-1") {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id } } }) },
    from: vi.fn(() => {
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      };
      return chain;
    }),
  });
}

async function drain(res) {
  const reader = res.body.getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  answerContextCache.clear();
  // AC-V4.9: the route's second module-scope cache. Exported alongside its
  // sibling so a test file can empty it, instead of every case having to mint
  // a unique applicationId to route around a cache it had no handle on.
  companyFactsCache.clear();
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash", geminiApiKey: "k" });
  generateContentStream = vi.fn(async () => chunkStream([POINTS_DOC]));
  generateContent = vi.fn(async () => ({ text: "{}" }));
  getGeminiClient.mockReturnValue({ models: { generateContentStream, generateContent } });
  mockUser();
  fetchApplicationDocs.mockResolvedValue({ resume: "", coverLetter: "" });
  fetchPostingDescription.mockResolvedValue("");
  // No employer by default, so every case above this file's AC-V4.6 band
  // takes the "no company known" path and never builds facts at all.
  fetchPostingEmployer.mockResolvedValue(null);
  listPages.mockResolvedValue({ pages: [] });
  listAttachmentsByPage.mockResolvedValue({ byPageId: new Map() });
});

describe("the live points call does not wait on thinking (AC-V5.1)", () => {
  it("passes thinkingBudget 0 on the streaming points call", async () => {
    const res = await POST(
      jsonRequest({ question: "Tell me about a migration you led.", stream: true }),
    );
    await drain(res);

    expect(generateContentStream).toHaveBeenCalledTimes(1);
    const config = generateContentStream.mock.calls[0][0].config;
    expect(config.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  it("keeps the rest of the streaming call's config exactly as it was", async () => {
    // A latency change must not quietly become a behaviour change. The system
    // instruction and the JSON response mode are what make the streamed
    // partial-JSON parsing work at all; losing either would show up as an
    // answer that never renders, several layers from this file.
    const res = await POST(jsonRequest({ question: "Why do you want this role?", stream: true }));
    await drain(res);

    const config = generateContentStream.mock.calls[0][0].config;
    expect(config.responseMimeType).toBe("application/json");
    expect(typeof config.systemInstruction).toBe("string");
    expect(config.systemInstruction.length).toBeGreaterThan(0);
  });
});

describe("the per-question data fan-out runs once per session (AC-V5.2)", () => {
  it("does not re-query Supabase for a second question from the same user and application", async () => {
    // Two questions, same user, same posting. The résumé, the cover letter,
    // the posting description and the project pages cannot have changed
    // between them, and re-fetching all four is time the candidate spends
    // waiting mid-interview.
    for (const question of ["Tell me about a migration you led.", "What was the hardest part?"]) {
      const res = await POST(jsonRequest({ question, applicationId: "app-1", stream: true }));
      await drain(res);
    }

    expect(fetchApplicationDocs).toHaveBeenCalledTimes(1);
    expect(fetchPostingDescription).toHaveBeenCalledTimes(1);
    expect(listPages).toHaveBeenCalledTimes(1);
    expect(listAttachmentsByPage).toHaveBeenCalledTimes(1);
    // Both questions still got answered — a cache that achieves its count by
    // dropping the second request is not a cache.
    expect(generateContentStream).toHaveBeenCalledTimes(2);
  });

  it("still ranks the knowledge base against THIS question, not the cached one", async () => {
    // The single most likely way to get V5.2 wrong: caching the derived
    // knowledge-base block alongside the raw rows. buildKnowledgeBaseBlock
    // ranks pages against the question, so a cached block answers question two
    // with question one's page selection — an answer built from the wrong
    // project, with every test green.
    listPages.mockResolvedValue({
      pages: [
        {
          id: "p1",
          title: "Kafka consumer rebalance",
          source: "Professional Experience",
          body: "We tuned the Kafka consumer group rebalance protocol and cut lag.",
        },
        {
          id: "p2",
          title: "Payments ledger migration",
          source: "Professional Experience",
          body: "We migrated the payments ledger to Postgres with zero downtime.",
        },
      ],
    });

    const asked = [];
    generateContentStream.mockImplementation(async (args) => {
      asked.push(args.contents[0].parts[0].text);
      return chunkStream([POINTS_DOC]);
    });

    for (const question of [
      "Tell me about the Kafka consumer rebalance work.",
      "Tell me about the payments ledger migration.",
    ]) {
      const res = await POST(jsonRequest({ question, applicationId: "app-1", stream: true }));
      await drain(res);
    }

    expect(asked).toHaveLength(2);
    // Both pages fit in the budget, so both appear in both prompts — asserting
    // mere presence would pass against a cached, question-blind block. What
    // ranking actually decides is ORDER, so that is what is asserted: the page
    // the question is about is the FIRST heading in that question's block.
    const firstPage = (prompt) => (prompt.match(/^## (.+?) \(page id:/m) || [])[1];
    expect(firstPage(asked[0])).toBe("Kafka consumer rebalance");
    expect(firstPage(asked[1])).toBe("Payments ledger migration");
  });

  it("never serves one user's fetched documents to another", async () => {
    // The cache key carries the user id and is computed only after auth
    // resolves. Asserted directly because a cross-user hit looks exactly like
    // a cache working correctly.
    mockUser("user-1");
    await drain(await POST(jsonRequest({ question: "Q1?", applicationId: "app-1", stream: true })));
    mockUser("user-2");
    await drain(await POST(jsonRequest({ question: "Q1?", applicationId: "app-1", stream: true })));

    expect(fetchApplicationDocs).toHaveBeenCalledTimes(2);
    const userIds = fetchApplicationDocs.mock.calls.map((call) => call[1].userId);
    expect(userIds).toEqual(["user-1", "user-2"]);
  });
});

// AC-V4.6 / AC-V5.4. The facts deadline is 2.5 SECONDS — an order of
// magnitude more than the thinking prelude AC-V5.1 removes, on the same
// request. It used to be awaited in POST, ahead of the `stream === true`
// branch, so it was a hard ceiling on the WHOLE response including the very
// first streamed bullet. And it lands on exactly the question class this
// group was asked to speed up: in the session the user recorded, question ONE
// is company-directed, so it is the first question of the session that pays
// the full deadline, against a guaranteed-empty cache.
//
// AC-V5.4 said to report any case that got slower. This was that case, and
// nothing measured it — which is why the first case below asserts ORDERING
// and not elapsed time.
describe("the company-facts deadline does not delay the stream (AC-V4.6/AC-V5.4)", () => {
  const EMPLOYER = { company: "Purple Wave", title: "Director of Platform Engineering" };
  const FACT = {
    claim: "Purple Wave is an online marketplace for heavy equipment auctions.",
    url: "https://www.purplewave.com/about",
    kind: "what",
  };

  // A facts search that settles only when the test says so. `generateContent`
  // is the facts call on this path (the DRAFT goes through
  // generateContentStream), distinguished by `config.tools` — the position
  // the SDK actually transmits, see companyFactsSource.wire.test.js.
  function gateTheFactsSearch() {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    generateContent = vi.fn((args) => (args?.config?.tools ? gate : Promise.resolve({ text: "{}" })));
    getGeminiClient.mockReturnValue({ models: { generateContentStream, generateContent } });
    return { release };
  }

  // One macrotask turn. This is an ORDERING assertion, not a stopwatch: Node
  // drains every pending microtask before it runs any timer callback, and a
  // 0ms timer is always ahead of settleWithin's 2500ms one in the timer
  // queue. So if POST has not resolved by the time this does, it is because
  // it is structurally behind the deadline — never because the machine was
  // slow. Every await POST makes on the way here (req.json, the Supabase
  // mocks, the context cache) settles in microtasks, so a correct route is
  // always finished by this point, on any machine.
  function afterMicrotasksDrain() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  it("returns the streaming response before the facts search has settled", async () => {
    fetchPostingEmployer.mockResolvedValue(EMPLOYER);
    const { release } = gateTheFactsSearch();

    const posted = POST(
      jsonRequest({
        // Company-directed, so this is the one question class that WAITS for
        // the search. A question that never waits could not fail this case.
        question: "What do you know about Purple Wave?",
        applicationId: "app-facts-1",
        stream: true,
      }),
    );
    let responded = false;
    posted.then(() => {
      responded = true;
    });

    await afterMicrotasksDrain();
    expect(responded).toBe(true);

    release({ text: "{}", candidates: [] });
    await drain(await posted);
    expect(generateContentStream).toHaveBeenCalledTimes(1);
  });

  it("still puts the verified facts in the prompt once the search settles", async () => {
    // The positive control, and the half that makes the case above mean
    // something: opening the connection early must not cost the facts. If the
    // deadline moved into the producer but the prompt was still built ahead
    // of it, this passes on latency while silently dropping the whole AC-V4
    // feature from the streaming path — the mode a live candidate uses.
    fetchPostingEmployer.mockResolvedValue(EMPLOYER);
    const factsDoc = ["Here is what I found.", "```json", JSON.stringify({ facts: [FACT] }), "```"].join("\n");
    generateContent = vi.fn(async (args) => {
      if (args?.config?.tools) {
        return {
          text: factsDoc,
          candidates: [{ groundingMetadata: { groundingChunks: [{ web: { uri: FACT.url } }] } }],
        };
      }
      return { text: "{}" };
    });
    getGeminiClient.mockReturnValue({ models: { generateContentStream, generateContent } });

    const res = await POST(
      jsonRequest({
        question: "What do you know about Purple Wave?",
        applicationId: "app-facts-2",
        stream: true,
      }),
    );
    await drain(res);

    const promptText = generateContentStream.mock.calls[0][0].contents[0].parts[0].text;
    expect(promptText).toContain("VERIFIED COMPANY FACTS");
    expect(promptText).toContain(FACT.claim);
    // AC-V4.3: the URL never reaches the prompt — the candidate gets it back
    // through resolveFactSources' whitelist, not the model's echo of it.
    expect(promptText).not.toContain(FACT.url);
  });

  it("answers a question that is not about the employer without any facts wait at all", async () => {
    // The other half of AC-V4.6: only a company-DIRECTED question waits. This
    // one reads whatever the cache already has (nothing, on the first
    // question of a session) and never touches the deadline — so a search
    // gated open forever must not reach the response at all.
    fetchPostingEmployer.mockResolvedValue(EMPLOYER);
    gateTheFactsSearch();

    const res = await POST(
      jsonRequest({
        question: "Tell me about a time you handled a tight deadline.",
        applicationId: "app-facts-3",
        stream: true,
      }),
    );
    await drain(res);

    const promptText = generateContentStream.mock.calls[0][0].contents[0].parts[0].text;
    expect(promptText).not.toContain("VERIFIED COMPANY FACTS");
    expect(promptText).toMatch(/no verified facts about the employer/i);
  });
});
