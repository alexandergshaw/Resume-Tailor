// The `applications` array in the `/api/chat` request body, and the
// "--- USER'S APPLICATIONS ---" block the Gemini path (app/api/chat/route.js)
// renders from it. NOT the same thing as `chatbot.js`'s
// `buildApplicationContextString` (see below) or `lib/copilot/answerContext.js`
// — despite the similar name, this file owns only the wire-shaped applications
// array and the bound placed on it before it leaves the client.
//
// Owns: the three caps, the ellipsis-preserving `truncate` primitive, the
// selector that picks which applications the renderer shows, the renderer
// itself, and the client-side projection that bounds the heavy fields of the
// first MAX_APPLICATIONS applications and nulls them past that pick.
//
// Zero imports, by design (verified by the `[src]` sweep in
// applicationContextSourceSweep.test.js): not React, not process.env, not
// localStorage, not next/*, not chatbot.js, not route.js. `chatbot.js` pulls
// "use client" + localStorage transitively via `@/app/settings/engine`, so
// importing it here would poison the route's server bundle; route.js cannot
// be imported from a client bundle at all. A zero-import leaf is the only
// shape that works from both directions. Prior art, deliberately copied:
// lib/experience/attachments.js — "Pure — no Supabase import, no browser
// API — so both the API route and AttachmentPanel.js can call the same logic
// and never disagree about a size cap."
//
// Engine-blind by CONVENTION, not "by construction" — nothing in the language
// stops a future author adding an `engine` parameter to one of these
// functions. The only thing enforcing it is the `[src]` sweep in
// applicationContextSourceSweep.test.js, which greps this file's stripped
// source for `engine` / `wantsEmbedded` / `readEngine`. That matters because a
// client-side engine check reads as `true` where the server's own check reads
// `false`, and the assistant would then answer with less than it should. The
// MECHANISM, stated exactly because the obvious guess is wrong: `wantsEmbedded`
// (lib/llm/featureEngine.js:28) does NOT contain a statically analysable
// `process.env.RESUME_ENGINE` expression — it takes `env = process.env` as a
// DEFAULT PARAMETER and reads `env.RESUME_ENGINE` / `env.Gemini_LLM_API_Key`
// off it. Next's build-time substitution only rewrites literal
// `process.env.X` member expressions, so it cannot fire on a dynamic property
// read; in a browser bundle `process.env` is simply an empty object, every
// read is `undefined`, and `wantsEmbedded` falls all the way through to
// `!hasGeminiKey(env)` — i.e. `true`. Same conclusion, different reason: do
// not "fix" this by adding a NEXT_PUBLIC_ variable and assuming inlining
// solves it.
//
// UNICODE ASSUMPTION, unstated everywhere else and load-bearing: the bound
// below slices by UTF-16 code unit, which can cut a surrogate PAIR in half and
// leave a lone surrogate at the end of the string. That is safe here only
// because `JSON.stringify` is WELL-FORMED (ES2019,
// tc39/proposal-well-formed-stringify): it escapes a lone surrogate as
// `\udXXX` rather than emitting invalid UTF-8, so `.length` survives the wire
// round trip and both sides still agree. Universal across this project's
// supported browsers and Node 22 — but it is precisely what a "cheaper" byte
// slice, a `Buffer`/`TextEncoder` round trip, or a well-meaning
// `.toWellFormed()` tidy-up would break, silently, on exactly the accented
// postings this product sees constantly.
//
// NOT A SECURITY CONTROL. This projection is client-side and ADVISORY: it
// shrinks what the app's own client chooses to send. `app/api/chat/route.js`
// still accepts an `applications` array of any length with no ingest cap, and
// anyone can post whatever they like to that endpoint. What actually bounds
// the prompt on the server is `renderApplicationsSection` below — 25
// applications x 1500/2000 characters — which pre-existed this module and is
// preserved verbatim. Do not delete or weaken that renderer-side cap on the
// grounds that "the client already bounds it".
//
// Why `buildApplicationContextString` (chatbot.js) is NOT moving in here,
// even though the name collision is real and confusing (see below): it
// renders a completely different, RAW Supabase-row shape (`app.positions`,
// `app.generated_resumes`, `s.stage_name`, `s.scheduled_at`,
// `s.interviewer_names`) into `pinnedContext.content`, which is a different
// body field entirely and out of this module's scope. Its output also isn't
// byte-compatible with this module's renderer: its labels differ in
// whitespace ("Job Description:\n…" here vs "  Job Description: …" there)
// and its stage lines are indented differently ("  - " vs two spaces), so
// merging the two would change what either one renders. Its callers
// (TrackingTab.js) also live outside this chunk's file list. So: left alone,
// on purpose, not an oversight.
//
// The silent bare-"…" cut below (`truncate`) is DELIBERATELY preserved, not
// missed. lib/experience/pageContext.js:8-16 names that exact behavior as
// "the actual defect this module exists to prevent" for ITS use case — but
// this module's whole job is to keep the rendered applications block
// byte-identical to what it was before this bound existed, so the cut stays.
// Do not import pageContext.js's machinery here: its output is
// lossy-with-a-notice, which this module's contract forbids.

