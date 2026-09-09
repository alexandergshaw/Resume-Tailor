// WHAT A CHAT TURN COST -- the first token accounting anywhere in this repo.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
// Grepped at HEAD 9c27a63: `usageMetadata` had ZERO occurrences outside
// node_modules. Every model call in this app -- chat, tailoring, the interview
// copilot -- threw its usage numbers away, so nobody could say what any of them
// cost, and every argument about the size of the /api/chat request was an
// argument about a number nobody had. This module is the instrument that makes
// those arguments measurable. It is deliberately the FIRST thing landed in this
// area: the other two findings in the chat path (the applications block that is
// 94% of a constant re-sent context, and the .docx re-parsed on every send) are
// both claims about cost, and a claim about cost with no meter behind it is a
// hunch.
//
// ---------------------------------------------------------------------------
// THE ONE RULE
// ---------------------------------------------------------------------------
// A FAILED INSTRUMENT IS INVALID, NEVER ITS ZERO VALUE.
//
// The tempting shape here is `promptTokenCount: usage?.promptTokenCount ?? 0`.
// That is the single most expensive way this module could be wrong: a response
// that carried no usage metadata at all -- an SDK version that stops sending
// it, a provider outage, a shape change, or simply the `{ text: "ok" }` fake
// every test in this repo mocks -- would then read as "this turn cost 0
// tokens", which is a number a developer WILL believe and act on. So:
//
//   * no usable metadata at all           -> the whole record is `null`
//   * a field the provider did not send   -> that field is `null`
//   * a field the provider sent as 0      -> that field is `0`
//
// The third case is not a detail. `cachedContentTokenCount: 0` is the provider
// saying "nothing was served from cache", which is exactly the measurement a
// prompt-caching change would need; collapsing it into the null case would
// destroy the evidence for the next fix in this area.
//
// ---------------------------------------------------------------------------
// ENGINE-BLIND, IMPORT-FREE
// ---------------------------------------------------------------------------
// Zero imports, like lib/chat/applicationContext.js next door and for the same
// reason: this is read from a server route today, and a client-side consumer
// (a debug panel, a future feature log) must be able to import it without
// dragging `process.env`, `localStorage` or `next/*` into a bundle that cannot
// take them. Nothing here touches the network, the clock or a global.
//
// ---------------------------------------------------------------------------
// WHY NOT THE ACTIVITY LOG
// ---------------------------------------------------------------------------
// lib/activityLog/ is this repo's app-wide session ledger and would be the
// obvious home -- except that its own registry
// (lib/activityLog/activityChannels.js, UNCAPTURED_SURFACES "server") states,
// in prose printed into the file the user downloads, that "an API route
// contributes its request and its response status and nothing else. What the
// route did in between -- which model it called, which rows it read -- is not
// visible from here and is not in this file." Token counts are precisely "what
// the route did in between". Folding them in without rewriting that paragraph
// would make a sentence in a downloadable artifact false, and
// activityCoverage.sweep.test.js exists to stop exactly that kind of drift. So
// the readout stays on the server side of the boundary the registry draws --
// the route's own log line -- plus the response body, which is the route's
// response and therefore already inside what a browser is allowed to know.

// Every token field @google/genai's `GenerateContentResponseUsageMetadata` can
// report (node_modules/@google/genai/dist/genai.d.ts). Order is the reading
// order of the record and of the log line: what went in, what of it was cached,
// what came out, then the total.
//
// Deliberately NOT exported. It is the record's key order, and
// usageAccounting.test.js reads it back off `Object.keys(readUsageTokens(...))`
// -- i.e. off the real output rather than off the constant that produced it, so
// a field that stops being read fails the test instead of quietly agreeing with
// itself. Exporting it would also add an export whose only consumer is a test,
// which lib/sourceScan/exportReachability.sweep.test.js tracks by exact count.
const USAGE_TOKEN_FIELDS = [
  "promptTokenCount",
  "cachedContentTokenCount",
  "candidatesTokenCount",
  "thoughtsTokenCount",
  "toolUsePromptTokenCount",
  "totalTokenCount",
];

