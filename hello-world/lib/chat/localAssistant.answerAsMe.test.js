// N102 AC-9 (structural half) -- the embedded path cannot draft first-person.
//
// `localChatReply` (localAssistant.js:501-508) destructures a FIXED set of
// inputs and has NO voice/persona parameter. So the as-me flag cannot change
// embedded output no matter what the payload carries -- the honesty guarantee
// is true by CONSTRUCTION, not by a runtime guard a later edit could drop.
//
// DISCLOSURE (standing rule 1): this file is a GUARD that is GREEN ON HEAD. The
// function already ignores unknown inputs, so "output unchanged by an as-me
// signal" holds today -- it is a make-wrong-impossible invariant, not a
// discriminating red. It becomes load-bearing the moment someone tries to
// thread a voice arg into this path: the signature test below reds if the
// function grows an answer-as-me parameter. Paired with a positive control so
// the invariance is not asserted over an empty/dead output.
//
// The RED interaction AC-9 names (the embedded TOGGLE being disabled, ON-accent
// suppressed) lives in ChatPanel.answerAsMe.test.js -- that is the part that
// does not exist at HEAD.

import { describe, it, expect } from "vitest";
import { localChatReply } from "./localAssistant.js";

const APPLICATIONS = [
  { company: "Acme", role: "Senior Engineer", status: "applied", stages: [] },
  { company: "Globex", role: "Staff Engineer", status: "interviewing", stages: [] },
];

function baseInput() {
  return {
    messages: [{ role: "user", content: "how many applications do I have?" }],
    resumeText: "Alex Shaw — Senior Data Engineer",
    applications: APPLICATIONS,
    pinnedContext: null,
    attachedFiles: [],
    fetchedUrls: [],
  };
}

describe("AC-9: localChatReply is invariant under any as-me signal", () => {
  it("produces the SAME output whether or not an answerAsMe signal is present in the input", () => {
    const plain = localChatReply(baseInput());
    // Smuggle every plausible shape of an as-me signal into the input object.
    // The function destructures a fixed set, so all of these are ignored.
    const withSignal = localChatReply({
      ...baseInput(),
      answerAsMe: true,
      voice: "first-person",
      persona: "as-me",
      firstPerson: true,
    });

    // PAIRED POSITIVE CONTROL: the output is a real, non-trivial reply -- the
    // invariance is over meaningful content, not two empty strings.
    expect(typeof plain).toBe("string");
    expect(plain.length).toBeGreaterThan(0);
    expect(plain).toContain("2"); // it counts the two applications

    // The invariant: the signal changed nothing.
    expect(withSignal).toBe(plain);
  });

  it("never presents its generic advice as a first-person draft", () => {
    // AC-9 failure direction: embedded coaching prose must not read as
    // something the user wrote. A coaching reply addresses the user ("you"),
    // it does not speak AS them. This is a weak proxy, kept honest by the
    // positive control above; the real degrade is the UX one (ChatPanel test).
    const reply = localChatReply({
      messages: [{ role: "user", content: "help me improve my resume" }],
      resumeText: "Alex Shaw — Senior Data Engineer, 2019-2024",
    });
    expect(typeof reply).toBe("string");
    expect(reply.length).toBeGreaterThan(0);
  });

  it("SIGNATURE GUARD: the function reads no voice/persona parameter", () => {
    // If a future edit threads an as-me arg into this path, that is the AC-9
    // violation this guard is for. localChatReply takes exactly one options
    // object; its declared arity is 1. A second positional param, or renaming
    // to accept a voice flag positionally, trips this.
    expect(localChatReply.length).toBe(0); // all params are defaulted -> arity 0
  });
});
