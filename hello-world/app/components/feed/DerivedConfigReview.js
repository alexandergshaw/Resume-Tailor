"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Divider from "@mui/material/Divider";
import JobFilterControls from "../JobFilterControls";
import CadenceControl from "./CadenceControl";

// N60 second chunk, Step D (AC2-C1, AC2-C2, AC2-C4c review half). Shows a
// chat turn's derived configuration field by field, in the SAME vocabulary
// the existing saved-search surface uses -- JobFilterControls (imported, not
// forked, so the chat surface can never drift from the chip surface) for
// every filter field, the shared CadenceControl for "frequency", and the
// FeedAutomationCard alert-Switch idiom for email. Every field is editable in
// place; nothing is written until Accept.
//
// Deliberately NO auto-tailor enable control here (AC2-C3): enabling stays
// behind FeedAutomationCard's own cost-stating confirm, on a saved search
// that already exists -- a chat turn can propose a search, never switch on
// unattended spend.
//
// excludedCompanies is the one field whose stored shape (a string[] of
// company names, per the deriver's own contract) does not match what the
// shared control's non-freeSolo Autocomplete expects (GREENHOUSE_COMPANIES
// objects) -- the two small helpers below convert at the boundary so the
// draft itself, and the apply body built from it, stay plain strings the
// sanitizer's sanitizeStringArray actually understands.
function namesToCompanyOptions(names, catalog) {
  return (names || [])
    .map((name) => {
      if (typeof name !== "string") return name;
      return (catalog || []).find((c) => c.name.toLowerCase() === name.toLowerCase()) || null;
    })
    .filter(Boolean);
}
function companyOptionsToNames(values) {
  return (values || []).map((value) => (typeof value === "string" ? value : value.name));
}

export default function DerivedConfigReview({
  draft,
  setJobKeywords,
  setMaxYearsExp,
  setSelectedCategories,
  setSelectedCompanies,
  setExcludedCompanies,
  setExcludedTitleKeywords,
  setAutoTailorMinIntervalMinutes,
  setEmailOnNewJobs,
  onAccept,
  GREENHOUSE_COMPANIES,
  COMPANY_CATEGORIES,
}) {
  return (
    <Box sx={{ mt: 1.5, p: 1.5, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        {draft.name || "New automation"}
      </Typography>
      <Typography sx={{ color: "text.secondary", fontSize: "0.78rem", mb: 1 }}>
        Here&apos;s what was understood. Correct anything below, then create the automation.
      </Typography>
      <JobFilterControls
        jobKeywords={draft.jobKeywords}
        setJobKeywords={setJobKeywords}
        maxYearsExp={draft.maxYearsExp}
        setMaxYearsExp={setMaxYearsExp}
        selectedCategories={draft.selectedCategories}
        setSelectedCategories={setSelectedCategories}
        selectedCompanies={draft.selectedCompanies}
        setSelectedCompanies={setSelectedCompanies}
        excludedCompanies={namesToCompanyOptions(draft.excludedCompanies, GREENHOUSE_COMPANIES)}
        setExcludedCompanies={(values) => setExcludedCompanies(companyOptionsToNames(values))}
        excludedTitleKeywords={draft.excludedTitleKeywords}
        setExcludedTitleKeywords={setExcludedTitleKeywords}
        GREENHOUSE_COMPANIES={GREENHOUSE_COMPANIES}
        COMPANY_CATEGORIES={COMPANY_CATEGORIES}
      />
      <CadenceControl value={draft.autoTailorMinIntervalMinutes} onChange={setAutoTailorMinIntervalMinutes} />
      <FormControlLabel
        control={
          <Switch
            size="small"
            checked={!!draft.emailOnNewJobs}
            onChange={(e) => setEmailOnNewJobs(e.target.checked)}
          />
        }
        label={<Box sx={{ fontSize: "0.78rem" }}>Email me new jobs</Box>}
        sx={{ m: 0, mt: 1 }}
      />
      <Divider sx={{ my: 1 }} />
      <Button variant="contained" size="small" onClick={onAccept}>
        Create automation
      </Button>
    </Box>
  );
}
