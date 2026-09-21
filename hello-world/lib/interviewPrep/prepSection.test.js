// ---------------------------------------------------------------------------
// N45 step S8's pure half -- lib/interviewPrep/prepSection.js:
// `buildSectionPrompt` and `parseSectionResponse`.
// AC-EGRESS.1, and the one-boundary strip that keeps a model-supplied
// `templateOrigin` out of a pack through the new door.
// ---------------------------------------------------------------------------
//
// RED ON HEAD: the module does not exist. Every case below fails at import
// resolution, which is the clearest possible statement of what is missing.
//
// WHY THE MODULE EXISTS AT ALL (plan §3.6): `route.js` is 813 lines against
// this repo's standing 1000-line ceiling. A section prompt plus a section
// parser plus the merge orchestration would carry it past. The prompt builder
// and the parser are pure, so they go here.
//
// BOUND CONTRACTS (the plan named the functions; this file pins their wire):
//   buildSectionPrompt({position, digest, section}) -> string
//   parseSectionResponse(response, expectedSection)
//       -> {ok: true, content, claims} | {ok: false, error}
//   `response` is the PROVIDER response object -- the same `{text}` shape
//   route.js's own parsePrepResponse takes (:273-287) -- not a pre-parsed
//   object. That matters: the `templateOrigin` strip has to happen at the ONE
//   boundary where untrusted model JSON becomes a pack, or a second call site
//   that parses a reply itself reopens F-1's K1-SHAPE exemption.
//
// AC-EGRESS.1 IS THE POINT OF THIS FILE. N8/N34 (widening what the prompt
// sends) is explicitly out of scope for this chunk, and a new prompt builder
// is exactly where a widening arrives unnoticed -- so the egress assertion
// below runs against a DELIBERATELY WIDENED double as well, and must fail
// there. Without that canary, "the name does not appear in the prompt" is
// equally satisfied by a builder that returns the empty string.

import { describe, it, expect } from "vitest";
import { buildSectionPrompt, parseSectionResponse } from "./prepSection.js";

const SECTION_NAMES = ["aboutYou", "whyRole", "askThem", "stages"];

// Distinctive, unmistakable strings: if any of these turns up in a prompt it
// got there from the argument it was planted in, not by coincidence.
const CANDIDATE_NAME = "Zephyrine Quillingsworth";
const INTERVIEWER_NAME = "Bartholomew Ravensmark";
const OTHER_SECTION_TEXT = "Quokka telemetry rewrote my whole understanding of latency.";

const POSITION = {
  id: "pos-1",
  title: "Staff Engineer",
  company: "Acme Robotics",
  description: "Own the fleet control plane and its rollout tooling.",
};

const DIGEST = {
  status: "ready",
  markdown: "Acme Robotics builds warehouse fleets and publishes its engineering blog weekly.",
};

/** The arguments a WIDENED builder would find useful, planted on the same
 *  argument object. A builder that reads only what its contract names cannot
 *  reach any of them; one that spreads its input into the prompt can. */
function argsWithForbiddenMaterial(section) {
  return {
    position: POSITION,
    digest: DIGEST,
    section,
    // None of these is in the bound signature. They are here because a real
    // caller (route.js) has all of them in scope at the call site, and the
    // cheapest wrong implementation is the one that passes the whole context
    // object through.
    storedNames: [CANDIDATE_NAME, INTERVIEWER_NAME],
    candidateName: CANDIDATE_NAME,
    interviewerNames: [INTERVIEWER_NAME],
    pack: {
      version: 1,
      sections: { aboutYou: { answer: { lines: [{ text: OTHER_SECTION_TEXT, support: null }] } } },
      claims: [],
    },
  };
}

const FORBIDDEN = [CANDIDATE_NAME, INTERVIEWER_NAME, OTHER_SECTION_TEXT];

/** THE EGRESS ASSERTION, as a function so the same instrument can be pointed
 *  at a deliberately widened double. Throws on the first violation. */
function assertNoForbiddenEgress(prompt) {
  if (typeof prompt !== "string" || prompt.trim().length < 50) {
    throw new Error(`prompt is not a real prompt: ${JSON.stringify(prompt)}`);
  }
  for (const needle of FORBIDDEN) {
    if (prompt.includes(needle)) throw new Error(`prompt carries forbidden material: ${needle}`);
  }
}

// ---------------------------------------------------------------------------

describe("INSTRUMENT CANARY -- the egress assertion is not vacuous", () => {
  it("fails against a builder that splices the candidate's name in, and against an empty prompt", () => {
    const widened = (args) =>
      [
        `You are preparing ${args.candidateName} for an interview.`,
        `Posting:\n${args.position.description}`,
      ].join("\n\n");
    expect(() => assertNoForbiddenEgress(widened(argsWithForbiddenMaterial("aboutYou")))).toThrow(/forbidden material/);

    const widenedWithOtherSections = (args) =>
      `Here is the rest of the pack so far:\n${JSON.stringify(args.pack)}\n\nPosting:\n${args.position.description}`;
    expect(() => assertNoForbiddenEgress(widenedWithOtherSections(argsWithForbiddenMaterial("askThem")))).toThrow(
      /forbidden material/,
    );

    // And the other way a "clean" prompt can be a lie: an empty one passes
    // every substring check ever written.
    expect(() => assertNoForbiddenEgress("")).toThrow(/not a real prompt/);
  });
});

