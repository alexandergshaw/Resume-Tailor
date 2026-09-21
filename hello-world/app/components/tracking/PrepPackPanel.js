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

import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import TextField from "@mui/material/TextField";
import { TOUCH_TARGET_SX, WRAP_ROW_SX, BREAK_LONG_WORDS_SX } from "@/app/theme/mobileSx";
import { resolveSupport, numberResolved, sourcedOrphanVariant } from "@/lib/interviewPrep/prepCitations";
import { safeExternalHref } from "@/lib/url/safeExternalHref";

// AC-N29.14: rewritten now that N29 gives this panel its own
// Generate/Regenerate control (design-experience.r1.md §1's Option B) --
// both strings used to describe a control that did not exist anywhere in
// the codebase (`absent`'s own "Generate one from this application's
// tracking row" was Option A phrasing; `partial`'s "Generate again to try
// for the rest" pointed at nothing). Neither names a location any more,
// since the control now renders directly beneath this text.
const COPY = {
  absent: "No prep pack yet.",
  running: "Generating your interview prep pack now…",
  ready: "Your interview prep pack is ready.",
  partial: "This pack is partial — some sections couldn't be generated.",
  failed: "The last generation attempt failed. This may be temporary — try again when you're ready.",
  unavailable:
    "Nothing to research yet — there's no job description on this posting. This isn't a failed attempt, and trying again won't help until a description is added.",
  noCandidateName: "No name yet",
  noInterviewerNames: "No names yet",
  editNames: "Edit",
  addNames: "Add",
  saveNames: "Save",
  cancelNames: "Cancel",
};

const SECTION_LABELS = {
  aboutYou: "Tell me about yourself",
  whyRole: "Why this role",
  askThem: "Questions to ask them",
  stages: "Interview stages",
};

function asPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function answerLines(pack, name) {
  const section = asPlainObject(asPlainObject(pack?.sections)[name]);
  const answer = asPlainObject(section.answer);
  return Array.isArray(answer.lines) ? answer.lines : [];
}

function askThemQuestions(pack) {
  const section = asPlainObject(asPlainObject(pack?.sections).askThem);
  return Array.isArray(section.questions) ? section.questions : [];
}

function stageList(pack) {
  const section = asPlainObject(asPlainObject(pack?.sections).stages);
  return Array.isArray(section.stages) ? section.stages : [];
}

function packClaims(pack) {
  return Array.isArray(pack?.claims) ? pack.claims : [];
}

/** Every `support` in the pack, from all four sections, in no particular
 *  order -- AC-N43.5's disclosure only needs which claim ids were
 *  referenced anywhere, never where. */
function allSupports(pack) {
  return [
    ...answerLines(pack, "aboutYou").map((line) => line?.support),
    ...answerLines(pack, "whyRole").map((line) => line?.support),
    ...askThemQuestions(pack).map((question) => question?.support),
    ...stageList(pack).map((stage) => stage?.support),
  ];
}

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
 *  (design-experience.r1.md ss9 gates the exact wording, not the shape). */