// The bound is `max + 1` UTF-16 CODE UNITS -- never bytes.
export const MAX_APPLICATIONS = 25;
export const MAX_JD_CHARS = 1500;
export const MAX_TAILORED_CHARS = 2000;

// DEPLOY CONTRACT, not local tunables: ALL THREE constants above are read on
// BOTH sides of the wire now -- chatbot.js's projectApplicationsForRequest
// (via selectRenderedApplications and boundSelected, below) applies them
// before the request ever leaves the client, and route.js's
// renderApplicationsSection (via selectRenderedApplications and truncate,
// below) applies them again on receipt. That only works because both reads
// see the same numbers. The list is three, not two: MAX_APPLICATIONS is on
// this contract as well, and it is the one that fails worst.
//
// RAISING any of them without treating it as a two-sided release is a live
// bug, not a theoretical one. A browser tab still holding the OLD client
// bundle keeps projecting against the OLD numbers:
//
//   * MAX_JD_CHARS / MAX_TAILORED_CHARS -- the old client pre-slices to the
//     OLD `max + 1`. The NEW server's `truncate` then runs on a string
//     already shorter than its NEW, larger `max`, so `value.length > max` is
//     false, no ellipsis is appended, and the string passes through
//     UN-ELLIPSISED. The model reads LESS of the posting or resume than the
//     new server believes it configured.
//
//   * MAX_APPLICATIONS -- worse, and more silent. The old client nulls
//     `jobDescription` and `tailoredResume` for every application past the
//     OLD cap, so raising the cap server-side buys nothing for a stale
//     client while LOOKING like it worked. Old client pinned at 25 against a
//     server raised to 50: 25 whole `Job Description:` lines and 25
//     `Tailored Resume:` lines vanish -- 88,550 characters, which is 45.8%
//     of the intended block on a realistic 50-application fixture and 48.7%
//     on a lean one (see docs/REGRESSION.md R-295 for both fixtures) --
//     while applications 26-50 still render their header, company, role,
//     status and stages. The block therefore looks COMPLETE: every
//     application the new server expected is present, with nothing missing
//     to count, and only the documents are gone. 88,550 is the arithmetic
//     CEILING, not a typical loss: it is
//     25 * ((19 + MAX_JD_CHARS+1 + 1) + (19 + MAX_TAILORED_CHARS+1 + 1)),
//     and it is only reached when all 25 dropped applications carry BOTH an
//     over-cap job description and an over-cap tailored resume.
//
// NO TEST CATCHES ANY OF THIS: a single-tree test imports these constants
// once and applies that one value to both the client-side projection and the
// server-side renderer in the same run, so raising a number moves both sides
// of the test together and the mismatch this module is warning about never
// appears in it. Only a real two-bundle deploy -- an old client JS payload
// still cached in some user's browser while the new server is already live --
// reproduces it.
//
// LOWERING IS NOT UNIFORMLY SAFE. An earlier version of this comment said it
// was; that was wrong for MAX_APPLICATIONS, and the claim is corrected here
// rather than quietly dropped.
//
//   * MAX_JD_CHARS / MAX_TAILORED_CHARS -- lowering these IS safe, and for a
//     specific reason: an old client pre-slices to the LARGER old `max + 1`,
//     so the new server's `truncate` still sees a string over its own,
//     smaller `max`, re-cuts it and appends the ellipsis itself. The server
//     genuinely gets a string it can bound, and the render is correct.
//
//   * MAX_APPLICATIONS -- lowering it has NO such server-side remedy. The
//     client NULLS jobDescription/tailoredResume past its own cap and the
//     server cannot recover a field that never arrived, so the damage is
//     symmetric: the direction that bites is a NEW client against an OLD
//     server, which is exactly the state produced by ROLLING BACK a lowering,
//     or by stale new-bundle tabs still projecting at the lower number after
//     the server has gone back up. Measured, a client projecting at 10
//     against a server rendering at 25: 53,130 characters lost, 58.5% of the
//     block, with all 25 applications still rendering their headers so
//     nothing appears missing.
//
// Whoever changes these numbers must treat it as a two-sided deploy: ship
// the server change, then either cache-bust the client bundle or wait out
// however long old clients can keep running the previous JS before relying
// on the new bound anywhere -- do not assume every in-flight browser tab
// picks up the new value the moment this file's diff lands. For
// MAX_APPLICATIONS treat the ROLLBACK as a two-sided release too. See
// docs/REGRESSION.md R-295 (named explicitly: R-292 is also a deploy-time
// case in this same area, and it is a different one) for the manual check.
//
// The allowlist in projectApplicationsForRequest (bottom of this file) is on
// the same contract as the three numbers, and is equally two-sided: adding a
// field to renderApplicationsSection that the projection's allowlist drops
// produces the identical silent skew with no constant changed at all. Today
// that is live for `stages[].interviewers` and `stages[].notes` -- re-adding
// either to the renderer without also adding it here renders nothing.

