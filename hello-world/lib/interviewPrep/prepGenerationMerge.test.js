// ---------------------------------------------------------------------------
// lib/interviewPrep/prepGenerationMerge.js -- direct unit coverage.
//
// F-M1 (fix round 2, verify.r3.md MAJOR): this module shipped with the
// resolver that is the ONLY thing standing between a legacy gemini row and
// an O-15 bypass, and zero unit tests exercised it -- verify.r3.md's own
// grep confirmed no test file for this module existed. Two mutants survived
// the full 904-test suite as a result:
//   MB1p    the resolver drops per-section provenance entirely
//           (`() => engine`), so every seeded section silently inherits
//           whichever engine the CURRENT attempt happens to be.
//   MB1open the resolver fails OPEN for a base with no recorded provenance
//           (treats "unknown" as "embedded" instead of "gemini").
// Both make a seeded section on a legacy GEMINI pack read as "embedded" the
// moment ANY section is regenerated on the embedded engine -- which, once
// every contributing section reads "embedded", makes `buildPackDocument`
// stamp `templateOrigin` on the rebuilt pack (H1) and that stamp EXEMPTS THE
// WHOLE PACK from K1-SHAPE's citation requirement on the next normalize
// pass (`isEmbeddedTemplateOrigin` is pack-wide, not per-section) -- so an
// uncited, model-written line naming a real person renders uncited. The
// tests below assert the resolver's per-name output directly; both mutants
// make the first `describe` block's first test fail.
//
// F-B1 residual (fix round 2, verify.r3.md BLOCKER): `buildRevisionSections`
// itself is exercised here directly too, at the pure-function level, rather
// than only through route.section.test.js's end-to-end fixtures -- reverting
// the fix (going back to a plain ownership-only claims filter with no
// `mintUnownedReferencedClaims` call) makes the second `describe` block's
// first test fail.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { seedEngineResolver, buildRevisionSections, sectionWriteNamesWithinBudget } from "./prepGenerationMerge.js";
import { claimOwner } from "./prepClaims.js";
import { EMBEDDED_TEMPLATE_ORIGIN } from "./prepParse.js";

function claim(id, text = "Acme opened a Berlin office.", sourceUrl = "https://acme.example/news") {
  return { id, text, sourceUrl };
}

function supported(text, claimId) {
  return { text, support: { kind: "claim", claimId } };
}

describe("seedEngineResolver -- F-M1 (fix round), fails CLOSED for a base with no recorded provenance", () => {
  it("a base with no templateOrigin seeds every OTHER section as 'gemini', never this attempt's own engine", () => {
    // The exact O-15 bypass shape: an EMBEDDED regeneration on a legacy
    // GEMINI pack must never let the other three sections read "embedded".
    const currentPack = { version: 1, sections: { aboutYou: {}, whyRole: {}, askThem: {}, stages: {} }, claims: [] };
    const resolver = seedEngineResolver(currentPack, "askThem", "embedded");
    expect(resolver("aboutYou")).toBe("gemini");
    expect(resolver("whyRole")).toBe("gemini");
    expect(resolver("stages")).toBe("gemini");
  });

  it("[no-op control] the regenerated section itself always gets THIS attempt's own engine", () => {
    const currentPack = { version: 1, sections: {}, claims: [] };
    const resolver = seedEngineResolver(currentPack, "askThem", "embedded");
    expect(resolver("askThem")).toBe("embedded");
    const geminiResolver = seedEngineResolver(currentPack, "askThem", "gemini");
    expect(geminiResolver("askThem")).toBe("gemini");
  });

  it("seeds 'embedded' for the other sections only when the base document itself carries its OWN templateOrigin", () => {
    const currentPack = { version: 1, sections: {}, claims: [], templateOrigin: EMBEDDED_TEMPLATE_ORIGIN };
    const resolver = seedEngineResolver(currentPack, "askThem", "gemini");
    expect(resolver("aboutYou")).toBe("embedded");
    expect(resolver("whyRole")).toBe("embedded");
  });

  it("`templateOrigin` read through the prototype chain does not count -- only the base's OWN property does", () => {
    // The same Object.hasOwn discipline prepParse.js's isEmbeddedTemplateOrigin
    // documents for itself; baseProvenanceFromPack (prepMerge.js) shares it.
    const polluted = Object.create({ templateOrigin: EMBEDDED_TEMPLATE_ORIGIN });
    polluted.version = 1;
    polluted.sections = {};
    polluted.claims = [];
    const resolver = seedEngineResolver(polluted, "askThem", "gemini");
    expect(resolver("aboutYou")).toBe("gemini");
  });
});

