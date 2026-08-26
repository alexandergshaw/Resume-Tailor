import { describe, expect, it, vi } from "vitest";
import { buildCompanyFacts } from "./companyFactsSource";

// AC-V4.1/V4.2/V4.7. The pipeline that turns "who is this employer" into a
// small set of claims the candidate may actually say out loud, and — much more
// importantly — drops every claim that cannot be corroborated.
//
// THE PREMISE, which is `lib/meeting/referenceContract.js`'s and is restated
// here because it is the whole point: language models invent plausible facts
// and plausible URLs. In the session the user recorded on 2026-08-25 the
// copilot told them to say "My research indicates a strong focus on continuous
// improvement" about a company it knew nothing about — asserting research that
// never happened, for the candidate to read aloud in front of an interviewer.
// A fabricated fact is worse than no fact, because the candidate stakes their
// credibility on it. So the default is REFUSAL, and a claim earns its way onto
// the screen only by pointing at a page Google actually visited.
//
// Every dependency is injected, which is what lets the whole corroboration
// pipeline run under this repo's `environment: "node"` with no network and no
// Gemini key — the same shape `resolveGroundedSources` itself already uses for
// its `fetchImpl`.

const COMPANY = { company: "Purple Wave", jobTitle: "Director of Platform Engineering" };

const REAL_FACT = {
  claim: "Purple Wave is an online auction marketplace for used heavy equipment and farm machinery.",
  url: "https://www.purplewave.com/about",
  kind: "what",
};
const INVENTED_FACT = {
  claim: "Purple Wave was named the fastest growing company in the Midwest in 2025.",
  url: "https://www.example-news.test/purple-wave-award",
  kind: "recent",
};

function modelReturning(facts) {
  return {
    models: {
      generateContent: vi.fn(async () => ({
        // Gemini's googleSearch tool is incompatible with a JSON response
        // mime type, so the real response is prose around a fenced block —
        // the same shape app/api/company-research/route.js parses defensively.
        text: `Here is what I found.\n\`\`\`json\n${JSON.stringify({ facts })}\n\`\`\``,
      })),
    },
  };
}

// A grounding set naming ONLY the company's own site.
function groundedOwnSiteOnly() {
  return {
    extractGrounded: () => [{ uri: "https://redirect.test/abc", title: "Purple Wave" }],
    resolveGrounded: async () => [{ uri: "https://www.purplewave.com/about" }],
  };
}

function deps(overrides = {}) {
  return {
    client: modelReturning([REAL_FACT]),
    model: "gemini-2.5-flash",
    ...groundedOwnSiteOnly(),
    isGrounded: (url, resolved) =>
      resolved.some((entry) => {
        try {
          const a = new URL(url);
          const b = new URL(entry.uri);
          return a.host === b.host && a.pathname === b.pathname;
        } catch {
          return false;
        }
      }),
    fetchImpl: vi.fn(async (url) => ({ finalUrl: url })),
    ...overrides,
  };
}

describe("buildCompanyFacts — corroborated claims survive (AC-V4.1)", () => {
  it("returns a fact whose URL is among the pages the search actually visited", async () => {
    const facts = await buildCompanyFacts(COMPANY, deps());
    expect(facts).toHaveLength(1);
    expect(facts[0].claim).toBe(REAL_FACT.claim);
    expect(facts[0].url).toBe(REAL_FACT.url);
    // A stable, position-derived id, the same way normalizeBriefArticles
    // assigns one — the prompt cites facts by id and the whitelist resolves
    // them back, so an id is not optional.
    expect(facts[0].id).toBe("fact-0");
  });
});

describe("buildCompanyFacts — uncorroborated claims are DROPPED (AC-V4.2)", () => {
  it("drops a claim pointing at a page the search never visited", async () => {
    const facts = await buildCompanyFacts(COMPANY, deps({ client: modelReturning([INVENTED_FACT]) }));
    expect(facts).toEqual([]);
  });

  it("keeps the corroborated claim and drops the invented one from the same response", async () => {
    // The mixed case is the realistic one and the one a pass/fail count
    // cannot check: a model returns four claims, two of which it made up.
    const facts = await buildCompanyFacts(
      COMPANY,
      deps({ client: modelReturning([INVENTED_FACT, REAL_FACT]) }),
    );
    expect(facts.map((f) => f.claim)).toEqual([REAL_FACT.claim]);
  });

  it("does not soften an uncorroborated claim into a caveated one", () => {
    // Stated as its own case because "show it with a warning" is the reflex,
    // and it is the wrong answer here for the reason referenceContract.js
    // gives: there is no milder version of a claim the candidate cannot
    // stand behind. It is nothing, so it is dropped.
    return buildCompanyFacts(COMPANY, deps({ client: modelReturning([INVENTED_FACT]) })).then(
      (facts) => {
        expect(facts).toEqual([]);
      },
    );
  });
});

