"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import FormDialog from "./FormDialog";
import { TOUCH_TARGET_SX } from "@/app/theme/mobileSx";

import { AUTOFILL_FIELDS, buildBookmarklet, profileHasValues } from "@/lib/autofill/buildBookmarklet";

const EMPTY_PROFILE = AUTOFILL_FIELDS.reduce((acc, f) => {
  acc[f.key] = "";
  return acc;
}, {});

// Editable profile used to auto-fill application forms, plus a draggable
// bookmarklet generated from the saved values. Dragging the bookmarklet to the
// bookmarks bar is a one-time setup; clicking "Auto Fill" on a card opens the
// posting and copies the same bookmarklet to the clipboard for quick use.
// This dialog now offers that same copy route directly (AC-K3): a keyboard
// user can't drag, and a bookmarklet reaches the bookmarks bar by being
// dragged there OR pasted into a new bookmark, so "Copy bookmarklet" plus
// paste is the real equivalent, not a simulated drag.
export default function AutofillProfileDialog({ open, onClose, profile, onSaved }) {
  const [draft, setDraft] = useState(EMPTY_PROFILE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // AC-K3: the drag-only bookmarklet's non-pointer route. `copied` drives the
  // only visible sign the (invisible) clipboard write happened; the timeout
  // ref lets a second click reset a still-pending "Copied!" instead of
  // stacking two timers that could clear each other's state out of order.
  const [copied, setCopied] = useState(false);
  const copiedTimeoutRef = useRef(null);
  // MAJOR 5: React 19's `sanitizeURL` replaces ANY `javascript:` href with a
  // fixed throwing stub before it ever reaches the DOM -- verified directly
  // against both the client and server bundles
  // (react-dom-client.development.js and react-dom-server.node.development.js).
  // Passing `href={bookmarklet}` as a plain JSX prop can therefore never put
  // the real bookmarklet in the DOM: dragging the rendered anchor to the
  // bookmarks bar would produce a bookmark that throws on every posting it's
  // run against. `bookmarkletLinkRef` + the `useLayoutEffect` below bypass
  // React's own attribute reconciliation (and its sanitizer) with a manual
  // `setAttribute` -- see that effect for why it has to be a LAYOUT effect,
  // not a plain one, and why it has to re-run on every `bookmarklet` change,
  // not just at mount.
  const bookmarkletLinkRef = useRef(null);

  // Reset the draft from the latest saved profile whenever the dialog opens.
  useEffect(() => {
    if (!open) return undefined;
    const handle = setTimeout(() => {
      setDraft({ ...EMPTY_PROFILE, ...(profile || {}) });
      setError("");
    }, 0);
    return () => clearTimeout(handle);
  }, [open, profile]);

  const bookmarklet = useMemo(() => buildBookmarklet(draft), [draft]);
  const hasValues = profileHasValues(draft);

  // Overwrites the DOM `href` attribute with the real bookmarklet right
  // after every commit that could have just written React's sanitized stub
  // there -- the initial mount, AND every re-render triggered by an edited
  // field, since `bookmarklet` (and therefore the `href` prop) changes then
  // too and React's reconciliation would otherwise re-apply (and re-sanitize)
  // it. A `useLayoutEffect`, not `useEffect`, so this runs synchronously
  // after the DOM mutation and before the browser paints -- an ordinary
  // effect would let the sanitized stub be visible (and draggable) for one
  // frame first.
  useLayoutEffect(() => {
    bookmarkletLinkRef.current?.setAttribute("href", bookmarklet);
  }, [bookmarklet]);

  const setField = (key, value) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  // AC-K3.2/AC-K3.3: the keyboard-reachable equivalent of dragging the link
  // below to the bookmarks bar -- the SAME `javascript:` string, written to
  // the clipboard, plus a visible confirmation (a clipboard write itself is
  // invisible). Mirrors LiveFeedTab.js's per-card Auto Fill copy and
  // ChatPanel.js's message-copy fallback for browsers with no Clipboard API.
  const handleCopyBookmarklet = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(bookmarklet);
      } else {
        const ta = document.createElement("textarea");
        ta.value = bookmarklet;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      clearTimeout(copiedTimeoutRef.current);
      setCopied(true);
      copiedTimeoutRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be blocked (permissions, insecure context); the
      // drag route below still works, so there's nothing else to surface.
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/user-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: draft }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.error || `Request failed (${res.status})`);
      }
      if (typeof onSaved === "function") onSaved(payload.profile || {});
      onClose();
    } catch (err) {
      setError(err.message || "Failed to save your autofill profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title="Autofill profile"
      contentSx={{ display: "flex", flexDirection: "column", gap: 2, pt: 2 }}
      busy={saving}
      onSubmit={handleSave}
      submitLabel="Save"
    >
        <Typography variant="body2" color="text.secondary">
          These values are used by <strong>Auto Fill</strong> to populate application forms on a
          posting page. Drag the button below to your bookmarks bar once; then on any posting click
          a card&apos;s <strong>Auto Fill</strong> to open it and copy the same bookmarklet.
        </Typography>

        {error && <Alert severity="error" onClose={() => setError("")}>{error}</Alert>}

        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5 }}>
          {AUTOFILL_FIELDS.map((f) => (
            <TextField
              key={f.key}
              label={f.label}
              value={draft[f.key] || ""}
              onChange={(e) => setField(f.key, e.target.value)}
              size="small"
              fullWidth
            />
          ))}
        </Box>

        <Box
          sx={{
            mt: 0.5,
            p: 1.5,
            border: "1px dashed",
            borderColor: "divider",
            borderRadius: 1.5,
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            flexWrap: "wrap",
          }}
        >
          <Link
            ref={bookmarkletLinkRef}
            href={bookmarklet}
            underline="none"
            onClick={(e) => e.preventDefault()}
            sx={{
              px: 1.5,
              py: 0.75,
              borderRadius: 1,
              bgcolor: "primary.main",
              color: "primary.contrastText",
              fontWeight: 600,
              fontSize: "0.85rem",
              cursor: "grab",
              "&:hover": { bgcolor: "primary.dark" },
            }}
            draggable
          >
            Auto Fill ⤳
          </Link>
          {/* AC-K3.1: a bookmarklet fundamentally reaches the bookmarks bar
              by being dragged there or pasted into a new-bookmark dialog --
              there is no keyboard drag to build. This is the equivalent
              route: a real button that copies the SAME javascript: string. */}
          <Button
            variant="outlined"
            size="small"
            startIcon={<ContentCopyIcon fontSize="small" />}
            onClick={handleCopyBookmarklet}
            sx={{ textTransform: "none", ...TOUCH_TARGET_SX }}
          >
            {copied ? "Copied!" : "Copy bookmarklet"}
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ width: "100%" }}>
            {hasValues
              ? "Drag me to your bookmarks bar, or copy me and paste as the URL of a new bookmark."
              : "Add at least one field above to enable the bookmarklet."}
          </Typography>
        </Box>
    </FormDialog>
  );
}