// Moved VERBATIM from app/api/chat/route.js. No .trim(), no off-by-one, no
// changed suffix, no defaulted `max` -- every one of those "tidying" changes
// alters what a real, scraped job posting renders as (a posting that ends in
// whitespace at the cut, for instance, would lose that whitespace to a
// well-meaning .trim()).
export function truncate(value, max) {
  if (typeof value !== "string") return "";
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

// The server runs this selector on the PROJECTED array, in which every
// `selected`-tier field (jobDescription, tailoredResume) is null outside the
// client's own pick. So it must be a FIXED POINT: it must choose the same
// positions whether it runs on the raw applications array or the projected
// one. To hold that property it must read only `always`-tier fields --
// `company`, `role`, `status`, `appliedAt`, `applicationUrl`,
// `stages[].{name, type, scheduledAt, outcome}`.
//
// Reading `jobDescription` or `tailoredResume` in ANY way breaks the fixed
// point -- by equality, by ordering, and by TRUTHINESS. It is tempting to
// think a truthiness filter on a `selected`-tier field is safe (an earlier
// draft of this module's design leaned on exactly that argument, citing a
// "monotonicity exception": nulling a field can only remove a candidate that
// was already unpicked). That argument is FALSE for any selector that filters
// and then caps: `slice(0, N)` after a `filter` BACKFILLS -- removing a
// candidate from inside the selected window promotes a later one into it, and
// past position MAX_APPLICATIONS the projection has already nulled the heavy
// fields, so the two sides disagree. The exception only ever held under an
// unstated precondition (the filter removes nothing inside the selected
// window) that a real selector can never promise. "Reads only always-tier
// fields" is both the sufficient condition and, for any selector that caps,
// the necessary one -- do not rely on a truthiness exception for a
// selected-tier field; applicationContext.test.js's [canary] measures this
// failing directly.
//
// Also, and this is TODAY'S RULE rather than a permanent law: the selector is
// a pure function of the applications array alone -- no request-scoped input,
// no user id, no clock, no message text -- and it must not reorder or drop
// what it selects. That is a consequence of where the selector runs today (on
// BOTH sides of the wire, from the same inputs), not a property the design is
// forbidden ever to change. A successor that selects by relevance to the
// user's message is already contemplated in the architecture record; it is not
// ruled out by this paragraph. What such a design MUST do instead is make the
// two sides agree some other way -- run the selection once and put the pick
// itself on the wire, rather than recomputing it server-side from an input the
// server does not have identically. Do not reject a follow-up chunk by quoting
// this paragraph as an absolute; the fixed-point requirement above is the
// invariant, and "reads only always-tier fields" is only today's way of
// meeting it.
export function selectRenderedApplications(applications) {
  return Array.isArray(applications) ? applications.slice(0, MAX_APPLICATIONS) : [];
}

// Moved from app/api/chat/route.js, unchanged apart from using the selector
// above and returning instead of pushing onto a shared `parts` array.
//
// Byte-identity trap, stated because it is easy to "improve" away: today the
// section is produced whenever `Array.isArray(applications) &&
// applications.length > 0` -- EVEN when every entry renders to nothing but
// "Application 1:". A guard like `if (rendered.length === 0) return null`, or
// filtering out empty entries, changes the model's input on that fixture.
// Byte identity forbids it.
//
// Second trap: the junk tolerance below (`app.company` truthiness,
// `Array.isArray(app.stages)`, `.filter(Boolean)` on stage strings) moved
// VERBATIM from route.js. Moving code that tolerates junk is safe; hardening
// it while moving it is not -- a new guard changes output.
export function renderApplicationsSection(applications) {
  if (!Array.isArray(applications) || applications.length === 0) return null;

  const limited = selectRenderedApplications(applications);
  const rendered = limited.map((app, idx) => {
    const lines = [];
    lines.push(`Application ${idx + 1}:`);
    if (app.company) lines.push(`  Company: ${app.company}`);
    if (app.role) lines.push(`  Role: ${app.role}`);
    if (app.status) lines.push(`  Status: ${app.status}`);
    if (app.appliedAt) lines.push(`  Applied: ${app.appliedAt}`);
    if (app.applicationUrl) lines.push(`  URL: ${app.applicationUrl}`);
    if (app.jobDescription) {
      lines.push(`  Job Description: ${truncate(app.jobDescription, MAX_JD_CHARS)}`);
    }
    if (app.tailoredResume) {
      lines.push(`  Tailored Resume: ${truncate(app.tailoredResume, MAX_TAILORED_CHARS)}`);
    }
    if (Array.isArray(app.stages) && app.stages.length > 0) {
      const stageStrs = app.stages
        .map((s) => {
          const bits = [];
          if (s.name) bits.push(s.name);
          else if (s.type) bits.push(s.type);
          if (s.scheduledAt) bits.push(`@ ${s.scheduledAt}`);
          if (s.outcome && s.outcome !== "pending") bits.push(`(${s.outcome})`);
          return bits.join(" ");
        })
        .filter(Boolean);
      if (stageStrs.length > 0) {
        lines.push(`  Interview Stages: ${stageStrs.join("; ")}`);
      }
    }
    return lines.join("\n");
  });

  return `--- USER'S APPLICATIONS ---\n${rendered.join("\n\n")}`;
}

// The bound is `max + 1` UTF-16 CODE UNITS -- never bytes.
//   * `max + 1`, because truncate() above appends "…" only when
//     `value.length > max`. Pre-slicing to exactly `max` would produce a
//     block that differs from today's by one character and loses the
//     ellipsis.
//   * code units, because `.length` is what truncate() compares. A byte
//     bound on a real resume line ("Résumé — led "growth" • €1.2M ARR ·
//     naïve café") keeps far fewer of its characters than a code-unit bound
//     does and drops the ellipsis, while being indistinguishable from a
//     correct bound on an ASCII-only fixture. lib/chat/chatbot.js's own
//     byte-budget math (the MAX_REQUEST_BYTES / CHAT_BODY_OVERHEAD_BYTES
//     constants) is right to use bytes for ITS question -- what a string
//     costs on the wire -- but that reasoning does not carry over here; this
//     is a different question (how much of the text truncate() will keep).
//
// A truthy NON-STRING value (a number, an object) normalizes to `null` here
// rather than passing through. This is a DELIBERATE, NAMED EXCEPTION to this
// module's own losslessness law: `renderApplicationsSection` (above) emits an
// empty labelled line ("  Job Description: ") for that shape, because
// `truncate` returns "" for a non-string while the `if (app.jobDescription)`
// guard above it only tests truthiness -- so the projected render (which
// drops the line entirely) is NOT byte-identical to the unprojected render
// for that one malformed shape. Bounding wins over losslessness here: the
// alternative is letting an arbitrarily large, non-string value ride through
// this function untouched, which defeats the entire reason this module
// exists. The shape is not reachable from the real data path today --
// `chatbot.js` builds `jobDescription: pos.description || null` from a
// Supabase TEXT column, which is always a string or null/undefined, never a
// truthy non-string -- so this exception has no live consequence, but it is
// still a real deviation and it is written down here rather than left as an
// unstated precondition for someone to discover the hard way. (The other
// heavy field is covered the same way: `tailoredResume: resume?.content ||
// null` comes from `generated_resumes`, whose only writer is
// lib/supabase/saveGeneratedResume.js -- its JSDoc declares `content: string`
// and it refuses falsy values.)
function boundSelected(value, max) {
  return typeof value === "string" ? value.slice(0, max + 1) : null;
}

// The allowlist and the bound. Runs on the wire-shaped applications array
// (the output of chatbot.js's own raw-Supabase-row map) and returns a NEW
// array of NEW objects -- the caller's input is never mutated.
//
// `heavy` is a Set of object REFERENCES, populated from
// `selectRenderedApplications`'s output. Reference-membership note: if the
// same object appears at two positions in the applications array, BOTH
// positions get the heavy fields even though the renderer only ever shows the
// first. That is extra data on the wire, never loss -- one-way safe -- and
// worth stating so nobody "fixes" it into an index lookup, which has the same
// degenerate case in the other, UNSAFE direction (an index-based check could
// leave the position the renderer actually shows unbounded, or null the one
// it doesn't).
//
// Contract regardless of input: non-array applications -> []; non-array
// `stages` -> []; every field defaults to `?? null`; never throws.
export function projectApplicationsForRequest(applications) {
  const list = Array.isArray(applications) ? applications : [];
  const heavy = new Set(selectRenderedApplications(list));
  return list.map((app) => {
    // THIRD undeclared deviation from byte-identical rendering (the header
    // above names only two -- the boundSelected non-string exception and the
    // selector's selected-tier read restriction): a `null` (or otherwise
    // falsy, e.g. `undefined`) ENTRY inside the `applications` array itself --
    // not a null FIELD, the whole application slot. Before this projection
    // sat in front of route.js, the pre-change server code read `app.company`
    // straight off whatever array the request body carried; a `null` entry
    // there threw a TypeError, which surfaced as a 500 and, to the user, as
    // "couldn't reach the assistant." `const a = app || {}` here normalizes
    // that slot to an empty object before renderApplicationsSection ever sees
    // it (renderApplicationsSection itself still does the truthiness-only
    // `app.company` check, unchanged, per the byte-identity trap documented
    // above it) -- so today a `null` entry renders as a bare "Application N:"
    // line with nothing under it, and the request succeeds. That is strictly
    // BETTER than throwing, but it is NOT byte-identical to the pre-change
    // behavior (a 200 where there used to be a 500), which is exactly the
    // kind of change this module's own losslessness law exists to flag -- so
    // it is written down here rather than left as an unstated precondition.
    // It has no live consequence today: chatbot.js's own map over Supabase
    // rows (its only real caller) always produces an object literal for
    // every row, never `null` or `undefined`, so this path is unreachable
    // from the app's current client -- but this exported function has no way
    // to enforce that on a future caller.
    const a = app || {};
    const stages = Array.isArray(a.stages) ? a.stages : [];
    const isHeavy = heavy.has(app);
    return {
      // --- always tier: read by the embedded engine for EVERY application,
      //     or readable by the selector. Never bounded, never dropped.
      company: a.company ?? null,
      role: a.role ?? null,
      status: a.status ?? null,
      appliedAt: a.appliedAt ?? null,
      applicationUrl: a.applicationUrl ?? null,
      // --- selected tier: read only by the Gemini renderer, only for the
      //     applications selectRenderedApplications picks.
      jobDescription: isHeavy ? boundSelected(a.jobDescription, MAX_JD_CHARS) : null,
      tailoredResume: isHeavy ? boundSelected(a.tailoredResume, MAX_TAILORED_CHARS) : null,
      stages: stages.map((s) => ({
        name: s?.name ?? null,
        type: s?.type ?? null,
        scheduledAt: s?.scheduledAt ?? null,
        outcome: s?.outcome ?? null,
        // interviewers / notes: NOT allowlisted. Read by neither consumer --
        // route.js's renderer reads name/type/scheduledAt/outcome,
        // localAssistant.js reads scheduledAt/name/type -- and notes is the
        // last unbounded per-application free text, so both are pure waste
        // on the wire.
      })),
    };
  });
}
