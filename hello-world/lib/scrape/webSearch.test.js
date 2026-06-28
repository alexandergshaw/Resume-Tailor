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
    expect(await searchPostingUrls({ query: "", env: {} })).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fetches DuckDuckGo and returns parsed result URLs when no key is set", async () => {
    fetch.mockResolvedValue({
      ok: true,
      text: async () =>
        '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Facme.com%2Fjobs%2F1">r</a>',
    });
    const out = await searchPostingUrls({ query: "Acme Senior Engineer", env: {} });
    expect(out).toEqual(["https://acme.com/jobs/1"]);
    expect(fetch.mock.calls[0][0]).toContain("html.duckduckgo.com/html/?q=");
  });

  it("returns [] when DuckDuckGo fails", async () => {
    fetch.mockResolvedValue({ ok: false, status: 429, text: async () => "" });
    expect(await searchPostingUrls({ query: "x", env: {} })).toEqual([]);
  });

  it("uses the Brave API when BRAVE_SEARCH_API_KEY is set", async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ web: { results: [{ url: "https://acme.com/careers/eng" }, { url: "https://acme.com/careers/eng" }] } }),
    });
    const out = await searchPostingUrls({ query: "Acme Engineer", env: { BRAVE_SEARCH_API_KEY: "k" } });
    expect(out).toEqual(["https://acme.com/careers/eng"]);
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toContain("api.search.brave.com");
    expect(opts.headers["X-Subscription-Token"]).toBe("k");
  });

  it("uses Google Programmable Search when its key + engine id are set", async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ link: "https://boards.greenhouse.io/acme/jobs/3" }] }),
    });
    const out = await searchPostingUrls({
      query: "Acme Engineer",
      env: { GOOGLE_SEARCH_API_KEY: "gk", GOOGLE_SEARCH_ENGINE_ID: "cx" },
    });
    expect(out).toEqual(["https://boards.greenhouse.io/acme/jobs/3"]);
    expect(fetch.mock.calls[0][0]).toContain("googleapis.com/customsearch");
  });

  it("falls through to DuckDuckGo when the keyed provider returns nothing", async () => {
    fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ web: { results: [] } }) }) // Brave empty
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Ffallback.example%2Fjob">r</a>',
      });
    const out = await searchPostingUrls({ query: "Acme Engineer", env: { BRAVE_SEARCH_API_KEY: "k" } });
    expect(out).toEqual(["https://fallback.example/job"]);
    expect(fetch.mock.calls[1][0]).toContain("duckduckgo.com");
  });
});
