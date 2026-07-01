import { describe, it, expect } from "vitest";
import { hashString, pick, pickDistinct } from "./phrasing.js";

describe("hashString", () => {
  it("is stable and differs across inputs", () => {
    expect(hashString("abc")).toBe(hashString("abc"));
    expect(hashString("abc")).not.toBe(hashString("abd"));
    expect(typeof hashString("x")).toBe("number");
  });
});

describe("pick", () => {
  const opts = ["one", "two", "three", "four"];

  it("is deterministic for a given seed", () => {
    expect(pick("Acme", opts)).toBe(pick("Acme", opts));
  });

  it("varies the choice across different seeds", () => {
    const chosen = new Set(["Acme", "Globex", "Initech", "Umbrella", "Stark"].map((s) => pick(s, opts)));
    expect(chosen.size).toBeGreaterThan(1);
  });

  it("handles empty option lists", () => {
    expect(pick("x", [])).toBe("");
    expect(pick("x", null)).toBe("");
  });
});

describe("pickDistinct", () => {
  it("returns n distinct options, deterministically", () => {
    const a = pickDistinct("seed", ["a", "b", "c", "d"], 2);
    const b = pickDistinct("seed", ["a", "b", "c", "d"], 2);
    expect(a).toEqual(b);
    expect(a).toHaveLength(2);
    expect(new Set(a).size).toBe(2);
  });

  it("caps at the number of available options", () => {
    expect(pickDistinct("seed", ["a", "b"], 5)).toHaveLength(2);
  });
});
