// ---------------------------------------------------------------------------
// lib/interviewPrep/prepClaims.js -- INV-CLAIM-1 as an executable invariant.
// Plan step S2; contracts in plan §6.1. AC-CLAIM.1-5 and AC-CLAIM.9.
//
// RED BECAUSE THE MODULE DOES NOT EXIST YET.
//
// WHY THIS INVARIANT EXISTS AT ALL. Today one flat `pack.claims` array serves
// all four sections and `isCitedClaim` resolves a support by id
// (prepParse.js:355). Regenerate ONE section and that array has to be
// rewritten in place: keep the three untouched sections' claims, drop the
// replaced section's, add the new ones. Every way of getting that wrong is
// silent -- a dangling id makes `normalizeDroppingList` null the support, and
// the citation simply disappears from the candidate's screen with no error
// anywhere. Ownership encoded IN the id is what makes "which claims belong to
// the section I am replacing" answerable without guessing.
//
// THE TWO FAILURE DIRECTIONS, both covered below:
//   over-refusing   every pre-N45 pack carries model-minted ids with no
//                   `c/<section>/<hex>` shape. Treating an unowned id as a
//                   violation makes every existing pack permanently
//                   un-regenerable. AC-CLAIM.5 is a required PASS fixture,
//                   not the absence of a refusal test.
//   under-refusing  a gate that returns [] on malformed input is vacuous and
//                   every bad pack writes (plan risk R8).

import { describe, it, expect } from "vitest";
import {
  mintClaimId,
  claimOwner,
  mintSectionClaims,
  mintUnownedReferencedClaims,
  claimOwnershipViolations,
  normalizeLegacyClaimIds,
} from "./prepClaims.js";

const OWNED_ID_SHAPE = /^c\/(aboutYou|whyRole|askThem|stages)\/[0-9a-f]{16}$/;

function supported(text, claimId) {
  return { text, support: { kind: "claim", claimId } };
}

function claim(id, text = "Acme opened a Berlin office.", sourceUrl = "https://acme.example/news") {
  return { id, text, sourceUrl };
}

/** A pack whose four sections are well-formed and whose supports resolve. */
function packWith({ askThemClaimId, claims }) {
  return {
    version: 1,
    sections: {
      aboutYou: { answer: { lines: [{ text: "I ship reliable systems.", support: null }] } },
      whyRole: { answer: { lines: [{ text: "This role matches my background.", support: null }] } },
      askThem: { questions: [supported("How did the Berlin office change the roadmap?", askThemClaimId)] },
      stages: { stages: [{ name: "Overview", questions: ["Tell me about yourself."], recommendedAnswer: null, support: null }] },
    },
    claims,
  };
}

describe("mintClaimId / claimOwner", () => {
  it("[RED: module absent] mints `c/<section>/<16 lowercase hex>` and round-trips through claimOwner", () => {
    for (const section of ["aboutYou", "whyRole", "askThem", "stages"]) {
      const id = mintClaimId(section);
      expect(id).toMatch(OWNED_ID_SHAPE);
      expect(claimOwner(id)).toBe(section);
    }
  });

  it("[RED: module absent] two mints for the same section differ", () => {
    const ids = new Set(Array.from({ length: 50 }, () => mintClaimId("stages")));
    expect(ids.size).toBe(50);
  });

  it("[RED: module absent] an unrecognized section THROWS -- a programming error, never a value to normalise", () => {
    // triggerClassOf's V-8 ruling, applied here: a section name outside the
    // four can only be a coding mistake, and silently normalising it would
    // mint an id owned by a section that does not exist.
    expect(() => mintClaimId("aboutyou")).toThrow();
    expect(() => mintClaimId("")).toThrow();
    expect(() => mintClaimId(undefined)).toThrow();
  });

  it("[RED: module absent] claimOwner is total: a legacy or foreign-shaped id is null, never a throw", () => {
    for (const id of ["claim-1", "", null, undefined, 7, {}, "c/aboutYou/NOTHEX0000000000", "c/nope/0123456789abcdef"]) {
      expect(claimOwner(id)).toBeNull();
    }
  });
});

