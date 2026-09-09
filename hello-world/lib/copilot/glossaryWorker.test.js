// R-347, R-354, R-371, R-372, R-379 -- the cron worker.
//
// THE DEFECT THIS MODULE EXISTS TO FIX. Ten grounded calls at ~92 s worst case
// each cannot fit one serverless invocation, and the predecessor design
// scheduled none of them: it applied a 24-hour retry gate to every attempt and a
// 50% "research floor" to rows that had not FINISHED, so a posting completed at
// most one 120-second slice of research per day and settled permanently at ~50%.
// `ready` -- defined as `recalled_count = 0` and enforced by a database CHECK --
// was ARITHMETICALLY UNREACHABLE, while every gate and every panel line reasoned
// about it. AC-SCH9's test below is the one that walks the design to its own
// success state, and its absence is how that shipped.
//
// The worker takes an injected clock and an injected store, so the whole
// schedule is testable with no timer, no network and no database. The cron route
// is a thin shell over it.

import { describe, it, expect, vi } from "vitest";
import {
  runGlossaryWorker,
  researchRowToDeadline,
  batchOf,
} from "./glossaryWorker.js";
import { RESEARCH_BATCH_SIZE, BATCH_WORST_CASE_MS } from "./glossaryConstants.js";

const enc = new TextEncoder();
const B = (s) => enc.encode(s).length;

// ---------------------------------------------------------------------------
// A stub Interactions client that answers whatever batch it is handed, citing
// every definition it writes. It parses the numbered term list back out of the
// prompt, so a worker that sent the wrong batch produces the wrong response and
// the tests notice.
// ---------------------------------------------------------------------------
function citingClient({ cite = true, searched = true, status = "completed" } = {}) {
  const create = vi.fn(async ({ input }) => {
    const count = (String(input).match(/^\s*\d{1,3}\.\s/gm) || []).length;
    const defs = Array.from(
      { length: count },
      (_, i) =>
        `${i + 1}. A precise and non-compositional explanation of the ${i + 1}th term in this batch, at length.`,
    );
    const text = defs.join("\n");
    const annotations = [];
    if (cite) {
      let cursor = 0;
      for (const lineText of defs) {
        const bodyStart = cursor + lineText.indexOf(". ") + 2;
        const bodyEnd = cursor + lineText.length;
        annotations.push({
          type: "url_citation",
          url: "https://en.wikipedia.org/wiki/Idempotence",
          title: "Idempotence",
          start_index: B(text.slice(0, bodyStart)),
          end_index: B(text.slice(0, bodyEnd)),
        });
        cursor += lineText.length + 1;
      }
    }
    return {
      status,
      steps: [
        ...(searched ? [{ type: "google_search_call" }] : []),
        { type: "model_output", content: [{ type: "text", text, annotations }] },
      ],
      output_text: text,
      usage: { total_input_tokens: 12_800, total_output_tokens: 1_080, grounding_tool_count: 1 },
    };
  });
  return { client: { interactions: { create } }, create };
}

const termAt = (i) => ({
  term: `non compositional concept ${i}`,
  kind: "anticipated",
  category: "terminology",
  parent: "PostgreSQL",
  anchor_quote: "You will own our PostgreSQL estate.",
  definition: "A recalled definition that the harvest produced without any source at all, in prose.",
  provenance: "recalled",
});

function seededRow(termCount = 120) {
  const terms = Array.from({ length: termCount }, (_, i) => termAt(i));
  return {
    position_id: "p1",
    status: "partial",
    terms,
    researched_count: 0,
    recalled_count: termCount,
    research_cursor: 0,
    research_total: Math.ceil(termCount / RESEARCH_BATCH_SIZE),
    research_batches: 0,
    unsearched_batches: 0,
    malformed_batches: 0,
    model_calls_fingerprint: 1,
    model_calls_total: 1,
    attempts: 1,
    posting_fingerprint: "fp1",
    refusal_reasons: {},
    usage_totals: null,
  };
}

