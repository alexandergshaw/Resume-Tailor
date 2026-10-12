// N157 SC-C sub-chunk C-a -- the pinned copy module (step 4b TDD).
//
// Binds to docs/loop/N157.SC-C.design.r2.md §7 ("Pinned strings ... changing
// one is a ruling, not an edit") and §5.1 (`lib/studyPlan/studyPlanCopy.js`:
// "the pinned strings of section 7 in one reviewable place"). C-b and C-c
// render this copy; freezing it here keeps the two later waves from drifting it.
//
// RED ON HEAD, and WHY: `lib/studyPlan/studyPlanCopy.js` does not exist yet, so
// the dynamic import in beforeAll throws "cannot find module" and every `it`
// reds the first time it touches the collected strings. Honest greenfield red.
//
// SHAPE-AGNOSTIC BY DESIGN. The design pins the STRINGS, not the export shape
// (flat consts vs a nested object is an implementer call). So the suite deep-
// collects every string VALUE the module exports and asserts over that set.
// This keeps the contract on the copy (the output), not on a source layout the
// design never froze -- and a missing or altered string still reds.
//
// TEMPLATES ARE RAW STRINGS. §7 presents plan-specific copy as raw templates
// with `<...>` placeholders ("one reviewable place"), so the templated strings
// below are asserted as raw strings carrying their slots. This is also the
// "no fabricated content" instrument: the company/role/error specifics are
// SLOTS, never baked values.

import { describe, it, expect, beforeAll } from "vitest";

let mod = null;
let strings = []; // every string value reachable from the module's exports

// Deep-collect string values from the module namespace: handles flat string
// consts, nested objects, and arrays. Functions are skipped (a copy stored as a
// formatter function is not pinned by this suite -- see the report's limits).
function collectStrings(value, out, seen) {
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  for (const v of Object.values(value)) collectStrings(v, out, seen);
}

beforeAll(async () => {
  mod = await import("@/lib/studyPlan/studyPlanCopy.js");
  const out = [];
  collectStrings(mod, out, new WeakSet());
  strings = out;
});

const has = (s) => strings.includes(s);
const someContains = (sub) => strings.some((s) => s.includes(sub));

// The verbatim §7 strings this suite freezes. Every one is a RAW string (static
// labels, plus templates whose `<...>` slots are part of the literal). Each is
// one positive assertion: a reworded or deleted string reds.
const PINNED_STATIC = [
  // nav / shell
  "Practice tool",
  "Answer aloud",
  "Study plan",
  // picker
  "Pick a tracked application to build a study plan.",
  "No tracked postings yet. Add one from the Tracking tab.",
  "Pick a tracked application first. The plan is built from that company's research.",
  "Create study plan",
  // create / notice
  // PD-SD-3 (N157 SC-D, RULED IN): the Gemini egress notice gains ONE appended
  // sentence naming the focus/skip choices as egress. This is an AUTHORIZED
  // pinned-string change (brief: "UPDATE the landed verbatim pins ... to the NEW
  // notice.gemini"); the previous string (ending "... saved to your account.")
  // is deliberately replaced here, not kept alongside, so a build that still
  // ships the OLD under-stating notice reds this pin.
  "Creating a plan searches the web for this company. Its name, the job title, the location and the posting text are sent to Google (Gemini) to research it, and that research is sent to Gemini again to write the plan. Your resume and cover letter are not sent. The plan and your progress are saved to your account. Any focus or skip choices you set are sent to Gemini with it.",
  "The embedded engine is on, so nothing is sent to an AI provider. It can only use company research you already have saved.",
  // build steps / status
  "Researching the company and the interview process",
  "Writing your plan",
  "Writing your plan...",
  "Your plan is ready.",
  // failures
  "The plan could not be built.",
  "Study plans are switched off right now.",
  "We couldn't rebuild your plan. Your previous plan is unchanged.",
  "The embedded engine can't research a company. Switch the engine in the top bar to Gemini, then try again.",
  "Try again",
  "Build a general plan without research",
  "A general plan is not based on sources about this company. It will be marked as unsourced.",
  // card
  "Answer it out loud or in your head, then show the answer.",
  "Show answer",
  "Got it",
  "Missed it",
  "Next",
  "Previous card",
  "Plan outline",
  // chips
  "New",
  "Review",
  "No source",
  "Unsourced",
  // passes / revisit / complete
  "Going back over cards you missed or skipped",
  "You marked this: Got it",
  "You marked this: Missed it",
  "All cards done",
  "Review all again",
  // save
  "Your last answer wasn't saved. It's kept on this device for now.",
  "Retry saving",
  // sources
  "source link unavailable",
  // banners
  "This is a general plan. It is not based on research about this company.",
  "Research for this company found no sources you can open, so this plan is unsourced.",
  "Built offline from your saved research, without AI. Cards are excerpts, not written questions.",
  // remedies
  "Research and rebuild",
  "Refresh research",
  "Rebuild plan",
  "Confirm rebuild?",
  "Switch the engine in the top bar to Gemini, then rebuild.",
  "Rebuilding writes new cards, so most of your progress on this plan will not carry over. Activate again to confirm.",
];

