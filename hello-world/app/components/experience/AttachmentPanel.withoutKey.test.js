// `withoutKey`'s same-reference bail-out.
//
// This exists because a mutation run proved the property was unpinned:
// deleting the `if (!(id in map)) return map;` line — so the helper always
// spreads into a fresh object — left the ENTIRE experience suite green,
// including every delete, undo, notes, download and focus test. Nothing
// observable changes; only the number of renders does, which no assertion in
// this repo was watching.
//
// That bail-out is the whole reason the helper is shaped the way it is. Seven
// call sites pass it straight into a setState updater, and most of those calls
// are clearing an entry that is not there — every fresh attempt at a notes
// save, a delete or a download clears an error that usually does not exist.
// Returning the identical reference is what lets React skip those updates
// instead of re-rendering the panel seven ways for nothing.
//
// A node test, deliberately: the property is about object identity in a pure
// function, so rendering anything to observe it would be a worse test of it.

import { describe, it, expect } from "vitest";
import { withoutKey } from "./AttachmentPanel.js";

describe("withoutKey", () => {
  it("returns the SAME object when the key is absent", () => {
    const map = { a: 1, b: 2 };
    // Reference equality, not deep equality. `toEqual` would pass against a
    // copy, which is exactly the mutation this test exists to catch.
    expect(withoutKey(map, "missing")).toBe(map);
  });

  it("returns a NEW object when the key is present, leaving the original alone", () => {
    const map = { a: 1, b: 2 };
    const next = withoutKey(map, "a");

    expect(next).not.toBe(map);
    expect(next).toEqual({ b: 2 });
    // The input is never mutated - these maps are React state, and editing one
    // in place would leave the rendered value and the state object disagreeing.
    expect(map).toEqual({ a: 1, b: 2 });
  });

  it("treats an empty map as nothing to remove", () => {
    const map = {};
    expect(withoutKey(map, "a")).toBe(map);
  });

  it("only removes the key it was given", () => {
    const map = { a: 1, b: 2, c: 3 };
    expect(withoutKey(map, "b")).toEqual({ a: 1, c: 3 });
  });

  // NOT asserted, deliberately: that an inherited property name is treated as
  // absent. `in` walks the prototype chain, so `withoutKey(map, "constructor")`
  // takes the copying branch and returns a new object identical to the old one
  // - the bail-out defeated for a key it could not have deleted anyway.
  //
  // lib/experience/attachments.js guards that exact hazard with an `ownLookup`
  // helper, and needs to: its keys are file extensions and mime types taken
  // straight from user input. These keys are not. All seven call sites pass an
  // attachment id, and those are uuids from crypto.randomUUID() and the
  // database, so "constructor" cannot occur. Asserting it here would be
  // requiring a behaviour change for an unreachable input, which is how a
  // small chunk grows a tail. Written down instead, so the next person to
  // widen what these maps are keyed by knows the guard is missing.
});
