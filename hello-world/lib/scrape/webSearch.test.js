import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { decodeDdgHref, parseDdgResults, searchPostingUrls } from "./webSearch.js";

describe("decodeDdgHref", () => {
  it("extracts the real URL from a DDG redirect, decoding entities", () => {
    expect(
      decodeDdgHref("//duckduckgo.com/l/?uddg=https%3A%2F%2Facme.com%2Fjobs%2F1&amp;rut=abc"),
    ).toBe("https://acme.com/jobs/1");
  });
  it("passes through a direct https link", () => {
    expect(decodeDdgHref("https://boards.greenhouse.io/acme/jobs/2")).toBe("https://boards.greenhouse.io/acme/jobs/2");
  });
  it("returns empty for junk", () => {
    expect(decodeDdgHref("")).toBe("");
    expect(decodeDdgHref("javascript:void(0)")).toBe("");
  });
});

describe("parseDdgResults", () => {
  it("pulls de-duplicated result links in order, up to the limit", () => {
    const html = `
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Facme.com%2Fjobs%2F1">One</a>
      <a class="result__snippet" href="ignore">x</a>
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fboards.greenhouse.io%2Facme%2Fjobs%2F2">Two</a>
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Facme.com%2Fjobs%2F1">dup</a>
    `;
    expect(parseDdgResults(html, 5)).toEqual([
      "https://acme.com/jobs/1",
      "https://boards.greenhouse.io/acme/jobs/2",
    ]);
    expect(parseDdgResults(html, 1)).toEqual(["https://acme.com/jobs/1"]);
  });
});

describe("searchPostingUrls", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns [] for an empty query without fetching", async () => {
    expect(await searchPostingUrls({ query: "" })).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fetches DuckDuckGo and returns parsed result URLs", async () => {
    fetch.mockResolvedValue({
      ok: true,
      text: async () =>
        '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Facme.com%2Fjobs%2F1">r</a>',
    });
    const out = await searchPostingUrls({ query: "Acme Senior Engineer" });
    expect(out).toEqual(["https://acme.com/jobs/1"]);
    expect(fetch.mock.calls[0][0]).toContain("html.duckduckgo.com/html/?q=");
  });

  it("returns [] when the request fails", async () => {
    fetch.mockResolvedValue({ ok: false, status: 429, text: async () => "" });
    expect(await searchPostingUrls({ query: "x" })).toEqual([]);
  });
});
