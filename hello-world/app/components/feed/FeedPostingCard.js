"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";
import CircularProgress from "@mui/material/CircularProgress";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import DescriptionIcon from "@mui/icons-material/Description";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import { parseSalary, formatSalary } from "@/lib/feed/salary";
import {
  REMOTE_LABELS,
  sourceLabel,
  sourceProvenance,
  formatRelative,
} from "@/lib/feed/liveFeedClient";

// One posting in the Live Feed. Extracted out of LiveFeedTab.js as MARKUP
// only -- purely presentational (props in, callbacks out, no state, no
// network); every handler still lives in LiveFeedTab.js and is passed in
// unchanged.
//
// Accessibility fixes made here (found by reading the markup, not a
// checklist recital -- see docs/REGRESSION.md R-209 for the source-label
// half of this):
//   - Each icon button used to sit inside a <span> (needed so a disabled
//     button can still show its MUI Tooltip). Tooltip labels its DIRECT
//     child, so the span picked up the tooltip and the button underneath
//     stayed nameless. Every control below gets an explicit aria-label on
//     the button/link itself, not the wrapping span.
//   - Forty cards used to produce forty controls all named "Hide"; each name
//     below includes the posting title so a list of them is distinguishable,
//     and stays distinct within a single card (Open / Tailor / Auto Fill /
//     Hide never collide).
//   - The title is an <h3> -- TabHeader renders the tab's own h2, so a card
//     title one level down is an h3 -- rather than a styled Box, so the feed
//     can be navigated by heading. The card itself is an <article>, not a
//     bare div.
//   - remote_type and posting.source rendered raw before this; both go
//     through a label map now (REMOTE_LABELS / sourceLabel) so colour is
//     never the only signal and no database value reaches the screen.
export default function FeedPostingCard({
  posting,
  busy,
  canTailor,
  currentUser,
  nowTs,
  onTailor,
  onAutoFill,
  onHide,
}) {
  const title = posting.title || "Untitled role";

  // Prefer the salary columns populated during ingestion; for any posting
  // still missing them (older rows predate the columns), fall back to
  // parsing the snippet. Pre-existing behavior that must survive extraction.
  let salaryMin = posting.salary_min;
  let salaryMax = posting.salary_max;
  if (salaryMin == null && salaryMax == null) {
    const parsed = parseSalary(posting.description_snippet || "");
    salaryMin = parsed.min;
    salaryMax = parsed.max;
  }
  const salaryLabel = formatSalary(salaryMin, salaryMax);

  const remoteLabel =
    posting.remote_type && posting.remote_type !== "unknown"
      ? REMOTE_LABELS[posting.remote_type] || posting.remote_type
      : "";

  // "" for every source except ai_search -- see sourceProvenance's own
  // comment for why it must not overstate what verification happened.
  const provenance = sourceProvenance(posting.source);

  return (
    <Box
      component="article"
      sx={{
        border: "1px solid var(--border)",
        borderRadius: 1.5,
        p: 1.5,
        display: "flex",
        gap: 1.5,
        alignItems: "flex-start",
        bgcolor: "background.paper",
        transition: "box-shadow 120ms ease",
        "&:hover": { boxShadow: 2 },
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, flexWrap: "wrap" }}>
          <Typography
            component="h3"
            sx={{ fontWeight: 700, fontSize: "0.98rem", color: "text.primary", m: 0 }}
          >
            {title}
          </Typography>
          <Box sx={{ color: "text.secondary", fontSize: "0.88rem" }}>
            {posting.company || "—"}
          </Box>
        </Box>

        <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", mt: 0.5, alignItems: "center" }}>
          {salaryLabel && (
            <Chip
              size="small"
              label={salaryLabel}
              sx={{
                fontWeight: 700,
                bgcolor: "var(--success-soft)",
                color: "var(--success)",
                border: "1px solid var(--success-soft)",
              }}
            />
          )}
          {posting.location && <Chip size="small" label={posting.location} variant="outlined" />}
          {remoteLabel && (
            <Chip
              size="small"
              label={remoteLabel}
              color={posting.remote_type === "remote" ? "success" : "default"}
              variant="outlined"
            />
          )}
          <Chip size="small" label={sourceLabel(posting.source)} variant="outlined" />
          {posting.posted_at && (
            <Box sx={{ fontSize: "0.78rem", color: "text.secondary" }}>
              {formatRelative(posting.posted_at, nowTs)}
            </Box>
          )}
        </Box>

        {provenance && (
          <Typography
            sx={{ mt: 0.5, fontSize: "0.72rem", color: "text.secondary", fontStyle: "italic" }}
          >
            {provenance}
          </Typography>
        )}

        {posting.description_snippet && (
          <Box
            sx={{
              mt: 0.75,
              fontSize: "0.84rem",
              color: "text.secondary",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {posting.description_snippet}
          </Box>
        )}
      </Box>

      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
        {posting.url && (
          <Tooltip title="Open posting">
            <IconButton
              size="small"
              component="a"
              href={posting.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${title}`}
            >
              <OpenInNewIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip
          title={canTailor ? "Tailor Resume and Cover Letter" : "Upload a resume first to tailor"}
        >
          <span>
            <IconButton
              size="small"
              disabled={!currentUser || !canTailor || busy}
              onClick={() => onTailor(posting)}
              color="primary"
              aria-label={`Tailor ${title}`}
            >
              {busy ? <CircularProgress size={18} /> : <DescriptionIcon fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Open the posting and copy the autofill bookmarklet">
          <span>
            <Button
              size="small"
              variant="outlined"
              disabled={!currentUser || busy || !posting.url}
              onClick={() => onAutoFill(posting)}
              aria-label={`Auto Fill ${title}`}
              sx={{ textTransform: "none", minWidth: 0, px: 1, py: 0.25, fontSize: "0.72rem" }}
            >
              Auto Fill
            </Button>
          </span>
        </Tooltip>
        <Tooltip title="Hide">
          <span>
            <IconButton
              size="small"
              disabled={!currentUser || busy}
              onClick={() => onHide(posting)}
              aria-label={`Hide ${title}`}
            >
              <VisibilityOffIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
}
