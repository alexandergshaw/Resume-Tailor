import { describe, it, expect } from "vitest";
import {
  extractGroundingSources,
  groundedHostnames,
  isGroundedHost,
} from "@/lib/llm/grounding";

// Google's grounding metadata lists the pages the model ACTUALLY searched. It is
// the only evidence available that a result was not invented, so it is extracted
// once here and shared by every grounded feature rather than copied per route.

function responseWith(uris) {
  return {
    candidates: [
      {
        groundingMetadata: {
          groundingChunks: uris.map((uri) => ({ web: { uri, title: `title for ${uri}` } })),
        },
      },
    ],
  };
}

describe("the copies this module replaces are actually gone", () => {
  it("is the same function the grounded routes use, not a fourth copy", async () => {
    // Adding this module while leaving the local copies in place would pass
    // every other test in this file and remove no duplication at all. Both
    // routes had a byte-identical private implementation.
    const companyResearch = await import("@/app/api/company-research/route");
    const experienceResearch = await import("@/app/api/experience/research/route");
    expect(companyResearch.extractGroundingSources).toBe(extractGroundingSources);
    expect(experienceResearch.extractGroundingSources).toBe(extractGroundingSources);
  });
});

describe("extractGroundingSources", () => {
  it("returns each grounded web source with its uri and title", () => {
    expect(extractGroundingSources(responseWith(["https://a.com/1"]))).toEqual([
      { uri: "https://a.com/1", title: "title for https://a.com/1" },
    ]);
  });

  it("skips chunks with no web uri and never throws on a malformed response", () => {
    const response = {
      candidates: [
        { groundingMetadata: { groundingChunks: [{ web: {} }, {}, { web: { uri: "https://b.com" } }] } },
      ],
    };
    expect(extractGroundingSources(response)).toEqual([{ uri: "https://b.com", title: "" }]);
    for (const bad of [null, undefined, {}, { candidates: [] }, { candidates: [{}] }]) {
      expect(extractGroundingSources(bad)).toEqual([]);
    }
  });
});

describe("groundedHostnames", () => {
  it("collects lowercased, www-stripped hosts", () => {
    const hosts = groundedHostnames([
      { uri: "https://WWW.Acme.com/careers/1" },
      { uri: "https://jobs.lever.co/x" },
    ]);
    expect([...hosts].sort()).toEqual(["acme.com", "jobs.lever.co"]);
  });

  it("ignores entries whose uri does not parse", () => {
    expect([...groundedHostnames([{ uri: "garbage" }, { uri: "" }, {}])]).toEqual([]);
  });
});

describe("isGroundedHost", () => {
  const grounded = [{ uri: "https://vertexaisearch.cloud.google.com/redirect/abc" }, { uri: "https://acme.com/x" }];

  it("accepts a URL whose host was actually searched", () => {
    expect(isGroundedHost("https://www.acme.com/careers/42", grounded)).toBe(true);
  });

  it("rejects a URL from a host that appears nowhere in the grounding metadata", () => {
    expect(isGroundedHost("https://invented-board.example/jobs/1", grounded)).toBe(false);
  });

  it("rejects everything when the model returned no grounding at all", () => {
    // No grounding means no evidence the model searched; treating that as
    // "allow" is precisely how a fabricated posting reaches the feed.
    expect(isGroundedHost("https://acme.com/x", [])).toBe(false);
  });
});
