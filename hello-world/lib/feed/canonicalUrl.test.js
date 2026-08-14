import { describe, it, expect } from "vitest";
import {
  canonicalPostingUrl,
  rejectDuplicateUrls,
} from "@/lib/feed/canonicalUrl";

// A posting's identity across sources is its URL, because `dedup_key` is
// namespaced per source (see R-202) and therefore cannot dedupe Greenhouse
// against an AI-search hit for the SAME job.

describe("canonicalPostingUrl", () => {
  it("lowercases the host, strips www and the fragment, and drops a trailing slash", () => {
    expect(canonicalPostingUrl("HTTPS://WWW.Boards.Greenhouse.IO/acme/jobs/123/#apply")).toBe(
      "https://boards.greenhouse.io/acme/jobs/123",
    );
  });

  it("strips tracking parameters but keeps parameters that identify the posting", () => {
    // gh_jid IS the posting id on a Greenhouse-embedded careers page; dropping
    // it would collapse every job on that board into one key.
    expect(
      canonicalPostingUrl("https://acme.com/careers?gh_jid=99&utm_source=x&utm_medium=y&gh_src=abc"),
    ).toBe("https://acme.com/careers?gh_jid=99");
  });

  it("strips the other named tracking parameters too", () => {
    expect(canonicalPostingUrl("https://acme.com/j/1?ref=linkedin")).toBe("https://acme.com/j/1");
    expect(canonicalPostingUrl("https://acme.com/j/1?source=indeed")).toBe("https://acme.com/j/1");
  });

  it("orders the surviving query parameters so parameter order cannot fork the key", () => {
    const a = canonicalPostingUrl("https://acme.com/j?b=2&a=1");
    const b = canonicalPostingUrl("https://acme.com/j?a=1&b=2");
    expect(a).toBe(b);
    expect(a).toBe("https://acme.com/j?a=1&b=2");
  });

  it("returns '' for anything that is not an http(s) URL", () => {
    for (const bad of ["", null, undefined, "not a url", "javascript:alert(1)", "ftp://x.com/a"]) {
      expect(canonicalPostingUrl(bad)).toBe("");
    }
  });

  it("keeps two genuinely different postings distinct", () => {
    expect(canonicalPostingUrl("https://acme.com/jobs/1")).not.toBe(
      canonicalPostingUrl("https://acme.com/jobs/2"),
    );
  });
});

describe("rejectDuplicateUrls", () => {
  const known = new Set([canonicalPostingUrl("https://boards.greenhouse.io/acme/jobs/123")]);

  it("drops a posting already in the feed under a different source", () => {
    const out = rejectDuplicateUrls(
      [{ url: "https://www.boards.greenhouse.io/acme/jobs/123/?utm_source=ai" }],
      known,
    );
    expect(out).toEqual([]);
  });

  // Positive control. Without this, a totally broken implementation that
  // returns [] for everything would satisfy the assertion above.
  it("keeps a posting the feed has never seen", () => {
    const fresh = { url: "https://boards.greenhouse.io/acme/jobs/999" };
    expect(rejectDuplicateUrls([fresh], known)).toEqual([fresh]);
  });

  it("dedupes within the batch itself, keeping the first occurrence", () => {
    const first = { url: "https://acme.com/j/7", title: "first" };
    const second = { url: "https://acme.com/j/7?utm_campaign=z", title: "second" };
    expect(rejectDuplicateUrls([first, second], new Set())).toEqual([first]);
  });

  it("drops a posting whose URL cannot be canonicalized rather than keying it on ''", () => {
    // Two unparseable URLs must not collide into one bucket and must not be
    // stored: a feed row with no working link is useless to the user.
    const out = rejectDuplicateUrls([{ url: "nope" }, { url: "" }], new Set());
    expect(out).toEqual([]);
  });
});
