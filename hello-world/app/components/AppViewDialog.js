"use client";

import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import { useIsMobile } from "../hooks/useResponsive";
import FieldError from "./FieldError";
import FormattedContent from "./FormattedContent";
import MarkdownPreview from "./experience/MarkdownPreview";
import { formatRelative } from "../../lib/feed/liveFeedClient";
import { safeExternalHref } from "@/lib/url/safeExternalHref";

// The digest tab's body: the real markdown parser (never FormattedContent.js
// - that heuristic is shaped for a job ad's plain text, not genuine markdown
// a model wrote), the sources the model actually grounded on, and when the
// research last ran. A module-level component (not one declared inside
// AppViewDialog) so it is not recreated - and its own state, if it ever
// grows any, reset - on every AppViewDialog render.
function DigestPanel({ digest, nowTs }) {
  if (!digest?.markdown) {
    return <Box sx={{ color: "text.secondary", fontStyle: "italic" }}>Not researched yet.</Box>;
  }
  const sources = Array.isArray(digest.sources) ? digest.sources : [];
  return (
    <Box>
      <MarkdownPreview markdown={digest.markdown} />
      {sources.length > 0 && (
        <Box sx={{ mt: 2, pt: 1.5, borderTop: "1px solid var(--border)" }}>
          <Box sx={{ fontWeight: 700, fontSize: 12, mb: 0.5 }}>Sources</Box>
          {sources.map((s, i) => {
            // `sources` is `jsonb not null default '[]'` - the read-back
            // gives no element-level type guarantee, and these values come
            // from grounded search, where isGroundedHost compares hostnames
            // with no scheme test at all. So nothing upstream has checked
            // this string, and `String({url})` would render "[object
            // Object]" as an href. A refused source stays VISIBLE (it is
            // still what the model grounded on) but is not a link.
            const href = safeExternalHref(s?.url);
            const label = s?.title || (typeof s?.url === "string" ? s.url : "Unnamed source");
            return (
              <Box key={href || `source-${i}`} sx={{ fontSize: 12, mb: 0.25 }}>
                {href ? (
                  <Box
                    component="a"
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{ color: "var(--accent)" }}
                  >
                    {label}
                  </Box>
                ) : (
                  <Box component="span" sx={{ color: "var(--text-secondary)" }}>
                    {label}
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      )}
      {digest.updated_at && nowTs > 0 && (
        <Box sx={{ mt: 1.5, fontSize: 11, color: "text.secondary" }}>
          Researched {formatRelative(digest.updated_at, nowTs)}
        </Box>
      )}
    </Box>
  );
}

export default function AppViewDialog({
  appDialog,
  setAppDialog,
  applicationData,
  communicationsDialog,
  loadCommunicationsForApp,
  openAddCommunicationDialog,
  digestsById = {},
}) {
  const isMobile = useIsMobile();

  // "Researched <relative time>" needs a wall-clock reference, and calling
  // Date.now() directly during render is impure (the same trap
  // LiveFeedTab.js's own `nowTs` comment documents) - resolved once after
  // mount instead, in an effect, same as that file's fix.
  const [nowTs, setNowTs] = useState(0);
  useEffect(() => {
    const id = setTimeout(() => setNowTs(Date.now()), 0);
    return () => clearTimeout(id);
  }, []);

  const dApp = appDialog.rowIndex != null ? applicationData[appDialog.rowIndex] : null;
  const dPos = dApp?.positions;
  const dResume = dApp?.generated_resumes;
  const dDigest = dApp?.id ? digestsById[dApp.id] : null;
  const pages = [
    dApp?.id ? "communications" : null,
    dPos?.description ? "jd" : null,
    dResume?.content ? "resume" : null,
    dDigest?.markdown ? "digest" : null,
  ].filter(Boolean);
  const pageIdx = pages.indexOf(appDialog.kind);
  const commsLoadedForThisApp =
    dApp && communicationsDialog.applicationId === dApp.id;
  const dialogTitle =
    appDialog.kind === "jd"
      ? `${dPos?.company || ""} — Job Description`
      : appDialog.kind === "resume"
        ? `Your Resume — ${dPos?.title || "Role"}`
        : appDialog.kind === "digest"
          ? `${dPos?.company || "Company"} & role — Research`
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
            <FieldError>{communicationsDialog.error}</FieldError>
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
        ) : appDialog.kind === "digest" ? (
          <DigestPanel digest={dDigest} nowTs={nowTs} />
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
