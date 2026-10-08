// N144a T1 — the two PURE rules behind the answer-area disclosure
// (docs/loop/N144a.plan.r1.md §3.4, ledger L5/L6). React-free, so this runs
// in the repo's DEFAULT node environment with no jsdom docblock, exactly like
// every other lib/copilot test and like the store these rules sit beside.
//
// WHY A SEPARATE PURE MODULE AT ALL: the breakpoint default has to be decided
// identically for all three sections, and `normalizeAidChoice` is the inline
// store lambda `(v) => (v === "open" || v === "closed" ? v : null)` hoisted so
// three stores cannot drift. Pinning the rule here means the component test
// (T2) only has to prove the component ROUTES through it, not re-derive the
// truth table.
//
// RED on HEAD: lib/copilot/aidDisclosure.js does not exist yet, so this import
// throws and the whole file fails to load. That is the intended red — the
// module is absent — not a vacuous pass.

import { describe, it, expect } from "vitest";
import { normalizeAidChoice, resolveAidOpen } from "./aidDisclosure.js";

describe("normalizeAidChoice — only the two literal strings survive", () => {
  it("keeps 'open' and 'closed' exactly", () => {
    expect(normalizeAidChoice("open")).toBe("open");
    expect(normalizeAidChoice("closed")).toBe("closed");
  });

  it("maps anything else to null (absence, which the resolver reads as 'use the breakpoint')", () => {
    // A retired, hand-edited, cased, or wrong-typed stored value must read as
    // "not chosen", never as a half-recognised choice.
    for (const bad of ["OPEN", "Closed", "", "true", undefined, null, {}, 1, 0, []]) {
      expect(normalizeAidChoice(bad)).toBeNull();
    }
  });
});

describe("resolveAidOpen — the 2.2 effective-default table", () => {
  // The five rows of §2.2. `choice` arrives ALREADY normalized (the store
  // normalizes on the way in), so the resolver only distinguishes the two
  // literals from "anything else / null".
  it("an explicit 'open' is open at every width", () => {
    expect(resolveAidOpen({ choice: "open", isMobile: true, defaultOpenOnMobile: false })).toBe(true);
    expect(resolveAidOpen({ choice: "open", isMobile: false, defaultOpenOnMobile: false })).toBe(true);
  });

  it("an explicit 'closed' is closed at every width", () => {
    expect(resolveAidOpen({ choice: "closed", isMobile: true, defaultOpenOnMobile: true })).toBe(false);
    expect(resolveAidOpen({ choice: "closed", isMobile: false, defaultOpenOnMobile: true })).toBe(false);
  });

  it("with nothing chosen, open from 600px up (isMobile false)", () => {
    expect(resolveAidOpen({ choice: null, isMobile: false, defaultOpenOnMobile: false })).toBe(true);
    expect(resolveAidOpen({ choice: null, isMobile: false, defaultOpenOnMobile: true })).toBe(true);
  });

  it("with nothing chosen on a phone, follows defaultOpenOnMobile (false for all three sections this chunk)", () => {
    expect(resolveAidOpen({ choice: null, isMobile: true, defaultOpenOnMobile: false })).toBe(false);
    expect(resolveAidOpen({ choice: null, isMobile: true, defaultOpenOnMobile: true })).toBe(true);
  });

  it("CONTROL: the mobile branch is the ONLY thing that changes between the two defaultOpenOnMobile values", () => {
    // If the resolver ignored defaultOpenOnMobile (hardwired collapsed, or
    // hardwired open), these two would be equal. They must differ — this is
    // the no-op/over-fire discriminator for the pure rule.
    const collapsed = resolveAidOpen({ choice: null, isMobile: true, defaultOpenOnMobile: false });
    const opened = resolveAidOpen({ choice: null, isMobile: true, defaultOpenOnMobile: true });
    expect(collapsed).toBe(false);
    expect(opened).toBe(true);
  });
});

describe("resolveAidOpen — ONE object parameter (L6: a positional signature silently inverts on one breakpoint)", () => {
  it("declares exactly one formal parameter", () => {
    // `isMobile` and `defaultOpenOnMobile` are both booleans; a positional
    // (choice, isMobile, defaultOpenOnMobile) signature type-checks and a
    // caller swap flips the rule on exactly the phone breakpoint with no
    // error. The object signature makes that swap impossible, and its arity
    // is 1. A positional implementation reads back >= 2 here.
    expect(resolveAidOpen.length).toBe(1);
  });
});
