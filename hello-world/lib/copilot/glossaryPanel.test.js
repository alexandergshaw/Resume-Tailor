// AC-T8 -- the sixteen row states, one plain-text line each, and only the four
// retryable ones offering a control.
//
// WHY SIXTEEN AND NOT NINE. Three of these states exist because their ABSENCE
// is how a feature ships as a mystery: a rebuild limit with no line is a
// permanently dead button; a cooldown with no line is a button that silently
// does nothing for an hour; and a cron that is not running at all is invisible
// from the outside. Each is asserted to render a line and NO control.

import { describe, it, expect } from "vitest";

import { glossaryPanelState, GLOSSARY_PANEL_ROWS, RETRY, REBUILD } from "./glossaryPanel.js";
import { WORKER_STALL_MS, GENERATION_COOLDOWN_MS } from "./glossaryConstants.js";

const NOW = Date.parse("2026-09-09T12:00:00.000Z");
const ago = (ms) => new Date(NOW - ms).toISOString();

const row = (over = {}) => ({
  status: "partial",
  reason: null,
  terms: Array.from({ length: 120 }, (_, i) => ({ term: `t${i}` })),
  researched_count: 70,
  recalled_count: 50,
  research_cursor: 10,
  research_total: 10,
  research_batches: 10,
  truncated_reason: null,
  queued_at: ago(5 * 60_000),
  last_generation_at: ago(4 * 3_600_000),
  researched_at: "2026-09-08T09:30:00.000Z",
  updated_at: "2026-09-08T09:30:00.000Z",
  dropped_count: 0,
  ...over,
});

const at = (r, options = {}) => glossaryPanelState(r, { now: NOW, ...options });

describe("every state has a line, and the enumeration is the source of truth", () => {
  it("declares exactly sixteen row states, each distinct", () => {
    expect(GLOSSARY_PANEL_ROWS).toHaveLength(16);
    expect(new Set(GLOSSARY_PANEL_ROWS).size).toBe(16);
    expect(Object.isFrozen(GLOSSARY_PANEL_ROWS)).toBe(true);
  });

  it("reaches all sixteen from a real row, and numbers each 1..16", () => {
    const reached = new Map();
    const record = (state) => reached.set(state.key, state);

    record(at(null));
    record(at(row({ research_cursor: 4 })));
    record(at(row()));
    record(at(row({ researched_count: 20, recalled_count: 100 })));
    record(at(row({ researched_count: 0, recalled_count: 120, research_batches: 0 })));
    record(at(row({ status: "ready", recalled_count: 0, researched_count: 120 })));
    record(at(row({ truncated_reason: "model" })));
    record(at(row({ truncated_reason: "ceiling", dropped_count: 14 })));
    record(at(row({ truncated_reason: "bytes", dropped_count: 3 })));
    record(at(row(), { staleFingerprint: true }));
    record(at(row({ status: "quotes-only" })));
    record(at(row({ status: "unavailable" })));
    record(at(row({ status: "failed" })));
    record(at(row({ status: "failed" }), { atCallCap: true }));
    record(at(row({ status: "failed", last_generation_at: ago(10 * 60_000) })));
    record(at(row({ research_cursor: 0, research_total: 10, queued_at: ago(WORKER_STALL_MS + 60_000) })));

    expect([...reached.keys()].sort()).toEqual([...GLOSSARY_PANEL_ROWS].sort());
    for (const [key, state] of reached) {
      expect({ key, row: state.row }).toEqual({ key, row: GLOSSARY_PANEL_ROWS.indexOf(key) + 1 });
      // Not an icon and not a colour: one plain sentence, always.
      expect(state.line.length).toBeGreaterThan(20);
      expect(state.line).toMatch(/[.!]$/);
    }
  });

  it("offers a control on exactly the four retryable states, and on no other", () => {
    const withControl = new Map([
      ["below-floor", RETRY],
      ["unsearched", RETRY],
      ["truncated-model", RETRY],
      ["stale", REBUILD],
      ["failed", REBUILD],
    ]);
    const states = {
      none: at(null),
      "in-flight": at(row({ research_cursor: 4 })),
      "above-floor": at(row()),
      "below-floor": at(row({ researched_count: 20, recalled_count: 100 })),
      unsearched: at(row({ researched_count: 0, recalled_count: 120, research_batches: 0 })),
      ready: at(row({ status: "ready", recalled_count: 0 })),
      "truncated-model": at(row({ truncated_reason: "model" })),
      "truncated-ceiling": at(row({ truncated_reason: "ceiling" })),
      "truncated-bytes": at(row({ truncated_reason: "bytes" })),
      stale: at(row(), { staleFingerprint: true }),
      "quotes-only": at(row({ status: "quotes-only" })),
      unavailable: at(row({ status: "unavailable" })),
      failed: at(row({ status: "failed" })),
      "call-cap": at(row({ status: "failed" }), { atCallCap: true }),
      cooldown: at(row({ status: "failed", last_generation_at: ago(10 * 60_000) })),
      "worker-stalled": at(row({ research_cursor: 0, queued_at: ago(WORKER_STALL_MS + 60_000) })),
    };
    for (const [key, state] of Object.entries(states)) {
      expect({ key, control: state.control }).toEqual({ key, control: withControl.get(key) ?? null });
    }
  });
});

