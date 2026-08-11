// Pure state-shape helpers for the multi-posting Job Description tab. Every
// function here is a plain data transform -- no React, no network, no
// storage I/O -- so the queue's rules (what counts as submittable, what a
// retry re-runs, what a reload restores) can be pinned by fast node tests
// and reused unchanged by both app/hooks/useManualPostings.js and
// app/components/JobDescriptionTab.js.
//
// Statuses: "idle" (never run) | "pending" (queued) | "processing" (in
// flight) | "done" | "error".

// A fresh, never-run posting box. `text` defaults to "" so a newly-added box
// needs no argument.
export function createEntry(id, text = "") {
  return {
    id,
    text,
    status: "idle",
    error: "",
    warning: "",
    jobId: null,
    jobTitle: "",
    company: "",
  };
}

// Append one fresh empty posting (AC-1). Does not mutate `entries`.
export function addEntry(entries, id) {
  return [...entries, createEntry(id)];
}

// Remove one posting -- except the tab is never allowed to go empty, so a
// request to remove the last remaining posting is a no-op (AC-1).
export function removeEntry(entries, id) {
  if (entries.length <= 1) return entries;
  return entries.filter((e) => e.id !== id);
}

// Replace a posting's text. Also resets it to a fresh idle entry: editing
// the text after a run invalidates whatever that run produced, so a stale
// Failed/Ready badge (and the job id, error, warning it describes) must not
// outlive the text that earned it.
export function setEntryText(entries, id, text) {
  return entries.map((e) => (e.id === id ? createEntry(id, text) : e));
}

// Shallow-merge a patch into the one matching entry. Used by the hook to
// record status/result transitions without touching any other entry.
export function patchEntry(entries, id, patch) {
  return entries.map((e) => (e.id === id ? { ...e, ...patch } : e));
}

// Postings with real (non-whitespace-only) text -- the set a Generate click
// actually submits (AC-2, AC-6).
export function submittableEntries(entries) {
  return entries.filter((e) => e.text.trim() !== "");
}

// Postings whose last run failed -- what "Retry failed" re-runs (AC-5).
export function failedEntries(entries) {
  return entries.filter((e) => e.status === "error");
}

// Move the listed postings into the queue for a run: pending status, any
// previous error/warning/job id cleared (a retry must not resurrect the
// failed run's tracked job), but the text and every other field preserved
// verbatim. Entries not listed are untouched -- a retry must never reset a
// posting that already succeeded.
export function markQueued(entries, ids) {
  const targets = new Set(ids);
  return entries.map((e) =>
    targets.has(e.id) ? { ...e, status: "pending", error: "", warning: "", jobId: null } : e,
  );
}

// Per-status counts, for progress summaries and tests.
export function queueSummary(entries) {
  const summary = { idle: 0, pending: 0, processing: 0, done: 0, error: 0 };
  for (const e of entries) {
    if (Object.prototype.hasOwnProperty.call(summary, e.status)) summary[e.status] += 1;
  }
  return summary;
}

// Reconstruct the saved posting texts on reload (AC-8). `rawList` is the
// JSON string saved under the new "jobPostings" key; `legacyText` is the
// plain string saved under the old single-textarea "jobPosting" key. The
// new list wins whenever it exists at all (even an explicitly emptied one),
// so clearing every box and reloading must not resurrect text the user has
// already moved past. Always returns at least one (possibly empty) string,
// since the queue itself is never allowed to be empty.
export function restorePostingTexts(rawList, legacyText) {
  if (rawList != null) {
    try {
      const parsed = JSON.parse(rawList);
      if (Array.isArray(parsed)) {
        const strings = parsed.filter((v) => typeof v === "string");
        return strings.length > 0 ? strings : [""];
      }
    } catch {
      // Not valid JSON -- fall through to the legacy value below.
    }
  }
  if (typeof legacyText === "string" && legacyText.trim()) return [legacyText];
  return [""];
}

// What gets written back to localStorage: the text only, never a run's
// status, error, warning, or tracked job id (AC-8).
export function serializeEntries(entries) {
  return JSON.stringify(entries.map((e) => e.text));
}

// A posting box's accessible label, counting from one (AC-10).
export function postingLabel(index) {
  return `Job posting ${index + 1}`;
}

// The single chat-pin object for "Ask AI" (AC-7). The chat panel holds one
// `chatPinnedContext`, so several postings are folded into one block rather
// than pinned separately. With exactly one non-blank posting, the label and
// body are byte-identical to what the single-textarea version pinned.
export function buildPostingsPin(entries) {
  const submittable = submittableEntries(entries);
  if (submittable.length === 0) return null;
  if (submittable.length === 1) {
    return {
      label: "Pasted Job Description",
      content: `Pasted Job Description:\n${submittable[0].text}`,
    };
  }
  return {
    label: `Pasted Job Descriptions (${submittable.length})`,
    content: submittable
      .map((e, i) => `Pasted Job Description ${i + 1}:\n${e.text}`)
      .join("\n\n"),
  };
}