// A store port. The worker never sees Supabase.
function fakeStore(rows) {
  const state = new Map(rows.map((r) => [r.position_id, { ...r }]));
  const leases = new Map();
  const writes = [];
  return {
    state,
    writes,
    leases,
    circuitOpenValue: false,
    async selectQueue() {
      return [...state.values()].filter((r) => r.research_cursor < r.research_total);
    },
    async acquireLease(positionId, { now }) {
      const held = leases.get(positionId);
      if (held && held > now) return { row: null };
      leases.set(positionId, now + 330_000);
      return { row: { ...state.get(positionId) } };
    },
    async releaseLease(positionId) {
      leases.delete(positionId);
    },
    async writeRow(positionId, fields) {
      writes.push({ positionId, fields });
      Object.assign(state.get(positionId), fields);
      return { error: null };
    },
    async circuitOpen() {
      return this.circuitOpenValue;
    },
  };
}

// A clock that advances by a fixed amount every time the client is called.
function steppedClock(startMs, stepMs, hooks) {
  let now = startMs;
  hooks.advance = () => {
    now += stepMs;
  };
  return () => now;
}

describe("batchOf slices the recalled terms the cursor points at", () => {
  it("takes RESEARCH_BATCH_SIZE terms at the cursor offset", () => {
    const row = seededRow(120);
    expect(batchOf(row, 0)).toHaveLength(RESEARCH_BATCH_SIZE);
    expect(batchOf(row, 9)).toHaveLength(RESEARCH_BATCH_SIZE);
    expect(batchOf(row, 9)[0].term).toBe("non compositional concept 108");
  });

  it("returns a short final batch rather than padding it", () => {
    const row = seededRow(20);
    expect(batchOf(row, 1)).toHaveLength(8);
  });
});

describe("AC-SCH9 / R-372: `ready` IS reachable", () => {
  it("drives a 120-term row to ready over repeated invocations", async () => {
    const store = fakeStore([seededRow(120)]);
    const { client, create } = citingClient();
    const hooks = {};
    const clock = steppedClock(0, 1_000, hooks);
    const model = "gemini-2.5-flash";

    for (let invocation = 0; invocation < 20; invocation += 1) {
      const row = store.state.get("p1");
      if (row.research_cursor >= row.research_total) break;
      await runGlossaryWorker({ store, client, model, clock, onCall: hooks.advance });
    }

    const row = store.state.get("p1");
    expect(row.research_cursor).toBe(row.research_total);
    expect(row.recalled_count).toBe(0);
    expect(row.researched_count).toBe(120);
    expect(row.status).toBe("ready");
    // The database CHECK's third clause, asserted in JS so the two cannot drift.
    expect(row.terms.some((t) => t.provenance === "recalled")).toBe(false);
    expect(create).toHaveBeenCalledTimes(10);
  });

  it("writes after EVERY batch, so a worker killed mid-run keeps its paid work", async () => {
    // AC-S9. Six batches of paid research must be durably stored, and the next
    // invocation must start at 6 rather than at 0.
    const store = fakeStore([seededRow(120)]);
    const { client } = citingClient();
    const hooks = {};
    const clock = steppedClock(0, 1_000, hooks);
    await researchRowToDeadline({
      row: store.state.get("p1"),
      store,
      client,
      model: "m",
      clock,
      deadlineAt: Infinity,
      maxBatches: 6,
      onCall: hooks.advance,
    });
    const row = store.state.get("p1");
    expect(row.research_cursor).toBe(6);
    expect(row.researched_count).toBe(72);
    expect(store.writes).toHaveLength(6);
    expect(row.status).toBe("partial");
  });
});

