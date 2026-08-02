import { describe, it, expect } from "vitest";
import { lockScopesFor } from "./previewScopes.js";

describe("lockScopesFor", () => {
  it("locks only the resume scope for a resume revise with no focus change", () => {
    const scopes = lockScopesFor("resume", false);
    expect(scopes).toEqual(["resume"]);
    expect(scopes).toHaveLength(1);
  });

  it("locks only the cover scope for a cover revise with no focus change", () => {
    const scopes = lockScopesFor("cover", false);
    expect(scopes).toEqual(["cover"]);
    expect(scopes).toHaveLength(1);
  });

  it("locks both scopes when a focus change is applied while revising the resume", () => {
    const scopes = lockScopesFor("resume", true);
    expect(scopes).toEqual(["resume", "cover"]);
    expect(scopes).toHaveLength(2);
  });

  it("locks both scopes when a focus change is applied while revising the cover letter (focusChange overrides the cover scope)", () => {
    const scopes = lockScopesFor("cover", true);
    expect(scopes).toEqual(["resume", "cover"]);
    expect(scopes).toHaveLength(2);
  });

  it("falls back to locking only the resume scope for an unrecognized scope with no focus change", () => {
    const scopes = lockScopesFor("outline", false);
    expect(scopes).toEqual(["resume"]);
    expect(scopes).toHaveLength(1);
  });

  it("falls back to locking only the resume scope for an undefined scope with no focus change", () => {
    const scopes = lockScopesFor(undefined, false);
    expect(scopes).toEqual(["resume"]);
    expect(scopes).toHaveLength(1);
  });
});
