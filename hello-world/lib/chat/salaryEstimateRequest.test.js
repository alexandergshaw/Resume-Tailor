import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// N65 step 2 — the client orchestrator `requestSalaryEstimate`.
//
// It fires ONE request to /api/salary-estimate, appends the two transcript turns
// (one click => user turn + assistant turn, S12), and RECORDS the decision for
// EVERY outcome, not only success (S10). The owner's original hole was a
// decision that ended in nothing and left no trace, so the withhold / refuse /
// fail paths recording their outcome is the point of this seam, and the field
// set it records must carry NO estimated number, company, URL or title (privacy,
// activityChannels.js's N77 precedent).
//
// RED ON HEAD: lib/chat/salaryEstimateRequest.js does not exist — collection red.

vi.mock("@/lib/activityLog/appActivityLog", () => ({ recordDecision: vi.fn() }));

import { recordDecision } from "@/lib/activityLog/appActivityLog";
import { requestSalaryEstimate } from "./salaryEstimateRequest.js";

const POSTING = {
  title: "Senior Platform Engineer",
  company: "Acme",
  location: "Remote (US)",
  salaryStated: false,
};

const ESTIMATED = {
  status: "estimated",
  reason: "ok",
  range: { min: 100000, max: 120000 },
  basisKind: "comparable",
  sourceCount: 2,
  citations: [
    { url: "https://www.levels.fyi/company/acme/salaries", title: "Acme salaries", host: "levels.fyi" },
    { url: "https://www.glassdoor.com/Salary/acme", title: "Acme pay", host: "glassdoor.com" },
  ],
  searched: true,
  truncated: false,
};

const withStatus = (status, extra = {}) => ({
  status,
  reason: extra.reason || "ok",
  range: null,
  basisKind: "none",
  sourceCount: 0,
  citations: [],
  searched: false,
  truncated: false,
  ...extra,
});

let messages;
let setChatMessages;
let setChatError;
let fetchSpy;

function respondWith(estimate) {
  fetchSpy = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ salaryEstimate: estimate }),
  });
  globalThis.fetch = fetchSpy;
}

function rejectFetch(error = new Error("network down")) {
  fetchSpy = vi.fn().mockRejectedValue(error);
  globalThis.fetch = fetchSpy;
}

async function run(estimate, posting = POSTING) {
  respondWith(estimate);
  await requestSalaryEstimate({ posting, engine: "gemini", setChatMessages, setChatError });
}

const lastDecision = () => recordDecision.mock.calls[recordDecision.mock.calls.length - 1];
const assistantTurn = () => messages.find((m) => m.role === "assistant");

let originalFetch;

beforeEach(() => {
  vi.clearAllMocks();
  originalFetch = globalThis.fetch;
  messages = [];
  setChatMessages = vi.fn((updater) => {
    messages = typeof updater === "function" ? updater(messages) : updater;
  });
  setChatError = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("requestSalaryEstimate — the request it sends (S1/S12)", () => {
  it("POSTs the pinned posting to /api/salary-estimate with salaryStated:false", async () => {
    await run(ESTIMATED);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/api/salary-estimate");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      engine: "gemini",
      title: "Senior Platform Engineer",
      company: "Acme",
      salaryStated: false,
    });
  });
});

describe("requestSalaryEstimate — one click, two turns (S12)", () => {
  it("appends a user turn and an assistant turn carrying the structured estimate", async () => {
    await run(ESTIMATED);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].salaryEstimate).toEqual(ESTIMATED);
  });

  it("the assistant framing is app-authored, not the model's prose", async () => {
    await run(ESTIMATED);
    const turn = assistantTurn();
    expect(typeof turn.content).toBe("string");
    expect(turn.content.length).toBeGreaterThan(0);
    // The structured range is rendered by the panel from `salaryEstimate`, not
    // spelled into the framing string.
    expect(turn.content).not.toContain("100000");
    expect(turn.content).not.toContain("ESTIMATE:");
  });
});

describe("requestSalaryEstimate — S10: every outcome is recorded, PII-free", () => {
  it("records 'acted' for an estimated result", async () => {
    await run(ESTIMATED);
    const [id, outcome] = lastDecision();
    expect(id).toBe("salary-estimate");
    expect(outcome).toBe("acted");
  });

  it("records 'skipped' for a withheld (insufficient sources) result", async () => {
    await run(withStatus("insufficient_sources", { reason: "no_sources" }));
    expect(lastDecision()[1]).toBe("skipped");
  });

  it("records 'refused' for the embedded-unavailable result", async () => {
    await run(withStatus("unavailable_embedded", { reason: "embedded" }));
    expect(lastDecision()[1]).toBe("refused");
  });

  it("records 'refused' for a stated-pay refusal", async () => {
    await run(withStatus("refused_stated", { reason: "stated" }));
    expect(lastDecision()[1]).toBe("refused");
  });

  it("records 'failed' for a provider failure", async () => {
    await run(withStatus("failed", { reason: "provider_error" }));
    expect(lastDecision()[1]).toBe("failed");
  });

  it("records the decision with NO estimated number, company, URL or title", async () => {
    await run(ESTIMATED);
    const fields = lastDecision()[2] || {};
    const keys = Object.keys(fields);
    // Closed vocabulary only.
    for (const k of keys) expect(["reason", "citationCount", "basisKind"]).toContain(k);
    // And explicitly none of the disclosure-bearing values.
    const serialized = JSON.stringify(fields);
    expect(serialized).not.toContain("Acme");
    expect(serialized).not.toContain("100000");
    expect(serialized).not.toContain("levels.fyi");
    expect(serialized).not.toContain("glassdoor");
  });
});

describe("requestSalaryEstimate — S14: a network failure is a degraded state, not a $0 negative", () => {
  it("synthesizes a failure the caller can render, and records 'failed'", async () => {
    rejectFetch();
    await requestSalaryEstimate({ posting: POSTING, engine: "gemini", setChatMessages, setChatError });
    const turn = assistantTurn();
    expect(turn).toBeTruthy();
    // "couldn't retrieve / couldn't check", never a confident negative.
    expect(turn.content).toMatch(/couldn'?t (retrieve|check|reach)|try again/i);
    expect(turn.content).not.toMatch(/\$0\b/);
    expect(turn.content).not.toMatch(/pays? nothing|no salary data|pays badly/i);
    expect(lastDecision()[1]).toBe("failed");
  });

  it("a withheld result reads as 'not enough data', never as 'pays nothing'", async () => {
    await run(withStatus("insufficient_sources", { reason: "no_sources" }));
    const turn = assistantTurn();
    expect(turn.content).toMatch(/couldn'?t find enough|not enough (data|salary)/i);
    expect(turn.content).not.toMatch(/\$0\b/);
    expect(turn.content).not.toMatch(/pays? nothing|no salary data|pays badly/i);
  });
});
