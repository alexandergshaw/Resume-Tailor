"use client";

import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useIsMobile } from "../../hooks/useResponsive";
import { api } from "../library/libraryApi";
import { runWithConcurrency } from "../../../lib/tailor/runWithConcurrency";
import { base64ToDocxBlob } from "../../../lib/document/docx.js";
import { RESUME_TEMPLATE_BASE64 } from "../../../lib/llm/engines/tailor-lite/resumeTemplateBase64.js";
import { loadDocx, documentLines, findPlaceholders } from "../../../lib/llm/engines/tailor-lite/docxModel.js";
import { normalizeName } from "../../../lib/llm/engines/tailor-lite/normalize.js";

// Same cap, same reasoning, as BulkActionsBar's own RESEARCH_CONCURRENCY /
// IMAGE_FETCH_CONCURRENCY: fan requests out a few at a time rather than
// firing the whole kept set at once.
const IMPORT_CONCURRENCY = 3;

// tailor-lite's content-library fragments fill short PHRASE slots inside
// composed sentence templates (see
// lib/llm/engines/tailor-lite/data/content_library.json) - there is no slot
// meant for "a whole accomplishment sentence" verbatim; the engine splices
// an entry's `text` verbatim into a fixed skeleton sentence at generation
// time (lib/llm/engines/tailor-lite/strategy.js's libraryMatch -> docxModel.js's
// fillDocx/replaceSpanInBlock - a raw string splice, no casing/grammar
// adjustment). A full sentence dropped into a mid-sentence slot reads as
// broken ("...delivering Cut settlement from three days to one across...").
// The live preview below (SLOT_OPTIONS / composeLine) exists specifically so
// that mismatch is visible before import, not after the bullet is on a
// resume. MEASURABLE_IMPACT is still a reasonable default landing slot -
// it's where real accomplishment material fits best among the options - but
// unlike before, it is now just a starting point: the preview shows exactly
// what it produces, and both the text and the slot are editable per
// fragment.
const DEFAULT_SLOT = "MEASURABLE_IMPACT";

// Snapshot of lib/llm/engines/tailor-lite/strategy.js's KEYWORD_JOIN dict
// keys. mapOne resolves a KEYWORD_JOIN name from posting keywords BEFORE it
// ever consults the content library (LIBRARY_MATCH is a later, separate
// step) - so a fragment saved under one of these names could never actually
// be selected by the deterministic engine, no matter what. Excluded from the
// slot choices offered below so this dialog can't hand out a dead-end
// option; keep this list in sync with strategy.js's KEYWORD_JOIN if that
// dict ever changes. Exported (not just module-local) so
// ImportToLibraryDialog.test.js's own drift canary can assert this list
// against strategy.js's REAL source rather than trusting a second,
// separately-typed copy of the same names.
export const KEYWORD_JOIN_NAMES = new Set([
  "JOB_RELEVANT_TECHNOLOGIES",
  "TECHNICAL_CAPABILITIES",
  "DELIVERY_PRACTICES",
  "DOMAIN_CAPABILITIES",
  "LEADERSHIP_CAPABILITIES",
  "JOB_RELEVANT_SOLUTIONS",
  "ROLE_RELEVANT_FOCUS",
]);

const EXPERIENCE_SECTION_HEADING = "Professional Experience";
const NEXT_SECTION_HEADING = "Projects";

// The distinct {{SLOT}} names that appear in the bundled template's job
// bullets (the "Professional Experience" section's accomplishment lines,
// never its "<Title> | <Employer> | <Dates>" header lines - identified by
// the " | " separator every header line has and no bullet line does), each
// paired with the actual skeleton line it was found in. First occurrence
// wins when a name repeats across bullets, matching how the real engine's
// LIBRARY_MATCH marks a name "used" after its first scanned occurrence.
function jobBulletSlotOptions(lines) {
  const startIdx = lines.findIndex((l) => l.trim() === EXPERIENCE_SECTION_HEADING);
  if (startIdx === -1) return [];
  let endIdx = lines.findIndex((l, i) => i > startIdx && l.trim() === NEXT_SECTION_HEADING);
  if (endIdx === -1) endIdx = lines.length;

  const options = [];
  const seen = new Set();
  for (const line of lines.slice(startIdx + 1, endIdx)) {
    if (line.includes(" | ")) continue; // a job/employer header line, not a bullet.
    for (const span of findPlaceholders(line)) {
      if (span.singleBrace) continue;
      const name = normalizeName(span.inner);
      if (KEYWORD_JOIN_NAMES.has(name) || seen.has(name)) continue;
      seen.add(name);
      options.push({ name, line });
    }
  }
  return options;
}

