// N155 — MAX_USER_CONTEXT_CHARS lives in each family CONTRACT module and equals
// 600 (AC5 / plan ruling 3: one home, imported by both the route and the prompt
// builder). Namespace imports so a missing export reds on the ASSERTION (undefined
// !== 600) rather than throwing at link time.

import { describe, it, expect } from "vitest";

import * as expansionContract from "./expansionContract.js";
import * as techTermDetailContract from "./techTermDetailContract.js";
import * as projectBulletDetailContract from "./projectBulletDetailContract.js";

const FAMILIES = [
  ["expansionContract", expansionContract],
  ["techTermDetailContract", techTermDetailContract],
  ["projectBulletDetailContract", projectBulletDetailContract],
];

describe.each(FAMILIES)("%s exports MAX_USER_CONTEXT_CHARS === 600 (AC5)", (_name, mod) => {
  it("exports the bound as the literal 600", () => {
    expect(mod.MAX_USER_CONTEXT_CHARS).toBe(600);
  });
});
