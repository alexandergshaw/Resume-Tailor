"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { workspaceKey, createWorkspace, loadWorkspace, saveWorkspace, serializeWorkspace } from "@/lib/interviewPreparation/workspaceStore";

export function usePreparationWorkspace(userId, applicationId) {
  const key = workspaceKey(userId, applicationId);
  const [snapshot, setSnapshot] = useState(null);
  const current = useRef(null);
  const read = useCallback(() => {
    try { return loadWorkspace(window.localStorage, key); }
    catch (error) { return { workspace: createWorkspace(), error: error?.message || "Browser storage unavailable", corrupt: false, readFailure: true }; }
  }, [key]);
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      const next = { key, ...read(), unsaved: false, recovered: null };
      current.current = next; setSnapshot(next);
    });
    return () => { cancelled = true; current.current = null; };
  }, [key, read]);
  const update = useCallback((change) => {
    const previous = current.current;
    if (!previous || previous.key !== key) return false;
    const updated = typeof change === "function" ? change(previous.workspace) : change;
    const workspace = { ...updated, version: 1, revision: previous.workspace.revision + 1, updatedAt: new Date().toISOString() };
    let result = { ok: false, error: previous.error || "Resolve the saved workspace recovery before saving current edits." };
    if (!previous.corrupt && !previous.readFailure && !previous.recovered) {
      try { result = saveWorkspace(window.localStorage, key, workspace); }
      catch (error) { result = { ok: false, error: error?.message || "Browser storage unavailable" }; }
    }
    const next = { ...previous, workspace, error: result.error, unsaved: !result.ok };
    current.current = next; setSnapshot(next); return true;
  }, [key]);
  const retryRead = useCallback(() => {
    const previous = current.current;
    if (!previous || previous.key !== key) return false;
    const loaded = read();
    let next;
    if (loaded.error) next = { ...previous, error: loaded.error, corrupt: loaded.corrupt, readFailure: loaded.readFailure || false, recoveryText: loaded.recoveryText };
    else if (previous.unsaved) next = { ...previous, readFailure: false, corrupt: false, recovered: loaded.workspace, error: "Saved data is readable again. Choose which workspace to keep; neither copy has been overwritten." };
    else next = { key, ...loaded, unsaved: false, recovered: null };
    current.current = next; setSnapshot(next);
  }, [key, read]);
  const chooseRecovered = useCallback((useSaved) => {
    const previous = current.current;
    if (!previous || previous.key !== key || !previous.recovered) return;
    if (useSaved) {
      const next = { key, workspace: previous.recovered, error: "", corrupt: false, readFailure: false, unsaved: false, recovered: null };
      current.current = next; setSnapshot(next);
    } else {
      let result;
      try { result = saveWorkspace(window.localStorage, key, previous.workspace); }
      catch (error) { result = { ok: false, error: error?.message || "Browser storage unavailable" }; }
      const next = { ...previous, recovered: null, error: result.error, unsaved: !result.ok };
      current.current = next; setSnapshot(next);
    }
  }, [key]);
  const retrySave = useCallback(() => {
    const previous = current.current;
    if (!previous || previous.key !== key || previous.corrupt || previous.readFailure || previous.recovered) return;
    let result;
    try { result = saveWorkspace(window.localStorage, key, previous.workspace); }
    catch (error) { result = { ok: false, error: error?.message || "Browser storage unavailable" }; }
    const next = { ...previous, error: result.error, unsaved: !result.ok };
    current.current = next; setSnapshot(next); return true;
  }, [key]);
  const reset = useCallback(() => {
    const workspace = createWorkspace();
    let result;
    try { window.localStorage.removeItem(key); result = { ok: true, error: "" }; }
    catch (error) { result = { ok: false, error: error?.message || "Could not reset browser storage" }; }
    const next = { key, workspace, corrupt: false, readFailure: !result.ok, unsaved: !result.ok, error: result.error, recovered: null };
    current.current = next; setSnapshot(next); return true;
  }, [key]);
  const exportWorkspace = useCallback(() => {
    const previous = current.current;
    if (!previous || previous.key !== key) return null;
    return serializeWorkspace(previous.workspace);
  }, [key]);
  const visible = snapshot?.key === key ? snapshot : null;
  return { key, ready: !!visible, workspace: visible?.workspace || null, error: visible?.error || "", corrupt: visible?.corrupt || false,
    readFailure: visible?.readFailure || false, recovered: !!visible?.recovered, unsaved: visible?.unsaved || false, recoveryText: visible?.recoveryText || "",
    update, retrySave, retryRead, chooseRecovered, reset, exportWorkspace };
}
