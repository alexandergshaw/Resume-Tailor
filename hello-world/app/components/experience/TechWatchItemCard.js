"use client";

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { safeExternalHref } from "@/lib/url/safeExternalHref";

// One briefing item, addressable on its own via `data-techwatch-item` (AC-9
// / TechWatchPanel.wiring.test.js) - a test asserting what a CARD says must
// not have to scan the whole panel's textContent, which also holds the hour
// heading above it (legitimately "00:00 - 01:00" for a UTC viewer).
//
// Pure presentation: props in, nothing out, no fetching (mirrors
// FeedPostingCard.js's own split from its owning tab). The panel owns the
// data hook; this file must never import it or call fetch itself.

const CATEGORY_LABELS = { outage: "Outage", vulnerability: "Vulnerability", lifecycle: "Lifecycle" };
const SEVERITY_LABELS = { critical: "Critical", high: "High", medium: "Medium", low: "Low", info: "Info" };
// Colour is decoration on top of the word already rendered below, never the
// only signal - severity and "Actively exploited" are both spelled out in
// text regardless of what colour a viewer's monitor renders.
const SEVERITY_COLORS = { critical: "error", high: "warning", medium: "warning", low: "info", info: "default" };

function formatDayOnly(iso) {
  try {
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(
      new Date(iso),
    );
  } catch {
    return iso;
  }
}

function formatDateTime(iso) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// A blank field renders NOTHING - no heading, no "unknown", no borrowing
// another field's text (AC-9's own trap #6). `label` is only ever committed
// to the DOM when `value` is a non-empty string.
function LabeledField({ label, value }) {
  if (!value) return null;
  return (
    <Box sx={{ mt: 0.75 }}>
      <Typography sx={{ fontWeight: 600, fontSize: 12.5, color: "var(--text-secondary)" }}>{label}</Typography>
      <Typography sx={{ fontSize: 13, mt: 0.125 }}>{value}</Typography>
    </Box>
  );
}

export default function TechWatchItemCard({ item }) {
  if (!item) return null;

  const categoryLabel = CATEGORY_LABELS[item.category] || item.category;
  const severityLabel = SEVERITY_LABELS[item.severity] || item.severity;
  const severityColor = SEVERITY_COLORS[item.severity] || "default";
  const reportedLine =
    item.timePrecision === "day" ? `Reported on ${formatDayOnly(item.occurredAt)}` : formatDateTime(item.occurredAt);

  return (
    <Box
      component="article"
      data-techwatch-item
      sx={{
        border: "1px solid var(--border)",
        borderRadius: 1.5,
        p: 1.25,
        bgcolor: "var(--bg-soft)",
      }}
    >
      <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <Chip size="small" label={categoryLabel} variant="outlined" />
        <Chip size="small" label={severityLabel} color={severityColor} variant="outlined" />
        {item.exploited ? (
          <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: "var(--danger, #b91c1c)" }}>
            {`Actively exploited${item.exploitedAt ? ` since ${item.exploitedAt}` : ""}`}
          </Typography>
        ) : null}
      </Stack>

      <Typography sx={{ mt: 0.5, fontWeight: 700, fontSize: 14 }}>
        {item.technology ? `${item.technology}: ` : ""}
        {item.title}
      </Typography>

      <Typography sx={{ fontSize: 12, color: "var(--text-secondary)", mt: 0.25 }}>{reportedLine}</Typography>

      {item.affected ? (
        <Typography sx={{ fontSize: 12.5, mt: 0.5, fontFamily: "monospace" }}>{item.affected}</Typography>
      ) : null}

      <LabeledField label="Root cause" value={item.rootCause} />
      <LabeledField label="Remedy" value={item.remedy} />
      <LabeledField label="Workaround" value={item.workaround} />

      {Array.isArray(item.sources) && item.sources.length > 0 ? (
        <Box sx={{ mt: 0.75 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 12.5, color: "var(--text-secondary)" }}>
            Documentation
          </Typography>
          <Stack spacing={0.25} sx={{ mt: 0.25 }}>
            {item.sources.map((source, i) => {
              const tech = item.technology || item.sourceId || "Source";
              // Always folds in the technology name, even when the source
              // supplied its own label ("Advisory") - a briefing with six
              // cards otherwise gives a screen-reader user a link list of
              // six identical "Advisory" entries with nothing to tell them
              // apart out of context.
              const linkText = source.label ? `${tech} ${source.label}` : `${tech} reference`;
              // `source.url` is model output and has been checked by nothing
              // upstream. Refused -> the entry stays in the list as text (a
              // named source the user can look up) but is not a link, and
              // there is no anchor at all: no href="", no "#", no dead <a>.
              const href = safeExternalHref(source.url);
              return (
                <Typography key={`${href || "unlinked"}-${i}`} sx={{ fontSize: 12.5 }}>
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      {linkText}
                    </a>
                  ) : (
                    <Box component="span" sx={{ color: "var(--text-secondary)" }}>{linkText}</Box>
                  )}
                </Typography>
              );
            })}
          </Stack>
        </Box>
      ) : null}
    </Box>
  );
}
