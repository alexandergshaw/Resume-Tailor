"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import IconButton from "@mui/material/IconButton";
import Autocomplete from "@mui/material/Autocomplete";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import styles from "../page.module.css";
import JobFilterControls from "./JobFilterControls";
import SavedSearchStrip from "./SavedSearchStrip";

export default function JobSearchTab({
  handleJobSearch,
  saveCurrentSearch,
  savedSearches,
  activeSavedSearchId,
  setActiveSavedSearchId,
  applySavedSearch,
  deleteSavedSearch,
  jobKeywords,
  setJobKeywords,
  maxYearsExp,
  setMaxYearsExp,
  selectedCategories,
  setSelectedCategories,
  selectedCompanies,
  setSelectedCompanies,
  excludedCompanies,
  setExcludedCompanies,
  excludedTitleKeywords,
  setExcludedTitleKeywords,
  hideAppliedJobs,
  setHideAppliedJobs,
  GREENHOUSE_COMPANIES,
  COMPANY_CATEGORIES,
  isSearching,
  jobSearchError,
  jobResults,
  batchTailorState,
  resumeFile,
  handleTailorAllVisible,
  appliedJobIds,
  tailoringMap,
  highlightedJobId,
  showIgnored,
  setShowIgnored,
  ignoredJobIds,
  extractMinYearsRequired,
  handleToggleApplied,
  handleIgnoreJob,
  handleRestoreJob,
  handleTailorJob,
  askAiAbout,
  buildJobContextString,
}) {
  return (
    <section className={styles.tabPanel}>
      <form onSubmit={handleJobSearch} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <SavedSearchStrip
          savedSearches={savedSearches}
          activeSavedSearchId={activeSavedSearchId}
          saveCurrentSearch={saveCurrentSearch}
          applySavedSearch={applySavedSearch}
          deleteSavedSearch={deleteSavedSearch}
        />
        <JobFilterControls
          jobKeywords={jobKeywords}
          setJobKeywords={setJobKeywords}
          maxYearsExp={maxYearsExp}
          setMaxYearsExp={setMaxYearsExp}
          selectedCategories={selectedCategories}
          setSelectedCategories={setSelectedCategories}
          selectedCompanies={selectedCompanies}
          setSelectedCompanies={setSelectedCompanies}
          excludedCompanies={excludedCompanies}
          setExcludedCompanies={setExcludedCompanies}
          excludedTitleKeywords={excludedTitleKeywords}
          setExcludedTitleKeywords={setExcludedTitleKeywords}
          GREENHOUSE_COMPANIES={GREENHOUSE_COMPANIES}
          COMPANY_CATEGORIES={COMPANY_CATEGORIES}
        />
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={hideAppliedJobs}
              onChange={(e) => setHideAppliedJobs(e.target.checked)}
            />
          }
          label="Hide jobs I've applied to"
          sx={{ alignSelf: "flex-start", m: 0 }}
        />
        <Button
          type="submit"
          variant="contained"
          disabled={isSearching || jobKeywords.length === 0}
          sx={{ whiteSpace: "nowrap", alignSelf: "flex-start" }}
        >
          {isSearching ? "Searching..." : "Search Jobs"}
        </Button>
      </form>

      {jobSearchError ? <p className={styles.error}>{jobSearchError}</p> : null}

      {jobResults.length > 0 ? (() => {
        const excludedNames = new Set(
          excludedCompanies.map((c) => (typeof c === "string" ? c : c.name).toLowerCase()),
        );
        const companyFiltered = excludedNames.size > 0
          ? jobResults.filter((j) => !excludedNames.has((j.company || "").toLowerCase()))
          : jobResults;
        const requiredKeywordsLower = jobKeywords
          .map((k) => k.trim().toLowerCase())
          .filter(Boolean);
        const keywordFiltered = requiredKeywordsLower.length > 0
          ? companyFiltered.filter((j) => {
              const haystack = `${j.title || ""} ${j.description || ""}`.toLowerCase();
              return requiredKeywordsLower.every((kw) => haystack.includes(kw));
            })
          : companyFiltered;
        const titleKeywordsLower = excludedTitleKeywords
          .map((k) => k.trim().toLowerCase())
          .filter(Boolean);
        const titleFiltered = titleKeywordsLower.length > 0
          ? keywordFiltered.filter((j) => {
              const title = (j.title || "").toLowerCase();
              return !titleKeywordsLower.some((kw) => title.includes(kw));
            })
          : keywordFiltered;
        const yearsFiltered =
          maxYearsExp === "any"
            ? titleFiltered
            : titleFiltered.filter((j) => {
                const minReq = extractMinYearsRequired(j.description);
                if (minReq === null) return true;
                return minReq <= parseInt(maxYearsExp, 10);
              });
        const appliedFiltered = hideAppliedJobs
          ? yearsFiltered.filter((j) => !appliedJobIds.has(j.id))
          : yearsFiltered;
        const visibleJobs = appliedFiltered.filter((j) => !ignoredJobIds.has(j.id));
        const ignoredInResults = appliedFiltered.filter((j) => ignoredJobIds.has(j.id));
        return (
          <>
            {visibleJobs.length > 0 ? (
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1, mb: 1 }}>
                <Box sx={{ fontSize: 13, color: "var(--text-secondary)" }}>
                  {batchTailorState.running
                    ? `Tailoring ${batchTailorState.completed} / ${batchTailorState.total}…`
                    : `${visibleJobs.length} job${visibleJobs.length === 1 ? "" : "s"} visible`}
                </Box>
                <Button
                  size="small"
                  variant="contained"
                  disabled={!resumeFile || batchTailorState.running}
                  onClick={() => handleTailorAllVisible(visibleJobs)}
                  sx={{ whiteSpace: "nowrap" }}
                >
                  {batchTailorState.running
                    ? `Tailoring ${batchTailorState.completed}/${batchTailorState.total}…`
                    : (() => {
                        const pending = visibleJobs.filter((j) => {
                          if (appliedJobIds.has(j.id)) return false;
                          const t = tailoringMap[j.id];
                          if (!t) return true;
                          return t.status !== "done" && t.status !== "tailoring";
                        }).length;
                        return `Tailor all visible (${pending})`;
                      })()}
                </Button>
              </Box>
            ) : null}
            {visibleJobs.length > 0 ? (
              <div className={styles.jobGrid}>
                {visibleJobs.map((job) => {
                  const tailoring = tailoringMap[job.id] || {};
                  const isDone = tailoring.status === "done";
                  const isTailoring = tailoring.status === "tailoring";
                  const isDownloaded = tailoring.downloaded === true;
                  const isError = tailoring.status === "error";
                  const isApplied = appliedJobIds.has(job.id);

                  return (
                    <div key={job.id} id={`job-card-${job.id}`} className={`${styles.jobCard}${isApplied ? ` ${styles.jobCardApplied}` : ""}${highlightedJobId === job.id ? ` ${styles.jobCardHighlighted}` : ""}`}>
                      <div>
                        {job.url ? (
                          <a
                            href={job.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.jobCardTitle}
                            style={{ textDecoration: "underline", color: "var(--accent, #1976d2)", cursor: "pointer" }}
                          >
                            {job.title}
                          </a>
                        ) : (
                          <p className={styles.jobCardTitle}>{job.title}</p>
                        )}
                        <p className={styles.jobCardMeta}>
                          {[job.company, job.location].filter(Boolean).join(" · ")}
                        </p>
                        {job.publisher ? (
                          <p className={styles.jobCardPublisher}>{job.publisher}</p>
                        ) : null}
                        {job.salaryMin || job.salaryMax ? (
                          <p className={styles.jobCardSalary}>
                            {job.salaryMin && job.salaryMax
                              ? `$${Math.round(job.salaryMin / 1000)}k–$${Math.round(job.salaryMax / 1000)}k`
                              : job.salaryMin
                              ? `From $${Math.round(job.salaryMin / 1000)}k`
                              : `Up to $${Math.round(job.salaryMax / 1000)}k`}
                          </p>
                        ) : null}
                        <p className={styles.jobCardDescription}>
                          {job.description.slice(0, 220).trim()}&hellip;
                        </p>
                        {isError ? (
                          <p className={styles.jobCardError}>{tailoring.error}</p>
                        ) : null}
                      </div>
                      <div className={styles.jobCardFooter}>
                        <a
                          href={job.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.jobCardLink}
                        >
                          View
                        </a>
                        <div className={styles.cardActions}>
                          <button
                            type="button"
                            className={`${styles.cardBtn} ${isApplied ? styles.cardBtnApplied : styles.cardBtnSecondary}`}
                            onClick={() => handleToggleApplied(job)}
                          >
                            {isApplied ? "Applied ✓" : "Applied"}
                          </button>
                          <button
                            type="button"
                            className={`${styles.cardBtn} ${styles.cardBtnSecondary}`}
                            onClick={() => handleIgnoreJob(job.id)}
                          >
                            Ignore
                          </button>
                          <button
                            type="button"
                            className={`${styles.cardBtn} ${styles.cardBtnSecondary}`}
                            onClick={() => askAiAbout({
                              label: `Job: ${job.company || ""}${job.company && job.title ? " — " : ""}${job.title || ""}`.trim() || "Job posting",
                              content: buildJobContextString(job),
                            })}
                            title="Ask AI about this job"
                          >
                            Ask AI
                          </button>
                          <button
                            type="button"
                            className={`${styles.cardBtn} ${styles.cardBtnPrimary}`}
                            disabled={!resumeFile || isTailoring || (isDone && !isDownloaded)}
                            title={!resumeFile ? "Upload a resume to generate" : undefined}
                            onClick={() => handleTailorJob(job)}
                          >
                            {isTailoring ? "Tailoring..." : isDownloaded ? "Regenerate" : isDone ? "Done ✓" : "Generate"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {ignoredInResults.length > 0 ? (
              <div className={styles.ignoredSection}>
                <button
                  type="button"
                  className={styles.ignoredToggle}
                  onClick={() => setShowIgnored((v) => !v)}
                >
                  {ignoredInResults.length} ignored{showIgnored ? " · Hide" : " · Show"}
                </button>
                {showIgnored ? (
                  <div className={styles.jobGrid}>
                    {ignoredInResults.map((job) => (
                      <div key={job.id} className={`${styles.jobCard} ${styles.jobCardIgnored}`}>
                        <div>
                          <p className={styles.jobCardTitle}>{job.title}</p>
                          <p className={styles.jobCardMeta}>
                            {[job.company, job.location].filter(Boolean).join(" · ")}
                          </p>
                          {job.salaryMin || job.salaryMax ? (
                            <p className={styles.jobCardSalary}>
                              {job.salaryMin && job.salaryMax
                                ? `$${Math.round(job.salaryMin / 1000)}k–$${Math.round(job.salaryMax / 1000)}k`
                                : job.salaryMin
                                ? `From $${Math.round(job.salaryMin / 1000)}k`
                                : `Up to $${Math.round(job.salaryMax / 1000)}k`}
                            </p>
                          ) : null}
                        </div>
                        <div className={styles.jobCardFooter}>
                          <a
                            href={job.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.jobCardLink}
                          >
                            View
                          </a>
                          <div className={styles.cardActions}>
                            <button
                              type="button"
                              className={`${styles.cardBtn} ${styles.cardBtnSecondary}`}
                              onClick={() => handleRestoreJob(job.id)}
                            >
                              Restore
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        );
      })() : null}
    </section>
  );
}
