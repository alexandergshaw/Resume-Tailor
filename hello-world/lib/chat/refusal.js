// Refusal message vocabulary, extracted verbatim from lib/chat/chatbot.js
// (lib/chat/chatbot.refusal.test.js's "lib/chat's line budget: the ceiling
// A2's module headers cite" forbids trimming comments to make room, so this
// self-contained block -- closing over nothing in createChatHandlers --
// moved here instead). chatbot.js re-exports every one of these names so its
// existing import surface, and every test written against it, is unchanged.

// From lib/chat/chatLimits.js, NOT from chatbot.js: importing it back from
// chatbot.js (which imports this file) was a real import cycle whose only
// safety was that nothing here reads the constant at module-evaluation time.
// See chatLimits.js's own comment for what breaks the day that stops being
// true -- silently, with no test and no lint rule to catch it.
import { MAX_REQUEST_BYTES } from "@/lib/chat/chatLimits";

// A2: the refusal is no longer one of two constants picked by "is the tray
// empty" -- it is one of five, picked by which BODY SECTION is measurably the
// largest contributor to the oversized request, plus a sixth (see
// TOO_BIG_MULTIPLE_MESSAGE below) for the case where no single removal would
// even help. Each of the five below is deliberately byte-identical in shape:
// the lead clause, then an em-dash clause naming the cause, then either a
// real in-panel control (AC-27) or an honest "nothing in this panel can help"
// (AC-28) -- never both, and never invented advice.
//
// TOO_BIG_ATTACHMENTS_MESSAGE is byte-identical to the OLD TOO_BIG_MESSAGE
// this replaces (R-289/R-290 depend on that wording surviving untouched).
export const TOO_BIG_ATTACHMENTS_MESSAGE =
  `That message is too large to send (the platform limit is 4.5 MB total). ` +
  `Remove an attachment, or attach a smaller file, and try again.`;
export const TOO_BIG_PINNED_CONTEXT_MESSAGE =
  `That message is too large to send (the platform limit is 4.5 MB total) — ` +
  `most of it is the pinned context shown at the top of this panel. Remove it ` +
  `with the ✕ next to “Context”, then send again.`;
// The second half (Clear also empties the attachment tray) is deliberate,
// not padding: without it, appending AC-29's secondary would tell the user to
// remove ONE attachment in a message whose primary action removes ALL of
// them (the Clear control's `onClick` (ChatPanel.js), which empties
// chatAttachedFiles alongside chatMessages).
export const TOO_BIG_TRANSCRIPT_MESSAGE =
  `That message is too large to send (the platform limit is 4.5 MB total) — ` +
  `most of it is this conversation. Press Clear at the top of the panel to ` +
  `start a fresh thread; that also empties the attachment tray.`;
// AC-28: names NO in-panel control, on purpose -- nothing in this panel can
// shrink either resumeText or the applications history. Naming a control here
// would reintroduce exactly the impossible-advice defect AC-26 removes.
export const TOO_BIG_RESUME_MESSAGE =
  `That message is too large to send (the platform limit is 4.5 MB total) — ` +
  `most of it is your uploaded resume. Nothing in this panel can shrink it; ` +
  `uploading a shorter resume is what reduces it.`;
// M4: "remove an attachment" is impossible advice when nothing is attached,
// and asking the user to narrow their QUESTION is impossible advice always --
// `applicationsContext` (below) is now BOUNDED by projectApplicationsForRequest
// -- it no longer serializes every tracked application's full jobDescription
// and tailoredResume -- but it still carries EVERY tracked application, so a
// long enough history can still cross the cap with an empty tray, and nothing
// about the QUESTION the user typed ever affects that. This constant names the
// real cause and the real (out-of-panel) remedy instead. (Scale, so nobody
// reads this as dead code: the unbounded shape crossed the cap at roughly 200
// applications; the bounded one needs order 10^4. See docs/REGRESSION.md
// R-293.)
export const TOO_BIG_APPLICATIONS_MESSAGE =
  `That message is too large to send (the platform limit is 4.5 MB total) — ` +
  `most of it is your saved application history, which every message carries. ` +
  `Nothing in this panel can shrink it; removing applications you no longer ` +
  `track is what reduces it.`;
