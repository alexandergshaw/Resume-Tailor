import { describe, it, expect } from "vitest";
import { VOICE_CUES, matchVoiceCue } from "./voiceCues.js";

// AC-T1.1..T1.8, as amended after an adversarial review that built a mutant of
// this module and passed the first version of this file. Every assertion here
// is about OBSERVABLE behaviour: what a spoken utterance matches, not how the
// matcher is built.
//
// N18 delta review F1, OWNER RULING: the "hold" ("pin") and "release"
// ("unpin") cues and every test that exercised them ONLY (the hold/release
// phrase lists, and the two-distinct-actions ambiguity cases, which needed a
// second action to exist at all) are gone along with the registry entries —
// see voiceCues.js's own module doc. Company remains, and every mechanism
// test below (last-occurrence indexing, case/whitespace tolerance, repeat
// calls being independent) is re-pointed at company phrases so the
// underlying matcher machinery — which did not change — stays covered.
//
// Two amendments from that review are still worth stating up front, because
// they are what the first version of this file failed to pin and remain true
// of a one-action registry:
//   - `matchedAt` is pinned to an EXACT index. Comparing it across two
//     different inputs was satisfied by returning `text.length`.
//   - `Object.isFrozen(VOICE_CUES)` is shallow. Emptying
//     `VOICE_CUES[0].patterns` left the registry "frozen" and silently
//     disabled the company cue entirely.
// The negative-control block at the bottom is load-bearing — a matcher that
// says yes to everything passes every positive case in this file.

const actionOf = (text) => matchVoiceCue(text)?.action ?? null;

describe("VOICE_CUES registry (AC-T1.1)", () => {
  it("has exactly one entry per action, in the pinned order", () => {
    // Order is not decoration: it is matchVoiceCue's tie-break (AC-T1.2) and
    // the order the sidebar teaches the cues in (AC-T3.1).
    expect(VOICE_CUES.map((c) => c.action)).toEqual(["company"]);
  });

  it("gives every cue an id, a title, a summary, example phrases and patterns", () => {
    for (const cue of VOICE_CUES) {
      expect(typeof cue.id).toBe("string");
      expect(cue.id.length).toBeGreaterThan(0);
      expect(typeof cue.title).toBe("string");
      expect(cue.title.length).toBeGreaterThan(0);
      expect(typeof cue.summary).toBe("string");
      expect(cue.summary.length).toBeGreaterThan(0);
      expect(Array.isArray(cue.patterns)).toBe(true);
      expect(cue.patterns.length).toBeGreaterThan(0);
      for (const p of cue.patterns) expect(p).toBeInstanceOf(RegExp);
    }
  });

  // AC-T1.5.2: the sidebar teaches the user from `phrases`. A cue shipping one
  // phrase passes "every advertised phrase matches its own cue" (the
  // implementer controls both sides of that) and teaches almost nothing.
  it("advertises at least three example phrases per cue", () => {
    for (const cue of VOICE_CUES) {
      expect(Array.isArray(cue.phrases), cue.id).toBe(true);
      expect(cue.phrases.length, cue.id).toBeGreaterThanOrEqual(3);
    }
  });

  it("gives every cue a unique id", () => {
    expect(new Set(VOICE_CUES.map((c) => c.id)).size).toBe(VOICE_CUES.length);
  });

  // AC-T3.1: the sidebar renders `phrases` verbatim as "say one of these". A
  // phrase its own cue does not match is a lie printed on screen.
  it("matches every example phrase it advertises", () => {
    for (const cue of VOICE_CUES) {
      for (const phrase of cue.phrases) {
        expect(matchVoiceCue(phrase), `advertised phrase "${phrase}"`).toMatchObject({
          action: cue.action,
        });
      }
    }
  });

  // F7: the shallow version of this check was demonstrated green against a
  // registry whose patterns had been emptied at runtime.
  it("is frozen all the way down, not just at the top level", () => {
    expect(Object.isFrozen(VOICE_CUES)).toBe(true);
    for (const cue of VOICE_CUES) {
      expect(Object.isFrozen(cue), `${cue.id} object`).toBe(true);
      expect(Object.isFrozen(cue.phrases), `${cue.id} phrases`).toBe(true);
      expect(Object.isFrozen(cue.patterns), `${cue.id} patterns`).toBe(true);
    }
  });
});

