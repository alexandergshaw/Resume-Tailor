// FROZEN BYTE COPY of app/components/tracking/PrepPackPanel.js as it shipped
// at commit 8519fa4 (sha256 80E156D6...5569C39). It is the "last shipped
// panel" oracle for row F-A of PrepPackPanel.n49Frame.test.js, which owns the
// full reasoning: why a copy beats a snapshot string, what was verified about
// it before use, and what to do when F-A goes red (never: edit this file).
// The ONLY lines that differ from the original are this header and the three
// relative imports (./PrepSectionActions, ./PrepPackNamesStrip,
// ./prepPackFields), rewritten to "@/app/components/tracking/..." because
// this file sits one tree over. They resolve to the SAME modules the live
// panel imports. DO NOT EDIT TO MAKE A TEST PASS.
"use client";

// N25's read surface for an interview prep pack, plus N33's names strip.
// This is a PURE, already-fed renderer (design-reconciled.r2.md ss5.3): it
// imports NONE of prepStore.js/prepParse.js/prepPack.js/trustedNames.js, so
// the given-name lexicon those files carry at module scope never reaches a
// client bundle through this component. Every prop below is exactly the
// shape the server-only GET route documents: `{pack, status,
// completeSections, attemptsExhausted, candidateName, interviewerNames,
// error}`, plus `onDownloadLog` for the feature-log control (AC-N33.21).
//
// AC-N33.13's own bar: every reachable `status` value
// (absent/running/ready/partial/failed/unavailable) renders visibly
// different text, and a `partial` pack renders ONLY the sections named in
// `completeSections` -- never a section the pack object happens to carry
// content for but that `completeSections` does not list (the same
// authoritative source `readPrepPack`/`prepPack.js`'s own `completeSections`
// already computes; this component never re-derives it).
//
// AC-N33.15: a legacy (pre-N16) pack -- top-level `tellMeAboutYourself`/
// `whyThisPosition`/`questionsToAsk`, no `sections.aboutYou` etc. -- is read
// defensively (never thrown on) and only ever shows what `completeSections`
// says survived (in practice, just `stages`, since only `extractStageList`'s
// own back-compat limb recovers anything from that shape). The orphaned
// top-level keys are never read here.
//
// AC-N33.16: the partial-pack copy below never says WHY a section is
// missing ("refused" vs "gutted" vs "little to research") -- it only
// discloses THAT the pack is incomplete and offers a way to try again.
//
// F-1's fix (chunk N33/N25 blocker): the names strip below now carries the
// actual entry surface AC-N33.20 requires -- an inline "Edit"/"Add" toggle,
// local component state only until Save, reusing the exact
// `split(",").map(trim).filter(Boolean)` comma-field shape
// `useApplicationDialogs.js:189-197` already ships for
// `interview_stages.interviewer_names` (design-experience.r1.md ss1.1/DX-
// N33.5), rather than inventing a chip-editor (none exists anywhere in this
// repo, per that document's own search). One shared edit region for both
// fields, one "Save" -- not the two-independent-Save mockup in design-
// experience.r1.md ss1.1 -- deliberately: the PUT route
// (trustedNames.js's buildTrustedNamesPayload) diffs each field
// independently against whatever the CURRENT request body carries, so a
// save that submitted only the just-edited field would read the OTHER
// field's absence as "clear it" and silently wipe it (this is F-7, a
// disclosed, separate finding this component does not attempt to fix at
// the route level -- but a single combined Save that always submits BOTH
// fields' current values, edited or not, sidesteps it by construction, at
// this call site, without touching the route's own contract).
//
// N50: the hierarchy restructure. Each of the four sections is now ONE
// `role="group"` (AC-N50.7) wrapping its `Section` heading/body plus its own
// `PrepSectionActions` (S1 moved that component, and its version-history
// disclosure, into ./PrepSectionActions.js so this file had room). Sections
// render in the interview's own order -- aboutYou, whyRole, stages, askThem
// (AC-N50.6) -- and the names strip and the whole-pack generate/download row
// moved below all four groups so a pack, once it exists, opens on the pack
// (AC-N50.1). In the absent state the names strip still precedes the
// generate control (owner Ruling 2, plan.r2.md section 0.3): a candidate
// names their interviewers before spending a generation, not after.

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import { TOUCH_TARGET_SX, WRAP_ROW_SX, BREAK_LONG_WORDS_SX } from "@/app/theme/mobileSx";
import PrepSectionActions from "@/app/components/tracking/PrepSectionActions";
import NamesStrip from "@/app/components/tracking/PrepPackNamesStrip";
import { resolveSupport, numberResolved, sourcedOrphanVariant } from "@/lib/interviewPrep/prepCitations";
import { safeExternalHref } from "@/lib/url/safeExternalHref";
import {
  answerLines,
  askThemQuestions,
  stageList,
  packClaims,
  allSupports,
  runningSectionBannerText,
  wholePackQueuedText,
} from "@/app/components/tracking/prepPackFields";

// AC-N29.14: rewritten now that N29 gives this panel its own
// Generate/Regenerate control (design-experience.r1.md §1's Option B) --
// both strings used to describe a control that did not exist anywhere in
// the codebase (`absent`'s own "Generate one from this application's
// tracking row" was Option A phrasing; `partial`'s "Generate again to try
// for the rest" pointed at nothing). Neither names a location any more:
// N50 moved the control below all four section groups, well past this
// banner, so "beneath this text" would now be false.
const COPY = {
  absent: "No prep pack yet.",
  running: "Generating your interview prep pack now…",
  ready: "Your interview prep pack is ready.",
  partial: "This pack is partial — some sections couldn't be generated.",
  failed: "The last generation attempt failed. This may be temporary — try again when you're ready.",
  unavailable:
    "Nothing to research yet — there's no job description on this posting. This isn't a failed attempt, and trying again won't help until a description is added.",
};

const SECTION_LABELS = {
  aboutYou: "Tell me about yourself",
  whyRole: "Why this role",
  askThem: "Questions to ask them",
  stages: "Interview stages",
};

