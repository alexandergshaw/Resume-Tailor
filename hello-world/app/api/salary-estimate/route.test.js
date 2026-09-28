import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// N65 step 1 — route contract for POST /api/salary-estimate.
//
// Mirrors app/api/application-digest/route.test.js, the grounded-route
// precedent: auth -> validate -> embedded refusal -> stated backstop ->
// grounded call inside a try -> 200 (never 5xx) on failure so the caller renders
// the failure IN the transcript. `route.wire.test.js` proves the request BYTES
// (the R-267 top-level-tools trap); THIS file proves everything the bytes cannot
// reach — the gates, the withhold/refuse/fail directions, and that nothing is
// ever written to a database (S11).
//
// FIXTURES ARE CONSTRUCTED, NOT OBSERVED (no GEMINI_API_KEY here). Each
// Interaction is built to the @google/genai shape the real extractors in
// lib/llm/interactionCitations.js walk: a google_search_call step (proof of
// search) plus a model_output text block carrying url_citation annotations.
//
// RED ON HEAD: app/api/salary-estimate/route.js does not exist, so this file
// fails at collection. TDD hand-off red.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { POST } from "./route.js";

const PUBLISHER = "https://www.levels.fyi/company/acme/salaries";
const OK_TEXT = "ESTIMATE: $100k–$120k\nBased on Levels.fyi data for this role.";

function urlCitation(url, title) {
  return { type: "url_citation", url, title, start_index: 0, end_index: 0 };
}

// A well-formed Interaction. `searched` toggles the google_search_call step;
// omitting `text` models an Interaction that produced no output_text (the SDK
// omits the key entirely when the text is empty — K4).
function interaction({
  text = OK_TEXT,
  annotations = [urlCitation(PUBLISHER, "Acme salaries on Levels.fyi")],
  searched = true,
  status = "completed",
} = {}) {
  const steps = [];
  if (searched) steps.push({ type: "google_search_call", id: "s1" });
  steps.push({ type: "model_output", content: [{ type: "text", text, annotations }] });
  return { id: "int-1", status, steps, ...(text ? { output_text: text } : {}) };
}

function geminiReplying(value = interaction()) {
  const create = vi.fn().mockResolvedValue(value);
  getGeminiClient.mockReturnValue({ interactions: { create } });
  return create;
}

function geminiRejecting(error = new Error("model exploded")) {
  const create = vi.fn().mockRejectedValue(error);
  getGeminiClient.mockReturnValue({ interactions: { create } });
  return create;
}

let userSeq = 0;
function supabaseWith({ userId = `salary-user-${(userSeq += 1)}` } = {}) {
  const from = vi.fn();
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
    from,
  });
  return { from };
}

function signedOut() {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    from: vi.fn(),
  });
}

const request = (body) =>
  new Request("http://localhost/api/salary-estimate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const OK_BODY = { title: "Senior Platform Engineer", company: "Acme", location: "Remote (US)" };

// The estimate the response carries, whatever gate produced it.
async function estimateOf(res) {
  const json = await res.json();
  return json.salaryEstimate;
}

let warnSpy;
let errorSpy;

beforeEach(() => {
  vi.clearAllMocks();
  supabaseWith();
  // wantsEmbedded reads process.env directly, so a key must be present or the
  // no-explicit-engine path would fall back to embedded.
  vi.stubEnv("Gemini_LLM_API_Key", "test-key");
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

describe("POST /api/salary-estimate — the gates before the model", () => {
  it("refuses an unauthenticated caller, creating nothing", async () => {
    signedOut();
    const create = geminiReplying();
    const res = await POST(request(OK_BODY));
    expect(res.status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a request with no title, without calling the model", async () => {
    const create = geminiReplying();
    const res = await POST(request({ company: "Acme", location: "Remote" }));
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("S8: the embedded engine returns an explicit 'unavailable', no number, no grounded call", async () => {
    const create = geminiReplying();
    const res = await POST(request({ ...OK_BODY, engine: "embedded" }));
    expect(res.status).toBe(200); // 200, not 503: rendered as an assistant turn
    expect(create).not.toHaveBeenCalled();
    const est = await estimateOf(res);
    expect(est.status).toBe("unavailable_embedded");
    expect(est.range == null).toBe(true);
  });

  it("S1 backstop: a posting that STATES its pay is refused with no grounded call", async () => {
    // The client hides the affordance when pay is stated (S1 client gate); this
    // is the server backstop. It is the cheapest refusal — no model call — and
    // it never re-renders the stated figure here (S11).
    const create = geminiReplying();
    const res = await POST(request({ ...OK_BODY, salaryStated: true }));
    expect(res.status).toBe(200);
    expect(create).not.toHaveBeenCalled();
    const est = await estimateOf(res);
    expect(est.status).toBe("refused_stated");
    expect(est.range == null).toBe(true);
  });
});

describe("POST /api/salary-estimate — the grounded call", () => {
  it("returns a labelled estimated range with citations when the search supports one", async () => {
    const create = geminiReplying();
    const res = await POST(request(OK_BODY));
    expect(res.status).toBe(200);
    expect(create).toHaveBeenCalledTimes(1);
    const est = await estimateOf(res);
    expect(est.status).toBe("estimated");
    expect(est.range).toEqual({ min: 100000, max: 120000 });
    expect(est.citations).toHaveLength(1);
    expect(est.citations[0].url).toBe(PUBLISHER);
  });

  it("S14: a provider error becomes a 200 failure the caller can render, not a 5xx and not a number", async () => {
    geminiRejecting();
    const res = await POST(request(OK_BODY));
    expect(res.status).toBe(200);
    const est = await estimateOf(res);
    expect(est.status).toBe("failed");
    expect(est.reason).toBe("provider_error");
    expect(est.range == null).toBe(true);
  });

  it("S14: searched-but-no-sources withholds, it does not read as a $0 negative", async () => {
    geminiReplying(interaction({ annotations: [] }));
    const res = await POST(request(OK_BODY));
    expect(res.status).toBe(200);
    const est = await estimateOf(res);
    expect(est.status).toBe("insufficient_sources");
    expect(est.range == null).toBe(true);
  });

  it("S6/S14: an interaction that never searched is a degraded failure, not a negative", async () => {
    geminiReplying(interaction({ searched: false }));
    const res = await POST(request(OK_BODY));
    expect(res.status).toBe(200);
    const est = await estimateOf(res);
    expect(est.status).toBe("failed");
    expect(est.range == null).toBe(true);
  });

  it("K4: an Interaction with no output_text withholds (guarded) rather than throwing", async () => {
    // interaction.output_text absent => the route passes "" to the builder
    // instead of letting interactionOutputText throw. With sources present but
    // no parseable range, that is a withhold — never a number, never a 5xx.
    geminiReplying(interaction({ text: "" }));
    const res = await POST(request(OK_BODY));
    expect(res.status).toBe(200);
    const est = await estimateOf(res);
    expect(est.status).not.toBe("estimated");
    expect(est.range == null).toBe(true);
  });
});

describe("POST /api/salary-estimate — S11 non-regression: it writes nothing", () => {
  it("never touches a database table on the success path", async () => {
    // The estimate is transcript-only (design D2). The route uses supabase for
    // auth and nothing else; a `from(...)` call would mean it started reading or
    // writing a table — and feed_postings.salary_min/max must never gain an
    // estimate (S11).
    const { from } = supabaseWith();
    geminiReplying();
    await POST(request(OK_BODY));
    expect(from).not.toHaveBeenCalled();
  });
});
