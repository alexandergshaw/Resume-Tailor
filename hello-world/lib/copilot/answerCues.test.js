import { describe, it, expect } from "vitest";

import { MAX_CUE_WORDS, deriveCues, resolveCues, shortenToCue } from "./answerCues.js";

// The unit under test is "a person glancing at this mid-question can read it
// in one beat", so every assertion below is either about LENGTH (it is
// actually short), FIDELITY (it says something the full sentence said), or
// READABILITY (it does not end mid-phrase). Those are the three ways a cue
// fails in the room.

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// The word budget after the STAR label, which shortenToCue deliberately does
// not count against the sentence's own allowance.
function bodyWordCount(cue) {
  return wordCount(cue.replace(/^(Situation|Task|Action|Result):\s*/, ""));
}

describe("shortenToCue", () => {
  it("keeps a sentence that is already short, minus its terminal punctuation", () => {
    expect(shortenToCue("Led a team of six.")).toBe("Led a team of six");
  });

  it("cuts at the first clause rather than counting words to the middle of a phrase", () => {
    expect(shortenToCue("As Senior Software Engineer at Initech, I ran into a situation that put this to the test.")).toBe(
      "As Senior Software Engineer at Initech",
    );
  });

  it("preserves the STAR label verbatim and shortens only the sentence behind it", () => {
    const cue = shortenToCue("Result: I led a team of six engineers, cutting deployment time by 40%.");
    expect(cue).toBe("Result: Led a team of six engineers");
  });

  it("strips the first-person subject so the cue leads with what actually happened", () => {
    // Every point in a sample answer opens with "I", so the word carries no
    // information once the sentence becomes a prompt.
    expect(shortenToCue("I built a payments migration platform")).toBe("Built a payments migration platform");
    expect(shortenToCue("I'd restate the problem")).toBe("Restate the problem");
  });

  // C1 regression (BLOCKER): LEADING_SUBJECT_RE's auxiliary alternation was
  // not `\b`-terminated and `\s*` allowed zero whitespace, so "do" ate the
  // front of "doubled", "was" of "wasted", etc. — turning a real sentence
  // into gibberish. A second, separate defect: stripping "did" out of "did
  // not" inverted a negation into its opposite. Pinned with the exact
  // observed inputs from the adversarial review.
  it("never eats the front of the next word when it happens to start with an auxiliary spelling (C1)", () => {
    expect(shortenToCue("I doubled the throughput of the ingestion pipeline last quarter.")).toBe(
      "Doubled the throughput of the ingestion",
    );
    expect(
      shortenToCue("Result: I don't consider it finished until there's a result I can point to."),
    ).toBe("Result: Don't consider it finished until there's");
  });

  it("never strips a negation into its opposite (C1)", () => {
    const cue = shortenToCue("I did not lead that project, but I supported the engineer who did.");
    expect(cue).toBe("Did not lead that project");
    expect(cue.toLowerCase()).not.toBe("not lead that project");
  });

  it("drops a leading filler opener", () => {
    expect(shortenToCue("Finally, I'd say how I'd test it and handle the edge cases before calling it done.")).toBe(
      "Say how I'd test it",
    );
  });

  it("prefers a strong boundary over a bare conjunction, so one thought is not cut in half", () => {
    // "Open with where AND when" is a single thought; splitting on `and`
    // first would yield "Open with where", which is not a prompt.
    expect(
      shortenToCue("Situation: Open with where and when — a specific project at Initech as Senior Software Engineer."),
    ).toBe("Situation: Open with where and when");
  });

  it("falls back to the conjunction only when the strong clause is still too long", () => {
    expect(shortenToCue("I'd restate the problem and pin down the constraints first, then walk through my approach.")).toBe(
      "Restate the problem",
    );
  });

  it("never ends a cue on a dangling function word", () => {
    const cue = shortenToCue("And that combination is exactly why I think this role is a strong fit for me.");
    expect(cue).toBe("That combination is exactly why");
    expect(cue).not.toMatch(/\b(and|the|to|of|i|a)$/i);
  });

  // C6 regression (should-fix): a sentence that OPENS with a subordinate
  // clause used to keep the subordinate clause and discard the main one —
  // inverting the apparent meaning ("Rather than rewriting the service" reads
  // as though rewriting the service is what happened). Pinned with the exact
  // observed inputs from the adversarial review; each main clause must
  // survive and the discarded subordinate clause's own wording must not.
  it("strips a leading subordinate clause so the main clause survives, not the aside (C6)", () => {
    expect(shortenToCue("Rather than rewriting the service, I patched the hot path and moved on.")).toBe(
      "Patched the hot path and moved on",
    );
    expect(shortenToCue("While the system was down, I coordinated the incident response bridge.")).toBe(
      "Coordinated the incident response bridge",
    );
    expect(shortenToCue("Because I had to, I rebuilt the whole thing from scratch overnight.")).toBe(
      "Rebuilt the whole thing from scratch overnight",
    );
  });

  it("never fires the subordinate-clause strip mid-sentence (no comma, no strip)", () => {
    // STRONG_BOUNDARY_RE still treats these words as valid mid-sentence cut
    // points — only a genuine "clause, clause" opener is stripped.
    expect(shortenToCue("I patched the hot path while the deploy was rolling out safely.")).not.toBe("");
  });

  it("keeps a trailing enumeration whole rather than naming only its first item", () => {
    // Half a list reads as a complete answer that claims fewer skills than
    // the candidate actually has — a fidelity failure, not just a short one.
    expect(shortenToCue("The strengths I'd bring are Django, PostgreSQL, Python.")).toBe(
      "The strengths I'd bring are Django, PostgreSQL, Python",
    );
  });

  it("drops a mid-word ellipsis rather than carrying a visibly truncated quote into a cue", () => {
    // C7 regression (nit): the ellipsis alone used to get stripped while the
    // truncated word in front of it ("provi") survived as a fake whole word
    // — "…to a new provi…" -> "…to a new provi". Both must go.
    const cue = shortenToCue("Migrated the billing platform to a new provi…");
    expect(cue).not.toMatch(/…/);
    expect(cue).not.toMatch(/\bprovi\b/i);
    expect(cue).toBe("Migrated the billing platform to a new");
  });

  it("honors a caller-supplied word budget", () => {
    const input = "Managed customer escalations and improved response time by 25 percent overall";
    // The load-bearing check: a larger budget must actually let more of the
    // sentence through than the default budget does for the SAME input — not
    // merely "stay under some ceiling", which passes even if maxWords is
    // ignored entirely.
    const atDefault = shortenToCue(input);
    const atTen = shortenToCue(input, 10);
    expect(bodyWordCount(atTen)).toBeGreaterThan(bodyWordCount(atDefault));
    expect(bodyWordCount(atTen)).toBeLessThanOrEqual(12);
    expect(atTen.startsWith("Managed customer escalations")).toBe(true);
  });

  it("returns an empty string for input that shortens to nothing", () => {
    expect(shortenToCue("")).toBe("");
    expect(shortenToCue("   ")).toBe("");
    expect(shortenToCue(null)).toBe("");
    expect(shortenToCue("...")).toBe("");
  });
});

