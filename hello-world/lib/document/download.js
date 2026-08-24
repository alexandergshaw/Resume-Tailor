// Trigger a browser download for a Blob under a given file name.
//
// Split out of docx.js: a 600-line DOCX parser is a strange home for a
// ten-line DOM helper, and most of the modules that import it - a PowerPoint
// deck export, the experience attachment panel, the communications dialog -
// have nothing to do with DOCX at all. It is just the
// object-URL-on-a-temporary-anchor idiom that any "save this Blob to disk"
// path needs. docx.js re-exports it (same function object, not a wrapper) so
// its existing importers see no change.
//
// Same idiom as lib/copilot/sessionLogArchive.js's downloadSessionLogArchive
// and app/components/AutoApplyQueueTab.js's downloadText: the object URL is
// released, and the temporary anchor removed, in a `finally` so a click that
// throws can never leak either one. An object URL keeps its whole Blob alive
// for as long as the mapping exists, which in a single-page app that never
// unloads is the rest of the tab's life.
export function triggerBlobDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    URL.revokeObjectURL(url);
  }
}
