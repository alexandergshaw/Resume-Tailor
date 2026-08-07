"use client";

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

// AC-K1.2/AC-K1.3: the two groups that sit UNDER a drafted answer's cues —
// what the candidate actually has (the role and project their answer came
// from), then what the posting wants (its vocabulary, and a benchmark
// project). One component, rendered by all three surfaces that show a
// drafted answer: practice mode's SampleAnswer.js, live mode's
// QuestionFeed.js card, and the shared dashboard's CurrentAnswerPanel.
// Three copies of this markup is exactly how live and practice drift into
// showing different things for the same answer — the same reasoning that
// pulled cleanAnswerPoints out into lib/copilot/answerPoints.js after its
// two copies had already diverged.
//
// Purely presentational: every value arrives as a prop, computed server-side
// by lib/copilot/postingBuzzwords.js, lib/copilot/resumeAnchor.js and
// lib/copilot/idealProject.js. Nothing here fetches, and nothing here
// decides what a buzzword or an aligned role IS — this only decides how
// they look.
//
// Markup is two description lists rather than headings + paragraphs, on
// purpose. Each label is a term whose value sits under it, which is what
// `dl` means; and it avoids inventing a further heading level under
// whichever heading already encloses it on each of its three parents —
// SampleAnswer.js's question card title (`h3`), QuestionFeed.js's "Detected
// questions" section title (`h3`), and CopilotDashboard.js's
// `CurrentAnswerPanel` title (`h4`). Adding a heading here would either
// repeat a level already in use one step up, or push the tree to `h5` — a
// depth nothing else under `/copilot` needs (R-125) — either of which is
// how heading order gets broken.
//
// The two `dl`s and the divider between them are grouped by WHOSE material
// it is, not by data type: the candidate's own role/project first, the
// posting's vocabulary and benchmark project second. Both `dl`s share one
// grid style and one row component (`Aid`) below so the two groups cannot
// visually drift apart from each other.

// Below `sm` the grid collapses to one column ordered dt, dd, dt, dd — a
// single uniform rowGap would put a label exactly as far from its OWN value
// as from the next label, and the pairing that makes this readable would
// vanish. `rowGap` is tightened at `xs` only; `Aid` below adds the matching
// top margin that reopens the gap BETWEEN pairs. At `sm` and up the grid is
// two columns (label, value side by side) so this collapse never applies.
const AID_GRID_SX = {
  display: "grid",
  gridTemplateColumns: { xs: "1fr", sm: "minmax(0, 150px) minmax(0, 1fr)" },
  columnGap: 2,
  rowGap: { xs: 0.25, sm: 1.25 },
  alignItems: "start",
  m: 0,
};

// The single margin used to separate stacked lines inside any one `dd` —
// a role line above its description phrases, or a benchmark summary above
// its metrics line. One constant so no row invents its own spacing.
const LINE_GAP = 0.5;

// The label above the role. Says plainly WHY this role is the one being
// shown: `matched: false` means nothing in the question or the draft overlaps
// any role on file, so this is simply the most recent one — calling that a
// "closest match" would be claiming a relevance that was never computed.
// `source` says plainly WHERE it came from: with no posting selected — the
// common live-mode case — the role is mined from the free-text prep-context
// textarea, not an actual résumé, and claiming "on your resume" there would
// be false. An absent/unknown source falls back to the résumé wording so
// nothing ever renders "undefined".
function roleLabel(matched, source) {
  const where = source === "prep" ? "in your prep notes" : "on your resume";
  return matched ? `Closest role ${where}` : `Most recent role ${where}`;
}

function roleText(anchor) {
  const title = (anchor?.title || "").trim();
  const company = (anchor?.company || "").trim();
  // An em dash is not spoken at default screen-reader punctuation, which
  // drops the employer relationship entirely ("Senior Engineer Acme Corp"
  // reads as two unrelated facts). "at" reads unambiguously either way.
  if (title && company) return `${title} at ${company}`;
  return title || company;
}

// The one row shape both `dl`s are built from. `ddSx` is an escape hatch
// for the single row that needs an extra visual marker (the benchmark
// project's accent rule) — every other row leaves it unset.
function Aid({ label, children, ddSx }) {
  return (
    <>
      <Typography
        component="dt"
        variant="caption"
        sx={{
          color: "var(--text-secondary)",
          fontWeight: 700,
          letterSpacing: 0.2,
          // Reopens the gap the tightened `rowGap` above closed, but only
          // ABOVE this label and only at `xs` — the first label of each
          // group must not drift down from the divider/group top, so
          // `:first-of-type` (scoped per `<dl>`, since each group is its
          // own grid container) zeroes it back out for the first row.
          mt: { xs: 1.25, sm: 0 },
          "&:first-of-type": { mt: 0 },
        }}
      >
        {label}
      </Typography>
      <Box component="dd" sx={{ m: 0, ...ddSx }}>
        {children}
      </Box>
    </>
  );
}

