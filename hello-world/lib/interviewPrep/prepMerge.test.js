// ---------------------------------------------------------------------------
// lib/interviewPrep/prepMerge.js -- the pure half of the N45/N46 mechanism.
// Plan step S3; contracts in plan §2.4 and §6.1.
//
// THIS FILE IS RED BECAUSE THE MODULE DOES NOT EXIST YET. The import below
// fails at collection, which is the intended hand-off state: every assertion
// here is written against the signatures the plan fixes, not against a guess.
//
// Three units, three different failure directions:
//
//   restorePayload        P1, the F2 resolution. Gets the "neither" branch
//                         WRONG in the silent direction: widen it and N47 is
//                         unfixed; narrow it and a running row's already-
//                         blanked `{}` is written back as if it were a
//                         restore -- a fix-shaped no-op that every
//                         integration instrument scores as a success.
//   buildPackDocument     H1, the templateOrigin carry-forward. A full O-15
//                         bypass two ordinary clicks away (plan risk R9).
//   baseProvenanceFromPack  the fail-closed default that makes H1 hold for
//                         the legacy rows that are 100% of production today.

import { describe, it, expect } from "vitest";
import { normalizePack, EMBEDDED_TEMPLATE_ORIGIN } from "./prepParse.js";
import { restorePayload, buildPackDocument, baseProvenanceFromPack } from "./prepMerge.js";

const SECTIONS = ["aboutYou", "whyRole", "askThem", "stages"];

function answerSection(...texts) {
  return { answer: { lines: texts.map((text) => ({ text, support: null })) } };
}

function questionSection(...texts) {
  return { questions: texts.map((text) => ({ text, support: null })) };
}

function stageSection(name, question) {
  return { stages: [{ name, questions: [question], recommendedAnswer: null, support: null }] };
}

/** A complete, four-section pack document. */
function fullPack({ aboutYouText = "I ship reliable systems.", templateOrigin = null } = {}) {
  const pack = {
    version: 1,
    sections: {
      aboutYou: answerSection(aboutYouText),
      whyRole: answerSection("The fleet problem is the one I want next."),
      askThem: questionSection("How is this team's work measured?"),
      stages: stageSection("Overview", "Tell me about yourself."),
    },
    claims: [],
  };
  if (templateOrigin !== null) pack.templateOrigin = templateOrigin;
  return pack;
}

// ---------------------------------------------------------------------------
// INSTRUMENT I3 (plan §6.3) -- the mixed-provenance fixture builder.
//
// Nothing in prepPack.test.js / prepParse.test.js builds one, because the
// scenario is unreachable on HEAD: today "regenerate" always replaces the
// whole pack with a single engine's output, so a document cannot hold
// embedded and gemini text at once. Per-section regeneration makes it the
// ORDINARY case, and it is exactly where the F-1 exemption leaks.
// ---------------------------------------------------------------------------

/** A line that K1-SHAPE refuses on its own: Title-Case, name-shaped, UNCITED.
 *  It survives normalization ONLY under the embedded-template exemption (or a
 *  trusted stored name, which nothing here supplies). */
const UNCITED_NAME_LINE = "Dana Whitfield runs the platform group.";

/** A base whose every section came from the embedded template, carrying the
 *  pack-level `templateOrigin` that exempts the WHOLE document from K1-SHAPE
 *  (prepParse.js:372, isEmbeddedTemplateOrigin). */
function embeddedBase() {
  return fullPack({ templateOrigin: EMBEDDED_TEMPLATE_ORIGIN });
}

function embeddedProvenance() {
  return Object.fromEntries(SECTIONS.map((s) => [s, "embedded"]));
}

/** One section's replacement, as `buildPackDocument`'s `replace` map wants it. */
function replacement(section, content, { engine = "gemini", claims = [] } = {}) {
  return { [section]: { content, claims, engine } };
}

