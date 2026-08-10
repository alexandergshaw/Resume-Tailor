"use client";

import { useEffect, useRef } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

// Self-view for practice mode. Purely presentational: it renders whatever
// MediaStream the session handed it and never calls getUserMedia or touches
// the session itself.
//
// `compact` (defect 2/3): PracticeClient mounts exactly one instance of this
// component per breakpoint bucket — a `compact` one above QuestionCard below
// `md`, the regular one in the camera/transcript row at `md`+ — never both
// at once, so a MediaStream is never fed to two <video> elements. `compact`
// only changes sizing (a smaller, capped aspect box so the self-view can't
// itself push QuestionCard off screen); everything else about the panel is
// identical.
export default function CameraPreview({ stream, hasVideo, cameraOff, compact = false }) {
  const videoRef = useRef(null);
  const showVideo = Boolean(hasVideo) && !cameraOff;

  // srcObject must be assigned imperatively (there is no `src` attribute for
  // a MediaStream) and cleared whenever the stream changes or this component
  // unmounts — an uncleared reference keeps the old stream's tracks "in use"
  // from the browser's point of view.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return undefined;
    el.srcObject = showVideo && stream ? stream : null;
    return () => {
      el.srcObject = null;
    };
  }, [stream, showVideo]);

  // Defect 3: `minHeight: 340` and `maxHeight: "62vh"` used to contradict
  // each other below ~548px viewport height (CSS applies min-height last,
  // so it silently won the fight, eating the whole screen on a short
  // phone/landscape viewport). An aspect box replaces the fixed min-height
  // below `md`: a defined `aspectRatio` gives the panel — and therefore the
  // video's `height: 100%` below, so `objectFit: "cover"` actually engages
  // — a definite height derived from its (definite) width, instead of
  // falling back to the video's intrinsic size the way an auto-height,
  // display:block parent did. `maxHeight` still caps it so it can't grow
  // past the visible viewport. `compact` (defect 2) uses a shorter cap so
  // the self-view above QuestionCard can't itself push the question off
  // screen; `display: "flex"` centers the no-video text below exactly like
  // the no-video branch already did, and now applies to the video branch's
  // sizing too.
  const panelSx = {
    flex: 1,
    minWidth: 0,
    minHeight: compact ? 0 : { xs: 0, md: 340 },
    aspectRatio: compact ? "3 / 4" : { xs: "3 / 4", md: "auto" },
    maxHeight: compact ? "26vh" : { xs: "45vh", md: "62vh" },
    display: "flex",
    borderRadius: 2,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    boxShadow: "var(--shadow-soft)",
    overflow: "hidden",
  };

  if (!showVideo) {
    // hasVideo takes precedence over cameraOff: a session that never got a
    // video track must always read "No camera — audio only", even if the
    // (inert) Camera switch happens to be in the "off" position.
    return (
      <Box sx={{ ...panelSx, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Typography sx={{ color: "var(--text-muted)" }}>
          {hasVideo ? "Camera off" : "No camera — audio only"}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={panelSx}>
      {/* Mirrored so the self-view matches how you see yourself in a mirror,
          not how the camera literally sees you. Muted is required — an
          unmuted self-view would feed your own voice back into the mic. */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: "scaleX(-1)",
        }}
      />
    </Box>
  );
}