export default function AnswerAids({ buzzwords, anchor, idealProject }) {
  const terms = (Array.isArray(buzzwords) ? buzzwords : []).filter((t) => typeof t === "string" && t.trim());

  // A plausibility gate upstream (lib/copilot/resumeAnchor.js) can suppress
  // a résumé bullet that was mis-parsed as a job title, leaving `title` and
  // `company` both "" while `project`/`description` still carry real
  // content. `role` being falsy is therefore NOT the same thing as "nothing
  // from the résumé" — it only means there's no role LINE, which is why the
  // row below falls back to a generic "From your resume" label instead of
  // disappearing whenever description phrases are still present.
  const role = roleText(anchor);
  const project = (anchor?.project || "").trim();
  // BUG-K2: an ARRAY of independently-shortened phrases, one per source
  // bullet — never joined into one string, which is how two different
  // bullets got spliced into a single fabricated sentence with no separator
  // between them. Each element renders on its own line.
  const description = (Array.isArray(anchor?.description) ? anchor.description : []).filter(
    (d) => typeof d === "string" && d.trim(),
  );

  // The kind of project a recruiter for THIS posting would consider ideal,
  // and the metric categories they'd want to hear about — a BENCHMARK,
  // never something the candidate did. `idealProject` is
  // `{ shape, summary, metrics, project? } | null`
  // (lib/copilot/idealProject.js); an entry cached before `summary` existed
  // carries `shape` but no `summary`, so the advisory line falls back to a
  // shape-derived sentence, and an entry cached before AC-M2 carries no
  // `project` at all, so the worked example below (normalized separately,
  // just underneath) simply doesn't appear. `metrics` is category names
  // only ("adoption rate"), never figures.
  const idealSummary = (idealProject?.summary || "").trim();
  const idealShape = (idealProject?.shape || "").trim();
  const idealMetrics = (Array.isArray(idealProject?.metrics) ? idealProject.metrics : []).filter(
    (m) => typeof m === "string" && m.trim(),
  );
  const idealLine = idealSummary || (idealShape ? `Roles like this look for: ${idealShape}.` : "");

  // AC-M2: the worked example. `idealProject.project` is the only place a
  // fabricated FIGURE is ever allowed to appear (lib/copilot/idealProject.js
  // / idealProjectNarrative.js) — `shape`, `summary` and `metrics` above are
  // exactly as figure-free as they always were, unchanged. Every piece is
  // normalized independently before use, the same defensive shape the
  // `idealMetrics` filter two lines up already uses (Array.isArray guard,
  // then a non-empty-string filter): a `project` that is missing, null, or
  // carrying a non-array `sections`/`outcomes` must degrade to rendering
  // nothing here — never throw, never render an empty label. Named
  // `idealProject*` rather than `project*` on purpose: `project` above
  // (line ~128) is the candidate's OWN résumé project string ("Project to
  // talk about") and is a completely different thing.
  const idealProjectTitle = (idealProject?.project?.title || "").trim();
  const idealProjectSections = (
    Array.isArray(idealProject?.project?.sections) ? idealProject.project.sections : []
  ).filter((s) => s && typeof s.label === "string" && s.label.trim() && typeof s.body === "string" && s.body.trim());
  const idealProjectOutcomes = (
    Array.isArray(idealProject?.project?.outcomes) ? idealProject.project.outcomes : []
  ).filter(
    (o) => o && typeof o.metric === "string" && o.metric.trim() && typeof o.figure === "string" && o.figure.trim(),
  );
  // Gated on BOTH sections and outcomes surviving normalization, not
  // either alone: the contract only ever produces them together (a
  // `project` is either absent or carries exactly 4 sections and exactly 3
  // outcomes), so treating one as sufficient would let a malformed payload
  // render the invented-numbers disclosure over an empty sections list, or
  // a figure list with no problem/built/ran/landed narrative above it to
  // anchor it. Either normalization coming up short falls all the way back
  // to exactly today's rendering below — the first line, then the
  // `metrics` line — never a half-built block.
  const hasIdealProjectExample = idealProjectSections.length > 0 && idealProjectOutcomes.length > 0;

  const hasRoleRow = !!role || description.length > 0;
  const hasProjectRow = !!project;
  const hasResumeGroup = hasRoleRow || hasProjectRow;

  const hasWordsRow = terms.length > 0;
  const hasIdealRow = !!idealLine || idealMetrics.length > 0 || hasIdealProjectExample;
  const hasPostingGroup = hasWordsRow || hasIdealRow;

  // Nothing to show is nothing rendered — never a header with an empty
  // group under it. No posting selected means no posting group; no
  // submitted résumé means no résumé group; both are ordinary states, not
  // errors. A group whose every row is empty renders neither that `dl` nor
  // the divider next to it.
  if (!hasResumeGroup && !hasPostingGroup) return null;

  return (
    <Box sx={{ mt: 1.5, pt: 1.5, borderTop: "1px solid var(--border)" }}>
      {hasResumeGroup ? (
        <Box component="dl" sx={AID_GRID_SX}>
          {hasRoleRow ? (
            <Aid label={role ? roleLabel(!!anchor?.matched, anchor?.source) : "From your resume"}>
              <Stack spacing={LINE_GAP}>
                {role ? (
                  <Typography variant="body2" sx={{ color: "var(--text-primary)", fontWeight: 600 }}>
                    {role}
                  </Typography>
                ) : null}
                {description.map((phrase, i) => (
                  <Typography key={i} variant="body2" sx={{ color: "var(--text-secondary)" }}>
                    {phrase}
                  </Typography>
                ))}
              </Stack>
            </Aid>
          ) : null}

          {hasProjectRow ? (
            <Aid label="Project to talk about">
              <Typography variant="body2" sx={{ color: "var(--text-primary)" }}>
                {project}
              </Typography>
            </Aid>
          ) : null}
        </Box>
      ) : null}

      {hasResumeGroup && hasPostingGroup ? (
        // `role="separator"` is what gives this line ANY presence in the
        // accessibility tree — an empty `Box` is otherwise invisible to a
        // screen reader, so without it the grouping this redesign is built
        // around exists only in pixels. Its contrast is 1.28:1 in both
        // themes, far under WCAG 1.4.11's 3:1 floor for a meaningful
        // graphical object (raising it to --border-strong only reaches
        // 1.76:1 and still fails) — so it is deliberately decorative
        // reinforcement, not the thing carrying the grouping. The grouping
        // itself is carried by the row labels, each of which already names
        // whose material it is ("Closest role on your resume", "Words from
        // the posting to work in"). Do not "fix" this line's colour under
        // the impression it's load-bearing; it isn't, and can't be made to
        // be without failing contrast regardless.
        <Box role="separator" sx={{ my: 1.25, borderTop: "1px solid var(--border)" }} />
      ) : null}

      {hasPostingGroup ? (
        <Box component="dl" sx={AID_GRID_SX}>
          {hasWordsRow ? (
            <Aid label="Words from the posting to work in">
              <Stack
                component="ul"
                // `listStyle: "none"` below strips Safari/VoiceOver's implicit
                // `list` role along with the bullet glyphs — documented WebKit
                // behaviour, not a MUI quirk — which is what silently turns
                // this into loose, uncounted text for a screen reader user:
                // no "list, N items" announcement, no sense that these chips
                // form a set. The `Chip`s below already carry `component="li"`
                // (the matching `listitem` role), so restoring just the `list`
                // role here is what makes this a list again. Do not delete
                // this as "redundant with the ul tag" — the redundancy is the
                // point; `listStyle: none` is exactly what breaks it.
                role="list"
                direction="row"
                spacing={0.75}
                sx={{ flexWrap: "wrap", rowGap: 0.75, listStyle: "none", m: 0, p: 0 }}
              >
                {terms.map((term) => (
                  <Chip
                    key={term}
                    component="li"
                    size="small"
                    label={term}
                    sx={{
                      height: "auto",
                      fontSize: 12,
                      color: "var(--text-primary)",
                      background: "var(--bg-surface)",
                      border: "1px solid var(--text-muted)",
                      "& .MuiChip-label": {
                        overflow: "visible",
                        whiteSpace: "normal",
                        textOverflow: "clip",
                        py: 0.5,
                      },
                    }}
                  />
                ))}
              </Stack>
            </Aid>
          ) : null}

          {/* The one benchmark row in the component — describes work the
              candidate did NOT do, so the disclosure has to survive contact
              with a screen reader no matter what. It can't live in the `dt`
              alone: both `<dl>`s above use `display: grid` (AID_GRID_SX),
              which drops the `<dl>`'s description-list role in WebKit, and
              on that engine an orphaned `dt` is just a bare text run with no
              programmatic tie to the value it's warning about. That isn't a
              theoretical gap — practice mode renders this exact component on
              SampleAnswer.js and CurrentAnswerPanel (via PracticeClient.js)
              and captures with `getUserMedia`, which Safari supports fully,
              so Safari/VoiceOver is a supported route here, not just live
              mode's Chrome/Edge-only `getDisplayMedia` path. So the
              disclosure is duplicated in the `dd` itself, where it needs no
              list semantics to reach the value it governs — the `dt` below
              is now a plain label ("Ideal project for this posting", no em
              dash: an em dash is not spoken at default screen-reader
              punctuation, so it would run the label's two halves together
              and lose the contrast the punctuation was carrying — the
              period ending the disclosure sentence below IS spoken as a
              pause). This is the only accent device in the component, and it
              never relies on colour alone (WCAG 1.4.1): the text carries the
              same warning the rule does. */}
          {hasIdealRow ? (
            <Aid label="Ideal project for this posting" ddSx={{ borderLeft: "2px solid var(--accent)", pl: 1.25 }}>
              <Stack spacing={LINE_GAP}>
                <Typography variant="body2" sx={{ color: "var(--text-primary)" }}>
                  <strong>Not from your resume.</strong>
                  {idealLine ? ` ${idealLine}` : ""}
                </Typography>
                {hasIdealProjectExample ? (
                  // AC-M2's own disclosure, governed by the SAME rule the
                  // comment above this row already explains at length: it
                  // must sit in the `dd`, in DOM order before the first
                  // figure (the first one arrives several lines down, in
                  // the outcomes list), and never live only in a `dt` —
                  // this component's `<dl>`s are `display: grid`, which
                  // drops the description-list role in WebKit, so an
                  // orphaned `dt` there is just unattached text. "invented"
                  // carries the warning; the sentence after it says what to
                  // do about it. Period, not an em dash, between the two —
                  // an em dash is not spoken at default screen-reader
                  // punctuation, the same lesson R-136 already paid for
                  // once on this exact row.
                  <Typography variant="body2" sx={{ color: "var(--text-primary)" }}>
                    <strong>A worked example, invented.</strong> The numbers
                    below are made up, to show what a strong answer for this
                    posting sounds like. Replace every one of them with your
                    own.
                  </Typography>
                ) : null}
                {hasIdealProjectExample && idealProjectTitle ? (
                  <Typography variant="body2" sx={{ color: "var(--text-primary)", fontWeight: 600 }}>
                    {idealProjectTitle}
                  </Typography>
                ) : null}
                {hasIdealProjectExample
                  ? idealProjectSections.map((section, i) => (
                      // Bold (not colour) distinguishes the label from its
                      // body — WCAG 1.4.1, the same rule the rest of this
                      // row already rests on. A period follows the label,
                      // never an em dash, for the same spoken-punctuation
                      // reason as everywhere else here.
                      <Typography key={i} variant="body2" sx={{ color: "var(--text-primary)" }}>
                        <strong>{section.label}.</strong> {section.body}
                      </Typography>
                    ))
                  : null}
                {hasIdealProjectExample ? (
                  // A real `<ul>`/`<li>` list — markers left INTACT, unlike
                  // the buzzword `Stack` above, which strips its markers
                  // with `listStyle: "none"` and puts the `list` role back
                  // explicitly because MUI's `Stack` isn't a `ul` to begin
                  // with. This IS one already, so doing the same thing here
                  // would remove the only signal telling a screen reader
                  // it's a list, with nothing here to restore the role
                  // (R-136). `pl: 2.5`, not the browser default
                  // `padding-inline-start` (~40px), so the markers clear
                  // this row's own accent rule instead of shoving every
                  // line in the row well to the right of its neighbours.
                  <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                    {idealProjectOutcomes.map((outcome, i) => (
                      <Typography key={i} component="li" variant="body2" sx={{ color: "var(--text-primary)" }}>
                        <strong>{outcome.metric}</strong>: {outcome.figure}
                      </Typography>
                    ))}
                  </Box>
                ) : null}
                {!hasIdealProjectExample && idealMetrics.length ? (
                  // R-130's term-list echo: once the outcomes list above
                  // renders, it already gives every one of these same
                  // category names a worked figure, two lines closer to the
                  // reader — so this line renders ONLY when there is no
                  // worked example to say it better (no `project` on the
                  // payload, or a malformed one), which is exactly today's
                  // behaviour for an entry cached before AC-M2.
                  <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
                    Metrics to have ready: {idealMetrics.join(", ")}.
                  </Typography>
                ) : null}
              </Stack>
            </Aid>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}