// AC-56: readChatResponse's 413 handling has two very different sources for
// this same "applications" cause. The gate above (refusalMessageFor) has the
// whole payload -- it serialized all five sections and MEASURED that
// applications was the largest, so TOO_BIG_APPLICATIONS_MESSAGE's flat claim
// ("most of it IS...") is earned. readChatResponse's own fallback branch
// (chatbot.js, inside readChatResponse) has no body at all: the platform
// rejected the request before our code ever ran, so all it knows is the
// status (413) and whether the tray was empty. Reusing the flat constant
// there would assert a cause nobody measured -- and AC-55 already concedes
// our count and the platform's can legitimately disagree. This constant is a
// DISTINCT export (never an alias -- see the AC-56 identity test) carrying
// the same shared lead clause and the same remedy, hedged to what this path
// actually knows: "most likely", not "most of it is".
export const TOO_BIG_APPLICATIONS_UNMEASURED_MESSAGE =
  `That message is too large to send (the platform limit is 4.5 MB total) — ` +
  `most likely it is your saved application history, which every message ` +
  `carries, though we couldn't measure this one to be sure. Nothing in this ` +
  `panel can shrink it; removing applications you no longer track is what ` +
  `reduces it.`;
// AC-29: appended to whichever primary above is NOT the attachments one, only
// when the tray is non-empty -- the attachments state already says "remove an
// attachment" once, and appending would say it twice (and AC-52's template
// already names attachments among several things to reduce, so it never gets
// this either).
export const TOO_BIG_ATTACHMENT_SECONDARY = ` You can also remove an attachment and try again.`;
// AC-52: when NO single section's removal would bring the body under the cap
// -- i.e. even after removing the largest, the rest alone still exceeds it --
// naming one control as "the fix" is false, so this replaces the whole
// five-way selection with an honest statement naming several things at once.
// A TEMPLATE over one numeric slot (not a bare string) so it stays
// identity-checkable as `TOO_BIG_MULTIPLE_MESSAGE(measured)`. The single
// interpolation follows the in-file precedent already established at the
// measured-figure refusals inside `addChatAttachments` (chatbot.js), which
// already interpolate `${totalMB}`.
export function TOO_BIG_MULTIPLE_MESSAGE(totalMB) {
  return (
    `That message is too large to send (the platform limit is 4.5 MB total) — ` +
    `it is ${totalMB} MB, and no single thing you can remove brings it under. ` +
    `Reduce more than one: the conversation, the pinned context, your ` +
    `attachments, or your uploaded resume.`
  );
}
// The five wire-body sections a refusal can be attributed to, in a FIXED,
// EXPORTED order so a tie is resolved deterministically (AC-25) rather than by
// object key iteration, which is not a contract. The ARRANGEMENT is load
// bearing, not just the membership: the three sections with a real in-panel
// control (AC-27) sort before the two with none (AC-28), so a tie between an
// actionable section and a dead-end one always favors telling the user about
// the control sitting in front of them.
export const BODY_SECTION_ORDER = [
  "attachedFiles",
  "pinnedContext",
  "messages",
  "resumeText",
  "applications",
];

// The AC-25 mapping in one object, so swapping two entries is a one-line
// mutation that must turn a test red.
export const REFUSAL_MESSAGES = {
  attachedFiles: TOO_BIG_ATTACHMENTS_MESSAGE,
  pinnedContext: TOO_BIG_PINNED_CONTEXT_MESSAGE,
  messages: TOO_BIG_TRANSCRIPT_MESSAGE,
  resumeText: TOO_BIG_RESUME_MESSAGE,
  applications: TOO_BIG_APPLICATIONS_MESSAGE,
};

// §3.2: measures the SERIALIZED form of each section, because that is what
// costs wire bytes -- not the tray/state shape it was built from, which can
// carry fields (previewUrl, unbounded jobDescription) that never go on the
// wire at all. `payload` must be the exact object runChatRequest serializes.
export function measureBodySections(payload) {
  const sizes = {};
  for (const key of BODY_SECTION_ORDER) {
    const value = payload ? payload[key] : undefined;
    sizes[key] = value == null ? 0 : new TextEncoder().encode(JSON.stringify(value)).length;
  }
  return sizes;
}

