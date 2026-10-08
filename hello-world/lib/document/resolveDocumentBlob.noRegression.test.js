// N151a (4b) — T13: no-regression guard. N151a makes the DEFAULT route's bytes
// path selection-aware and touches NOTHING in docx.js, so the egress override
// must behave byte-for-byte as it does on HEAD: a null formattingTemplate is a
// strict no-op (serve the engine's own bytes), and a NON-.docx formattingTemplate
// must never hijack the output (ST-9 / PL-12 / design §6.2).
//
// REGRESSION GUARD: GREEN on HEAD by construction (it pins current behaviour so
// the implementer does not break it); it has teeth — flipping the override guard
// would red it. The override-TAKEN direction (a real .docx rebuilds the content)
// is owned by docx.defaultTemplateOverride.test.js and is not re-proven here, and
// the "normal materials upload/download/remove unchanged" half is covered by the
// existing useMaterialsLocker.extraction.test.js plus the Download/Remove controls
// in ApplyingControls.markTemplate.test.js. Disclosed as green-on-HEAD in tests.r1.md.

import { describe, it, expect } from "vitest";
import { resolveDocumentBlob } from "./docx.js";

// A known, hand-written golden: the exact bytes the engine branch must serve
// verbatim when no override is set. Independent of the mechanism (a literal
// base64), so an error that transforms both input and expectation together
// cannot hide (loop-traps canary rule).
const ENGINE_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x11, 0x22, 0x33, 0x44]);
const ENGINE_B64 = Buffer.from(ENGINE_BYTES).toString("base64");

async function bytesOf(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

describe("resolveDocumentBlob — null override is a strict no-op (T13 / ST-9)", () => {
  it("formattingTemplate=null serves the engine bytes verbatim (byte-identical to pre-N151)", async () => {
    const blob = await resolveDocumentBlob({ engineDocxB64: ENGINE_B64, edited: false, formattingTemplate: null });
    expect(blob, "no blob returned for an unedited engine doc").toBeTruthy();
    expect(Array.from(await bytesOf(blob))).toEqual(Array.from(ENGINE_BYTES));
  });

  it("a NON-.docx formattingTemplate never hijacks the output (isDocxResume gate holds)", async () => {
    // A .pdf-named override with real text would be a disaster if the override
    // branch fired on it (buildDocxFromUploadedTemplate on non-zip bytes); the
    // isDocxResume guard must skip it and serve the engine bytes unchanged.
    const blob = await resolveDocumentBlob({
      engineDocxB64: ENGINE_B64,
      edited: false,
      text: "some generated content",
      lines: ["some generated content"],
      formattingTemplate: { name: "not-a-template.pdf" },
    });
    expect(Array.from(await bytesOf(blob))).toEqual(Array.from(ENGINE_BYTES));
  });

  it("[control] an undefined formattingTemplate (the common no-default case) also serves engine bytes", async () => {
    const blob = await resolveDocumentBlob({ engineDocxB64: ENGINE_B64, edited: false });
    expect(Array.from(await bytesOf(blob))).toEqual(Array.from(ENGINE_BYTES));
  });
});

// WHAT THIS CANNOT CATCH: it does not prove the override-TAKEN path still
// rebuilds correctly (docx.defaultTemplateOverride.test.js owns that), only that
// the no-op/guard directions are byte-stable across N151a's route-only change.
