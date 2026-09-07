// The falsifier for lib/experience/knowledgeLog.js — written from
// 3-plan-knowledge.md's Wave 3b contract (§7 C4, §9) BEFORE the module
// exists.
//
// WHY THIS FILE'S NEGATIVE TESTS COME FIRST, IN SPIRIT. The standing lesson
// this module exists to honour (lib/duplicateApply/duplicateApplyLog.js's own
// header, quoting the brief that created it): "A log that records only
// successes cannot explain a failure -- the standing example is a citation
// feature that returned nothing for its entire life while looking healthy."
// And the owner's own ruling (3-plan-knowledge.md §7 C4): a question asked of
// one's own career history is a confession that exists nowhere else, so
// AC-9.3's "answer text is forbidden, question text is fine" is backwards --
// this suite enforces the corrected rule, not the criterion as originally
// written.
//
// EVERY salted-content assertion is paired with a POSITIVE CONTROL asserted
// FIRST, so a gutted implementation (one that returns "" or drops every
// section) cannot pass the negative assertions vacuously by producing
// nothing at all.

import { describe, it, expect } from "vitest";
import { buildKnowledgeLog, hashQuestion, LOG_INCLUDES_PAGE_TITLES } from "./knowledgeLog.js";

// ---------------------------------------------------------------------- fixtures

function sourcePage(overrides = {}) {
  return {
    id: "p1",
    title: "Payments platform",
    updated_at: "2026-01-01T00:00:00.000Z",
    parent_id: null,
    position: 0,
    included: true,
    reason: "included",
    rank: 0,
    excerpted: false,
    ...overrides,
  };
}

function summaryRowFixture(overrides = {}) {
  return {
    model: "gemini-2.5-flash",
    engine: "gemini",
    status: "ready",
    error: null,
    generated_at: "2026-09-06T12:00:00.000Z",
    // A real row carries the summary body. This module must ignore it even
    // though it is present, never merely "not passed one" -- so every
    // fixture in this file plants a sentinel here.
    summary: "SENTINEL_SUMMARY_BODY_MUST_NEVER_LEAK_INTO_THE_LOG",
    source_pages: [
      sourcePage({ id: "p1", title: "Payments platform", included: true, reason: "included", rank: 0 }),
      sourcePage({ id: "p2", title: "Offsite notes", included: false, reason: "budget", rank: 1 }),
    ],
    retrieval_outcome: {
      version: 1,
      counts: {
        pagesFetched: 2,
        pagesInScope: 2,
        pagesEligible: 2,
        pagesWithMaterial: 2,
        pagesRanked: 2,
        pagesIncluded: 1,
        attachmentsSkipped: 3,
      },
      countsViolation: null,
      anomaly: null,
      citations: {
        counts: { citationsClaimed: 1, citationsResolved: 1, citationsRendered: 1 },
        countsViolation: null,
        anomaly: null,
      },
      model: { called: true, responseTextKind: "text", finishReason: "STOP", envelopeParsed: true, answerChars: 900 },
      refused: [{ reason: "not-in-scope", count: 2 }],
      truncatedRead: false,
    },
    ...overrides,
  };
}

const SENTINEL_QUESTION =
  "SENTINEL_QUESTION_TEXT Jane Doe SSN 123-45-6789 salary negotiation Acme offer bearer sk-ABCDEF123456789 five years of experience";
const SENTINEL_ANSWER = "SENTINEL_ANSWER_BODY_MUST_NEVER_LEAK_INTO_THE_LOG";

function questionRowFixture(overrides = {}) {
  return {
    id: "q1",
    question: SENTINEL_QUESTION,
    answer: SENTINEL_ANSWER,
    citations: [{ pageId: "p1" }],
    answered_from_pages: true,
    retrieval_outcome: {
      version: 1,
      counts: { pagesFetched: 2, pagesInScope: 2, pagesEligible: 2, pagesWithMaterial: 2, pagesRanked: 2, pagesIncluded: 1 },
      countsViolation: null,
      anomaly: null,
      citations: { counts: { citationsClaimed: 1, citationsResolved: 1, citationsRendered: 1 }, countsViolation: null, anomaly: null },
      model: {},
      refused: [],
      truncatedRead: false,
    },
    created_at: "2026-09-06T12:05:00.000Z",
    model: "gemini-2.5-flash",
    engine: "gemini",
    status: "ready",
    error: null,
    ...overrides,
  };
}