describe("the three states that exist so a dead button never ships", () => {
  it("a row at its call cap says so, and offers NO control", () => {
    const state = at(row({ status: "failed" }), { atCallCap: true });
    expect(state.key).toBe("call-cap");
    expect(state.control).toBeNull();
    expect(state.line).toContain("rebuild limit");
  });

  it("a row inside its cooldown names the time it can be rebuilt, and offers NO control", () => {
    const state = at(row({ status: "failed", last_generation_at: ago(10 * 60_000) }));
    expect(state.key).toBe("cooldown");
    expect(state.control).toBeNull();
    expect(state.line).toMatch(/after \d\d:\d\d\./);
    // Just outside the window the control comes back -- so the gate is a real
    // comparison rather than a permanent suppression.
    const later = at(row({ status: "failed", last_generation_at: ago(GENERATION_COOLDOWN_MS + 1000) }));
    expect(later.key).toBe("failed");
    expect(later.control).toBe(REBUILD);
  });

  it("a row whose worker never started says something is wrong on OUR side", () => {
    const stalled = at(row({ research_cursor: 0, research_total: 10, queued_at: ago(WORKER_STALL_MS + 1) }));
    expect(stalled.key).toBe("worker-stalled");
    expect(stalled.control).toBeNull();
    // Not vacuous: the same row queued a minute ago is simply in flight.
    const fresh = at(row({ research_cursor: 0, research_total: 10, queued_at: ago(60_000) }));
    expect(fresh.key).toBe("in-flight");
  });
});

describe("the lines say what the reader needs, in numbers", () => {
  it("the resting state states the split and says the rest are labelled", () => {
    // The honest headline of the whole design: about half carry a source, and
    // the other half say so on their own cards.
    expect(at(row()).line).toBe(
      "70 of 120 terms have a source. The other 50 are general definitions with no source — they are labelled.",
    );
  });

  it("an in-flight row counts progress without promising a finish time", () => {
    expect(at(row({ research_cursor: 4, researched_count: 30 })).line).toBe(
      "120 terms are ready. Sources are still being added — 30 of 120 so far.",
    );
  });

  it("a ready row names the date it was collected", () => {
    expect(at(row({ status: "ready", recalled_count: 0 })).line).toBe(
      "120 terms, each with a source, on 2026-09-08.",
    );
  });

  it("the embedded row explains how to escape it", () => {
    const line = at(row({ status: "quotes-only" })).line;
    expect(line).toContain("quotes the posting instead of looking terms up");
    expect(line).toContain("Switch to the Gemini engine and press Rebuild");
  });
});

describe("AC-R16' -- no line uses one of the five forbidden words", () => {
  it("sweeps every reachable line, with a positive control", () => {
    const FORBIDDEN = ["verified", "confirmed", "corroborated", "sourced from", "researched"];
    const lines = [
      at(null),
      at(row({ research_cursor: 4 })),
      at(row()),
      at(row({ researched_count: 20, recalled_count: 100 })),
      at(row({ researched_count: 0, recalled_count: 120, research_batches: 0 })),
      at(row({ status: "ready", recalled_count: 0 })),
      at(row({ truncated_reason: "model" })),
      at(row({ truncated_reason: "ceiling" })),
      at(row({ truncated_reason: "bytes" })),
      at(row(), { staleFingerprint: true }),
      at(row({ status: "quotes-only" })),
      at(row({ status: "unavailable" })),
      at(row({ status: "failed" })),
      at(row({ status: "failed" }), { atCallCap: true }),
      at(row({ status: "failed", last_generation_at: ago(10 * 60_000) })),
      at(row({ research_cursor: 0, queued_at: ago(WORKER_STALL_MS + 1) })),
    ].map((s) => s.line.toLowerCase());
    expect(lines).toHaveLength(16);
    for (const line of lines) {
      for (const word of FORBIDDEN) {
        expect({ line, word, found: line.includes(word) }).toEqual({ line, word, found: false });
      }
    }
    // The sweep can fail: the specification's own draft of the "no row" line
    // said "have not been researched yet", and it would have tripped this.
    expect("terms for this posting have not been researched yet.".includes("researched")).toBe(true);
  });
});

describe("degenerate rows never throw on a live interview surface", () => {
  it("survives a missing row, a row of the wrong type, and missing counters", () => {
    for (const bad of [null, undefined, "row", 7, {}, { status: "partial" }]) {
      expect(() => at(bad)).not.toThrow();
    }
    // A row carrying no terms reads as no row: a line saying "0 of 0 terms
    // have a source" is worse than saying nothing has been collected.
    expect(at({}).key).toBe("none");
    expect(at({ status: "partial", terms: [{ term: "x" }], queued_at: "not a date", research_total: 10, research_cursor: 0 }).key).toBe(
      "in-flight",
    );
  });
});
