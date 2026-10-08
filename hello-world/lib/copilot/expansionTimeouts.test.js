// The two abort budgets of one "More detail" round trip. The whole point of the
// module is an ORDERING: the server's budget is strictly below the client's, so
// that when both fire the server's diagnosis wins the race. That ordering has to
// hold for every input, not just the default, which is why it is a clamp and
// why these cases run the clamp over hostile values rather than only the default.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  EXPANSION_CLIENT_TIMEOUT_MS,
  DEFAULT_EXPANSION_SERVER_TIMEOUT_MS,
  clampExpansionServerTimeout,
} from "./expansionTimeouts.js";

describe("expansionTimeouts — the constants", () => {
  it("pins the two budgets", () => {
    expect(EXPANSION_CLIENT_TIMEOUT_MS).toBe(10000);
    expect(DEFAULT_EXPANSION_SERVER_TIMEOUT_MS).toBe(8000);
  });

  it("keeps the server default strictly below the client budget", () => {
    expect(DEFAULT_EXPANSION_SERVER_TIMEOUT_MS).toBeLessThan(EXPANSION_CLIENT_TIMEOUT_MS);
  });
});

describe("clampExpansionServerTimeout", () => {
  it("falls back to the default for a value that is not a usable duration", () => {
    for (const bad of [NaN, 0, -5, -1, undefined, null, "8000", "soon", Infinity, -Infinity, {}]) {
      expect(clampExpansionServerTimeout(bad), String(bad)).toBe(DEFAULT_EXPANSION_SERVER_TIMEOUT_MS);
    }
  });

  it("honours a valid value below the ceiling", () => {
    expect(clampExpansionServerTimeout(5000)).toBe(5000);
    expect(clampExpansionServerTimeout(1)).toBe(1);
    expect(clampExpansionServerTimeout(9999)).toBe(9999);
  });

  it("pulls a value at or above the client budget down to one millisecond under it", () => {
    expect(clampExpansionServerTimeout(10000)).toBe(9999);
    expect(clampExpansionServerTimeout(10001)).toBe(9999);
    expect(clampExpansionServerTimeout(99999)).toBe(9999);
    expect(clampExpansionServerTimeout(Number.MAX_SAFE_INTEGER)).toBe(9999);
  });

  it("[invariant] every output is strictly below the client budget, whatever the input", () => {
    const inputs = [NaN, 0, -5, undefined, null, 1, 100, 7999, 8000, 9998, 9999, 10000, 10001, 60000, 1e9, Infinity];
    for (const input of inputs) {
      const out = clampExpansionServerTimeout(input);
      expect(out, String(input)).toBeLessThan(EXPANSION_CLIENT_TIMEOUT_MS);
      expect(out, String(input)).toBeGreaterThan(0);
    }
  });

});

describe("expansionTimeouts — safe in both bundles", () => {
  it("is pure: no React, no node API, no environment read, no import", () => {
    const src = readFileSync(fileURLToPath(new URL("./expansionTimeouts.js", import.meta.url)), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bimport\b/);
    expect(code).not.toMatch(/process\.env/);
    expect(code).not.toMatch(/node:/);
  });
});
