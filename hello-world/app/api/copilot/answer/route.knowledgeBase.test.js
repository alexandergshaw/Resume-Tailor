// Route-level contract for the knowledge base as answer material: which of
// the candidate's own project pages reach the prompt, in what order, with
// what framing, and what the response is allowed to claim about where each
// point came from.
//
// A SECOND file rather than more cases in route.test.js, which is already at
// ~892 lines against this repo's 1000-line ceiling.
//
// Written from the acceptance criteria BEFORE the wiring existed. Two traps
// R-143 recorded apply to everything here and are worth restating, because
// getting either wrong makes every case fail for the wrong reason:
//   - a request must carry `engine: "gemini"`, or `wantsEmbedded` defaults to
//     the no-LLM path and the code under test is never reached;
//   - `mockGemini` answers EVERY generateContent call with one canned
//     payload, so a case that also selects a posting gets a second
//     (ideal-project) call it did not ask for. Every Gemini case below
//     deliberately selects NO posting, which is what keeps
//     `generateContent.mock.calls[0]` the answer call.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { POST } from "./route.js";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { createClient } from "@/lib/supabase/server";
import { splitFrames } from "@/lib/copilot/answerStream";

const read = (rel) => readFileSync(path.join(process.cwd(), rel), "utf8");

function jsonRequest(body) {
  return { json: async () => body };
}