// A token count is a non-negative integer. A string ("1200"), a NaN, an
// Infinity or a negative is a BROKEN reading, not a small one -- it becomes
// `null` rather than being coerced into a number a reader would trust.
function readCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Normalize a provider response's usage metadata.
 *
 * @returns a record keyed by USAGE_TOKEN_FIELDS whose values are non-negative
 *   integers or `null`, or `null` when the response carried no usable count at
 *   all. Never throws, whatever it is handed -- an accounting failure must not
 *   be able to fail the chat request it is accounting for.
 */
export function readUsageTokens(response) {
  let usage;
  try {
    usage = response?.usageMetadata;
  } catch {
    // A getter that throws. Nothing was measured.
    return null;
  }
  if (!usage || typeof usage !== "object") return null;

  const record = {};
  let sawOne = false;
  for (const field of USAGE_TOKEN_FIELDS) {
    let raw;
    try {
      raw = usage[field];
    } catch {
      raw = undefined;
    }
    const count = readCount(raw);
    if (count !== null) sawOne = true;
    record[field] = count;
  }
  // Present but empty is still a failed reading: six nulls would let a caller
  // render six zeroes.
  return sawOne ? record : null;
}

/**
 * Summarize the per-section sizes of the context block re-sent on every turn.
 *
 * `sections` is `[{ id, chars }]` in render order -- built by the caller as it
 * assembles the block, so this measures what was ACTUALLY sent rather than a
 * second render of it (a re-render is a different string the moment anyone
 * changes a cap).
 *
 * A total alone cannot start an argument about what to cut, so this also names
 * the dominant section and its share. `largest` is `null` for an empty context
 * because there is no section to name -- and an empty context really is zero
 * characters, which is why `totalChars: 0` here is a measurement rather than a
 * failed one. Never throws.
 */
export function summarizeContextChars(sections) {
  const bySection = {};
  let totalChars = 0;
  const list = Array.isArray(sections) ? sections : [];
  for (const section of list) {
    const id = section && typeof section.id === "string" ? section.id : "";
    const chars = section ? readCount(section.chars) : null;
    if (!id || chars === null) continue;
    bySection[id] = (bySection[id] || 0) + chars;
    totalChars += chars;
  }

  let largest = null;
  for (const [id, chars] of Object.entries(bySection)) {
    if (!largest || chars > largest.chars) largest = { id, chars, pct: 0 };
  }
  if (largest && totalChars > 0) {
    largest.pct = Math.round((largest.chars / totalChars) * 1000) / 10;
  }

  return { totalChars, bySection, largest };
}

// `n/a`, never `0`: see THE ONE RULE above.
function num(value) {
  return value === null || value === undefined ? "n/a" : String(value);
}

/**
 * The single line a developer reads in the server log. One line, no newlines,
 * `key=value` throughout, so it survives a log aggregator that splits on
 * newlines and stays greppable (`grep '\[chat\] usage'`).
 *
 * When `tokens` is null the line says `tokens=unavailable` and prints NO token
 * key at all -- not `prompt=0`, not `prompt=n/a`. A reader scanning for
 * `prompt=` finds nothing, which is the honest answer, rather than a number to
 * misread. The context measurement is ours and did not fail, so it is still
 * printed alongside.
 */
export function formatUsageLogLine({ model, tokens, context, transcriptChars } = {}) {
  const bits = [`model=${model || "unknown"}`];

  if (tokens) {
    bits.push(
      `prompt=${num(tokens.promptTokenCount)}`,
      `cached=${num(tokens.cachedContentTokenCount)}`,
      `output=${num(tokens.candidatesTokenCount)}`,
      `thoughts=${num(tokens.thoughtsTokenCount)}`,
      `total=${num(tokens.totalTokenCount)}`,
    );
  } else {
    bits.push("tokens=unavailable");
  }

  const summary = context && typeof context === "object" ? context : summarizeContextChars([]);
  bits.push(`contextChars=${summary.totalChars ?? 0}`);
  bits.push(`transcriptChars=${readCount(transcriptChars) ?? 0}`);
  for (const [id, chars] of Object.entries(summary.bySection || {})) bits.push(`${id}=${chars}`);
  if (summary.largest) bits.push(`largest=${summary.largest.id}@${summary.largest.pct}%`);

  return `[chat] usage ${bits.join(" ")}`.replace(/[\r\n]+/g, " ");
}