describe("matchVoiceCue — company cues, all candidate speech (AC-T1.7)", () => {
  // These are the natural bridges a candidate says when they are ABOUT to
  // reference something they know about the company. Saying one buys the
  // couple of seconds the panel needs to load, which is the whole point: the
  // cue is useful speech in its own right, not an incantation.
  const company = [
    "I was reading about the company recently.",
    "I've been reading about the company.",
    "I have been following the company for a while.",
    "I've been following the company closely.",
    "Tell me more about the company.",
    "Could you tell me more about the company?",
  ];
  for (const utterance of company) {
    it(`pulls company info on "${utterance}"`, () => {
      expect(actionOf(utterance)).toBe("company");
    });
  }

  // The phrase has to END at "the company". `\bthe company\b` alone matches
  // inside "the company's competitor" — an apostrophe satisfies the word
  // boundary — and inside "the company you used to work for", which is an
  // INTERVIEWER asking about a previous employer. Both were confirmed to
  // fire before this rule existed. A company lookup is the most expensive
  // misfire in the module (an unprompted outbound request carrying the
  // posting's details), so it gets the tightest guard.
  const notThisCompany = [
    "I've been following the company's competitor pretty closely too.",
    "I was reading about the company's earnings report for a client.",
    "From what I've read about the company you used to work for, that was a hard migration.",
    "I have been following the company culture conversation in our industry.",
  ];
  for (const utterance of notThisCompany) {
    it(`does not fire on "${utterance}"`, () => {
      expect(matchVoiceCue(utterance)).toBeNull();
    });
  }
});

describe("matchVoiceCue — phrases the INTERVIEWER says must never fire", () => {
  // The user's constraint, stated as a test. Every one of these — including
  // the ones shaped like the now-retired hold/release phrases — must never
  // drive the candidate's dashboard.
  const interviewerSpeech = [
    "Hold that thought.",
    "Hold that thought, I want to come back to it.",
    "Give me a second.",
    "Give me a second while I pull up your resume.",
    "Give me one moment.",
    "Let's move on.",
    "Okay, moving on.",
    "Moving on.",
    "Next question.",
    "Alright, next question for you.",
    "Walk me through your experience with distributed systems.",
    "Tell me about a time you disagreed with your manager.",
    "Okay, back to you, tell me about your experience.",
    "Back to you.",
    "We're happy to go deeper on comp later if you'd like.",
    "Let me know if you want more detail on the comp package.",
    "That's the short version of how our team is structured.",
    "That's the short version, we can go deeper in a follow up call.",
    "If I were in your seat, that's how I'd approach it too.",
    "That's how I would approach it as well, for what it's worth.",
    "Honestly, that's how I'd approach it too.",
    // Retired hold/release phrasing — kept as negative controls now that
    // neither action exists, so a future re-add cannot silently reuse this
    // exact wording without a test noticing.
    "Good question.",
    "That's a great question.",
    "Let me think about that for a moment.",
    "Does that answer your question?",
    "I hope that answers it.",
    "That's how I'd approach it.",
  ];
  for (const utterance of interviewerSpeech) {
    it(`stays silent on "${utterance}"`, () => {
      expect(matchVoiceCue(utterance)).toBeNull();
    });
  }
});

describe("matchVoiceCue — a single cue is never flagged ambiguous (AC-T1.2.1)", () => {
  // The two-DIFFERENT-actions ambiguity cases this block used to carry
  // needed a second action to exist at all (a hold plus a release, or a hold
  // plus a company cue) — see voiceCues.js's own module doc for why that
  // mechanism stays in matchVoiceCue unchanged even though it cannot be
  // exercised by any real utterance today. What remains coverable is the
  // same-action case: repeating one cue's phrase must still resolve, not
  // read as two intents.
  it("does NOT flag an utterance that only repeats the SAME intent", () => {
    const hit = matchVoiceCue("I was reading about the company recently. I was reading about the company recently.");
    expect(hit.ambiguous).toBe(false);
    expect([...hit.actions]).toEqual(["company"]);
    expect(hit.action).toBe("company");
  });

  it("does not flag a single-cue utterance", () => {
    expect(matchVoiceCue("Tell me more about the company.").ambiguous).toBe(false);
  });
});

