"use client";

import { useEffect, useState } from "react";
import { downloadMinimalistDocx } from "../../lib/document/docx";

// Generic controller for the "Materials" profile lists (references, education,
// employment). Each list is an array of `{ id, ...fields }` rows that the user
// can add/edit/remove, copy (per-row or all-at-once), and export to docx. Rows
// are hydrated from and persisted to localStorage. Per-section differences
// (field shapes, formatter, row cap, storage key, export title) come in via a
// config object — see lib/materials/profileEntries.js.

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Split a formatted block into the {primaryLine, secondaryLine, details} shape
// the minimalist-docx builder expects.
function toDocEntry(text) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  const [primaryLine, secondaryLine, ...details] = lines;
  return { primaryLine, secondaryLine: secondaryLine || "", details };
}

export function useProfileEntries({
  idPrefix,
  blank,
  formatBlock,
  sanitize,
  storageKey,
  max = Infinity,
  docTitle,
  docFileName,
}) {
  const [entries, setEntries] = useState([]);
  const [open, setOpen] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [allCopied, setAllCopied] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  // Hydrate once on mount, then persist on every change.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // One-time hydration from localStorage. Done in an effect (not lazy
        // initial state) to stay SSR-safe and avoid a hydration mismatch.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setEntries(parsed.filter((r) => r && typeof r === "object").map(sanitize));
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(entries));
    } catch {}
  }, [entries, storageKey]);

  function add() {
    if (entries.length >= max) return;
    setEntries((prev) => [...prev, { id: makeId(idPrefix), ...blank() }]);
    setOpen(true);
  }

  function update(id, field, value) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, [field]: value } : e)));
  }

  function remove(id) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  async function copyBlock(entry) {
    const text = formatBlock(entry);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(entry.id);
      setTimeout(() => {
        setCopiedId((current) => (current === entry.id ? null : current));
      }, 1500);
    } catch {}
  }

  function formatAll() {
    return entries
      .map((entry) => formatBlock(entry))
      .filter(Boolean)
      .join("\n\n");
  }

  async function copyAll() {
    const text = formatAll();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setAllCopied(true);
      setTimeout(() => setAllCopied(false), 1500);
    } catch {}
  }

  function buildDocEntries() {
    return entries.map((entry) => toDocEntry(formatBlock(entry))).filter(Boolean);
  }

  async function downloadDocx() {
    setDownloadError("");
    const err = await downloadMinimalistDocx({
      title: docTitle,
      fileName: docFileName,
      entries: buildDocEntries(),
    });
    if (err) {
      console.warn(`[${idPrefix} export] failed:`, err);
      setDownloadError(err);
    }
  }

  return {
    entries,
    setEntries,
    open,
    setOpen,
    copiedId,
    allCopied,
    downloadError,
    add,
    update,
    remove,
    formatBlock,
    copyBlock,
    formatAll,
    copyAll,
    buildDocEntries,
    downloadDocx,
  };
}
