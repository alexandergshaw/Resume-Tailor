"use client";

import { useId } from "react";
import Box from "@mui/material/Box";
import { BREAK_LONG_WORDS_SX } from "@/app/theme/mobileSx";
import {
  DRAFT_KIND,
  PANEL_COPY,
  TIER,
  flagRows,
  textRows,
  tierTitle,
} from "@/lib/review/flagPresentation";
import CappedList, { LIST_RESET_SX } from "./CappedList";

// N105 Step 8-UI -- the draft-agnostic reviewer-flag list (UX-21, UX-24). N103
// (on-demand review) and N104 (weakness summary) reuse it: `draftKind` is a
// parameter, and every label and tier comes from lib/review/flagPresentation.js.
//
//   flags                    [{ category, spanId, message, excerpt, evidenceRef?,
//                               evidenceExcerpt? }]
//   unresolvedQualifications [{ requirementId?, text }]
//   draftKind                "applicationReady" | "hypothetical"
//
// `excerpt` is the offending line's TEXT and `evidenceExcerpt` the evidence
// line's: a reviewer flag carries span ids only, so the caller resolves both
// before rendering.
//
// One ROW per span (flags on the same span merge into one row with several
// labels). Groups, first to last: Confirm, requirements the resume cannot meet,
// Improve, Note; a group with nothing in it is not rendered. Each group lists at
// most 8 rows before "Show all (n)".
//
// Every quoted line (the offending line, evidence, a requirement) is marked
// `data-quoted`: it is somebody else's text, not this panel's own wording, and the
// band's clean-verdict sweep excludes it so a resume line that says "no issues"
// cannot trip it. The reviewer's `message` is NOT quoted: it is the reviewer's own
// sentence about the line, shown under the stable label.
//
// Two OPT-IN props (N104), both off by default so every existing surface renders
// exactly what it did:
//   documentLevelMissingKeyword  a missing-keyword flag is a statement about the
//                                whole document that the reviewer anchors on its
//                                first line; on, each such flag is its own row with
//                                no quoted line ("From the posting: ..."), listed
//                                before the line-level rows of its group
//   classHints                   one sentence under the Confirm and Improve titles
//                                saying what kind of finding the group holds

const REQUIREMENT_SX = {
  m: 0,
  pl: 1,
  borderLeft: "3px solid var(--border-strong)",
  color: "var(--text-primary)",
  fontSize: "0.85rem",
  ...BREAK_LONG_WORDS_SX,
};

// The offending line is clamped to about two lines; the full text stays in the
// DOM, so selecting or reading it is not affected.
const QUOTE_SX = {
  ...REQUIREMENT_SX,
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

const ROW_SX = { py: 0.75, borderTop: "1px solid var(--border)" };
const LABEL_SX = { fontWeight: 600, fontSize: "0.85rem", color: "var(--text-primary)" };
const DETAIL_SX = { fontSize: "0.8rem", color: "var(--text-secondary)", ...BREAK_LONG_WORDS_SX };
const TITLE_SX = { m: 0, fontSize: "0.8rem", fontWeight: 700, color: "var(--text-primary)" };
const HINT_SX = { m: 0, fontSize: "0.78rem", color: "var(--text-secondary)" };

// Exported so the Regenerate report titles its own groups the same way.
export function Group({ title, hint, children }) {
  const titleId = useId();
  return (
    <Box component="section" aria-labelledby={titleId} sx={{ mt: 1 }}>
      <Box component="h3" id={titleId} sx={TITLE_SX}>
        {title}
      </Box>
      {hint ? (
        <Box component="p" sx={HINT_SX}>
          {hint}
        </Box>
      ) : null}
      {children}
    </Box>
  );
}

function FlagRow({ row }) {
  return (
    <Box component="li" sx={ROW_SX}>
      {row.excerpt ? (
        <Box component="blockquote" data-quoted="true" sx={QUOTE_SX}>
          {row.excerpt}
        </Box>
      ) : null}
      <Box component="ul" role="list" sx={{ ...LIST_RESET_SX, mt: row.excerpt ? 0.5 : 0 }}>
        {row.items.map((item, index) => (
          <Box component="li" key={`${item.category}-${index}`} sx={{ mt: index === 0 ? 0 : 0.5 }}>
            <Box component="span" sx={LABEL_SX}>
              {item.label}
            </Box>
            {item.message ? (
              <Box component="span" sx={{ display: "block", ...DETAIL_SX }}>
                {item.message}
              </Box>
            ) : null}
            {item.evidence ? (
              <Box component="span" sx={{ display: "block", ...DETAIL_SX }}>
                {item.evidence.prefix}
                <Box component="q" data-quoted="true">
                  {item.evidence.text}
                </Box>
              </Box>
            ) : null}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function FlagGroup({ tier, rows, hint }) {
  if (rows.length === 0) return null;
  return (
    <Group title={tierTitle(tier)} hint={hint}>
      <CappedList items={rows} renderItem={(row) => <FlagRow key={row.key} row={row} />} />
    </Group>
  );
}

export default function ReviewFlagsPanel({
  flags = [],
  unresolvedQualifications = [],
  draftKind = DRAFT_KIND.APPLICATION_READY,
  documentLevelMissingKeyword = false,
  classHints = false,
}) {
  // flagRows is the one derivation of these rows: a surface's summary counts them
  // with the same flag it passes here, so the count is the rows listed below it.
  const rows = flagRows(flags, draftKind, documentLevelMissingKeyword);
  const byTier = (tier) => rows.filter((row) => row.tier === tier);
  const unresolved = textRows(unresolvedQualifications);
  if (rows.length === 0 && unresolved.length === 0) return null;

  return (
    <Box>
      <FlagGroup
        tier={TIER.CONFIRM}
        rows={byTier(TIER.CONFIRM)}
        hint={classHints ? PANEL_COPY.confirmHint : undefined}
      />
      {unresolved.length > 0 ? (
        <Group title={PANEL_COPY.unresolvedTitle} hint={PANEL_COPY.unresolvedHint}>
          <CappedList
            items={unresolved}
            renderItem={(item, index) => (
              <Box component="li" key={item.requirementId ?? index} sx={ROW_SX}>
                <Box component="blockquote" data-quoted="true" sx={REQUIREMENT_SX}>
                  {item.text}
                </Box>
              </Box>
            )}
          />
        </Group>
      ) : null}
      <FlagGroup
        tier={TIER.IMPROVE}
        rows={byTier(TIER.IMPROVE)}
        hint={classHints ? PANEL_COPY.improveHint : undefined}
      />
      <FlagGroup tier={TIER.NOTE} rows={byTier(TIER.NOTE)} />
    </Box>
  );
}