describe("mintSectionClaims -- AC-CLAIM.9, no model-supplied string survives as an id", () => {
  it("[RED: module absent] attacker-chosen ids are replaced wholesale, and the section's own supports are re-pointed", () => {
    const hostile = [
      claim("'; DROP TABLE interview_prep_packs; --"),
      claim("c/aboutYou/deadbeefdeadbeef"),
    ];
    const content = {
      questions: [
        supported("First question", "'; DROP TABLE interview_prep_packs; --"),
        supported("Second question", "c/aboutYou/deadbeefdeadbeef"),
      ],
    };

    const out = mintSectionClaims("askThem", content, hostile);

    for (const entry of out.claims) {
      expect(entry.id).toMatch(/^c\/askThem\/[0-9a-f]{16}$/);
    }
    const mintedIds = new Set(out.claims.map((c) => c.id));
    for (const question of out.content.questions) {
      expect(mintedIds.has(question.support.claimId)).toBe(true);
    }
    // The attacker's own strings survive NOWHERE in the output.
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("DROP TABLE");
    expect(serialized).not.toContain("c/aboutYou/deadbeefdeadbeef");
  });

  it("[RED: module absent -- plan risk R7 / N49 non-foreclosure] a support nested DEEPER than any shape in use today is still minted", () => {
    // BINDING, plan §7.5: the reference walk must be GENERIC. N49 splits a
    // Stage's single `support` into per-question provenance. A walk that
    // enumerates the four currently-known support positions would leave those
    // unminted -- a dangling id, a citation that silently vanishes -- and
    // would force N49 to re-mint every stored revision.
    const deep = {
      stages: [
        {
          name: "Onsite",
          rounds: [{ questions: [supported("Deeply nested question", "model-id-1")] }],
          support: { kind: "claim", claimId: "model-id-2" },
        },
      ],
    };
    const out = mintSectionClaims("stages", deep, [claim("model-id-1"), claim("model-id-2")]);

    const nested = out.content.stages[0].rounds[0].questions[0].support.claimId;
    expect(nested).toMatch(/^c\/stages\/[0-9a-f]{16}$/);
    expect(out.content.stages[0].support.claimId).toMatch(/^c\/stages\/[0-9a-f]{16}$/);
    expect(nested).not.toBe(out.content.stages[0].support.claimId);
    expect(out.claims).toHaveLength(2);
  });

  it("[RED: module absent] a supplied claim NO surviving reference names is DROPPED", () => {
    const out = mintSectionClaims("askThem", { questions: [supported("Q", "used")] }, [
      claim("used"),
      claim("orphan"),
    ]);
    expect(out.claims).toHaveLength(1);
  });

  it("[RED: module absent] is total: an object-map claims blob, junk, and non-object entries are all survivable", () => {
    expect(() => mintSectionClaims("aboutYou", null, null)).not.toThrow();
    expect(() => mintSectionClaims("aboutYou", { answer: { lines: [] } }, "nonsense")).not.toThrow();
    // normalizeClaims (prepParse.js:392) converts an object map rather than
    // dropping it; this function converts one the same way.
    const mapped = mintSectionClaims(
      "aboutYou",
      { answer: { lines: [supported("line", "k1")] } },
      { k1: { text: "fact", sourceUrl: "https://acme.example/a" } },
    );
    expect(mapped.claims).toHaveLength(1);
    expect(mapped.claims[0].id).toMatch(/^c\/aboutYou\/[0-9a-f]{16}$/);
  });

  it("[RED: module absent] never mutates its arguments", () => {
    const content = { questions: [supported("Q", "model-1")] };
    const claims = [claim("model-1")];
    const contentSnapshot = JSON.stringify(content);
    const claimsSnapshot = JSON.stringify(claims);
    mintSectionClaims("askThem", content, claims);
    expect(JSON.stringify(content)).toBe(contentSnapshot);
    expect(JSON.stringify(claims)).toBe(claimsSnapshot);
  });

  it("[fix round F-m5, verify.r4.md MINOR] an unmatched ref is NULLED, never left as the model's own dangling id", () => {
    // MUTANT THIS KILLS: rewriteClaimRefs's default `keepUnmatched = false`
    // flipped to `true` (verify.r4.md's MR5-defaultKeep, which survived the
    // full landed suite). mintSectionClaims calls rewriteClaimRefs with no
    // third argument at all, so it relies entirely on that default -- an
    // empty `rawClaims` here means nothing is ever minted, so the support
    // below is unmatched by construction.
    const content = { answer: { lines: [supported("An unsupported claim.", "not-a-real-claim")] } };
    const out = mintSectionClaims("aboutYou", content, []);
    expect(out.claims).toEqual([]);
    expect(out.content.answer.lines[0].support, "an unmatched ref survived instead of being nulled").toBeNull();
  });
});

