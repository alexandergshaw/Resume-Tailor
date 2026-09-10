### R-262 | area: copilot-questions | parallel-safe: yes | automatable: yes

**Summary:** The question that reaches the model is the question that was asked — `cleanQuestion` no longer deletes the verb.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism lib/copilot/questions.fidelity.test.js lib/copilot/questions.test.js lib/copilot/localDetection.test.js lib/copilot/localDetection.openers.test.js`.
2. Read `HESITATION_RE`, `DISCOURSE_MARKER_RE` and `PREAMBLE_RE` in `hello-world/lib/copilot/questions.js`.

**Expected:** All pass. `cleanQuestion`'s header promised it was "purely cosmetic — never changes the substance of the ask". In the 2026-08-25 session it turned **"What do you know about Purple Wave?" into "What do about Purple Wave?"** — `FILLER_RE` stripped "you know" unconditionally as hesitation filler, deleting the main verb. The model was then asked to answer a sentence with no verb, which is a large part of why the four bullets it returned contained no fact about the company.

**The rule is structural, not a longer exception list.** Hesitations (`um`, `uh`, `erm`, `hmm`, `kind of like`, `sort of like`) are never content and stay unconditional. The multi-word discourse markers `you know` and `i mean` are filler ONLY at a clause boundary — opening the utterance, or touching a comma on at least one side — and content everywhere else. The strip consumes one adjacent comma, or "when, you know, a deadline" cleans to "when,, a deadline".

**All three boundary shapes need their own case.** A fixture set where every marker happens to carry a trailing comma is satisfied by a comma-after-only rule, which leaves "I mean how would you approach it?" untouched. And **every marker needs its own positive control**: a test titled "the same rule applies to 'I mean'" originally had two assertions that both passed against the unmodified source ("what did you *mean*" was never what `FILLER_RE` matched; "So, I mean," is stripped identically by the old rule), and a mutation harness shipped an implementation that left `i mean` unconditional straight past it.

**The preamble strip is anchored at `^`, and that anchor is load-bearing.** An interviewer's "That's a great question." was being stored as part of the question — which also gave it a different normalized key from the identical question asked 16 seconds earlier, so the answer cache missed and the copilot paid for a model call it had already made. Unanchored, the same rule deletes the ask out of the middle of "What makes a great question in a design review?" and "Tell me about a time you asked a really good question." Three separate mutants collapsed the rule to "keep only the last sentence", passed every other case, and destroyed the context in "We use Kafka. How would you scale the consumer group?" — so the corpus must contain a multi-sentence question whose first sentence is content.

**Also here:** `STARTERS` gained "talk to me", the missing member of a family it already had ("talk about", "talk me through", "talk us through"). Its absence cost a 1.4-second network round trip on the first question of that session — every other question was detected in 0ms — and cost the question's wording, since the remote confirm rewrote it.

