// Reference links for a meeting discussion point — the rules that decide
// which of a model's suggested links a user is allowed to see.
//
// THE PREMISE: language models invent plausible URLs. A fabricated link read
// aloud in a real meeting ("the docs say X — here's the page") is far worse
// than no link at all, because the user stakes their credibility on it in
// front of colleagues. So the default here is REFUSAL, and a link earns its
// way onto the screen by being corroborated against the pages Google actually
// visited.
//
// This repo already treats model-written URLs as presumptively fabricated in
// five separate places (reconcileCitations, parseDigestAnswer,
// parseLifecycleAnswer, the feed search, and the meeting copilot's own page
// citations). This is the sixth, and it is the strictest, because it is the
// only one whose output a user is expected to quote.
//
// FIXTURE POLICY — read before adding a case. What
// `groundingMetadata.groundingChunks[].web.uri` holds is not consistent
// across this repo's own grounded features: some match it as a PUBLISHER
// url, others treat it as a vertexaisearch.cloud.google.com redirect. The
// previous version of this file passed the SAME array as both the model's
// links and the grounded uris, which quietly assumed the publisher world and
// is exactly why "resolve after corroborating" shipped returning zero links
// forever. So the default fixture below is REDIRECT-shaped and resolves
// through an injected fetcher, and `describe("the publisher world")` keeps
// the other reading covered. Do not add a case that is grounded on the
// model's own url with no resolution step.

import { describe, it, expect, vi } from "vitest";
import {
  normalizeReferences,
  resolveGroundedSources,
  MAX_REFERENCES_PER_INSIGHT,
} from "./referenceContract.js";

const EFFECT_URL = "https://react.dev/learn/you-might-not-need-an-effect";
const HPA_URL = "https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/";

const redirectFor = (slug) => `https://vertexaisearch.cloud.google.com/grounding-api-redirect/${slug}`;

// Grounding as Google actually hands it back in the redirect world: opaque
// links that are not comparable to anything the model wrote.
const GROUNDED = [
  { uri: redirectFor("AbC123"), title: "You Might Not Need an Effect" },
  { uri: redirectFor("DeF456"), title: "HPA" },
];

const RESOLUTIONS = {
  [redirectFor("AbC123")]: EFFECT_URL,
  [redirectFor("DeF456")]: HPA_URL,
};

// Stands in for fetchUrlContent: follows the redirect table above, and
// reports anything it does not know as unreachable the way the real fetcher
// does (an `{ error }` result, not a throw).
function redirectFollower(table = RESOLUTIONS) {
  return vi.fn(async (uri) =>
    table[uri] ? { finalUrl: table[uri], title: "page" } : { error: "Failed to fetch URL (status 404)." },
  );
}

const ref = (over = {}) => ({
  title: "You Might Not Need an Effect",
  url: EFFECT_URL,
  ...over,
});

const opts = (over = {}) => ({ grounded: GROUNDED, fetchImpl: redirectFollower(), ...over });

describe("what survives", () => {
  it("keeps a link to the exact page the model actually searched", async () => {
    const { references } = await normalizeReferences([ref()], opts());
    expect(references).toHaveLength(1);
    expect(references[0].url).toBe(EFFECT_URL);
    expect(references[0].title).toBe("You Might Not Need an Effect");
  });

  it("carries the host separately, so a card can show where a link goes", async () => {
    // A user deciding whether to cite something out loud reads the source
    // name, not the URL. "react.dev" is the useful half.
    const { references } = await normalizeReferences([ref()], opts());
    expect(references[0].host).toBe("react.dev");
  });

  it("falls back to the host when the model gave no title", async () => {
    // Never an empty link label: a bare "" renders as an unreadable target
    // and is unusable by a screen reader.
    const { references } = await normalizeReferences([ref({ title: "" })], opts());
    expect(references[0].title).toBe("react.dev");
  });
});