function aboutYouLines(pack) {
  return (pack?.sections?.aboutYou?.answer?.lines || []).map((line) => line.text);
}

// ---------------------------------------------------------------------------
// P1 -- restorePayload
// ---------------------------------------------------------------------------

describe("restorePayload -- the F2 resolution (plan §2.4)", () => {
  it("[RED: module absent] a LEGACY base (stored pack, empty pointer) returns that pack VERBATIM plus the empty pointer", () => {
    // This is every row in production today. `pack` must be the stored object
    // itself, not a re-derivation: a rebuild would silently re-shape a
    // document nobody asked to change.
    const stored = fullPack();
    const out = restorePayload({ status: "failed", pack: stored, liveRevisions: {}, sections: {} });

    expect(Object.keys(out).sort()).toEqual(["liveRevisions", "pack"]);
    expect(JSON.stringify(out.pack)).toBe(JSON.stringify(stored));
    expect(out.liveRevisions).toEqual({});
  });

  it("[RED: module absent] a base with a POPULATED pointer returns the pointer EXACTLY as read, value for value", () => {
    // Plan risk R4: writing a fresh `{}` over a populated live_revisions
    // orphans the whole history on the first failed attempt, and the restored
    // pack still LOOKS right -- so nothing else in the suite would notice.
    // Asserted by value equality against the input, never by mere shape.
    const pointer = { aboutYou: 3, whyRole: 1, askThem: 2, stages: 7 };
    const out = restorePayload({
      status: "failed",
      pack: null,
      liveRevisions: pointer,
      sections: {
        aboutYou: { content: answerSection("kept"), claims: [], engine: "gemini", revision: 3 },
        whyRole: { content: answerSection("kept too"), claims: [], engine: "gemini", revision: 1 },
        askThem: { content: questionSection("and this"), claims: [], engine: "gemini", revision: 2 },
        stages: { content: stageSection("Screen", "Walk me through a project."), claims: [], engine: "gemini", revision: 7 },
      },
    });

    expect(out.liveRevisions).toEqual(pointer);
    expect(out.pack.sections.aboutYou.answer.lines[0].text).toBe("kept");
  });

  it("[RED: module absent] a RUNNING base returns {} -- its `pack` is already the blanked '{}' and is evidence of nothing", () => {
    // Plan §2.4 rule 1, and the difference between a fix and a fix-shaped
    // no-op: restoring a blanked document writes an empty pack that every
    // other instrument reads as a successful restore.
    expect(restorePayload({ status: "running", pack: {}, liveRevisions: {}, sections: {} })).toEqual({});
  });

  it("[RED: module absent] a RUNNING base is refused EVEN WHEN it still carries a full document", () => {
    // The status is what decides, never the content. A row whose blanking has
    // not yet been observed must not be treated as a merge base, because the
    // attempt holding it may commit between our read and our claim.
    expect(
      restorePayload({ status: "running", pack: fullPack(), liveRevisions: {}, sections: {} }),
    ).toEqual({});
  });

  it("[RED: module absent] a base with NO prior document at all returns {} -- a first-ever failure still leaves '{}' , byte for byte as today", () => {
    expect(restorePayload({ status: null, pack: null, liveRevisions: {}, sections: {} })).toEqual({});
    expect(restorePayload({ status: "failed", pack: {}, liveRevisions: {}, sections: {} })).toEqual({});
    expect(
      restorePayload({ status: "failed", pack: { version: 1, sections: {}, claims: [] }, liveRevisions: {}, sections: {} }),
    ).toEqual({});
  });

  it("[no-op control] a POPULATED base must NOT return {} -- the 'neither' branch cannot be widened back to 'any failure'", () => {
    // Required by plan §2.7's P1 row. Without it, `restorePayload = () => ({})`
    // satisfies three of the five cases above and N47 ships unfixed behind a
    // green unit suite.
    const out = restorePayload({ status: "failed", pack: fullPack(), liveRevisions: {}, sections: {} });
    expect(out).not.toEqual({});
    expect(out.pack).toBeTruthy();
  });

  it("[RED: module absent] is total and never mutates its argument", () => {
    const base = { status: "failed", pack: fullPack(), liveRevisions: { aboutYou: 2 }, sections: {} };
    const snapshot = JSON.stringify(base);
    expect(() => restorePayload(base)).not.toThrow();
    expect(() => restorePayload(undefined)).not.toThrow();
    expect(() => restorePayload({})).not.toThrow();
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});

// ---------------------------------------------------------------------------
// H1 -- buildPackDocument's templateOrigin rule (AC-O15.4 / AC-O15.5, risk R9)
// ---------------------------------------------------------------------------

describe("buildPackDocument -- H1, the templateOrigin carry-forward hazard", () => {
  it("[RED: module absent -- AC-O15.4] an embedded base with ONE gemini section carries NO own templateOrigin", () => {
    const merged = buildPackDocument({
      base: embeddedBase(),
      baseProvenance: embeddedProvenance(),
      replace: replacement("aboutYou", answerSection(UNCITED_NAME_LINE)),
    });
    expect(Object.hasOwn(merged, "templateOrigin")).toBe(false);
  });

  it("[RED: module absent -- AC-O15.4, the half that actually protects a candidate] the uncited, name-detected gemini line is then REFUSED by normalizePack", () => {
    // The property above is structural; THIS is the one a candidate feels.
    // Asserting only "no templateOrigin key" would pass for a merge that
    // emitted the key under a different name, or that set it on a section
    // rather than the pack. Running the real normalizePack over the merged
    // document is what proves the exemption is genuinely gone.
    const merged = buildPackDocument({
      base: embeddedBase(),
      baseProvenance: embeddedProvenance(),
      replace: replacement("aboutYou", answerSection(UNCITED_NAME_LINE, "I ship reliable systems.")),
    });
    const normalized = normalizePack(merged, []);
    expect(aboutYouLines(normalized)).not.toContain(UNCITED_NAME_LINE);
    expect(aboutYouLines(normalized)).toContain("I ship reliable systems.");
  });

  it("[no-op control -- proves the assertion above is not vacuous] the SAME line under a still-all-embedded merge SURVIVES", () => {
    // Without this, a buildPackDocument that never emits templateOrigin at all
    // -- or a normalizePack that refuses everything -- would look correct.
    const merged = buildPackDocument({
      base: embeddedBase(),
      baseProvenance: embeddedProvenance(),
      replace: replacement("aboutYou", answerSection(UNCITED_NAME_LINE), { engine: "embedded" }),
    });
    expect(merged.templateOrigin).toBe(EMBEDDED_TEMPLATE_ORIGIN);
    expect(aboutYouLines(normalizePack(merged, []))).toContain(UNCITED_NAME_LINE);
  });

  it("[RED: module absent -- AC-O15.5] an UNKNOWN-provenance base fails CLOSED: no templateOrigin, even when the base pack carried one", () => {
    // baseProvenanceFromPack returns "unknown" for a legacy row with no
    // revision rows, and "unknown" is not "embedded". This is the case that
    // covers every row that exists in production right now.
    const merged = buildPackDocument({
      base: embeddedBase(),
      baseProvenance: Object.fromEntries(SECTIONS.map((s) => [s, "unknown"])),
      replace: replacement("aboutYou", answerSection("fresh line"), { engine: "embedded" }),
    });
    expect(Object.hasOwn(merged, "templateOrigin")).toBe(false);
  });

  it("[RED: module absent] an EMPTY output carries no templateOrigin -- 'every contributing section is embedded' is vacuously true over zero sections", () => {
    const merged = buildPackDocument({
      base: { version: 1, sections: {}, claims: [] },
      baseProvenance: {},
      replace: {},
      wholePack: true,
    });
    expect(Object.hasOwn(merged, "templateOrigin")).toBe(false);
  });

  it("[RED: module absent] wholePack:false carries untouched sections over VERBATIM", () => {
    const base = fullPack();
    const merged = buildPackDocument({
      base,
      baseProvenance: Object.fromEntries(SECTIONS.map((s) => [s, "gemini"])),
      replace: replacement("aboutYou", answerSection("brand new")),
    });
    expect(JSON.stringify(merged.sections.whyRole)).toBe(JSON.stringify(base.sections.whyRole));
    expect(JSON.stringify(merged.sections.askThem)).toBe(JSON.stringify(base.sections.askThem));
    expect(JSON.stringify(merged.sections.stages)).toBe(JSON.stringify(base.sections.stages));
    expect(aboutYouLines(merged)).toEqual(["brand new"]);
  });

  it("[RED: module absent] wholePack:true DROPS sections absent from `replace` and discards every base claim -- today's destructive semantics, preserved exactly", () => {
    const base = fullPack();
    base.claims = [{ id: "legacy-1", text: "Acme raised a round.", sourceUrl: "https://acme.example/news" }];
    const merged = buildPackDocument({
      base,
      baseProvenance: Object.fromEntries(SECTIONS.map((s) => [s, "gemini"])),
      replace: replacement("aboutYou", answerSection("only this one")),
      wholePack: true,
    });
    expect(Object.keys(merged.sections)).toEqual(["aboutYou"]);
    expect(merged.claims).toEqual([]);
  });

  it("[RED: module absent] never mutates `base` or `replace`", () => {
    const base = fullPack();
    const replace = replacement("aboutYou", answerSection("brand new"));
    const baseSnapshot = JSON.stringify(base);
    const replaceSnapshot = JSON.stringify(replace);
    buildPackDocument({ base, baseProvenance: embeddedProvenance(), replace });
    expect(JSON.stringify(base)).toBe(baseSnapshot);
    expect(JSON.stringify(replace)).toBe(replaceSnapshot);
  });
});

describe("baseProvenanceFromPack -- the fail-closed default for a row with no revision rows", () => {
  it("[RED: module absent] a pack carrying its OWN templateOrigin reads as 'embedded' for all four sections", () => {
    expect(baseProvenanceFromPack(embeddedBase())).toEqual(embeddedProvenance());
  });

  it("[RED: module absent] every other pack reads as 'unknown' for all four sections", () => {
    expect(baseProvenanceFromPack(fullPack())).toEqual(Object.fromEntries(SECTIONS.map((s) => [s, "unknown"])));
    expect(baseProvenanceFromPack(null)).toEqual(Object.fromEntries(SECTIONS.map((s) => [s, "unknown"])));
    expect(baseProvenanceFromPack({})).toEqual(Object.fromEntries(SECTIONS.map((s) => [s, "unknown"])));
  });

  it("[RED: module absent] a templateOrigin inherited through the PROTOTYPE CHAIN is not the pack's own, and does not confer 'embedded'", () => {
    // isEmbeddedTemplateOrigin's own discipline (prepParse.js:372): a plain
    // `===` reads through the prototype chain, so a polluted
    // Object.prototype.templateOrigin would exempt every model-authored pack
    // in the process. Object.hasOwn cannot be fooled that way.
    const polluted = Object.create({ templateOrigin: EMBEDDED_TEMPLATE_ORIGIN });
    polluted.version = 1;
    polluted.sections = fullPack().sections;
    expect(baseProvenanceFromPack(polluted)).toEqual(Object.fromEntries(SECTIONS.map((s) => [s, "unknown"])));
  });

  it("[RED: module absent] a WRONG templateOrigin value confers nothing", () => {
    const impostor = fullPack({ templateOrigin: "embedded" });
    expect(baseProvenanceFromPack(impostor)).toEqual(Object.fromEntries(SECTIONS.map((s) => [s, "unknown"])));
  });
});
