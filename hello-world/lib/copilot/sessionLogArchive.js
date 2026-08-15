// AC-Q5 — the delivery half of "download a log of this session": one button,
// one file, containing BOTH the readable Markdown record and the raw JSON
// diagnostic log. The user explicitly asked not to be made to choose between
// them at download time (see sessionLogArchive.test.js's own header
// comment), so this module never offers two separate downloads — it zips
// exactly the two renderers sessionLog.js already produces, and restates
// none of their logic.

import JSZip from "jszip";
import { renderSessionLogMarkdown, renderSessionLogJson, sessionLogFileBase } from "./sessionLog.js";

// AC-Q5.1/D9 — the two entries this archive ever contains, keyed by
// filename. Reuses sessionLogFileBase for the shared name stem so the
// Markdown entry and the JSON entry of the SAME session never collide with
// each other or with a different session's archive. sessionLogFileBase,
// renderSessionLogMarkdown and renderSessionLogJson are all already
// null-safe (see sessionLog.js), so this function inherits that without any
// extra guarding here.
//
// D9: `opts` is forwarded to renderSessionLogMarkdown UNCHANGED — in
// particular `opts.speakerSnapshot`, which is what lets it resolve an
// in-person turn's `speakerTag` to "You"/"Them" instead of falling back to
// the numbered "Speaker N" form (lib/copilot/speakerIdentity.js's own
// fallback) it uses with no snapshot at all. Every real caller in this
// codebase (useSessionLogRecorder.js's downloadLog) now passes it; this
// module never records the snapshot itself, and never needs to.
export function sessionLogArchiveEntries(snapshot, opts) {
  const base = sessionLogFileBase(snapshot);
  return {
    [`${base}.md`]: renderSessionLogMarkdown(snapshot, opts),
    [`${base}.json`]: renderSessionLogJson(snapshot),
  };
}

// AC-Q5.2 — the zip itself. `type: "arraybuffer"` rather than `"blob"`:
// JSZip's `"blob"` output requires a global `Blob` constructor, which the
// vitest node environment this test file runs in does not provide — that
// would throw before JSZip.loadAsync ever got a chance to read anything
// back. An ArrayBuffer is valid input to JSZip.loadAsync in BOTH the node
// test and a browser, and downloadSessionLogArchive below wraps it in a
// Blob itself right before handing it to URL.createObjectURL — so one
// output type here serves both callers.
export async function buildSessionLogArchive(snapshot, opts) {
  const zip = new JSZip();
  const entries = sessionLogArchiveEntries(snapshot, opts);
  for (const [name, content] of Object.entries(entries)) {
    zip.file(name, content);
  }
  return zip.generateAsync({ type: "arraybuffer" });
}

// AC-Q5.3 — named after the session the same way each entry inside it is, so
// re-downloading the same session's archive always produces the same
// filename and never collides with a different session's.
export function sessionLogArchiveName(snapshot) {
  return `${sessionLogFileBase(snapshot)}.zip`;
}

// Download trigger — not covered by sessionLogArchive.test.js since it needs
// a DOM. Same idiom as app/components/AutoApplyQueueTab.js's downloadText:
// an object URL on a temporary <a download>, appended, clicked, removed, and
// the URL revoked in a `finally` so a click failure never leaks it. Guarded
// on `typeof document` so importing this module from the node test never
// touches the DOM.
export async function downloadSessionLogArchive(snapshot, opts) {
  if (typeof document === "undefined") return;
  const buffer = await buildSessionLogArchive(snapshot, opts);
  const blob = new Blob([buffer], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = sessionLogArchiveName(snapshot);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(url);
  }
}
