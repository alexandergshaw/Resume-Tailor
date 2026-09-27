"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import FeedSearchFields from "./FeedSearchFields";
import JobFilterControls from "../JobFilterControls";

// N60 S8. The Search + Refine sections extracted out of LiveFeedTab.js's
// filterPanel (markup only) so the tab stays under its 900-line ceiling
// (liveFeedWiring.test.js:82). Every value here is still owned and persisted
// by LiveFeedTab.js and handed down as a prop. Not one of the automation
// surfaces (AC-F2): this panel stays inside the Filters sheet.
export default function FeedRefinePanel({
  filters,
  updateFilter,
  advanced,
  setJobKeywords,
  setMaxYearsExp,
  setSelectedCategories,
  setSelectedCompanies,
  setExcludedCompanies,
  setExcludedTitleKeywords,
  GREENHOUSE_COMPANIES,
  COMPANY_CATEGORIES,
}) {
  return (
    <>
      <Typography variant="overline" color="text.secondary" sx={{ display: "block", letterSpacing: 0.6, mb: 1 }}>
        Search
      </Typography>
      <FeedSearchFields filters={filters} updateFilter={updateFilter} />

      <Divider sx={{ my: 2 }} />

      <Typography variant="overline" color="text.secondary" sx={{ display: "block", letterSpacing: 0.6, mb: 1 }}>
        Refine
      </Typography>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        <JobFilterControls
          jobKeywords={advanced.jobKeywords}
          setJobKeywords={setJobKeywords}
          maxYearsExp={advanced.maxYearsExp}
          setMaxYearsExp={setMaxYearsExp}
          selectedCategories={advanced.selectedCategories}
          setSelectedCategories={setSelectedCategories}
          selectedCompanies={advanced.selectedCompanies}
          setSelectedCompanies={setSelectedCompanies}
          excludedCompanies={advanced.excludedCompanies}
          setExcludedCompanies={setExcludedCompanies}
          excludedTitleKeywords={advanced.excludedTitleKeywords}
          setExcludedTitleKeywords={setExcludedTitleKeywords}
          GREENHOUSE_COMPANIES={GREENHOUSE_COMPANIES}
          COMPANY_CATEGORIES={COMPANY_CATEGORIES}
        />
      </Box>
    </>
  );
}
