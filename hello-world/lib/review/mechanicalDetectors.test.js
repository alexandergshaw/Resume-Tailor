import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  detectMissingKeyword,
  detectRepetition,
  detectUnverifiableMetric,
  detectVagueUnsupported,
  detectConsistencySkeleton,
  detectAuthoritySkeleton,
} from "./mechanicalDetectors.js";
import { stripComments } from "../sourceScan/tokenizeSource.js";

// =============================================================================
// N106 slice-1 4b — lib/review/mechanicalDetectors.js (plan r2 Step 3,
// AC-4/5/6/7, consistency + authority skeletons; S-6/S-7 reuse-mechanism).
//
// RED-ON-HEAD by absence. These are the per-detector positive + clean controls
// that double as step-9 mutation targets. Each category gets a POSITIVE row
// (flag fires) AND a CLEAN control (no false flag) so a flag-everything detector
// reds the clean control and a dead detector reds the positive.
// =============================================================================

const kind = "applicationReady";
const draftOf = (spans, authorityReference = "internal-consistency") => ({ kind, authorityReference, spans });
const catsOf = (flags) => flags.map((f) => f.category);

describe("detectMissingKeyword (AC-4) — word-boundary, NOT String.includes", () => {
  it("POSITIVE: a required taxonomy keyword absent from the draft is flagged with evidenceRef→posting", () => {
    const draft = draftOf([{ id: "a1", text: "Built services in Python and SQL." }]);
    const posting = { requirements: [{ id: "r1", text: "Experience with Kubernetes" }] };
    const flags = detectMissingKeyword(draft, posting);
    const k = flags.find((f) => f.category === "missing-keyword");
    expect(k).toBeTruthy();
    expect(k.draftKind).toBe(kind);
    expect(k.evidenceRef.origin).toBe("posting");
    expect(k.evidenceRef.spanId).toBe("r1"); // names the requirement, not a minted id
  });

  it("CLEAN: a required keyword present as a WORD in the draft is NOT flagged", () => {
    const draft = draftOf([{ id: "a1", text: "Shipped containers with Docker in production." }]);
    const posting = { requirements: [{ id: "r1", text: "Experience with Docker" }] };
    expect(catsOf(detectMissingKeyword(draft, posting))).not.toContain("missing-keyword");
  });

  it("WORD-BOUNDARY near-miss (the 'Go'/'going' trap): 'React' required, draft only says 'reaction' ⇒ STILL flagged", () => {
    // A naive String.includes impl sees 'react' inside 'reaction', concludes the
    // keyword is present, and FALSE-CLEANs. A word-boundary impl flags it.
    const draft = draftOf([{ id: "a1", text: "Drove a strong reaction to the launch." }]);
    const posting = { requirements: [{ id: "r1", text: "Experience with React" }] };
    expect(catsOf(detectMissingKeyword(draft, posting))).toContain("missing-keyword");
  });
});

describe("detectRepetition (AC-5)", () => {
  it("POSITIVE: the same opener across two spans is flagged with evidenceRef→sibling draft span", () => {
    const draft = draftOf([
      { id: "a1", text: "Spearheaded cross-functional initiatives across the organization." },
      { id: "a2", text: "Spearheaded cross-functional initiatives across the organization." },
    ]);
    const flags = detectRepetition(draft);
    const rep = flags.find((f) => f.category === "repetition");
    expect(rep).toBeTruthy();
    expect(rep.draftKind).toBe(kind);
    expect(rep.evidenceRef.origin).toBe("draft");
    expect(rep.evidenceRef.draftKind).toBe(kind);
    expect([rep.spanId, rep.evidenceRef.spanId].sort()).toEqual(["a1", "a2"]);
  });

  it("CLEAN: lexically distinct spans are NOT flagged", () => {
    const draft = draftOf([
      { id: "a1", text: "Cut deployment time by introducing CI caching." },
      { id: "a2", text: "Migrated the billing service to an event-driven design." },
    ]);
    expect(catsOf(detectRepetition(draft))).not.toContain("repetition");
  });
});

