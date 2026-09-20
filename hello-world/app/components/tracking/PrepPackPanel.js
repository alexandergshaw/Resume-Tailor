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

function Section({ heading, children }) {
  return (
    <Box sx={{ mb: 2 }}>
      <Box component="h3" sx={{ fontSize: 13, fontWeight: 700, mb: 0.5 }}>
        {heading}
      </Box>
      {children}
    </Box>
  );
}

function AnswerSection({ name, pack }) {
  const lines = answerLines(pack, name);
  if (lines.length === 0) return null;
  return (
    <Section heading={SECTION_LABELS[name]}>
      {lines.map((line, i) => (
        <Box key={i} sx={{ fontSize: 13.5, mb: 0.5 }}>
          {line?.text}
        </Box>
      ))}
    </Section>
  );
}

function AskThemSection({ pack }) {
  const questions = askThemQuestions(pack);
  if (questions.length === 0) return null;
  return (
    <Section heading={SECTION_LABELS.askThem}>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {questions.map((question, i) => (
          <Box component="li" key={i} sx={{ fontSize: 13.5 }}>
            {question?.text}
          </Box>
        ))}
      </Box>
    </Section>
  );
}

function StagesSection({ pack }) {
  const stages = stageList(pack);
  if (stages.length === 0) return null;
  return (
    <Section heading={SECTION_LABELS.stages}>
      {stages.map((stage, i) => (
        <Box key={i} sx={{ mb: 1 }}>
          {stage?.name ? <Box sx={{ fontWeight: 600, fontSize: 13 }}>{stage.name}</Box> : null}
          {Array.isArray(stage?.questions) ? (
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {stage.questions.map((question, qi) => (
                <Box component="li" key={qi} sx={{ fontSize: 13 }}>
                  {question}
                </Box>
              ))}
            </Box>
          ) : null}
        </Box>
      ))}
    </Section>
  );
}

/** Renders only the sections `completeSections` names -- the authoritative
 *  set `prepPack.js`'s own `completeSections` already computed server-side.
 *  Never re-derives it from `pack` itself: a section present in `pack` but
 *  absent from `completeSections` (a partial pack's own missing section, or
 *  a legacy pack's orphaned top-level keys) is never rendered here, which is
 *  the exact invariant AC-N33.13/15 require. */
function PackSections({ pack, completeSections }) {
  const complete = new Set(Array.isArray(completeSections) ? completeSections : []);
  return (
    <Box>
      {complete.has("aboutYou") ? <AnswerSection name="aboutYou" pack={pack} /> : null}
      {complete.has("whyRole") ? <AnswerSection name="whyRole" pack={pack} /> : null}
      {complete.has("askThem") ? <AskThemSection pack={pack} /> : null}
      {complete.has("stages") ? <StagesSection pack={pack} /> : null}
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
const DESTRUCTIVE_REGENERATE_CAPTION = "Regenerating replaces the pack above. This can't be undone.";

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
}) {
  const hasPack = !!pack;
  const actionState = prepActionState({ status, generating, hasDescription });

  return (
    <Box sx={{ fontSize: 14 }}>
      <NamesStrip candidateName={candidateName} interviewerNames={interviewerNames} onSaveNames={onSaveNames} />
      <StatusBanner status={status} pack={pack} />
      {hasPack ? <PackSections pack={pack} completeSections={completeSections} /> : null}
      <Box sx={{ mt: 1, display: "flex", flexDirection: "column", gap: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, ...WRAP_ROW_SX }}>
          <Button size="small" sx={TOUCH_TARGET_SX} onClick={() => onDownloadLog?.()}>
            Download prep log
          </Button>
          <GenerateControl actionState={actionState} hasPack={hasPack} onGenerateNow={onGenerateNow} />
        </Box>
        {actionState === "idle" && hasPack ? (
          <Box sx={{ fontSize: 12, color: "var(--text-secondary)" }}>{DESTRUCTIVE_REGENERATE_CAPTION}</Box>
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
