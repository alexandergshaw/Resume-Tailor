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

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";

const COPY = {
  absent: "No prep pack yet. Generate one from this application's tracking row when you're ready.",
  running: "Generating your interview prep pack now…",
  ready: "Your interview prep pack is ready.",
  partial: "This pack is partial — some sections aren't ready yet. Generate again to try for the rest.",
  failed: "The last generation attempt failed. This may be temporary — try again when you're ready.",
  unavailable:
    "Nothing to research yet — there's no job description on this posting. This isn't a failed attempt, and trying again won't help until a description is added.",
  noCandidateName: "No name yet — Add",
  noInterviewerNames: "No names yet — Add",
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

function NamesStrip({ candidateName, interviewerNames }) {
  const names = Array.isArray(interviewerNames) ? interviewerNames.filter(Boolean) : [];
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75, mb: 1.5, fontSize: 12.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
        <Box component="span" sx={{ fontWeight: 700 }}>
          Your name:
        </Box>
        <Box component="span">{candidateName || COPY.noCandidateName}</Box>
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
}) {
  const hasPack = !!pack;

  return (
    <Box sx={{ fontSize: 14 }}>
      <NamesStrip candidateName={candidateName} interviewerNames={interviewerNames} />
      <StatusBanner status={status} pack={pack} />
      {hasPack ? <PackSections pack={pack} completeSections={completeSections} /> : null}
      <Box sx={{ mt: 1 }}>
        <Button size="small" onClick={() => onDownloadLog?.()}>
          Download prep log
        </Button>
      </Box>
    </Box>
  );
}
