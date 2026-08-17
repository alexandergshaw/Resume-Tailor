import { describe, it, expect } from "vitest";
import { VOICE_CUES, matchVoiceCue } from "./voiceCues.js";

// AC-T1.1..T1.8, as amended after an adversarial review that built a mutant of
// this module and passed the first version of this file. Every assertion here
// is about OBSERVABLE behaviour: what a spoken utterance matches, not how the
// matcher is built.
//
// Three of the amendments are worth stating up front, because they are what
// the first version failed to pin:
//   - `matchedAt` is pinned to an EXACT index. Comparing it across two
//     different inputs was satisfied by returning `text.length`.
//   - `Object.isFrozen(VOICE_CUES)` is shallow. Emptying
//     `VOICE_CUES[0].patterns` left the registry "frozen" and silently
//     disabled the pin cue entirely.
//   - An utterance carrying two DIFFERENT intents is ambiguous, not
//     last-wins. Provider finals arrive every few seconds, so one frame
//     holding both a pin and an unpin cue is far more likely to be narrative
//     speech ("Good question. So, moving on from the monolith, we...") than
//     sequential intent.
// The negative-control block at the bottom is load-bearing — a matcher that
// says yes to everything passes every positive case in this file.

const actionOf = (text) => matchVoiceCue(text)?.action ?? null;

