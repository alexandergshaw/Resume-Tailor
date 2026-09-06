"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import { safeExternalHref } from "@/lib/url/safeExternalHref";

import styles from "../page.module.css";

export default function AutoTailorTab({
  currentUser,
  savedSearches,
  setSavedSearchAutoTailor,
  deleteSavedSearch,
  autoTailoredLoading,
  autoTailoredError,
  autoTailoredPostings,
  applyAutoTailoredRow,
  downloadAutoTailoredResume,
  setAutoTailoredError,
}) {
  return (
    <section className={styles.tabPanel}>
      {!currentUser ? (
        <p style={{ color: "var(--text-secondary)" }}>Sign in to manage auto-tailored saved searches.</p>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <Box>
            <Box sx={{ fontWeight: 600, fontSize: "0.95rem", mb: 0.5 }}>Saved searches</Box>
            <Box sx={{ color: "var(--text-secondary)", fontSize: "0.8rem", mb: 1.25 }}>
              Toggle auto-tailor on a saved search to have the daily cron tailor your resume to matching new postings.
            </Box>
            {savedSearches.length === 0 ? (
              <Box sx={{ color: "var(--text-muted)", fontSize: "0.85rem", fontStyle: "italic" }}>
                No saved searches yet. Save one from the Job Search tab to enable auto-tailoring.
              </Box>
            ) : (
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 1.25 }}>
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
                  const isServerBacked = typeof entry.id === "string" && !entry.id.startsWith("ss-");
                  return (
                    <Box
                      key={entry.id}
                      sx={{
                        p: 1.25,
                        border: "1px solid var(--border)",
                        borderRadius: 1,
                        bgcolor: "var(--bg-surface)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 0.5,
                        fontSize: "0.8rem",
                        position: "relative",
                      }}
                    >
                      <Box sx={{ fontWeight: 600, fontSize: "0.9rem", pr: 3 }}>{entry.name}</Box>
                      <Box sx={{ color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {queryLabel}
                      </Box>
                      {chipSummaryParts.length > 0 && (
                        <Box sx={{ color: "var(--text-muted)", fontSize: "0.7rem" }}>{chipSummaryParts.join(" · ")}</Box>
                      )}
                      {isServerBacked ? (
                        <Box sx={{ mt: 0.5, pt: 0.75, borderTop: "1px dashed var(--border)", display: "flex", flexDirection: "column", gap: 0.5 }}>
                          <FormControlLabel
                            control={
                              <Switch
                                size="small"
                                checked={!!entry.autoTailorEnabled}
                                onChange={(e) => setSavedSearchAutoTailor(entry.id, { autoTailorEnabled: e.target.checked })}
                              />
                            }
                            label={<Box sx={{ fontSize: "0.78rem" }}>Auto-tailor daily</Box>}
                            sx={{ m: 0 }}
                          />
                          {entry.autoTailorEnabled && (
                            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                              <span>Daily cap:</span>
                              <TextField
                                type="number"
                                size="small"
                                value={entry.autoTailorDailyCap ?? 10}
                                onChange={(e) => {
                                  const n = Number.parseInt(e.target.value, 10);
                                  if (Number.isFinite(n)) setSavedSearchAutoTailor(entry.id, { autoTailorDailyCap: n });
                                }}
                                slotProps={{ htmlInput: { min: 1, max: 100, style: { padding: "2px 4px", width: 52, fontSize: "0.75rem" } } }}
                                sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1 } }}
                              />
                              <span>per run</span>
                            </Box>
                          )}
                        </Box>
                      ) : (
                        <Box sx={{ mt: 0.5, pt: 0.75, borderTop: "1px dashed var(--border)", color: "var(--border-strong)", fontSize: "0.72rem", fontStyle: "italic" }}>
                          Sign-in–only saved search (local). Re-save while signed in to enable auto-tailor.
                        </Box>
                      )}
                      <IconButton
                        size="small"
                        aria-label={`Delete saved search ${entry.name}`}
                        onClick={() => deleteSavedSearch(entry.id)}
                        sx={{ position: "absolute", top: 2, right: 2, p: 0.25, color: "var(--border-strong)", "&:hover": { color: "var(--danger)", bgcolor: "transparent" } }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </IconButton>
                    </Box>
                  );
                })}
              </Box>
            )}
          </Box>

          <Box>
            <Box sx={{ fontWeight: 600, fontSize: "0.95rem", mb: 0.5 }}>Auto-tailored postings</Box>
            <Box sx={{ color: "var(--text-secondary)", fontSize: "0.8rem", mb: 1.25 }}>
              Postings that were automatically tailored by the daily cron based on your enabled saved searches.
            </Box>
            {autoTailoredLoading ? (
              <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
                <CircularProgress size={24} />
              </Box>
            ) : autoTailoredError ? (
              <p style={{ color: "var(--danger)" }}>Error: {autoTailoredError}</p>
            ) : autoTailoredPostings.length === 0 ? (
              <Box sx={{ color: "var(--text-muted)", fontSize: "0.85rem", fontStyle: "italic" }}>
                No auto-tailored postings yet. Enable auto-tailor on a saved search above and wait for the next cron run.
              </Box>
            ) : (
              <Box sx={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 1 }}>
                <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                  <Box component="thead" sx={{ bgcolor: "var(--bg-soft)" }}>
                    <Box component="tr">
                      <Box component="th" sx={{ textAlign: "left", p: 1, borderBottom: "1px solid var(--border)", fontWeight: 600 }}>Date</Box>
                      <Box component="th" sx={{ textAlign: "left", p: 1, borderBottom: "1px solid var(--border)", fontWeight: 600 }}>Company</Box>
                      <Box component="th" sx={{ textAlign: "left", p: 1, borderBottom: "1px solid var(--border)", fontWeight: 600 }}>Title</Box>
                      <Box component="th" sx={{ textAlign: "left", p: 1, borderBottom: "1px solid var(--border)", fontWeight: 600 }}>Posting</Box>
                      <Box component="th" sx={{ textAlign: "left", p: 1, borderBottom: "1px solid var(--border)", fontWeight: 600 }}>Actions</Box>
                    </Box>
                  </Box>
                  <Box component="tbody">
                    {autoTailoredPostings.map((row) => {
                      const dateRaw = row.tracked_at || row.applied_at || null;
                      const dateLabel = dateRaw ? new Date(dateRaw).toLocaleString() : "—";
                      const pos = row.positions || {};
                      // Shared `positions` catalogue - any signed-in account
                      // can overwrite this row's url. Refused -> the same
                      // em-dash this cell already shows for a posting with no
                      // url at all, never a dead link.
                      const postingHref = safeExternalHref(pos.url);
                      return (
                        <Box component="tr" key={row.id} sx={{ "&:hover": { bgcolor: "var(--bg-soft)" } }}>
                          <Box component="td" sx={{ p: 1, borderBottom: "1px solid var(--bg-soft)", whiteSpace: "nowrap" }}>{dateLabel}</Box>
                          <Box component="td" sx={{ p: 1, borderBottom: "1px solid var(--bg-soft)" }}>{pos.company || "—"}</Box>
                          <Box component="td" sx={{ p: 1, borderBottom: "1px solid var(--bg-soft)" }}>{pos.title || "—"}</Box>
                          <Box component="td" sx={{ p: 1, borderBottom: "1px solid var(--bg-soft)" }}>
                            {postingHref ? (
                              <a href={postingHref} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>View</a>
                            ) : "—"}
                          </Box>
                          <Box component="td" sx={{ p: 1, borderBottom: "1px solid var(--bg-soft)", whiteSpace: "nowrap" }}>
                            <Button
                              size="small"
                              variant="contained"
                              onClick={() => applyAutoTailoredRow(row)}
                              disabled={!pos.url || !row.resume_used_id}
                              sx={{ mr: 0.75, textTransform: "none", py: 0.25, px: 1, fontSize: "0.75rem" }}
                              title="Download the tailored resume and open the posting in a new tab"
                            >
                              Apply
                            </Button>
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={async () => {
                                const err = await downloadAutoTailoredResume(row);
                                if (err) setAutoTailoredError(err);
                              }}
                              disabled={!row.resume_used_id}
                              sx={{ textTransform: "none", py: 0.25, px: 1, fontSize: "0.75rem" }}
                              title="Download just the tailored resume"
                            >
                              Download
                            </Button>
                          </Box>
                        </Box>
                      );
                    })}
                  </Box>
                </Box>
              </Box>
            )}
          </Box>
        </Box>
      )}
    </section>
  );
}
