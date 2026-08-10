"use client";

import { useEffect, useState } from "react";
import Autocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";
import { fetchPracticePostings } from "@/lib/copilot/postings";
import { TOUCH_FIELD_SX, TOUCH_ICON_SX } from "./mobileSx";

const DEFAULT_LABEL = "Practice for";
const DEFAULT_BLANK_HINT = "Leave blank to practice with generic questions.";

// AC-H1.2: the "no postings yet" message below folds `blankHint` into its
// own second sentence by lowercasing its first letter — `blankHint` is
// always phrased as a standalone sentence ("Leave blank to..."), and
// reusing it here (instead of a second, separately-worded literal) keeps
// that message from ever drifting out of sync with whichever wording the
// caller passed in.
function lowerFirst(text) {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

// Searchable picker over the user's own tracked postings (the same rows the
// Tracking tab shows). It loads its own options on mount — the caller only
// owns the current selection. Selecting nothing is a supported state: with
// nothing selected, the caller runs against generic material instead of a
// specific posting (practice mode: the generic question bank; live mode:
// the prep context alone).
//
// AC-H1.1/AC-H1.2: shared by both live mode (CopilotClient) and practice
// mode (PracticeClient, the only caller before this change) — `label` and
// `blankHint` let each mode word the field for what leaving it blank
// actually means there. Both default to exactly today's strings, so
// practice mode's rendering stays byte-identical.
export default function PostingPicker({
  value,
  onChange,
  disabled,
  label = DEFAULT_LABEL,
  blankHint = DEFAULT_BLANK_HINT,
}) {
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchPracticePostings()
      .then((rows) => {
        if (!cancelled) setOptions(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || "Could not load your postings.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  let helperText = "";
  if (error) {
    helperText = error;
  } else if (!value) {
    helperText =
      !loading && options.length === 0
        ? `No tracked postings yet — add one from the Tracking tab. You can also ${lowerFirst(blankHint)}`
        : blankHint;
  }

  // A load failure is not the same fact as "you have no tracked postings" —
  // the picker must not claim the account is empty when the query just
  // failed. The real error message is also shown as helper text below.
  let noOptionsText;
  if (error) {
    noOptionsText = "Could not load your postings — see the error below.";
  } else if (options.length === 0) {
    noOptionsText = "No tracked postings yet — add one from the Tracking tab.";
  } else {
    noOptionsText = "No postings match your search.";
  }

  return (
    <Autocomplete
      value={value || null}
      onChange={(_e, newValue) => onChange(newValue || null)}
      options={options}
      loading={loading}
      disabled={disabled}
      isOptionEqualToValue={(option, val) => option.id === val.id}
      getOptionLabel={(option) => option?.label || ""}
      noOptionsText={noOptionsText}
      renderInput={(params) => (
        <TextField
          {...params}
          size="small"
          label={label}
          placeholder="Search your postings…"
          helperText={helperText}
          error={!!error}
        />
      )}
      // Touch-target fix: the popup/clear indicators are MUI's own
      // `IconButton`s, reachable through the Autocomplete's slot API rather
      // than a DOM class selector, so `TOUCH_ICON_SX` is handed to them
      // through `slotProps` the same way it would be passed as a plain `sx`
      // prop directly on an IconButton.
      slotProps={{
        popupIndicator: { sx: TOUCH_ICON_SX },
        clearIndicator: { sx: TOUCH_ICON_SX },
      }}
      sx={{ maxWidth: 480, ...TOUCH_FIELD_SX }}
    />
  );
}
