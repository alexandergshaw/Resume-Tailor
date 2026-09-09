"use client";

import { useEffect, useState } from "react";
import { triggerBlobDownload } from "../../lib/document/docx";
import { createClient } from "../../lib/supabase/client";
import {
  listMaterials,
  uploadMaterial,
  downloadMaterialBlob,
  removeMaterial,
} from "../../lib/supabase/materials";

// The supplementary materials locker (transcripts, portfolios, anything the
// user wants kept beside their résumé). Supabase Storage for signed-in users,
// in-memory for the session otherwise; download-only, plus one route into the
// chat panel so the user can ask about a stored file.
//
// `chat` is the useChat() result, passed in rather than re-instantiated:
// askAiAboutMaterial opens the panel and hands it an attachment, and there is
// only ever one chat.
//
// WHY THIS IS ORDER-PRESERVING. page.js calls this hook at the exact source
// position its single effect already occupied, so that effect keeps its index
// among the component's effects; the three useState calls move down to meet
// it. See app/hooks/useMaterialsLocker.extraction.test.js.
export function useMaterialsLocker({ currentUser, chat }) {
  // Supplementary materials locker (transcripts etc.). Each item:
  // { name, size, source: "remote"|"local", file? }. Persisted to Supabase for
  // signed-in users; in-memory for the session otherwise. Download-only.
  const [materials, setMaterials] = useState([]);
  const [materialsBusy, setMaterialsBusy] = useState(false);
  const [materialsError, setMaterialsError] = useState("");

  // ── Supplementary materials locker ────────────────────────────────────────
  // Load the user's stored materials on sign-in.
  useEffect(() => {
    if (!currentUser) return undefined;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const list = await listMaterials(supabase, currentUser.id);
      if (!cancelled) setMaterials(list.map((m) => ({ ...m, source: "remote" })));
    })();
    return () => { cancelled = true; };
  }, [currentUser]);

  async function uploadMaterials(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setMaterialsError("");

    // Signed-out: keep files in memory for the session only.
    if (!currentUser) {
      const additions = files.map((file) => ({
        name: file.name,
        size: file.size,
        source: "local",
        file,
      }));
      setMaterials((prev) => [...prev, ...additions]);
      return;
    }

    setMaterialsBusy(true);
    const supabase = createClient();
    for (const file of files) {
      if (file.size > 25 * 1024 * 1024) {
        setMaterialsError(`${file.name} is too large (max 25 MB).`);
        continue;
      }
      const { error } = await uploadMaterial(supabase, currentUser.id, file);
      if (error) setMaterialsError(`${file.name}: ${error}`);
    }
    const list = await listMaterials(supabase, currentUser.id);
    setMaterials(list.map((m) => ({ ...m, source: "remote" })));
    setMaterialsBusy(false);
  }

  async function downloadMaterialFile(item) {
    if (!item) return;
    setMaterialsError("");
    if (item.source === "local" && item.file) {
      triggerBlobDownload(item.file, item.name);
      return;
    }
    if (!currentUser) return;
    const supabase = createClient();
    const { blob, error } = await downloadMaterialBlob(supabase, currentUser.id, item.name);
    if (error) {
      setMaterialsError(error);
      return;
    }
    triggerBlobDownload(blob, item.name);
  }

  async function removeMaterialFile(item) {
    if (!item) return;
    setMaterialsError("");
    if (item.source === "local") {
      setMaterials((prev) => prev.filter((m) => m !== item));
      return;
    }
    if (!currentUser) return;
    const supabase = createClient();
    const { error } = await removeMaterial(supabase, currentUser.id, item.name);
    if (error) {
      setMaterialsError(error);
      return;
    }
    setMaterials((prev) => prev.filter((m) => m.name !== item.name));
  }

  // Open the chat with a supplementary material attached as context. For remote
  // files we fetch the bytes from Storage first; the chat attachment pipeline
  // then text-extracts or inlines (image/PDF) the file.
  async function askAiAboutMaterial(item) {
    if (!item) return;
    setMaterialsError("");
    chat.setChatOpen(true);
    try {
      let file = item.source === "local" && item.file ? item.file : null;
      if (!file && currentUser) {
        const supabase = createClient();
        const { blob, error } = await downloadMaterialBlob(supabase, currentUser.id, item.name);
        if (error || !blob) {
          setMaterialsError(error || "Could not load that file.");
          return;
        }
        file = new File([blob], item.name, { type: blob.type || undefined });
      }
      if (file) await chat.addChatAttachments([file]);
    } catch (err) {
      setMaterialsError(err?.message || "Could not attach that file.");
    }
  }

  return {
    materials,
    materialsBusy,
    materialsError,
    uploadMaterials,
    downloadMaterialFile,
    removeMaterialFile,
    askAiAboutMaterial,
  };
}