describe("detectUnverifiableMetric (AC-6) — draft-internal, identical on BOTH draft kinds", () => {
  const unver = { id: "a1", text: "Improved performance by 300%." };
  const verifiable = { id: "a2", text: "Grew signups from 10% to 35% quarter over quarter." };
  const noNumber = { id: "a3", text: "Led the backend platform team." };

  it("POSITIVE on internal-consistency: a baseline-less magnitude is flagged", () => {
    const flags = detectUnverifiableMetric(draftOf([unver], "internal-consistency"));
    expect(catsOf(flags)).toContain("unverifiable-metric");
  });

  it("POSITIVE on user-material: the SAME metric is flagged identically (does not consult realMaterial)", () => {
    const flags = detectUnverifiableMetric(draftOf([unver], "user-material"));
    expect(catsOf(flags)).toContain("unverifiable-metric");
  });

  it("CLEAN: a metric WITH a baseline/unit is not flagged", () => {
    expect(catsOf(detectUnverifiableMetric(draftOf([verifiable])))).not.toContain("unverifiable-metric");
  });

  it("CLEAN: a span with no numeric claim is not flagged", () => {
    expect(catsOf(detectUnverifiableMetric(draftOf([noNumber])))).not.toContain("unverifiable-metric");
  });
});

describe("detectVagueUnsupported (AC-7)", () => {
  it("POSITIVE: a vague weak-opener bullet with no concrete outcome is flagged", () => {
    const draft = draftOf([{ id: "a1", text: "Responsible for various strategic initiatives." }]);
    expect(catsOf(detectVagueUnsupported(draft))).toContain("vague-unsupported");
  });

  it("CLEAN: a concrete, specific bullet is not flagged", () => {
    const draft = draftOf([{ id: "a1", text: "Cut deployment time 40% by introducing CI caching." }]);
    expect(catsOf(detectVagueUnsupported(draft))).not.toContain("vague-unsupported");
  });
});

describe("detectConsistencySkeleton (AC-9) — cross-draft date contradiction", () => {
  const hypo = (text) => ({ kind: "hypothetical", authorityReference: "internal-consistency", spans: [{ id: "h1", text }] });
  const appReady = (text) => ({ kind: "applicationReady", authorityReference: "user-material", spans: [{ id: "a1", text }] });

  it("POSITIVE: contradictory dates for the same employer across two drafts ⇒ consistency flag w/ draft evidenceRef", () => {
    const flags = detectConsistencySkeleton([hypo("Acme Corp | 2018-2022"), appReady("Acme Corp | 2019-2022")]);
    const c = flags.find((f) => f.category === "consistency");
    expect(c).toBeTruthy();
    expect(c.evidenceRef.origin).toBe("draft");
    expect(c.evidenceRef.draftKind).toBeTruthy();
    expect(c.evidenceRef.draftKind).not.toBe(c.draftKind); // the OTHER draft
  });

  it("CLEAN: two drafts that agree on the shared dates ⇒ no consistency flag", () => {
    const flags = detectConsistencySkeleton([hypo("Acme Corp | 2019-2022"), appReady("Acme Corp | 2019-2022")]);
    expect(catsOf(flags)).not.toContain("consistency");
  });
});

