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
        <Box
          sx={{
            display: "flex",
            gap: 1,
            overflowX: "auto",
            pb: 0.5,
            scrollbarWidth: "thin",
            "&::-webkit-scrollbar": { height: 6 },
            "&::-webkit-scrollbar-thumb": { background: "#ccc", borderRadius: 3 },
          }}
        >
          <Box
            role="button"
            tabIndex={0}
            onClick={saveCurrentSearch}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); saveCurrentSearch(); } }}
            sx={{
              flex: "0 0 auto",
              minWidth: 130,
              maxWidth: 180,
              px: 1.25,
              py: 1,
              border: "1px dashed #90a4ae",
              borderRadius: 1,
              bgcolor: "#f5f8fa",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              color: "#37474f",
              fontSize: "0.75rem",
              lineHeight: 1.2,
              textAlign: "center",
              "&:hover": { bgcolor: "#eceff1" },
            }}
            title="Save current search controls"
          >
            <Box sx={{ fontSize: "1rem", fontWeight: 600 }}>+ Save</Box>
            <Box sx={{ opacity: 0.7 }}>current search</Box>
          </Box>
          {savedSearches.map((entry) => {
            const chipSummaryParts = [];
            if (Array.isArray(entry.selectedCategories) && entry.selectedCategories.length > 0) {
              chipSummaryParts.push(`${entry.selectedCategories.length} cat`);
            }
            if (Array.isArray(entry.selectedCompanies) && entry.selectedCompanies.length > 0) {
              chipSummaryParts.push(`${entry.selectedCompanies.length} co`);
            }
            if (Array.isArray(entry.excludedCompanies) && entry.excludedCompanies.length > 0) {
              chipSummaryParts.push(`-${entry.excludedCompanies.length} ex`);
            }
            if (entry.maxYearsExp && entry.maxYearsExp !== "any") {
              chipSummaryParts.push(`≤${entry.maxYearsExp}y`);
            }
            const queryLabel =
              (Array.isArray(entry.jobKeywords) && entry.jobKeywords.length > 0
                ? entry.jobKeywords.join(", ")
                : (entry.jobQuery || "").trim()) || "—";
            const isActive = activeSavedSearchId === entry.id;
            return (
              <Box
                key={entry.id}
                role="button"
                tabIndex={0}
                onClick={() => applySavedSearch(entry)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applySavedSearch(entry); } }}
                sx={{
                  flex: "0 0 auto",
                  minWidth: 150,
                  maxWidth: 220,
                  px: 1.25,
                  py: 0.75,
                  border: isActive ? "1px solid #1976d2" : "1px solid #cfd8dc",
                  borderRadius: 1,
                  bgcolor: isActive ? "#e3f2fd" : "#fff",
                  boxShadow: isActive ? "0 0 0 2px rgba(25, 118, 210, 0.18)" : "none",
                  cursor: "pointer",
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  gap: 0.25,
                  fontSize: "0.75rem",
                  transition: "background-color 120ms ease, box-shadow 120ms ease, border-color 120ms ease",
                  "&:hover": { borderColor: "#1976d2", boxShadow: isActive ? "0 0 0 2px rgba(25, 118, 210, 0.25)" : 1 },
                }}
                title={`Apply saved search: ${entry.name}`}
              >
                <Box
                  sx={{
                    fontWeight: 600,
                    fontSize: "0.8rem",
                    pr: 2,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {entry.name}
                </Box>
                <Box
                  sx={{
                    color: "#546e7a",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {queryLabel}
                </Box>
                {chipSummaryParts.length > 0 && (
                  <Box sx={{ color: "#78909c", fontSize: "0.7rem" }}>
                    {chipSummaryParts.join(" · ")}
                  </Box>
                )}
                <IconButton
                  size="small"
                  aria-label={`Delete saved search ${entry.name}`}
                  onClick={(e) => { e.stopPropagation(); deleteSavedSearch(entry.id); }}
                  sx={{
                    position: "absolute",
                    top: 2,
                    right: 2,
                    p: 0.25,
                    color: "#90a4ae",
                    "&:hover": { color: "#d32f2f", bgcolor: "transparent" },
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </IconButton>
              </Box>
            );
          })}
        </Box>
        <Autocomplete
          multiple
          freeSolo
          options={[]}
          value={jobKeywords}
          onChange={(_, newValue) => {
            const cleaned = newValue
              .map((v) => (typeof v === "string" ? v.trim() : ""))
              .filter(Boolean);
            const seen = new Set();
            const deduped = [];
            for (const v of cleaned) {
              const key = v.toLowerCase();
              if (seen.has(key)) continue;
              seen.add(key);
              deduped.push(v);
            }
            setJobKeywords(deduped);
            setActiveSavedSearchId(null);
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              size="small"
              label="Job title or keywords"
              placeholder={
                jobKeywords.length === 0
                  ? "e.g. react, frontend, typescript (press Enter to add)"
                  : ""
              }
            />
          )}
          renderTags={(value, getTagProps) =>
            value.map((option, index) => (
              <Chip key={option} label={option} size="small" {...getTagProps({ index })} />
            ))
          }
        />
        <FormControl size="small" sx={{ minWidth: 150, alignSelf: "flex-start" }}>
          <InputLabel>Experience</InputLabel>
          <Select
            label="Experience"
            value={maxYearsExp}
            onChange={(e) => { setMaxYearsExp(e.target.value); setActiveSavedSearchId(null); }}
          >
            <MenuItem value="any">Any experience</MenuItem>
            <MenuItem value="0">Entry level (0 yrs)</MenuItem>
            <MenuItem value="1">Up to 1 yr</MenuItem>
            <MenuItem value="2">Up to 2 yrs</MenuItem>
            <MenuItem value="3">Up to 3 yrs</MenuItem>
            <MenuItem value="5">Up to 5 yrs</MenuItem>
            <MenuItem value="7">Up to 7 yrs</MenuItem>
            <MenuItem value="10">Up to 10 yrs</MenuItem>
          </Select>
        </FormControl>
        <Autocomplete
          multiple
          options={COMPANY_CATEGORIES}
          value={selectedCategories}
          onChange={(_, newValue) => {
            setSelectedCategories(newValue);
            setActiveSavedSearchId(null);
            const matched =
              newValue.length === 0
                ? []
                : GREENHOUSE_COMPANIES.filter((c) =>
                    c.categories.some((cat) => newValue.includes(cat))
                  );
            setSelectedCompanies(matched);
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              size="small"
              label="Categories"
              placeholder={selectedCategories.length === 0 ? "All categories" : ""}
            />
          )}
          renderTags={(value, getTagProps) =>
            value.map((option, index) => (
              <Chip key={option} label={option} size="small" {...getTagProps({ index })} />
            ))
          }
        />
        <Autocomplete
          multiple
          freeSolo
          options={GREENHOUSE_COMPANIES}
          getOptionLabel={(option) => typeof option === "string" ? option : option.name}
          value={selectedCompanies}
          onChange={(_, newValue) => {
            setActiveSavedSearchId(null);
            setSelectedCompanies(
              newValue.map((entry) => {
                if (typeof entry === "string") {
                  const match = GREENHOUSE_COMPANIES.find((c) => c.name.toLowerCase() === entry.toLowerCase());
                  return match || entry;
                }
                return entry;
              })
            );
          }}
          isOptionEqualToValue={(option, value) => {
            if (typeof option === "string" || typeof value === "string") return option === value;
            return option.slug === value.slug;
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              size="small"
              label="Companies"
              placeholder={selectedCompanies.length === 0 ? "All Greenhouse companies" : ""}
            />
          )}
          renderTags={(value, getTagProps) =>
            value.map((option, index) => {
              const label = typeof option === "string" ? option : option.name;
              return <Chip key={label} label={label} size="small" {...getTagProps({ index })} />;
            })
          }
        />
        <Autocomplete
          multiple
          options={GREENHOUSE_COMPANIES}
          getOptionLabel={(option) => option.name}
          value={excludedCompanies}
          onChange={(_, newValue) => { setExcludedCompanies(newValue); setActiveSavedSearchId(null); }}
          isOptionEqualToValue={(option, value) => option.slug === value.slug}
          renderInput={(params) => (
            <TextField
              {...params}
              size="small"
              label="Exclude Companies"
              placeholder={excludedCompanies.length === 0 ? "Hide companies from results" : ""}
            />
          )}
          renderTags={(value, getTagProps) =>
            value.map((option, index) => (
              <Chip key={option.slug} label={option.name} size="small" {...getTagProps({ index })} />
            ))
          }
        />
        <Autocomplete
          multiple
          freeSolo
          options={[]}
          value={excludedTitleKeywords}
          onChange={(_, newValue) => {
            const cleaned = newValue
              .map((v) => (typeof v === "string" ? v.trim() : ""))
              .filter(Boolean);
            const seen = new Set();
            const deduped = [];
            for (const v of cleaned) {
              const key = v.toLowerCase();
              if (seen.has(key)) continue;
              seen.add(key);
              deduped.push(v);
            }
            setExcludedTitleKeywords(deduped);
            setActiveSavedSearchId(null);
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              size="small"
              label="Exclude title keywords"
              placeholder={
                excludedTitleKeywords.length === 0
                  ? "e.g. senior, manager, sales (press Enter to add)"
                  : ""
              }
            />
          )}
          renderTags={(value, getTagProps) =>
            value.map((option, index) => (
              <Chip key={option} label={option} size="small" {...getTagProps({ index })} />
            ))
          }
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
