"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { spokenEstimate } from "@/lib/copilot/spokenPace";
import { BREAK_LONG_WORDS_SX } from "../mobileSx";

// AC-Q9.5 - the revealed model answer: the beats a strong answer makes, how
// long it takes to say, how it should sound, the terms of art it draws on
// (marked where THIS answer actually used one), and what not to say. Then an
// honest caption naming what drafted it. Purely presentational, same split
// as SituationCard.js draws - `payload` is exactly what useRoleDrill.js's
// `reveal.payload` holds (fetchRoleResponse's response, or a cache hit of
// the same shape).
//
// AC-Q9.5's three source branches, worded so none of them can be mistaken
// for one another: "embedded" must never sound like it credits a model that
// didn't write the answer, and "fallback" must never claim the engine the
// user actually chose (Gemini) wrote it when it's the one that couldn't.
//
// A fourth, independent fact layers on top (adversarial review): every
// situation after the first carries a `generated-<hash>` id on Gemini, which
// is never in the bank, so a model failure leaves the deterministic composer
// with no beats for that specific scene and it falls back to the role's
// GENERIC ones - the user reads a scene about two engineers competing for
// one promotion and a "model answer" about a slipped deadline. The three
// captions above are honest about WHO drafted the answer but silent about
// WHETHER it is actually about the scene on screen; `situationMatched` (from
// the response, verbatim - see useRoleDrill.js) answers that second
// question, and when it's false the caption says so using the exact phrase
// "general shape" a test looks for, regardless of which of the three
// drafting captions would otherwise apply.
function sourceCaption(source, situationMatched) {
  const drafted =
    source === "gemini"
      ? "Drafted by Google Gemini."
      : source === "fallback"
        ? "Gemini could not draft this one, so it was drafted on this server instead."
        : "Drafted on this server with no AI provider.";
  if (situationMatched === false) {
    return `${drafted} This is the role's general shape, not an answer written for this exact situation.`;
  }
  return drafted;
}

export default function ModelResponse({ status, error, payload, onRetry }) {
  if (status === "loading") {
    return (
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", mt: 1.5 }}>
        <CircularProgress size={18} />
        <Typography sx={{ color: "var(--text-secondary)" }}>Drafting a model answer…</Typography>
      </Stack>
    );
  }

  if (status === "error") {
    return (
      <Alert
        severity="error"
        sx={{ mt: 1.5 }}
        action={
          <Button color="inherit" size="small" onClick={onRetry}>
            Retry
          </Button>
        }
      >
        {error || "Could not draft a model answer."}
      </Alert>
    );
  }

  if (status !== "done" || !payload) return null;

  const { lines, cadence, terms, termsUsed, avoid, source, situationMatched } = payload;
  const { words, seconds } = spokenEstimate(lines);

  return (
    <Box sx={{ mt: 1.5 }}>
      <Box component="ul" role="list" sx={{ listStyle: "none", m: 0, p: 0 }}>
        {lines.map((line, i) => (
          <Typography key={i} component="li" sx={{ mb: 0.75, ...BREAK_LONG_WORDS_SX }}>
            <strong>{line.label}:</strong> {line.text}
          </Typography>
        ))}
      </Box>

      <Typography sx={{ color: "var(--text-secondary)", mt: 1 }}>
        About {words} words - roughly {seconds} seconds at a measured pace.
      </Typography>

      <Typography variant="subtitle2" component="h4" sx={{ mt: 1.5 }}>
        How it should sound
      </Typography>
      <Box component="ul" role="list" sx={{ listStyle: "none", m: 0, p: 0 }}>
        {cadence.map((line, i) => (
          <Typography key={i} component="li" sx={{ ...BREAK_LONG_WORDS_SX }}>
            {line}
          </Typography>
        ))}
      </Box>

      <Typography variant="subtitle2" component="h4" sx={{ mt: 1.5 }}>
        Terms of art
      </Typography>
      <Box component="ul" role="list" sx={{ listStyle: "none", m: 0, p: 0 }}>
        {terms.map((entry) => {
          const used = termsUsed.includes(entry.term);
          return (
            <Typography key={entry.term} component="li" sx={{ mb: 0.5, ...BREAK_LONG_WORDS_SX }}>
              <strong>{entry.term}</strong> — signals {entry.signals}
              {used ? " (used in this answer)" : ""}
            </Typography>
          );
        })}
      </Box>

      <Typography variant="subtitle2" component="h4" sx={{ mt: 1.5 }}>
        Do not say
      </Typography>
      <Box component="ul" role="list" sx={{ listStyle: "none", m: 0, p: 0 }}>
        {avoid.map((entry) => (
          <Typography key={entry.phrase} component="li" sx={{ mb: 0.5, ...BREAK_LONG_WORDS_SX }}>
            <strong>&ldquo;{entry.phrase}&rdquo;</strong> — {entry.why}
          </Typography>
        ))}
      </Box>

      <Typography variant="caption" sx={{ color: "var(--text-secondary)", display: "block", mt: 1 }}>
        {sourceCaption(source, situationMatched)}
      </Typography>
    </Box>
  );
}
