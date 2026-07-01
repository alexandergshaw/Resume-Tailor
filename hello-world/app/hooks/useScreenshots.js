"use client";

import { useEffect, useRef, useState } from "react";
import { readEngine } from "../settings/engine";

// Screenshots → tailored-job pipeline for the "Screenshots" manual-applying tab.
// Users drop posting screenshots; each is compressed, sent to
// /api/posting-from-image to recover the live posting URL + text, then tailored
// into a tracked job. Processing auto-runs whenever new pending items appear.
//
// Depends on a few pieces of the parent page: the uploaded resume, the tailoring
// map + preview helpers (to open a finished result), and the tracked-job/tailor
// pipeline (setTrackedJobs, handleTailorJob, updateTailoringJob).
export function useScreenshots({
  resumeFile,
  tailoringMap,
  openResumePreview,
  previewScopeAvailable,
  setTrackedJobs,
  handleTailorJob,
  updateTailoringJob,
}) {
  const [items, setItems] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const busyRef = useRef(false);

  function updateItem(id, patch) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  function addFiles(files) {
    const imgs = (files || []).filter((f) => f && /^image\/(png|jpe?g|webp)$/i.test(f.type || ""));
    if (imgs.length === 0) {
      setError("Only PNG, JPG, or WebP screenshots are supported.");
      return;
    }
    setError("");
    const added = imgs.map((file, i) => ({
      id: `shot-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
      name: file.name,
      file,
      previewUrl: typeof URL !== "undefined" ? URL.createObjectURL(file) : "",
      status: "pending",
      statusLabel: "",
      jobTitle: "",
      company: "",
      url: "",
      error: "",
      jobId: null,
    }));
    setItems((prev) => [...prev, ...added]);
  }

  function removeItem(id) {
    setItems((prev) => {
      const target = prev.find((it) => it.id === id);
      if (target?.previewUrl) {
        try { URL.revokeObjectURL(target.previewUrl); } catch { /* ignore */ }
      }
      return prev.filter((it) => it.id !== id);
    });
  }

  function clear() {
    setItems((prev) => {
      for (const it of prev) {
        if (it.previewUrl) {
          try { URL.revokeObjectURL(it.previewUrl); } catch { /* ignore */ }
        }
      }
      return [];
    });
    setError("");
  }

  function previewItem(item) {
    if (!item?.jobId) return;
    const t = tailoringMap[item.jobId] || {};
    openResumePreview(
      {
        id: item.jobId,
        title: item.jobTitle || t.generatedJobTitle || "",
        company: item.company || "",
        description: t.jobDescription || "",
      },
      { tab: previewScopeAvailable(t, "cover") ? "cover" : "resume" },
    );
  }

  // Downscale + re-encode a screenshot before upload so the request stays well
  // under the serverless body limit (~4.5MB) and OCR/vision run faster. Falls
  // back to the original file if the browser can't process it.
  async function compressScreenshot(file, maxDim = 1600, quality = 0.85) {
    try {
      if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
        return { blob: file, name: file.name };
      }
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0, w, h);
      bitmap.close?.();
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size > 0 && blob.size < file.size) {
        return { blob, name: file.name.replace(/\.[^.]+$/, "") + ".jpg" };
      }
    } catch {
      /* fall through to the original file */
    }
    return { blob: file, name: file.name };
  }

  // Process each screenshot one by one: read it, find the live posting URL, pull
  // the posting, and tailor a resume (+ cover letter) into a tracked job.
  async function processScreenshots() {
    if (busyRef.current) return;
    if (!resumeFile) {
      setError("Upload a resume first so each screenshot can be tailored.");
      return;
    }
    const queue = items.filter((it) => it.status === "pending");
    if (queue.length === 0) return;
    setError("");
    busyRef.current = true;
    setProcessing(true);
    try {
      for (const item of queue) {
        updateItem(item.id, { status: "processing", statusLabel: "Reading screenshot…", error: "" });
        let data;
        try {
          const upload = await compressScreenshot(item.file);
          const fd = new FormData();
          fd.append("image", upload.blob, upload.name);
          // Let the selected engine govern how the screenshot is read: Embedded
          // reads it offline (OCR + keyless search); otherwise Gemini vision.
          fd.append("engine", readEngine());
          const res = await fetch("/api/posting-from-image", { method: "POST", body: fd });
          data = await res.json().catch(() => ({}));
          if (!res.ok) {
            updateItem(item.id, {
              status: "error",
              statusLabel: "",
              error:
                data?.error ||
                (res.status === 503
                  ? "Screenshot reading is unavailable (Gemini key not configured)."
                  : res.status === 413
                    ? "That screenshot is too large to upload — try a smaller crop."
                    : "Couldn't read that screenshot."),
            });
            continue;
          }
        } catch (err) {
          // A bare "Failed to fetch" means no response came back — usually an
          // oversized upload, a timeout, or the server being unreachable.
          const networkish =
            err?.name === "TypeError" || /failed to fetch|networkerror|load failed/i.test(err?.message || "");
          updateItem(item.id, {
            status: "error",
            statusLabel: "",
            error: networkish
              ? "Couldn't reach the server — the screenshot may be too large or the request timed out. Try a smaller screenshot."
              : err.message || "Couldn't read that screenshot.",
          });
          continue;
        }

        if (!data?.found) {
          updateItem(item.id, {
            status: "error",
            statusLabel: "",
            jobTitle: data?.jobTitle || "",
            company: data?.company || "",
            url: data?.url || "",
            error: data?.reason || "Couldn't find the live posting URL for this screenshot.",
          });
          continue;
        }

        updateItem(item.id, {
          status: "processing",
          statusLabel: "Tailoring…",
          jobTitle: data.jobTitle || "",
          company: data.company || "",
          url: data.url || "",
        });

        const job = {
          id: item.id,
          title: data.jobTitle || "Untitled role",
          company: data.company || "",
          url: data.url || "",
          description: data.postingText || "",
        };
        setTrackedJobs((prev) => (prev.some((j) => j.id === job.id) ? prev : [...prev, job]));
        const result = await handleTailorJob(job, { skipDownload: true });
        if (result?.ok) {
          // Name the files from the screenshot's own clean title/company. The
          // tailor engine can re-derive a noisier title (salary, location), so
          // pin the title we read from the posting.
          if (data.jobTitle) updateTailoringJob(job.id, { generatedJobTitle: data.jobTitle });
          updateItem(item.id, { status: "done", statusLabel: "", jobId: job.id });
        } else {
          updateItem(item.id, { status: "error", statusLabel: "", error: result?.error || "Tailoring failed." });
        }
      }
    } finally {
      busyRef.current = false;
      setProcessing(false);
    }
  }

  // Kick off processing automatically as soon as screenshots are added — no
  // Generate click. Reruns when new pending items appear (more uploads, or a
  // retry that resets an item to pending), once any in-flight pass finishes.
  useEffect(() => {
    if (processing || !resumeFile) return;
    if (!items.some((it) => it.status === "pending")) return;
    // Auto-run the queue processor when new pending items appear.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    processScreenshots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, processing, resumeFile]);

  // Reset failed items to pending so the auto-runner retries them.
  function retry() {
    setItems((prev) =>
      prev.map((it) => (it.status === "error" ? { ...it, status: "pending", statusLabel: "", error: "" } : it)),
    );
  }

  return { items, processing, error, addFiles, removeItem, clear, retry, previewItem };
}
