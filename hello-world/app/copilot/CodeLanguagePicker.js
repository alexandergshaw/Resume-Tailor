"use client";

import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import { CONTROL_OPTIONS, AUTO, normalizeCodeLanguageChoice } from "@/lib/copilot/codeLanguages";
import { TOUCH_FIELD_SX, TOUCH_MUI_SELECT_SX } from "./mobileSx";
import { useCodeLanguageStorageBlocked } from "./useCodeLanguage";
import { useInterviewTypeStorageBlocked } from "./useInterviewType";

// A-21: presentational picker for the per-application code language, sibling
// to InterviewTypePicker.js and mirroring its shape line for line — same
// non-native MUI `TextField select` (CONF-3: every arrow keypress on a native
// select can fire a cache invalidation and a billed model call; nine options
// means up to nine of each, and a native select has no commit boundary),
// same sizing convention, same "the picker reads its own persistence facts"
// pattern.
//
// Props are EXACTLY `{ value, onChange, disabled }` — no focus props, no
// blocked-flag prop. The gate (AC-C2/AC-C2b) and F-C2's deferred unmount both
// live one level up, in CodeLanguageField — a component cannot defer its own
// unmount, so that decision has to sit above the element being removed.
//
// OPTION Z (§0.1 D-6 of plan-chunk-c.md), and why the storage sentence lives
// HERE rather than on a surface passing a prop down: the reconciliation's
// original ruling — compute "either store is blocked" on the surface and
// hand it down as a prop — was WITHDRAWN. `InterviewTypePicker.test.js:325`
// pins `export default function InterviewTypePicker({ value, onChange,
// disabled })` by exact regex under the comment "A prop-drilled blocked flag
// would defeat contract 10", and `useInterviewType.test.js:514-529` proves
// the picker reads its own store. Threading a fourth prop into either would
// reverse a deliberate, documented chunk-A decision. So `InterviewTypePicker`
// stays untouched, and the precedence lives here instead: this picker reads
// BOTH stores' blocked flags for itself and appends the sentence only when
// the LANGUAGE store is blocked and the INTERVIEW-TYPE store is not.
// Whenever both are blocked, the interview-type picker is already saying it
// — and this picker always co-renders alongside it (CodeLanguageField never
// mounts without InterviewTypePicker beside it), so there is never a state
// in which neither surface speaks.
//
// This is deliberately NOT the two-latch shape CONF-8 exists to warn about:
//
//   | | the chunk-A defect CONF-8 exists for | this picker |
//   |---|---|---|
//   | what holds the fact | two independent STATEFUL once-per-tab flags | two PRIMITIVE useSyncExternalStore reads, no state of their own |
//   | when it is decided | on a change, imperatively, once | at render time, deterministically, every render |
//   | how it fails | either latch could fire and disagree, and one side could consume the claim and leave the other with nothing to say | it cannot — there is no shared mutable fact to drift and nothing for either side to consume |
//
// A later reader who sees "two components both look at storage" and reaches
// to unify this into one stateful owner would be reintroducing exactly the
// shape that produced three seam defects in chunk A. Do not. And if a THIRD
// control ever needs this sentence, precedence across three is worse than a
// surface-level owner — that reopens this decision with chunk A's contract
// 10 explicitly in scope, and is not something to solve by extending the
// chain here.
//
// Helper text is three rows, and there is no fourth (§B.5): two precedence
// rows (auto / an explicit language) plus the storage sentence, appended
// rather than substituted, so a quota failure never costs the user the
// explanation of what the control does.
//
// R-6: exported (it used to be module-private) so `CodeLanguageField.js` can
// announce the exact same wording when the language store's own write fails,
// instead of a second hand-typed copy of the sentence drifting from this one.
// This picker's own render-time precedence over the VISIBLE row is untouched
// by that — see `CodeLanguageField.js`'s header for why the announcement
// could not live here instead: this component owns no local component state
// at all by design (see the "reads BOTH stores' flags for itself" case
// just below in this file's own test, which pins that fact by regex), and
// detecting a false-to-true transition needs some.
export const STORAGE_SENTENCE = "Not saved. This browser is blocking stored settings.";

export default function CodeLanguagePicker({ value, onChange, disabled }) {
  // Normalized through the shared module rather than re-declaring the
  // vocabulary here (mirrors InterviewTypePicker.js's own comment) — an
  // unrecognized `value` resolves to `AUTO` instead of rendering a select
  // with nothing selected.
  const normalized = normalizeCodeLanguageChoice(value);

  const languageBlocked = useCodeLanguageStorageBlocked();
  const typeBlocked = useInterviewTypeStorageBlocked();

  const baseHelperText =
    normalized === AUTO
      ? "Pseudocode unless a specific language is set, named in your question, or found in the posting."
      : "Preferred for code answers; a language named in the question wins.";

  const helperText =
    languageBlocked && !typeBlocked ? `${baseHelperText} ${STORAGE_SENTENCE}` : baseHelperText;

  return (
    <TextField
      select
      size="small"
      label="Code language"
      value={normalized}
      onChange={(e) => onChange(e.target.value)}
      helperText={helperText}
      disabled={disabled}
      sx={{ maxWidth: 480, width: "100%", ...TOUCH_FIELD_SX, ...TOUCH_MUI_SELECT_SX }}
    >
      {CONTROL_OPTIONS.map((option) => (
        <MenuItem key={option.value} value={option.value}>
          {option.label}
        </MenuItem>
      ))}
    </TextField>
  );
}
