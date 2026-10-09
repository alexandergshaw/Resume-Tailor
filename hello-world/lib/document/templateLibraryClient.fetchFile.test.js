// @vitest-environment jsdom
//
// N151c (4b) — S3 / T3: fetchLibraryTemplateFile(kind, id) — the browser-side
// read that turns a library template's by-id bytes (S2) into a docx File the
// regen hands to resolveDocumentBlob as formattingTemplate (plan §E S2 client,
// PL-7 / PL-8). Modelled on resolveDefaultTemplateFile (defaultTemplateClient).
//
// RED on HEAD: templateLibraryClient.js exports registerTemplateFromBytes /
// listLibraryTemplates / selectLibraryTemplate / deleteLibraryTemplate only —
// fetchLibraryTemplateFile does not exist, so requireFn() reds every test.
//
// THE SILENT-FAILURE INSTRUMENT (§F S2): the client must trust ONLY a
// wordprocessingml response. An unrelated 200 (an error page, a JSON body) must
// resolve null, never a File — a garbage File would reach the override and
// rebuild onto nothing with no error. The non-docx test asserts null; the
// "trust any 200" mutant returns a File there -> red. It is paired with a docx
// positive control so "always null" cannot pass as teeth.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { fetchLibraryTemplateFile } from "@/lib/document/templateLibraryClient.js";

const DOCX_CT = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOCX_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x4c, 0x49]); // "LI" = library

function fakeResponse({ ok = true, status = 200, contentType = DOCX_CT, bytes = DOCX_BYTES } = {}) {
  return {
    ok,
    status,
    headers: { get: (h) => (String(h).toLowerCase() === "content-type" ? contentType : null) },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    json: async () => ({}),
  };
}

function requireFn() {
  expect(typeof fetchLibraryTemplateFile, "fetchLibraryTemplateFile does not exist on HEAD").toBe("function");
  return fetchLibraryTemplateFile;
}

let fetchSpy;
beforeEach(() => {
  fetchSpy = vi.fn(async () => fakeResponse());
  globalThis.fetch = fetchSpy;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchLibraryTemplateFile (S3 / T3 / PL-7)", () => {
  it("POSITIVE CONTROL: a wordprocessingml 200 -> a .docx File with the exact bytes", async () => {
    const file = await requireFn()("resume", "lib-1");
    expect(file, "no File returned for a valid docx response").toBeTruthy();
    expect(file).toBeInstanceOf(File);
    expect(file.name.toLowerCase().endsWith(".docx")).toBe(true);
    expect(file.type).toBe(DOCX_CT);
    const got = new Uint8Array(await file.arrayBuffer());
    expect(Array.from(got)).toEqual(Array.from(DOCX_BYTES));
  });

  it("requests the by-id bytes path (kind, id, bytes=1)", async () => {
    await requireFn()("resume", "lib-1");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain("kind=resume");
    expect(url).toContain("id=lib-1");
    expect(url).toContain("bytes=1");
  });

  it("TRUST GUARD: a non-docx 200 (JSON/error page) -> null, never a File", async () => {
    fetchSpy.mockResolvedValue(fakeResponse({ contentType: "application/json" }));
    const out = await requireFn()("resume", "lib-1");
    expect(out, "trusted a non-docx 200 as a template — the override would rebuild onto garbage").toBeNull();
  });

  it("a non-200 response -> null", async () => {
    fetchSpy.mockResolvedValue(fakeResponse({ ok: false, status: 404, contentType: "application/json" }));
    await expect(requireFn()("resume", "lib-1")).resolves.toBeNull();
  });

  it("an empty docx body -> null (no zero-byte template)", async () => {
    fetchSpy.mockResolvedValue(fakeResponse({ bytes: new Uint8Array([]) }));
    await expect(requireFn()("resume", "lib-1")).resolves.toBeNull();
  });

  it("a thrown fetch (network) -> null, never a throw the caller must catch", async () => {
    fetchSpy.mockRejectedValue(new Error("network down"));
    await expect(requireFn()("resume", "lib-1")).resolves.toBeNull();
  });
});
