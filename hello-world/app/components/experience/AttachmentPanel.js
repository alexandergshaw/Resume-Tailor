"use client";

// Chunk 4 — attachments on a project page: files, images and video. Lists
// what's already uploaded (with an inline thumbnail/player for image/video
// kinds, using the short-lived signed URL the GET route mints), a real file
// input to add another, and a per-attachment notes field the AI reads.
//
// Drag-and-drop is layered on TOP of the real <input type="file"> below, not
// instead of it — a drag-only upload zone is unreachable by keyboard.

import { useCallback, useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import DeleteIcon from "@mui/icons-material/Delete";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import { classifyAttachment } from "../../../lib/experience/attachments";

const KIND_LABEL = { image: "Image", pdf: "PDF", video: "Video", text: "Text", other: "File" };

// Built explicitly rather than typed as a literal character in source, for
// the same reason PageEditor.js's own ANNOUNCE_TOGGLE is: an invisible
// unicode character embedded directly in a source file is easy to lose or
// mis-copy in an edit.
const ANNOUNCE_TOGGLE = String.fromCodePoint(0x200b);

// { text, seq } rather than a plain string — reusing PageEditor.js's own
// pattern for this exact problem rather than inventing a fourth variant of
// it (the save-status region and the move-failure alert already carry it).
// React bails out of a setState whose new value is Object.is-equal to what
// is already there, so the SAME rejection reason announced twice in a row —
// the expected shape of a retry, since onInputChange deliberately clears
// the file input so the identical file can be re-picked — would otherwise
// reach a screen reader only once. A fresh object every call defeats that
// bailout (a new object is never Object.is-equal to the last one); the
// toggled trailing character is what then makes the rendered TEXT itself
// differ between two consecutive identical messages, which is what an
// aria-live/role=alert region's listener actually has to observe to
// re-announce — an unchanged text node is left untouched by React's own
// reconciler even once the surrounding state object is new.
function bumpAnnouncement(prevSeq, text) {
  return { text, seq: (prevSeq ?? 0) + 1 };
}

function announcedText(entry) {
  if (!entry || !entry.text) return "";
  return entry.seq % 2 === 1 ? `${entry.text}${ANNOUNCE_TOGGLE}` : entry.text;
}

// notesErrors/deleteErrors are keyed maps, and both clear an id's entry
// outright (delete the key) at the start of a retry, before knowing whether
// the retry will fail again — unlike uploadError's single { text, seq }
// object, whose `seq` survives being reset to text: "" because the state
// object itself is never removed. Reading `prev[id]?.seq` the way
// uploadError reads `prev.seq` would therefore see undefined on every
// retry's failure (the entry was just deleted) and restart the count at 1
// every time, defeating the whole mechanism — two separate failures would
// both land on the same odd parity and render identically. The seq for a
// given id has to live somewhere that survives the entry being deleted; a
// ref, keyed the same way, is that somewhere.
function nextSeqFor(seqRef, id) {
  const next = (seqRef.current[id] ?? 0) + 1;
  seqRef.current[id] = next;
  return next;
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// The one supported path (a secure context, which this feature already
// requires) always has crypto.randomUUID. The fallback exists only for
// defensiveness, but the id doubles as the row's primary key, so it must
// still emit a genuine v4 uuid — mirrors lib/supabase/practiceAnswers.js's
// genId.
function genId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

export default function AttachmentPanel({ pageId }) {
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  // { text, seq } — see bumpAnnouncement/announcedText above.
  const [uploadError, setUploadError] = useState({ text: "", seq: 0 });
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  // Keyed by attachment id. Absence of a key means "no error" — present
  // means the last save for that attachment failed and has not yet
  // succeeded on retry. See saveNotes: the field's typed text is never
  // rolled back when this is set, only ever cleared once a save actually
  // lands.
  const [notesErrors, setNotesErrors] = useState({});
  // Same shape as notesErrors, same reason to exist — keyed by attachment
  // id, present only while that attachment's last delete attempt has
  // failed and not yet succeeded on retry. See removeAttachment.
  const [deleteErrors, setDeleteErrors] = useState({});
  // Per-id announcement sequence numbers for notesErrors/deleteErrors — see
  // nextSeqFor's own comment for why these live outside the state objects
  // they announce.
  const notesErrorSeqRef = useRef({});
  const deleteErrorSeqRef = useRef({});
  // The panel otherwise has no live region at all: a successful upload or
  // delete is silent to a screen reader even though both failure paths
  // (uploadError, deleteErrors) are announced. { text, seq } for the same
  // reason as everywhere else here.
  const [statusAnnouncement, setStatusAnnouncement] = useState({ text: "", seq: 0 });
  const inputRef = useRef(null);

  // The pageId an in-flight async operation (an upload, in practice) was
  // started under, kept current so that operation can tell — once it
  // resolves — whether the user has since moved on to a different page.
  // Synced in an effect rather than mutated directly during render:
  // react-hooks/refs (the React Compiler's purity rule, part of
  // eslint-plugin-react-hooks v7) flags a ref write in the render body
  // itself, even one like this that never affects what gets rendered.
  const pageIdRef = useRef(pageId);
  useEffect(() => {
    pageIdRef.current = pageId;
  }, [pageId]);

  // The underlying <textarea> DOM node for each attachment's notes field,
  // keyed by attachment id — mirrors JobDescriptionTab.js's own
  // `fieldRefs.current[entry.id] = el` pattern. Populated via each field's
  // own inputRef callback below; used only to move focus onto a specific
  // one once it exists (see focusNotesId's effect).
  const notesFieldRefs = useRef({});
  // New cards append to the END of the list, so without this a keyboard
  // user has to tab past every existing attachment to reach the one they
  // just added. Set right alongside the successful upload's own
  // setAttachments call (see uploadFile); the effect below moves focus once
  // that new card — and its ref — actually exist in the DOM. No reset to
  // null afterward: each upload's id is a fresh crypto.randomUUID(), so the
  // next upload's id is never Object.is-equal to this one and the effect
  // fires again regardless of whether this was ever cleared.
  const [focusNotesId, setFocusNotesId] = useState(null);
  useEffect(() => {
    if (!focusNotesId) return;
    const el = notesFieldRefs.current[focusNotesId];
    if (el) el.focus();
  }, [focusNotesId]);

  // Both error maps are keyed only by attachment id, and ids are not scoped
  // to a page anywhere the panel itself enforces — two different pages can
  // have an attachment with the same id. Left uncleared, an error from one
  // page's attachment would keep showing (against a DIFFERENT attachment
  // that happens to share its id, wrongly naming the file the error was
  // actually about) until it coincidentally got overwritten. Cleared
  // outright on every page switch instead. Deferred one tick, like load's
  // own effect above, so this is never a setState call landing
  // synchronously within the effect body itself (react-hooks/set-state-in-effect
  // flags that shape).
  useEffect(() => {
    const handle = setTimeout(() => {
      setNotesErrors({});
      setDeleteErrors({});
    }, 0);
    return () => clearTimeout(handle);
  }, [pageId]);

  const load = useCallback(async () => {
    if (!pageId) {
      setAttachments([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch(`/api/experience/attachments?pageId=${encodeURIComponent(pageId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(data?.error || "Could not load attachments.");
        setAttachments([]);
        return;
      }
      setAttachments(Array.isArray(data.attachments) ? data.attachments : []);
    } catch (err) {
      setLoadError(err?.message || "Could not load attachments.");
    } finally {
      setLoading(false);
    }
  }, [pageId]);

  useEffect(() => {
    // Deferred one tick (mirrors AutoApplyQueueTab.js's own load effect) so
    // this is never a setState call landing synchronously within the effect
    // body itself — react-hooks/set-state-in-effect flags that shape even
    // though `load`'s early-return branch can otherwise resolve before any
    // `await`.
    const handle = setTimeout(() => load(), 0);
    return () => clearTimeout(handle);
  }, [load]);

  const uploadFile = useCallback(
    async (file) => {
      if (!file || !pageId) return;
      // Captured now, not read again after the await below — pageIdRef
      // (kept current every render) is what tells this, once the request
      // comes back, whether the user is still on the page it started for.
      const startedForPageId = pageId;

      const classification = classifyAttachment({ name: file.name, type: file.type, size: file.size });
      if (!classification.ok) {
        setUploadError((prev) => bumpAnnouncement(prev.seq, classification.reason));
        return;
      }

      setUploadError((prev) => bumpAnnouncement(prev.seq, ""));
      setUploading(true);
      try {
        const form = new FormData();
        form.set("pageId", startedForPageId);
        form.set("id", genId());
        form.set("file", file);
        const res = await fetch("/api/experience/attachments", { method: "POST", body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setUploadError((prev) => bumpAnnouncement(prev.seq, data?.error || "Could not upload this file."));
          return;
        }
        // The user may have switched to a different page while this was in
        // flight. Appending now would put this row on whatever page's list
        // happens to be on screen, not the one it was actually uploaded to.
        if (data.attachment && pageIdRef.current === startedForPageId) {
          setAttachments((prev) => [...prev, data.attachment]);
          setStatusAnnouncement((prev) => bumpAnnouncement(prev.seq, `Added "${data.attachment.name}"`));
          setFocusNotesId(data.attachment.id);
        }
      } catch (err) {
        setUploadError((prev) => bumpAnnouncement(prev.seq, err?.message || "Could not upload this file."));
      } finally {
        setUploading(false);
      }
    },
    [pageId],
  );

  const onInputChange = (event) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // lets the same file be picked again later
    if (file) uploadFile(file);
  };

  const onDragOver = (event) => {
    event.preventDefault();
    setDragActive(true);
  };

  const onDragLeave = (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setDragActive(false);
  };

  const onDrop = (event) => {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) uploadFile(file);
  };

  const onNotesInput = (id, notes) => {
    setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, notes } : a)));
  };

  // Mirrors PageEditor's failed-save shape rather than inventing a second
  // one: a visible error naming the attachment, the user's typed text left
  // exactly as they left it, and a Retry that re-issues the same PATCH.
  // Never rolled back to the last-saved server value on failure — that
  // would destroy what the user just wrote, and for a video the notes field
  // is the ONLY description of that file the AI ever gets (the video bytes
  // themselves are never sent as context), so losing it silently is a real
  // loss, not a cosmetic one.
  const saveNotes = useCallback(async (id, name, notes) => {
    setNotesErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      const res = await fetch(`/api/experience/attachments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setNotesErrors((prev) => ({
        ...prev,
        [id]: {
          text: `Could not save the note for "${name}". Your text has not been lost — try again.`,
          seq: nextSeqFor(notesErrorSeqRef, id),
        },
      }));
    }
  }, []);

  // Mirrors saveNotes' own shape exactly (clear any previous error for this
  // id before trying again; on failure, set one naming the file) rather
  // than inventing a second error pattern for the same kind of failure.
  const removeAttachment = useCallback(async (attachment) => {
    setDeleteErrors((prev) => {
      if (!(attachment.id in prev)) return prev;
      const next = { ...prev };
      delete next[attachment.id];
      return next;
    });
    try {
      const res = await fetch(`/api/experience/attachments/${attachment.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setAttachments((prev) => prev.filter((a) => a.id !== attachment.id));
      setStatusAnnouncement((prev) => bumpAnnouncement(prev.seq, `Removed "${attachment.name}"`));
    } catch {
      // Leave the row in place — the delete did not take — and now say so,
      // instead of leaving that absence of change as the only signal.
      setDeleteErrors((prev) => ({
        ...prev,
        [attachment.id]: {
          text: `Could not delete "${attachment.name}". Try again.`,
          seq: nextSeqFor(deleteErrorSeqRef, attachment.id),
        },
      }));
    }
  }, []);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: "center" }}>
        <Typography variant="subtitle1">Attachments</Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Box
          component="span"
          role="status"
          aria-live="polite"
          sx={{ fontSize: 12.5, color: "text.secondary" }}
        >
          {announcedText(statusAnnouncement)}
        </Box>
      </Stack>

      {loadError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {loadError}
        </Alert>
      )}

      <Box
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        sx={{
          border: "1px dashed",
          borderColor: dragActive ? "primary.main" : "divider",
          borderRadius: 1,
          p: 2,
          mb: 2,
        }}
      >
        <Typography component="label" htmlFor="attachment-file-input" variant="body2" sx={{ display: "block", mb: 1 }}>
          Add a file, image or video
        </Typography>
        <input ref={inputRef} id="attachment-file-input" type="file" onChange={onInputChange} disabled={uploading} />
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
          Or drag a file into this box. Video up to 100 MB; everything else up to 25 MB.
        </Typography>
      </Box>

      {uploading && (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 2 }}>
          <CircularProgress size={16} />
          <Typography variant="body2">Uploading…</Typography>
        </Stack>
      )}

      {uploadError.text && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          onClose={() => setUploadError((prev) => bumpAnnouncement(prev.seq, ""))}
        >
          {announcedText(uploadError)}
        </Alert>
      )}

      {attachments.length === 0 && !loadError && (
        <Typography variant="body2" color="text.secondary">
          No attachments yet.
        </Typography>
      )}

      <Stack spacing={2}>
        {attachments.map((attachment) => (
          <Card key={attachment.id} variant="outlined">
            <CardContent>
              <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
                <Box sx={{ width: 96, flexShrink: 0 }}>
                  {attachment.kind === "image" && attachment.url && (
                    <Box
                      component="img"
                      src={attachment.url}
                      alt={attachment.notes || attachment.name}
                      sx={{ width: 1, borderRadius: 1, display: "block" }}
                    />
                  )}
                  {attachment.kind === "video" && attachment.url && (
                    <Box
                      component="video"
                      controls
                      src={attachment.url}
                      aria-label={attachment.notes || attachment.name}
                      sx={{ width: 1, borderRadius: 1, display: "block" }}
                    />
                  )}
                  {(attachment.kind !== "image" && attachment.kind !== "video") && (
                    <InsertDriveFileIcon fontSize="large" color="action" />
                  )}
                </Box>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: "break-word" }}>
                    {attachment.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {KIND_LABEL[attachment.kind] || "File"}
                    {formatBytes(attachment.bytes) ? ` • ${formatBytes(attachment.bytes)}` : ""}
                  </Typography>
                  <TextField
                    fullWidth
                    multiline
                    minRows={1}
                    size="small"
                    margin="dense"
                    label="Notes for the AI"
                    // The visible floating label stays identical for every
                    // card on purpose (it's the field's PURPOSE, and that is
                    // the same everywhere) — the accessible name is what has
                    // to be distinct, since it's what a screen reader's
                    // form-field list shows in place of visible position.
                    // slotProps.htmlInput is MUI's documented way to reach
                    // the underlying <textarea> itself, matching
                    // JobDescriptionTab.js's own reasoning: a plain
                    // aria-label prop on TextField would land on the root
                    // FormControl, not the field an AT is actually focused
                    // on.
                    slotProps={{ htmlInput: { "aria-label": `Notes for the AI for ${attachment.name}` } }}
                    inputRef={(el) => {
                      notesFieldRefs.current[attachment.id] = el;
                    }}
                    value={attachment.notes || ""}
                    onChange={(event) => onNotesInput(attachment.id, event.target.value)}
                    onBlur={(event) => saveNotes(attachment.id, attachment.name, event.target.value)}
                  />
                  {notesErrors[attachment.id] && (
                    <Alert
                      severity="error"
                      sx={{ mt: 0.5 }}
                      action={
                        <Button
                          color="inherit"
                          size="small"
                          onClick={() => saveNotes(attachment.id, attachment.name, attachment.notes || "")}
                        >
                          Retry
                        </Button>
                      }
                    >
                      {announcedText(notesErrors[attachment.id])}
                    </Alert>
                  )}
                  {deleteErrors[attachment.id] && (
                    <Alert
                      severity="error"
                      sx={{ mt: 0.5 }}
                      action={
                        <Button color="inherit" size="small" onClick={() => removeAttachment(attachment)}>
                          Retry
                        </Button>
                      }
                    >
                      {announcedText(deleteErrors[attachment.id])}
                    </Alert>
                  )}
                </Box>
                <IconButton
                  aria-label={`Delete ${attachment.name}`}
                  onClick={() => removeAttachment(attachment)}
                  size="small"
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>
    </Box>
  );
}