describe("AC-EGRESS.1 -- the one-section prompt sends no names and no other section's content", () => {
  for (const section of SECTION_NAMES) {
    it(`[${section}] carries neither stored names nor another section's text`, () => {
      assertNoForbiddenEgress(buildSectionPrompt(argsWithForbiddenMaterial(section)));
    });
  }

  it("[positive control] it DOES carry the two inputs it is supposed to -- the posting and the digest", () => {
    // Without this, a builder that sends a bare instruction and no context
    // satisfies every assertion above while producing a useless generation.
    const prompt = buildSectionPrompt(argsWithForbiddenMaterial("whyRole"));
    expect(prompt).toContain(POSITION.description);
    expect(prompt).toContain(DIGEST.markdown);
    expect(prompt).toContain(POSITION.title);
    expect(prompt).toContain(POSITION.company);
  });

  it("names the requested section, and only it, as the thing to produce", () => {
    // The other three are checked in their QUOTED form -- the shape a JSON
    // schema literal carries -- rather than as bare words, because "stages"
    // is also ordinary English in this domain and a prose collision would make
    // this assertion fail for a correct build.
    const prompt = buildSectionPrompt({ position: POSITION, digest: DIGEST, section: "askThem" });
    expect(prompt).toContain("askThem");
    for (const other of SECTION_NAMES.filter((s) => s !== "askThem")) {
      expect(prompt, `the askThem prompt also asks for ${other}`).not.toContain(`"${other}"`);
    }
  });

  it("keeps the prompt-level person-naming prohibition the whole-pack prompt already carries", () => {
    // route.js:256-257's two instructions are 1g's prompt-level primary
    // defence for K1-PROHIBITION and the no-names rule. A new prompt that
    // drops them leaves only normalizePack's structural backstop, which is
    // defence in depth turned into defence in one.
    for (const section of SECTION_NAMES) {
      const prompt = buildSectionPrompt({ position: POSITION, digest: DIGEST, section });
      expect(prompt, `the ${section} prompt does not forbid naming a person`).toMatch(/never\s+(name|write)/i);
      expect(prompt).toMatch(/JSON/);
    }
  });

  it("works with no digest on file, without inventing one", () => {
    const prompt = buildSectionPrompt({ position: POSITION, digest: null, section: "stages" });
    expect(typeof prompt).toBe("string");
    expect(prompt).toContain(POSITION.description);
    expect(prompt).not.toContain(DIGEST.markdown);
  });
});

describe("parseSectionResponse -- one section in, one section out", () => {
  function reply(body) {
    return { text: JSON.stringify(body) };
  }

  it("accepts a well-formed one-section reply and returns its content and claims", () => {
    const content = { questions: [{ text: "How is this team's work measured?", support: null }] };
    const claims = [{ id: "x1", text: "Acme publishes its loop.", sourceUrl: "https://acme.example/careers" }];
    const result = parseSectionResponse(reply({ section: "askThem", content, claims }), "askThem");
    expect(result.ok).toBe(true);
    expect(result.content).toEqual(content);
    expect(result.claims).toEqual(claims);
  });

  it("refuses a reply that names a DIFFERENT section than the one requested", () => {
    // The route asked for one section and is about to merge the answer into
    // that slot. A reply for another section merged into it would destroy the
    // requested section and corrupt the other -- silently, since both are
    // well-formed.
    const result = parseSectionResponse(
      reply({ section: "aboutYou", content: { answer: { lines: [] } }, claims: [] }),
      "askThem",
    );
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe("string");
  });

  it("never copies a top-level key other than section, content and claims -- templateOrigin cannot ride in", () => {
    // F-1's K1-SHAPE exemption keys off `pack.templateOrigin`, a field only
    // buildEmbeddedPack's literal may set. route.js closes this for the
    // whole-pack reply with an explicit `delete` at the same boundary (:285);
    // a second parser that forgets reopens a full O-15 bypass.
    const result = parseSectionResponse(
      reply({
        section: "askThem",
        content: { questions: [] },
        claims: [],
        templateOrigin: "embedded-template",
        version: 99,
      }),
      "askThem",
    );
    expect(result.ok).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(result, "templateOrigin")).toBe(false);
    expect(JSON.stringify(result)).not.toContain("embedded-template");
    expect(JSON.stringify(result.content)).not.toContain("embedded-template");
  });

  it("refuses junk without throwing: no text, non-JSON, a JSON array, a JSON scalar, a missing content", () => {
    const cases = [
      [undefined, "no response at all"],
      [{}, "no text"],
      [{ text: "   " }, "blank text"],
      [{ text: "not json" }, "not JSON"],
      [{ text: "[1,2,3]" }, "an array"],
      [{ text: '"a string"' }, "a scalar"],
      [{ text: JSON.stringify({ section: "askThem" }) }, "no content"],
      [{ text: JSON.stringify({ content: { questions: [] } }) }, "no section"],
    ];
    for (const [response, why] of cases) {
      const result = parseSectionResponse(response, "askThem");
      expect(result.ok, `accepted ${why}`).toBe(false);
      expect(typeof result.error).toBe("string");
    }
  });

  it("a missing claims array is normalised to [], never left undefined", () => {
    const result = parseSectionResponse(reply({ section: "stages", content: { stages: [] } }), "stages");
    expect(result.ok).toBe(true);
    expect(result.claims).toEqual([]);
  });

  it("makes NO emptiness judgement -- an empty body parses fine and is the merge's problem, not the parser's", () => {
    // completeSections/packStatus decide emptiness over the MERGED, normalized
    // document (prepPack.js). A parser that refused an empty section would put
    // a second, different content gate in the pipeline, and the two would
    // drift.
    const result = parseSectionResponse(reply({ section: "askThem", content: { questions: [] }, claims: [] }), "askThem");
    expect(result.ok).toBe(true);
    expect(result.content).toEqual({ questions: [] });
  });
});
