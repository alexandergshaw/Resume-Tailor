// AC-Q7 - the deterministic model answer behind the /copilot "Speak as"
// drill. roleResponseLocal turns one situation's `beats` (lib/copilot/
// roleSituationBank.js) into a model answer a person could actually SAY out
// loud as that role: one line per the register's `beatLabels`, in order,
// each a complete spoken sentence.
//
// The beats themselves already carry the substance — both the bank's
// per-situation `beats` (wave 1a's own contract requires >= 2 of the role's
// vocabulary terms verbatim) and the register's own `fallbackBeats` (each
// role's set now carries at least one of that role's terms naturally). This
// module's job is narrower than it might look: package that substance as
// something a person would actually say, never invent new claims — or new
// vocabulary — on top of it. That is the same discipline sampleAnswerLocal.js
// had to learn the hard way: a deterministic answer that fabricates a claim
// by joining two true facts, or that reads a bare metric with no referent,
// is a defect, not a feature. The connective tissue below (MIDDLES/CLOSERS)
// is deliberately inert with respect to vocabulary — it never names a term
// of art itself — because "used in this answer" is a claim the panel prints
// right under the terms list, and that claim must trace back to something
// the AUTHORED beat actually said, not to a connector the composer bolted on
// to hit a count (see roleResponse.contract.test.js's "vocabulary comes from
// the content, never from decoration").
//
// Phrasing is varied by `pick` (lib/text/phrasing.js), seeded on
// `${role}|${situationId}|${index}` per AC-Q7.3, so the same situation always
// produces the same answer (deterministic, cacheable, testable) while
// different situations - and the same beat position across different roles -
// don't all read as one fill-in-the-blank template.
//
// Deliberately pure: no React, no DOM, no network, no random-number calls,
// no wall-clock reads. Every export is a straight function of its argument.

import { roleRegister, normalizeRole } from "./roleRegisters.js";
import { situationsFor } from "./roleSituationBank.js";
import { pick } from "@/lib/text/phrasing";

// A connector is spoken BEFORE a beat, so it never belongs on the first
// line: every register's own first cadence rule is a lead-with rule ("open
// with the headline fact before any softening", "lead with the number in
// the first breath", "state the assessment plainly before the caveats") —
// and the panel prints that exact rule three lines under the answer. An
// opener like "First, here's what's actually going on:" in front of the
// first beat models the opposite of the cadence it's teaching. The authored
// beats were rewritten so their OWN first sentence already opens well; the
// first line is always that beat, verbatim (see composeLine below).
//
// Beyond the first line, some beats open THEMSELVES too — either by pronoun
// ("I'll own this one myself...", see SELF_OPENING) or with their own early
// colon ("What they are asking is real: ...", see hasEarlyColon). Prepending
// a connector to either produces two run-ups to one sentence ("Here's the
// other piece, what they are asking is real: ...") — nobody rehearsing
// cadence clears their throat twice — so those are also spoken as written,
// with no connector, at whatever position they occur.
const MIDDLES = ["Here's the other piece,", "At the same time,", "Alongside that,", "On top of that,"];

const CLOSERS = ["Going forward,", "Looking ahead,", "From here,", "Next,"];

