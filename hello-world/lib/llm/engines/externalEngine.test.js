import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { externalEngine } from "./externalEngine.js";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.restoreAllMocks();
  delete process.env.RESUME_TAILOR_API_URL;
  delete process.env.RESUME_TAILOR_API_KEY;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function mockFetch(status, body, { json = true } = {}) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: json
      ? async () => body
      : async () => {
          throw new Error("not json");
        },
  });
}

describe("externalEngine.tailorResume", () => {
  it("throws ENGINE_NOT_CONFIGURED when the URL is missing", async () => {
    await expect(externalEngine.tailorResume({ jobPosting: "x" })).rejects.toMatchObject({
      code: "ENGINE_NOT_CONFIGURED",
    });
  });

  it("requires a job posting", async () => {
    process.env.RESUME_TAILOR_API_URL = "https://api.example.com";
    await expect(externalEngine.tailorResume({ jobPosting: "" })).rejects.toThrow(
      /job posting is required/i,
    );
  });

  it("returns docxB64, engine, and report meta on success", async () => {
    process.env.RESUME_TAILOR_API_URL = "https://api.example.com/";
    mockFetch(200, {
      engine_version: "1.0.0",
      docx_b64: "QUJD",
      report: { warnings: ["heads up"], meta: { degraded: true } },
    });
    const out = await externalEngine.tailorResume({ jobPosting: "Senior Engineer at Acme" });
    expect(out.engine).toBe("external");
    expect(out.docxB64).toBe("QUJD");
    expect(out.warnings).toEqual(["heads up"]);
    expect(out.degraded).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.example.com/api/v1/resume",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sends the API key header when configured", async () => {
    process.env.RESUME_TAILOR_API_URL = "https://api.example.com";
    process.env.RESUME_TAILOR_API_KEY = "secret-key";
    mockFetch(200, { docx_b64: "", report: {} });
    await externalEngine.tailorResume({ jobPosting: "x" });
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers["X-API-Key"]).toBe("secret-key");
  });

  it("maps a 401 to a friendly error", async () => {
    process.env.RESUME_TAILOR_API_URL = "https://api.example.com";
    mockFetch(401, { error: "unauthorized", detail: "bad key" });
    await expect(externalEngine.tailorResume({ jobPosting: "x" })).rejects.toThrow(
      /rejected the API key/i,
    );
  });

  it("handles a non-JSON 413 response", async () => {
    process.env.RESUME_TAILOR_API_URL = "https://api.example.com";
    mockFetch(413, null, { json: false });
    await expect(externalEngine.tailorResume({ jobPosting: "x" })).rejects.toThrow(/10 MB/);
  });
});

describe("externalEngine.getProposals", () => {
  it("returns slots and meta", async () => {
    process.env.RESUME_TAILOR_API_URL = "https://api.example.com";
    mockFetch(200, {
      slots: [{ key: "A::0", name: "A", value: "x" }],
      keywords: { technology: [] },
      warnings: ["w"],
      meta: { degraded: false },
    });
    const out = await externalEngine.getProposals({ jobPosting: "x" });
    expect(out.slots).toHaveLength(1);
    expect(out.warnings).toEqual(["w"]);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.example.com/api/v1/proposals",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws when not configured", async () => {
    await expect(externalEngine.getProposals({ jobPosting: "x" })).rejects.toMatchObject({
      code: "ENGINE_NOT_CONFIGURED",
    });
  });
});

describe("externalEngine.tailorResume values", () => {
  it("includes slot values in the request body when provided", async () => {
    process.env.RESUME_TAILOR_API_URL = "https://api.example.com";
    mockFetch(200, { docx_b64: "", report: {} });
    await externalEngine.tailorResume({ jobPosting: "x", values: { "A::0": "edited" } });
    const [, opts] = global.fetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.values).toEqual({ "A::0": "edited" });
  });

  it("omits values when empty", async () => {
    process.env.RESUME_TAILOR_API_URL = "https://api.example.com";
    mockFetch(200, { docx_b64: "", report: {} });
    await externalEngine.tailorResume({ jobPosting: "x", values: {} });
    const [, opts] = global.fetch.mock.calls[0];
    expect(JSON.parse(opts.body).values).toBeUndefined();
  });
});

describe("externalEngine.isConfigured", () => {
  it("reflects the presence of the API URL", () => {
    expect(externalEngine.isConfigured()).toBe(false);
    process.env.RESUME_TAILOR_API_URL = "https://api.example.com";
    expect(externalEngine.isConfigured()).toBe(true);
  });
});
