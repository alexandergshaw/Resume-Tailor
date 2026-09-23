// Unit tests for commitDraftSeed (N35 fix round, B2/B3 -- extracted out of
// DocumentPreviewDialog.js's own commitDraft to keep that file under its
// 980-line ratchet). Pure map-mutation logic, isolated from any DOM/React
// concern the component-level tests already cover behaviourally
// (app/components/researchFlushNoEdit.test.js).

import { describe, it, expect } from "vitest";
import { commitDraftSeed } from "./draftEditGuard.js";

describe("commitDraftSeed", () => {
  it("reports unchanged only when BOTH text and html equal the seed", () => {
    const seeds = { cover: { text: "A", html: "<p>A</p>" } };
    expect(commitDraftSeed(seeds, "cover", "A", "<p>A</p>")).toBe(true);
  });

  it("B3: same text, different html (a formatting-only edit) is NOT unchanged", () => {
    const seeds = { cover: { text: "A", html: "<p>A</p>" } };
    expect(commitDraftSeed(seeds, "cover", "A", "<p><b>A</b></p>")).toBe(false);
  });

  it("different text, same html is NOT unchanged", () => {
    const seeds = { cover: { text: "A", html: "<p>A</p>" } };
    expect(commitDraftSeed(seeds, "cover", "B", "<p>A</p>")).toBe(false);
  });

  it("no seed at all (never seeded for this scope) is treated as changed, not unchanged", () => {
    expect(commitDraftSeed({}, "cover", "A", "<p>A</p>")).toBe(false);
  });

  it("a DIFFERENT scope's seed does not leak into this scope's check", () => {
    const seeds = { resume: { text: "A", html: "<p>A</p>" } };
    expect(commitDraftSeed(seeds, "cover", "A", "<p>A</p>")).toBe(false);
  });

  it("re-syncs the seed on every call, so a second commit with nothing further typed reads unchanged", () => {
    const seeds = { cover: { text: "old", html: "<p>old</p>" } };
    // First commit: real content changed since the seed -- reported changed,
    // and the seed is advanced to this new value.
    expect(commitDraftSeed(seeds, "cover", "new", "<p>new</p>")).toBe(false);
    expect(seeds.cover).toEqual({ text: "new", html: "<p>new</p>" });
    // Second commit with the SAME content (e.g. a blur right after the
    // auto-save debounce already committed it) -- now correctly unchanged,
    // because the seed tracks the LAST commit, not the original one.
    expect(commitDraftSeed(seeds, "cover", "new", "<p>new</p>")).toBe(true);
  });

  it("always leaves the seed holding the caller's LATEST values, whether it reported changed or not", () => {
    const seeds = {};
    commitDraftSeed(seeds, "cover", "A", "<p>A</p>");
    expect(seeds.cover).toEqual({ text: "A", html: "<p>A</p>" });
    commitDraftSeed(seeds, "cover", "A", "<p><b>A</b></p>");
    expect(seeds.cover).toEqual({ text: "A", html: "<p><b>A</b></p>" });
  });
});
