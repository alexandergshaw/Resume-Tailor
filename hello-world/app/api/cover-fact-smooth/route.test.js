import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// N92 Wave 3 (Control B) step W3-S2 -- the route contract for
// POST /api/cover-fact-smooth. Mirrors app/api/salary-estimate/route.test.js,
// the user-initiated grounded/LLM precedent: auth -> validate -> embedded
// refusal -> LLM call inside a try -> 200 (never 5xx) so the caller renders the
// failure in the confirm surface, never a fetch error.
//
// NO GROUNDING / NO WIRE TEST, stated plainly (brief item 5): smoothing is a
// pure sentence REWRITE, not a web-grounded lookup. It sends NO `google_search`
// tool, so the R-267 top-level-tools nesting trap simply does not apply and no
// vertexaisearch redirect can be surfaced (there is no search). The one grounding
// hazard that WOULD matter -- accidentally turning smoothing into a grounded call
// that bills for search and could splice web text into the letter -- is guarded
// below by asserting the model request carries no google_search tool. Egress is
// proven at the payload level here and in the client orchestrator test (AC-B7).
//
// TWO CODES / NO LEAK: a provider failure returns a coarse withheld envelope,
// never the raw error or any letter text.
//
// RED ON HEAD: app/api/cover-fact-smooth/route.js does not exist -> collection red.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { POST } from "./route.js";

const BEFORE = "I led the platform team.";
const FACT_SENT = "Acme opened a Dublin lab in 2021.";
const AFTER = "We shipped quickly.";
const FACT_TEXT = "Acme opened a Dublin lab in 2021.";

const OK_BODY = { engine: "gemini", before: BEFORE, factSentence: FACT_SENT, after: AFTER, factText: FACT_TEXT };

// A faithful smoothed triple as the model's JSON output (reuses only in-scope
// tokens). The route parses interaction.output_text as JSON.
const FAITHFUL = { before: "Leading the platform team,", fact: "I watched Acme open a Dublin lab in 2021,", after: "which let us ship quickly." };

function interactionWith(obj, { text } = {}) {
  const outputText = text !== undefined ? text : JSON.stringify(obj);
  return {
    id: "int-1",
    status: "completed",
    steps: [{ type: "model_output", content: [{ type: "text", text: outputText }] }],
    ...(outputText ? { output_text: outputText } : {}),
  };
}

function geminiReplying(interaction = interactionWith(FAITHFUL)) {
  const create = vi.fn().mockResolvedValue(interaction);
  getGeminiClient.mockReturnValue({ interactions: { create } });
  return create;
}
function geminiRejecting() {
  const create = vi.fn().mockRejectedValue(new Error("model exploded: " + FACT_TEXT));
  getGeminiClient.mockReturnValue({ interactions: { create } });
  return create;
}

let userSeq = 0;
function supabaseWith({ userId = `smooth-user-${(userSeq += 1)}` } = {}) {
  const from = vi.fn();
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
    from,
  });
  return { from };
}
function signedOut() {
  createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null }, error: null }) }, from: vi.fn() });
}

const request = (body) =>
  new Request("http://localhost/api/cover-fact-smooth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

async function smoothedOf(res) {
  const json = await res.json();
  return json.smoothed;
}

let warnSpy;
let errorSpy;
beforeEach(() => {
  vi.clearAllMocks();
  supabaseWith();
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

describe("POST /api/cover-fact-smooth -- the gates before the model", () => {
  it("refuses an unauthenticated caller, calling no model", async () => {
    signedOut();
    const create = geminiReplying();
    const res = await POST(request(OK_BODY));
    expect(res.status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a request missing the fact sentence, without calling the model", async () => {
    const create = geminiReplying();
    const res = await POST(request({ engine: "gemini", before: BEFORE, after: AFTER }));
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("AC-B9: the embedded engine returns an explicit 'unavailable', no rewrite, no engine call", async () => {
    const create = geminiReplying();
    const res = await POST(request({ ...OK_BODY, engine: "embedded" }));
    expect(res.status).toBe(200); // rendered honestly in the confirm surface, not a 503
    expect(create).not.toHaveBeenCalled();
    const s = await smoothedOf(res);
    expect(s.status).toBe("unavailable_embedded");
    expect(s.fact == null).toBe(true);
  });
});

describe("POST /api/cover-fact-smooth -- the LLM call", () => {
  it("returns a faithful smoothed triple when the model reuses only in-scope tokens", async () => {
    const create = geminiReplying();
    const res = await POST(request(OK_BODY));
    expect(res.status).toBe(200);
    expect(create).toHaveBeenCalledTimes(1);
    const s = await smoothedOf(res);
    expect(s.status).toBe("ok");
    expect(s.fact).toBe(FAITHFUL.fact);
  });

  it("AC-B3a: a model output that fabricates a NEW number is auto-rejected server-side", async () => {
    geminiReplying(interactionWith({ before: "Leading the platform team,", fact: "I watched Acme open a Dublin lab in 2021 with 500 people,", after: "which let us ship quickly." }));
    const res = await POST(request(OK_BODY));
    expect(res.status).toBe(200);
    const s = await smoothedOf(res);
    expect(s.status, "a fabricated headcount was returned to the client instead of auto-rejected").toBe("rejected");
    expect(s.reason).toBe("added-token");
  });

  it("two codes / no leak: a provider error is a 200 withhold, never a 5xx and never the raw error", async () => {
    geminiRejecting();
    const res = await POST(request(OK_BODY));
    expect(res.status).toBe(200);
    const s = await smoothedOf(res);
    expect(s.status).toBe("failed");
    expect(s.reason).toBe("provider_error");
    // the raw error carried the fact text; it must NOT reach the client.
    expect(JSON.stringify(s), "the raw engine error/letter text leaked to the client").not.toContain("model exploded");
    expect(s.fact == null).toBe(true);
  });

  it("K4: an interaction with no output_text withholds rather than throwing a 5xx", async () => {
    geminiReplying(interactionWith(null, { text: "" }));
    const res = await POST(request(OK_BODY));
    expect(res.status).toBe(200);
    const s = await smoothedOf(res);
    expect(s.status).not.toBe("ok");
    expect(s.fact == null).toBe(true);
  });
});

describe("POST /api/cover-fact-smooth -- egress + no grounding + no DB write", () => {
  it("sends the in-scope sentences to the model and NO google_search tool (smoothing does not ground)", async () => {
    const create = geminiReplying();
    await POST(request(OK_BODY));
    expect(create).toHaveBeenCalledTimes(1);
    const arg = JSON.stringify(create.mock.calls[0][0] || {});
    // positive control: the scoped material actually reached the model.
    expect(arg, "the fact text never reached the model").toContain("Dublin lab in 2021");
    // the guard: no grounded search tool (a rewrite must not bill for or ingest web results).
    expect(arg, "smoothing sent a grounded search tool -- it is a rewrite, it must not ground").not.toContain("google_search");
  });

  it("never touches a database table (the rewrite is transient; nothing is persisted server-side)", async () => {
    const { from } = supabaseWith();
    geminiReplying();
    await POST(request(OK_BODY));
    expect(from, "the route read or wrote a table -- smoothing must persist nothing server-side").not.toHaveBeenCalled();
  });
});
