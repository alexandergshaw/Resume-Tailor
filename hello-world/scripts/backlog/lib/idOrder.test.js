import { describe, it, expect } from "vitest";
import { compareIds } from "./idOrder.mjs";

describe("compareIds", () => {
  it("orders numerically within a prefix: N2 before N10 before N12 — kills a lexical-only mutant", () => {
    // A plain string comparator ("N10" < "N2" lexically, since "1" < "2") would sort this list
    // as N1, N10, N11, N12, N2, ... — exactly wrong. This is the real shape backlog:next sorts.
    const ids = ["N12", "N1", "N10", "N2", "N9"];
    const sorted = [...ids].sort(compareIds);
    expect(sorted).toEqual(["N1", "N2", "N9", "N10", "N12"]);
  });

  it("orders D1 before D2, and V1 alone", () => {
    expect(compareIds("D1", "D2")).toBeLessThan(0);
    expect(compareIds("D2", "D1")).toBeGreaterThan(0);
  });

  it("treats equal ids as equal", () => {
    expect(compareIds("N5", "N5")).toBe(0);
  });

  it("orders by prefix first when prefixes differ", () => {
    expect(compareIds("D1", "N1")).toBeLessThan(0);
    expect(compareIds("V1", "D1")).toBeGreaterThan(0);
  });

  it("falls back to plain string order for a non-namespaced id, rather than throwing", () => {
    expect(() => compareIds("legacy-1", "N1")).not.toThrow();
    expect(compareIds("a", "b")).toBeLessThan(0);
  });
});