describe("buildRevisionSections -- F-B1 residual (fix round 2, verify.r3.md BLOCKER)", () => {
  it("a SEEDED section (not the one regenerated) gets the legacy claim its own content references, not an empty array", () => {
    const normalizedPack = {
      sections: {
        aboutYou: supported("Maria Lopez leads the platform team.", "legacy-1"),
        askThem: { questions: [{ text: "New question?", support: null }] },
      },
      claims: [claim("legacy-1", "Maria Lopez leads the platform team.", "https://acme.example/team")],
    };

    const out = buildRevisionSections(normalizedPack, "gemini", ["askThem", "aboutYou"], {});

    expect(out.aboutYou.claims, "the seeded row was written with no claims at all").toHaveLength(1);
    expect(claimOwner(out.aboutYou.claims[0].id)).toBe("aboutYou");
    expect(out.aboutYou.content.support.claimId).toBe(out.aboutYou.claims[0].id);
    expect(out.aboutYou.claims[0].sourceUrl).toBe("https://acme.example/team");
  });

  it("a legacy claim referenced by TWO seeded sections mints a distinct, independently-owned id in each", () => {
    const normalizedPack = {
      sections: {
        askThem: { questions: [{ text: "New question?", support: null }] },
        aboutYou: supported("Line A", "shared-legacy"),
        whyRole: supported("Line B", "shared-legacy"),
      },
      claims: [claim("shared-legacy", "Acme runs a four-stage loop.", "https://acme.example/careers")],
    };

    const out = buildRevisionSections(normalizedPack, "gemini", ["askThem", "aboutYou", "whyRole"], {});

    expect(claimOwner(out.aboutYou.claims[0].id)).toBe("aboutYou");
    expect(claimOwner(out.whyRole.claims[0].id)).toBe("whyRole");
    expect(out.aboutYou.claims[0].id).not.toBe(out.whyRole.claims[0].id);
  });

  it("[no-op control] the regenerated section's own already-minted claim is carried over unchanged, never double-minted", () => {
    const ownId = "c/askThem/0123456789abcdef";
    const normalizedPack = {
      sections: { askThem: supported("Already-owned question", ownId) },
      claims: [claim(ownId)],
    };

    const out = buildRevisionSections(normalizedPack, "gemini", ["askThem"], {});

    expect(out.askThem.claims).toEqual([claim(ownId)]);
    expect(out.askThem.content.support.claimId).toBe(ownId);
  });

  it("composes with seedEngineResolver: a seeded section on an unknown-provenance base is written with 'gemini', never the attempt's own engine", () => {
    const normalizedPack = {
      sections: { askThem: { questions: [] }, aboutYou: supported("Maria Lopez leads the platform team.", "legacy-1") },
      claims: [claim("legacy-1", "Maria Lopez leads the platform team.", "https://acme.example/team")],
    };
    const resolver = seedEngineResolver({ sections: {}, claims: [] }, "askThem", "embedded");

    const out = buildRevisionSections(normalizedPack, resolver, ["askThem", "aboutYou"], {});

    expect(out.askThem.engine).toBe("embedded");
    expect(out.aboutYou.engine, "a seeded section inherited the CURRENT attempt's engine instead of failing closed").toBe(
      "gemini",
    );
    // Even though the seeded engine is correct, the row must still carry
    // its own claim -- covering both fixes together the way a real seeded
    // write exercises them.
    expect(claimOwner(out.aboutYou.claims[0].id)).toBe("aboutYou");
  });

  it("revision numbers increment off newestBySection, independently per name", () => {
    const normalizedPack = { sections: { askThem: { questions: [] }, aboutYou: { answer: { lines: [] } } }, claims: [] };
    const out = buildRevisionSections(normalizedPack, "gemini", ["askThem", "aboutYou"], { askThem: 3 });
    expect(out.askThem.revision).toBe(4);
    expect(out.aboutYou.revision).toBe(1);
  });
});

describe("sectionWriteNamesWithinBudget -- F-m3 (fix round, verify.r4.md MINOR, widened)", () => {
  /** A legacy aboutYou whose minted content+claims exceed
   *  PREP_SECTION_REVISION_MAX_BYTES -- the same padded shape verify.r4.md's
   *  own R4-SIZE probe used. */
  function bigLegacyAboutYou(count) {
    const lines = [];
    const claims = [];
    for (let i = 0; i < count; i += 1) {
      const id = `legacy-big-${i}`;
      lines.push(supported(`Fact number ${i} about the org ${"x".repeat(150)}.`, id));
      claims.push(claim(id, `Public detail ${i} ${"y".repeat(200)}.`, `https://acme.example/p/${i}`));
    }
    return { content: { answer: { lines } }, claims };
  }

  it("[RED: pre-fix] an OVERSIZED seed candidate is excluded, but `section` itself is ALWAYS kept regardless of its own size", () => {
    const { content: oversizedAboutYou, claims } = bigLegacyAboutYou(120);
    const pack = {
      sections: { aboutYou: oversizedAboutYou, askThem: { questions: [{ text: "New?", support: null }] } },
      claims,
    };
    const names = sectionWriteNamesWithinBudget("askThem", pack, {}, {});
    expect(names).toContain("askThem");
    expect(
      names,
      "an oversized OTHER section blocked the requested section's own regeneration from ever being seeded",
    ).not.toContain("aboutYou");
  });

  it("[no-op control] every seed candidate under budget is still included, unchanged", () => {
    const pack = {
      sections: {
        aboutYou: { answer: { lines: [{ text: "Small.", support: null }] } },
        whyRole: { answer: { lines: [{ text: "Small too.", support: null }] } },
        askThem: { questions: [{ text: "New?", support: null }] },
        stages: { stages: [] },
      },
      claims: [],
    };
    const names = sectionWriteNamesWithinBudget("askThem", pack, {}, {});
    expect(names.slice().sort()).toEqual(["aboutYou", "askThem", "stages", "whyRole"]);
  });
});