// Loads the REAL bundled résumé template and extracts its job-bullet
// skeleton lines - once per page load (module-scope cache), not once per
// dialog open. Reads the SAME RESUME_TEMPLATE_BASE64 constant
// defaultTemplate.js's own getDefaultTemplateBuffer decodes, but via
// base64ToDocxBlob + Blob.arrayBuffer() instead of Buffer.from: this code
// runs in the BROWSER (this is a "use client" dialog), and Buffer is a
// Node-only global this app's client bundle does not polyfill - the same
// Uint8Array-from-Blob shape BulkActionsBar.js's own client-side JSZip reads
// already use. This intentionally skips getDefaultTemplateBuffer's
// TEMPLATE_TEXT_PATCHES step (a summary-paragraph-only placeholder swap per
// that function's own comment - it never touches a job bullet, so omitting
// it cannot change what this reads).
let skeletonPromise = null;
function loadJobBulletSlotOptions() {
  if (!skeletonPromise) {
    skeletonPromise = (async () => {
      const blob = base64ToDocxBlob(RESUME_TEMPLATE_BASE64);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const doc = await loadDocx(bytes);
      return jobBulletSlotOptions(documentLines(doc));
    })();
  }
  return skeletonPromise;
}

// Substitutes `text` into every occurrence of `slotName` within `line`,
// right-to-left so earlier spans stay valid - the same span-based
// replacement docxModel.js's own fillDocx uses, just over plain text instead
// of docx XML runs. An empty (or all-whitespace) text mirrors fillDocx's own
// rule that an empty value leaves the {{placeholder}} visible rather than
// blanking it, so a not-yet-written fragment reads as "still a placeholder",
// not as a silently vanished word. Returns null when `slotName` does not
// actually occur in `line` (nothing to preview).
function composeLine(line, slotName, text) {
  if (!line) return null;
  const targets = findPlaceholders(line)
    .filter((span) => !span.singleBrace && normalizeName(span.inner) === slotName)
    .sort((a, b) => b.start - a.start);
  if (targets.length === 0) return null;
  if (!text || !text.trim()) return line;
  let out = line;
  for (const span of targets) out = out.slice(0, span.start) + text + out.slice(span.end);
  return out;
}

function fragKey(fragment, index) {
  return `${fragment.sourcePageId ?? "page"}::${index}`;
}

