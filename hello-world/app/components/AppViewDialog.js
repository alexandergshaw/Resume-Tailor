"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import { useIsMobile } from "../hooks/useResponsive";

export default function AppViewDialog({
  appDialog,
  setAppDialog,
  applicationData,
  communicationsDialog,
  loadCommunicationsForApp,
  openAddCommunicationDialog,
  FormattedContent,
}) {
  const isMobile = useIsMobile();
  const dApp = appDialog.rowIndex != null ? applicationData[appDialog.rowIndex] : null;
  const dPos = dApp?.positions;
  const dResume = dApp?.generated_resumes;
  const pages = [
    dApp?.id ? "communications" : null,
    dPos?.description ? "jd" : null,
    dResume?.content ? "resume" : null,
  ].filter(Boolean);
  const pageIdx = pages.indexOf(appDialog.kind);
  const commsLoadedForThisApp =
    dApp && communicationsDialog.applicationId === dApp.id;
  const dialogTitle =
    appDialog.kind === "jd"
      ? `${dPos?.company || ""} — Job Description`
      : appDialog.kind === "resume"
        ? `Your Resume — ${dPos?.title || "Role"}`
        : `Recruiter Communications${
            dPos?.company || dPos?.title
              ? ` — ${dPos?.company || "Unknown Company"}${dPos?.title ? ` / ${dPos.title}` : ""}`
              : ""
          }`;
  const navigate = (dir) => {
    if (pages.length === 0) return;
    const next = (pageIdx + dir + pages.length) % pages.length;
    const nextKind = pages[next];
    setAppDialog((prev) => ({ ...prev, kind: nextKind }));
    if (nextKind === "communications" && dApp && communicationsDialog.applicationId !== dApp.id) {
      loadCommunicationsForApp(dApp);
    }
  };
  return (
    <Dialog
      open={appDialog.open}
      onClose={() => setAppDialog({ open: false, rowIndex: null, kind: "jd" })}
      maxWidth="md"
      fullWidth
      fullScreen={isMobile}
      PaperProps={{
        onKeyDown: (e) => {
          if (e.key === "ArrowRight") navigate(1);
          if (e.key === "ArrowLeft") navigate(-1);
        },
        tabIndex: -1,
      }}
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Button
            size="small"
            disabled={pages.length <= 1}
            onClick={() => navigate(-1)}
            sx={{ minWidth: 36, px: 0.75, fontSize: 22, lineHeight: 1 }}
            aria-label="Previous"
          >
            ‹
          </Button>
          <Box sx={{ flex: 1, fontWeight: 700, fontSize: "1rem" }}>
            {dialogTitle}
            {pages.length > 1 && (
              <Box component="span" sx={{ ml: 1.5, fontSize: 12, fontWeight: 400, color: "text.secondary" }}>
                {pageIdx + 1} / {pages.length}
              </Box>
            )}
          </Box>
          <Button
            size="small"
            disabled={pages.length <= 1}
            onClick={() => navigate(1)}
            sx={{ minWidth: 36, px: 0.75, fontSize: 22, lineHeight: 1 }}
            aria-label="Next"
          >
            ›
          </Button>
        </Box>
      </DialogTitle>
      <DialogContent dividers sx={{ maxHeight: "70vh" }}>
        {appDialog.kind === "communications" ? (
          !commsLoadedForThisApp || communicationsDialog.loading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress size={24} />
            </Box>
          ) : communicationsDialog.error ? (
            <p style={{ color: "var(--danger)", margin: 0 }}>{communicationsDialog.error}</p>
          ) : communicationsDialog.items.length === 0 ? (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, alignItems: "flex-start" }}>
              <p style={{ color: "var(--text-secondary)", margin: 0 }}>No recruiter communications logged yet.</p>
              {dApp ? (
                <Button size="small" variant="outlined" onClick={() => openAddCommunicationDialog(dApp)}>
                  Add Communication
                </Button>
              ) : null}
            </Box>
          ) : (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              {communicationsDialog.items.map((item) => (
                <Box
                  key={item.id}
                  sx={{
                    p: 1.5,
                    borderRadius: 2.5,
                    border: "1px solid var(--border)",
                    backgroundColor: "var(--bg-soft)",
                  }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap", mb: 1 }}>
                    <Chip size="small" label={item.direction || "inbound"} variant="outlined" />
                    <Chip size="small" label={item.type || "email"} variant="outlined" />
                    <Box component="span" sx={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      {item.communicated_at ? new Date(item.communicated_at).toLocaleString() : "Logged communication"}
                    </Box>
                  </Box>
                  {item.subject ? (
                    <Box sx={{ fontWeight: 700, mb: 0.75 }}>{item.subject}</Box>
                  ) : null}
                  {(item.sender_name || item.sender_email || item.sender_title) ? (
                    <Box sx={{ mb: 0.75, fontSize: 12, color: "var(--text-secondary)" }}>
                      {[item.sender_name, item.sender_title, item.sender_email].filter(Boolean).join(" · ")}
                    </Box>
                  ) : null}
                  <Box sx={{ whiteSpace: "pre-wrap", lineHeight: 1.7, fontSize: 13.5 }}>
                    {item.body || "—"}
                  </Box>
                </Box>
              ))}
            </Box>
          )
        ) : (
          <FormattedContent
            text={appDialog.kind === "jd" ? (dPos?.description ?? "") : (dResume?.content ?? "")}
            kind={appDialog.kind}
          />
        )}
      </DialogContent>
      <DialogActions>
        {appDialog.kind === "communications" && dApp ? (
          <Button onClick={() => openAddCommunicationDialog(dApp)}>
            Add
          </Button>
        ) : null}
        <Button onClick={() => setAppDialog({ open: false, rowIndex: null, kind: "jd" })}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