// M-9: initialise the winner to BODY_SECTION_ORDER[0], NOT null. With `null`,
// an all-zero `sizes` would yield `REFUSAL_MESSAGES[null] === undefined` ->
// `throw new Error(undefined)` -> `setChatError("undefined")`, and
// buildRefusal's `try` would not catch it because nothing throws. Unreachable
// in practice (every large body field is one of these five sections), but the
// initial value makes it structurally impossible rather than merely unlikely.
// Strict `>` (never `>=`) so the FIRST section in BODY_SECTION_ORDER wins any
// tie, which is what makes the selection deterministic.
export function largestBodyContributor(sizes) {
  let winner = BODY_SECTION_ORDER[0];
  let winnerSize = (sizes && sizes[winner]) || 0;
  for (let i = 1; i < BODY_SECTION_ORDER.length; i++) {
    const key = BODY_SECTION_ORDER[i];
    const size = (sizes && sizes[key]) || 0;
    if (size > winnerSize) {
      winner = key;
      winnerSize = size;
    }
  }
  return winner;
}

// AC-52 first: if removing even the single largest section would not bring
// the body under the cap, no one control is "the fix" -- name several at
// once instead, and skip AC-29's secondary entirely (it would contradict "no
// single thing you can remove brings it under"). Otherwise, the AC-25
// identity: the primary is REFUSAL_MESSAGES[largest], plus AC-29's secondary
// exactly when the tray is non-empty and attachments were not already the
// named cause.
//
// `overOurCap` (default true, so every existing caller and every test that
// passes an over-cap `totalBytes` behaves exactly as before) says whether
// `totalBytes` is known to EXCEED MAX_REQUEST_BYTES. It is true for the
// pre-fetch gate and false for readChatResponse's 413 path, where the body
// measured UNDER our cap and the platform refused it regardless -- see the
// secondary's own comment below for why that distinction is the difference
// between a real check and a vacuous one.
export function refusalMessageFor(sizes, { hasAttachments, totalBytes, overOurCap = true } = {}) {
  const largest = largestBodyContributor(sizes);
  const largestSize = (sizes && sizes[largest]) || 0;
  if ((totalBytes || 0) - largestSize > MAX_REQUEST_BYTES) {
    return TOO_BIG_MULTIPLE_MESSAGE(((totalBytes || 0) / 1_000_000).toFixed(1));
  }
  const primary = REFUSAL_MESSAGES[largest];
  // BUG-2 guard: "hasAttachments && largest !== attachedFiles" is NOT enough
  // on its own -- it says a tray exists and isn't already the named cause,
  // but never checks that emptying the WHOLE tray would actually bring the
  // body under the cap. Without this second check, a resume/messages/pinned
  // refusal with a small-but-nonzero tray tells the user to "remove an
  // attachment" even when totalBytes - sizes.attachedFiles is STILL over
  // MAX_REQUEST_BYTES: they delete the attachment they wanted to ask about,
  // press Send, and get the identical refusal. That is the exact
  // impossible-advice class this whole vocabulary exists to remove (AC-26),
  // reintroduced through the secondary clause -- so the secondary is gated on
  // proof that removing the tray is a real fix, not merely that a tray exists.
  //
  // ...AND THAT PROOF ONLY EXISTS ON ONE OF THE TWO EMITTERS. The check reads
  // "would the body fit under MAX_REQUEST_BYTES once the tray is gone", which
  // is a real question only when the body is over MAX_REQUEST_BYTES to begin
  // with -- the pre-fetch gate. On readChatResponse's 413 path, `totalBytes
  // <= MAX_REQUEST_BYTES` is a PRECONDITION of having reached `fetch` at all,
  // so `totalBytes - attachedBytes <= MAX_REQUEST_BYTES` is unconditionally
  // true and the guard silently degrades to the exact two-clause form the
  // comment above calls "NOT enough".
  //
  // The honest resolution is to withhold the secondary on that path, not to
  // invent a threshold for it: the platform refused a body our own count says
  // fits, so its real ceiling is a number we do not have, and "removing an
  // attachment will bring you under it" is precisely the unprovable promise
  // AC-26 exists to delete. Same reasoning as AC-56's hedged constant --
  // where the measurement is absent, the claim goes with it. The PRIMARY is
  // unaffected: which section is largest is a fact about the body we did
  // measure, and both emitters still name it (AC-53).
  const attachedBytes = (sizes && sizes.attachedFiles) || 0;
  if (
    hasAttachments &&
    largest !== "attachedFiles" &&
    overOurCap &&
    (totalBytes || 0) - attachedBytes <= MAX_REQUEST_BYTES
  ) {
    return primary + TOO_BIG_ATTACHMENT_SECONDARY;
  }
  return primary;
}