// Templated strings: raw strings whose `<...>` slot proves the plan/error text
// is DATA, not a fabricated specific.
const PINNED_TEMPLATES = [
  "Build a study plan for <title> at <company>: questions and answers drawn from web research on the company, the role and the interview process, worked through one card at a time. Your progress is saved to your account, so you can pick up on any device.",
  "Researching <company>. This can take a minute or two.",
  "Couldn't load your study plan: <error>",
  "We couldn't research this company: <error>",
  "Card <i> of <n> in this topic",
  "<done> of <total> done",
  "You've been through all <total> cards.",
  "Show all sources (<n>)",
  "Based on research from <relative>.",
];

describe("studyPlanCopy: the §7 strings, verbatim (changing one is a ruling)", () => {
  it.each(PINNED_STATIC)("exports the static string: %s", (expected) => {
    expect(has(expected)).toBe(true);
  });

  it.each(PINNED_TEMPLATES)("exports the raw template: %s", (expected) => {
    expect(has(expected)).toBe(true);
  });
});

describe("no fabricated content: plan/role/error text is a slot, not a baked value", () => {
  it("the intro and the per-company status are templates carrying <title>/<company> slots", () => {
    expect(someContains("<title>")).toBe(true);
    expect(someContains("<company>")).toBe(true);
    // The whole intro string is present with BOTH slots (one reviewable place).
    expect(has(PINNED_TEMPLATES[0])).toBe(true);
  });

  it("error copy carries an <error> slot rather than a hardcoded message", () => {
    expect(someContains("<error>")).toBe(true);
  });
});

describe("copy character hygiene (§7: no em dashes, no emoji) -- a class guard over ALL exported copy", () => {
  const EM_DASH = "—";
  // Emoji scanned with a Node regex (never grep -P), canaried below.
  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

  it("the detectors discriminate (canary against known-positive and known-negative literals)", () => {
    // em dash
    expect(("a " + EM_DASH + " b").includes(EM_DASH)).toBe(true);
    expect("a - b (ascii hyphen)".includes(EM_DASH)).toBe(false);
    // emoji
    expect(EMOJI.test("ready \u{1F600}")).toBe(true);
    expect(EMOJI.test("Create study plan")).toBe(false);
  });

  it("no exported copy string contains an em dash", () => {
    // Class guard: holds for every current AND future exported string. Its
    // limit (loop-traps-tests #12): it catches a WRONG character class, not a
    // missing string or a wrong word -- the verbatim pins above cover those.
    const offenders = strings.filter((s) => s.includes(EM_DASH));
    expect(offenders).toEqual([]);
  });

  it("no exported copy string contains an emoji", () => {
    const offenders = strings.filter((s) => EMOJI.test(s));
    expect(offenders).toEqual([]);
  });
});

describe("the module actually ships copy (guards against an empty export set)", () => {
  it("collects a non-trivial number of strings (so the pins above are not vacuous)", () => {
    // If the module existed but exported nothing, every has()/someContains()
    // would fail -- but this makes the 'empty module' failure mode explicit.
    expect(strings.length).toBeGreaterThanOrEqual(PINNED_STATIC.length);
  });
});
