// TDD, written BEFORE the route wiring exists. Every case here is RED today.
//
// WHAT THIS PINS. `roleTermsUnbacked` (design §4d) is the per-response
// honesty flag: the terms the interviewer's own question supplied that the
// drafted answer went on to use, and that the candidate's material does not
// support. It is computed post-draft on EVERY engine, because it is pure —
// unlike the prompt change, which is Gemini-only (§9: the embedded engine
// drafts the candidate's own bullet lines verbatim, and a role-framed opening
// sentence there would mean inventing connective prose, which
// projectStories.js:379-386 refuses on purpose).
//
// THE TWO GATES ARE DIFFERENT AND THAT IS THE POINT (§4d, resolving revision
// 2's contradiction):
//   terms.length > 0                      gates the FLAG, on every engine.
//   terms.length > 0 && !wantsEmbedded    gates the PROMPT change.
//
// THE FALSE-ACCUSATION HAZARD, which the embedded case below is built around.
// On the Gemini branch the material the flag judges against is `kb.block` —
// the pages actually put in the prompt. On the embedded branch the route
// never reads `kb` at all (route.js:570-578); it drafts from `story`, and
// `kb.block` is budget-truncated (MAX_PAGES_CHARS, route.js:122) while
// `story` is selected across all pages. Judging the embedded draft against
// `kb.block` would therefore report the candidate's OWN verbatim page text as
// an unbacked claim — the app calling the user a liar about a sentence it
// copied out of their own notes.
//
// CORRECTED (adversarial review item 2). This file used to claim that with a
// single WORKDAY_PAGE, "an implementation that builds `material` from
// combineMaterial alone, or from `kb.block` on this branch, returns
// ["Workday"] here and fails". MEASURED FALSE: with only one small, eligible
// page — nowhere near MAX_PAGES_CHARS — `kb.block` contains that page's own
// "Workday" text too, whole and untruncated. Swapping `storyPageText(story)`
// for `kb.block` at route.js:777 and route.js:904 therefore left the
// material's "Workday" mention intact either way, and the case below caught
// nothing: the whole test suite stayed green under that mutation.
//
// FILLER_PAGE below is what makes the two genuinely diverge. It is
// engineered (see its own comment) to out-rank WORKDAY_PAGE in
// buildKnowledgeBaseBlock's packing order — via BM25 term-frequency scoring,
// which rewards repeating a small set of distinctive terms — while scoring
// STRICTLY FEWER distinct terms than WORKDAY_PAGE under selectBestStory's own
// overlapScore (8 vs 9; measured in the self-check below). So it consumes
// almost the entire MAX_PAGES_CHARS budget and pushes WORKDAY_PAGE below
// MIN_PAGE_CHARS — excluded from `kb.block` ENTIRELY, heading and all.
// selectBestStory ranks with no budget at all, and even though FILLER_PAGE
// now CLEARS its own honesty gate (clearsHonestyGate, projectStories.js — see
// THE HONESTY GATE below for why that changed), it still loses the ranking on
// that one-term overlapScore margin, so `story` still resolves to
// WORKDAY_PAGE regardless of what `kb.block` contains. That is the
// divergence: `story` carries "Workday", `kb.block` does not, for the
// identical request.
//
// MEASURED, not assumed, before this file was written: for the Workday
// question below, selectBestStory still picks page p1 (WORKDAY_PAGE) with
// matched: true even with FILLER_PAGE present, and draftAnswerLocal emits
// "Action: Walk through the concrete steps you took — e.g. Built a custom
// Workday report for quarterly headcount, with compliance sign-off.." — the
// page's own bullet, quoted verbatim, with the word "Workday" in it and
// nothing about Workday anywhere in PROFILE or in FILLER_PAGE. So an
// implementation that builds `material` from combineMaterial alone, or from
// `kb.block` on this branch, now genuinely returns ["Workday"] here and
// fails — the mutation this file exists to catch.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { POST } from "./route.js";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { createClient } from "@/lib/supabase/server";
import { answerContextCache } from "@/lib/copilot/answerSessionCache";
import { MAX_QUESTION_CHARS } from "@/lib/copilot/questionVocabulary";
// Used ONLY by the self-check just below FILLER_PAGE/WORKDAY_PAGE, to prove
// the two-page fixture actually produces the divergence its own comment
// claims, rather than trusting the hand-tuned body length blind (item 2).
// Not a route import — these are the real modules route.js itself calls.
import { buildKnowledgeBaseBlock, stripLinePrefixes } from "@/lib/experience/knowledgeBase";
import { selectBestStory, isEligiblePage, overlapScore, significantTerms } from "@/lib/copilot/projectStories";
import { splitFrames } from "@/lib/copilot/answerStream";

