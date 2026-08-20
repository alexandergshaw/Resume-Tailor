// AC-Q5 - deterministic "next situation" selector for the /copilot "Speak
// as" drill's no-network path. This is what the embedded engine uses
// directly (app/api/copilot/role-situation/route.js) and what the Gemini
// path in that same route falls back to on any model hiccup, so it has to
// hold up on its own with no LLM involved at all.
//
// Same discipline as lib/copilot/practiceQuestions.js: a pure function of
// its arguments, seeded rather than random, and safe to call from a route
// handler or a test with no setup. The one deliberate difference from
// nextPracticeQuestion is the exhaustion behavior - see AC-Q5.4 below.
//
// Deliberately data plus pure functions only: no React, no DOM, no
// network, no randomness, no wall-clock read.

import { situationsFor } from "./roleSituationBank.js";
import { normalizeRole } from "./roleRegisters.js";
import { normalizeQuestion } from "./questions.js";
import { pickDistinct } from "@/lib/text/phrasing";

// A full, seeded permutation of a role's situations. Seeding on the role
// value alone (not on `asked`) keeps this order stable across calls within
// a session, so "the next unasked situation" walks a fixed sequence instead
// of jumping around as the asked list grows.
function seededOrder(role) {
  const situations = situationsFor(role);
  return pickDistinct(role, situations, situations.length);
}

// Returns the next situation for `role` that hasn't already been shown,
// walking the role's seeded order. `asked` is compared against each
// situation's `prompt` the same way lib/copilot/questions.js compares
// interview questions - trimmed, whitespace-collapsed, case-insensitive -
// so a caller that stores the exact prompt text (as roleDrillClient.js
// does) gets a reliable match regardless of incidental formatting.
//
// AC-Q5.4: when every situation has been asked, this does NOT dead-end the
// way nextPracticeQuestion does with an empty question. A register drill
// has no natural stopping point, and a blank card is a worse answer than an
// honest repeat - so it restarts at the first entry in the seeded order and
// flags `exhausted: true` so the caller (the route, then the UI) can say so
// plainly instead of silently looping.
export function nextRoleSituation({ role, asked } = {}) {
  const normalized = normalizeRole(role);
  const order = seededOrder(normalized);

  const askedNorms = new Set(
    (Array.isArray(asked) ? asked : [])
      .map((entry) => normalizeQuestion(typeof entry === "string" ? entry : ""))
      .filter(Boolean),
  );

  for (const situation of order) {
    if (!askedNorms.has(normalizeQuestion(situation.prompt))) {
      return { situation, exhausted: false };
    }
  }

  return { situation: order[0], exhausted: true };
}