// A small, dependency-free 32-bit hash (FNV-1a) so re-importing the
// identical sentence twice produces the identical frag_id - the SECOND
// attempt then fails loudly with "already exists" (the content-library
// table has a per-user unique index on frag_id) instead of silently
// duplicating the same bullet under a fresh random id.
function hashText(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function slugify(value) {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "page";
}

// validateContentFragment (lib/llm/engines/tailor-lite/library/validate.js)
// requires frag_id to match /^[a-z0-9][a-z0-9_-]*$/i - the leading "exp-"
// guarantees that regardless of what sourcePageId looks like. Hashes the
// CURRENT text (which the user may have rewritten in the preview), not the
// original mined text, so an edited fragment gets its own id rather than
// colliding with (or masking a change to) the unedited one.
function fragIdFor(fragment, text) {
  return `exp-${slugify(fragment.sourcePageId)}-${hashText(text)}`;
}

// The review step this feature's own AC calls out as deliberate: unlike
// nearly every other action in this app, importing candidate resume
// material is NOT a single silent click, because the material goes out to
// employers under the user's name. The friction is kept to the minimum that
// still counts as a real review - every fragment starts checked, so the
// common case (keep everything) is still exactly one click after opening.
//
// `fragments` are candidates already mined by
// lib/experience/tailorSources.js's fragmentsFromPages (pure, and it alone
// owns the rule that a generated/research page is never a source) from
// whichever project pages the caller selected - this component never reads
// a page body itself.
export default function ImportToLibraryDialog({ open, onClose, fragments }) {
  const isMobile = useIsMobile();
  const list = Array.isArray(fragments) ? fragments : [];
  const entries = list.map((fragment, index) => ({ fragment, key: fragKey(fragment, index) }));

  const [selected, setSelected] = useState(() => new Set(entries.map((e) => e.key)));
  const [importing, setImporting] = useState(false);
  // null before the first run; afterwards { [key]: { status: "pending"|"running"|"ok"|"error", message? } },
  // one entry per fragment that run targeted - mirrors BulkActionsBar's own
  // `research` state shape, and for the same reason: a partial failure must
  // be reported per item, never collapsed into one bare "failed".
  const [results, setResults] = useState(null);
  // Per-fragment editable text + chosen slot, keyed the same way as
  // `selected` above. Seeded synchronously (DEFAULT_SLOT needs no async
  // data), so importing still works even if the live preview below never
  // finishes loading - the preview is a safeguard, not a dependency of the
  // import path itself.
  const [rowEdits, setRowEdits] = useState(() =>
    Object.fromEntries(entries.map((e) => [e.key, { text: e.fragment.text, slotName: DEFAULT_SLOT }])),
  );
  // { loading, options: [{ name, line }] } - the real job-bullet skeleton
  // lines, read once (module-scope cache) from the actual bundled template.
  const [skeleton, setSkeleton] = useState({ loading: true, options: [] });

  useEffect(() => {
    let cancelled = false;
    loadJobBulletSlotOptions().then((options) => {
      if (cancelled) return;
      setSkeleton({ loading: false, options });
      // DEFAULT_SLOT is a best-guess picked ahead of ever reading the real
      // template. On the rare chance it turns out not to actually be one of
      // the live options (a future template edit could remove it), correct
      // every row still sitting on that default to the first real option -
      // done ONCE here, not on every render, and never touches a row the
      // user has already deliberately changed away from the default.
      if (options.length > 0 && !options.some((o) => o.name === DEFAULT_SLOT)) {
        const fallback = options[0].name;
        setRowEdits((prev) => {
          const next = { ...prev };
          for (const key of Object.keys(next)) {
            if (next[key].slotName === DEFAULT_SLOT) next[key] = { ...next[key], slotName: fallback };
          }
          return next;
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggle(key) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function updateText(key, text) {
    setRowEdits((prev) => ({ ...prev, [key]: { ...prev[key], text } }));
  }

  function updateSlot(key, slotName) {
    setRowEdits((prev) => ({ ...prev, [key]: { ...prev[key], slotName } }));
  }

  const chosenEntries = entries.filter((e) => selected.has(e.key));

  async function handleImport() {
    if (importing || chosenEntries.length === 0) return;
    setImporting(true);
    setResults(Object.fromEntries(chosenEntries.map((e) => [e.key, { status: "pending" }])));

    await runWithConcurrency(chosenEntries, IMPORT_CONCURRENCY, async (entry) => {
      setResults((prev) => ({ ...prev, [entry.key]: { status: "running" } }));
      const edit = rowEdits[entry.key] || { text: entry.fragment.text, slotName: DEFAULT_SLOT };
      try {
        await api("/api/library/content-library", "POST", {
          frag_id: fragIdFor(entry.fragment, edit.text),
          slots: [edit.slotName || DEFAULT_SLOT],
          text: edit.text,
          tags: [],
          fabricated: false,
        });
        setResults((prev) => ({ ...prev, [entry.key]: { status: "ok" } }));
      } catch (err) {
        setResults((prev) => ({
          ...prev,
          [entry.key]: { status: "error", message: err?.message || "Import failed." },
        }));
      }
    });

    setImporting(false);
  }

  function summaryText() {
    if (!results) return null;
    const values = Object.values(results);
    if (importing) {
      const done = values.filter((r) => r.status === "ok" || r.status === "error").length;
      return `Importing… ${done} of ${values.length} done.`;
    }
    const okCount = values.filter((r) => r.status === "ok").length;
    const failed = values.filter((r) => r.status === "error");
    if (failed.length === 0) {
      return `Added ${okCount} to your library.`;
    }
    return `Added ${okCount}, ${failed.length} failed: ${failed[0].message || "Import failed."}`;
  }

  const summary = summaryText();

  function handleClose() {
    if (importing) return; // matches FormDialog's own busy gate elsewhere in this tab.
    setResults(null);
    onClose();
  }

  return (
    <Dialog open={!!open} onClose={handleClose} maxWidth="md" fullWidth fullScreen={isMobile}>
      <DialogTitle>Add to library</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Candidate accomplishment lines found in the selected project page(s). Everything is kept by default -
          uncheck anything you would not want on a resume. The preview under each line shows exactly how the
          tailoring engine will splice it into a resume sentence for the slot chosen - edit the text or the slot
          until it reads cleanly, then add the rest to your tailoring library.
        </Typography>

        {entries.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No accomplishment lines were found in the selected pages.
          </Typography>
        ) : (
          <Stack spacing={1.5} sx={{ maxHeight: 420, overflow: "auto", pr: 1 }}>
            {entries.map((entry) => {
              const result = results?.[entry.key];
              const edit = rowEdits[entry.key] || { text: entry.fragment.text, slotName: DEFAULT_SLOT };
              const option = skeleton.options.find((o) => o.name === edit.slotName);
              const composed = option ? composeLine(option.line, edit.slotName, edit.text) : null;
              return (
                <Stack
                  key={entry.key}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: "flex-start", pb: 1.5, borderBottom: "1px solid var(--border)" }}
                >
                  <Checkbox
                    size="small"
                    checked={selected.has(entry.key)}
                    onChange={() => toggle(entry.key)}
                    disabled={importing}
                    sx={{ p: 0.5, mt: 0.25 }}
                  />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <TextField
                      fullWidth
                      multiline
                      size="small"
                      value={edit.text}
                      onChange={(e) => updateText(entry.key, e.target.value)}
                      disabled={importing}
                      slotProps={{ htmlInput: { "aria-label": "Fragment text" } }}
                      sx={{ mb: 0.75 }}
                    />
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.5 }}>
                      <Typography variant="caption" color="text.secondary">
                        Slot:
                      </Typography>
                      <Select
                        native
                        size="small"
                        variant="outlined"
                        value={edit.slotName}
                        onChange={(e) => updateSlot(entry.key, e.target.value)}
                        disabled={importing || skeleton.options.length === 0}
                        inputProps={{ "aria-label": "Slot" }}
                        sx={{ fontSize: 13, minWidth: 200 }}
                      >
                        {skeleton.options.length > 0 ? (
                          skeleton.options.map((o) => (
                            <option key={o.name} value={o.name}>
                              {o.name}
                            </option>
                          ))
                        ) : (
                          <option value={edit.slotName}>{edit.slotName}</option>
                        )}
                      </Select>
                    </Stack>
                    <Typography variant="caption" sx={{ display: "block", fontStyle: "italic", color: "var(--text-secondary)" }}>
                      {skeleton.loading
                        ? "Loading preview…"
                        : composed
                          ? `Preview: "${composed}"`
                          : "No live preview available for this slot."}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      from {entry.fragment.sourceTitle || "an untitled page"}
                      {result?.status === "error" ? ` — ${result.message}` : ""}
                      {result?.status === "ok" ? " — added" : ""}
                    </Typography>
                  </Box>
                </Stack>
              );
            })}
          </Stack>
        )}

        {summary ? (
          <Typography role="status" aria-live="polite" variant="body2" sx={{ mt: 2 }}>
            {summary}
          </Typography>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={importing} sx={{ textTransform: "none" }}>
          {results && !importing ? "Done" : "Cancel"}
        </Button>
        {entries.length > 0 ? (
          <Button
            variant="contained"
            disableElevation
            onClick={handleImport}
            disabled={importing || chosenEntries.length === 0}
            sx={{ textTransform: "none", borderRadius: 1.5 }}
          >
            {importing ? "Adding…" : `Add ${chosenEntries.length} to library`}
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
}