describe("buildCompanyFacts — grounding URIs are resolved BEFORE they are compared", () => {
  it("corroborates against the resolved destination, not the redirect URI", async () => {
    // THE trap, documented at length in referenceContract.js's own header:
    // groundingMetadata's `web.uri` is sometimes a publisher URL and sometimes
    // a vertexaisearch.cloud.google.com/grounding-api-redirect/... link.
    // Comparing a model's https://www.purplewave.com/about against a raw
    // redirect is false for EVERY link forever, so the feature returns zero
    // facts and looks exactly like a model that searched nothing.
    const resolveGrounded = vi.fn(async () => [{ uri: "https://www.purplewave.com/about" }]);
    const facts = await buildCompanyFacts(
      COMPANY,
      deps({
        extractGrounded: () => [
          { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/xyz" },
        ],
        resolveGrounded,
      }),
    );
    expect(resolveGrounded).toHaveBeenCalledTimes(1);
    expect(facts).toHaveLength(1);
  });
});

describe("buildCompanyFacts — every failure degrades to no facts (AC-V4.7)", () => {
  it("makes no model call at all when there is no company", async () => {
    const client = modelReturning([REAL_FACT]);
    const facts = await buildCompanyFacts({ company: "", jobTitle: "Engineer" }, deps({ client }));
    expect(facts).toEqual([]);
    expect(client.models.generateContent).not.toHaveBeenCalled();
  });

  it("returns no facts, and does not reject, when the model call throws", async () => {
    // This rides beside an answer the candidate is waiting on mid-question.
    // It must never be able to fail the request it rides beside — the same
    // contract generateIdealProjectExample already keeps.
    const client = { models: { generateContent: vi.fn(async () => { throw new Error("503"); }) } };
    await expect(buildCompanyFacts(COMPANY, deps({ client }))).resolves.toEqual([]);
  });

  it("returns no facts when the response carries no JSON at all", async () => {
    const client = { models: { generateContent: vi.fn(async () => ({ text: "I could not find anything." })) } };
    await expect(buildCompanyFacts(COMPANY, deps({ client }))).resolves.toEqual([]);
  });

  it("returns no facts when the search produced no grounding metadata", async () => {
    // No grounding means nothing to corroborate against, which means every
    // claim is unverifiable — not that every claim should be trusted.
    await expect(
      buildCompanyFacts(COMPANY, deps({ extractGrounded: () => [], resolveGrounded: async () => [] })),
    ).resolves.toEqual([]);
  });

  it("returns no facts, and does not reject, when resolving a grounded URI throws", async () => {
    await expect(
      buildCompanyFacts(
        COMPANY,
        deps({ resolveGrounded: async () => { throw new Error("network"); } }),
      ),
    ).resolves.toEqual([]);
  });

  it("drops an entry missing a claim or a URL rather than shipping a blank", async () => {
    const facts = await buildCompanyFacts(
      COMPANY,
      deps({
        client: modelReturning([
          { claim: "", url: "https://www.purplewave.com/about" },
          { claim: "Something true.", url: "" },
          REAL_FACT,
        ]),
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0].claim).toBe(REAL_FACT.claim);
  });
});

describe("buildCompanyFacts — the model call is a grounded search", () => {
  it("asks with the googleSearch tool and without a JSON response mime type", async () => {
    // Both halves matter and they are linked: the search tool is what makes
    // the claims checkable at all, and it is incompatible with a JSON mime
    // type — which is exactly why the response has to be parsed defensively
    // rather than with parseModelJson.
    const client = modelReturning([REAL_FACT]);
    await buildCompanyFacts(COMPANY, deps({ client }));
    const args = client.models.generateContent.mock.calls[0][0];
    // AC-V4.8: asserted at `args.config.tools`, NOT `args.tools`. This
    // assertion previously read the top level and passed against exactly the
    // shape the SDK silently discards — an injected fake sees whatever object
    // the caller hands it, so it can never observe the parameter transformer
    // that drops a top-level `tools`. It therefore pinned the bug in place
    // rather than catching it. The layer this file cannot see is covered by
    // companyFactsSource.wire.test.js, which drives the real SDK with a
    // stubbed fetch; what THIS file is still good for is the position the
    // module puts the key in, which is what the line below now checks.
    expect(args.config?.tools).toEqual([{ googleSearch: {} }]);
    expect(args.tools).toBeUndefined();
    expect(args.config?.responseMimeType).toBeUndefined();
    expect(args.model).toBe("gemini-2.5-flash");
  });
});
