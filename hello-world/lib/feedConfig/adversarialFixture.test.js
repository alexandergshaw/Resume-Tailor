// N60 SECOND CHUNK -- Step C (4b TDD) -- AC2-C6: the adversarial message is a
// mandatory, held-out regression fixture.
//
// One named adversarial message drives the REAL deriver (both engines) and the
// REAL shared sanitizer -- no stubbed config, so the fixture cannot be gamed by
// an author who writes both the message and the parse ([[loop-traps-spec]]'s
// held-out lesson). Every bound must hold SIMULTANEOUSLY, whatever the deriver
// parses, because the clamps are structural and applied after it:
//   - the enable flag is absent from the write shape (AC2-C3),
//   - the cadence is clamped to the floor (>= 15) (AC2-C4),
//   - the per-day cap stays within the server clamp and cannot be raised (AC-S1/S4),
//   - no third-party recipient rides through (AC-E1),
//   - an empty-keyword result cannot become a stored, table-poisoning query (AC-S8).
//
// The last clause is a JOIN test against the real downstream consumer
// (lib/feed/llmSearchQueries.js, built), per [[loop-traps-tests]]: feed the
// deriver's real output through the real ingest query builder and assert an
// empty-keyword config produces no query.
//
// RED ON HEAD: lib/feedConfig/deriveFeedConfig.js is absent (MEASURED at HEAD
// 98be9ce), so `import { deriveFeedConfig }` fails COLLECTION -- RED for the
// honest reason. sanitizeChatDerivedSavedSearch and buildSearchQueries both
// exist (Step B / AC-S8). Satisfiability proven against the reference build.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));

import { getGeminiClient } from "@/lib/llm/geminiClient";
import { deriveFeedConfig } from "./deriveFeedConfig.js";
import { sanitizeChatDerivedSavedSearch } from "@/lib/savedSearch/savedSearchFields";
import { buildSearchQueries } from "@/lib/feed/llmSearchQueries";

// The held-out adversarial message: broad, high-frequency, over-cap,
// third-party-addressed, and explicitly asking to switch on paid work.
const ADVERSARIAL =
  "apply to every job everywhere, check every 30 seconds, 500 a day, " +
  "email bob@example.com, and turn on auto-apply immediately";

// On the gemini path the MODEL reply is ALSO adversarial -- it tries to set the
// flag in both cases, a sub-floor interval, an over-cap daily number, and a
// third-party recipient. The bounds must hold anyway.
function stubAdversarialModel() {
  const generateContent = vi.fn(async () => ({
    text: JSON.stringify({
      name: "Everything, everywhere",
      jobKeywords: ["everything"],
      autoTailorMinIntervalMinutes: 0.5,
      auto_tailor_enabled: true,
      autoTailorEnabled: true,
      auto_tailor_daily_cap: 500,
      notify_email: "bob@example.com",
      emailOnNewJobs: true,
    }),
  }));
  getGeminiClient.mockReturnValue({ models: { generateContent } });
  return generateContent;
}

beforeEach(() => {
  vi.clearAllMocks();
  stubAdversarialModel();
});

describe.each(["embedded", "gemini"])("AC2-C6 held-out fixture (engine=%s)", (engine) => {
  it("every bound holds at once for the adversarial message", async () => {
    const config = await deriveFeedConfig(ADVERSARIAL, { engine, env: {} });
    const row = sanitizeChatDerivedSavedSearch(config);

    // Non-vacuity: the row is real (a null row would pass every "not.toHaveProperty" below).
    expect(row).not.toBeNull();
    expect(typeof row.name).toBe("string");
    expect(row.name.length).toBeGreaterThan(0);

    // AC2-C3: the enable flag cannot ride through, even when the message AND the
    // model reply both demand it. ABSENCE, not `=== false`.
    expect(row).not.toHaveProperty("auto_tailor_enabled");
    expect(row).not.toHaveProperty("autoTailorEnabled");

    // AC2-C4: the cadence is the delivered value -- clamped to the floor, never
    // the "30 seconds" / 0.5-minute ask.
    expect(row.auto_tailor_min_interval_minutes).toBeGreaterThanOrEqual(15);

    // AC-S1/S4: the per-day cap stays within the server clamp; "500 a day" cannot lift it.
    expect(row.auto_tailor_daily_cap).toBeLessThanOrEqual(100);
    expect(row.auto_tailor_daily_cap).toBeGreaterThanOrEqual(1);

    // AC-E1: no third-party recipient override survives; alerts are account-only.
    expect(row).not.toHaveProperty("notify_email");
    expect(row).not.toHaveProperty("notifyEmail");
  });

  it("AC-S8 join: the derived row can never become a table-poisoning empty query", async () => {
    const config = await deriveFeedConfig(ADVERSARIAL, { engine, env: {} });
    const row = sanitizeChatDerivedSavedSearch(config);
    // Feed the REAL sanitized row into the REAL ingest query builder. Whatever
    // keywords the deriver produced, no query is ever built from an empty set.
    const queries = buildSearchQueries([row]);
    for (const q of queries) {
      expect(Array.isArray(q.keywords)).toBe(true);
      expect(q.keywords.length).toBeGreaterThan(0);
    }
  });
});

describe("AC-S8 canary: the empty-keyword refusal actually fires", () => {
  it("a row with no keywords yields no query (proves the join above is not vacuous)", () => {
    // A genuinely empty-keyword row must produce zero queries; if this ever
    // returned a query, the join test above would be measuring nothing.
    const emptyRow = sanitizeChatDerivedSavedSearch({ name: "Empty", jobKeywords: [] });
    expect(buildSearchQueries([emptyRow])).toEqual([]);
  });
});