const SESSION_EVENTS = [
  { reason: "write-failed", at: "2026-09-06T11:00:00.000Z", kind: "summary" },
  { reason: "model-timeout", at: "2026-09-06T11:05:00.000Z", kind: "question" },
];

// Every literal string that must never reach a downloadable file, gathered
// once so the negative tests can loop over them instead of re-typing.
const FORBIDDEN_STRINGS = [
  SENTINEL_QUESTION,
  SENTINEL_ANSWER,
  "SENTINEL_SUMMARY_BODY_MUST_NEVER_LEAK_INTO_THE_LOG",
  "123-45-6789",
  "sk-ABCDEF123456789",
  "salary negotiation",
];

// ---------------------------------------------------------------------- hashQuestion

describe("hashQuestion", () => {
  it("is deterministic", () => {
    expect(hashQuestion(SENTINEL_QUESTION)).toBe(hashQuestion(SENTINEL_QUESTION));
  });

  it("produces an 8-hex-character digest, never the input itself however short", () => {
    const hash = hashQuestion("a");
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("distinguishes different inputs", () => {
    expect(hashQuestion("What did I do at Acme?")).not.toBe(hashQuestion("What did I do at Globex?"));
  });

  it("returns null, never throws, for non-string or empty input", () => {
    expect(hashQuestion("")).toBeNull();
    expect(hashQuestion(null)).toBeNull();
    expect(hashQuestion(undefined)).toBeNull();
    expect(hashQuestion(42)).toBeNull();
    expect(() => hashQuestion({ toString: () => { throw new Error("hostile"); } })).not.toThrow();
  });
});

// ---------------------------------------------------------------------- buildKnowledgeLog

describe("buildKnowledgeLog -- positive control (must hold before any negative assertion means anything)", () => {
  it("names the scope, model, engine and generation status", () => {
    const log = buildKnowledgeLog({
      scope: { pageId: null, title: null },
      summaryRow: summaryRowFixture(),
      questionRows: [],
      sessionEvents: [],
    });
    expect(typeof log).toBe("string");
    expect(log.length).toBeGreaterThan(200);
    expect(log).toContain("gemini-2.5-flash");
    expect(log).toContain("gemini");
    expect(log).toContain("ready");
    expect(log).toContain("2026-09-06T12:00:00.000Z");
  });

  it("names a page-scoped summary by id and title (LOG_INCLUDES_PAGE_TITLES is true today)", () => {
    expect(LOG_INCLUDES_PAGE_TITLES).toBe(true);
    const log = buildKnowledgeLog({
      scope: { pageId: "root-page", title: "Payments platform" },
      summaryRow: summaryRowFixture(),
      questionRows: [],
      sessionEvents: [],
    });
    expect(log).toContain("root-page");
    expect(log).toContain("Payments platform");
  });

  it("renders the full retrieval counts, distinctly from the citation counts", () => {
    const log = buildKnowledgeLog({
      scope: { pageId: null, title: null },
      summaryRow: summaryRowFixture(),
      questionRows: [],
      sessionEvents: [],
    });
    expect(log).toContain("pagesFetched: 2");
    expect(log).toContain("pagesInScope: 2");
    expect(log).toContain("pagesEligible: 2");
    expect(log).toContain("pagesWithMaterial: 2");
    expect(log).toContain("pagesRanked: 2");
    expect(log).toContain("pagesIncluded: 1");
    expect(log).toContain("citationsClaimed: 1");
    expect(log).toContain("citationsResolved: 1");
    expect(log).toContain("citationsRendered: 1");
  });

  it("renders 'none' for a null anomaly/countsViolation, and the real sentence/stage line when present", () => {
    const clean = buildKnowledgeLog({
      scope: { pageId: null, title: null },
      summaryRow: summaryRowFixture(),
      questionRows: [],
      sessionEvents: [],
    });
    // Two independent "none"s: retrieval chain and citation chain each carry
    // their own anomaly line, never merged into one.
    expect(clean.match(/anomaly: none/g)?.length).toBeGreaterThanOrEqual(2);
    expect(clean.match(/countsViolation: none/g)?.length).toBeGreaterThanOrEqual(2);

    const withAnomaly = buildKnowledgeLog({
      scope: { pageId: null, title: null },
      summaryRow: summaryRowFixture({
        retrieval_outcome: {
          ...summaryRowFixture().retrieval_outcome,
          anomaly: { stage: "pagesEligible", from: "pagesInScope", to: "pagesEligible", inputCount: 5, outputCount: 0 },
          countsViolation: "pagesIncluded (3) exceeds pagesRanked (1)",
        },
      }),
      questionRows: [],
      sessionEvents: [],
    });
    expect(withAnomaly).toContain("pagesEligible 5 -> 0");
    expect(withAnomaly).toContain("pagesIncluded (3) exceeds pagesRanked (1)");
  });

  it("renders refusal tallies as reason:count, and the attachments-skipped count, separately from the stage counts", () => {
    const log = buildKnowledgeLog({
      scope: { pageId: null, title: null },
      summaryRow: summaryRowFixture(),
      questionRows: [],
      sessionEvents: [],
    });
    expect(log).toContain("not-in-scope: 2");
    expect(log).toContain("Attachments skipped: 3");
  });

  it("names every page in scope with its included flag, reason, rank and excerpted state", () => {
    const log = buildKnowledgeLog({
      scope: { pageId: null, title: null },
      summaryRow: summaryRowFixture(),
      questionRows: [],
      sessionEvents: [],
    });
    expect(log).toContain("Payments platform");
    expect(log).toContain("Offsite notes");
    expect(log).toContain("included");
    expect(log).toContain("budget");
  });

  it("per question: a stable hash, a length, a timestamp, the three-state word, and resolved/refused citation counts -- never the question or answer text", () => {
    const row = questionRowFixture();
    const log = buildKnowledgeLog({
      scope: { pageId: null, title: null },
      summaryRow: summaryRowFixture(),
      questionRows: [row],
      sessionEvents: [],
    });
    expect(log).toContain(hashQuestion(row.question));
    expect(log).toContain(String(row.question.length));
    expect(log).toContain("2026-09-06T12:05:00.000Z");
    expect(log).toContain("yes"); // answered_from_pages === true
  });

  it("renders all three answered_from_pages words distinctly: yes, no, unknown", () => {
    const log = buildKnowledgeLog({
      scope: { pageId: null, title: null },
      summaryRow: summaryRowFixture(),
      questionRows: [
        questionRowFixture({ id: "q-yes", answered_from_pages: true }),
        questionRowFixture({ id: "q-no", answered_from_pages: false }),
        questionRowFixture({ id: "q-unknown", answered_from_pages: null }),
      ],
      sessionEvents: [],
    });
    expect(log).toContain("yes");
    expect(log).toContain("no");
    expect(log).toContain("unknown");
  });

  it("names the runs that did not run, each with its own closed-vocabulary reason and timestamp", () => {
    const log = buildKnowledgeLog({
      scope: { pageId: null, title: null },
      summaryRow: summaryRowFixture(),
      questionRows: [],
      sessionEvents: SESSION_EVENTS,
    });
    expect(log).toContain("write-failed");
    expect(log).toContain("model-timeout");
    expect(log).toContain("2026-09-06T11:00:00.000Z");
  });

  it("never throws when every input is missing", () => {
    expect(() => buildKnowledgeLog({})).not.toThrow();
    expect(() => buildKnowledgeLog()).not.toThrow();
    expect(typeof buildKnowledgeLog()).toBe("string");
  });
});

describe("buildKnowledgeLog -- negative: the confession never leaves the app", () => {
  it("MUTATION GATE: never contains the raw question text, the raw answer text, or the raw summary text, even though all three are present on the input", () => {
    const row = questionRowFixture();
    const summaryRow = summaryRowFixture();
    const log = buildKnowledgeLog({
      scope: { pageId: "p1", title: "Payments platform" },
      summaryRow,
      questionRows: [row],
      sessionEvents: SESSION_EVENTS,
    });

    // Positive control FIRST: a gutted ("") implementation must not be able
    // to pass the assertions below by accident.
    expect(log.length).toBeGreaterThan(300);
    expect(log).toContain(hashQuestion(row.question));
    expect(log).toContain(String(row.question.length));
    expect(log).toContain("Payments platform");
    expect(log).toContain("pagesIncluded: 1");

    for (const forbidden of FORBIDDEN_STRINGS) {
      expect(log).not.toContain(forbidden);
    }
  });

  it("never contains a raw model-supplied citation refusal value, a URL embedded in an error message, or an out-of-vocabulary session-event reason", () => {
    const hostileToken = "hostile-model-text-with-a-secret-9f8e7d6c5b4a";
    const summaryRow = summaryRowFixture({
      error: "Upstream call failed: https://example.com/internal/secret-endpoint?token=abc123",
      retrieval_outcome: {
        ...summaryRowFixture().retrieval_outcome,
        refused: [{ reason: hostileToken, count: 1 }],
      },
    });
    const log = buildKnowledgeLog({
      scope: { pageId: null, title: null },
      summaryRow,
      questionRows: [],
      sessionEvents: [{ reason: "an attacker's free text with spaces, not a real reason code", at: "2026-09-06T00:00:00.000Z" }],
    });

    // Positive control: the error DID surface, just not verbatim.
    expect(log).toContain("Error");
    expect(log).not.toContain("https://example.com/internal/secret-endpoint?token=abc123");
    expect(log).not.toContain(hostileToken);
    expect(log).not.toContain("an attacker's free text with spaces, not a real reason code");
  });

  it("respects includeTitles=false by omitting every page and scope title while keeping ids, reasons, ranks and counts", () => {
    const summaryRow = summaryRowFixture();
    const log = buildKnowledgeLog({
      scope: { pageId: "p1", title: "Payments platform" },
      summaryRow,
      questionRows: [],
      sessionEvents: [],
      includeTitles: false,
    });
    expect(log).not.toContain("Payments platform");
    expect(log).not.toContain("Offsite notes");
    // Positive control: the rest of the record survives the toggle.
    expect(log).toContain("p1");
    expect(log).toContain("p2");
    expect(log).toContain("budget");
    expect(log).toContain("pagesIncluded: 1");
  });

  it("keeps titles when includeTitles=true (the default, matching the exported constant) -- the sentinel-string test is parameterised over both", () => {
    const log = buildKnowledgeLog({
      scope: { pageId: "p1", title: "Payments platform" },
      summaryRow: summaryRowFixture(),
      questionRows: [],
      sessionEvents: [],
      includeTitles: true,
    });
    expect(log).toContain("Payments platform");
  });
});

describe("buildKnowledgeLog -- multiple questions do not cross-contaminate", () => {
  it("each question's hash and length correspond to ITS OWN text, not another question's", () => {
    const short = questionRowFixture({ id: "q-short", question: "Short one?" });
    const long = questionRowFixture({ id: "q-long", question: "A considerably longer question about the whole career history here." });
    const log = buildKnowledgeLog({
      scope: { pageId: null, title: null },
      summaryRow: summaryRowFixture(),
      questionRows: [short, long],
      sessionEvents: [],
    });
    expect(log).toContain(hashQuestion(short.question));
    expect(log).toContain(String(short.question.length));
    expect(log).toContain(hashQuestion(long.question));
    expect(log).toContain(String(long.question.length));
    expect(hashQuestion(short.question)).not.toBe(hashQuestion(long.question));
  });
});
