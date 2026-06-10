import { AUTOFILL_FIELDS, FIELD_DEFS } from "../shared/fields.js";
import { autofillRuntime } from "../content/autofill.js";
import { APP_ORIGIN } from "../config.js";

const STORAGE_KEY = "autofillProfile";
const SYNCED_AT_KEY = "autofillSyncedAt";

const form = document.getElementById("profile-form");
const statusEl = document.getElementById("status");
const syncedAtEl = document.getElementById("synced-at");

// Build one labeled input per field. Full-name/location/links span both columns.
const FULL_WIDTH = new Set(["fullName", "location", "linkedin", "github", "website"]);
for (const f of AUTOFILL_FIELDS) {
  const wrap = document.createElement("div");
  wrap.className = "field" + (FULL_WIDTH.has(f.key) ? " full" : "");
  const label = document.createElement("label");
  label.textContent = f.label;
  label.htmlFor = `field-${f.key}`;
  const input = document.createElement("input");
  input.id = `field-${f.key}`;
  input.name = f.key;
  input.type = f.key === "email" ? "email" : "text";
  input.autocomplete = "off";
  wrap.append(label, input);
  form.append(wrap);
}

function setStatus(message, kind) {
  if (!message) {
    statusEl.hidden = true;
    statusEl.textContent = "";
    statusEl.className = "status";
    return;
  }
  statusEl.hidden = false;
  statusEl.textContent = message;
  statusEl.className = `status ${kind === "err" ? "err" : "ok"}`;
}

function readForm() {
  const profile = {};
  for (const f of AUTOFILL_FIELDS) {
    const el = document.getElementById(`field-${f.key}`);
    const value = (el?.value || "").trim();
    if (value) profile[f.key] = value;
  }
  return profile;
}

function writeForm(profile) {
  for (const f of AUTOFILL_FIELDS) {
    const el = document.getElementById(`field-${f.key}`);
    if (el) el.value = (profile && profile[f.key]) || "";
  }
}

function renderSyncedAt(iso) {
  if (!iso) {
    syncedAtEl.textContent = "";
    return;
  }
  const d = new Date(iso);
  syncedAtEl.textContent = Number.isNaN(d.getTime())
    ? ""
    : `Last synced ${d.toLocaleString()}`;
}

// Load any saved profile + last-sync time from extension storage.
async function load() {
  const data = await chrome.storage.local.get([STORAGE_KEY, SYNCED_AT_KEY]);
  writeForm(data[STORAGE_KEY] || {});
  renderSyncedAt(data[SYNCED_AT_KEY]);
}

async function save() {
  const profile = readForm();
  await chrome.storage.local.set({ [STORAGE_KEY]: profile });
  setStatus("Saved.", "ok");
}

// Pull the saved profile from the app's existing endpoint. Requires that the
// app origin is in manifest host_permissions and that you're signed in there
// (the request is sent with your session cookie).
async function syncFromApp() {
  setStatus("Syncing…", "ok");
  try {
    const res = await fetch(`${APP_ORIGIN}/api/user-profile`, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (res.status === 401) {
      throw new Error("Not signed in to Resume Tailor. Open the app, sign in, then sync.");
    }
    if (!res.ok) {
      throw new Error(`Sync failed (${res.status}).`);
    }
    const payload = await res.json().catch(() => ({}));
    const profile = payload?.profile || {};
    const syncedAt = new Date().toISOString();
    await chrome.storage.local.set({
      [STORAGE_KEY]: profile,
      [SYNCED_AT_KEY]: syncedAt,
    });
    writeForm(profile);
    renderSyncedAt(syncedAt);
    setStatus("Synced from Resume Tailor.", "ok");
  } catch (err) {
    setStatus(err.message || "Sync failed.", "err");
  }
}

// Inject the autofill runtime into the active tab, passing the saved profile.
async function fillActiveTab() {
  const profile = readForm();
  if (Object.keys(profile).length === 0) {
    setStatus("Add at least one value, then Save.", "err");
    return;
  }
  // Persist what's in the form so "Fill" always uses the latest values.
  await chrome.storage.local.set({ [STORAGE_KEY]: profile });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setStatus("No active tab to fill.", "err");
    return;
  }
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: autofillRuntime,
      args: [profile, FIELD_DEFS],
    });
    const filled = results?.[0]?.result ?? 0;
    setStatus(`Filled ${filled} field(s) on the page.`, filled > 0 ? "ok" : "err");
  } catch (err) {
    setStatus(
      "Couldn't fill this page (it may be a restricted page like chrome:// or the web store).",
      "err",
    );
  }
}

document.getElementById("save-btn").addEventListener("click", save);
document.getElementById("sync-btn").addEventListener("click", syncFromApp);
document.getElementById("fill-btn").addEventListener("click", fillActiveTab);

load();
