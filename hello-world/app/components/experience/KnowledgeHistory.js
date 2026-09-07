"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { AnswerBlock } from "./KnowledgeQuestionBox.js";
import { BTN_SX, CAPTION_SX, SENTENCE_SX, SEP_SX, SUBHEAD_SX } from "./knowledgePanelStyles.js";

// This scope's earlier questions, newest first.
//
// ------------------------------------------------------------------------
// TWO DESTRUCTION RULES, AND THEY ARE DIFFERENT ON PURPOSE.
//
// DELETING ONE QUESTION IS ONE CLICK PLUS AN UNDO, NEVER A CONFIRM. The
// precedent is in this very directory — AttachmentPanel's own five-second
// window — and this is not an exception to the repo's confirm rule, it
// satisfies it: that rule is "confirm only when the action destroys the only
// copy", and inside the undo window nothing has been destroyed yet. An undo is
// also strictly stronger than a confirm, because a confirm protects only
// against the mis-click while an undo also covers the changed mind ten seconds
// later — at one click instead of two.
//
// CLEARING THE WHOLE SCOPE DOES CONFIRM. Per-row undo cannot restore a set the
// user can no longer enumerate: once the rows are gone there is nothing on
// screen to attach N undo notices to, and N notices would be worse than one
// confirm. The confirm is INLINE and in place, never a nested dialog — a
// second modal inside a focus trap nests two traps and makes Escape ambiguous
// — and `autoFocus` sits on the NON-destructive button, because the user
// arrived by pressing the trigger with Enter and a second Enter on a focused
// destructive button destroys everything before they have read a word.
//
// `Clear all` is not rendered at all at one row or fewer: a "Clear all" over a
// single row is a worse-labelled delete button.
//
// ------------------------------------------------------------------------
// COLLAPSED MEANS ABSENT, NOT HIDDEN. MUI's own collapsing container leaves
// its whole subtree mounted and readable in `textContent` while computing
// `visibility: hidden`, which costs the tab budget and would silence any live
// region placed inside it. A bare ternary actually removes the rows.
//
// With zero entries and nothing pending, this component renders NOTHING — no
// section, no heading, no empty state. An "Earlier questions" heading over an
// empty box is a promise the panel has not kept.

const PAGE_SIZE = 10;

export default function KnowledgeHistory({
  questions,
  hasMore,
  pages,
  open,
  onToggleOpen,
  onSelectPage,
  onDelete,
  pendingDelete,
  onUndoDelete,
  onClearAll,
}) {
  const [expandedId, setExpandedId] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const rows = Array.isArray(questions) ? questions : [];
  // The pending notice outlives the last row on purpose: removing the only
  // question must still leave its Undo reachable.
  if (rows.length === 0 && !pendingDelete) return null;

  const shown = showAll ? rows : rows.slice(0, PAGE_SIZE);

  return (
    <Box sx={SEP_SX}>
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 1, flexWrap: "wrap" }}>
        <Typography component="h4" sx={SUBHEAD_SX}>
          {`Earlier questions (${rows.length})`}
        </Typography>
        {rows.length > 0 ? (
          <Button size="small" onClick={() => onToggleOpen(!open)} aria-expanded={!!open} sx={BTN_SX}>
            {open ? "Hide earlier questions" : "Show earlier questions"}
          </Button>
        ) : null}
      </Stack>

      {pendingDelete ? (
        <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap", mt: 0.5 }}>
          {/* The question itself, not "Removed a question" — the user has to
              be able to tell WHICH one went before the window closes. */}
          <Typography sx={CAPTION_SX}>{`Removed “${pendingDelete.question}”`}</Typography>
          <Button size="small" onClick={onUndoDelete} sx={BTN_SX}>
            Undo
          </Button>
        </Stack>
      ) : null}

      {open && rows.length > 0 ? (
        <Box sx={{ mt: 0.5 }}>
          {shown.map((row) => {
            const expanded = expandedId === row.id;
            return (
              <Box key={row.id} data-kb-history-row sx={{ mt: 0.75 }}>
                <Stack direction="row" sx={{ alignItems: "flex-start", gap: 1, justifyContent: "space-between" }}>
                  <Button
                    size="small"
                    aria-expanded={expanded}
                    onClick={() => setExpandedId(expanded ? null : row.id)}
                    sx={{ ...BTN_SX, justifyContent: "flex-start", textAlign: "left", px: 0.75, py: 0.25, fontSize: 12.5 }}
                  >
                    {row.question}
                  </Button>
                  <Button
                    data-kb-history-remove
                    size="small"
                    onClick={() => onDelete(row.id)}
                    sx={{ ...BTN_SX, px: 0.75, py: 0.25, fontSize: 12.5 }}
                  >
                    Remove
                  </Button>
                </Stack>
                {expanded ? <AnswerBlock answer={row} pages={pages} onSelectPage={onSelectPage} /> : null}
              </Box>
            );
          })}

          {!showAll && rows.length > PAGE_SIZE ? (
            <Button size="small" onClick={() => setShowAll(true)} sx={{ ...BTN_SX, mt: 0.5 }}>
              {`Show all ${rows.length}`}
            </Button>
          ) : null}

          {hasMore ? (
            <Typography sx={{ ...CAPTION_SX, mt: 0.5 }}>
              Only the most recent questions for this scope are listed here.
            </Typography>
          ) : null}

          {rows.length > 1 ? (
            confirming ? (
              <Stack sx={{ mt: 1, gap: 0.5, alignItems: "flex-start" }}>
                <Typography sx={{ ...SENTENCE_SX, fontSize: 12.5 }}>
                  {`Delete all ${rows.length} questions for this scope? This cannot be undone. The downloadable log is rebuilt from these rows, so download the log first if you want a record.`}
                </Typography>
                <Stack direction="row" sx={{ gap: 1 }}>
                  <Button autoFocus size="small" onClick={() => setConfirming(false)} sx={BTN_SX}>
                    Keep them
                  </Button>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => {
                      setConfirming(false);
                      onClearAll();
                    }}
                    sx={BTN_SX}
                  >
                    {`Delete all ${rows.length}`}
                  </Button>
                </Stack>
              </Stack>
            ) : (
              <Button size="small" onClick={() => setConfirming(true)} sx={{ ...BTN_SX, mt: 1 }}>
                Clear all
              </Button>
            )
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}