// Answers listPages against `experience_pages` AND listAttachmentsByPage
// against `experience_attachments`. The two are told apart by table name
// rather than by which chain links were called, because both end in
// `.order(...)` and a helper that guessed from the chain would silently serve
// one table's rows for the other.
function mockKnowledgeBase({ id = "user-1", pages = [], attachments = [], resume = null } = {}) {
  const from = vi.fn((table) => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      is: vi.fn(() => chain),
      order: vi.fn(async () => {
        if (table === "experience_pages") return { data: pages, error: null };
        if (table === "experience_attachments") return { data: attachments, error: null };
        return { data: null, error: null };
      }),
      // `resume` is opt-in so every existing case here keeps running with no
      // submitted documents at all. It exists for the one case that has to
      // compare the POSITION of the pages block against the résumé block —
      // without a résumé on file there is no second block to compare with, and
      // that assertion would pass against any ordering whatsoever.
      maybeSingle: vi.fn(async () => {
        if (table === "applications") {
          return { data: resume ? { resume_used_id: "res-1", cover_letter_id: null } : null, error: null };
        }
        if (table === "generated_resumes") {
          return { data: resume ? { content: resume } : null, error: null };
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
  return from;
}

function mockGemini(payload) {
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  const generateContent = vi.fn().mockResolvedValue({ text: JSON.stringify(payload) });
  getGeminiClient.mockReturnValue({ models: { generateContent } });
  return generateContent;
}

const answerPrompt = (generateContent) => generateContent.mock.calls[0][0].contents[0].parts[0].text;

function page(id, title, body, extra = {}) {
  return { id, title, body, position: 0, archived_at: null, generated_kind: null, ...extra };
}

// The titles of the project pages the prompt actually carried, in prompt
// order. Reading the ORDER out of the prompt is the point: several cases
// below turn entirely on which page came first, and an assertion built on
// two `indexOf` calls is satisfied by -1 when a heading is missing
// altogether — the degenerate comparison this repo has been bitten by before.
function pageTitlesInPrompt(promptText) {
  return [...promptText.matchAll(/^## (.+?) \(page id: /gm)].map((m) => m[1]);
}

const GEMINI_PAYLOAD = {
  points: ["I led the ledger work.", "It cut p99 by 40 percent."],
  cues: ["The ledger", "The result"],
  type: "behavioral",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("which pages reach the prompt (AC-1)", () => {
  it("sends the page that matches the question, not the top of the sidebar (AC-1.3)", () => {
    // THE DEFECT THIS WHOLE CHANGE EXISTS FOR, at the route level. listPages
    // orders by `position`, and the block builder this replaces took pages in
    // that order until 6000 characters ran out — so the same pages went to
    // the model for every question ever asked.
    const filler = Array.from({ length: 10 }, (_, i) =>
      page(`filler-${i}`, `Filler ${i}`, `Unrelated notes about scheduling ${"q".repeat(900)}`, { position: i }),
    );
    const target = page("target", "Ledger sharding", "Sharded the ledger by tenant and cut p99 by 40 percent", {
      position: 10,
    });
    mockKnowledgeBase({ pages: [...filler, target] });
    const generateContent = mockGemini(GEMINI_PAYLOAD);

    return POST(
      jsonRequest({
        question: "Tell me about a time you sharded a ledger by tenant.",
        mode: "answer",
        engine: "gemini",
      }),
    ).then(() => {
      const titles = pageTitlesInPrompt(answerPrompt(generateContent));
      expect(titles).toContain("Ledger sharding");
      expect(titles[0]).toBe("Ledger sharding");
    });
  });

  it("ranks against the conversation with its speaker labels STRIPPED (AC-1.5)", async () => {
    // THE ONE DEFECT THE ARCHITECTURE SAYS NOTHING ELSE WILL CATCH. The live
    // transcript arrives labelled — "Them: ...". significantTerms tokenises
    // /[a-z0-9]{4,}/, so "them" clears the bar, appears once per interviewer
    // turn, and becomes the most frequent token in the whole ranking query.
    // Left unstripped it promotes a page whose only overlap with the
    // interview is a label this app itself wrote.
    //
    // A poisoned ranking still returns pages — just the wrong ones — so
    // nothing fails loudly. Only an ordering assertion catches it.
    const decoy = page("decoy", "Working with them", `Notes about them and them and them ${"them ".repeat(60)}`, {
      position: 0,
    });
    const real = page("real", "Ledger sharding", "Sharded the ledger by tenant and cut p99", { position: 1 });
    mockKnowledgeBase({ pages: [decoy, real] });
    const generateContent = mockGemini(GEMINI_PAYLOAD);

    await POST(
      jsonRequest({
        question: "How did you shard the ledger?",
        context: "Them: so walk me through it\nThem: go on\nThem: and then what happened",
        engine: "gemini",
      }),
    );

    const titles = pageTitlesInPrompt(answerPrompt(generateContent));
    // Both are present, so the comparison below is a real ordering claim and
    // not a missing heading passing by accident.
    expect(titles).toEqual(expect.arrayContaining(["Ledger sharding", "Working with them"]));
    expect(titles[0]).toBe("Ledger sharding");
  });

  it("still shows the model the conversation WITH its labels", async () => {
    // Stripping is for the ranking query only: who said what is real
    // information to a reader, and the prompt's own "Recent conversation"
    // block must keep it.
    mockKnowledgeBase({ pages: [page("p1", "Ledger sharding", "sharded the ledger")] });
    const generateContent = mockGemini(GEMINI_PAYLOAD);

    await POST(
      jsonRequest({ question: "How did you shard the ledger?", context: "Them: walk me through it", engine: "gemini" }),
    );
    expect(answerPrompt(generateContent)).toContain("Them: walk me through it");
  });
});

describe("how much of the knowledge base fits (AC-2)", () => {
  it("carries far more than the 6000 characters the old block was capped at (AC-2.1)", async () => {
    const body = [
      "## Overview",
      "The payments settlement work, end to end.",
      ...Array.from({ length: 30 }, (_, i) => `- Ledger sharding note number ${i} about tenants and p99`),
    ].join("\n");
    const pages = Array.from({ length: 12 }, (_, i) => page(`p${i}`, `Project ${i}`, body, { position: i }));
    mockKnowledgeBase({ pages });
    const generateContent = mockGemini(GEMINI_PAYLOAD);

    await POST(jsonRequest({ question: "Tell me about sharding a ledger.", mode: "answer", engine: "gemini" }));

    const promptText = answerPrompt(generateContent);
    const titles = pageTitlesInPrompt(promptText);
    // The old cap admitted roughly three of these pages. The point of the
    // new budget is that a real knowledge base is not mostly invisible.
    expect(titles.length).toBeGreaterThan(5);
    expect(promptText.length).toBeGreaterThan(8000);
  });
});

describe("how the knowledge base is framed (AC-3)", () => {
  const withPage = () => mockKnowledgeBase({ pages: [page("p1", "Ledger sharding", "Sharded the ledger by tenant")] });

  it("puts the candidate's own pages ahead of the submitted resume (AC-3.1)", async () => {
    withPage();
    const generateContent = mockGemini(GEMINI_PAYLOAD);
    await POST(jsonRequest({ question: "Tell me about a hard project.", mode: "answer", engine: "gemini" }));

    const promptText = answerPrompt(generateContent);
    const pagesAt = promptText.indexOf("YOUR OWN PROJECT PAGES");
    const authorityAt = promptText.indexOf("Every claim must come from");
    expect(pagesAt).toBeGreaterThan(-1);
    expect(authorityAt).toBeGreaterThan(-1);
    // Named FIRST in the authority sentence, not last. A model handed a
    // résumé and a project page reaches for the résumé otherwise: it is
    // shorter and already answer-shaped, which is exactly the generic answer
    // this work exists to fix.
    expect(promptText.slice(authorityAt)).toMatch(
      /Every claim must come from the YOUR OWN PROJECT PAGES, CANDIDATE PREP NOTES, SUBMITTED RESUME, or SUBMITTED COVER LETTER/,
    );
  });

  it("tells the model to prefer a page's specific detail over a generic line, and to name the project (AC-3.2)", async () => {
    withPage();
    const generateContent = mockGemini(GEMINI_PAYLOAD);
    await POST(jsonRequest({ question: "Tell me about a hard project.", mode: "answer", engine: "gemini" }));

    const promptText = answerPrompt(generateContent).toLowerCase();
    expect(promptText).toContain("project page");
    expect(promptText).toContain("name the project");
  });

  it("does not weaken the rule against inventing detail (AC-3.3)", async () => {
    withPage();
    const generateContent = mockGemini(GEMINI_PAYLOAD);
    await POST(jsonRequest({ question: "Tell me about a hard project.", mode: "answer", engine: "gemini" }));

    const promptText = answerPrompt(generateContent);
    expect(promptText).toContain("never invent an employer, project, metric, or credential that isn't there");
    expect(promptText).toContain("give a shorter, honest answer rather than inventing detail");
  });

  it("says nothing at all about project pages when there are none (AC-3.4)", async () => {
    mockKnowledgeBase({ pages: [] });
    const generateContent = mockGemini(GEMINI_PAYLOAD);
    await POST(jsonRequest({ question: "Tell me about a hard project.", mode: "answer", engine: "gemini" }));

    const promptText = answerPrompt(generateContent);
    expect(promptText).not.toContain("PROJECT PAGES");
    expect(promptText).not.toContain("page id:");
    // The pinned no-pages authority sentence, unchanged.
    expect(promptText).toContain(
      "Every claim must come from the CANDIDATE PREP NOTES, SUBMITTED RESUME, or SUBMITTED COVER LETTER",
    );
  });
});

describe("attachments as material (AC-4)", () => {
  it("fetches the inventory alongside the pages and lists it, without ever sending bytes", async () => {
    mockKnowledgeBase({
      pages: [page("p1", "Ledger sharding", "Sharded the ledger by tenant")],
      attachments: [
        {
          id: "a1",
          page_id: "p1",
          name: "ledger-design.pdf",
          mime: "application/pdf",
          notes: "sharded by tenant, p99 down 40 percent",
          transcript: "",
          storage_path: "user-1/experience/p1/a1-ledger-design.pdf",
        },
      ],
    });
    const generateContent = mockGemini(GEMINI_PAYLOAD);
    await POST(jsonRequest({ question: "Tell me about the ledger work.", mode: "answer", engine: "gemini" }));

    const promptText = answerPrompt(generateContent);
    expect(promptText).toContain("ledger-design.pdf");
    expect(promptText).toContain("sharded by tenant, p99 down 40 percent");
    // The blanket honesty sentence. formatAttachment deliberately says
    // NOTHING for a PDF, because in the Ask AI flow those bytes really are
    // attached to the same request. Here they never are, and silence would
    // read as "the model opened it".
    expect(promptText.toLowerCase()).toContain("no attachment file contents were read");
    // The enforcement point: a storage path must never reach a prompt.
    expect(promptText).not.toContain("user-1/experience/p1/a1-ledger-design.pdf");
  });

  it("reads the pages and the attachment inventory in ONE query each (AC-4.1)", async () => {
    const from = mockKnowledgeBase({
      pages: [page("p1", "A", "x"), page("p2", "B", "y"), page("p3", "C", "z")],
      attachments: [],
    });
    mockGemini(GEMINI_PAYLOAD);
    await POST(jsonRequest({ question: "Tell me about a project.", mode: "answer", engine: "gemini" }));

    const tables = from.mock.calls.map((c) => c[0]);
    // Never one round trip per page — this runs while the candidate is
    // mid-question, and the meeting copilot already learned this the
    // expensive way.
    expect(tables.filter((t) => t === "experience_attachments")).toHaveLength(1);
    expect(tables.filter((t) => t === "experience_pages")).toHaveLength(1);
  });

  it("leaves no private copy of withDerivedKind behind in the meeting route (AC-4.4)", () => {
    // Source text, deliberately: the property IS the shape of the source.
    // `kind` is not a column, and two copies of the derivation are how the
    // label the model is shown drifts from the one the user sees.
    const insights = read("app/api/meeting/insights/route.js");
    expect(insights).not.toMatch(/function\s+withDerivedKind\s*\(/);
    expect(insights).toMatch(/import\s*\{[^}]*withDerivedKind[^}]*\}\s*from\s*["'][^"']*attachments/);
    const answerRoute = read("app/api/copilot/answer/route.js");
    expect(answerRoute).not.toMatch(/function\s+withDerivedKind\s*\(/);
  });

  it("still answers when the attachment table fails (AC-4.5)", async () => {
    createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: vi.fn((table) => {
        const chain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          is: vi.fn(() => chain),
          order: vi.fn(async () =>
            table === "experience_attachments"
              ? { data: null, error: { message: "boom" } }
              : { data: [page("p1", "Ledger sharding", "Sharded the ledger by tenant")], error: null },
          ),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        };
        return chain;
      }),
    });
    const generateContent = mockGemini(GEMINI_PAYLOAD);
    const res = await POST(jsonRequest({ question: "Tell me about the ledger.", mode: "answer", engine: "gemini" }));

    expect(res.status).toBe(200);
    expect(answerPrompt(generateContent)).toContain("Ledger sharding");
  });
});

describe("what the answer says it was built from (AC-6)", () => {
  it("reports the page behind each point, and drops an id it was never shown", async () => {
    mockKnowledgeBase({ pages: [page("p1", "Ledger sharding", "Sharded the ledger by tenant and cut p99")] });
    mockGemini({ ...GEMINI_PAYLOAD, pageIds: ["p1", "a-page-that-does-not-exist"] });

    const res = await POST(
      jsonRequest({ question: "Tell me about the ledger work.", mode: "answer", engine: "gemini" }),
    );
    const data = await res.json();

    // A citation the model invented must never reach a candidate about to
    // read it out loud in an interview.
    expect(data.pageSources).toEqual([{ id: "p1", title: "Ledger sharding" }, null]);
  });

  it("reports no page sources at all when no page reached the draft", async () => {
    mockKnowledgeBase({ pages: [] });
    mockGemini({ ...GEMINI_PAYLOAD, pageIds: ["p1", "p2"] });

    const res = await POST(jsonRequest({ question: "Tell me about yourself.", mode: "answer", engine: "gemini" }));
    const data = await res.json();
    // [] rather than [null, null]: downstream pairing is all-or-nothing on
    // length, so [] is what makes the surface render nothing at all.
    expect(data.pageSources).toEqual([]);
  });

  it("reports the page it used on the embedded engine too, without a whitelist", async () => {
    // The deterministic path's citation is true by construction — it quotes a
    // bullet verbatim out of a page it read itself.
    mockKnowledgeBase({
      pages: [
        page(
          "p1",
          "Payments migration",
          "- Cut settlement time from three days to one\n- Mentored two junior engineers on the rollout",
        ),
      ],
    });
    // The question NAMES this page's own subject. It used to read "Tell me
    // about a time you led a project.", whose ENTIRE overlap with the page
    // was the word "time" — which the page carries only because it says
    // "settlement time". selectBestStory's honesty gate now refuses that, and
    // correctly: an answer citing "Payments migration" for a question about
    // any project at all is a citation the candidate would read aloud on the
    // strength of a coincidence. The INPUT changed; every assertion below is
    // untouched, and still tests what this case was written to test.
    const res = await POST(
      jsonRequest({
        question: "Tell me about a time you led the settlement migration.",
        mode: "answer",
        engine: "embedded",
      }),
    );
    const data = await res.json();

    expect(data.pageSources.filter(Boolean).length).toBeGreaterThan(0);
    for (const source of data.pageSources.filter(Boolean)) {
      expect(source).toEqual({ id: "p1", title: "Payments migration" });
    }
  });
});

describe("the embedded engine's knowledge-base grounding (AC-5)", () => {
  it("clamps the answer it builds from a page, like every other producer (AC-5.4)", async () => {
    // THE FIXTURE IS THE TEST, twice over — both halves are INPUT changes; the
    // assertion below is untouched.
    //
    // The question used to be "Tell me about a time you led a project.",
    // whose only overlap with any page here is interview scaffolding. Its two
    // siblings in this file were rewritten when selectBestStory's honesty gate
    // landed and this one was missed, so it ran with `matched: false`: the
    // page was discarded and the assertion measured a generic answer that no
    // page ever touched. It now asks what its siblings ask.
    //
    // The BODY used to be 40 short bullets. Only `bullets[0]` and one Result
    // bullet are ever spoken (starPointsFromStory), so that draft came to ~972
    // characters and could not have reached 6000 however many bullets were
    // added — the case could not fail. ONE bullet longer than the cap is what
    // actually puts the clamp on the path being asserted.
    const huge = `- Cut settlement time from three days to one during the migration ${"and then kept tuning the batch window ".repeat(200)}`;
    expect(huge.length).toBeGreaterThan(6000);
    mockKnowledgeBase({ pages: [page("p1", "Payments migration", huge)] });

    const res = await POST(
      jsonRequest({
        question: "Tell me about a time you led the settlement migration.",
        mode: "answer",
        engine: "embedded",
      }),
    );
    const data = await res.json();
    expect(data.answer.length).toBeLessThanOrEqual(6000);
  });

  it("never speaks a page that does not match the question as though it were chosen (AC-5.2)", async () => {
    // `matched: false` means the page was the first eligible one on file, not
    // the one this question is about. Presenting it as a story is the
    // deterministic engine's version of inventing relevance.
    //
    // THE FIXTURE IS THE TEST. An earlier version of this case asked about "a
    // distributed payments ledger" against a beekeeping page, and passed —
    // by luck. Those two strings happen to share no four-character token, so
    // the case never exercised the gate at all; it only proved that two
    // unrelated sentences are unrelated.
    //
    // The question below is a REAL behavioural question, and it shares "time"
    // and "with" with the page. That is the common case, not a contrived one:
    // `matched` is bare set-overlap on /[a-z0-9]{4,}/, and ordinary interview
    // phrasing ("tell me about a time when you had to work with...") clears a
    // four-character floor against almost any prose page a person has written.
    // A gate that is near-always open is not a gate.
    mockKnowledgeBase({
      pages: [
        page(
          "p1",
          "Beekeeping club minutes",
          "- We spent time each spring checking the hives with the club members\n- Notes from the meeting about honey extraction",
        ),
      ],
    });
    const res = await POST(
      jsonRequest({
        question: "Tell me about a time you disagreed with your manager.",
        mode: "answer",
        engine: "embedded",
      }),
    );
    const data = await res.json();
    expect(data.points.join(" ")).not.toContain("checking the hives");
    expect(data.points.join(" ")).not.toContain("Beekeeping club minutes");
    expect(data.pageSources.filter(Boolean)).toEqual([]);
  });
});

describe("what still must never reach the prompt (AC-7)", () => {
  it("keeps the job posting out of the answer prompt, pages or no pages (AC-7.1)", async () => {
    mockKnowledgeBase({ pages: [page("p1", "Ledger sharding", "Sharded the ledger by tenant")] });
    const generateContent = mockGemini(GEMINI_PAYLOAD);
    await POST(jsonRequest({ question: "Tell me about the ledger.", mode: "answer", engine: "gemini" }));

    expect(answerPrompt(generateContent)).not.toContain("--- JOB POSTING");
  });

  it("still ignores resume and cover letter text sent on the wire (AC-7.2)", async () => {
    mockKnowledgeBase({ pages: [page("p1", "Ledger sharding", "Sharded the ledger by tenant")] });
    const generateContent = mockGemini(GEMINI_PAYLOAD);
    await POST(
      jsonRequest({
        question: "Tell me about the ledger.",
        mode: "answer",
        engine: "gemini",
        resume: "INJECTED RESUME TEXT",
        coverLetter: "INJECTED COVER LETTER TEXT",
      }),
    );

    const promptText = answerPrompt(generateContent);
    expect(promptText).not.toContain("INJECTED RESUME TEXT");
    expect(promptText).not.toContain("INJECTED COVER LETTER TEXT");
  });
});

// LIVE mode is POINTS mode: useDraftAnswer.js sends no `mode`, and the route
// coerces anything that is not the literal "answer" to "points". So every
// case above that omits `mode` already covers the live prompt — but the
// RESPONSE is a separate question, and it is the half the original report
// named first ("the sample answers and live interview answers...").
//
// The exact-key-set assertions in route.test.js are what make this worth its
// own block. Their own comment states the property they protect: "points mode
// gained the reading aids, and nothing else — `answer` and `grounding` are
// still answer mode's alone, which is what this case has always been about."
// That is a rule about `answer` and `grounding`, not a freeze on the key set:
// `cues`, `buzzwords`, `resumeAnchor` and `idealProject` were all added to
// points mode after those assertions were first written. `pageSources` is a
// reading aid of exactly that kind and belongs with them. The cases below
// pin BOTH halves, so the rule cannot be read as a freeze again.
describe("live mode gets the citations too (AC-6.2)", () => {
  const livePages = [page("p1", "Ledger sharding", "Sharded the ledger by tenant and cut p99")];

  it("returns the page behind each point on the non-streaming live path", async () => {
    mockKnowledgeBase({ pages: livePages });
    mockGemini({ ...GEMINI_PAYLOAD, pageIds: ["p1", "a-page-that-does-not-exist"] });

    // No `mode` — exactly what useDraftAnswer.js sends.
    const res = await POST(jsonRequest({ question: "How did you shard the ledger?", engine: "gemini" }));
    const data = await res.json();

    expect(data.pageSources).toEqual([{ id: "p1", title: "Ledger sharding" }, null]);
  });

  it("still keeps `answer` and `grounding` out of a points-mode response", async () => {
    // The property those exact-key-set assertions actually exist to protect.
    // Asserted here in its own right so that adding a reading aid never
    // requires anyone to weaken it.
    mockKnowledgeBase({ pages: livePages });
    mockGemini({ ...GEMINI_PAYLOAD, pageIds: ["p1", null] });

    const res = await POST(jsonRequest({ question: "How did you shard the ledger?", engine: "gemini" }));
    const data = await res.json();

    expect(data).not.toHaveProperty("answer");
    expect(data).not.toHaveProperty("grounding");
    // Positive control: the other reading aids really are on this response,
    // so "no answer/grounding" is not being satisfied by an empty payload.
    expect(Object.keys(data).sort()).toEqual([
      "buzzwords",
      "cues",
      "idealProject",
      "pageSources",
      "points",
      "resumeAnchor",
      "type",
    ]);
  });

  it("reports no citations rather than undefined when live mode saw no pages", async () => {
    mockKnowledgeBase({ pages: [] });
    mockGemini({ ...GEMINI_PAYLOAD, pageIds: ["p1", "p2"] });

    const res = await POST(jsonRequest({ question: "Tell me about yourself.", engine: "gemini" }));
    const data = await res.json();
    expect(data.pageSources).toEqual([]);
  });
});

// The STREAMING half of live mode, which is the path production actually
// takes: answerClient.js's draftAnswerStreaming sets `stream: true`, and
// useDraftAnswer.js calls it for every live draft. A non-streaming case alone
// would leave the real path uncovered — the shape this repo has been caught
// by before, where the tested branch and the shipped branch are not the same
// branch.
describe("live mode's streamed response carries the citations (AC-6.2, ARCH 4e)", () => {
  function mockGeminiStream(payload) {
    getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
    const doc = JSON.stringify(payload);
    getGeminiClient.mockReturnValue({
      models: {
        generateContentStream: vi.fn().mockResolvedValue(
          (async function* () {
            // Two arbitrary fragments, the way a real stream arrives: no
            // respect for field or token boundaries.
            yield { text: doc.slice(0, Math.floor(doc.length / 2)) };
            yield { text: doc.slice(Math.floor(doc.length / 2)) };
          })(),
        ),
        // The worked-example call never settles, so anything that completes
        // here proves the frames did not wait on it.
        generateContent: vi.fn(() => new Promise(() => {})),
      },
    });
  }

  async function readFrames(res) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const frames = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const split = splitFrames(buffer);
      buffer = split.rest;
      frames.push(...split.frames);
    }
    const tail = splitFrames(buffer + "\n");
    frames.push(...tail.frames);
    return frames;
  }

  it("puts the citations on the done frame, and leaves the points frames alone", async () => {
    mockKnowledgeBase({ pages: [page("p1", "Ledger sharding", "Sharded the ledger by tenant and cut p99")] });
    mockGeminiStream({ ...GEMINI_PAYLOAD, pageIds: ["p1", "not-a-real-page"] });

    const res = await POST(
      jsonRequest({ question: "How did you shard the ledger?", engine: "gemini", stream: true }),
    );
    const frames = await readFrames(res);

    const done = frames.find((f) => f.t === "done");
    expect(done).toBeTruthy();
    expect(done.pageSources).toEqual([{ id: "p1", title: "Ledger sharding" }, null]);

    // The incremental frames keep exactly today's shape. A citation cannot be
    // resolved from a partial points array anyway — the pairing is
    // all-or-nothing on length — so emitting one early would be a guess.
    const pointsFrames = frames.filter((f) => f.t === "points");
    expect(pointsFrames.length).toBeGreaterThan(0);
    for (const frame of pointsFrames) expect(frame).not.toHaveProperty("pageSources");
  });
});

// AC-3 applies to BOTH prompts, and the one it was skipped on is the live
// interview. `buildPointsPrompt` is what fires mid-interview; `buildAnswerPrompt`
// is practice mode's. The framing fixes landed only in the second one, so the
// higher-stakes surface kept the exact string the acceptance criteria cite as
// the defect ("may ground a concrete story") and never got the
// prefer-a-specific-detail instruction at all.
describe("the LIVE prompt gets the same framing as the practice one (AC-3.1/3.2)", () => {
  const withPage = () =>
    mockKnowledgeBase({ pages: [page("p1", "Ledger sharding", "Sharded the ledger by tenant and cut p99")] });

  it("drops the hedge that framed the knowledge base as optional", async () => {
    withPage();
    const generateContent = mockGemini(GEMINI_PAYLOAD);
    // No `mode` — the live path.
    await POST(jsonRequest({ question: "Tell me about a hard project.", engine: "gemini" }));
    expect(answerPrompt(generateContent)).not.toContain("may ground a concrete story");
  });

  it("tells the live model to prefer a page's specific detail and name the project", async () => {
    withPage();
    const generateContent = mockGemini(GEMINI_PAYLOAD);
    await POST(jsonRequest({ question: "Tell me about a hard project.", engine: "gemini" }));
    const promptText = answerPrompt(generateContent).toLowerCase();
    expect(promptText).toContain("project page");
    expect(promptText).toContain("name the project");
  });

  it("puts the candidate's own pages ahead of the submitted documents in the live prompt too", async () => {
    // A real résumé has to be on file for this to mean anything: with no
    // submitted-docs block in the prompt there is no second position to
    // compare against, and an ordering assertion built on two `indexOf` calls
    // is satisfied by -1 — passing against every possible ordering.
    mockKnowledgeBase({
      pages: [page("p1", "Ledger sharding", "Sharded the ledger by tenant and cut p99")],
      resume: "Senior Engineer, Acme. Led the checkout redesign.",
    });
    const generateContent = mockGemini(GEMINI_PAYLOAD);
    await POST(
      jsonRequest({ question: "Tell me about a hard project.", engine: "gemini", applicationId: "app-1" }),
    );
    const promptText = answerPrompt(generateContent);
    const pagesAt = promptText.indexOf("YOUR OWN PROJECT PAGES");
    const docsAt = promptText.indexOf("SUBMITTED");
    expect(pagesAt).toBeGreaterThan(-1);
    expect(docsAt).toBeGreaterThan(-1);
    expect(pagesAt).toBeLessThan(docsAt);
  });

  it("says nothing about project pages in the live prompt when there are none", async () => {
    mockKnowledgeBase({ pages: [] });
    const generateContent = mockGemini(GEMINI_PAYLOAD);
    await POST(jsonRequest({ question: "Tell me about a hard project.", engine: "gemini" }));
    expect(answerPrompt(generateContent)).not.toContain("PROJECT PAGES");
  });
});

// One malformed point must not silently cost the whole answer its citations.
describe("citations survive the model returning the wrong number of points", () => {
  it("keeps each citation with its own point when a blank point is dropped", async () => {
    // `points` is filtered for blanks and sliced to MAX_ANSWER_POINTS;
    // `pageIds` was passed through untouched. resolvePageSources then sees a
    // length mismatch and — correctly, by its own all-or-nothing rule —
    // returns all nulls. The rule is right; normalising only one of the two
    // arrays is the bug. A model returning one whitespace point among four
    // costs the user every citation on the answer, with no signal anywhere.
    mockKnowledgeBase({ pages: [page("p1", "Ledger sharding", "Sharded the ledger by tenant")] });
    mockGemini({
      points: ["I led the ledger work.", "   ", "It cut p99 by 40 percent."],
      cues: ["The ledger", "", "The result"],
      type: "behavioral",
      pageIds: ["p1", null, "p1"],
    });

    const res = await POST(
      jsonRequest({ question: "Tell me about the ledger work.", mode: "answer", engine: "gemini" }),
    );
    const data = await res.json();

    expect(data.points).toHaveLength(2);
    expect(data.pageSources).toEqual([
      { id: "p1", title: "Ledger sharding" },
      { id: "p1", title: "Ledger sharding" },
    ]);
  });
});

// The reading aids are a second, independent route to the same claim, and
// they do not go through `answerLines`. `answerAids` builds a `resumeAnchor`
// fallback from the selected story when no resume anchor was found — the
// ordinary live-mode cold start, with no submitted resume and no prep notes.
describe("the reading aids never surface a page the question did not match", () => {
  it("shows no project to talk about when nothing matched", async () => {
    // The deterministic ANSWER correctly stays silent here; the aid beside it
    // must not then name the page anyway. `AnswerAids` only consults `matched`
    // inside its role-row branch, which this shape does not take — so the
    // honest label the route's comment relies on never renders, and the user
    // reads "Project to talk about: We spent time each spring checking the
    // hives" beside an answer about disagreeing with a manager.
    mockKnowledgeBase({
      pages: [
        page(
          "p1",
          "Beekeeping club minutes",
          "- We spent time each spring checking the hives with the club members\n- Notes from the meeting about honey extraction",
        ),
      ],
    });
    const res = await POST(
      jsonRequest({
        question: "Tell me about a time you disagreed with your manager.",
        mode: "answer",
        engine: "embedded",
      }),
    );
    const data = await res.json();
    const anchor = data.resumeAnchor;
    if (anchor) expect(anchor.project || "").not.toContain("checking the hives");
  });

  it("still offers the page as an anchor when the question DID match it", async () => {
    // Positive control: the fix must not be "never build the fallback", which
    // would pass the case above by deleting a working feature.
    mockKnowledgeBase({
      pages: [page("p1", "Payments ledger", "- Sharded the ledger by tenant and cut p99 latency by 40 percent")],
    });
    const res = await POST(
      jsonRequest({
        question: "Tell me about a time you sharded a ledger by tenant.",
        mode: "answer",
        engine: "embedded",
      }),
    );
    const data = await res.json();
    expect(data.resumeAnchor).toBeTruthy();
    expect(data.resumeAnchor.source).toBe("project page");
  });
});

// `grounding.pages` drives the sample-answer caption, which tells the
// candidate in plain words where their answer came from. It must report what
// the branch that ANSWERED actually used, not what the page selector merely
// approved.
//
// THE DISTINCTION, and it is not academic: `matched` is the gate on page
// SELECTION. Every deterministic consumer then reads `story.bullets`, and
// `bulletsFromBody` mines MARKDOWN BULLET LINES ONLY — so a page written as
// plain prose, which is the common way people write, yields no bullets at
// all. The page clears the gate, contributes nothing, and the caption used to
// say "and your own project pages" over an answer with none of them in it.
//
// This case is here because the fix survived a sabotage run: reverting the
// derivation to `!!story?.matched` left the entire suite green. A fix nothing
// can catch is a fix nobody can keep.
describe("grounding.pages reports what the answer actually used", () => {
  it("is false when the matched page had no bullets to mine", async () => {
    mockKnowledgeBase({
      pages: [
        page(
          "p1",
          "Payments migration",
          // Deliberately prose. No "- " anywhere, so bulletsFromBody finds
          // nothing and no page text can reach the answer.
          "We moved settlement onto Kafka over two quarters. I led the cutover and wrote the runbook. The team kept the old ledger warm until we were confident.",
        ),
      ],
    });
    const res = await POST(
      jsonRequest({
        question: "Tell me about the payments migration you led.",
        mode: "answer",
        engine: "embedded",
      }),
    );
    const data = await res.json();

    // Positive control: the page really was selected and really did clear the
    // gate, so this case is about the derivation and not about a page that
    // failed to match.
    expect(data.resumeAnchor?.source).toBe("project page");
    // Nothing from the page reached the answer...
    expect(data.pageSources.filter(Boolean)).toEqual([]);
    // ...so the caption must not claim otherwise.
    expect(data.grounding.pages).toBe(false);
  });

  it("is true when the page really did supply the answer's material", async () => {
    mockKnowledgeBase({
      pages: [
        page(
          "p1",
          "Payments migration",
          "- Moved settlement onto Kafka and cut the cutover window to one night\n- Wrote the runbook the on-call rotation still uses",
        ),
      ],
    });
    const res = await POST(
      jsonRequest({
        question: "Tell me about the payments migration you led.",
        mode: "answer",
        engine: "embedded",
      }),
    );
    const data = await res.json();
    expect(data.pageSources.filter(Boolean).length).toBeGreaterThan(0);
    expect(data.grounding.pages).toBe(true);
  });
});
