"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";

// Per-saved-search email alert toggles, shown inside the advanced filters
// panel. Extracted out of LiveFeedTab.js as MARKUP only -- setSavedSearchAutoTailor
// is still the prop LiveFeedTab was handed by its parent; this component
// only decides what to render, not what a toggle does.
export default function FeedEmailAlerts({ currentUser, setSavedSearchAutoTailor, savedSearches }) {
  if (!currentUser || typeof setSavedSearchAutoTailor !== "function" || savedSearches.length === 0) {
    return null;
  }

  return (
    <Box sx={{ mt: 1.5 }}>
      <Typography variant="overline" color="text.secondary" sx={{ display: "block", letterSpacing: 0.6, mb: 0.5 }}>
        Email alerts
      </Typography>
      <Typography sx={{ color: "text.secondary", fontSize: "0.78rem", mb: 1 }}>
        Get an email whenever a saved search matches a newly fetched posting.
      </Typography>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
        {savedSearches.map((entry) => {
          const isServerBacked = typeof entry.id === "string" && !entry.id.startsWith("ss-");
          return (
            <Box
              key={entry.id}
              sx={{
                p: 1,
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 1,
                bgcolor: "background.paper",
                display: "flex",
                flexDirection: "column",
                gap: 0.5,
              }}
            >
              <Box sx={{ fontWeight: 600, fontSize: "0.82rem" }}>{entry.name}</Box>
              {isServerBacked ? (
                <>
                  <FormControlLabel
                    control={
                      <Switch
                        size="small"
                        checked={!!entry.emailOnNewJobs}
                        onChange={(e) =>
                          setSavedSearchAutoTailor(entry.id, { emailOnNewJobs: e.target.checked })
                        }
                      />
                    }
                    label={<Box sx={{ fontSize: "0.78rem" }}>Email me new jobs</Box>}
                    sx={{ m: 0 }}
                  />
                  {entry.emailOnNewJobs && (
                    <TextField
                      type="email"
                      size="small"
                      placeholder="Account email (default)"
                      value={entry.notifyEmail ?? ""}
                      onChange={(e) =>
                        setSavedSearchAutoTailor(entry.id, {
                          notifyEmail: e.target.value,
                          persist: false,
                        })
                      }
                      onBlur={(e) =>
                        setSavedSearchAutoTailor(entry.id, { notifyEmail: e.target.value.trim() })
                      }
                      slotProps={{ htmlInput: { style: { padding: "4px 6px", fontSize: "0.75rem" } } }}
                      sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1 } }}
                    />
                  )}
                </>
              ) : (
                <Box sx={{ color: "text.disabled", fontSize: "0.72rem", fontStyle: "italic" }}>
                  Sign-in–only saved search (local). Re-save while signed in to enable email alerts.
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