// THE defect this file's fixtures were rewritten to catch. Comparing the
// model's publisher url against a raw grounding redirect is false for every
// link forever: the feature returns zero references and every card reads "N
// suggestions could not be verified" — indistinguishable from the model
// behaving badly, so nobody suspects the code.
describe("resolve, THEN corroborate", () => {
  it("keeps a publisher link that only a RESOLVED grounding redirect corroborates", async () => {
    const fetchImpl = redirectFollower();
    const { references, dropped, grounded } = await normalizeReferences([ref()], opts({ fetchImpl }));

    expect(references).toHaveLength(1);
    expect(references[0].url).toBe(EFFECT_URL);
    expect(dropped).toBe(0);
    expect(grounded).toBe(true);
    // The redirect had to be followed for that to be possible.
    expect(fetchImpl).toHaveBeenCalledWith(redirectFor("AbC123"));
  });

  it("still refuses an invented page even once the redirects are resolved", async () => {
    // Resolution widens what CAN be corroborated; it must not widen what
    // counts as corroboration.
    const { references, dropped } = await normalizeReferences(
      [ref({ url: "https://react.dev/learn/invented-page" })],
      opts(),
    );
    expect(references).toHaveLength(0);
    expect(dropped).toBe(1);
  });

  it("ships exactly the url it corroborated, never one substituted afterwards", async () => {
    // The follow-on defect: an earlier version corroborated the model's url
    // and THEN overwrote it with wherever a second fetch landed, with
    // nothing re-checking the substitute. A publisher 301 to a marketing
    // homepage, a rebrand, or an open redirect on a grounded host became a
    // link the user read aloud believing it had been verified.
    const fetchImpl = vi.fn(async (uri) =>
      uri === redirectFor("AbC123")
        ? { finalUrl: EFFECT_URL }
        : { finalUrl: "https://react.dev/marketing-homepage" },
    );
    const { references } = await normalizeReferences([ref()], opts({ fetchImpl }));
    expect(references).toHaveLength(1);
    expect(references[0].url).toBe(EFFECT_URL);
    expect(references.map((r) => r.url)).not.toContain("https://react.dev/marketing-homepage");
  });

  it("falls back to the UNRESOLVED uri rather than losing that evidence", async () => {
    // enrichArticles' fallback policy, taken exactly: our own fetch failing
    // is not proof the model did not search the page. The uri stays usable
    // as corroboration in whichever world it came from.
    const fetchImpl = vi.fn().mockResolvedValue({ error: "Failed to fetch URL (status 403)." });
    const { references } = await normalizeReferences(
      [ref({ url: EFFECT_URL })],
      { grounded: [{ uri: EFFECT_URL }], fetchImpl },
    );
    expect(references).toHaveLength(1);
    expect(references[0].url).toBe(EFFECT_URL);
  });

  it("falls back the same way when the fetcher throws outright", async () => {
    // fetchUrlContent's contract is to return `{ error }`, but a network
    // layer can still reject, and a rejection must not lose the evidence
    // either.
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const { references } = await normalizeReferences(
      [ref({ url: EFFECT_URL })],
      { grounded: [{ uri: EFFECT_URL }], fetchImpl },
    );
    expect(references).toHaveLength(1);
  });
});

// The other reading of the same metadata field, kept covered so neither
// world can regress unnoticed.
describe("the publisher world (grounding uris that are already real pages)", () => {
  const publisherGrounded = [{ uri: EFFECT_URL, title: "Effect" }, { uri: HPA_URL, title: "HPA" }];
  // A publisher page resolves to ITSELF, which is what makes resolve-first
  // correct in both worlds rather than a trade between them.
  const selfResolving = () => vi.fn(async (uri) => ({ finalUrl: uri }));

  it("keeps a link the model cited exactly as grounded", async () => {
    const { references } = await normalizeReferences([ref()], {
      grounded: publisherGrounded,
      fetchImpl: selfResolving(),
    });
    expect(references).toHaveLength(1);
    expect(references[0].url).toBe(EFFECT_URL);
  });

  it("still DROPS an invented page on a host the model really did search", async () => {
    // The central case. A model that genuinely searched react.dev will
    // cheerfully cite react.dev/learn/a-page-that-never-existed, and a
    // host-only check blesses it. Dropped, not demoted: an uncorroborated
    // "reference" has no value as plain text either — the user asked for
    // something they could open and quote.
    const { references, dropped } = await normalizeReferences(
      [ref({ url: "https://react.dev/learn/invented-page" })],
      { grounded: publisherGrounded, fetchImpl: selfResolving() },
    );
    expect(references).toHaveLength(0);
    expect(dropped).toBe(1);
  });
});

describe("what gets refused", () => {
  it("drops everything when the model did not ground at all", async () => {
    // No grounding is not "nothing to check against" — it is positive
    // evidence that no search happened, so every URL in that answer was
    // written from memory.
    const { references, dropped, grounded } = await normalizeReferences(
      [ref(), ref({ url: HPA_URL })],
      opts({ grounded: [] }),
    );
    expect(references).toHaveLength(0);
    expect(dropped).toBe(2);
    expect(grounded).toBe(false);
  });

  it("reports that it WAS grounded when it was", async () => {
    // Positive control for the flag above: the UI says something different
    // for "the search found nothing citable" than for "no search happened".
    const { grounded } = await normalizeReferences([ref()], opts());
    expect(grounded).toBe(true);
  });

  it("reports it WAS grounded even when nothing could be resolved", async () => {
    // `grounded` answers "did the model search", which is a property of the
    // raw metadata — not of how much of it our own fetcher could reach.
    const { grounded } = await normalizeReferences(
      [ref()],
      opts({ fetchImpl: vi.fn().mockResolvedValue({ error: "unreachable" }) }),
    );
    expect(grounded).toBe(true);
  });

  it("drops a dangerous scheme even if it appears in grounding", async () => {
    const poisoned = [{ uri: "javascript:alert(1)", title: "x" }];
    const { references } = await normalizeReferences(
      [ref({ url: "javascript:alert(1)" })],
      opts({ grounded: poisoned }),
    );
    expect(references).toHaveLength(0);
  });

  it("drops a link with no usable url at all", async () => {
    const { references } = await normalizeReferences(
      [ref({ url: "" }), ref({ url: null }), ref({ url: "not a url" })],
      opts(),
    );
    expect(references).toHaveLength(0);
  });

  it("survives a model returning something that is not a list", async () => {
    // This runs mid-meeting; it may not throw.
    expect((await normalizeReferences(undefined, opts())).references).toEqual([]);
    expect((await normalizeReferences(null, opts())).references).toEqual([]);
    expect((await normalizeReferences("https://react.dev", opts())).references).toEqual([]);
    expect((await normalizeReferences([null, 42, {}], opts())).references).toEqual([]);
  });
});

