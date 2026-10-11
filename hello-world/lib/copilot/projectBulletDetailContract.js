// THE SHARED CONTRACT for the per-bullet "More detail" of an invented example
// project (the two rows under a drafted answer).
//
// One bullet, opened on demand into a few sentences that elaborate it. This
// module owns the things both sides of that wire have to agree on -- the key a
// detail is stored and looked up under, and the longest title and bullet the
// detail route will accept -- so the client's store and the server's validation
// cannot drift apart. Everything here is PURE: no React, no network, no storage,
// no `app/` import. Mirrors techTermDetailContract.js.

import { normalizeQuestion } from "./questions.js";

// A pool bullet is at most fifteen words (projectExampleGen's own cap), so 200
// characters is generous headroom; anything longer is not a bullet the generator
// wrote and the route refuses it.
export const PROJECT_BULLET_MAX_CHARS = 200;
export const PROJECT_TITLE_MAX_CHARS = 160;

// How many sibling bullets travel with a request, as context for the elaboration.
// A local copy of the generator's own bullet cap, deliberately not imported from
// it: this module stays pure and the route does not pull the generator in.
export const PROJECT_SIBLINGS_MAX = 3;

// The longest reader-typed steering note a regenerate request may carry. One
// home for the bound: the route refuses anything longer and the prompt builder
// slices to it, both importing it from here.
export const MAX_USER_CONTEXT_CHARS = 600;

function text(value) {
  return typeof value === "string" ? normalizeQuestion(value) : "";
}

/**
 * The one key a detail record is stored and looked up under.
 *
 * AN EXAMPLE-PROJECT ENTRY CARRIES NO ID AND NO VERSION, so the key is derived
 * from its CONTENT. That is the generation guard: it carries the normalised
 * question, the project title, the competency, the bullet's index AND its text,
 * so a regenerated pool whose bullet at this index changed computes a different
 * key, and a detail written for the old bullet is simply never read. Without the
 * bullet text in the key a stale elaboration would be served for a bullet that is
 * no longer on screen. No cancellation, no token, no bookkeeping.
 *
 * `engine` is optional and defaults to empty. It is in the key so a record
 * written under one engine is never served under another.
 *
 * A `bulletIndex` that is not a non-negative integer folds to -1, so a caller bug
 * produces a DIFFERENT key rather than silently keying as bullet 0.
 *
 * Total by construction: never throws, always returns a string.
 */
export function projectBulletDetailKey({
  question,
  title,
  competency,
  bullet,
  bulletIndex,
  applicationId,
  engine,
} = {}) {
  return [
    text(question),
    text(title),
    text(competency),
    String(Number.isInteger(bulletIndex) && bulletIndex >= 0 ? bulletIndex : -1),
    text(bullet),
    typeof applicationId === "string" ? applicationId.trim() : "",
    typeof engine === "string" ? engine.trim() : "",
  ].join("::");
}