function jsonRequest(body) {
  return { json: async () => body };
}

// Answers listPages against `experience_pages`; no application, no submitted
// documents, no posting — so `generateContent.mock.calls[0]` stays the answer
// call (there is no second, ideal-project call to select a posting for).
function mockSupabase({ id = "user-1", pages = [] } = {}) {
  const from = vi.fn((table) => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      is: vi.fn(() => chain),
      order: vi.fn(async () => ({ data: table === "experience_pages" ? pages : [], error: null })),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
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

// AC-3 item 3 of the adversarial review: streaming (route.js's streamAnswer)
// is the ONLY way live mode — the mode this whole feature exists for — is
// ever actually reached (CopilotClient/QuestionFeed always send `stream:
// true`), so a fixed-key-set describe over `mockGemini`/non-streaming alone
// never exercises route.js's :380/:391 spreads at all. One chunk is enough
// here — these cases are about the flag surviving into the terminal `done`
// frame, not about incremental delivery, which streaming.test.js already
// covers on its own.
function mockGeminiStream(payload) {
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  const generateContentStream = vi.fn().mockResolvedValue(
    (async function* () {
      yield { text: JSON.stringify(payload) };
    })(),
  );
  // The worked-example call — never awaited on the critical path (see
  // streaming.test.js's own comment); a promise that never settles proves
  // that and keeps this file's cases from depending on it resolving.
  getGeminiClient.mockReturnValue({
    models: { generateContentStream, generateContent: vi.fn(() => new Promise(() => {})) },
  });
  return generateContentStream;
}

// Reads a streamed Response body to completion and returns the parsed NDJSON
// frames — the same shape streaming.test.js's own helper produces.
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

// Measured against the real extractKeywords + default taxonomy:
// tool_platform "Workday" (score 9, count 3), and nothing else in any
// BUZZWORD_CATEGORY. So roleTerms(...) is exactly ["Workday"].
const WORKDAY_QUESTION =
  "Can you describe a particularly complex Workday report you designed? " +
  "What was the business challenge it addressed, and which Workday tools did you use to build it? " +
  "How do you ensure data accuracy and compliance with security standards when building custom Workday reports, " +
  "especially when the work involves managing sensitive HR information?";

// Measured: extractKeywords returns {} — no taxonomy term, no advisory topic
// phrase. The repo's canonical content-free question
// (storyMatchHonesty.test.js:130, :243).
const SCAFFOLDING_QUESTION = "Tell me about a time you failed.";

// The candidate from the session that produced the defect. No Workday
// anything.
const PROFILE = [
  "Senior Software Engineer, Mutual of Omaha",
  "Built React front ends over a Kafka event pipeline, with MongoDB and Postgres behind it.",
  "Cut the nightly reconciliation window from six hours to forty minutes.",
].join("\n");

const PROFILE_WITH_WORKDAY = `${PROFILE}\nOwned the Workday integration for HR headcount reporting.`;

const WORKDAY_PAGE = {
  id: "p1",
  title: "Workday headcount reporting",
  body: [
    "- Built a custom Workday report for quarterly headcount, with compliance sign-off.",
    "- Tightened the security standards around sensitive HR information in that report.",
    "- Cut the reporting turnaround from three days to one.",
  ].join("\n"),
  position: 0,
  archived_at: null,
  generated_kind: null,
};

// FILLER_PAGE (item 2 of the adversarial review, REBUILT after the BM25
// ranker landed — see RANKING and THE HONESTY GATE below): engineered to
// out-rank WORKDAY_PAGE in buildKnowledgeBaseBlock's packing order while
// scoring one FEWER distinct term than WORKDAY_PAGE under selectBestStory's
// own overlapScore — see this file's header comment above for why that
// combination is exactly what makes `story` and `kb.block` diverge on the
// same request.
//
// RANKING — THE TWO RANKERS NO LONGER SHARE A CONTRACT. Before the BM25
// ranker (lib/experience/pageRanking.js) landed, buildKnowledgeBaseBlock's
// packing order and selectBestStory's overlapScore were the same
// distinct-term-overlap rule. They are not anymore:
//   - buildKnowledgeBaseBlock ranks via rankPagesByRelevance, which now
//     delegates to Okapi BM25 (pageRanking.js): a 2-char token floor,
//     STOPWORDS filtered out, and a score that rewards a term's FREQUENCY on
//     the page (saturating, but repetition keeps adding until it does).
//   - selectBestStory ranks candidates, and clearsHonestyGate gates them, on
//     overlapScore/significantTerms (this file, lib/copilot/projectStories.js
//     above): a 4-char token floor, NO stopword filtering, and a score that
//     counts DISTINCT terms only — repeating a word again never scores it
//     twice.
// SAFE_OVERLAP_SENTENCE below repeats eight of WORKDAY_QUESTION's own terms
// that WORKDAY_PAGE does NOT carry — "accuracy", "addressed", "business",
// "complex", "designed", "especially", "managing", "particularly" — plus
// "HR": short enough (2 chars) that BM25's floor counts it but
// significantTerms' 4-char floor never does, so including it only ever
// raises WORKDAY_PAGE's own "hr" document frequency, never FILLER_PAGE's
// distinct count. Repeated across the padded ~11.5KB body, those eight terms
// saturate BM25's per-term frequency reward; WORKDAY_PAGE has no repetition
// of its own terms to answer with. MEASURED: BM25 totals filler=11.99,
// workday=9.75 (a ~19% margin) — filler is ranked first and its body is
// included WHOLE (comfortably under MAX_PAGES_CHARS's 12000 budget, minus the
// 400-char notice reserve), which leaves less than MIN_PAGE_CHARS (200,
// lib/experience/knowledgeBase.js) for WORKDAY_PAGE afterward — excluded from
// `kb.block` entirely, heading and all, not merely excerpted.
//
// THE HONESTY GATE — WHAT IS TRUE NOW, STATED PLAINLY. Under overlapScore's
// 4-char, no-stopword-filter, DISTINCT-only count, FILLER_PAGE's eight
// repeated terms count as 8 distinct terms ("HR" is below the 4-char floor
// and never counts here). WORKDAY_PAGE counts 9 (measured: workday, report,
// custom, with, compliance, security, standards, sensitive, information). So
// FILLER_PAGE now CLEARS clearsHonestyGate (distinctiveCount 8) — it is NOT
// boilerplate the candidate is ineligible to speak. What still holds, and is
// the entire reason this fixture keeps working, is narrower: FILLER_PAGE
// loses selectBestStory's ranking on SCORE, by exactly one distinct term (8
// vs 9), so `bestEligible` still resolves to WORKDAY_PAGE (distinctiveCount
// 8, one of them on its own title: "workday"). The property this file used to
// demonstrate incidentally — a page that sits in the prompt while being
// INELIGIBLE to be spoken as the candidate's own experience — has moved out
// of this file. It is not lost from the repo: it is pinned directly, by name,
// in hello-world/lib/copilot/storyMatchHonesty.test.js:56, :92, :137, :167,
// :245 (each a `matched === false` on a boilerplate page). In this file that
// property was always a MEANS to the kb/story divergence, never an assertion
// of its own — the divergence itself is what every case below actually
// depends on, and it is fully preserved.
const SAFE_OVERLAP_SENTENCE =
  "The accuracy we addressed for our business is complex, designed especially by managing it particularly for HR. ";
const NEUTRAL_PADDING_SENTENCE =
  "The quarterly newsletter mentioned a fun lunch and a friendly trivia night that everyone enjoyed on a sunny " +
  "afternoon near the old oak tree by the fountain in the courtyard. ";

// Padded to land just past the point where buildKnowledgeBaseBlock includes
// this page WHOLE (not excerpted — the EXCERPT_SHARE_DIVISOR rationing in
// that module only applies to a page that does NOT fit whole) and leaves
// under MIN_PAGE_CHARS of budget behind it for WORKDAY_PAGE. Tuned against
// the real budget (12000, minus a 400-char notice reserve, minus this page's
// own ~44-char heading) and re-verified by the self-check below rather than
// trusted blind — if either module's constants ever move, that check goes
// red before the route-level cases do, which is the point. The length itself
// is forced, not a free tuning choice (see RANKING above): a page that does
// not fit whole is excerpted instead of excluding WORKDAY_PAGE, so this must
// land in the same (11400, 11600] window the old fixture needed. Interleaving
// SAFE_OVERLAP_SENTENCE with NEUTRAL_PADDING_SENTENCE (rather than one block
// of each) keeps the eight repeated question terms spread across the whole
// body so BM25's term-frequency count is unaffected by where the target
// length happens to cut the string.
function buildFillerBody() {
  const target = 11460;
  let body = "";
  while (body.length < target) body += SAFE_OVERLAP_SENTENCE + NEUTRAL_PADDING_SENTENCE;
  return body.slice(0, target);
}

const FILLER_PAGE = {
  id: "filler",
  title: "General onboarding notes",
  body: buildFillerBody(),
  position: 0,
  archived_at: null,
  generated_kind: null,
};

// What the model came back with in the failing session, minus the hedge: the
// fabrication the flag exists to report.
const GEMINI_CLAIMS_WORKDAY = {
  points: [
    "Situation: The HR team needed a headcount report.",
    "Action: I designed the Workday reports for quarterly headcount.",
    "Result: Turnaround dropped from three days to one.",
  ],
  type: "behavioral",
};

beforeEach(() => {
  vi.clearAllMocks();
  answerContextCache.clear();
});

describe("the FILLER_PAGE/WORKDAY_PAGE fixture actually diverges (item 2, self-check)", () => {
  // Proves the claim FILLER_PAGE's own comment makes, against the REAL
  // buildKnowledgeBaseBlock and selectBestStory — not the route, and not
  // trusted from hand arithmetic. 12000 mirrors route.js's own (private,
  // unexported) MAX_PAGES_CHARS; if that constant ever changes this check —
  // not just the route-level ones below it — is what goes red first.
  const MAX_PAGES_CHARS = 12000;

  it("kb.block excludes WORKDAY_PAGE entirely once FILLER_PAGE is packed first", () => {
    const rankingQuery = `${WORKDAY_QUESTION}\n${stripLinePrefixes("")}`;
    const kb = buildKnowledgeBaseBlock({
      pages: [FILLER_PAGE, WORKDAY_PAGE],
      query: rankingQuery,
      isEligible: isEligiblePage,
      budget: MAX_PAGES_CHARS,
      budgetLabel: "interview copilot's context budget",
      attachmentNotice: "",
    });
    expect(kb.includedPageIds).not.toContain("p1");
    expect(kb.block).not.toContain("Workday");
    // Positive control: FILLER_PAGE itself did make it in — the exclusion
    // above is the budget's doing, not an unrelated eligibility failure.
    expect(kb.includedPageIds).toContain("filler");
  });

  it("selectBestStory still resolves to WORKDAY_PAGE, matched, by a one-term overlapScore margin despite FILLER_PAGE winning BM25's packing order", () => {
    const story = selectBestStory([FILLER_PAGE, WORKDAY_PAGE], { question: WORKDAY_QUESTION, points: [] });
    expect(story?.pageId).toBe("p1");
    expect(story?.matched).toBe(true);
    expect(story?.bullets?.[0] || "").toContain("Workday");
    // Pins the new premise explicitly (RANKING/THE HONESTY GATE above): the
    // margin is now a single distinct term, not the ten-term gap the old
    // fixture had. If a future change ever brings FILLER_PAGE's distinct
    // count up to WORKDAY_PAGE's, `story` flips to FILLER_PAGE and :388/:544
    // below fail loudly (`points` would carry no "Workday") rather than
    // going quiet — but naming the constraint here is what lets the next
    // reader see it coming instead of re-deriving it from a mutation.
    const questionTerms = significantTerms(WORKDAY_QUESTION);
    expect(overlapScore(questionTerms, `${FILLER_PAGE.title} ${FILLER_PAGE.body}`)).toBeLessThan(
      overlapScore(questionTerms, `${WORKDAY_PAGE.title} ${WORKDAY_PAGE.body}`),
    );
  });
});

describe("roleTermsUnbacked — the Gemini path", () => {
  it("reports the question's own term when the draft claims it and the material does not have it", async () => {
    // The whole point of the flag. "Workday" came from the interviewer, the
    // draft used it in a first-person claim, and nothing in the candidate's
    // material supports it. A term the question supplied for free carries no
    // evidence — the rule storyMatchHonesty.test.js:112-117 already states
    // for page selection, applied here to the drafted sentence.
    mockSupabase();
    mockGemini(GEMINI_CLAIMS_WORKDAY);
    const res = await POST(jsonRequest({ question: WORKDAY_QUESTION, profile: PROFILE, engine: "gemini" }));
    const data = await res.json();
    expect(data.roleTermsUnbacked).toEqual(["Workday"]);
  });

  it("reports nothing once the material actually backs the term", async () => {
    // The paired negative, and it is a pair in the strict sense: identical
    // request, identical model output, one extra line of profile. So the
    // empty array is the material's doing and not a dead feature's.
    mockSupabase();
    mockGemini(GEMINI_CLAIMS_WORKDAY);
    const res = await POST(
      jsonRequest({ question: WORKDAY_QUESTION, profile: PROFILE_WITH_WORKDAY, engine: "gemini" }),
    );
    const data = await res.json();
    expect(data.roleTermsUnbacked).toEqual([]);
  });

  it("reports the term even where the draft only NAMED it — the flag is a label, not a verdict", async () => {
    // §4d wires the flag to `unsupportedRoleTerms`, which is TERM PRESENCE
    // (AC-3.1), not the per-claim check (`claimedWithoutBacking`, AC-3.3).
    // So the honest framing — Workday named as the subject, every
    // first-person verb attached to real work — is reported too. That is
    // correct and it is also the whole reason §4e cuts the "Careful with:"
    // UI row from the MVP: `AnswerAids.js:312` already renders "Words from
    // the posting to work in", and a panel that told the candidate
    // mid-interview to work "Workday" in AND to be careful of it would be
    // two contradictory instructions in one component.
    //
    // PINNED SO THE FOLLOW-UP CANNOT GET THIS WRONG: when the row ships it
    // must MERGE with the existing one (annotate the chip), never sit beside
    // it — and if a future change makes this come back empty, the flag has
    // silently become a claim detector and AC-3.1 has moved.
    mockSupabase();
    mockGemini({
      points: [
        "Workday reporting is the closest thing here to the reconciliation reporting side of that role.",
        "Action: I built a React front end over a Kafka event pipeline.",
      ],
      type: "behavioral",
    });
    const res = await POST(jsonRequest({ question: WORKDAY_QUESTION, profile: PROFILE, engine: "gemini" }));
    const data = await res.json();
    expect(data.roleTermsUnbacked).toEqual(["Workday"]);
  });

  it("emits no key at all for a question that names no system", async () => {
    mockSupabase();
    mockGemini({ points: ["Point one.", "Point two."], type: "behavioral" });
    const res = await POST(jsonRequest({ question: SCAFFOLDING_QUESTION, profile: PROFILE, engine: "gemini" }));
    const data = await res.json();
    expect(data).not.toHaveProperty("roleTermsUnbacked");
    // AC-6.1, CORRECTED. Revision 3 says these three exact-key-set
    // assertions (route.test.js:172-180, :453-461,
    // route.knowledgeBase.test.js:561-569) "turn red and must be updated".
    // Measured, they do not: all three fixture questions extract no taxonomy
    // term, so no key is emitted and the key set is unmoved. Asserted here
    // so that if a later change opens the gate on scaffolding questions,
    // THIS case names the cause instead of three unrelated files failing on
    // a key list.
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
});

describe("roleTermsUnbacked — the embedded path must not accuse the candidate's own text", () => {
  it("is present, and empty, when the draft quotes the candidate's own page verbatim", async () => {
    // MEASURED: draftAnswerLocal quotes p1's (WORKDAY_PAGE's) first bullet —
    // "Built a custom Workday report for quarterly headcount, with compliance
    // sign-off." — into the Action point, verbatim. "Workday" appears nowhere
    // in PROFILE, so `material` MUST include the story text for this to come
    // back empty. FILLER_PAGE is in the fixture SPECIFICALLY so this is a real
    // discriminating test (item 2): it out-ranks WORKDAY_PAGE in
    // buildKnowledgeBaseBlock's packing order and pushes it out of `kb.block`
    // entirely (see this file's own self-check above), while selectBestStory
    // still resolves `story` to WORKDAY_PAGE. So an implementation that judges
    // the embedded draft against combineMaterial alone, or against `kb.block`
    // — which the embedded branch never reads for drafting, and which this
    // fixture now makes genuinely lack "Workday" — returns ["Workday"] here:
    // the app flagging the user's own sentence as an unbacked claim.
    mockSupabase({ pages: [FILLER_PAGE, WORKDAY_PAGE] });
    const res = await POST(jsonRequest({ question: WORKDAY_QUESTION, profile: PROFILE, engine: "embedded" }));
    const data = await res.json();
    // First: the draft really did quote the page. Without this the empty
    // array below is empty for the boring reason that nothing said "Workday".
    expect(data.points.join("\n")).toContain("Workday");
    // Presence is the positive half: the flag is computed on this engine at
    // all. Without it, the empty array below is satisfied by a feature that
    // was never wired into the embedded branch.
    expect(Object.keys(data)).toContain("roleTermsUnbacked");
    expect(data.roleTermsUnbacked).toEqual([]);
    expect(getGeminiClient).not.toHaveBeenCalled();
  });

  it("emits no key at all for a question that names no system", async () => {
    mockSupabase({ pages: [WORKDAY_PAGE] });
    const res = await POST(jsonRequest({ question: SCAFFOLDING_QUESTION, profile: PROFILE, engine: "embedded" }));
    const data = await res.json();
    expect(data).not.toHaveProperty("roleTermsUnbacked");
  });

  it("gets the flag but NOT the prompt change (design §9)", async () => {
    // The two gates are separate. The embedded engine drafts from the
    // candidate's own bullet lines and has no model to instruct, so it must
    // reach the on-device path with no Gemini call regardless of the terms.
    mockSupabase({ pages: [WORKDAY_PAGE] });
    const res = await POST(jsonRequest({ question: WORKDAY_QUESTION, profile: PROFILE, engine: "embedded" }));
    expect(res.status).toBe(200);
    expect(getGeminiClient).not.toHaveBeenCalled();
    expect(getServerEnv).not.toHaveBeenCalled();
  });
});

describe("the question is untrusted, uncapped, third-party input (design AC-4.1, §8.7)", () => {
  it("caps the question before it reaches the prompt", async () => {
    // route.js:358 is `(body?.question ?? "").toString().trim()` — no
    // `.slice()`, the only unbudgeted string on this path, and in live mode
    // it is machine-transcribed interviewer speech. It sits at character 0 of
    // the prompt (answerPrompts.js:141), ahead of a 12,000-character
    // knowledge base and a 12,000-character résumé, so an uncapped question
    // can dominate both.
    const sentence = "We reviewed the quarterly onboarding checklist with the team again and again. ";
    const filler = sentence.repeat(Math.ceil(MAX_QUESTION_CHARS / sentence.length) + 1);
    const question = `HEAD-OF-QUESTION ${filler} TAIL-OF-QUESTION`;
    expect(question.length).toBeGreaterThan(MAX_QUESTION_CHARS);

    mockSupabase();
    const generateContent = mockGemini({ points: ["Point one.", "Point two."], type: "general" });
    const res = await POST(jsonRequest({ question, profile: PROFILE, engine: "gemini" }));
    expect(res.status).toBe(200);
    const prompt = answerPrompt(generateContent);
    // The head survives — so this is a cap and not a rejection.
    expect(prompt).toContain("HEAD-OF-QUESTION");
    // The tail does not.
    expect(prompt).not.toContain("TAIL-OF-QUESTION");
  });

  it("still asks a normal-length question in full", async () => {
    // The pair for the case above: the cap must not be truncating ordinary
    // questions. A cap set to zero passes the `not.toContain` half alone.
    mockSupabase();
    const generateContent = mockGemini({ points: ["Point one.", "Point two."], type: "general" });
    await POST(jsonRequest({ question: WORKDAY_QUESTION, profile: PROFILE, engine: "gemini" }));
    expect(answerPrompt(generateContent)).toContain(WORKDAY_QUESTION);
  });

  it("derives no term from a term the caller buried past the cap", async () => {
    // AC-4.2: the terms come from the CAPPED question, so a caller cannot
    // reach the gate — or the flag — with a 20,000-character payload.
    const sentence = "We reviewed the quarterly onboarding checklist with the team again and again. ";
    const filler = sentence.repeat(Math.ceil(MAX_QUESTION_CHARS / sentence.length) + 1);
    mockSupabase();
    mockGemini(GEMINI_CLAIMS_WORKDAY);
    const sentence2 = "Tell me about the Workday reports you designed.";
    const res = await POST(
      jsonRequest({ question: `${filler} ${sentence2}`, profile: PROFILE, engine: "gemini" }),
    );
    const data = await res.json();
    expect(data).not.toHaveProperty("roleTermsUnbacked");
    // Paired in the same case: the identical sentence at the head of an
    // equally long question DOES reach the gate. Without this the assertion
    // above is satisfied by a feature that was never built.
    answerContextCache.clear();
    mockGemini(GEMINI_CLAIMS_WORKDAY);
    const res2 = await POST(
      jsonRequest({ question: `${sentence2} ${filler}`, profile: PROFILE, engine: "gemini" }),
    );
    expect((await res2.json()).roleTermsUnbacked).toEqual(["Workday"]);
  });

  it("does not let a mis-transcription license a claim", async () => {
    // §8.7 says "the taxonomy gate makes transcription noise unlikely to
    // produce a canonical". Measured, that is false in the direction that
    // matters: a transcript rendering the spoken "work day" as "Workday"
    // produces the canonical, and the gate opens on a question that is not
    // about Workday at all. What must hold is not that the term never
    // appears, but that it can never become evidence — so the same model
    // output is still reported as unbacked.
    mockSupabase();
    mockGemini(GEMINI_CLAIMS_WORKDAY);
    const res = await POST(
      jsonRequest({
        question: "How do you structure your Workday when three product managers all want something first?",
        profile: PROFILE,
        engine: "gemini",
      }),
    );
    const data = await res.json();
    expect(data.roleTermsUnbacked).toEqual(["Workday"]);
  });
});

// ITEM 3 OF THE ADVERSARIAL REVIEW: only two of this route's five response
// paths were covered before this block existed — Gemini points mode
// (non-streaming, above) and embedded points mode (above). Deleting the flag
// spread from any of the four paths below was caught by NOTHING. Each case
// asserts the same present-vs-absent contract the covered paths already pin:
// present, with the right terms, for WORKDAY_QUESTION; absent entirely for
// SCAFFOLDING_QUESTION.
describe("roleTermsUnbacked/roleTermsClaimed — Gemini answer mode, non-streaming (route.js's answer-mode Gemini branch)", () => {
  it("is present when a role term is unbacked", async () => {
    mockSupabase();
    mockGemini(GEMINI_CLAIMS_WORKDAY);
    const res = await POST(jsonRequest({ question: WORKDAY_QUESTION, profile: PROFILE, mode: "answer", engine: "gemini" }));
    const data = await res.json();
    expect(data.roleTermsUnbacked).toEqual(["Workday"]);
    expect(data.roleTermsClaimed).toEqual([1]);
  });

  it("is absent for a scaffolding question", async () => {
    mockSupabase();
    mockGemini({ points: ["Point one.", "Point two."], cues: ["a", "b"], type: "behavioral" });
    const res = await POST(
      jsonRequest({ question: SCAFFOLDING_QUESTION, profile: PROFILE, mode: "answer", engine: "gemini" }),
    );
    const data = await res.json();
    expect(data).not.toHaveProperty("roleTermsUnbacked");
    expect(data).not.toHaveProperty("roleTermsClaimed");
  });
});

describe("roleTermsUnbacked/roleTermsClaimed — embedded answer mode (route.js's answer-mode embedded branch)", () => {
  it("is present, and empty, when the draft quotes the candidate's own page verbatim", async () => {
    // Reuses the FILLER_PAGE/WORKDAY_PAGE divergence fixture (item 2) so this
    // path's own `storyPageText(story)` vs `kb.block` choice is genuinely
    // exercised too, not just the points-mode embedded branch.
    mockSupabase({ pages: [FILLER_PAGE, WORKDAY_PAGE] });
    const res = await POST(
      jsonRequest({ question: WORKDAY_QUESTION, profile: PROFILE, mode: "answer", engine: "embedded" }),
    );
    const data = await res.json();
    expect(data.points.join("\n")).toContain("Workday");
    expect(data.roleTermsUnbacked).toEqual([]);
    expect(getGeminiClient).not.toHaveBeenCalled();
  });

  it("is absent for a scaffolding question", async () => {
    mockSupabase({ pages: [WORKDAY_PAGE] });
    const res = await POST(
      jsonRequest({ question: SCAFFOLDING_QUESTION, profile: PROFILE, mode: "answer", engine: "embedded" }),
    );
    const data = await res.json();
    expect(data).not.toHaveProperty("roleTermsUnbacked");
    expect(data).not.toHaveProperty("roleTermsClaimed");
  });
});

describe("roleTermsUnbacked/roleTermsClaimed — streaming, answer mode (route.js's streamAnswer, isAnswerMode branch)", () => {
  it("is present in the terminal done frame when a role term is unbacked", async () => {
    mockSupabase();
    mockGeminiStream(GEMINI_CLAIMS_WORKDAY);
    const res = await POST(
      jsonRequest({ question: WORKDAY_QUESTION, profile: PROFILE, mode: "answer", engine: "gemini", stream: true }),
    );
    const done = (await readFrames(res)).find((f) => f.t === "done");
    expect(done.roleTermsUnbacked).toEqual(["Workday"]);
    expect(done.roleTermsClaimed).toEqual([1]);
  });

  it("is absent from the terminal done frame for a scaffolding question", async () => {
    mockSupabase();
    mockGeminiStream({ points: ["Point one.", "Point two."], cues: ["a", "b"], type: "behavioral" });
    const res = await POST(
      jsonRequest({
        question: SCAFFOLDING_QUESTION,
        profile: PROFILE,
        mode: "answer",
        engine: "gemini",
        stream: true,
      }),
    );
    const done = (await readFrames(res)).find((f) => f.t === "done");
    expect(done).not.toHaveProperty("roleTermsUnbacked");
    expect(done).not.toHaveProperty("roleTermsClaimed");
  });
});

describe("roleTermsUnbacked/roleTermsClaimed — streaming, points mode (route.js's streamAnswer, live-mode branch)", () => {
  // THIS IS LIVE MODE — the mode the feature exists for (CopilotClient/
  // QuestionFeed always send `stream: true` with no `mode`, which defaults to
  // "points"). It was, until this block existed, the one response path with
  // NO coverage at all for this flag.
  it("is present in the terminal done frame when a role term is unbacked", async () => {
    mockSupabase();
    mockGeminiStream(GEMINI_CLAIMS_WORKDAY);
    const res = await POST(jsonRequest({ question: WORKDAY_QUESTION, profile: PROFILE, engine: "gemini", stream: true }));
    const done = (await readFrames(res)).find((f) => f.t === "done");
    expect(done.roleTermsUnbacked).toEqual(["Workday"]);
    expect(done.roleTermsClaimed).toEqual([1]);
  });

  it("is absent from the terminal done frame for a scaffolding question", async () => {
    mockSupabase();
    mockGeminiStream({ points: ["Point one.", "Point two."], type: "behavioral" });
    const res = await POST(
      jsonRequest({ question: SCAFFOLDING_QUESTION, profile: PROFILE, engine: "gemini", stream: true }),
    );
    const done = (await readFrames(res)).find((f) => f.t === "done");
    expect(done).not.toHaveProperty("roleTermsUnbacked");
    expect(done).not.toHaveProperty("roleTermsClaimed");
  });
});