describe("volume and duplicates", () => {
  it("de-duplicates the same page cited twice", async () => {
    // Trailing slash, tracking parameters and host case are all noise a model
    // adds; two spellings of one page is one reference.
    const { references } = await normalizeReferences(
      [ref(), ref({ url: `https://WWW.react.dev/learn/you-might-not-need-an-effect/?utm_source=x` })],
      opts(),
    );
    expect(references).toHaveLength(1);
  });

  it("counts ONE fabricated page cited three ways as ONE dropped suggestion", async () => {
    // `dropped` is what the card's "N suggestions could not be verified"
    // sentence is built from, and that sentence exists to be honest about
    // integrity. Counting before de-duplicating reported 3 for a single bad
    // url spelled three ways — inflating the one number in this feature
    // whose entire job is not to overstate.
    const fake = "https://react.dev/learn/invented-page";
    const { references, dropped } = await normalizeReferences(
      [
        ref({ url: fake }),
        ref({ url: `${fake}/` }),
        ref({ url: `https://www.react.dev/learn/invented-page?utm_source=x` }),
      ],
      opts(),
    );
    expect(references).toHaveLength(0);
    expect(dropped).toBe(1);
  });

  it("caps how many it will show", async () => {
    // A user glancing at this mid-sentence can act on two or three links, not
    // ten. The cap is about what is usable in the moment, not about cost.
    const many = Array.from({ length: MAX_REFERENCES_PER_INSIGHT + 4 }, (_, i) => ({
      title: `Doc ${i}`,
      url: `https://react.dev/learn/page-${i}`,
    }));
    const table = Object.fromEntries(many.map((m, i) => [redirectFor(`r${i}`), m.url]));
    const grounded = many.map((_, i) => ({ uri: redirectFor(`r${i}`), title: `Doc ${i}` }));
    const { references } = await normalizeReferences(many, {
      grounded,
      fetchImpl: redirectFollower(table),
    });
    expect(references).toHaveLength(MAX_REFERENCES_PER_INSIGHT);
  });

  it("counts only genuinely unusable links as dropped, not the ones it capped", async () => {
    // `dropped` drives an honest "N suggestions could not be verified"
    // message. Folding the cap into it would make that message a lie.
    const many = Array.from({ length: MAX_REFERENCES_PER_INSIGHT + 4 }, (_, i) => ({
      title: `Doc ${i}`,
      url: `https://react.dev/learn/page-${i}`,
    }));
    const table = Object.fromEntries(many.map((m, i) => [redirectFor(`r${i}`), m.url]));
    const grounded = many.map((_, i) => ({ uri: redirectFor(`r${i}`), title: `Doc ${i}` }));
    const { dropped } = await normalizeReferences(many, {
      grounded,
      fetchImpl: redirectFollower(table),
    });
    expect(dropped).toBe(0);
  });
});

describe("resolveGroundedSources", () => {
  it("resolves each grounding redirect to the page it really points at", async () => {
    const fetchImpl = redirectFollower();
    const resolved = await resolveGroundedSources(GROUNDED, { fetchImpl });
    expect(resolved.map((r) => r.uri)).toEqual([EFFECT_URL, HPA_URL]);
  });

  it("preserves input order, so one slow publisher cannot shuffle the evidence", async () => {
    const fetchImpl = vi.fn(async (uri) => {
      if (uri === redirectFor("AbC123")) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { finalUrl: EFFECT_URL };
      }
      return { finalUrl: HPA_URL };
    });
    const resolved = await resolveGroundedSources(GROUNDED, { fetchImpl, concurrency: 2 });
    expect(resolved.map((r) => r.uri)).toEqual([EFFECT_URL, HPA_URL]);
  });

  it("keeps an unreachable uri unresolved instead of dropping it", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ error: "Failed to fetch URL (status 403)." });
    const resolved = await resolveGroundedSources([{ uri: EFFECT_URL, title: "Effect" }], { fetchImpl });
    expect(resolved).toEqual([{ uri: EFFECT_URL, title: "Effect" }]);
  });

  it("accepts bare uri strings and never throws on garbage", async () => {
    const fetchImpl = vi.fn(async () => ({ finalUrl: EFFECT_URL }));
    expect(await resolveGroundedSources([EFFECT_URL], { fetchImpl })).toEqual([
      { uri: EFFECT_URL, title: "" },
    ]);
    expect(await resolveGroundedSources(undefined, { fetchImpl })).toEqual([]);
    expect(await resolveGroundedSources([null, {}, { uri: "" }], { fetchImpl })).toEqual([]);
  });
});
