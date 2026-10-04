// N105 Step 5 (AC-17, D-10, UX-12) -- visibleScopesFor: the tab set the preview
// mount hands the dialog. LEGACY_SCOPES for every ordinary entry; the
// hypothetical joins LAST only for an Ideal entry that carries both its
// hypothetical result and the application-ready résumé.

import { describe, it, expect } from "vitest";
import { LEGACY_SCOPES, SCOPES, DOCX_SCOPES, visibleScopesFor } from "./documentScopes.js";

const IDEAL_ENTRY = {
  result: "Application-ready text",
  ideal: { hypothetical: { result: "Hypothetical text" } },
};

describe("LEGACY_SCOPES / SCOPES", () => {
  it("LEGACY_SCOPES is exactly today's three, in order", () => {
    expect(LEGACY_SCOPES).toEqual(["resume", "cover", "email"]);
  });

  it("SCOPES is the legacy three plus the hypothetical, and DOCX_SCOPES still excludes it", () => {
    expect(SCOPES).toEqual([...LEGACY_SCOPES, "hypothetical"]);
    expect(DOCX_SCOPES).toEqual(["resume", "cover"]);
  });
});

describe("visibleScopesFor", () => {
  it.each([
    ["no entry", undefined],
    ["an empty entry", {}],
    ["an ordinary entry", { result: "Resume text", coverLetterResultLines: ["Dear"] }],
    ["an ideal marker with no hypothetical", { result: "Resume text", ideal: {} }],
    ["a blank hypothetical result", { result: "Resume text", ideal: { hypothetical: { result: "   " } } }],
    ["a non-string hypothetical result", { result: "Resume text", ideal: { hypothetical: { result: null } } }],
  ])("%s -> exactly the legacy tabs, no hypothetical", (_label, entry) => {
    const out = visibleScopesFor(entry);
    expect(out).toEqual(["resume", "cover", "email"]);
    expect(out).not.toContain("hypothetical");
  });

  it("an Ideal entry (hypothetical + application-ready) -> legacy tabs then hypothetical LAST", () => {
    expect(visibleScopesFor(IDEAL_ENTRY)).toEqual(["resume", "cover", "email", "hypothetical"]);
  });

  it("an Ideal entry with NO application-ready résumé -> no hypothetical tab (the pair is atomic)", () => {
    expect(visibleScopesFor({ ...IDEAL_ENTRY, result: "" })).toEqual(["resume", "cover", "email"]);
    expect(visibleScopesFor({ ideal: IDEAL_ENTRY.ideal })).toEqual(["resume", "cover", "email"]);
  });

  it("never mutates the shared LEGACY_SCOPES when adding the hypothetical", () => {
    visibleScopesFor(IDEAL_ENTRY);
    expect(LEGACY_SCOPES).toEqual(["resume", "cover", "email"]);
  });
});
