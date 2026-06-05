"use client";

import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Slider from "@mui/material/Slider";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";

import { createClient } from "../../lib/supabase/client";
import styles from "../page.module.css";

const AGGRESSIVENESS_MARKS = [
  { value: 1, label: "Light" },
  { value: 3, label: "Balanced" },
  { value: 5, label: "Strong" },
];

export default function ApplyingControls({
  currentUser,
  resumeFile,
  setResumeFile,
  coverLetterFile,
  setCoverLetterFile,
  contextPanelOpen,
  setContextPanelOpen,
  aggressiveness,
  setAggressiveness,
  additionalContext,
  setAdditionalContext,
  setContextFiles,
  referencesOpen,
  setReferencesOpen,
  references,
  addReference,
  updateReference,
  removeReference,
  copyReferenceBlock,
  formatReferenceBlock,
  referenceCopiedId,
  copyAllReferences,
  formatAllReferences,
  allReferencesCopied,
  educationOpen,
  setEducationOpen,
  educationEntries,
  addEducationEntry,
  updateEducationEntry,
  removeEducationEntry,
  copyEducationBlock,
  formatEducationBlock,
  educationCopiedId,
  copyAllEducation,
  formatAllEducation,
  allEducationCopied,
  employmentOpen,
  setEmploymentOpen,
  employmentEntries,
  addEmploymentEntry,
  updateEmploymentEntry,
  removeEmploymentEntry,
  copyEmploymentBlock,
  formatEmploymentBlock,
  employmentCopiedId,
  copyAllEmployment,
  formatAllEmployment,
  allEmploymentCopied,
  renderCopyButton,
}) {
  return (
    <>
      <div className={styles.fieldGroup}>
        <label htmlFor="resume" className={styles.label}>
          Resume
        </label>
        <input
          id="resume"
          name="resume"
          type="file"
          className={styles.fileInput}
          accept=".txt,.md,.markdown,.docx"
          onChange={async (event) => {
            const file = event.target.files?.[0] || null;
            setResumeFile(file);
            if (file && currentUser) {
              const supabase = createClient();
              await supabase.storage
                .from("resumes")
                .upload(`${currentUser.id}/resume`, file, { upsert: true });
            }
          }}
        />
        {resumeFile && (
          <>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
              Last uploaded: {resumeFile.name}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              Unless you upload a different resume file, this will be used for all tailoring and downloads.
            </div>
          </>
        )}
      </div>

      <div className={styles.fieldGroup}>
        <label htmlFor="cover-letter" className={styles.label}>
          Cover Letter
        </label>
        <input
          id="cover-letter"
          name="coverLetter"
          type="file"
          className={styles.fileInput}
          accept=".txt,.md,.markdown,.docx"
          onChange={async (event) => {
            const file = event.target.files?.[0] || null;
            setCoverLetterFile(file);
            if (file && currentUser) {
              const supabase = createClient();
              await supabase.storage
                .from("resumes")
                .upload(`${currentUser.id}/cover-letter`, file, { upsert: true });
            }
          }}
        />
        {coverLetterFile && (
          <>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
              Last uploaded: {coverLetterFile.name}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              Unless you upload a different cover letter file, this will be used for all tailoring and downloads.
            </div>
          </>
        )}
      </div>

      <div className={styles.fieldGroup}>
        <label htmlFor="add-context-header" className={styles.label}>
          Add Context
        </label>
        <Accordion
          disableGutters
          elevation={0}
          expanded={contextPanelOpen}
          onChange={(_event, expanded) => setContextPanelOpen(expanded)}
          sx={{
            border: "1px solid var(--border-strong)",
            borderRadius: "12px !important",
            overflow: "hidden",
            backgroundColor: "var(--bg-surface)",
            "&::before": { display: "none" },
          }}
        >
          <AccordionSummary
            aria-controls="add-context-content"
            id="add-context-header"
            expandIcon={(
              <Box
                component="span"
                sx={{
                  fontSize: "0.95rem",
                  lineHeight: 1,
                  color: "var(--text-secondary)",
                }}
              >
                ▾
              </Box>
            )}
            sx={{
              minHeight: 0,
              px: 1.75,
              py: 0.25,
              "& .MuiAccordionSummary-content": {
                my: 1,
                font: "inherit",
                fontSize: "0.9rem",
                color: "var(--text-secondary)",
                fontWeight: 400,
              },
            }}
          >
            <Box component="span">
              {contextPanelOpen ? "Hide options" : "Show options"}
            </Box>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 1.5, pb: 2, px: 1.75, display: "grid", gap: 2.25, borderTop: "1px solid var(--border)" }}>
            <div className={styles.fieldGroup}>
              <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <label htmlFor="aggressiveness" className={styles.label}>
                  Aggressiveness
                </label>
              </Box>
              <Box sx={{ px: 1, pt: 0.25, pb: 1.5 }}>
                <Slider
                  id="aggressiveness"
                  min={1}
                  max={5}
                  step={1}
                  marks={AGGRESSIVENESS_MARKS}
                  value={aggressiveness}
                  valueLabelDisplay="off"
                  onChange={(_event, value) => setAggressiveness(Array.isArray(value) ? value[0] : value)}
                  sx={{
                    color: "var(--accent)",
                    height: 3,
                    padding: "10px 0",
                    "& .MuiSlider-rail": {
                      opacity: 1,
                      backgroundColor: "var(--border-strong)",
                      height: 3,
                    },
                    "& .MuiSlider-track": {
                      border: "none",
                      height: 3,
                    },
                    "& .MuiSlider-thumb": {
                      width: 12,
                      height: 12,
                      backgroundColor: "var(--accent)",
                      boxShadow: "none",
                      "&:hover, &.Mui-focusVisible": {
                        boxShadow: "0 0 0 6px rgba(13, 74, 143, 0.10)",
                      },
                      "&.Mui-active": {
                        boxShadow: "0 0 0 8px rgba(13, 74, 143, 0.14)",
                      },
                    },
                    "& .MuiSlider-mark": {
                      width: 3,
                      height: 3,
                      borderRadius: "999px",
                      backgroundColor: "var(--border-strong)",
                      opacity: 1,
                    },
                    "& .MuiSlider-markActive": {
                      backgroundColor: "var(--accent)",
                      opacity: 0.6,
                    },
                    "& .MuiSlider-markLabel": {
                      fontSize: "0.78rem",
                      color: "var(--text-secondary)",
                      top: 20,
                    },
                    "& .MuiSlider-markLabelActive": {
                      color: "var(--text-primary)",
                    },
                  }}
                />
              </Box>
            </div>

            <div className={styles.fieldGroup}>
              <label htmlFor="additional-context" className={styles.label}>
                Additional Context
              </label>
              <textarea
                id="additional-context"
                name="additionalContext"
                className={`${styles.textarea} ${styles.contextTextarea}`}
                placeholder="Add extra direction for Gemini (priority skills, key achievements to emphasize, domain specifics, preferred wording, etc.)"
                value={additionalContext}
                onChange={(e) => setAdditionalContext(e.target.value)}
              />
            </div>

            <div className={styles.fieldGroup}>
              <label htmlFor="context-files" className={styles.label}>
                Supporting Files
              </label>
              <input
                id="context-files"
                name="contextFiles"
                type="file"
                multiple
                className={styles.fileInput}
                accept=".txt,.md,.markdown,.docx"
                onChange={(event) => setContextFiles(Array.from(event.target.files || []))}
              />
            </div>
          </AccordionDetails>
        </Accordion>
      </div>

      <div className={styles.fieldGroup}>
        <label htmlFor="references-header" className={styles.label}>
          References
        </label>
        <Accordion
          disableGutters
          elevation={0}
          expanded={referencesOpen}
          onChange={(_event, expanded) => setReferencesOpen(expanded)}
          sx={{
            border: "1px solid var(--border-strong)",
            borderRadius: "12px !important",
            overflow: "hidden",
            backgroundColor: "var(--bg-surface)",
            "&::before": { display: "none" },
          }}
        >
          <AccordionSummary
            aria-controls="references-content"
            id="references-header"
            expandIcon={(
              <Box
                component="span"
                sx={{
                  fontSize: "0.95rem",
                  lineHeight: 1,
                  color: "var(--text-secondary)",
                }}
              >
                ▾
              </Box>
            )}
            sx={{
              minHeight: 0,
              px: 1.75,
              py: 0.25,
              "& .MuiAccordionSummary-content": {
                my: 1,
                font: "inherit",
                fontSize: "0.9rem",
                color: "var(--text-secondary)",
                fontWeight: 400,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 1,
              },
            }}
          >
            <Box component="span">
              {referencesOpen
                ? `Hide references${references.length ? ` (${references.length})` : ""}`
                : `Show references${references.length ? ` (${references.length})` : ""}`}
            </Box>
            <Tooltip title={allReferencesCopied ? "Copied!" : "Copy all references"}>
              <span onClick={(e) => { e.stopPropagation(); }} onFocus={(e) => e.stopPropagation()}>
                <IconButton
                  size="small"
                  disabled={!formatAllReferences()}
                  onClick={(e) => { e.stopPropagation(); copyAllReferences(); }}
                  sx={{ p: 0.5, color: allReferencesCopied ? "#2e7d32" : "var(--text-secondary)" }}
                  aria-label="Copy all references"
                >
                  {allReferencesCopied ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  )}
                </IconButton>
              </span>
            </Tooltip>
          </AccordionSummary>
          <AccordionDetails
            sx={{
              pt: 1.5,
              pb: 2,
              px: 1.75,
              display: "flex",
              flexDirection: "column",
              gap: 1.5,
              borderTop: "1px solid var(--border)",
            }}
          >
            {references.length === 0 ? (
              <Box sx={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                No references saved yet. Add one to keep their contact details ready to copy.
              </Box>
            ) : null}

            {references.map((ref) => {
              const headerLabel = ref.name?.trim()
                || ref.title?.trim()
                || ref.company?.trim()
                || "Untitled reference";
              const copied = referenceCopiedId === ref.id;
              return (
                <Box
                  key={ref.id}
                  sx={{
                    border: "1px solid var(--border)",
                    borderRadius: 2,
                    p: 1.5,
                    display: "flex",
                    flexDirection: "column",
                    gap: 1,
                    backgroundColor: "var(--bg-soft, #fbfdff)",
                  }}
                >
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 1,
                    }}
                  >
                    <Box sx={{ fontWeight: 600, fontSize: "0.9rem" }}>{headerLabel}</Box>
                    <Box sx={{ display: "flex", gap: 0.75 }}>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => copyReferenceBlock(ref)}
                        disabled={!formatReferenceBlock(ref)}
                        sx={{ textTransform: "none", fontSize: "0.75rem", py: 0.25, minWidth: 0 }}
                      >
                        {copied ? "Copied!" : "Copy"}
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        onClick={() => removeReference(ref.id)}
                        sx={{ textTransform: "none", fontSize: "0.75rem", py: 0.25, minWidth: 0 }}
                      >
                        Remove
                      </Button>
                    </Box>
                  </Box>
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                      gap: 1,
                    }}
                  >
                    <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                      <TextField
                        fullWidth
                        size="small"
                        label="Name"
                        value={ref.name}
                        onChange={(e) => updateReference(ref.id, "name", e.target.value)}
                      />
                      {renderCopyButton(`ref:${ref.id}:name`, ref.name)}
                    </Box>
                    <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                      <TextField
                        fullWidth
                        size="small"
                        label="Title"
                        value={ref.title}
                        onChange={(e) => updateReference(ref.id, "title", e.target.value)}
                      />
                      {renderCopyButton(`ref:${ref.id}:title`, ref.title)}
                    </Box>
                    <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                      <TextField
                        fullWidth
                        size="small"
                        label="Company"
                        value={ref.company}
                        onChange={(e) => updateReference(ref.id, "company", e.target.value)}
                      />
                      {renderCopyButton(`ref:${ref.id}:company`, ref.company)}
                    </Box>
                    <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                      <TextField
                        fullWidth
                        size="small"
                        label="Relationship"
                        value={ref.relationship}
                        onChange={(e) => updateReference(ref.id, "relationship", e.target.value)}
                      />
                      {renderCopyButton(`ref:${ref.id}:relationship`, ref.relationship)}
                    </Box>
                    <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                      <TextField
                        fullWidth
                        size="small"
                        label="Email"
                        value={ref.email}
                        onChange={(e) => updateReference(ref.id, "email", e.target.value)}
                      />
                      {renderCopyButton(`ref:${ref.id}:email`, ref.email)}
                    </Box>
                    <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                      <TextField
                        fullWidth
                        size="small"
                        label="Phone"
                        value={ref.phone}
                        onChange={(e) => updateReference(ref.id, "phone", e.target.value)}
                      />
                      {renderCopyButton(`ref:${ref.id}:phone`, ref.phone)}
                    </Box>
                  </Box>
                  <Box sx={{ display: "flex", gap: 0.5, alignItems: "flex-start" }}>
                    <TextField
                      fullWidth
                      size="small"
                      label="Notes"
                      value={ref.notes}
                      onChange={(e) => updateReference(ref.id, "notes", e.target.value)}
                      multiline
                      minRows={2}
                    />
                    {renderCopyButton(`ref:${ref.id}:notes`, ref.notes, { alignTop: true })}
                  </Box>
                </Box>
              );
            })}

            <Box>
              <Button
                size="small"
                variant="outlined"
                onClick={addReference}
                sx={{ textTransform: "none", fontSize: "0.8rem" }}
              >
                + Add reference
              </Button>
            </Box>
          </AccordionDetails>
        </Accordion>
      </div>

      <div className={styles.fieldGroup}>
        <label htmlFor="education-header" className={styles.label}>
          Education
        </label>
        <Accordion
          disableGutters
          elevation={0}
          expanded={educationOpen}
          onChange={(_event, expanded) => setEducationOpen(expanded)}
          sx={{
            border: "1px solid var(--border-strong)",
            borderRadius: "12px !important",
            overflow: "hidden",
            backgroundColor: "var(--bg-surface)",
            "&::before": { display: "none" },
          }}
        >
          <AccordionSummary
            aria-controls="education-content"
            id="education-header"
            expandIcon={(
              <Box
                component="span"
                sx={{
                  fontSize: "0.95rem",
                  lineHeight: 1,
                  color: "var(--text-secondary)",
                }}
              >
                ▾
              </Box>
            )}
            sx={{
              minHeight: 0,
              px: 1.75,
              py: 0.25,
              "& .MuiAccordionSummary-content": {
                my: 1,
                font: "inherit",
                fontSize: "0.9rem",
                color: "var(--text-secondary)",
                fontWeight: 400,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 1,
              },
            }}
          >
            <Box component="span">
              {educationOpen
                ? `Hide education${educationEntries.length ? ` (${educationEntries.length})` : ""}`
                : `Show education${educationEntries.length ? ` (${educationEntries.length})` : ""}`}
            </Box>
            <Tooltip title={allEducationCopied ? "Copied!" : "Copy all education"}>
              <span onClick={(e) => { e.stopPropagation(); }} onFocus={(e) => e.stopPropagation()}>
                <IconButton
                  size="small"
                  disabled={!formatAllEducation()}
                  onClick={(e) => { e.stopPropagation(); copyAllEducation(); }}
                  sx={{ p: 0.5, color: allEducationCopied ? "#2e7d32" : "var(--text-secondary)" }}
                  aria-label="Copy all education"
                >
                  {allEducationCopied ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  )}
                </IconButton>
              </span>
            </Tooltip>
          </AccordionSummary>
          <AccordionDetails
            sx={{
              pt: 1.5,
              pb: 2,
              px: 1.75,
              display: "flex",
              flexDirection: "column",
              gap: 1.5,
              borderTop: "1px solid var(--border)",
            }}
          >
            {educationEntries.length === 0 ? (
              <Box sx={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                No education entries saved yet. Add one to keep your school details ready to copy.
              </Box>
            ) : null}

            {educationEntries.map((entry) => {
              const headerLabel = entry.school?.trim()
                || entry.degree?.trim()
                || entry.field?.trim()
                || "Untitled school";
              const copied = educationCopiedId === entry.id;
              return (
                <Box
                  key={entry.id}
                  sx={{
                    border: "1px solid var(--border)",
                    borderRadius: 2,
                    p: 1.5,
                    display: "flex",
                    flexDirection: "column",
                    gap: 1,
                    backgroundColor: "var(--bg-soft, #fbfdff)",
                  }}
                >
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 1,
                    }}
                  >
                    <Box sx={{ fontWeight: 600, fontSize: "0.9rem" }}>{headerLabel}</Box>
                    <Box sx={{ display: "flex", gap: 0.75 }}>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => copyEducationBlock(entry)}
                        disabled={!formatEducationBlock(entry)}
                        sx={{ textTransform: "none", fontSize: "0.75rem", py: 0.25, minWidth: 0 }}
                      >
                        {copied ? "Copied!" : "Copy"}
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        onClick={() => removeEducationEntry(entry.id)}
                        sx={{ textTransform: "none", fontSize: "0.75rem", py: 0.25, minWidth: 0 }}
                      >
                        Remove
                      </Button>
                    </Box>
                  </Box>
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                      gap: 1,
                    }}
                  >
                    <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                      <TextField
                        fullWidth
                        size="small"
                        label="School"
                        value={entry.school}
                        onChange={(e) => updateEducationEntry(entry.id, "school", e.target.value)}
                      />
                      {renderCopyButton(`edu:${entry.id}:school`, entry.school)}
                    </Box>
                    <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                      <TextField
                        fullWidth
                        size="small"
                        label="Degree"
                        value={entry.degree}
                        onChange={(e) => updateEducationEntry(entry.id, "degree", e.target.value)}
                      />
                      {renderCopyButton(`edu:${entry.id}:degree`, entry.degree)}
                    </Box>
                    <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                      <TextField
                        fullWidth
                        size="small"
                        label="Field of study"
                        value={entry.field}
                        onChange={(e) => updateEducationEntry(entry.id, "field", e.target.value)}
                      />
                      {renderCopyButton(`edu:${entry.id}:field`, entry.field)}
                    </Box>
                    <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                      <TextField
                        fullWidth
                        size="small"
                        label="Location"
                        value={entry.location}
                        onChange={(e) => updateEducationEntry(entry.id, "location", e.target.value)}
                      />
                      {renderCopyButton(`edu:${entry.id}:location`, entry.location)}
                    </Box>
                    <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                      <TextField
                        fullWidth
                        size="small"
                        label="Start (e.g. Aug 2018)"
                        value={entry.startDate}
                        onChange={(e) => updateEducationEntry(entry.id, "startDate", e.target.value)}
                      />
                      {renderCopyButton(`edu:${entry.id}:startDate`, entry.startDate)}
                    </Box>
                    <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                      <TextField
                        fullWidth
                        size="small"
                        label="End (e.g. May 2022)"
                        value={entry.endDate}
                        onChange={(e) => updateEducationEntry(entry.id, "endDate", e.target.value)}
                      />
                      {renderCopyButton(`edu:${entry.id}:endDate`, entry.endDate)}
                    </Box>
                    <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                      <TextField
                        fullWidth
                        size="small"
                        label="GPA"
                        value={entry.gpa}
                        onChange={(e) => updateEducationEntry(entry.id, "gpa", e.target.value)}
                      />
                      {renderCopyButton(`edu:${entry.id}:gpa`, entry.gpa)}
                    </Box>
                  </Box>
                  <Box sx={{ display: "flex", gap: 0.5, alignItems: "flex-start" }}>
                    <TextField
                      fullWidth
                      size="small"
                      label="Notes (honors, coursework, activities)"
                      value={entry.notes}
                      onChange={(e) => updateEducationEntry(entry.id, "notes", e.target.value)}
                      multiline
                      minRows={2}
                    />
                    {renderCopyButton(`edu:${entry.id}:notes`, entry.notes, { alignTop: true })}
                  </Box>
                </Box>
              );
            })}

            <Box>
              <Button
                size="small"
                variant="outlined"
                onClick={addEducationEntry}
                sx={{ textTransform: "none", fontSize: "0.8rem" }}
              >
                + Add education
              </Button>
            </Box>
          </AccordionDetails>
        </Accordion>
      </div>

      <div className={styles.fieldGroup}>
        <label htmlFor="employment-header" className={styles.label}>
          Employment History
        </label>
        <Accordion
          disableGutters
          elevation={0}
          expanded={employmentOpen}
          onChange={(_event, expanded) => setEmploymentOpen(expanded)}
          sx={{
            border: "1px solid var(--border-strong)",
            borderRadius: "12px !important",
            overflow: "hidden",
            backgroundColor: "var(--bg-surface)",
            "&::before": { display: "none" },
          }}
        >
          <AccordionSummary
            aria-controls="employment-content"
            id="employment-header"
            expandIcon={(
              <Box
                component="span"
                sx={{
                  fontSize: "0.95rem",
                  lineHeight: 1,
                  color: "var(--text-secondary)",
                }}
              >
                ▾
              </Box>
            )}
            sx={{
              minHeight: 0,
              px: 1.75,
              py: 0.25,
              "& .MuiAccordionSummary-content": {
                my: 1,
                font: "inherit",
                fontSize: "0.9rem",
                color: "var(--text-secondary)",
                fontWeight: 400,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 1,
              },
            }}
          >
            <Box component="span">
              {employmentOpen
                ? `Hide employment${employmentEntries.length ? ` (${employmentEntries.length})` : ""}`
                : `Show employment${employmentEntries.length ? ` (${employmentEntries.length})` : ""}`}
            </Box>
            <Tooltip title={allEmploymentCopied ? "Copied!" : "Copy all employment"}>
              <span onClick={(e) => { e.stopPropagation(); }} onFocus={(e) => e.stopPropagation()}>
                <IconButton
                  size="small"
                  disabled={!formatAllEmployment()}
                  onClick={(e) => { e.stopPropagation(); copyAllEmployment(); }}
                  sx={{ p: 0.5, color: allEmploymentCopied ? "#2e7d32" : "var(--text-secondary)" }}
                  aria-label="Copy all employment"
                >
                  {allEmploymentCopied ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  )}
                </IconButton>
              </span>
            </Tooltip>
          </AccordionSummary>
          <AccordionDetails
            sx={{
              pt: 1.5,
              pb: 2,
              px: 1.75,
              display: "flex",
              flexDirection: "column",
              gap: 1.5,
              borderTop: "1px solid var(--border)",
            }}
          >
            {employmentEntries.length === 0 ? (
              <Box sx={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                No employment entries saved yet. Add up to 4 past employers to keep their details ready to copy.
              </Box>
            ) : null}

            {employmentEntries.map((entry) => {
              const headerLabel = entry.title?.trim()
                || entry.company?.trim()
                || "Untitled position";
              const copied = employmentCopiedId === entry.id;
              return (
                <Box
                  key={entry.id}
                  sx={{
                    border: "1px solid var(--border)",
                    borderRadius: 2,
                    p: 1.5,
                    display: "flex",
                    flexDirection: "column",
                    gap: 1,
                    backgroundColor: "var(--bg-soft, #fbfdff)",
                  }}
                >
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 1,
                    }}
                  >
                    <Box sx={{ fontWeight: 600, fontSize: "0.9rem" }}>{headerLabel}</Box>
                    <Box sx={{ display: "flex", gap: 0.75 }}>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => copyEmploymentBlock(entry)}
                        disabled={!formatEmploymentBlock(entry)}
                        sx={{ textTransform: "none", fontSize: "0.75rem", py: 0.25, minWidth: 0 }}
                      >
                        {copied ? "Copied!" : "Copy"}
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        onClick={() => removeEmploymentEntry(entry.id)}
                        sx={{ textTransform: "none", fontSize: "0.75rem", py: 0.25, minWidth: 0 }}
                      >
                        Remove
                      </Button>
                    </Box>
                  </Box>
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                      gap: 1,
                    }}
                  >
                    <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                      <TextField
                        fullWidth
                        size="small"
                        label="Company"
                        value={entry.company}
                        onChange={(e) => updateEmploymentEntry(entry.id, "company", e.target.value)}
                      />
                      {renderCopyButton(`emp:${entry.id}:company`, entry.company)}
                    </Box>
                    <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                      <TextField
                        fullWidth
                        size="small"
                        label="Job Title"
                        value={entry.title}
                        onChange={(e) => updateEmploymentEntry(entry.id, "title", e.target.value)}
                      />
                      {renderCopyButton(`emp:${entry.id}:title`, entry.title)}
                    </Box>
                    <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                      <TextField
                        fullWidth
                        size="small"
                        label="Location"
                        value={entry.location}
                        onChange={(e) => updateEmploymentEntry(entry.id, "location", e.target.value)}
                      />
                      {renderCopyButton(`emp:${entry.id}:location`, entry.location)}
                    </Box>
                    <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                      <TextField
                        fullWidth
                        size="small"
                        label="Start (e.g. Jan 2020)"
                        value={entry.startDate}
                        onChange={(e) => updateEmploymentEntry(entry.id, "startDate", e.target.value)}
                      />
                      {renderCopyButton(`emp:${entry.id}:startDate`, entry.startDate)}
                    </Box>
                    <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                      <TextField
                        fullWidth
                        size="small"
                        label="End (e.g. Mar 2023 or Present)"
                        value={entry.endDate}
                        onChange={(e) => updateEmploymentEntry(entry.id, "endDate", e.target.value)}
                      />
                      {renderCopyButton(`emp:${entry.id}:endDate`, entry.endDate)}
                    </Box>
                  </Box>
                  <Box sx={{ display: "flex", gap: 0.5, alignItems: "flex-start" }}>
                    <TextField
                      fullWidth
                      size="small"
                      label="Notes (responsibilities, achievements)"
                      value={entry.notes}
                      onChange={(e) => updateEmploymentEntry(entry.id, "notes", e.target.value)}
                      multiline
                      minRows={2}
                    />
                    {renderCopyButton(`emp:${entry.id}:notes`, entry.notes, { alignTop: true })}
                  </Box>
                </Box>
              );
            })}

            <Box>
              <Button
                size="small"
                variant="outlined"
                onClick={addEmploymentEntry}
                disabled={employmentEntries.length >= 4}
                sx={{ textTransform: "none", fontSize: "0.8rem" }}
              >
                {employmentEntries.length >= 4 ? "Max 4 entries reached" : "+ Add employer"}
              </Button>
            </Box>
          </AccordionDetails>
        </Accordion>
      </div>
    </>
  );
}
