// N103 Step 3 (implementer additions) -- the real-material input of the chokepoint.
//
// The modal reads the candidate's uploaded resume as LINES (the file is parsed in
// the browser) and hands them to the chokepoint, which mints them into spans with
// the one span-minter, so no surface mints spans itself. This pins that path:
//   * lines become real-material spans, `inputs.realMaterial` turns true, and an
//     authority claim the real resume supports is no longer flagged as unsupported
//     (so supplying the material actually changes the review, it is not decoration);
//   * the same claim with no real material IS flagged (the fail-closed control);
//   * a hypothetical never consults real material, whatever is supplied;
//   * a malformed posting / material degrades to "not supplied", never a throw.
//
// Node env: pure async.

import { describe, it, expect } from "vitest";
import { runDocumentReview } from "./runDocumentReview.js";
import { CATEGORY } from "./contract.js";

const CLAIM = "Scaled a 300-person engineering organization as VP of Platform.";
const REAL = ["VP of Platform, Acme (2018-2023)", "Scaled a 300-person engineering organization as VP of Platform."];

const authority = (outcome) => outcome.flags.filter((f) => f.category === CATEGORY.UNSUPPORTED_AUTHORITY);

describe("runDocumentReview -- realMaterialLines", () => {
  it("lines the candidate's resume supports clear the authority flag, and inputs.realMaterial is true", async () => {
    const supported = await runDocumentReview({ kind: "applicationReady", title: "R", resultLines: [CLAIM], realMaterialLines: REAL });
    expect(supported.inputs.realMaterial).toBe(true);
    expect(authority(supported)).toEqual([]);
  });

  it("CONTROL: the same claim with no real material is flagged (so the clearing above is the material's doing)", async () => {
    const bare = await runDocumentReview({ kind: "applicationReady", title: "R", resultLines: [CLAIM] });
    expect(bare.inputs.realMaterial).toBe(false);
    expect(authority(bare).length).toBeGreaterThan(0);
  });

  it("blank lines supplied as real material count as NOT supplied", async () => {
    const out = await runDocumentReview({ kind: "applicationReady", title: "R", resultLines: [CLAIM], realMaterialLines: ["", "   "] });
    expect(out.inputs.realMaterial).toBe(false);
  });

  it("a hypothetical never consults real material (inputs.realMaterial stays false even when lines are supplied)", async () => {
    const out = await runDocumentReview({ kind: "hypothetical", title: "H", resultLines: [CLAIM], realMaterialLines: REAL });
    expect(out.inputs.realMaterial).toBe(false);
    expect(out.draftKind).toBe("hypothetical");
  });
});

describe("runDocumentReview -- malformed inputs degrade to 'not supplied'", () => {
  it("a posting whose requirements are not an array, or hold malformed items, is not 'supplied'", async () => {
    const notArray = await runDocumentReview({ kind: "applicationReady", title: "R", resultLines: [CLAIM], posting: { requirements: "Kubernetes" } });
    const malformed = await runDocumentReview({ kind: "applicationReady", title: "R", resultLines: [CLAIM], posting: { requirements: [{ id: 1 }, null, { id: "q1", text: "  " }] } });
    expect(notArray.inputs.posting).toBe(false);
    expect(malformed.inputs.posting).toBe(false);
  });

  it("an absent request is an empty review, never a throw", async () => {
    await expect(runDocumentReview(undefined)).resolves.toEqual({ status: "empty" });
  });

  it("an unknown kind is reviewed as the stricter application-ready draft", async () => {
    const out = await runDocumentReview({ kind: "mystery", title: "R", resultLines: [CLAIM] });
    expect(out.draftKind).toBe("applicationReady");
  });
});
