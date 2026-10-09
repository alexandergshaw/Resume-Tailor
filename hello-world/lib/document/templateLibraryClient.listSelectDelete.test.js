// N151b (4b) — T3 / R4: the three browser-side helpers the switcher hook reaches:
//   listLibraryTemplates(kind)            -> GET  ?kind=   -> { ok, templates, selectedId }
//   selectLibraryTemplate({kind,templateId}) -> PUT (JSON) -> { ok }
//   deleteLibraryTemplate(id)             -> DELETE ?id=   -> { ok }
// Same no-throw contract as the shipped registerTemplateFromBytes
// (templateLibraryClient.js:17): every failure (network, abort, !res.ok) resolves
// to { ok:false, error }, NEVER throws, so the hook's select/remove can't reject
// unhandled.
//
// RED on HEAD: templateLibraryClient.js exports only registerTemplateFromBytes;
// these three are undefined. A NAMESPACE import keeps the file collectable so each
// test reds with a crisp "not a function" via an explicit guard, rather than a
// collection-time "no export named …". GREEN after Step 2.
//
// Mutation that must RED: make a helper THROW on !res.ok instead of returning
// { ok:false } (R4). No-op CONTROL that must survive: renaming a local inside a
// helper (modelled by the success-path assertions, which are shape-only).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as client from "./templateLibraryClient.js";

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock;
});
afterEach(() => {
  vi.restoreAllMocks();
});

function requireFn(name) {
  expect(typeof client[name], `${name} is not exported on HEAD`).toBe("function");
  return client[name];
}

describe("listLibraryTemplates (T3)", () => {
  it("GETs ?kind= and returns { ok, templates, selectedId }", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ templates: [{ id: "a" }], selectedId: "a" }));
    const out = await requireFn("listLibraryTemplates")("resume");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/templates/library");
    expect(String(url)).toContain("kind=resume");
    expect((opts?.method || "GET").toUpperCase()).toBe("GET");
    expect(out).toMatchObject({ ok: true, templates: [{ id: "a" }], selectedId: "a" });
  });

  it("returns { ok:false } (never throws) when the network rejects", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const out = await requireFn("listLibraryTemplates")("resume");
    expect(out.ok).toBe(false);
    expect(out.error).toBeTruthy();
  });

  it("returns { ok:false } (never throws) on a non-OK response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "nope" }, false, 500));
    const out = await requireFn("listLibraryTemplates")("resume");
    expect(out.ok).toBe(false);
  });
});

describe("selectLibraryTemplate (T3)", () => {
  it("PUTs a JSON body { kind, templateId } and returns { ok:true }", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const out = await requireFn("selectLibraryTemplate")({ kind: "resume", templateId: "tmpl-9" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/templates/library");
    expect((opts?.method || "").toUpperCase()).toBe("PUT");
    const sent = JSON.parse(opts.body);
    expect(sent).toMatchObject({ kind: "resume", templateId: "tmpl-9" });
    expect(out.ok).toBe(true);
  });

  it("returns { ok:false } (never throws) on a refusal", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "That template is not in your library." }, false, 404));
    const out = await requireFn("selectLibraryTemplate")({ kind: "resume", templateId: "ghost" });
    expect(out.ok).toBe(false);
    expect(out.error).toBeTruthy();
  });
});

describe("deleteLibraryTemplate (T3)", () => {
  it("DELETEs ?id= and returns { ok:true }", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const out = await requireFn("deleteLibraryTemplate")("tmpl-5");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/templates/library");
    expect(String(url)).toContain("id=tmpl-5");
    expect((opts?.method || "").toUpperCase()).toBe("DELETE");
    expect(out.ok).toBe(true);
  });

  it("returns { ok:false } (never throws) when the network rejects", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const out = await requireFn("deleteLibraryTemplate")("tmpl-5");
    expect(out.ok).toBe(false);
  });
});
