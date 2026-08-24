import { describe, it, expect } from "vitest";
import {
  extractGroundingSources,
  groundedHostnames,
  isGroundedHost,
  isGroundedUrl,
  pageIdentityKey,
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

// isGroundedUrl is the STRICT variant of isGroundedHost, added for the meeting
// copilot's reference links. The difference is the whole point of it existing,
// so these tests are mostly about the cases where the two disagree.
describe("isGroundedUrl", () => {
  const grounded = [
    { uri: "https://react.dev/learn/you-might-not-need-an-effect", title: "You Might Not Need an Effect" },
    { uri: "https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/", title: "HPA" },
  ];

  it("accepts the exact page the model actually searched", () => {
    expect(isGroundedUrl("https://react.dev/learn/you-might-not-need-an-effect", grounded)).toBe(true);
  });

  it("REJECTS a different page on a host that was searched", () => {
    // THE case this function exists for, and the one isGroundedHost cannot
    // see. A model that really did search react.dev will happily cite
    // react.dev/learn/a-page-that-does-not-exist, and a host-only check
    // blesses it. That link then gets read aloud in a real meeting.
    expect(isGroundedUrl("https://react.dev/learn/invented-page", grounded)).toBe(false);
    // …while the host-only check, correctly for its own purpose, says yes -
    // asserted here so the difference between the two is pinned, not implied.
    expect(isGroundedHost("https://react.dev/learn/invented-page", grounded)).toBe(true);
  });

  it("folds away the noise a real citation picks up", () => {
    // Grounding routinely wraps a URL in tracking parameters, and a model
    // rephrases a trailing slash or the case of a host. None of those make it
    // a different page, and dropping a true citation for looking "different"
    // is its own failure.
    expect(isGroundedUrl("https://WWW.React.dev/learn/you-might-not-need-an-effect/", grounded)).toBe(true);
    expect(isGroundedUrl("https://react.dev/learn/you-might-not-need-an-effect?utm_source=x#top", grounded)).toBe(true);
  });

  it("treats no grounding as no evidence, never as permission", () => {
    // Same rule isGroundedHost already states: an empty list means the model
    // did not search, so everything is unverified. Returning true here is
    // exactly how a fabricated citation ships.
    expect(isGroundedUrl("https://react.dev/learn/anything", [])).toBe(false);
    expect(isGroundedUrl("https://react.dev/learn/anything", undefined)).toBe(false);
  });

  it("refuses a dangerous scheme even if it somehow appears in grounding", () => {
    const poisoned = [{ uri: "javascript:alert(1)", title: "" }];
    expect(isGroundedUrl("javascript:alert(1)", poisoned)).toBe(false);
  });

  it("refuses anything unparseable on either side", () => {
    expect(isGroundedUrl("not a url", grounded)).toBe(false);
    expect(isGroundedUrl("", grounded)).toBe(false);
    expect(isGroundedUrl(null, grounded)).toBe(false);
  });

  it("distinguishes two different pages under the same path prefix", () => {
    // Guards against a sloppy startsWith implementation, which would let
    // /docs/tasks/run-application/horizontal-pod-autoscale-walkthrough/
    // through on the strength of the real page above.
    expect(
      isGroundedUrl("https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale-walkthrough/", grounded),
    ).toBe(false);
  });

  it("accepts a grounded list of bare URL strings, not only { uri } entries", () => {
    // referenceContract resolves grounding redirects to their real
    // destinations before corroborating, and passes the resolved list in.
    expect(isGroundedUrl("https://react.dev/learn/you-might-not-need-an-effect", [
      "https://react.dev/learn/you-might-not-need-an-effect",
    ])).toBe(true);
    expect(isGroundedUrl("https://react.dev/learn/invented-page", [
      "https://react.dev/learn/you-might-not-need-an-effect",
    ])).toBe(false);
  });
});

// For a query-addressed site the query string IS the page: same host, same
// path, entirely different content. Folding it out — as an earlier version
// did — turned this function from "is this the page the model searched" into
// "is this roughly near it", which is the whole thing it exists to prevent.
describe("isGroundedUrl — the query string is part of the page's identity", () => {
  it("REJECTS an invented wikipedia article grounded only as a different one", () => {
    const grounded = [{ uri: "https://en.wikipedia.org/w/index.php?title=Kubernetes" }];
    expect(isGroundedUrl("https://en.wikipedia.org/w/index.php?title=Kubernetes", grounded)).toBe(true);
    expect(
      isGroundedUrl("https://en.wikipedia.org/w/index.php?title=Totally_Invented_Page", grounded),
    ).toBe(false);
  });

  it("REJECTS a different video on a watch page that was grounded", () => {
    const grounded = [{ uri: "https://www.youtube.com/watch?v=REALvideoID" }];
    expect(isGroundedUrl("https://www.youtube.com/watch?v=REALvideoID", grounded)).toBe(true);
    expect(isGroundedUrl("https://www.youtube.com/watch?v=FAKEvideoID", grounded)).toBe(false);
  });

  it("keeps query values case-sensitive, because they are usually opaque ids", () => {
    const grounded = [{ uri: "https://www.youtube.com/watch?v=AbCdEfG" }];
    expect(isGroundedUrl("https://www.youtube.com/watch?v=abcdefg", grounded)).toBe(false);
  });

  it("still folds ONLY the known tracking parameters, on either side", () => {
    const grounded = [{ uri: "https://en.wikipedia.org/w/index.php?title=Kubernetes&utm_source=g&gclid=1" }];
    expect(isGroundedUrl("https://en.wikipedia.org/w/index.php?title=Kubernetes", grounded)).toBe(true);
    // …and a NON-tracking parameter the grounded page did not have is a
    // difference, not noise.
    expect(isGroundedUrl("https://en.wikipedia.org/w/index.php?title=Kubernetes&action=edit", grounded)).toBe(false);
  });

  it("ignores the ORDER of query parameters", () => {
    const grounded = [{ uri: "https://docs.example.com/p?b=2&a=1" }];
    expect(isGroundedUrl("https://docs.example.com/p?a=1&b=2", grounded)).toBe(true);
  });
});

describe("isGroundedUrl — scheme, port and userinfo are part of the identity too", () => {
  const grounded = [{ uri: "https://react.dev/learn/state" }];

  it("REJECTS a different port on a grounded host", () => {
    // A different port is a different server. Folding it out let
    // react.dev:8443 pass on the strength of react.dev.
    expect(isGroundedUrl("https://react.dev:8443/learn/state", grounded)).toBe(false);
  });

  it("REJECTS a downgrade to http when https was what was searched", () => {
    expect(isGroundedUrl("http://react.dev/learn/state", grounded)).toBe(false);
  });

  it("REJECTS userinfo outright, which is how a hostile host disguises itself", () => {
    // https://react.dev@evil.example/x reads as react.dev to a human; the
    // host it actually resolves is evil.example. And credentials embedded in
    // a documentation link are never legitimate, so this is refused rather
    // than folded away.
    expect(isGroundedUrl("https://user:pw@react.dev/learn/state", grounded)).toBe(false);
    expect(pageIdentityKey("https://react.dev@evil.example/learn/state")).toBeNull();
  });

  it("treats the default port as no port at all", () => {
    expect(isGroundedUrl("https://react.dev:443/learn/state", grounded)).toBe(true);
  });
});

describe("isGroundedUrl — path case is identity, not spelling", () => {
  const grounded = [{ uri: "https://react.dev/learn/you-might-not-need-an-effect" }];

  it("REJECTS a path that differs from the grounded one only in case", () => {
    // A path is case-sensitive by specification; only the host is not. So
    // /Learn/X and /learn/X are genuinely different resources, and on most
    // documentation sites the wrong case 404s rather than redirecting.
    // Folding case would hand the user a dead link they had been told was
    // verified — the harm this feature exists to prevent, arriving via a 404
    // instead of a fabrication. Refusing costs a real-but-miscased citation,
    // which the card reports honestly as unverifiable. That is recoverable;
    // a confidently-wrong link read aloud is not.
    expect(isGroundedUrl("https://react.dev/Learn/You-Might-Not-Need-An-Effect", grounded)).toBe(false);
    expect(isGroundedUrl("https://react.dev/LEARN/you-might-not-need-an-effect", grounded)).toBe(false);
    // The exact case still passes, so this is a case check and not a blanket
    // refusal of the whole path.
    expect(isGroundedUrl("https://react.dev/learn/you-might-not-need-an-effect", grounded)).toBe(true);
  });

  it("still folds the host, which IS case-insensitive by spec", () => {
    // The distinction being drawn: host case is noise, path case is not.
    expect(isGroundedUrl("https://React.DEV/learn/you-might-not-need-an-effect", grounded)).toBe(true);
  });
});

describe("isGroundedUrl — spelling differences must not reject a REAL page", () => {
  const grounded = [{ uri: "https://react.dev/learn/you-might-not-need-an-effect" }];

  it("accepts a fully-qualified host with the DNS root dot", () => {
    expect(isGroundedUrl("https://react.dev./learn/you-might-not-need-an-effect", grounded)).toBe(true);
  });

  it("accepts a doubled slash inside the path", () => {
    expect(isGroundedUrl("https://react.dev//learn//you-might-not-need-an-effect", grounded)).toBe(true);
  });
});

describe("pageIdentityKey", () => {
  it("is null for anything that is not an http(s) page", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "not a url", "", null, undefined]) {
      expect(pageIdentityKey(bad)).toBeNull();
    }
  });

  it("keeps protocol, host, port, path and non-tracking query in the key", () => {
    // Host case folded, PATH case kept — the whole distinction, in one key.
    expect(pageIdentityKey("https://WWW.React.dev:8443/Learn//State/?b=2&utm_source=x&a=1#top")).toBe(
      "https://react.dev:8443/Learn/State?a=1&b=2",
    );
  });
});