function SourceList({ label, entries }) {
  if (entries.length === 0) return null;
  return (
    <Box sx={{ mt: 1.5, mb: 0 }}>
      <Box component="h4" sx={{ fontSize: 12, fontWeight: 700, mt: 0, mb: 0.5, color: "var(--text-secondary)" }}>
        Sources for {label}
      </Box>
      <Box component="ol" sx={{ m: 0, pl: 2.5, display: "flex", flexDirection: "column", rowGap: 0.75 }}>
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

const ORPHAN_NOTICE_TEXT = {
  empty: "This pack's research produced source material that isn't tied to anything shown below.",
  partial: "This pack's research also produced source material beyond what's tied to the citations below.",
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
    <Box sx={{ mb: 2 }}>
      {/* N44/AC-N44.9: `margin-top` is stated explicitly (never left to the
       *  browser's UA default `1em` on an `<h3>`) -- the same defect class
       *  070e1ec fixed in a sibling file, now four times as visible because
       *  this heading renders unconditionally in every state. */}
      <Box component="h3" sx={{ fontSize: 13, fontWeight: 700, mt: 0, mb: 0.5 }}>
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
            <Box sx={{ fontWeight: 600, fontSize: 13 }}>
              {stage.name}
              <CitationMarker resolved={resolvedList[i]} n={numbers[i]} />
            </Box>
          ) : numbers[i] != null ? (
            // AC-N43.3's own fallback: a stage can carry a resolved citation
            // with no name to attach it to. Rather than dropping the
            // citation or migrating it onto a question -- either of which
            // would misrepresent what it covers -- it gets a small
            // standalone line of its own.
            <Box sx={{ fontWeight: 600, fontSize: 13 }}>
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

// N45/N46: the standard "visually hidden but not display:none" technique --
// clipped to a 1px box rather than removed from the accessibility tree, so a
// screen reader (and this repo's own accessibleName() test helpers, which
// strip only `aria-hidden` subtrees) still reads it as part of the control's
// name. Never `aria-hidden` -- that would remove it from the very name it
// exists to extend (MUI a11y traps note: a Tooltip's `title` is NOT a
// control's accessible name; this is the opposite failure mode, a label
// present but excluded).
const VISUALLY_HIDDEN_SX = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0,0,0,0)",
  whiteSpace: "nowrap",
  border: 0,
};

/** N45's per-section regenerate control, and N46's version history/restore
 *  list -- rendered identically for a POPULATED section and an EMPTY one
 *  (this component takes no `pack` binding, matching `EmptySection`'s own
 *  AC-N44.3/.8 discipline), so the section a candidate most wants to
 *  regenerate -- the one with nothing in it -- always carries the control.
 *
 *  Visible text is the bare word "Regenerate"/"Restore" plus a
 *  visually-hidden span naming the section (and, for restore, the version
 *  number) -- never a bare "Regenerate" repeated four times indistinguishably,
 *  and never colliding with `PrepPackPanel.generate.test.js`'s own
 *  `/^regenerate$/i` matcher for the WHOLE-PACK control, since this
 *  control's own trimmed textContent is never exactly "Regenerate" alone. */
function SectionActions({ section, sectionsEnabled, generating, onRegenerateSection, revisions, liveRevision, onRestoreRevision }) {
  const restorable = (Array.isArray(revisions) ? revisions : []).filter((rev) => rev.revision !== liveRevision);
  const label = SECTION_LABELS[section];
  return (
    <Box sx={{ mt: 0.5, mb: 1.5, display: "flex", flexDirection: "column", gap: 0.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: 0, mb: 0, ...WRAP_ROW_SX }}>
        {generating ? (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0, mb: 0, fontSize: 11.5, color: "var(--text-secondary)" }}>
            <CircularProgress size={12} />
            Regenerating {label}…
          </Box>
        ) : sectionsEnabled ? (
          <Button size="small" sx={TOUCH_TARGET_SX} onClick={() => onRegenerateSection?.(section)}>
            Regenerate
            <Box component="span" sx={VISUALLY_HIDDEN_SX}>{` ${label}`}</Box>
          </Button>
        ) : null}
      </Box>
      {sectionsEnabled && restorable.length > 0 ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.375, mt: 0, mb: 0 }}>
          {restorable.map((rev) => (
            <Box key={rev.revision} sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0, mb: 0, fontSize: 11.5 }}>
              <Button size="small" sx={TOUCH_TARGET_SX} onClick={() => onRestoreRevision?.(section, rev.revision)}>
                Restore
                <Box component="span" sx={VISUALLY_HIDDEN_SX}>{` ${label} version ${rev.revision}`}</Box>
              </Button>
              <Box component="span" sx={{ mt: 0, mb: 0, color: "var(--text-secondary)" }}>
                {rev.restoredFrom != null ? "restored version" : "earlier version"} {rev.revision}
              </Box>
            </Box>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

/** N44: renders exactly four fixed-order slots, always -- one per
 *  `SECTION_LABELS` key -- so the header outline never depends on `status`
 *  or on `completeSections` having anything in it. Each slot still gates its
 *  CONTENT on `complete.has(name)` exactly as before: the authoritative set
 *  `prepPack.js`'s own `completeSections` already computed server-side,
 *  never re-derived from `pack` itself. A section present in `pack` but
 *  absent from `completeSections` (a partial pack's own missing section, or
 *  a legacy pack's orphaned top-level keys) still never has its content
 *  rendered here -- the exact invariant AC-N33.13/15 require -- it renders
 *  `EmptySection` instead of nothing.
 *
 *  N45/N46: each slot is followed by its own `SectionActions` -- the
 *  regenerate control and the restore list -- OUTSIDE `Section`'s own
 *  heading/children wrapper, so it never perturbs that component's citation
 *  numbering. */
function PackSections({
  pack,
  completeSections,
  sectionsEnabled,
  generatingSections,
  onRegenerateSection,
  sectionRevisions,
  liveRevisions,
  onRestoreRevision,
}) {
  const complete = new Set(Array.isArray(completeSections) ? completeSections : []);
  const generating = new Set(Array.isArray(generatingSections) ? generatingSections : []);
  const revisionsBySection = sectionRevisions || {};
  const liveBySection = liveRevisions || {};

  function actions(name) {
    return (
      <SectionActions
        section={name}
        sectionsEnabled={sectionsEnabled}
        generating={generating.has(name)}
        onRegenerateSection={onRegenerateSection}
        revisions={revisionsBySection[name]}
        liveRevision={liveBySection[name]}
        onRestoreRevision={onRestoreRevision}
      />
    );
  }

  return (
    <Box>
      {complete.has("aboutYou") ? <AnswerSection name="aboutYou" pack={pack} /> : <EmptySection name="aboutYou" />}
      {actions("aboutYou")}
      {complete.has("whyRole") ? <AnswerSection name="whyRole" pack={pack} /> : <EmptySection name="whyRole" />}
      {actions("whyRole")}
      {complete.has("askThem") ? <AskThemSection pack={pack} /> : <EmptySection name="askThem" />}
      {actions("askThem")}
      {complete.has("stages") ? <StagesSection pack={pack} /> : <EmptySection name="stages" />}
      {actions("stages")}
    </Box>
  );
}

function StatusBanner({ status, pack }) {
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

// N29's Generate/Regenerate control -- design-experience.r1.md §4.1's own
// precedence, evaluated in this order: a running/generating attempt wins
// over everything else, then a missing job description, else the control is
// idle and activatable. Exported (mirroring AppViewDialog.js's own
// `messageFor`) so it is directly testable without mounting the component.
export function prepActionState({ status, generating, hasDescription }) {
  if (status === "running" || generating) return "in-flight";
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
const DESTRUCTIVE_REGENERATE_CAPTION =
  "Regenerating replaces the pack above the moment you start — before the new one is ready. If this attempt fails, your previous content comes back on its own, and every section keeps a history of its earlier versions.";

/** The meta-actions row's Generate/Regenerate control. Never a disabled
 *  `Button` (DX §8's a11y rule) -- a blocked state replaces the button with
 *  explanatory text instead, so nothing looks interactive while silently
 *  doing nothing. `hasPack` decides ONLY the label/caption, never the
 *  action-state itself (DX §4.1: a failed regeneration leaves a pre-existing
 *  pack's content untouched, so "something to lose" tracks `hasPack`
 *  exactly the same way for a `failed` status as for `ready`/`partial`). */
function GenerateControl({ actionState, hasPack, onGenerateNow }) {
  if (actionState === "in-flight") {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, fontSize: 12.5, color: "var(--text-secondary)" }}>
        <CircularProgress size={14} />
        Generating…
      </Box>
    );
  }
  if (actionState === "no-description") {
    return (
      <Box sx={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{NO_DESCRIPTION_COPY}</Box>
    );
  }
  return (
    <Button size="small" variant="contained" sx={TOUCH_TARGET_SX} onClick={() => onGenerateNow?.()}>
      {hasPack ? "Regenerate" : "Prepare me for this interview"}
    </Button>
  );
}

/** `interviewerNames` -> the exact comma-joined text the edit field seeds
 *  itself from, and the inverse of `useApplicationDialogs.js`'s own
 *  `split(",").map(trim).filter(Boolean)` -- reused so a round trip through
 *  the field (load, no edit, Save) reproduces the identical stored list. */
function joinNames(interviewerNames) {
  return (Array.isArray(interviewerNames) ? interviewerNames.filter(Boolean) : []).join(", ");
}

function NamesStrip({ candidateName, interviewerNames, onSaveNames }) {
  // The view state itself (below) always reads `candidateName`/
  // `interviewerNames` straight off props, never off this local state -- so
  // there is nothing to keep in sync while NOT editing. The edit fields only
  // need a fresh copy of the CURRENT props at the moment editing starts,
  // which `startEditing` already sets -- an effect re-syncing them on every
  // prop change would fire even while the candidate is mid-edit and is not
  // needed for anything this component renders.
  const [editing, setEditing] = useState(false);
  const [nameField, setNameField] = useState(candidateName || "");
  const [namesField, setNamesField] = useState(joinNames(interviewerNames));

  const names = Array.isArray(interviewerNames) ? interviewerNames.filter(Boolean) : [];

  function startEditing() {
    setNameField(candidateName || "");
    setNamesField(joinNames(interviewerNames));
    setEditing(true);
  }

  function save() {
    onSaveNames?.({ candidateName: nameField, interviewerNamesText: namesField });
    setEditing(false);
  }

  if (editing) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mb: 1.5, fontSize: 12.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
          <Box component="span" sx={{ fontWeight: 700, minWidth: 84 }}>
            Your name:
          </Box>
          <TextField
            size="small"
            variant="outlined"
            value={nameField}
            onChange={(e) => setNameField(e.target.value)}
            placeholder="Your name"
            slotProps={{ htmlInput: { "aria-label": "Your name" } }}
            sx={{ flex: 1, minWidth: 160 }}
          />
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
          <Box component="span" sx={{ fontWeight: 700, minWidth: 84 }}>
            Interviewers:
          </Box>
          <TextField
            size="small"
            variant="outlined"
            value={namesField}
            onChange={(e) => setNamesField(e.target.value)}
            placeholder="Comma-separated, e.g. Priya Nair, J. Okafor"
            slotProps={{ htmlInput: { "aria-label": "Interviewer names" } }}
            sx={{ flex: 1, minWidth: 160 }}
          />
        </Box>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button size="small" variant="contained" onClick={save}>
            {COPY.saveNames}
          </Button>
          <Button size="small" onClick={() => setEditing(false)}>
            {COPY.cancelNames}
          </Button>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75, mb: 1.5, fontSize: 12.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
        <Box component="span" sx={{ fontWeight: 700 }}>
          Your name:
        </Box>
        <Box component="span">{candidateName || COPY.noCandidateName}</Box>
        <Button size="small" onClick={startEditing}>
          {candidateName ? COPY.editNames : COPY.addNames}
        </Button>
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
        <Box component="span" sx={{ fontWeight: 700 }}>
          Interviewing you:
        </Box>
        {names.length > 0 ? (
          names.map((name) => <Chip key={name} size="small" label={name} variant="outlined" />)
        ) : (
          <Box component="span">{COPY.noInterviewerNames}</Box>
        )}
        <Button size="small" onClick={startEditing}>
          {names.length > 0 ? COPY.editNames : COPY.addNames}
        </Button>
      </Box>
    </Box>
  );
}

