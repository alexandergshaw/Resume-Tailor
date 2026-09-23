"use client";

// N50 fix round 5 (line-cap extraction, standing rule: pure logic AND a
// cohesive, self-contained component both go to their own module before a
// comment gets trimmed or the 1000-line ceiling gets raised): NamesStrip
// moved out of PrepPackPanel.js -- its own local edit state, its own two
// render branches (view/edit), touching nothing else in that file except
// `joinNames` (./prepPackFields.js, already its own module) -- the same "S1"
// extraction pattern that already moved ./PrepSectionActions.js out of that
// file for the same reason. PrepPackPanel.js is this module's only importer.
//
// N50/Ruling 2: this is built ONCE by the caller (PrepPackPanel.js's own
// `namesStrip`) and rendered in exactly one of two positions depending on
// `hasPack` -- never two separate elements -- so a candidate mid-edit when
// the first pack lands keeps their open editor (AC-UX, H-9c).
// `data-testid="names-strip"` on both the view and edit roots is the test
// hook AC-N50.2/.9 use to exclude or locate the strip; it has no
// accessibility effect.

import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import { TOUCH_TARGET_SX } from "@/app/theme/mobileSx";
import { joinNames } from "./prepPackFields";

const COPY = {
  noCandidateName: "No name yet",
  noInterviewerNames: "No names yet",
  editNames: "Edit",
  addNames: "Add",
  saveNames: "Save",
  cancelNames: "Cancel",
};

export default function NamesStrip({ candidateName, interviewerNames, onSaveNames }) {
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
      <Box data-testid="names-strip" sx={{ display: "flex", flexDirection: "column", gap: 1, mb: 1.5, fontSize: 12.5 }}>
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
          {/* N50/plan T5: Save is no longer `contained` -- AC-N50.3 bars every
           *  filled control once a pack exists, and the edit form can be
           *  open while one does. */}
          <Button size="small" variant="outlined" sx={TOUCH_TARGET_SX} onClick={save}>
            {COPY.saveNames}
          </Button>
          <Button size="small" sx={TOUCH_TARGET_SX} onClick={() => setEditing(false)}>
            {COPY.cancelNames}
          </Button>
        </Box>
      </Box>
    );
  }

  return (
    <Box data-testid="names-strip" sx={{ display: "flex", flexDirection: "column", gap: 0.75, mb: 1.5, fontSize: 12.5, color: "var(--text-secondary)" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
        <Box component="span" sx={{ fontWeight: 700 }}>
          Your name:
        </Box>
        <Box component="span">{candidateName || COPY.noCandidateName}</Box>
        <Button size="small" sx={TOUCH_TARGET_SX} onClick={startEditing}>
          {candidateName ? COPY.editNames : COPY.addNames}
        </Button>
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
        <Box component="span" sx={{ fontWeight: 700 }}>
          {/* M6/plan section 2.1: any JSX text with an apostrophe is written as
           *  a `{"…"}` expression -- a bare one fails lib/sourceScan's
           *  tokenizeSource gate. */}
          {"Interviewers you've named:"}
        </Box>
        {names.length > 0 ? (
          names.map((name) => <Chip key={name} size="small" label={name} variant="outlined" />)
        ) : (
          <Box component="span">{COPY.noInterviewerNames}</Box>
        )}
        <Button size="small" sx={TOUCH_TARGET_SX} onClick={startEditing}>
          {names.length > 0 ? COPY.editNames : COPY.addNames}
        </Button>
      </Box>
    </Box>
  );
}
