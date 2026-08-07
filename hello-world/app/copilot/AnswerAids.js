"use client";

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

// AC-K1.2/AC-K1.3: the two subsections that sit UNDER a drafted answer's
// cues — the posting's own vocabulary to work in, and which role (and which
// project inside it) on the candidate's resume the answer came out of.
//
// One component, rendered by all three surfaces that show a drafted answer:
// practice mode's SampleAnswer.js, live mode's QuestionFeed.js card, and the
// shared dashboard's CurrentAnswerPanel. Three copies of this markup is
// exactly how live and practice drift into showing different things for the
// same answer — the same reasoning that pulled cleanAnswerPoints out into
// lib/copilot/answerPoints.js after its two copies had already diverged.
//
// Purely presentational: every value arrives as a prop, computed server-side
// by lib/copilot/postingBuzzwords.js and lib/copilot/resumeAnchor.js. Nothing
// here fetches, and nothing here decides what a buzzword or an aligned role
// IS — this only decides how they look.
//
// Markup is a description list rather than headings + paragraphs, on purpose.
// Each label is a term whose value sits under it, which is what `dl` means;
// and it avoids inventing a further heading level under whichever heading
// already encloses it on each of its three parents — SampleAnswer.js's
// question card title (`h3`), QuestionFeed.js's "Detected questions"
// section title (`h3`), and CopilotDashboard.js's `CurrentAnswerPanel`
// title (`h4`). Adding a heading here would either repeat a level already
// in use one step up, or push the tree to `h5` — a depth nothing else
// under `/copilot` needs (R-125) — either of which is how heading order
// gets broken.

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

function Aid({ label, children }) {
  return (
    <>
      <Typography
        component="dt"
        variant="caption"
        sx={{ color: "var(--text-secondary)", fontWeight: 700, letterSpacing: 0.2 }}
      >
        {label}
      </Typography>
      <Box component="dd" sx={{ m: 0, mb: 1 }}>
        {children}
      </Box>
    </>
  );
}

export default function AnswerAids({ buzzwords, anchor, idealProject }) {
  const terms = (Array.isArray(buzzwords) ? buzzwords : []).filter((t) => typeof t === "string" && t.trim());
  const role = roleText(anchor);
  const project = (anchor?.project || "").trim();
  // Feature 2: a short reminder of the SAME role's scope, subordinate to the
  // role line above it — never a third top-level term competing with
  // "Project to talk about" (rendered as captions under the role, not its
  // own <Aid>). BUG-K2: an ARRAY of independently-shortened phrases, one per
  // source bullet — never joined into one string, which is how two
  // different bullets got spliced into a single fabricated sentence with no
  // separator between them. Each element is rendered on its own line below.
  const description = (Array.isArray(anchor?.description) ? anchor.description : []).filter(
    (d) => typeof d === "string" && d.trim(),
  );
  // Feature 1: the kind of project a recruiter for THIS posting would
  // consider ideal, and the metrics they'd want to hear — a BENCHMARK, never
  // something the candidate did. `idealProject` is `{ shape, metrics } |
  // null` (lib/copilot/idealProject.js); an entry cached before this existed
  // carries neither field, which resolves to the same "nothing to show" as
  // no posting selected.
  const idealShape = (idealProject?.shape || "").trim();
  const idealMetrics = (Array.isArray(idealProject?.metrics) ? idealProject.metrics : []).filter(
    (m) => typeof m === "string" && m.trim(),
  );

  // Nothing to show is nothing rendered — never a header with an empty list
  // under it. No posting selected means no buzzwords; no submitted resume
  // means no role and no project; both are ordinary states, not errors.
  if (terms.length === 0 && !role && !project && !idealShape && idealMetrics.length === 0) return null;

  return (
    <Box
      component="dl"
      sx={{
        m: 0,
        mt: 1.5,
        pt: 1.5,
        borderTop: "1px solid var(--border)",
      }}
    >
      {terms.length ? (
        <Aid label="Words from the posting to work in">
          <Stack
            component="ul"
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

      {role ? (
        <Aid label={roleLabel(!!anchor?.matched, anchor?.source)}>
          <Typography variant="body2" sx={{ color: "var(--text-primary)", fontWeight: 600 }}>
            {role}
          </Typography>
          {/* Feature 2: what the role actually WAS, not just its title —
              subordinate to the role line above (smaller, muted caption)
              rather than a heading of its own, so it reads as an extra
              detail about the same role instead of a third top-level term
              competing with "Project to talk about" below. BUG-K2: each
              phrase renders on its OWN line — never joined into one string,
              which is what let two different bullets read as one spliced
              sentence. */}
          {description.map((phrase, i) => (
            <Typography
              key={i}
              variant="caption"
              sx={{ display: "block", mt: 0.25, color: "var(--text-secondary)" }}
            >
              {phrase}
            </Typography>
          ))}
        </Aid>
      ) : null}

      {project ? (
        <Aid label="Project to talk about">
          <Typography variant="body2" sx={{ color: "var(--text-primary)" }}>
            {project}
          </Typography>
        </Aid>
      ) : null}

      {/* Feature 1: what a recruiter for THIS posting would consider an
          ideal project — deliberately NOT another <Aid> row that merely
          sits next to "Project to talk about". This describes work the
          candidate did NOT do, so it borrows PredictionPanel's exact
          treatment (CopilotDashboard.js: accent border, accent-tinted
          background, an explicit chip) — the same visual language that
          already keeps a REAL question from being mistaken for a predicted
          one (AC-I3.20) — plus third-person "roles like this look for"
          wording that can never be lifted verbatim into a first-person
          answer. */}
      {idealShape || idealMetrics.length ? (
        <Aid label="Ideal project for this posting">
          <Box
            sx={{
              p: 1.25,
              borderRadius: 1.5,
              border: "1px solid var(--accent)",
              background: "var(--accent-soft)",
            }}
          >
            <Chip
              size="small"
              label="Benchmark, not from your resume"
              sx={{
                height: 18,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 0.3,
                textTransform: "uppercase",
                color: "var(--accent-contrast)",
                background: "var(--accent)",
                mb: 0.75,
              }}
            />
            {idealShape ? (
              <Typography variant="body2" sx={{ color: "var(--text-primary)" }}>
                Roles like this look for: {idealShape}.
              </Typography>
            ) : null}
            {idealMetrics.length ? (
              <Typography
                variant="body2"
                sx={{ color: "var(--text-secondary)", mt: idealShape ? 0.5 : 0 }}
              >
                Metrics to have ready: {idealMetrics.join(", ")}.
              </Typography>
            ) : null}
          </Box>
        </Aid>
      ) : null}
    </Box>
  );
}
