// N150 Wave A — the shared detail-store key (lib/copilot/techTermDetailContract.js).
// RED on HEAD: the module does not exist. The key is the generation guard
// (design §3.6, mirroring expansionContract): a response settling under a key
// the UI no longer computes is simply never read, so the key must carry the
// normalised question, the term AND the grounding, and must be stable.

import { describe, it, expect } from "vitest";
import { techTermDetailKey } from "./techTermDetailContract.js";

const BASE = { question: "Tell me about retries.", term: "idempotency keys", applicationId: "app-1" };

describe("techTermDetailKey", () => {
  it("is a deterministic, non-empty string for the same inputs", () => {
    const a = techTermDetailKey(BASE);
    const b = techTermDetailKey({ ...BASE });
    expect(typeof a).toBe("string");
    expect(a.length).toBeGreaterThan(0);
    expect(a).toBe(b);
  });

  it("changes when the TERM changes (two terms of one answer cannot collide)", () => {
    expect(techTermDetailKey(BASE)).not.toBe(techTermDetailKey({ ...BASE, term: "circuit breaker" }));
  });

  it("changes when the QUESTION changes", () => {
    expect(techTermDetailKey(BASE)).not.toBe(techTermDetailKey({ ...BASE, question: "Tell me about caching." }));
  });

  it("changes when the grounding (applicationId) changes", () => {
    expect(techTermDetailKey(BASE)).not.toBe(techTermDetailKey({ ...BASE, applicationId: "app-2" }));
  });

  it("normalises surrounding whitespace in the question so a trivial reformat is the same key", () => {
    expect(techTermDetailKey(BASE)).toBe(techTermDetailKey({ ...BASE, question: "   Tell me about retries.   " }));
  });

  it("never throws on junk", () => {
    expect(() => techTermDetailKey()).not.toThrow();
    expect(() => techTermDetailKey({ question: null, term: 7, applicationId: {} })).not.toThrow();
  });
});
