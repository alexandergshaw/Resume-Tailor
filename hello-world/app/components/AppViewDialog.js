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
import DigestPanel from "./tracking/DigestPanel";
import PrepPackPanel from "./tracking/PrepPackPanel";
import { triggerBlobDownload } from "@/lib/document/download";

// The digest tab's body lives in ./tracking/DigestPanel.js. It moved out
// because it grew the thing this dialog cannot host: citation markers, three
// separately labelled source groups, and the four states that look alike but
// mean opposite things (cited / never searched / searched-and-none-placed /
// written before the pipeline existed). None of that is falsifiable while it
// is a private function inside a component that needs a page-sized prop tree
// to mount.
//
// The interview-prep tab's body lives in ./tracking/PrepPackPanel.js, for the
// same reason plus one more (design-reconciled.r2.md ss5.3/ss4.2): it must
// never import prepStore.js/prepParse.js/prepPack.js/trustedNames.js, because
// those carry the O-15 given-name lexicon at module scope, and this dialog is
// itself a "use client" file -- so THIS file cannot import them either. Pack
// content, section completeness, and both name fields all arrive here as
// plain JSON from the server-only GET /api/interview-prep route instead.

/** Builds the "Download prep log" content from the `events` array the GET
 *  route's own response already carries -- never a second, independent
 *  download mechanism (AC-N33.21's own bar). Hosts/outcomes only, matching
 *  this repo's other feature logs' own discipline of never re-deriving pack
 *  content into a download. */
function downloadPrepLog(dApp, dPrep) {
  const events = Array.isArray(dPrep?.events) ? dPrep.events : [];
  const lines = [
    "# Interview prep activity log",
    "",
    `Application: ${dApp?.id || "unknown"}`,
    "",
    ...events.map(
      (e) =>
        `- ${e.at || "unknown time"}: ${e.event_type || "event"} (${e.outcome || "unknown"})${
          e.reason ? ` — ${e.reason}` : ""
        }`
    ),
  ];
  triggerBlobDownload(
    new Blob([`${lines.join("\n")}\n`], { type: "text/markdown" }),
    `interview-prep-log-${dApp?.id || "row"}.md`
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
  researchingIds,
  researchOne,
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

  // N25/N33's read surface. Fetched on demand (only once per application,
  // never re-fetched merely for switching pages back and forth) from the
  // server-only GET route -- never from a client-side prepStore.js/
  // prepParse.js import, per this file's own header.
  const [prepById, setPrepById] = useState({});
  const dApp = appDialog.rowIndex != null ? applicationData[appDialog.rowIndex] : null;
  const dPos = dApp?.positions;
  const dResume = dApp?.generated_resumes;
  const dDigest = dApp?.id ? digestsById[dApp.id] : null;
  const dPrep = dApp?.id ? prepById[dApp.id] : null;
  useEffect(() => {
    if (appDialog.kind !== "prep" || !dApp?.id || prepById[dApp.id]) return;
    let cancelled = false;
    fetch(`/api/interview-prep?applicationId=${encodeURIComponent(dApp.id)}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setPrepById((prev) => ({ ...prev, [dApp.id]: data }));
      })
      .catch(() => {
        if (!cancelled) setPrepById((prev) => ({ ...prev, [dApp.id]: { error: "Could not load your prep pack." } }));
      });
    return () => {
      cancelled = true;
    };
  }, [appDialog.kind, dApp?.id, prepById]);

  const pages = [
    dApp?.id ? "communications" : null,
    dPos?.description ? "jd" : null,
    dResume?.content ? "resume" : null,
    dDigest?.markdown ? "digest" : null,
    dApp?.id ? "prep" : null,
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
          : appDialog.kind === "prep"
            ? `Interview Prep${dPos?.company ? ` — ${dPos.company}` : ""}`
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
      {/* On a phone the dialog is already fullScreen, so a 70vh cap on the
          scrolling body leaves ~30% of the screen unused above a footer that
          has nowhere to go - and the source groups this feature adds are what
          gets pushed off the bottom. The cap is desktop-only. */}
      <DialogContent dividers sx={{ maxHeight: isMobile ? "none" : "70vh" }}>
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
          <DigestPanel
            digest={dDigest}
            nowTs={nowTs}
            researching={!!researchingIds?.has?.(dApp?.id)}
            onResearchAgain={researchOne}
          />
        ) : appDialog.kind === "prep" ? (
          !dPrep ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress size={24} />
            </Box>
          ) : dPrep.error && !dPrep.status ? (
            <FieldError>{dPrep.error}</FieldError>
          ) : (
            <PrepPackPanel
              applicationId={dApp?.id}
              pack={dPrep.pack ?? null}
              status={dPrep.status ?? null}
              completeSections={dPrep.completeSections ?? []}
              attemptsExhausted={!!dPrep.attemptsExhausted}
              candidateName={dPrep.candidateName ?? null}
              interviewerNames={dPrep.interviewerNames ?? []}
              error={dPrep.error ?? null}
              onDownloadLog={() => downloadPrepLog(dApp, dPrep)}
            />
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