export default function PrepPackPanel({
  pack = null,
  status = null,
  completeSections = [],
  candidateName = null,
  interviewerNames = [],
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
}) {
  const hasPack = !!pack;
  const actionState = prepActionState({ status, generating, hasDescription });
  const orphanVariant = sourcedOrphanVariant(packClaims(pack), allSupports(pack));

  return (
    <Box sx={{ fontSize: 14 }}>
      <NamesStrip candidateName={candidateName} interviewerNames={interviewerNames} onSaveNames={onSaveNames} />
      <StatusBanner status={status} pack={pack} />
      <OrphanClaimsNotice variant={orphanVariant} />
      {/* N44/AC-N44.1: unconditional -- `hasPack` no longer gates the header
       *  block. `PackSections` itself always renders all four slots, each
       *  independently falling back to `EmptySection` when its own content
       *  is absent, so the outline shows even for the `absent` state where
       *  `pack` is `null`. `hasPack` still decides everything below (the
       *  Generate/Regenerate label and the destructive-regenerate caption)
       *  -- only this one render site changes. */}
      <PackSections
        pack={pack}
        completeSections={completeSections}
        sectionsEnabled={actionState === "idle"}
        generatingSections={generatingSections}
        onRegenerateSection={onRegenerateSection}
        sectionRevisions={sectionRevisions}
        liveRevisions={liveRevisions}
        onRestoreRevision={onRestoreRevision}
      />
      <Box sx={{ mt: 1, display: "flex", flexDirection: "column", gap: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, ...WRAP_ROW_SX }}>
          <Button size="small" sx={TOUCH_TARGET_SX} onClick={() => onDownloadLog?.()}>
            Download prep log
          </Button>
          <GenerateControl actionState={actionState} hasPack={hasPack} onGenerateNow={onGenerateNow} />
        </Box>
        {actionState === "idle" && hasPack ? (
          <Box data-testid="regenerate-caption" sx={{ fontSize: 12, color: "var(--text-secondary)" }}>
            {DESTRUCTIVE_REGENERATE_CAPTION}
          </Box>
        ) : null}
        {triggerMessage ? (
          <Box role="alert" sx={{ fontSize: 12.5, color: "var(--text-secondary)", ...BREAK_LONG_WORDS_SX }}>
            {triggerMessage}
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}
