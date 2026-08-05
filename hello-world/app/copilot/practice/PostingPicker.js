"use client";

import { useEffect, useState } from "react";
import Autocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";
import { fetchPracticePostings } from "@/lib/copilot/postings";

// Searchable picker over the user's own tracked postings (the same rows the
// Tracking tab shows). It loads its own options on mount — the caller only
// owns the current selection. Selecting nothing is a supported state:
// practice then runs against the generic question bank instead of a
// specific posting.
export default function PostingPicker({ value, onChange, disabled }) {
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
        ? "No tracked postings yet — add one from the Tracking tab. You can also leave blank to practice with generic questions."
        : "Leave blank to practice with generic questions.";
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
          label="Practice for"
          placeholder="Search your postings…"
          helperText={helperText}
          error={!!error}
        />
      )}
      sx={{ maxWidth: 480 }}
    />
  );
}
