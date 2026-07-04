"use client";

import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Slider from "@mui/material/Slider";
import TabHeader from "./TabHeader";

import { createClient } from "../../lib/supabase/client";
import styles from "../page.module.css";
import ProfileListSection from "./applying/ProfileListSection";
import {
  REFERENCES_SECTION,
  EDUCATION_SECTION,
  EMPLOYMENT_SECTION,
} from "./applying/sectionConfigs";

const AGGRESSIVENESS_MARKS = [
  { value: 1, label: "Light" },
  { value: 3, label: "Balanced" },
  { value: 5, label: "Strong" },
];

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
  // useProfileEntries controllers for the three résumé-material lists.
  references,
  education,
  employment,
  employmentImport,
  importEmploymentFromResume,
  renderCopyButton,
  materials = [],
  materialsBusy,
  materialsError,
  uploadMaterials,
  downloadMaterialFile,
  removeMaterialFile,
  askAiAboutMaterial,
  currentUserPresent,
}) {
  return (
    <>
      <TabHeader
        title="Materials"
        description="Your resume, cover letter, and supporting context used to tailor each application."
      />

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

      <ProfileListSection ctl={references} config={REFERENCES_SECTION} renderCopyButton={renderCopyButton} />

      <ProfileListSection ctl={education} config={EDUCATION_SECTION} renderCopyButton={renderCopyButton} />

      <ProfileListSection
        ctl={employment}
        config={EMPLOYMENT_SECTION}
        renderCopyButton={renderCopyButton}
        importUI={{ status: employmentImport, onImport: importEmploymentFromResume }}
      />

      <div className={styles.fieldGroup}>
        <span className={styles.label}>Supplementary materials</span>
        <Box sx={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
          Upload transcripts, certificates, writing samples, etc. to keep them handy.
          {currentUserPresent
            ? " Saved to your account."
            : " Sign in to save these — for now they're kept only until you reload."}
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <Button
            component="label"
            size="small"
            variant="outlined"
            disabled={materialsBusy}
            sx={{ textTransform: "none", fontSize: "0.8rem" }}
          >
            {materialsBusy ? "Uploading…" : "Upload files"}
            <input
              type="file"
              hidden
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                e.target.value = "";
                if (files.length && uploadMaterials) uploadMaterials(files);
              }}
            />
          </Button>
          <Box sx={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
            {materials.length} file{materials.length === 1 ? "" : "s"}
          </Box>
        </Box>
        {materialsError ? (
          <Box sx={{ fontSize: "0.78rem", color: "var(--danger)" }}>{materialsError}</Box>
        ) : null}
        {materials.length > 0 ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
            {materials.map((item, idx) => (
              <Box
                key={`${item.name}-${idx}`}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 1,
                  border: "1px solid var(--border)",
                  borderRadius: 1.5,
                  px: 1.25,
                  py: 0.75,
                  backgroundColor: "var(--bg-soft)",
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Box sx={{ fontSize: "0.85rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.name}
                  </Box>
                  {Number.isFinite(item.size) ? (
                    <Box sx={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>{formatBytes(item.size)}</Box>
                  ) : null}
                </Box>
                <Box sx={{ display: "flex", gap: 0.5, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {askAiAboutMaterial ? (
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => askAiAboutMaterial(item)}
                      sx={{ textTransform: "none", fontSize: "0.72rem", minWidth: 0 }}
                    >
                      Ask AI
                    </Button>
                  ) : null}
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => downloadMaterialFile(item)}
                    sx={{ textTransform: "none", fontSize: "0.72rem", minWidth: 0 }}
                  >
                    Download
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    onClick={() => removeMaterialFile(item)}
                    sx={{ textTransform: "none", fontSize: "0.72rem", minWidth: 0 }}
                  >
                    Remove
                  </Button>
                </Box>
              </Box>
            ))}
          </Box>
        ) : (
          <Box sx={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>No files uploaded yet.</Box>
        )}
      </div>
    </>
  );
}