// The registry rewrite (see roleRegisters.js) made many beats SELF-OPENING —
// they already start with their own lead-in ("Let me tell you the assessment
// plainly:", "I'll own this one myself"). A beat matching this is spoken
// exactly as written: no connector, no lead-word lowercasing (there is no
// connector for it to follow, so the beat's own capitalization is already
// correct). Deliberately the SAME pattern roleResponse.contract.test.js's
// own `check` helper sweeps with — kept here as one literal, not restated by
// eye.
const SELF_OPENING = /^(I\b|I'm\b|I'll\b|My\b|We\b|We're\b|We'll\b|Let me\b|Here's\b)/i;

// A colon inside the first ~60 characters of the beat is the beat's OWN
// early colon ("My position is this: ..." / "What they are asking is real:
// ..."), not one buried deep in a later clause. A beat like that already
// carries its own lead-in the same way a SELF_OPENING beat does, so it gets
// the same treatment: spoken as written, no connector — otherwise a
// connector ending in a comma splices onto the beat's own colon clause
// ("Here's the other piece, what they are asking is real: the deal has been
// quiet...").
function hasEarlyColon(text) {
  const idx = String(text || "").indexOf(":");
  return idx >= 0 && idx <= 60;
}

// A connector may not echo the idea the beat itself is about to state — the
// concrete failure was "Next, the next step is a one-page memo," the closer
// and the beat's own opening word saying the same thing twice. Compares the
// connector's own keyword phrase (stripped of its trailing punctuation)
// against the beat's leading ~60 characters; a pool entry that would echo is
// excluded for THIS beat before picking, so the line never carries the same
// idea twice. General on purpose — dropping just "Next," from CLOSERS would
// only have fixed the one case the audit happened to catch.
function echoesBeat(connectorText, beatText) {
  const keyword = connectorText.replace(/[.,:]+$/g, "").trim().toLowerCase();
  const lead = String(beatText || "").slice(0, 60).toLowerCase();
  return keyword.length > 0 && lead.includes(keyword);
}

function pickConnector(seed, pool, beatText) {
  const safe = pool.filter((c) => !echoesBeat(c, beatText));
  return pick(seed, safe.length ? safe : pool);
}

// A narrower version of the same "no duplicate lead-in" rule, specific to
// the CLOSER position: a beat that already frames itself as "what happens
// next" ("The next step is...") makes EVERY closer redundant, not just
// "Next," — "Looking ahead, the next step is..." is exactly as repetitive
// as "Next, the next step is...", because the beat is already doing the
// closer's job. echoesBeat (above) only catches a connector whose OWN
// keyword literally recurs in the beat; this catches the beat pre-empting
// the closer's whole idea regardless of which closer word would have been
// picked, so such a beat is spoken as written instead, the same as a
// SELF_OPENING one.
const CLOSER_ECHOING = /^(the\s+)?next\s+steps?\b|^next\b|^going forward\b|^looking ahead\b|^from here\b/i;

// A beat is already written as a complete, capitalized, terminated sentence
// (roleSituationBank.js). Prefixing it with a connector and joining with a
// space would leave the beat's own leading word capitalized mid-sentence
// ("Here's the other piece, The plan is..."), so the leading word is
// lowercased UNLESS it's the pronoun "I" — alone or in a contraction ("I'm",
// "I'll", "I've"), always capitalized in English regardless of position —
// or an all-caps acronym the role's vocabulary depends on reading correctly
// (e.g. "IEP", "MEDDIC"). Both would read as wrong, not merely informal, if
// lowercased.
function lowerLead(text) {
  const t = String(text || "").trim();
  const m = t.match(/^([A-Za-z']+)([\s\S]*)$/);
  if (!m) return t;
  const [, word, rest] = m;
  if (/^I(?:'|$)/.test(word)) return t;
  if (word.length > 1 && word === word.toUpperCase()) return t;
  return word.charAt(0).toLowerCase() + word.slice(1) + rest;
}

function composeLine({ role, situationId, index, total, beatText }) {
  const trimmed = String(beatText || "").trim();
  // The first line is always the beat itself — see the module comment above
  // for why a connector never belongs there.
  if (index === 0) return trimmed;
  if (SELF_OPENING.test(trimmed) || hasEarlyColon(trimmed)) return trimmed;
  const isCloser = index === total - 1;
  if (isCloser && CLOSER_ECHOING.test(trimmed)) return trimmed;
  const seed = `${role}|${situationId}|${index}`;
  const pool = isCloser ? CLOSERS : MIDDLES;
  const connector = pickConnector(seed, pool, trimmed);
  const body = lowerLead(trimmed);
  return `${connector} ${body}`.trim();
}

// Escapes a term for use inside a RegExp. Several vocabulary terms carry
// characters that are literal here but would otherwise need escaping in a
// different context ("P&L", "1:1", "so what") — this keeps every one of
// them safe to interpolate regardless of what it contains.
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Word-start match, case-insensitive. A plain substring check (the previous
// implementation) let "board" match inside "onboarding" and "whiteboard",
// and "scope" inside "telescope" — not cosmetic, since MIN_TERMS_USED on the
// response route is 2, so two such accidents alone could admit a model
// answer with none of the role's real vocabulary in it and then mark both
// accidents "used in this answer".
//
// The boundary is required only at the START of the term, not the end.
// Every decoy above has the term embedded MID-word, preceded by a real word
// character ("on" + "board", "tele" + "scope", "dis" + "engagement") — a
// leading `\b` alone already rejects every one of them. Requiring a
// TRAILING boundary too would reject something real: manager's own
// situation bank uses "backfill" as "...we have not backfilled yet" — a
// genuine inflection of the term, not an accident, and a trailing `\b`
// would refuse to count it. `\b` at the start still matches a term sitting
// directly against punctuation ("(1:1)", "the 1:1.") because a boundary is
// a transition between a word character and a non-word one, not merely
// whitespace.
function termRegex(term) {
  return new RegExp(`\\b${escapeRegExp(term)}`, "i");
}

// Curly/typographic apostrophe variants a model routinely writes, normalized
// to the straight apostrophe every `avoid` phrase in roleRegisters.js is
// authored with. Without this, "it's probably nothing" (straight) never
// matches a model's "it’s probably nothing" (curly) — the exact banned
// sentence passes the guard, and the panel then prints it as the model
// answer with "do not say <that same sentence>" directly beneath it.
function normalizeApostrophes(s) {
  return String(s || "").replace(/[‘’ʼʻ′＇]/g, "'");
}

// The register's own vocabulary array, matched whole-word (see termRegex)
// against the lines' text - the same check used independently by both
// contract tests, so a change here can't drift from what "used" actually
// means to the panel that reports it.
export function termsUsedIn(role, lines) {
  const register = roleRegister(normalizeRole(role));
  const list = Array.isArray(lines) ? lines : [];
  const haystack = list.map((l) => String(l?.text || "")).join(" ");
  return register.vocabulary.filter((v) => termRegex(v.term).test(haystack)).map((v) => v.term);
}

export function avoidHitsIn(role, lines) {
  const register = roleRegister(normalizeRole(role));
  const list = Array.isArray(lines) ? lines : [];
  const haystack = normalizeApostrophes(list.map((l) => String(l?.text || "")).join(" ")).toLowerCase();
  return register.avoid
    .filter((a) => haystack.includes(normalizeApostrophes(a.phrase).toLowerCase()))
    .map((a) => a.phrase);
}

// role, situationId -> a model answer in this role's register. situationPrompt
// is accepted (callers, including the route, pass it through for parity with
// the Gemini path) but isn't needed here: the bank's `beats` — or, when the
// situation isn't in the bank, the register's own `fallbackBeats` — already
// carry the situation's substance, so there's nothing this composer would do
// with the raw prompt text that the beats don't already give it.
//
// `situationMatched` tells the caller whether this answer was actually built
// for the situation on screen (a real bank situation) or is the role's
// generic, situation-agnostic shape (fallbackBeats) — the response route
// (AC-Q8.4's fallback path in particular) needs this to avoid silently
// showing a "slipped deadline" answer under a "two engineers, one
// promotion" scene with no indication anything changed.
export function roleResponseLocal({ role, situationId } = {}) {
  const normalized = normalizeRole(role);
  const register = roleRegister(normalized);
  const sid = situationId ? String(situationId) : "no-situation-id";
  const situation = situationsFor(normalized).find((s) => s.id === sid);
  const beats = situation ? situation.beats : register.fallbackBeats;
  const total = register.beatLabels.length;

  const lines = register.beatLabels.map((label, index) => ({
    label,
    text: composeLine({
      role: normalized,
      situationId: sid,
      index,
      total,
      beatText: beats[index] ?? beats[beats.length - 1] ?? "",
    }),
  }));

  return {
    lines,
    cadence: [...register.cadence],
    terms: [...register.vocabulary],
    termsUsed: termsUsedIn(normalized, lines),
    avoid: [...register.avoid],
    situationMatched: Boolean(situation),
  };
}
