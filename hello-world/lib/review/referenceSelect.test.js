import { describe, it, expect } from "vitest";
import { selectAuthorityReference } from "./referenceSelect.js";

// =============================================================================
// N106 slice-1 4b — lib/review/referenceSelect.js (plan r2 Step 2, AC-2).
//
// RED-ON-HEAD by absence. The BODIES pin the AC-2 split so that against a stub
// they stay meaningful: the "invariant to realMaterial" case below reds a stub
// that routes an internal-consistency draft through realMaterial (the pre-split
// bug), and the user-material/null case reds a stub that forgets the empty
// fail-closed reference.
// =============================================================================

const realMaterial = { spans: [{ id: "m1", text: "Associate Engineer, 3 yrs" }] };

describe("referenceSelect: per-draft authority reference split (AC-2 deterministic selection)", () => {
  it("user-material ⇒ { mode:'real-material', referenceSpans: realMaterial.spans }", () => {
    const draft = { kind: "applicationReady", authorityReference: "user-material", spans: [{ id: "a1", text: "x" }] };
    const out = selectAuthorityReference(draft, realMaterial);
    expect(out.mode).toBe("real-material");
    expect(out.referenceSpans).toEqual(realMaterial.spans);
  });

  it("user-material + null realMaterial ⇒ EMPTY referenceSpans (AC-13 fail-closed precondition)", () => {
    const draft = { kind: "applicationReady", authorityReference: "user-material", spans: [{ id: "a1", text: "x" }] };
    const out = selectAuthorityReference(draft, null);
    expect(out.mode).toBe("real-material");
    expect(out.referenceSpans).toEqual([]);
  });

  it("internal-consistency ⇒ { mode:'internal-coherence', referenceSpans: draft.spans } — NEVER realMaterial", () => {
    const spans = [{ id: "h1", text: "Led a 200-engineer org" }, { id: "h2", text: "Senior Director | 2014-2024" }];
    const draft = { kind: "hypothetical", authorityReference: "internal-consistency", spans };
    const out = selectAuthorityReference(draft, realMaterial);
    expect(out.mode).toBe("internal-coherence");
    expect(out.referenceSpans).toEqual(spans);
    // The reference spans are the DRAFT's own, not realMaterial's.
    expect(out.referenceSpans).not.toEqual(realMaterial.spans);
  });

  it("internal-consistency selection is INVARIANT to realMaterial (differential — reds the pre-split bug)", () => {
    const spans = [{ id: "h1", text: "Led a 200-engineer org" }];
    const draft = { kind: "hypothetical", authorityReference: "internal-consistency", spans };
    const withCorpus = selectAuthorityReference(draft, realMaterial);
    const withNull = selectAuthorityReference(draft, null);
    expect(withCorpus).toEqual(withNull);
    expect(withNull.referenceSpans).toEqual(spans);
  });
});