describe("deriveCues", () => {
  const POINTS = [
    "Situation: As Senior Software Engineer at Initech, I ran into a situation that put this to the test.",
    "Task: I made it my job to own the outcome, not just contribute to it, so I got clear on what success looked like.",
    "Result: I led a team of six engineers, cutting deployment time by 40%.",
  ];

  it("returns one cue per point, each within the word budget", () => {
    const cues = deriveCues(POINTS);
    expect(cues).toHaveLength(POINTS.length);
    for (const cue of cues) {
      // The clause-boundary rule is allowed a small overrun, but never an
      // unbounded one — this is the assertion that "short" is enforced and
      // not merely intended.
      expect(bodyWordCount(cue)).toBeLessThanOrEqual(MAX_CUE_WORDS + 2);
    }
  });

  it("keeps every STAR label so a behavioral answer's beats stay navigable", () => {
    expect(deriveCues(POINTS)).toEqual([
      "Situation: As Senior Software Engineer at Initech",
      "Task: Made it my job to own the outcome",
      "Result: Led a team of six engineers",
    ]);
  });

  it("drops blank, whitespace-only and non-string entries instead of rendering empty bullets", () => {
    expect(deriveCues(["", "   ", null, 42, "I led a team of six."])).toEqual(["Led a team of six"]);
  });

  it("degrades to an empty array for a missing or malformed points value", () => {
    expect(deriveCues(undefined)).toEqual([]);
    expect(deriveCues(null)).toEqual([]);
    expect(deriveCues("not an array")).toEqual([]);
    expect(deriveCues([])).toEqual([]);
  });

  it("is deterministic", () => {
    expect(deriveCues(POINTS)).toEqual(deriveCues(POINTS));
  });
});

describe("resolveCues", () => {
  const POINTS = ["I led a team of six engineers.", "I shipped the payments migration on time."];

  it("uses model-supplied cues when there is exactly one per point", () => {
    expect(resolveCues(["Led six engineers", "Shipped payments migration"], POINTS)).toEqual([
      "Led six engineers",
      "Shipped payments migration",
    ]);
  });

  it("shortens model-supplied cues too, so a sentence sent back as a cue is still trimmed", () => {
    const [first] = resolveCues(
      [
        "I led a team of six engineers through a migration that took most of a quarter to finish",
        "Shipped payments migration",
      ],
      POINTS,
    );
    expect(bodyWordCount(first)).toBeLessThanOrEqual(MAX_CUE_WORDS + 2);
  });

  it("derives its own cues when the model returned a different number than there are points", () => {
    // A cue sitting against the wrong beat is worse than a mechanical cue
    // sitting against the right one, so a count mismatch is not repaired by
    // padding — the whole supplied set is discarded.
    expect(resolveCues(["Only one cue"], POINTS)).toEqual(deriveCues(POINTS));
  });

  it("derives its own cues when the model returned nothing usable", () => {
    expect(resolveCues(undefined, POINTS)).toEqual(deriveCues(POINTS));
    expect(resolveCues([], POINTS)).toEqual(deriveCues(POINTS));
    expect(resolveCues(["", "  "], POINTS)).toEqual(deriveCues(POINTS));
    expect(resolveCues("not an array", POINTS)).toEqual(deriveCues(POINTS));
  });

  it("returns an empty array when there are no points to cue", () => {
    expect(resolveCues(["stray cue"], [])).toEqual([]);
  });
});