describe("AC-SCH3 / R-372: the deadline, not a count, bounds an invocation", () => {
  it("runs exactly two worst-case batches in one invocation", async () => {
    const store = fakeStore([seededRow(120)]);
    const { client, create } = citingClient();
    const hooks = {};
    // Each call consumes the full 92 s worst case.
    const clock = steppedClock(0, BATCH_WORST_CASE_MS, hooks);
    await runGlossaryWorker({ store, client, model: "m", clock, onCall: hooks.advance });
    expect(create).toHaveBeenCalledTimes(2);
    expect(store.state.get("p1").research_cursor).toBe(2);
  });

  it("runs the whole generation in one invocation when every batch is fast", async () => {
    const store = fakeStore([seededRow(120)]);
    const { client, create } = citingClient();
    const hooks = {};
    const clock = steppedClock(0, 12_000, hooks);
    await runGlossaryWorker({ store, client, model: "m", clock, onCall: hooks.advance });
    expect(create).toHaveBeenCalledTimes(10);
    expect(store.state.get("p1").status).toBe("ready");
  });
});

describe("R-371: the lease", () => {
  it("makes ZERO calls for a row another invocation already holds", async () => {
    const store = fakeStore([seededRow(120)]);
    store.leases.set("p1", Number.MAX_SAFE_INTEGER);
    const { client, create } = citingClient();
    await runGlossaryWorker({ store, client, model: "m", clock: () => 0 });
    expect(create).not.toHaveBeenCalled();
    expect(store.state.get("p1").research_cursor).toBe(0);
  });

  it("releases the lease in a finally, even when the batch throws", async () => {
    const store = fakeStore([seededRow(120)]);
    const client = { interactions: { create: vi.fn(async () => { throw new Error("transport down"); }) } };
    await runGlossaryWorker({ store, client, model: "m", clock: () => 0 });
    expect(store.leases.has("p1")).toBe(false);
  });
});

describe("R-347 / AC-SCH7: a batch that did not SEARCH is a mechanism failure", () => {
  it("retries it exactly once, then advances the cursor and counts it", async () => {
    const store = fakeStore([seededRow(24)]);
    const { client, create } = citingClient({ searched: false });
    const hooks = {};
    const clock = steppedClock(0, 1_000, hooks);
    await runGlossaryWorker({ store, client, model: "m", clock, onCall: hooks.advance });
    const row = store.state.get("p1");
    // Batch 0 attempted twice, batch 1 attempted twice: 4 calls, 2 batches.
    expect(create).toHaveBeenCalledTimes(4);
    expect(row.research_cursor).toBe(2);
    expect(row.unsearched_batches).toBe(2);
    expect(row.recalled_count).toBe(24);
    expect(row.status).not.toBe("ready");
  });

  it("NEVER retries a batch that searched and simply found nothing to cite", async () => {
    // That is a sourcing outcome, not a mechanism failure; retrying it spends
    // money to learn the same thing.
    const store = fakeStore([seededRow(24)]);
    const { client, create } = citingClient({ cite: false });
    const hooks = {};
    const clock = steppedClock(0, 1_000, hooks);
    await runGlossaryWorker({ store, client, model: "m", clock, onCall: hooks.advance });
    expect(create).toHaveBeenCalledTimes(2);
    expect(store.state.get("p1").unsearched_batches).toBe(0);
  });

  it("bounds mechanism retries across the whole generation", async () => {
    const store = fakeStore([seededRow(120)]);
    const { client, create } = citingClient({ searched: false });
    const hooks = {};
    const clock = steppedClock(0, 1_000, hooks);
    await runGlossaryWorker({ store, client, model: "m", clock, onCall: hooks.advance });
    // 10 batches; only the first three may buy a second attempt.
    expect(create.mock.calls.length).toBeLessThanOrEqual(13);
  });
});

