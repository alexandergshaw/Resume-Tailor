import { describe, it, expect } from "vitest";
import { changedScopes } from "./previewScopes.js";

describe("changedScopes", () => {
  it("returns an empty array when both signature maps are identical", () => {
    const prev = { resume: "abc", cover: "xyz" };
    const next = { resume: "abc", cover: "xyz" };
    expect(changedScopes(prev, next, ["resume", "cover"])).toEqual([]);
  });

  it("returns only the one scope whose signature differs", () => {
    const prev = { resume: "abc", cover: "xyz" };
    const next = { resume: "abc-edited", cover: "xyz" };
    expect(changedScopes(prev, next, ["resume", "cover"])).toEqual(["resume"]);
  });

  it("returns both scopes, in the order of the supplied scopes list, when both differ", () => {
    const prev = { resume: "abc", cover: "xyz" };
    const next = { resume: "abc-edited", cover: "xyz-edited" };
    expect(changedScopes(prev, next, ["resume", "cover"])).toEqual(["resume", "cover"]);
    // Order follows the supplied scopes list, not insertion order of the maps.
    expect(changedScopes(prev, next, ["cover", "resume"])).toEqual(["cover", "resume"]);
  });

  it("treats a scope missing from prevSigs but present as an empty string in nextSigs as changed (undefined !== '')", () => {
    const prev = {};
    const next = { resume: "" };
    const result = changedScopes(prev, next, ["resume"]);
    expect(result).toEqual(["resume"]);
    expect(result).toHaveLength(1);
    // Sanity check on the underlying inequality this behavior relies on.
    expect(prev.resume).toBeUndefined();
    expect(prev.resume !== next.resume).toBe(true);
  });

  it("ignores a differing key that is not in the supplied scopes array", () => {
    const prev = { resume: "abc", cover: "xyz", outline: "old" };
    const next = { resume: "abc", cover: "xyz", outline: "new" };
    expect(changedScopes(prev, next, ["resume", "cover"])).toEqual([]);
  });

  it("returns an empty array when the scopes list is empty, even if every signature differs", () => {
    const prev = { resume: "abc", cover: "xyz" };
    const next = { resume: "abc-edited", cover: "xyz-edited" };
    expect(changedScopes(prev, next, [])).toEqual([]);
  });
});
