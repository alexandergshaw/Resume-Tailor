"use client";

import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";

// Shared horizontally-scrolling strip of saved searches with a leading
// "+ Save current search" affordance. Used by both the Job Search subtab and
// the Live Feed tab. Purely presentational; all handlers come from the parent.
export default function SavedSearchStrip({
  savedSearches,
  activeSavedSearchId,
  saveCurrentSearch,
  applySavedSearch,
  deleteSavedSearch,
  saveLabel = "current search",
}) {
  return (
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
        <Box sx={{ opacity: 0.7 }}>{saveLabel}</Box>
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
  );
}
