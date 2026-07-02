// Edit-session mining — the deterministic engine's richest learning signal.
// When the user hand-edits a generated document, the lines they ADDED are
// content the engine failed to produce: vocabulary the library doesn't know,
// or phrasing it couldn't assemble. This module extracts that added text so
// the caller can run it through the buzzword scrape and offer the results via
// the usual permission dialog. Pure functions, no I/O.

function normalizeLine(line) {
  return String(line || "")
    .replace(/^[\s•\-*–—>]+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const MIN_LINE_CHARS = 4;

// Lines present in `afterLines` but not in `beforeLines` (normalized exact
// match), joined as one text block for keyword scanning. A modified line counts
// as added — its old vocabulary is already in the library and gets filtered by
// the scrape's diff, so only genuinely new terms surface.
export function addedEditText(beforeLines, afterLines) {
  const before = new Set((beforeLines || []).map(normalizeLine).filter(Boolean));
  const added = [];
  for (const line of afterLines || []) {
    const norm = normalizeLine(line);
    if (norm.length < MIN_LINE_CHARS) continue;
    if (before.has(norm)) continue;
    added.push(String(line).trim());
  }
  return added.join("\n");
}

// A short stable fingerprint of the added text, used to dedupe prompts — the
// user should be asked once per distinct edit, not on every dialog close.
export function editFingerprint(addedText) {
  const s = String(addedText || "");
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return `${s.length}:${h}`;
}
