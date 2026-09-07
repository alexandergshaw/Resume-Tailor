"use client";

import Button from "@mui/material/Button";
import DownloadIcon from "@mui/icons-material/Download";
import { activityLogSnapshot } from "@/lib/activityLog/appActivityLog.js";
import { renderActivityLog, activityLogFileName } from "@/lib/activityLog/activityLogDocument.js";
import { triggerBlobDownload } from "@/lib/document/download.js";

// The session-wide activity log's download control, rendered under Settings >
// Admin tools.
//
// ONE CLICK, ONE FILE. No format menu, no destination picker, no "are you
// sure": nothing is destroyed and there is exactly one thing this can produce,
// so the repo's minimize-clicks rule is satisfied structurally rather than
// excepted. The same shape StatusBar.js's duplicate-check log button already
// has, and for the same stated reason.
//
// ALWAYS ENABLED, which is the one deliberate difference from that button.
// StatusBar hides its control until something has been recorded, because an
// empty duplicate-check log has nothing to say. An empty APP-WIDE log does: it
// says when recording started and that nothing has happened since, which is
// precisely the answer someone is after when they go looking for it. A control
// that is missing at the moment a user reaches for it is the worse failure.
//
// It holds no state and subscribes to nothing: the snapshot is taken inside the
// click, so the file always describes the session as of the moment it was
// asked for, and this component never re-renders as events accumulate.
export default function ActivityLogButton() {
  function downloadActivityLog() {
    try {
      const snapshot = activityLogSnapshot();
      triggerBlobDownload(
        new Blob([renderActivityLog(snapshot)], { type: "text/markdown" }),
        activityLogFileName(snapshot),
      );
    } catch {
      // A browser that refuses the object-URL-on-an-anchor idiom (or a test
      // environment with no download shelf) must not take the settings menu
      // down with it. There is nothing useful to say here that the console
      // wrapper has not already recorded.
    }
  }

  return (
    <Button
      onClick={downloadActivityLog}
      startIcon={<DownloadIcon fontSize="small" />}
      variant="outlined"
      size="small"
      fullWidth
      sx={{ justifyContent: "flex-start", textTransform: "none" }}
    >
      Download activity log
    </Button>
  );
}