// N50 fix round 4: the pure pack readers used below (answerLines,
// askThemQuestions, stageList, packClaims, allSupports) moved to
// ./prepPackFields.js to keep this file under its own 1000-line cap -- see
// that file's own header.

// N43: a bracketed superscript, reused verbatim from DigestPanel.js's own
// MARKER_SX/FOCUS_SX (measured there in a real Chromium layout -- see that
// file's header for the 24x24 WCAG 2.5.8 floor and the `marginBlock: -6px`
// line-height compensation) rather than re-derived here. DigestPanel.js does
// not export either object, so this is an identical copy, not an import --
// design-experience.r1.md ss1 leaves promoting the shared copy to a
// structure seat.
const FOCUS_SX = {
  outlineWidth: "2px",
  outlineStyle: "solid",
  outlineColor: "var(--accent)",
  outlineOffset: "2px",
  borderRadius: "2px",
};

const MARKER_SX = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
  minWidth: 24,
  minHeight: 24,
  marginBlock: "-6px",
  fontSize: "0.75em",
  lineHeight: 0,
  verticalAlign: "super",
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
  padding: "0.5em 0.15em",
  color: "currentColor",
  textDecorationLine: "none",
  "&::before": { content: '"["' },
  "&::after": { content: '"]"' },
  "&:hover": { textDecorationLine: "underline" },
  "&:focus-visible": FOCUS_SX,
};

/** The citation marker itself. `resolved` is one `resolveSupport(...)`
 *  result and `n` its assigned per-section number -- both come from the
 *  caller's own `numberResolved(...)` pass, never computed here, so there is
 *  exactly one numbering implementation.
 *
 *  A cited marker is a real link, reachable by keyboard, named
 *  "Source {n}: {claim.text}" -- never the bare digit, which is decorative.
 *  An unsafe marker (AC-N43.7(b): `support` resolves but the claim's
 *  `sourceUrl` fails `safeExternalHref`) is a `<span>`, never an `<a>` stub:
 *  no `href`, no tabindex, no interactive role, and its own name discloses
 *  the link is unavailable rather than pretending to be a working source. */
