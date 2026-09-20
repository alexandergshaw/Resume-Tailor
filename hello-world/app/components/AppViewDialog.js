"use client";

import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import { useIsMobile } from "../hooks/useResponsive";
import { usePrepGeneration } from "../hooks/usePrepGeneration";
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

/** F-1's fix (chunk N33/N25 blocker): the ONLY client caller of `PUT
 *  /api/interview-prep` -- PrepPackPanel's own header says it must never
 *  fetch for itself, so this is the production call site `onSaveNames`
 *  wires to below, exactly like `downloadPrepLog` below is the wiring for
 *  `onDownloadLog`. Exported (unlike `downloadPrepLog`) so a test can call
 *  it directly rather than mounting this whole dialog's full prop tree.
 *  Always sends BOTH `candidateName` and `interviewerNamesText` together --
 *  see PrepPackPanel.js's own header (F-7) for why a partial body would
 *  silently wipe whichever field it omits. */
export async function saveTrustedNames(applicationId, { candidateName, interviewerNamesText }) {
  const res = await fetch("/api/interview-prep", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applicationId, candidateName, interviewerNamesText }),
  });
  return res.json();
}

/** N29/DS-N29.7: the interview-prep GET fetch, extracted from the mount
 *  effect's own body so it is callable from two sites -- the mount/reopen
 *  effect below, and `handleGenerateNow`'s own post-success refetch -- with
 *  exactly one implementation, not two independently-maintained copies. The
 *  setter is threaded in as a parameter, not closed over, so this stays a
 *  plain, directly-testable module function (mirroring `saveTrustedNames`
 *  above), rather than a closure only reachable by mounting the whole
 *  dialog. Every POST branch this route can return carries no pack content
 *  of its own (route.js's own terminal writes are `{status}` only), so a
 *  completed generation is only ever reflected by re-running this GET. */
export function fetchPrep(applicationId, setPrepById) {
  return fetch(`/api/interview-prep?applicationId=${encodeURIComponent(applicationId)}`)
    .then((res) => res.json())
    .then((data) => setPrepById((prev) => ({ ...prev, [applicationId]: data })))
    .catch(() => setPrepById((prev) => ({ ...prev, [applicationId]: { error: "Could not load your prep pack." } })));
}

/** N29: maps a `usePrepGeneration` result to the transient message
 *  `PrepPackPanel` shows for an outcome that leaves no trace in the
 *  persisted pack row (disabled / refused / a bare error) -- a normal
 *  terminal status (ready/partial/failed/unavailable) needs no message of
 *  its own, since the panel's own `StatusBanner` already renders it off the
 *  refetched pack (`handleGenerateNow` below never calls this for that
 *  branch). Total: never throws, never returns `undefined`, so its caller
 *  can always render the return value directly. `"attempts-spent"` is no
 *  longer a value the server can produce once N41's cap-removal migration
 *  lands, so it is not special-cased here -- an unrecognized `reason` falls
 *  to the same generic "refused" copy as a genuine claim-RPC error. */
export function messageFor(result) {
  if (result?.status === "disabled") {
    return "Interview prep isn't available right now. Nothing was generated — try again later.";
  }
  if (result?.status === "refused") {
    if (result.reason === "in-flight") {
      return "A prep pack is already being generated for this application. Wait for it to finish, then check back.";
    }
    return "Something went wrong starting this attempt. Try again.";
  }
  return result?.error || "Something went wrong. Try again.";
}

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
  // N29's coordinator-named defect: the id "last fetched fresh for, since
  // the dialog was last opened" -- reset to null on close, so the very next
  // "prep" open (same row or a different one) always fetches fresh, instead
  // of the old guard's `|| prepById[dApp.id]) return`, which never refetched
  // a cached snapshot once one existed (including a stale `status:"running"`
  // left behind by an automatic B1/B3 trigger nobody in this session is
  // watching). Paging between kinds within one open session still never
  // refetches -- the ref stays equal to `dApp.id` for the whole time the
  // dialog stays open.
  const prepFetchedForRef = useRef(null);
  useEffect(() => {
    if (!appDialog.open) {
      prepFetchedForRef.current = null;
      return;
    }
    if (appDialog.kind !== "prep" || !dApp?.id || prepFetchedForRef.current === dApp.id) return;
    prepFetchedForRef.current = dApp.id;
    fetchPrep(dApp.id, setPrepById);
  }, [appDialog.kind, appDialog.open, dApp?.id]);

  // N29: the manual "prepare me for this interview" control (usePrepGeneration.js).
  const { generatingIds, generateNow } = usePrepGeneration();
  // Widens the in-flight signal to also cover the post-success refetch
  // (design-experience.r1.md §5's own named sequencing gap) -- `generating`
  // stays true from the moment `generateNow` starts until the refetch below
  // has actually landed, not merely until the POST itself settles.
  const [refreshingIds, setRefreshingIds] = useState(() => new Set());
  const [prepMessageById, setPrepMessageById] = useState({});

  async function handleGenerateNow() {
    if (!dApp?.id) return;
    const id = dApp.id;
    const result = await generateNow(id);
    if (result?.skipped) return;
    if (result?.status && result.status !== "disabled" && result.status !== "refused") {
      setRefreshingIds((prev) => new Set(prev).add(id));
      try {
        await fetchPrep(id, setPrepById);
      } finally {
        setRefreshingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
      setPrepMessageById((prev) => ({ ...prev, [id]: null }));
      return;
    }
    setPrepMessageById((prev) => ({ ...prev, [id]: messageFor(result) }));
  }

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
              generating={generatingIds.has(dApp?.id) || refreshingIds.has(dApp?.id)}
              triggerMessage={dApp?.id ? (prepMessageById[dApp.id] ?? null) : null}
              onGenerateNow={handleGenerateNow}
              hasDescription={!!String(dPos?.description || "").trim()}
              onSaveNames={(form) => {
                if (!dApp?.id) return;
                saveTrustedNames(dApp.id, form)
                  .then((result) => {
                    if (!result?.written) return;
                    setPrepById((prev) => ({
                      ...prev,
                      [dApp.id]: {
                        ...(prev[dApp.id] || {}),
                        candidateName: (form.candidateName || "").trim(),
                        interviewerNames: form.interviewerNamesText
                          .split(",")
                          .map((name) => name.trim())
                          .filter(Boolean),
                      },
                    }));
                  })
                  .catch(() => {});
              }}
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