describe("detectAuthoritySkeleton (AC-8/AC-2/AC-13) — reference-split + internal coherence", () => {
  it("POSITIVE H': an internally-INCOHERENT authority claim (CTO over associate dates) is flagged w/ draft evidenceRef", () => {
    const draft = {
      kind: "hypothetical",
      authorityReference: "internal-consistency",
      spans: [
        { id: "h1", text: "CTO leading a 200-engineer organization." },
        { id: "h2", text: "Associate Software Engineer | 2021-2024" },
      ],
    };
    const flags = detectAuthoritySkeleton(draft, null);
    const a = flags.find((f) => f.category === "unsupported-authority");
    expect(a).toBeTruthy();
    expect(a.evidenceRef.origin).toBe("draft");
    expect(a.evidenceRef.draftKind).toBe("hypothetical");
  });

  it("CLEAN H: a coherent strong internal-consistency claim yields ZERO authority flags (coherent control)", () => {
    const draft = {
      kind: "hypothetical",
      authorityReference: "internal-consistency",
      spans: [
        { id: "h1", text: "Led a 200-engineer platform org." },
        { id: "h2", text: "Senior Director of Engineering | 2014-2024" },
      ],
    };
    expect(catsOf(detectAuthoritySkeleton(draft, null))).not.toContain("unsupported-authority");
  });

  it("POSITIVE U: a user-material scope claim unsupported by realMaterial is flagged (evidenceRef→real-material)", () => {
    const draft = { kind: "applicationReady", authorityReference: "user-material", spans: [{ id: "a1", text: "Directed a 50-person organization." }] };
    const realMaterial = { spans: [{ id: "m1", text: "Senior engineer on a 5-person team." }] };
    const a = detectAuthoritySkeleton(draft, realMaterial).find((f) => f.category === "unsupported-authority");
    expect(a).toBeTruthy();
    expect(a.evidenceRef.origin).toBe("real-material");
  });

  it("CLEAN U: the SAME claim supported by realMaterial is NOT flagged", () => {
    const draft = { kind: "applicationReady", authorityReference: "user-material", spans: [{ id: "a1", text: "Directed a 50-person organization." }] };
    const realMaterial = { spans: [{ id: "m1", text: "Directed a 50-person organization at Acme." }] };
    expect(catsOf(detectAuthoritySkeleton(draft, realMaterial))).not.toContain("unsupported-authority");
  });

  it("AC-13(b) FAIL-CLOSED: user-material claim with null realMaterial ⇒ at least one unsupported-authority flag", () => {
    const draft = { kind: "applicationReady", authorityReference: "user-material", spans: [{ id: "a1", text: "Directed a 50-person organization." }] };
    expect(catsOf(detectAuthoritySkeleton(draft, null))).toContain("unsupported-authority");
  });
});

// -----------------------------------------------------------------------------
// S-6/S-7 reuse-MECHANISM source sweep (deliberate source-text sweep; comments
// stripped per the "prose citing a module reads as using it" trap). The regex
// instruments are canaried on synthetic strings BELOW so they are proven to
// discriminate regardless of the real file's contents.
// -----------------------------------------------------------------------------
describe("mechanicalDetectors source: reuse by reimplementation, no opposite-polarity coupling (S-6/S-7)", () => {
  const code = () => stripComments(readFileSync(fileURLToPath(new URL("./mechanicalDetectors.js", import.meta.url)), "utf8"));
  const importFrom = /import[^;]*from\s*["'][^"']*(critique|copilot)[^"']*["']/;

  it("CANARY: the import-detection regex matches a real cross-area import and NOT a comment mention", () => {
    expect(importFrom.test(stripComments('import { WEAK_OPENERS } from "../resume/critique.js";'))).toBe(true);
    // stripComments removes the comment, so a mere mention must not match.
    expect(importFrom.test(stripComments('// see ../resume/critique.js for the lexicon\nconst x = 1;'))).toBe(false);
  });

  it("imports NOTHING from lib/resume/critique.js or lib/copilot/ (reimplemented lexicons, no cross-area graph)", () => {
    expect(importFrom.test(code())).toBe(false);
  });

  it("never references the opposite-polarity METRIC_RE identifier", () => {
    expect(/\bMETRIC_RE\b/.test(code())).toBe(false);
  });

  it("declares its OWN VAGUE_OPENERS and NUMERIC_CLAIM_RE consts (reimplemented vocabularies)", () => {
    const src = code();
    expect(/\bconst\s+VAGUE_OPENERS\b/.test(src)).toBe(true);
    expect(/\bconst\s+NUMERIC_CLAIM_RE\b/.test(src)).toBe(true);
  });
});