describe("claimOwnershipViolations -- INV-CLAIM-1 (AC-CLAIM.1-5)", () => {
  it("[RED: module absent -- AC-CLAIM.1] a well-owned pack reports NO violations", () => {
    const id = "c/askThem/0123456789abcdef";
    expect(claimOwnershipViolations(packWith({ askThemClaimId: id, claims: [claim(id)] }))).toEqual([]);
  });

  it("[RED: module absent -- AC-CLAIM.5, THE REQUIRED PASS CASE] a LEGACY unowned id referenced by a section is NOT a violation", () => {
    // Clause (c)'s escape hatch. This is the criterion an implementer who
    // reads "ownership violation" is most likely to get backwards, and
    // getting it backwards makes every pre-N45 pack in production
    // permanently un-regenerable. Stated as a PASS fixture precisely because
    // a suite of refusal tests alone invites exactly that defect.
    const legacy = "claim-7";
    expect(claimOwnershipViolations(packWith({ askThemClaimId: legacy, claims: [claim(legacy)] }))).toEqual([]);
  });

  it("[RED: module absent -- AC-CLAIM.2] two claims entries sharing an id report duplicate-id", () => {
    const id = "c/askThem/0123456789abcdef";
    const pack = packWith({ askThemClaimId: id, claims: [claim(id), claim(id, "A second entry.")] });
    expect(claimOwnershipViolations(pack)).toContainEqual({ kind: "duplicate-id", id });
  });

  it("[RED: module absent -- AC-CLAIM.3] a support resolving to nothing reports dangling, naming the section", () => {
    const pack = packWith({ askThemClaimId: "c/askThem/0123456789abcdef", claims: [] });
    expect(claimOwnershipViolations(pack)).toContainEqual({
      kind: "dangling",
      section: "askThem",
      id: "c/askThem/0123456789abcdef",
    });
  });

  it("[RED: module absent -- AC-CLAIM.4] section T referencing a claim owned by section S reports cross-owner", () => {
    const foreign = "c/aboutYou/0123456789abcdef";
    const pack = packWith({ askThemClaimId: foreign, claims: [claim(foreign)] });
    expect(claimOwnershipViolations(pack)).toContainEqual({
      kind: "cross-owner",
      section: "askThem",
      id: foreign,
    });
  });

  it("[RED: module absent -- plan risk R7] a cross-owner support nested DEEPER than any current shape is still reported", () => {
    // The same generic-walk requirement as mintSectionClaims, on the gate
    // side. A gate that walks only the four known positions is blind to
    // exactly the shapes N49 introduces.
    const foreign = "c/whyRole/0123456789abcdef";
    const pack = packWith({ askThemClaimId: "c/askThem/aaaaaaaaaaaaaaaa", claims: [claim("c/askThem/aaaaaaaaaaaaaaaa"), claim(foreign)] });
    pack.sections.stages.stages[0].rounds = [{ questions: [supported("nested", foreign)] }];
    expect(claimOwnershipViolations(pack)).toContainEqual({
      kind: "cross-owner",
      section: "stages",
      id: foreign,
    });
  });

  it("[RED: module absent -- plan risk R8] is total, and malformed input does not silently return []", () => {
    // A gate that returns [] on anything it cannot parse is VACUOUS: every
    // bad pack writes and the gate looks like it is working. `[]` here means
    // exactly one thing -- "well-owned" -- so input that is not a pack at all
    // must never produce it.
    expect(() => claimOwnershipViolations(undefined)).not.toThrow();
    expect(() => claimOwnershipViolations("not a pack")).not.toThrow();
    const notAPack = claimOwnershipViolations({ sections: "nonsense", claims: "nonsense" });
    expect(Array.isArray(notAPack)).toBe(true);
    expect(notAPack.length).toBeGreaterThan(0);
  });

  it("[no-op control] the corrected form of each refusal fixture passes, so the gate is not simply always-refusing", () => {
    const own = "c/askThem/0123456789abcdef";
    expect(claimOwnershipViolations(packWith({ askThemClaimId: own, claims: [claim(own)] }))).toEqual([]);
    const legacy = "legacy-42";
    expect(claimOwnershipViolations(packWith({ askThemClaimId: legacy, claims: [claim(legacy)] }))).toEqual([]);
    // A support of `null` is the ordinary uncited case and is never a
    // violation of ownership.
    const uncited = packWith({ askThemClaimId: own, claims: [claim(own)] });
    uncited.sections.askThem.questions = [{ text: "Uncited question", support: null }];
    expect(claimOwnershipViolations(uncited)).toEqual([]);
  });
});