function CitationMarker({ resolved, n }) {
  if (!resolved || resolved.state === "none" || n == null) return null;
  if (resolved.state === "unsafe") {
    return (
      <Box
        component="span"
        aria-label={`Citation ${n}: link unavailable`}
        data-citation-marker={String(n)}
        sx={MARKER_SX}
      >
        {String(n)}
      </Box>
    );
  }
  // The href attribute is recomputed here, at the point of use, through
  // safeExternalHref directly -- rather than trusting `resolved.href` (which
  // prepCitations.js already computed the same way) -- so
  // app/components/hrefSafety.sweep.test.js's own source-text sweep, which
  // can only see gating within ONE file, finds the gate on this line too.
  return (
    <Box
      component="a"
      href={safeExternalHref(resolved.claim.sourceUrl)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Source ${n}: ${resolved.claim.text}`}
      data-citation-marker={String(n)}
      sx={MARKER_SX}
    >
      {String(n)}
    </Box>
  );
}

/** A section's own numbered source list -- rendered only when that section
 *  resolved at least one citation (AC-N43.1); gated, never an empty
 *  heading. Per-section, never a combined list (owner ruling): each of the
 *  four sections gets its own "Sources for {label}" list, and the same
 *  claim cited from two sections earns two independent entries. The unsafe
 *  branch shows the claim's own text as inert content -- never a raw
 *  `href` built from the unvalidated string -- with something beyond the
 *  bare claim text so the reader is not left wondering why it isn't a link
 *  (design-experience.r1.md ss9 gates the exact wording, not the shape).
 *  N50/AC-N50.4(c): the list is T2 -- secondary colour throughout, its
 *  anchor kept `color: "inherit"` so it never reads as an ordinary,
 *  primary-colour link (F4).
 *  m-d (N50 fix round 2): a top rule and a wider gap set the block off from
 *  what precedes it -- verify.r2.md's own defect: it used to read as a
 *  stage's own "Suggested answer:" sub-label instead. Heading stays an h4
 *  named "Sources for {label}" (AC-N50.5's own walker) -- only the
 *  SURROUNDING style changes. Applies to all four sections, not just Stages.
 *  Rounds 3-6 (verify3/4/5/6.md) each WIDENED this block's own `pb` -- 12px,
 *  then 24px -- chasing the gap to the section's own Regenerate/history row
 *  past the 16px inter-section gap (sectionHeaders.test.js pins that value).
 *  N50 fix round 7 (verify.r7.md M-3): the wrong quantity was being moved.
 *  `pb` is padding INSIDE a section; 16px is the gap BETWEEN sections --
 *  widening the first past the second guarantees the action row reads as
 *  closer to the NEXT section than to the content above it it belongs to
 *  (measured: 36px above the row, 16px below -- 2.25:1 the wrong way).
 *  `pb: 0` restores the ordering instead: the section wrapper's own `mb: 1`
 *  ("8px", `Section` above) and `PrepSectionActions`'s own `mt: 0.5` ("4px")
 *  already separate the list from the action row without this padding. */
function SourceList({ label, entries }) {
  if (entries.length === 0) return null;
  return (
    <Box sx={{ mt: 2.5, mb: 0, pt: 1, pb: 0, borderTop: "1px solid var(--border)" }}>
      <Box
        component="h4"
        sx={{
          fontSize: 10.5,
          fontWeight: 700,
          mt: 0,
          mb: 0.5,
          color: "var(--text-secondary)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        Sources for {label}
      </Box>
      <Box component="ol" sx={{ m: 0, pl: 2.5, display: "flex", flexDirection: "column", rowGap: 0.75, color: "var(--text-secondary)" }}>
        {entries.map((entry) => {
          // Same discipline as CitationMarker above: recomputed here, in
          // this file, through safeExternalHref directly, rather than
          // trusting the `href` prepCitations.js already resolved.
          const href = safeExternalHref(entry.claim.sourceUrl);
          return (
            <Box component="li" key={entry.claim.id} sx={{ fontSize: 12.5, ...BREAK_LONG_WORDS_SX }}>
              {href ? (
                <Box component="a" href={href} target="_blank" rel="noopener noreferrer" sx={{ color: "inherit", display: "block" }}>
                  {entry.claim.text}
                </Box>
              ) : (
                <Box>
                  {entry.claim.text}
                  <Box component="span" sx={{ color: "var(--text-secondary)" }}>
                    {" "}
                    (source link unavailable)
                  </Box>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

const RECOMMENDED_ANSWER_LABEL_SX = { fontWeight: 700, fontSize: 11.5, color: "var(--text-secondary)" };
const RECOMMENDED_ANSWER_BODY_SX = { fontSize: 12.5, color: "var(--text-secondary)", mt: 0.25, mb: 0 };

/** N48: the model generates a `recommendedAnswer` for every stage and it was
 *  discarded at the last hop to a human -- the same defect class this chunk
 *  keeps shipping (a complete, correct mechanism with nothing rendering its
 *  output). Always visible, in full, never behind a disclosure control or a
 *  truncation: design-experience.r1.md ss3 argues a click-gate here is a
 *  stronger minimize-clicks violation than the usual "hide the details"
 *  case, because this is the section's primary payload, not optional detail.
 *  Demoted typographically instead -- smaller, secondary colour, labelled --
 *  so it reads as reference material after the questions rather than
 *  competing with them. `null`/blank renders nothing, same discipline as
 *  every other optional field in this file. */
function RecommendedAnswer({ text }) {
  if (typeof text !== "string" || text.trim() === "") return null;
  return (
    <Box sx={{ mt: 0.75, mb: 0 }}>
      <Box component="span" sx={RECOMMENDED_ANSWER_LABEL_SX}>
        Suggested answer:
      </Box>
      <Box sx={RECOMMENDED_ANSWER_BODY_SX}>{text}</Box>
    </Box>
  );
}

// N50/AC-N50.14: neither variant may say WHERE the orphaned material sits
// relative to the sections -- the restructure below moves things around, and
// N42 may move the panel again, so positional copy would go silently false.
const ORPHAN_NOTICE_TEXT = {
  empty: "This pack's research produced source material that isn't tied to anything in this pack.",
  partial: "This pack's research also produced source material beyond what's tied to a citation in this pack.",
};

/** AC-N43.5: "citations arrived, none placed" is ONE pack-level sentence,
 *  never a disguised bibliography -- the owner's own ban on a combined
 *  Sources list. A claim the model researched but never tied to a
 *  fact/question/stage cannot be honestly attributed to any one section
 *  (claims are not tagged by section), so it is disclosed once, pack-wide,
 *  reusing StatusBanner's own visual treatment so it reads as one more
 *  disclosure banner rather than a new visual register. */
function OrphanClaimsNotice({ variant }) {
  if (!variant) return null;
  return (
    <Box
      sx={{ fontSize: 12.5, color: "var(--text-secondary)", bgcolor: "var(--bg-soft)", p: 1, borderRadius: 1, mb: 1.5 }}
    >
      {ORPHAN_NOTICE_TEXT[variant]}
    </Box>
  );
}

function Section({ heading, children }) {
  return (
    <Box sx={{ mb: 1 }}>
      {/* N44/AC-N44.9: `margin-top` is stated explicitly (never left to the
       *  browser's UA default `1em` on an `<h3>`) -- the same defect class
       *  070e1ec fixed in a sibling file, now four times as visible because
       *  this heading renders unconditionally in every state. N50/AC-N50.4:
       *  15px, strictly larger than every T1 body line (13.5px), so the
       *  heading always outranks what it labels. N50/C5: this wrapper's own
       *  `mb: 1` ("8px") is the gap between the heading's body and its own
       *  PrepSectionActions -- the gap BETWEEN sections is now owned by the
       *  role="group" wrapper one level up. */}
      {/* m4 (N50 fix round 1): 17px, widened from 15px so the step to a stage
       *  h4 (13.5px) reads as two ranks apart rather than a 1.11 ratio that a
       *  sighted reader can mistake for one continuous list ("Interview
       *  stages" followed by "Recruiter screen" as siblings). */}
      <Box component="h3" sx={{ fontSize: 17, fontWeight: 700, mt: 0, mb: 0.5 }}>
        {heading}
      </Box>
      {children}
    </Box>
  );
}

function AnswerSection({ name, pack }) {
  const lines = answerLines(pack, name);
  if (lines.length === 0) return null;
  const resolvedList = lines.map((line) => resolveSupport(line?.support, packClaims(pack)));
  const { numbers, entries } = numberResolved(resolvedList);
  return (
    <Section heading={SECTION_LABELS[name]}>
      {lines.map((line, i) => (
        <Box key={i} sx={{ fontSize: 13.5, mb: 0.5 }}>
          {line?.text}
          <CitationMarker resolved={resolvedList[i]} n={numbers[i]} />
        </Box>
      ))}
      <SourceList label={SECTION_LABELS[name]} entries={entries} />
    </Section>
  );
}

function AskThemSection({ pack }) {
  const questions = askThemQuestions(pack);
  if (questions.length === 0) return null;
  const resolvedList = questions.map((question) => resolveSupport(question?.support, packClaims(pack)));
  const { numbers, entries } = numberResolved(resolvedList);
  return (
    <Section heading={SECTION_LABELS.askThem}>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {questions.map((question, i) => (
          <Box component="li" key={i} sx={{ fontSize: 13.5 }}>
            {question?.text}
            <CitationMarker resolved={resolvedList[i]} n={numbers[i]} />
          </Box>
        ))}
      </Box>
      <SourceList label={SECTION_LABELS.askThem} entries={entries} />
    </Section>
  );
}

function StagesSection({ pack }) {
  const stages = stageList(pack);
  if (stages.length === 0) return null;
  const resolvedList = stages.map((stage) => resolveSupport(stage?.support, packClaims(pack)));
  const { numbers, entries } = numberResolved(resolvedList);
  return (
    <Section heading={SECTION_LABELS.stages}>
      {stages.map((stage, i) => (
        <Box key={i} sx={{ mb: 1 }}>
          {stage?.name ? (
            // N50/AC-N50.5: a named stage is its own level-4 heading, so the
            // outline a screen reader walks matches the one the eye sees.
            // The citation marker is a SIBLING after the h4, never inside it
            // (R3) -- a marker inside the heading would fold "Source n:
            // {claim}" into the stage name's own accessible name.
            <Box sx={{ mt: 0, mb: 0 }}>
              <Box component="h4" sx={{ display: "inline", fontWeight: 700, fontSize: 13.5, mt: 0, mb: 0 }}>
                {stage.name}
              </Box>
              <CitationMarker resolved={resolvedList[i]} n={numbers[i]} />
            </Box>
          ) : numbers[i] != null ? (
            // AC-N43.3's own fallback: a stage can carry a resolved citation
            // with no name to attach it to. Rather than dropping the
            // citation or migrating it onto a question -- either of which
            // would misrepresent what it covers -- it gets a small
            // standalone line of its own. N50/AC-N50.4: this line is T2, not
            // a heading, so it carries the demoted size and colour rather
            // than the bold T1 treatment a named stage would get.
            <Box sx={{ mt: 0, mb: 0, fontSize: 12.5, color: "var(--text-secondary)" }}>
              Source for this stage
              <CitationMarker resolved={resolvedList[i]} n={numbers[i]} />
            </Box>
          ) : null}
          {Array.isArray(stage?.questions) ? (
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {stage.questions.map((question, qi) => (
                <Box component="li" key={qi} sx={{ fontSize: 13 }}>
                  {question}
                </Box>
              ))}
            </Box>
          ) : null}
          <RecommendedAnswer text={stage?.recommendedAnswer} />
        </Box>
      ))}
      <SourceList label={SECTION_LABELS.stages} entries={entries} />
    </Section>
  );
}

// N44: the empty-state text for an excluded section, keyed by section NAME
// only -- never by `status`, never by legacy-ness. This is what makes
// AC-N44.6's "same generic text for a legacy pack's unresolvable sections"
// hold by construction: there is only one string per section anywhere in
// this file. Each sentence states only the one fact this component can
// verify (the section isn't in `completeSections`) and claims no cause and
// no future promise -- see AC-N44.4/.5. "Yet" mirrors this file's own idiom
// (`COPY.absent`, `COPY.unavailable`) without committing to "will arrive."
const EMPTY_SECTION_TEXT = {
  aboutYou: "No self-introduction here yet.",
  whyRole: "No role-specific reasoning here yet.",
  askThem: "No candidate questions here yet.",
  stages: "No interview-stage breakdown here yet.",
};

/** The excluded-section placeholder. Takes ONLY `name` -- never `pack` -- so
 *  there is no binding in scope this component could use to read
 *  `pack.sections.<name>`'s array or emit that section's own list/box
 *  markup (AC-N44.3/.8). The body is a plain `Box` (renders `<div>`), never
 *  a list, with an explicit `m: 0` per the AC-N44.9 discipline. Reuses
 *  `Section` unmodified, so the heading level and accessible name are
 *  identical to a populated section's by construction (AC-N44.7). */
function EmptySection({ name }) {
  return (
    <Section heading={SECTION_LABELS[name]}>
      <Box sx={{ fontSize: 12.5, color: "var(--text-secondary)", m: 0 }}>{EMPTY_SECTION_TEXT[name]}</Box>
    </Section>
  );
}

/** N44: renders exactly four fixed-order slots, always -- one per
 *  `SECTION_LABELS` key, in the interview's own order (N50/AC-N50.6: aboutYou,
 *  whyRole, stages, askThem) -- so the header outline never depends on
 *  `status` or on `completeSections` having anything in it. Each slot still
 *  gates its CONTENT on `complete.has(name)` exactly as before: the
 *  authoritative set `prepPack.js`'s own `completeSections` already computed
 *  server-side, never re-derived from `pack` itself. A section present in
 *  `pack` but absent from `completeSections` (a partial pack's own missing
 *  section, or a legacy pack's orphaned top-level keys) still never has its
 *  content rendered here -- the exact invariant AC-N33.13/15 require -- it
 *  renders `EmptySection` instead of nothing.
 *
 *  N50/AC-N50.7: each slot is now ONE `role="group"` named by its section
 *  label, wrapping `Section` (the heading and its body, unchanged) plus its
 *  own `PrepSectionActions` (the regenerate control, the in-progress/queued
 *  status line, any outcome message, and the version-history disclosure) --
 *  so a section's controls, its content and anything reported about an
 *  action on it all sit inside one named landmark. `PrepSectionActions`
 *  itself renders only when `hasPack`: the affordance to regenerate or
 *  restore a section that has never existed is not useful, and there is no
 *  history to show. */
function PackSections({
  hasPack,
  pack,
  completeSections,
  sectionsEnabled,
  generatingSections,
  sectionActivity,
  sectionOutcomes,
  onRegenerateSection,
  sectionRevisions,
  liveRevisions,
  onRestoreRevision,
}) {
  const complete = new Set(Array.isArray(completeSections) ? completeSections : []);
  const generating = new Set(Array.isArray(generatingSections) ? generatingSections : []);
  const revisionsBySection = sectionRevisions || {};
  const liveBySection = liveRevisions || {};
  const activityBySection = sectionActivity || {};
  const outcomeBySection = sectionOutcomes || {};

  function actions(name) {
    // `generatingSections` is RETAINED (N53): a listed section with no
    // `sectionActivity` entry of its own is treated as an in-progress
    // generate, so a caller that has not yet adopted the queue's richer
    // shape (the landed sectionActions.test.js suite) keeps working.
    const activity =
      activityBySection[name] || (generating.has(name) ? { state: "in-progress", kind: "generate", revision: null } : null);
    // M2 (N50 fix round 1): a section with its OWN active/queued activity
    // still gets its status line even with no pack at all -- the first-open-
    // mid-action case, where there is nothing yet to cache. Every other
    // section (no activity, no pack) stays gated exactly as before: no
    // control for a section that has never existed.
    if (!hasPack && !activity) return null;
    return (
      <PrepSectionActions
        section={name}
        label={SECTION_LABELS[name]}
        enabled={sectionsEnabled(name)}
        activity={activity}
        outcome={outcomeBySection[name]}
        onRegenerateSection={onRegenerateSection}
        revisions={revisionsBySection[name]}
        liveRevision={liveBySection[name]}
        onRestoreRevision={onRestoreRevision}
      />
    );
  }

  const group = (name, body) => (
    <Box role="group" aria-label={SECTION_LABELS[name]} sx={{ mt: 0, mb: 2 }}>
      {body}
      {actions(name)}
    </Box>
  );
  return (
    <Box>
      {group("aboutYou", complete.has("aboutYou") ? <AnswerSection name="aboutYou" pack={pack} /> : <EmptySection name="aboutYou" />)}
      {group("whyRole", complete.has("whyRole") ? <AnswerSection name="whyRole" pack={pack} /> : <EmptySection name="whyRole" />)}
      {group("stages", complete.has("stages") ? <StagesSection pack={pack} /> : <EmptySection name="stages" />)}
      {group("askThem", complete.has("askThem") ? <AskThemSection pack={pack} /> : <EmptySection name="askThem" />)}
    </Box>
  );
}

function StatusBanner({ status, pack, runningSectionLabel }) {
  if (status === "running" && runningSectionLabel) {
    return (
      <Box
        role="status"
        sx={{ fontSize: 12.5, color: "var(--text-secondary)", bgcolor: "var(--bg-soft)", p: 1, borderRadius: 1, mb: 1.5 }}
      >
        {runningSectionBannerText(runningSectionLabel)}
      </Box>
    );
  }
  const text = !pack && !status ? COPY.absent : COPY[status] || null;
  if (!text) return null;
  return (
    <Box
      sx={{ fontSize: 12.5, color: "var(--text-secondary)", bgcolor: "var(--bg-soft)", p: 1, borderRadius: 1, mb: 1.5 }}
    >
      {text}
    </Box>
  );
}

/** Reports a failed READ -- see this file's own `error` prop header for what
 *  sets it. `role="alert"`, unlike `StatusBanner`'s plain `role="status"`/
 *  none: this is reporting a failure, not a routine state change.
 *  N50 fix round 7 (verify.r7.md B-1): rendered ALONGSIDE `StatusBanner`,
 *  never instead of it -- round 6's own version replaced `StatusBanner`
 *  outright, on the false premise that a truthy `error` means "no
 *  successful read." route.js's own successful GET still returns `error:
 *  trustedError` whenever the separate trusted-names read fails closed
 *  (SEC-N33), with a real `status` alongside it -- and hiding the status
 *  line there deleted COPY.ready/.running/.absent's own sentence the instant
 *  only the names read had failed. */
function ReadErrorNotice({ text }) {
  if (!text) return null;
  return (
    <Box role="alert" sx={{ fontSize: 12.5, color: "var(--text-secondary)", bgcolor: "var(--bg-soft)", p: 1, borderRadius: 1, mb: 1.5 }}>
      {text}
    </Box>
  );
}

// N29's Generate/Regenerate control -- design-experience.r1.md §4.1's own
// precedence, evaluated in this order: a running/generating attempt wins
// over everything else, then a missing job description, else the control is
// idle and activatable. Exported (mirroring AppViewDialog.js's own
// `messageFor`) so it is directly testable without mounting the component.
// M2 (N50 fix round 1): `runningSection` (a section name, or null/undefined)
// is this session's own queue naming WHICH action a server `running` status
// belongs to. A `running` status with no known section still wins as
// in-flight (the conservative default for a run this session did not start --
// an external trigger, another tab); a `running` status the queue attributes
// to a SECTION no longer forces the whole-pack control into "Generating…" on
// its own -- `generating` (this session's own whole-pack claim) still does.
//
// B-1 (N50 fix round 3, verify.r3.md): `timedOutPending` covers the case
// `runningSection` does not -- THIS session's own WHOLE-PACK action already
// timed out (the client gave up waiting), yet the server keeps reporting
// `running` because its claim lease can still be live. Without this, the
// panel blocked "in-flight" forever: no cached pack to fall back on for a
// whole-pack run (m-6's own deliberate policy, unchanged here), no whole-pack
// control to retry with, and no way out short of closing and reopening the
// dialog (AC-N50.15(d) assumes a blocked state's block eventually ends).
// Deliberately narrower than "any pack outcome exists": only `timedOut`
// releases the block -- a `refused`/`disabled` outcome must keep blocking,
// since a fresh click there would only spend another rate-limit token
// repeating the exact same refusal.
export function prepActionState({ status, generating, hasDescription, runningSection = null, timedOutPending = false }) {
  if (generating) return "in-flight";
  if (status === "running" && !runningSection && !timedOutPending) return "in-flight";
  if (!hasDescription) return "no-description";
  return "idle";
}

const NO_DESCRIPTION_COPY =
  "This posting has no job description on file, so there's nothing to generate a prep pack from. Add one from this application's Edit form, then come back here.";
// F-8 (owner decision 2026-09-20), UPDATED for N45/N46: `claim_prep_pack_slot`
// still clears the pack row to `{}` UNCONDITIONALLY the moment a generation
// attempt starts -- before any content is produced, before the prompt is
// even built -- because `interview_prep_packs_running_has_no_content`
// forbids a `running` row from holding content
// (supabase/migrations/20260922000000_..., :86-97 and
// 20260914000000_interview_prep.sql:179-180). Two prior copies described
// this wrongly, in opposite directions: the FIRST implied the old pack
// survives until the new one exists (it does not); a SECOND revision, after
// that was fixed, went on to claim nothing at all could be salvaged from a
// failed attempt -- also now false, since the storage layer this caption
// describes (route.js's own restore-on-failure write, plus this chunk's
// per-section revision history) puts the prior document back on its own.
// This does NOT put the candidate's own typed data at risk -- their name and
// interviewer names live in separate tables this action never touches.
// N50/AC-N50.14: "the pack above" became "this pack" -- positional copy that
// N50's own restructure (and any future N42 move) would make silently false.
const DESTRUCTIVE_REGENERATE_CAPTION =
  "Regenerating replaces this pack the moment you start — before the new one is ready. If this attempt fails, your previous content comes back on its own, and every section keeps a history of its earlier versions.";

/** The meta-actions row's Generate/Regenerate control. Never a disabled
 *  `Button` (DX §8's a11y rule) -- a blocked state replaces the button with
 *  explanatory text instead, so nothing looks interactive while silently
 *  doing nothing. `hasPack` decides ONLY the label/caption/emphasis, never
 *  the action-state itself (DX §4.1: a failed regeneration leaves a
 *  pre-existing pack's content untouched, so "something to lose" tracks
 *  `hasPack` exactly the same way for a `failed` status as for
 *  `ready`/`partial`).
 *
 *  N50/AC-N50.3: `contained` (filled) emphasis is reserved for the absent
 *  state's one obvious first action; once a pack exists the control is
 *  merely `outlined` so it no longer reads as the panel's loudest control --
 *  that would invite the one click that clears the pack the moment it
 *  starts. N53/`queued`: precedence is in-flight ("Generating…") ->
 *  queued (non-interactive, names the whole pack) -> no-description ->
 *  button, so a queued whole-pack regenerate never renders alongside the
 *  button it is waiting behind.
 *
 *  m3 (N50 fix round 1): the in-flight and queued TEXT moved out of this
 *  function and into `WholePackStatus` below, which renders inside an
 *  ALWAYS-PRESENT `role="status"` region -- a live region created together
 *  with its first text is not reliably announced, only a change inside an
 *  EXISTING one is (the same rule PrepSectionActions already follows). This
 *  function now renders only the button or the no-description text, both of
 *  which replace rather than share space with that status region.
 *
 *  N50 fix round 5 (verify.r5.md minor m-1): `no-description` used to be a
 *  SECOND, undocumented zero-control state -- the invariant sweep never
 *  varied `hasDescription`, so nothing caught it. It now carries the one
 *  control this file can offer without leaving its own scope: a way to open
 *  this application's job-posting page, wired at AppViewDialog.js. */
// N50 fix round 6 (verify.r6.md M-3): `no-description` is now checked BEFORE
// `queued` -- verify.r6.md measured that with the old order, a whole-pack
// regenerate queued behind a live section action, followed by the job
// description being cleared (from the tracking row's Edit form, or another
// tab) before that queued action drains, left this control rendering
// NOTHING: `queued` won the race even though `actionState` already reads
// `no-description` by then, so the one forward control this state exists to
// offer (round 5's own m-1 fix) never appeared. `prepActionState` itself
// already resolves `in-flight` before `no-description` (a session's own
// active claim, or the server's, still wins), so swapping only this pair
// cannot ever hide a genuinely in-flight state behind the description notice.
// N50 fix round 7 (verify.r7.md minor m-3) -- NOT applied. verify.r7.md
// proposed withholding this button while `readError` holds, on the theory
// that this render cannot confirm the pack's own content is current. Tried
// and reverted: AppViewDialog.prepTimeout.test.js's own landed PH1
// ("the queue still moves on once the fetch's own bound elapses", N50 fix
// round 5) mounts, clicks this exact button, lets the settled handler's own
// refetch hang past its bound (an honest `readError`, with a cache showing),
// and then asserts THIS SAME button is clickable again and sends a real
// second POST -- proof the queue's own `active` slot truly cleared, not
// merely that some other control exists. Gating the button on `readError`
// makes that assertion fail (`wholePackRegenerateControl()` -> null): the
// two requirements are incompatible as stated. PH1 is a previously-landed
// test this round may not edit, so the gate was reverted rather than
// resolved unilaterally. Owner ruling (verify.r8.md): blocking recovery is
// worse than the risk, a read failure does not imply content exists, and
// "Check again" is not a substitute for a candidate who wants to regenerate.
function GenerateControl({ actionState, hasPack, queued, onGenerateNow, onOpenApplication }) {
  if (actionState === "no-description") {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 0.75 }}>
        <Box sx={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{NO_DESCRIPTION_COPY}</Box>
        <Button size="small" variant="outlined" sx={TOUCH_TARGET_SX} onClick={() => onOpenApplication?.()}>
          Add a job description
        </Button>
      </Box>
    );
  }
  if (actionState === "in-flight" || queued) return null;
  return (
    <Button size="small" variant={hasPack ? "outlined" : "contained"} sx={TOUCH_TARGET_SX} onClick={() => onGenerateNow?.()}>
      {/* M1 (N50 fix round 1): "Regenerate whole pack", never the bare
       *  "Regenerate" a section's own control also uses -- HEAD's identical
       *  wording is what let a candidate mistake the destructive whole-pack
       *  control for the section control sitting just above it. */}
      {hasPack ? "Regenerate whole pack" : "Prepare me for this interview"}
    </Button>
  );
}

/** m3 (N50 fix round 1): the whole-pack in-flight/queued line, in its own
 *  ALWAYS-PRESENT `role="status"` region -- rendered even in the absent
 *  state, before any pack exists, so the region is there for the FIRST
 *  transient this control ever shows, not created together with it.
 *  N50 fix round 7 (verify.r7.md minor m-5): the queued line's own copy now
 *  depends on `hasDescription` too (./prepPackFields.js's own
 *  `wholePackQueuedText`) -- a whole-pack regenerate can queue behind a live
 *  section action, then have its job description removed before it drains
 *  (AC-N50.15(c) crossed with an edit from the tracking row's own Edit form
 *  or another tab); until this round the line still promised "will
 *  regenerate once the current update finishes" while GenerateControl's own
 *  no-description text, right beside it, said the opposite. */
function WholePackStatus({ actionState, queued, hasDescription }) {
  return (
    <Box role="status" sx={{ mt: 0, mb: 0 }}>
      {actionState === "in-flight" ? (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, fontSize: 12.5, color: "var(--text-secondary)" }}>
          <CircularProgress size={14} />
          Generating…
        </Box>
      ) : queued ? (
        <Box sx={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{wholePackQueuedText(hasDescription)}</Box>
      ) : null}
    </Box>
  );
}

// N50 fix round 5 (line-cap extraction): NamesStrip moved to
// ./PrepPackNamesStrip.js -- see that file's own header (the same "S1"
// extraction pattern that already moved ./PrepSectionActions.js out of this
// file). Imported above; `namesStrip` below is unchanged.

export default function PrepPackPanel({
  pack = null,
  status = null,
  completeSections = [],
  candidateName = null,
  interviewerNames = [],
  // N50 fix round 7 (verify.r7.md B-1): NOT exclusive with a real `status`.
  // Set whenever a READ failed outright (a hung/aborted GET, a first-open
  // error, a deleted row -- `status` stays null there), OR whenever the pack
  // read succeeded but the SEPARATE trusted-names read failed closed
  // (route.js's own GET still returns `error: trustedError` beside a real
  // `status` -- trustedNames.js's SEC-N33). `ReadErrorNotice` renders it
  // ALONGSIDE `StatusBanner`, never in place of it.
  error = null,
  onDownloadLog,
  onSaveNames,
  generating = false,
  triggerMessage = null,
  onGenerateNow,
  hasDescription = true,
  // N45/N46 (S10): additive. Every existing call site (and every landed
  // test of this component) keeps working unchanged with none of these
  // supplied -- see PrepPackPanel.sectionActions.test.js's own header.
  onRegenerateSection,
  onRestoreRevision,
  sectionRevisions = {},
  liveRevisions = {},
  generatingSections = [],
  // N50/N53 (S3): the action queue's own display contract, all optional and
  // additive in the same way. `sectionActivity`/`sectionOutcomes` are keyed
  // by section name; `wholePackQueued` replaces the whole-pack button with a
  // non-interactive queued line (plan.r2.md section 2.2).
  sectionActivity = {},
  sectionOutcomes = {},
  wholePackQueued = false,
  // B-1 (N50 fix round 3): this session's own whole-pack action timed out --
  // see `prepActionState`'s own header above for why this releases the
  // "running blocks everything" default. Additive, defaults false, so every
  // existing call site is unaffected.
  packTimedOut = false,
  // INVARIANT (N50 fix round 4): see `showCheckAgain`'s own header below.
  // Additive and optional -- a caller that never passes it simply never
  // shows the control, since the Button's own onClick already guards a
  // missing callback with `?.()`.
  onCheckAgain,
  // N50 fix round 5 (verify.r5.md minor m-1): the no-description state's own
  // forward control, wired to `GenerateControl` below -- see that function's
  // own header. Additive and optional, same discipline as `onCheckAgain`.
  onOpenApplication,
}) {
  const hasPack = !!pack;
  // M2 (N50 fix round 1): the ONE section this session's own queue shows as
  // actively in progress, if any -- derived from `sectionActivity` alone
  // (never re-derived elsewhere), so a `running` status can be attributed to
  // a section without a new prop from the caller.
  //
  // B-1 (N50 fix round 3): once a section's OWN action has settled with a
  // `timedOut` outcome, it no longer has a `sectionActivity` entry (the
  // queue's `active` is back to `null`), so the lookup above alone would
  // stop attributing `running` to it right when the client gives up --
  // exactly when the attribution most needs to survive. `sectionOutcomes`
  // (already a prop; not re-derived from anything new) covers that second
  // instant: it keeps naming the same section for as long as its `timedOut`
  // outcome exists, which is exactly as long as AppViewDialog.js's own
  // `activeSectionTarget` (the cache gate) does.
  const activeSectionName =
    Object.keys(sectionActivity).find((name) => sectionActivity[name]?.state === "in-progress") || null;
  const runningSectionName =
    activeSectionName || Object.keys(sectionOutcomes).find((name) => sectionOutcomes[name]?.result?.timedOut === true) || null;
  const actionState = prepActionState({
    status,
    generating,
    hasDescription,
    runningSection: runningSectionName,
    timedOutPending: packTimedOut,
  });
  // M-1 (N50 fix round 5, verify.r5.md) -- PER SECTION, not one shared
  // boolean. verify.r5.md measured that the old, single `sectionsEnabled`
  // read `runningSectionName` (whichever ONE section the lookup above
  // happened to find) and applied its verdict to ALL FOUR sections at once:
  // a stale `timedOut` outcome on aboutYou re-enabled whyRole/stages/askThem
  // too, although nothing about THEIR own state changed -- an immediate
  // PATCH from any of them into a claim that may still be live, a guaranteed
  // refusal that has already spent a rate-limit token.
  //
  // Two cases now differ, checked per section: (1) `activeSectionName` set
  // -- THIS SESSION's own queue is genuinely working an entry for this
  // application right now, so every OTHER section's click only enqueues
  // behind it (AC-N50.15(c)), never sends a second POST; every section stays
  // enabled, exactly as before. (2) no live activity anywhere, only a
  // settled `timedOut` OUTCOME -- nothing is queued behind it any more, so
  // only the section THAT OUTCOME belongs to (checked directly against
  // `sectionOutcomes`, never merely against the single `runningSectionName`
  // above, so this also holds when more than one section carries its own
  // stale outcome at once) may retry; every other section stays blocked
  // while `status` is still `running` for a reason this session cannot rule
  // out. `packTimedOut` -- this session's OWN whole-pack claim having also
  // timed out -- blocks every section outright, including one with its own
  // stale timeout: verify.r5.md measured this exact pair reachable (a pack
  // timeout, the server finishes, a fresh section regenerate that also times
  // out) and still rendering 36 Restore controls under the old shared
  // boolean.
  function sectionEnabled(name) {
    if (packTimedOut) return false;
    const ownTimedOut = sectionOutcomes[name]?.result?.timedOut === true;
    const runningSection = activeSectionName ? name : ownTimedOut ? name : null;
    return prepActionState({ status, generating, hasDescription, runningSection, timedOutPending: false }) === "idle";
  }
  // INVARIANT (N50 fix round 4, verify4.md; widened round 5, verify.r5.md
  // B-1): the one `in-flight` shape nothing else here resolves on its own --
  // `running` with no session-known reason: not this session's own active
  // claim, not a section's activity/timeout, not a released whole-pack
  // timeout (both already flip `actionState` to "idle"). Round 4 excluded
  // `generating` on the theory that this session's own active claim is
  // "bounded by the queue's own timeout and resolves on its own" -- measured
  // false in verify.r5.md: the queue's settled handler itself `await`s a
  // refetch (AppViewDialog.js's `fetchPrep`) that carried no bound of its
  // own, so `generating` could stay true, with zero controls, for as long as
  // that GET never answered. That fetch is now bounded at its source, but
  // `generating` is no longer exempted here either -- it gets the SAME
  // manual escape hatch every other still-blocked shape already has, rather
  // than depending on a single fetch's own timeout being the only thing
  // standing between this state and a permanent dead end.
  // N50 fix round 7 (verify.r7.md B-1): `error` gets the SAME escape hatch,
  // independent of `actionState` -- and independent of whether `status` is
  // ALSO set (round 6's own header claimed the two were mutually exclusive;
  // false, see the `error` prop's own header above). Whatever the panel's
  // last known generation state was, a truthy `error` means a fresh read is
  // worth trying again, so a manual retry stays offered whether or not this
  // render also has a real `status` to show beside it.
  const showCheckAgain = actionState === "in-flight" || !!error;
  const orphanVariant = sourcedOrphanVariant(packClaims(pack), allSupports(pack));
  // N50/H-9c: built ONCE, so React matches this keyed element across the two
  // slots below and MOVES it rather than remounting it -- without the key, a
  // candidate mid-edit when the first pack lands loses their open editor.
  const namesStrip = <NamesStrip key="names-strip" candidateName={candidateName} interviewerNames={interviewerNames} onSaveNames={onSaveNames} />;

  return (
    <Box sx={{ fontSize: 14 }}>
      {/* N50 fix round 7 (verify.r7.md B-1): ALONGSIDE, never instead --
       *  `error` and a real `status` can both be set (see `ReadErrorNotice`'s
       *  own header). `ReadErrorNotice` itself renders nothing for a falsy
       *  `text`, so this is never an empty node when `error` is null. */}
      <ReadErrorNotice text={error} />
      <StatusBanner
        status={status}
        pack={pack}
        runningSectionLabel={runningSectionName ? SECTION_LABELS[runningSectionName] : null}
      />
      <OrphanClaimsNotice variant={orphanVariant} />
      {/* N44/AC-N44.1: unconditional -- `hasPack` no longer gates the header
       *  block. `PackSections` itself always renders all four slots, each
       *  independently falling back to `EmptySection` when its own content
       *  is absent, so the outline shows even for the `absent` state where
       *  `pack` is `null`. `hasPack` still decides everything below (the
       *  Generate/Regenerate label and the destructive-regenerate caption)
       *  -- only this one render site changes. */}
      <PackSections
        hasPack={hasPack}
        pack={pack}
        completeSections={completeSections}
        sectionsEnabled={sectionEnabled}
        generatingSections={generatingSections}
        sectionActivity={sectionActivity}
        sectionOutcomes={sectionOutcomes}
        onRegenerateSection={onRegenerateSection}
        sectionRevisions={sectionRevisions}
        liveRevisions={liveRevisions}
        onRestoreRevision={onRestoreRevision}
      />
      {/* M1 (N50 fix round 1): the whole-pack controls get their own clearly
       *  separated, labelled region -- `role="region"` rather than
       *  `role="group"` deliberately, so it never joins the four `role="group"`
       *  section landmarks AC-N50.7 counts as "exactly four", while still
       *  giving a screen-reader user a named landmark to reach it by. `mt: 4`
       *  ("32px") is DOUBLE the 16px gap PackSections' own section groups
       *  carry between each other (sectionHeaders.test.js pins that value),
       *  so the boundary above this region reads as a bigger break than the
       *  boundary between any two sections. */}
      <Box
        role="region"
        aria-label="Whole pack"
        sx={{ mt: 4, display: "flex", flexDirection: "column", gap: 1 }}
      >
        <Box sx={{ fontWeight: 700, fontSize: 12.5, color: "var(--text-secondary)", mt: 0, mb: 0 }}>
          Whole pack
        </Box>
        {/* N50/Ruling 2: absent state only -- name your interviewers before
         *  spending a generation. Once a pack exists the strip moves after
         *  everything else (below), so the pack itself opens the reading
         *  order (AC-N50.1). */}
        {hasPack ? null : namesStrip}
        <WholePackStatus actionState={actionState} queued={wholePackQueued} hasDescription={hasDescription} />
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, ...WRAP_ROW_SX }}>
          {/* N50/T10: Generate precedes Download in EVERY state -- HEAD had
           *  Download first, which put a non-generating control ahead of the
           *  absent state's one obvious first action. */}
          <GenerateControl
            actionState={actionState}
            hasPack={hasPack}
            queued={wholePackQueued}
            onGenerateNow={onGenerateNow}
            onOpenApplication={onOpenApplication}
          />
          {/* INVARIANT (N50 fix round 4): see `showCheckAgain`'s own header
           *  above -- the one `in-flight` state this panel cannot otherwise
           *  end on its own. A plain, always-enabled Button, never a
           *  disabled one standing in for a blocked control. */}
          {showCheckAgain ? (
            <Button size="small" sx={TOUCH_TARGET_SX} onClick={() => onCheckAgain?.()}>
              Check again
            </Button>
          ) : null}
          <Button size="small" sx={TOUCH_TARGET_SX} onClick={() => onDownloadLog?.()}>
            Download prep log
          </Button>
        </Box>
        {actionState === "idle" && hasPack && !wholePackQueued ? (
          <Box data-testid="regenerate-caption" sx={{ fontSize: 12, color: "var(--text-secondary)" }}>
            {DESTRUCTIVE_REGENERATE_CAPTION}
          </Box>
        ) : null}
        {triggerMessage ? (
          <Box role="alert" sx={{ fontSize: 12.5, color: "var(--text-secondary)", ...BREAK_LONG_WORDS_SX }}>
            {triggerMessage}
          </Box>
        ) : null}
        {hasPack ? namesStrip : null}
      </Box>
    </Box>
  );
}