describe("VOICE_CUES registry (AC-T1.1)", () => {
  it("has exactly one entry per action, in the pinned order", () => {
    // Order is not decoration: it is matchVoiceCue's tie-break (AC-T1.2) and
    // the order the sidebar teaches the cues in (AC-T3.1).
    expect(VOICE_CUES.map((c) => c.action)).toEqual(["pin", "unpin", "company"]);
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
  // registry whose pin patterns had been emptied at runtime.
  it("is frozen all the way down, not just at the top level", () => {
    expect(Object.isFrozen(VOICE_CUES)).toBe(true);
    for (const cue of VOICE_CUES) {
      expect(Object.isFrozen(cue), `${cue.id} object`).toBe(true);
      expect(Object.isFrozen(cue.phrases), `${cue.id} phrases`).toBe(true);
      expect(Object.isFrozen(cue.patterns), `${cue.id} patterns`).toBe(true);
    }
  });
});

// AC-T1.5/6/7, REDESIGNED against two constraints the user stated directly:
// a cue must sound NATURAL said out loud in a real interview, and it must be
// something only the CANDIDATE would say. The second constraint is the one
// with teeth: the copilot listens on a microphone, and on two of the three
// sources an interviewer's voice can reach that microphone, so any phrase an
// interviewer might plausibly utter is a phrase the interviewer can use to
// drive the candidate's own dashboard.
//
// Cut for being INTERVIEWER speech: "hold that thought" (what an interviewer
// says to interrupt you), "give me a second" ("give me a second, let me pull
// up your resume"), "let's move on", "moving on" and "next question" — the
// last three all already appear in questions.js's LEAD_IN_RE as interviewer
// lead-ins, which is this codebase's own evidence about who says them.
//
// Cut for being UNNATURAL: "unpin", "pull up the company", "bring up the
// company", "show me the company", "remind me about this company", "what do
// we know about them". Those are commands addressed to an app. Nobody says
// them in a job interview, and a cue nobody will say is a cue that does not
// exist.
//
// The replacements lean on DIRECTION, which is what makes a phrase belong to
// one speaker: an interviewer says "walk me through", a candidate says "let
// me walk you through".

describe("matchVoiceCue — hold cues, all candidate speech (AC-T1.5)", () => {
  const pins = [
    // The "good question" family. Kept at the user's explicit request, and
    // the one cue here with a known residual: an interviewer does say "good
    // question" when the CANDIDATE asks one, usually near the end. A false
    // hold is one click to undo, and the in-person identity gate plus the
    // tab/system channel separation cover most of the exposure.
    "Good question.",
    "Great question!",
    "That's a great question.",
    "That’s a really good question, so let me start with context.",
    "Thats a good question",
    "That is a very interesting question.",
    "What a great question.",
    "Ooh, tough question.",
    "That's a fair question, I think.",
    "Excellent question, thank you.",
    // Stalls and openers only the person ANSWERING says.
    "Let me think.",
    "Let me think about that for a moment.",
    "Um, let me think for a second here.",
    "Let me take a step back.",
    "So let me take a step back here.",
    "Let me give you an example.",
    "Let me give you a concrete example of that.",
    "Let me walk you through it.",
    "Let me walk you through how we approached that.",
    "Off the top of my head, we ran about forty services.",
  ];
  for (const utterance of pins) {
    it(`holds on "${utterance}"`, () => {
      expect(actionOf(utterance)).toBe("pin");
    });
  }
});

describe("matchVoiceCue — release cues, all candidate speech (AC-T1.6)", () => {
  // Every one of these is something said by the person who has just FINISHED
  // answering, handing the conversation back. An interviewer says none of
  // them.
  // Deliberately a SHORT list. Three phrases survived the adversarial pass;
  // three others were cut because a real interviewer says them too, and a
  // release is the asymmetrically expensive misfire: an interviewer who
  // accidentally triggers a HOLD merely holds the question you are already
  // on, but an interviewer who accidentally triggers a RELEASE yanks away a
  // hold you set deliberately, mid-answer. Strict here, tolerant on hold.
  const unpins = [
    "Does that answer your question?",
    "Does that answer the question?",
    "I hope that answers it.",
    "Hope that answers your question.",
    // Only the person who was ASKED a question describes how they would
    // approach it. An interviewer has no answer of their own to close.
    "That's how I'd approach it.",
    "That's how I would approach it.",
    "So that's how I'd approach it, anyway.",
  ];
  for (const utterance of unpins) {
    it(`releases on "${utterance}"`, () => {
      expect(actionOf(utterance)).toBe("unpin");
    });
  }
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
  // The user's constraint, stated as a test. Each of these was a shipped cue
  // in the previous vocabulary; each is now a hard negative control, because
  // an interviewer saying it must never drive the candidate's dashboard.
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
    // The mirror of a candidate cue. "walk me through" is the interviewer's
    // direction; "let me walk you through" is the candidate's. If the
    // pronouns ever stop doing that work, this goes red.
    "Walk me through your experience with distributed systems.",
    "Tell me about a time you disagreed with your manager.",
    // Cut from the release vocabulary after an adversarial pass produced a
    // natural interviewer utterance for each. "back to you" is the sharpest:
    // it has no pronoun asymmetry at all, and an interviewer saying it is
    // OPENING a question, the exact opposite of a candidate signing off.
    "Okay, back to you, tell me about your experience.",
    "Back to you.",
    "We're happy to go deeper on comp later if you'd like.",
    "Let me know if you want more detail on the comp package.",
    // Cut in a later round for the same reason: interviewers condense the
    // role, the comp and the process constantly, and this is the phrase they
    // use to signal "I am summarizing, ask if you want more".
    "That's the short version of how our team is structured.",
    "That's the short version, we can go deeper in a follow up call.",
    // An interviewer AGREEING with an approach the candidate just described,
    // peer to peer. The tell is the trailing "too" / "as well": someone
    // closing their OWN answer never appends it, because there is nothing yet
    // to agree with. That trailing word is the whole guard.
    "If I were in your seat, that's how I'd approach it too.",
    "That's how I would approach it as well, for what it's worth.",
    "Honestly, that's how I'd approach it too.",
  ];
  for (const utterance of interviewerSpeech) {
    it(`stays silent on "${utterance}"`, () => {
      expect(matchVoiceCue(utterance)).toBeNull();
    });
  }
});

describe("matchVoiceCue — two intents in one utterance are ambiguous (AC-T1.2.1)", () => {
  // The caller must not act on these. `action` still names the last-matching
  // cue so the session log can say what was heard.
  it("flags a hold and a release in the same utterance", () => {
    const hit = matchVoiceCue("Good question. So we cut latency by a third. Does that answer your question?");
    expect(hit.ambiguous).toBe(true);
    expect([...hit.actions].sort()).toEqual(["pin", "unpin"]);
  });

  it("flags a hold and a company cue in the same utterance", () => {
    const hit = matchVoiceCue("Good question. I was reading about the company recently.");
    expect(hit.ambiguous).toBe(true);
    expect([...hit.actions].sort()).toEqual(["company", "pin"]);
  });

  it("does NOT flag an utterance that only repeats the SAME intent", () => {
    // Two matches, one action. This must stay actionable — a candidate saying
    // "Good question, really good question" means one thing.
    const hit = matchVoiceCue("Good question, that's a really good question.");
    expect(hit.ambiguous).toBe(false);
    expect([...hit.actions]).toEqual(["pin"]);
    expect(hit.action).toBe("pin");
  });

  it("does not flag a single-cue utterance", () => {
    expect(matchVoiceCue("Let me think about that.").ambiguous).toBe(false);
  });
});

describe("matchVoiceCue — the last occurrence is what matchedAt reports (AC-T1.2)", () => {
  // F6: comparing matchedAt across two different inputs was satisfied by
  // returning `text.length`. These pin exact indices into the NORMALIZED text
  // (lowercased, whitespace collapsed — see normalizeQuestion).
  it("reports the exact index of the match", () => {
    // "okay. good question." -> "good" begins at index 6.
    expect(matchVoiceCue("Okay. Good question.").matchedAt).toBe(6);
  });

  it("reports the LAST occurrence when a cue repeats", () => {
    // "good question. really, good question."
    //  ^0                     ^23
    // Same action twice, so this is deliberately NOT ambiguous — it isolates
    // the last-occurrence rule from the two-intents rule.
    const hit = matchVoiceCue("Good question. Really, good question.");
    expect(hit.matchedAt).toBe(23);
    expect(hit.action).toBe("pin");
    expect(hit.ambiguous).toBe(false);
  });

  it("names the cue it matched, not just the action", () => {
    const hit = matchVoiceCue("Let me think about that.");
    expect(VOICE_CUES.some((c) => c.id === hit.id && c.action === hit.action)).toBe(true);
  });
});

describe("matchVoiceCue — position and formatting tolerance (AC-T1.3)", () => {
  it("matches a cue in the middle of an utterance", () => {
    expect(actionOf("So, yeah, good question, I would start by scoping it.")).toBe("pin");
  });

  it("matches regardless of case", () => {
    expect(actionOf("GOOD QUESTION")).toBe("pin");
    expect(actionOf("good question")).toBe("pin");
  });

  it("matches across a run of whitespace and a line break", () => {
    expect(actionOf("that's   a  great\nquestion")).toBe("pin");
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
      expect(actionOf("That's a great question.")).toBe("pin");
      expect(actionOf("Does that answer your question?")).toBe("unpin");
      expect(actionOf("I was reading about the company recently.")).toBe("company");
    }
  });

  it("reports the same matchedAt every time", () => {
    const first = matchVoiceCue("Okay. Good question.").matchedAt;
    const second = matchVoiceCue("Okay. Good question.").matchedAt;
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