describe("mintUnownedReferencedClaims -- F-B1 residual (fix round, verify.r3.md BLOCKER)", () => {
  it("re-mints a legacy free-form claim the section's own content references, into that section's own namespace", () => {
    const content = { answer: { lines: [supported("Maria Lopez leads the platform team.", "legacy-1")] } };
    const pool = [claim("legacy-1", "Maria Lopez leads the platform team.", "https://acme.example/team")];

    const out = mintUnownedReferencedClaims("aboutYou", content, pool);

    expect(out.claims).toHaveLength(1);
    expect(out.claims[0].id).toMatch(/^c\/aboutYou\/[0-9a-f]{16}$/);
    expect(out.claims[0].sourceUrl).toBe("https://acme.example/team");
    expect(out.content.answer.lines[0].support.claimId).toBe(out.claims[0].id);
    expect(out.content.answer.lines[0].support.claimId).not.toBe("legacy-1");
  });

  it("a claim referenced by TWO different sections mints a distinct id in each section's own namespace", () => {
    const pool = [claim("shared", "Acme runs a four-stage loop.", "https://acme.example/careers")];
    const aboutYou = mintUnownedReferencedClaims("aboutYou", supported("Line A", "shared"), pool);
    const whyRole = mintUnownedReferencedClaims("whyRole", supported("Line B", "shared"), pool);

    expect(claimOwner(aboutYou.claims[0].id)).toBe("aboutYou");
    expect(claimOwner(whyRole.claims[0].id)).toBe("whyRole");
    expect(aboutYou.claims[0].id).not.toBe(whyRole.claims[0].id);
    expect(aboutYou.content.support.claimId).toBe(aboutYou.claims[0].id);
    expect(whyRole.content.support.claimId).toBe(whyRole.claims[0].id);
  });

  it("[no-op control] content whose refs are already owned by this same section is left completely untouched", () => {
    // The safety property `buildRevisionSections` (prepGenerationMerge.js)
    // depends on: calling this unconditionally for a section that was just
    // regenerated (never seeded) must not touch its already-correct ids, and
    // must not null them the way `mintSectionClaims`'s own unmatched-ref
    // discipline would.
    const ownId = "c/askThem/0123456789abcdef";
    const content = supported("Already minted question", ownId);
    const pool = [claim(ownId)];

    const out = mintUnownedReferencedClaims("askThem", content, pool);

    expect(out.claims).toEqual([]);
    expect(out.content).toEqual(content);
    expect(out.content.support.claimId).toBe(ownId);
  });

  it("a reference this function was not asked to touch (unresolvable, or owned by a different section) is left in place, never nulled", () => {
    const content = { answer: { lines: [supported("Dangling", "nothing-matches"), supported("Cross-owned", "c/whyRole/0123456789abcdef")] } };
    const out = mintUnownedReferencedClaims("aboutYou", content, []);
    expect(out.claims).toEqual([]);
    expect(out.content.answer.lines[0].support.claimId).toBe("nothing-matches");
    expect(out.content.answer.lines[1].support.claimId).toBe("c/whyRole/0123456789abcdef");
  });

  it("never mutates its arguments", () => {
    const content = supported("Line", "legacy-x");
    const pool = [claim("legacy-x")];
    const contentSnapshot = JSON.stringify(content);
    const poolSnapshot = JSON.stringify(pool);
    mintUnownedReferencedClaims("aboutYou", content, pool);
    expect(JSON.stringify(content)).toBe(contentSnapshot);
    expect(JSON.stringify(pool)).toBe(poolSnapshot);
  });
});

describe("normalizeLegacyClaimIds -- F-m6 (fix round, verify.r5.md MINOR): an OWNED duplicate is still refused", () => {
  it("[fix round F-M5] a repeated LEGACY (unowned) id keeps only the FIRST occurrence", () => {
    const pack = {
      version: 1,
      sections: {},
      claims: [claim("legacy-1", "first"), claim("legacy-1", "second")],
    };
    const out = normalizeLegacyClaimIds(pack);
    expect(out.claims).toHaveLength(1);
    expect(out.claims[0].text).toBe("first");
  });

  it("[fix round F-m6, verify.r5.md MINOR] a repeated OWNED id is left INTACT -- never deduped -- so the ownership gate still reports duplicate-id", () => {
    // MUTANT THIS KILLS (verify.r5.md's MN2, which survived the full landed
    // suite): the `claimOwner(id) !== null` early return removed, so an
    // OWNED duplicate is silently deduped away exactly like a legacy one.
    // This function's own header states why that must never happen: an
    // owned id is only ever duplicated by a genuine bug (mintUniqueClaimId's
    // own collision guard failing), which claimOwnershipViolations must
    // still catch -- deduping it here would hide that bug instead.
    const ownedId = "c/aboutYou/0123456789abcdef";
    const pack = {
      version: 1,
      sections: {},
      claims: [claim(ownedId, "first"), claim(ownedId, "second")],
    };
    const out = normalizeLegacyClaimIds(pack);
    expect(out.claims).toHaveLength(2);
    expect(claimOwnershipViolations({ sections: {}, claims: out.claims })).toContainEqual({
      kind: "duplicate-id",
      id: ownedId,
    });
  });

  it("[no-op control] a pack with no repeated id at all is returned UNCHANGED (same reference)", () => {
    const pack = { version: 1, sections: {}, claims: [claim("legacy-1"), claim("legacy-2")] };
    expect(normalizeLegacyClaimIds(pack)).toBe(pack);
  });
});