describe("R-374 / AC-R35: one malformed batch never fails the row", () => {
  it("advances the cursor, counts it, and keeps the harvest definitions", async () => {
    const store = fakeStore([seededRow(24)]);
    const client = {
      interactions: {
        create: vi.fn(async () => ({ status: "completed", steps: "not an array" })),
      },
    };
    const hooks = {};
    const clock = steppedClock(0, 1_000, hooks);
    await runGlossaryWorker({ store, client, model: "m", clock, onCall: hooks.advance });
    const row = store.state.get("p1");
    expect(row.research_cursor).toBe(2);
    expect(row.status).toBe("partial");
    expect(row.terms.every((t) => t.provenance === "recalled")).toBe(true);
  });
});

describe("R-354 / AC-R25: budget_exceeded stops the worker without burning an attempt", () => {
  it("does not increment attempts and stops this invocation", async () => {
    const store = fakeStore([seededRow(120)]);
    const before = store.state.get("p1").attempts;
    const { client, create } = citingClient({ status: "budget_exceeded", cite: false });
    const hooks = {};
    const clock = steppedClock(0, 1_000, hooks);
    await runGlossaryWorker({ store, client, model: "m", clock, onCall: hooks.advance });
    const row = store.state.get("p1");
    expect(row.attempts).toBe(before);
    expect(row.reason).toBe("budget-exceeded");
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("R-379 / AC-C19: the circuit breaker", () => {
  it("refuses to start new work while the circuit is open", async () => {
    const store = fakeStore([seededRow(120)]);
    store.circuitOpenValue = true;
    const { client, create } = citingClient();
    const summary = await runGlossaryWorker({ store, client, model: "m", clock: () => 0 });
    expect(create).not.toHaveBeenCalled();
    expect(summary.reason).toBe("circuit-open");
  });
});

describe("AC-C23 / R-355: usage is measured, and a missing usage is null and never zero", () => {
  it("aggregates the four figures across batches", async () => {
    const store = fakeStore([seededRow(24)]);
    const { client } = citingClient();
    const hooks = {};
    const clock = steppedClock(0, 1_000, hooks);
    await runGlossaryWorker({ store, client, model: "m", clock, onCall: hooks.advance });
    const totals = store.state.get("p1").usage_totals;
    expect(totals.total_input_tokens).toBe(25_600);
    expect(totals.total_output_tokens).toBe(2_160);
    expect(totals.grounding_tool_count).toBe(2);
  });

  it("degrades a missing usage object to null, never to 0", async () => {
    // A zero that means "we could not measure" and a zero that means "nothing
    // was spent" must not be the same value.
    const store = fakeStore([seededRow(12)]);
    const client = {
      interactions: {
        create: vi.fn(async () => ({
          status: "completed",
          steps: [
            { type: "google_search_call" },
            { type: "model_output", content: [{ type: "text", text: "", annotations: [] }] },
          ],
        })),
      },
    };
    const hooks = {};
    const clock = steppedClock(0, 1_000, hooks);
    await runGlossaryWorker({ store, client, model: "m", clock, onCall: hooks.advance });
    expect(store.state.get("p1").usage_totals.total_input_tokens).toBe(null);
  });
});

describe("the call caps bound the worker where they cannot be bypassed (AC-C16')", () => {
  it("stops before exceeding the per-fingerprint cap", async () => {
    const row = seededRow(120);
    row.model_calls_fingerprint = 41;
    row.model_calls_total = 41;
    const store = fakeStore([row]);
    const { client, create } = citingClient();
    const hooks = {};
    const clock = steppedClock(0, 1_000, hooks);
    await runGlossaryWorker({ store, client, model: "m", clock, onCall: hooks.advance });
    expect(create).toHaveBeenCalledTimes(1);
    expect(store.state.get("p1").model_calls_fingerprint).toBe(42);
  });

  it("stops before exceeding the absolute lifetime cap even when the fingerprint cap allows", async () => {
    const row = seededRow(120);
    row.model_calls_fingerprint = 0;
    row.model_calls_total = 126;
    const store = fakeStore([row]);
    const { client, create } = citingClient();
    await runGlossaryWorker({ store, client, model: "m", clock: () => 0 });
    expect(create).not.toHaveBeenCalled();
  });
});
