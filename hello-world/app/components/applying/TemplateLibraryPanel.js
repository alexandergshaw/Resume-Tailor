"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";

import styles from "../../page.module.css";
import { TOUCH_TARGET_SX, BREAK_LONG_WORDS_SX } from "@/app/theme/mobileSx";

const LABEL_ID = "template-library-label";

// N151b: the template switcher -- the user's saved formatting templates as a
// radio group, the checked one being the template the next tailored document is
// poured into. Choosing a radio makes that template active; each row can also be
// deleted. `library` is the useTemplateLibrary result, owned by page.js so a
// template marked from the materials list below can refresh this panel.
//
// A native-semantics radio group on purpose: MUI's non-native Select fails
// WCAG 2.5.3 (label in name), and a Tooltip-named control loses its accessible
// name. Each radio is named by its template, each delete button by "Delete
// <template>" so a screen-reader list of buttons is not a run of identical "Delete"s.
//
// The checked radio is the EXPLICIT selection. With none, nothing is checked and
// a caption says so, rather than guessing which template the fallback would use.
export default function TemplateLibraryPanel({ kind = "resume", currentUser, library }) {
  const { templates, selectedId, loading, error, select, remove } = library;
  const noun = kind === "cover" ? "cover letters" : "résumés";
  const hasTemplates = templates.length > 0;

  return (
    <div className={styles.fieldGroup}>
      <span id={LABEL_ID} className={styles.label}>Template library</span>
      <Box sx={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
        The formatting your tailored {noun} are built into. Add one with &quot;Add to template library&quot; on a .docx material below.
      </Box>
      {!currentUser ? (
        <Box sx={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
          Sign in to save and switch templates.
        </Box>
      ) : (
        <>
          {error ? (
            <Box role="alert" sx={{ fontSize: "0.78rem", color: "var(--danger)" }}>{error}</Box>
          ) : null}
          {loading && !hasTemplates ? (
            <Box sx={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Loading templates…</Box>
          ) : null}
          {!loading && !hasTemplates && !error ? (
            <Box sx={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>No saved templates yet.</Box>
          ) : null}
          {hasTemplates ? (
            <>
              <RadioGroup
                aria-labelledby={LABEL_ID}
                value={selectedId ?? ""}
                onChange={(_event, value) => select(value)}
                sx={{ gap: 0.75 }}
              >
                {templates.map((template) => (
                  <Box
                    key={template.id}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 1,
                      border: "1px solid var(--border)",
                      borderRadius: 1.5,
                      pl: 0.75,
                      pr: 1.25,
                      py: 0.25,
                      backgroundColor: "var(--bg-soft)",
                    }}
                  >
                    <FormControlLabel
                      value={template.id}
                      control={<Radio size="small" />}
                      label={template.name}
                      sx={{
                        flex: 1,
                        minWidth: 0,
                        mr: 0,
                        ...TOUCH_TARGET_SX,
                        "& .MuiFormControlLabel-label": { fontSize: "0.85rem", fontWeight: 600, ...BREAK_LONG_WORDS_SX },
                      }}
                    />
                    <Button
                      size="small"
                      color="error"
                      aria-label={`Delete ${template.name}`}
                      onClick={() => remove(template.id)}
                      sx={{ textTransform: "none", fontSize: "0.72rem", minWidth: 0, flexShrink: 0, ...TOUCH_TARGET_SX }}
                    >
                      Delete
                    </Button>
                  </Box>
                ))}
              </RadioGroup>
              {!selectedId ? (
                <Box sx={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>
                  No template selected — new {noun} use your saved default, or the app&apos;s standard formatting.
                </Box>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
