"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { captureCameraFrame, readCameraFrame } from "@/lib/copilot/cameraQuestion";
import { normalizeManualQuestion, MAX_MANUAL_QUESTION_CHARS } from "@/lib/copilot/manualQuestion";
import { TOUCH_TARGET_SX } from "@/app/theme/mobileSx";

export default function CameraQuestionSource({ contextKey, disabled, ...props }) {
  const [identity, setIdentity] = useState({ contextKey, disabled, generation: 0 });
  if (identity.contextKey !== contextKey || identity.disabled !== disabled) {
    setIdentity({ contextKey, disabled, generation: identity.generation + 1 });
  }
  // Remount only the camera session, never the sibling typed-question form.
  // The old session's layout cleanup fences promises before new UI commits.
  return <CameraSession key={identity.generation} disabled={disabled} {...props} />;
}

function CameraSession({ onSubmit, disabled, buttonLabel = "Add", confirmLabel = "Added to the feed" }) {
  const trigger = useRef(null), video = useRef(null), stream = useRef(null);
  const generation = useRef(0), controller = useRef(null), pending = useRef(false);
  const [open, setOpen] = useState(false), [ready, setReady] = useState(false);
  const [reading, setReading] = useState(false), [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const release = useCallback(() => {
    generation.current += 1; pending.current = false;
    controller.current?.abort(); controller.current = null;
    const owned = stream.current; stream.current = null;
    owned?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    if (video.current) video.current.srcObject = null;
  }, []);
  useLayoutEffect(() => release, [release]);
  function close() {
    release(); setOpen(false); setReady(false); setReading(false); setText(""); setStatus("");
    trigger.current?.focus();
  }
  async function start() {
    release(); const token = generation.current;
    setOpen(true); setReady(false); setReading(false); setText(""); setStatus("Requesting camera permission…");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera is unavailable in this browser. Type the question instead.");
      const acquired = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      if (token !== generation.current) { acquired.getTracks().forEach((track) => track.stop()); return; }
      stream.current = acquired;
      acquired.getTracks().forEach((track) => { track.onended = () => { release(); setReady(false); setReading(false); setStatus("Camera stopped. Start camera to retry."); }; });
      if (video.current) video.current.srcObject = acquired;
      setReady(true); setStatus("Camera on. Point it at one written question, then capture.");
    } catch (err) {
      if (token !== generation.current) return;
      setReady(false); setStatus(err?.name === "NotAllowedError" ? "Camera permission denied. Allow camera access and retry, or type the question." : "Camera unavailable. Check the device and retry, or type the question.");
    }
  }
  async function capture() {
    if (pending.current || !ready || disabled) return;
    pending.current = true; const token = generation.current;
    controller.current = new AbortController(); setReading(true); setStatus("Reading one frame…");
    try {
      const frame = await captureCameraFrame(video.current);
      if (token !== generation.current) return;
      const result = await readCameraFrame(frame, controller.current.signal);
      if (token !== generation.current) return;
      setText(result); setStatus("Review and edit the text, then explicitly add the question.");
    } catch (err) {
      if (token === generation.current) setStatus(err.message || "Could not read the question. Retry or type it instead.");
    } finally { if (token === generation.current) { pending.current = false; setReading(false); } }
  }
  const normalizedLength = text.replace(/\s+/g, " ").trim().length;
  const { ok, question } = normalizeManualQuestion(text);
  function add(event) {
    event.preventDefault();
    if (disabled || reading || !ok || normalizedLength > MAX_MANUAL_QUESTION_CHARS) return;
    if (onSubmit(question) === true) { setText(""); setStatus(`Camera question ${confirmLabel}: "${question}"`); }
    else setStatus("Question was not added. Your text is retained; retry when the session is ready.");
  }
  return <Box sx={{ mt: 1 }}>
    <Typography variant="caption" component="p">Optional camera source: one captured frame is sent to this server for OCR. Language data may be downloaded by the server. Review before Add; your selected answer engine processes added text.</Typography>
    <Button ref={trigger} onClick={start} disabled={disabled || reading} sx={TOUCH_TARGET_SX}>Start camera for question</Button>
    {open && <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1 }}>
      <video ref={video} autoPlay muted playsInline aria-label="Question camera viewfinder" style={{ width: "100%", maxHeight: 260, objectFit: "contain" }} />
      <Button onClick={capture} disabled={!ready || reading || disabled} sx={TOUCH_TARGET_SX}>{reading ? "Reading…" : "Capture question"}</Button>
      <Button onClick={close} sx={TOUCH_TARGET_SX}>Close question camera</Button>
      <Box component="form" onSubmit={add}>
        <TextField fullWidth multiline label="Review camera question" value={text} onChange={(e) => setText(e.target.value)} disabled={reading || disabled} helperText={`${normalizedLength}/${MAX_MANUAL_QUESTION_CHARS} characters. Shorten longer text before adding.`} />
        <Button type="submit" disabled={disabled || reading || !ok || normalizedLength > MAX_MANUAL_QUESTION_CHARS} sx={TOUCH_TARGET_SX}>{buttonLabel} camera question</Button>
      </Box>
    </Box>}
    <Typography role="status" aria-live="polite" variant="body2">{status}</Typography>
  </Box>;
}
