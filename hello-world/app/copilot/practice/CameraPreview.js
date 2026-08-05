"use client";

import { useEffect, useRef } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

// Self-view for practice mode. Purely presentational: it renders whatever
// MediaStream the session handed it and never calls getUserMedia or touches
// the session itself.
export default function CameraPreview({ stream, hasVideo, cameraOff }) {
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

  const panelSx = {
    flex: 1,
    minWidth: 0,
    minHeight: 340,
    maxHeight: "62vh",
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