describe("matchVoiceCue — the last occurrence is what matchedAt reports (AC-T1.2)", () => {
  // F6: comparing matchedAt across two different inputs was satisfied by
  // returning `text.length`. These pin exact indices into the NORMALIZED text
  // (lowercased, whitespace collapsed — see normalizeQuestion).
  it("reports the exact index of the match", () => {
    const prefix = "okay. ";
    expect(matchVoiceCue(`${prefix}tell me more about the company.`).matchedAt).toBe(prefix.length);
  });

  it("reports the LAST occurrence when a cue repeats", () => {
    // Same action twice, so this is deliberately NOT ambiguous — it isolates
    // the last-occurrence rule from the two-intents rule.
    const prefix = "tell me more about the company. really, ";
    const hit = matchVoiceCue(`${prefix}tell me more about the company.`);
    expect(hit.matchedAt).toBe(prefix.length);
    expect(hit.action).toBe("company");
    expect(hit.ambiguous).toBe(false);
  });

  it("names the cue it matched, not just the action", () => {
    const hit = matchVoiceCue("Tell me more about the company.");
    expect(VOICE_CUES.some((c) => c.id === hit.id && c.action === hit.action)).toBe(true);
  });
});

describe("matchVoiceCue — position and formatting tolerance (AC-T1.3)", () => {
  it("matches a cue in the middle of an utterance", () => {
    expect(actionOf("So, yeah, I was reading about the company recently, out of curiosity.")).toBe("company");
  });

  it("matches regardless of case", () => {
    expect(actionOf("TELL ME MORE ABOUT THE COMPANY")).toBe("company");
    expect(actionOf("tell me more about the company")).toBe("company");
  });

  it("matches across a run of whitespace and a line break", () => {
    expect(actionOf("tell   me  more\nabout the company")).toBe("company");
  });

  it("matches with either apostrophe or none", () => {
    expect(actionOf("I've been following the company")).toBe("company");
    expect(actionOf("I’ve been following the company")).toBe("company");
    expect(actionOf("Ive been following the company")).toBe("company");
  });
});

describe("matchVoiceCue — negative controls (AC-T1.4/T1.5.1)", () => {
  const noCue = [
    "",
    "   ",
    "I think that was a good outcome for the team.",
    "We questioned the assumption and rebuilt the pipeline.",
    "The company culture was great, honestly.",
    "I asked a lot of questions in that role.",
    "My next role was at Acme, working on billing.",
    "So I own the answer to that end to end.",
    "We moved the service on to a new cluster.",
    "I gave the team a second chance at the design.",
    "It was a question of scale, not correctness.",
    "Tell me if you want more detail on the company I worked for.",
    // AC-T1.5.1 — the ranked false positives the review found, each of which
    // fired against the first version of this module.
    "My company background is in fintech and payments.",
    "I did company research before every single call.",
    "I owned the company news feed for two years.",
    "I built the company info page in my first month.",
    "So that was phase one. Moving on to phase two, we sharded the database.",
    "We were moving on from the old stack at the time.",
    "The next question we asked ourselves was whether it would scale.",
    "The first thing I ask is what do we know about them, and then we test it.",
    "I circled back to you the same day with the numbers.",
  ];
  for (const utterance of noCue) {
    it(`does not fire on ${JSON.stringify(utterance)}`, () => {
      expect(matchVoiceCue(utterance)).toBeNull();
    });
  }

  it("returns null for a non-string", () => {
    expect(matchVoiceCue(null)).toBeNull();
    expect(matchVoiceCue(undefined)).toBeNull();
    expect(matchVoiceCue(42)).toBeNull();
    expect(matchVoiceCue({})).toBeNull();
  });
});

describe("matchVoiceCue — repeat calls are independent (AC-T1.2)", () => {
  // A RegExp carrying /g keeps `lastIndex` between `.exec` calls, so a shared
  // pattern object silently answers differently on the second call for the
  // same input. This asserts the symptom rather than the flag.
  it("gives the same answer for the same utterance every time", () => {
    for (let i = 0; i < 5; i += 1) {
      expect(actionOf("I was reading about the company recently.")).toBe("company");
      expect(actionOf("Tell me more about the company.")).toBe("company");
    }
  });

  it("reports the same matchedAt every time", () => {
    const first = matchVoiceCue("Okay. Tell me more about the company.").matchedAt;
    const second = matchVoiceCue("Okay. Tell me more about the company.").matchedAt;
    expect(second).toBe(first);
  });
});

describe("voiceCues.js is pure (AC-T1.8)", () => {
  it("reaches for no clock, no randomness, no DOM, no network", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./voiceCues.js", import.meta.url), "utf8");
    expect(src).not.toMatch(/Date\.now|new Date\(|Math\.random|document\.|window\.|fetch\(/);
  });
});
