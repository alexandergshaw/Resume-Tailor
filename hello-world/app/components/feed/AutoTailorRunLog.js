"use client";

import { useCallback, useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import DownloadIcon from "@mui/icons-material/Download";
import { describeRunReason, renderRunLogMarkdown, runLogFileName } from "@/lib/feed/autoTailorRunLog";
import { triggerBlobDownload } from "@/lib/document/download";

// N60 S7 (AC-R5): the auto-tailor cron runs with no user present, so its
// per-run outcome (AC-R4) is only ever seen here -- fetched back from the
// user's own persisted rows and rendered with a legible reason, never a raw
// enum. Mounted TWICE (plan §3.5, one component, one `mode` prop): `mode=
// "full"` in the Automation view (FeedAutomationPanel.js) and `mode=
// "compact"` atop the Queue view (AutoApplyQueueTab.js) -- the queue is where
// a user asks "why is this empty?", which is exactly what AC-R4's reason
// answers.
//
// The download control uses the repo's one shared "save this Blob to disk"
// helper (lib/document/download.js#triggerBlobDownload), not a private copy.
export default function AutoTailorRunLog({ mode = "full" }) {
  const [state, setState] = useState({ status: "loading", runs: [] });

  useEffect(() => {
    let live = true;
    fetch("/api/auto-apply-queue/runs", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (live) setState({ status: "ready", runs: Array.isArray(data.runs) ? data.runs : [] });
      })
      .catch(() => {
        // A fetch failure renders as "nothing yet", the same benign state as
        // an empty history -- never a crash or a blank panel (AC-R5).
        if (live) setState({ status: "error", runs: [] });
      });
    return () => {
      live = false;
    };
  }, []);

  const handleDownload = useCallback(() => {
    const markdown = renderRunLogMarkdown(state.runs);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    triggerBlobDownload(blob, runLogFileName());
  }, [state.runs]);

  const compact = mode === "compact";
  const runs = compact ? state.runs.slice(0, 3) : state.runs;

  return (
    <Box sx={{ mb: compact ? 1.5 : 0 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.5, gap: 1 }}>
        <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 0.6 }}>
          {compact ? "Recent automation runs" : "Automation run log"}
        </Typography>
        <Button
          size="small"
          variant="text"
          aria-label="Download automation run log"
          startIcon={<DownloadIcon fontSize="small" />}
          onClick={handleDownload}
          sx={{ textTransform: "none", fontSize: "0.72rem" }}
        >
          Download log
        </Button>
      </Box>
      <RunLogBody status={state.status} runs={runs} compact={compact} />
    </Box>
  );
}

function RunLogBody({ status, runs, compact }) {
  if (status === "loading") {
    return (
      <Typography sx={{ color: "text.secondary", fontSize: "0.8rem" }}>
        Loading automation runs…
      </Typography>
    );
  }
  if (status === "error") {
    return (
      <Typography sx={{ color: "text.secondary", fontSize: "0.8rem" }}>
        We could not load the automation run log right now.
      </Typography>
    );
  }
  if (runs.length === 0) {
    return (
      <Typography sx={{ color: "text.secondary", fontSize: "0.8rem" }}>
        No automation runs yet. Once a saved search has auto-tailor enabled, its runs will appear here.
      </Typography>
    );
  }
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
      {runs.map((row) => (
        <RunRow key={row.id} row={row} compact={compact} />
      ))}
    </Box>
  );
}

function RunRow({ row, compact }) {
  const payload = row?.payload || {};
  const when = row?.ran_at ? new Date(row.ran_at).toLocaleString() : "Unknown time";
  const outcome =
    payload.tailored > 0
      ? `${payload.tailored} tailored and queued`
      : describeRunReason(payload.zeroReason);
  const emailNote = !compact && payload.emailed === 0 && payload.emailZeroReason
    ? describeRunReason(payload.emailZeroReason)
    : null;
  return (
    <Box sx={{ fontSize: "0.78rem", color: "text.secondary" }}>
      <Box component="span" sx={{ color: "text.primary", fontWeight: 600 }}>
        {when}
      </Box>
      {" — "}
      {outcome}
      {emailNote && <Box sx={{ fontSize: "0.74rem" }}>{emailNote}</Box>}
    </Box>
  );
}
