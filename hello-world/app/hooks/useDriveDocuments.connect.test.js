// @vitest-environment jsdom
//
// Wave 5A wiring. Mounts the REAL hook with react-dom/client's createRoot +
// act, in the shape app/hooks/useDocumentPreview.wiring.test.js established
// for exactly this class of defect: a composition property (single click,
// no duplicate window, the right transport, one shared isStale) that no
// pure-function test can see, because piece-level tests only prove each
// half is individually correct.
//
// Only `fetch` and `window.open` are stubbed. Everything else -- the popup
// handshake, the multipart request, the content-hash tuple, the conflict
// prompt, driveSaveBatch's real reducer -- runs for real.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import JSZip from "jszip";
import { useDriveDocuments, computeCurrentHash } from "./useDriveDocuments.js";
import { DRIVE_UPLOAD_MAX_BYTES } from "../../lib/drive/driveSize.js";
import { buildMinimalistDocx, resolveDocumentBlob } from "../../lib/document/docx.js";
import { previewBlobArgs } from "../../lib/document/previewBlob.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const b64 = (text) => btoa(text);

// ArrayBuffer -> base64, for a REAL docx built with buildMinimalistDocx (see
// the WAVE5-SEAMS.md MAJOR-2 fixture below) -- btoa alone only handles a
// plain string, not binary zip bytes.
function arrayBufferToBase64(buf) {
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

const JOB_ID = "job-1";
const USER = { id: "user-1" };

function twoScopeEntry() {
  return {
    result: "RESUME TEXT",
    resultLines: ["RESUME TEXT"],
    docxB64: b64("RESUME-DOCX-BYTES"),
    docxPath: "",
    coverLetterResultLines: ["COVER TEXT"],
    coverLetterDocxB64: b64("COVER-DOCX-BYTES"),
    edited: { resume: false, cover: false },
    resumeFileName: "",
    coverLetterFileName: "",
  };
}

function coverNoBytesEntry() {
  return {
    ...twoScopeEntry(),
    coverLetterResultLines: ["COVER TEXT WITH NO RECOVERABLE BYTES"],
    coverLetterDocxB64: "",
  };
}

// BLOCKER-2 fixture: `edited.resume: true` forces the rebuild branch of
// resolveDocumentBlob, which hands `docxB64` to JSZip.loadAsync -- garbage
// bytes there throw "Can't find end of central directory", the exact error
// a real corrupt/unusual uploaded .docx produces (WAVE5-SEAMS.md PROBE-I).
// Cover is left with no text so only the résumé scope is attempted.
function corruptResumeEntry() {
  return {
    result: "RESUME TEXT",
    resultLines: ["RESUME TEXT"],
    docxB64: b64("NOT-A-REAL-ZIP-CONTENT"),
    docxPath: "",
    coverLetterResultLines: [],
    coverLetterDocxB64: "",
    edited: { resume: true, cover: false },
    resumeFileName: "",
    coverLetterFileName: "",
  };
}

function oversizeResumeEntry() {
  // The verbatim-serve branch just base64-decodes this string into the
  // blob's bytes (no real zip needed) -- see resolveDocumentBlob's first
  // branch and useDocumentPreview.wiring.test.js's identical fixture
  // technique. A ~5MB payload trips the 4MB guard without needing a real
  // oversized .docx.
  const big = "X".repeat(5 * 1024 * 1024);
  return { ...twoScopeEntry(), docxB64: b64(big) };
}

// ---------------------------------------------------------------------------
// fetch router
// ---------------------------------------------------------------------------

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    arrayBuffer: async () => new TextEncoder().encode("PK-DOCX-BYTES").buffer,
  };
}

function makeFetch(state) {
  return vi.fn(async (url, init) => {
    const calls = state.calls;
    calls.push({ url, init });
    if (url.startsWith("/api/drive/status")) {
      return jsonResponse({ connected: state.connected, configured: state.configured, email: "user@example.com" });
    }
    if (url.startsWith("/api/drive/documents")) {
      return jsonResponse({ documents: state.documents || {} });
    }
    if (url.startsWith("/api/drive/save")) {
      return state.saveHandler(url, init);
    }
    if (url.startsWith("/api/drive/export")) {
      return state.exportHandler ? state.exportHandler(url, init) : jsonResponse({}, 404);
    }
    throw new Error(`Unhandled fetch in test: ${url}`);
  });
}

function defaultSaveHandler() {
  let n = 0;
  return async (url, init) => {
    n += 1;
    const form = init.body;
    const meta = JSON.parse(form.get("meta"));
    return jsonResponse({
      scope: meta.scope,
      fileId: `file-${meta.scope}-${n}`,
      name: meta.name,
      webViewLink: `https://docs.google.com/document/d/file-${meta.scope}-${n}/edit`,
      version: `v${n}`,
      mimeType: "application/vnd.google-apps.document",
      created: true,
      replaced: false,
      persisted: true,
    });
  };
}

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

let container;
let root;
let latest;

function Probe(props) {
  latest = useDriveDocuments(props);
  return null;
}

async function mount(props) {
  await act(async () => {
    root.render(createElement(Probe, props));
  });
}

async function rerender(props) {
  await act(async () => {
    root.render(createElement(Probe, props));
  });
}

// A macrotask boundary drains the ENTIRE pending microtask queue ahead of
// it, unlike counting a fixed number of `await Promise.resolve()` ticks,
// which is fragile against the exact depth of an async chain (this hook's
// save path alone is content-hash -> blob build -> fetch -> json, several
// real `await`s deep). Called more than once where a test needs multiple
// sequential round trips (e.g. hydrate, then a follow-up fetch).
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// A FIXED number of `flush()` calls pins an async SCHEDULE DEPTH, not a
// behaviour, and that depth is not constant here. Each scope's save runs
// `resolveDocumentBlob` (JSZip, whose internal chunking schedules a variable
// number of its own macrotasks) plus two crypto digests, and `twoScopeEntry`
// has two scopes, so the boundaries needed before the conflict prompt lands
// were MEASURED at 1, 2 or 3 across 20 samples on 2026-09-01. The two
// conflict tests below hardcoded exactly 2 and therefore failed roughly one
// run in ten, in isolation, with nothing else running.
//
// This waits for the observable instead. `min` reproduces the original
// unconditional drain so the surrounding tests keep the settling they were
// written against — this is strictly a superset of `await flush()` repeated
// `min` times, never less — and `max` keeps it bounded, so a prompt that
// never arrives still reaches the assertion below and still fails, rather
// than hanging or being retried into a false green.
async function flushUntil(predicate, { min = 2, max = 12 } = {}) {
  let turns = 0;
  while (turns < min || (!predicate() && turns < max)) {
    await flush();
    turns += 1;
  }
}

function baseProps(overrides = {}) {
  return {
    currentUser: USER,
    tailoringMap: { [JOB_ID]: twoScopeEntry() },
    resumeFile: null,
    coverLetterFile: null,
    jobId: JOB_ID,
    jobTitle: "Staff Engineer",
    company: "Acme",
    activeScope: "resume",
    ...overrides,
  };
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  latest = null;
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
  delete window.open;
});

// ---------------------------------------------------------------------------
// AC-K1/AC-E1 — cold start is ONE click; the popup's own success resumes
// the save with no second activation.
// ---------------------------------------------------------------------------

describe("cold start: one click connects AND saves", () => {
  it("opens exactly one popup, then auto-saves once the popup reports success", async () => {
    const state = { calls: [], connected: false, configured: true, saveHandler: defaultSaveHandler() };
    vi.stubGlobal("fetch", makeFetch(state));
    const popup = { closed: false, focus: vi.fn() };
    window.open = vi.fn(() => popup);

    await mount(baseProps());
    await flush();
    expect(latest.status).toBe("disconnected");

    await act(async () => {
      await latest.saveToDrive({ activeScope: "resume", activeText: undefined, activeFileName: "" });
    });
    await flush();

    expect(window.open).toHaveBeenCalledTimes(1);
    expect(window.open.mock.calls[0][1]).toBe("drive-oauth");
    expect(latest.status).toBe("consentPending");
    // Nothing was saved yet -- the popup hasn't reported anything.
    expect(state.calls.some((c) => c.url.startsWith("/api/drive/save"))).toBe(false);

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          data: { source: "drive-oauth", ok: true, reason: null },
        }),
      );
    });
    await flush();
    await flush();
    await flush();

    // The save ran ON ITS OWN -- no second call to saveToDrive anywhere
    // above this point.
    const saveCalls = state.calls.filter((c) => c.url.startsWith("/api/drive/save"));
    expect(saveCalls).toHaveLength(2); // resume + cover, one activation
    expect(latest.status).toBe("connected");
  });

  it("a second activation while consent is pending re-focuses the SAME window instead of opening another", async () => {
    const state = { calls: [], connected: false, configured: true, saveHandler: defaultSaveHandler() };
    vi.stubGlobal("fetch", makeFetch(state));
    const popup = { closed: false, focus: vi.fn() };
    window.open = vi.fn(() => popup);

    await mount(baseProps());
    await flush();

    await act(async () => {
      await latest.saveToDrive({ activeScope: "resume", activeText: undefined, activeFileName: "" });
    });
    await flush();
    expect(window.open).toHaveBeenCalledTimes(1);

    // The second click, dispatched directly to the SAME handler DriveActions
    // would call (onSave routes to saveToDrive again while status is
    // consentPending, or the caller routes it to onRefocusConsent -- either
    // way, no second window may open).
    await act(async () => {
      latest.onRefocusConsent();
    });
    await flush();

    expect(window.open).toHaveBeenCalledTimes(1);
    expect(popup.focus).toHaveBeenCalledTimes(1);
  });

  it("a blocked popup is detected immediately: no poll, no error thrown, control returns to disconnected", async () => {
    const state = { calls: [], connected: false, configured: true, saveHandler: defaultSaveHandler() };
    vi.stubGlobal("fetch", makeFetch(state));
    window.open = vi.fn(() => null); // AC-C16

    await mount(baseProps());
    await flush();

    await act(async () => {
      await latest.saveToDrive({ activeScope: "resume", activeText: undefined, activeFileName: "" });
    });
    await flush();

    expect(window.open).toHaveBeenCalledTimes(1);
    expect(latest.status).toBe("disconnected");
    expect(latest.announcement.alert).toMatch(/blocked the Google window/);
    // No save call was ever attempted.
    expect(state.calls.some((c) => c.url.startsWith("/api/drive/save"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The multipart transport (AC-S10) and the shared size ceiling (AC-S22a).
// ---------------------------------------------------------------------------

describe("warm save: transport and size guard", () => {
  it("POSTs multipart/form-data with a raw Blob file part and a JSON meta part -- never base64-over-JSON", async () => {
    const state = { calls: [], connected: true, configured: true, saveHandler: defaultSaveHandler() };
    vi.stubGlobal("fetch", makeFetch(state));

    await mount(baseProps());
    await flush();

    await act(async () => {
      await latest.saveToDrive({ activeScope: "resume", activeText: undefined, activeFileName: "" });
    });
    await flush();

    const saveCalls = state.calls.filter((c) => c.url.startsWith("/api/drive/save"));
    expect(saveCalls).toHaveLength(2);
    for (const call of saveCalls) {
      expect(call.init.body).toBeInstanceOf(FormData);
      const file = call.init.body.get("file");
      expect(file).toBeInstanceOf(Blob);
      const meta = JSON.parse(call.init.body.get("meta"));
      expect(typeof meta.scope).toBe("string");
      expect(typeof meta.name).toBe("string");
      expect(meta.jobId).toBe(JOB_ID);
      expect(typeof meta.contentHash).toBe("string");
    }
  });

  it("a blob over DRIVE_UPLOAD_MAX_BYTES never reaches the network for that scope", async () => {
    const state = { calls: [], connected: true, configured: true, saveHandler: defaultSaveHandler() };
    vi.stubGlobal("fetch", makeFetch(state));

    await mount(baseProps({ tailoringMap: { [JOB_ID]: oversizeResumeEntry() } }));
    await flush();

    await act(async () => {
      await latest.saveToDrive({ activeScope: "resume", activeText: undefined, activeFileName: "" });
    });
    await flush();

    const saveCalls = state.calls.filter((c) => c.url.startsWith("/api/drive/save"));
    // Only the cover scope should have reached the network.
    expect(saveCalls).toHaveLength(1);
    const meta = JSON.parse(saveCalls[0].init.body.get("meta"));
    expect(meta.scope).toBe("cover");
    // The résumé row reports too-large, not silence.
    expect(latest.rows.some((r) => r.scope === "resume" && r.kind === "too-large")).toBe(true);
  });

  it("sends the in-session knownRef once a scope has been saved before, closing the reload data-loss path", async () => {
    const state = { calls: [], connected: true, configured: true, saveHandler: defaultSaveHandler() };
    vi.stubGlobal("fetch", makeFetch(state));

    await mount(baseProps());
    await flush();
    await act(async () => {
      await latest.saveToDrive({ activeScope: "resume", activeText: undefined, activeFileName: "" });
    });
    await flush();

    state.calls.length = 0;
    await act(async () => {
      await latest.saveToDrive({ activeScope: "resume", activeText: undefined, activeFileName: "" });
    });
    await flush();

    const secondSaves = state.calls.filter((c) => c.url.startsWith("/api/drive/save"));
    for (const call of secondSaves) {
      const meta = JSON.parse(call.init.body.get("meta"));
      expect(meta.knownRef).toBeTruthy();
      expect(typeof meta.knownRef.fileId).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// leadingLine / announcement shape (obligations 3 and 6).
// ---------------------------------------------------------------------------

describe("result shapes", () => {
  it("announcement is a complete {polite, alert} object from the very first render, before any action", async () => {
    const state = { calls: [], connected: true, configured: true, saveHandler: defaultSaveHandler() };
    vi.stubGlobal("fetch", makeFetch(state));
    await mount(baseProps());
    await flush();
    expect(latest.announcement).toEqual({ polite: "", alert: "" });
  });

  it("leadingLine is a real descriptor object after a full success, never a string", async () => {
    const state = { calls: [], connected: true, configured: true, saveHandler: defaultSaveHandler() };
    vi.stubGlobal("fetch", makeFetch(state));
    await mount(baseProps());
    await flush();
    await act(async () => {
      await latest.saveToDrive({ activeScope: "resume", activeText: undefined, activeFileName: "" });
    });
    await flush();
    expect(latest.leadingLine).toEqual({ kind: "saved", count: 2 });
  });

  it("a cover letter with no recoverable bytes is reported as a PARTIAL save, never as fully saved", async () => {
    const state = { calls: [], connected: true, configured: true, saveHandler: defaultSaveHandler() };
    vi.stubGlobal("fetch", makeFetch(state));
    await mount(baseProps({ tailoringMap: { [JOB_ID]: coverNoBytesEntry() } }));
    await flush();
    await act(async () => {
      await latest.saveToDrive({ activeScope: "resume", activeText: undefined, activeFileName: "" });
    });
    await flush();

    expect(latest.leadingLine).toEqual({ kind: "partial", saved: 1, total: 2 });
    const coverRow = latest.rows.find((r) => r.scope === "cover");
    expect(coverRow.kind).toBe("no-bytes");
    const saveCalls = state.calls.filter((c) => c.url.startsWith("/api/drive/save"));
    expect(saveCalls).toHaveLength(1); // only résumé ever reached the network
  });

  it("isStale is the SAME value fed to both DriveActions.isStale and DriveResultRegion.stale", async () => {
    const state = {
      calls: [],
      connected: true,
      configured: true,
      saveHandler: defaultSaveHandler(),
      documents: { resume: { fileId: "f1", contentHash: "not-the-current-hash", version: "v1", webViewLink: "x" } },
    };
    vi.stubGlobal("fetch", makeFetch(state));
    await mount(baseProps());
    await flush();
    await flush();
    expect(latest.isStale).toBe(true);
    expect(latest.stale).toBe(true);
    expect(latest.isStale).toBe(latest.stale);
  });
});

// ---------------------------------------------------------------------------
// The conflict prompt's onConflict values (must be exactly "overwrite" / "new").
// ---------------------------------------------------------------------------

describe("conflict resolution", () => {
  it("Overwrite retries with onConflict exactly 'overwrite'", async () => {
    let attempt = 0;
    const state = {
      calls: [],
      connected: true,
      configured: true,
      saveHandler: async (url, init) => {
        attempt += 1;
        const meta = JSON.parse(init.body.get("meta"));
        if (meta.scope === "resume" && attempt <= 1) {
          return jsonResponse({ error: "conflict_session", name: "Old Name", webViewLink: "x" }, 409);
        }
        return jsonResponse({
          scope: meta.scope,
          fileId: `f-${meta.scope}`,
          name: meta.name,
          webViewLink: "x",
          version: "v2",
          mimeType: "application/vnd.google-apps.document",
          created: false,
          replaced: false,
          persisted: true,
        });
      },
    };
    vi.stubGlobal("fetch", makeFetch(state));
    await mount(baseProps());
    await flush();

    // Deliberately NOT wrapped in `act()`: this promise only settles once
    // the prompt below is answered, and overlapping two unresolved `act()`
    // scopes is documented to interleave and lose track of pending effects.
    // `flush()`'s own act() calls are what actually drain the state updates
    // this kicks off.
    const savePromise = latest.saveToDrive({ activeScope: "resume", activeText: undefined, activeFileName: "" });
    await flushUntil(() => latest.prompt);
    expect(latest.prompt).toBeTruthy();

    await act(async () => {
      latest.prompt.onOverwrite();
    });
    await flush();
    await savePromise;
    await flush();

    const retry = state.calls
      .filter((c) => c.url.startsWith("/api/drive/save"))
      .map((c) => JSON.parse(c.init.body.get("meta")))
      .find((m) => m.scope === "resume" && m.onConflict);
    expect(retry.onConflict).toBe("overwrite");
  });

  it("Save as a new Doc retries with onConflict exactly 'new'", async () => {
    let attempt = 0;
    const state = {
      calls: [],
      connected: true,
      configured: true,
      saveHandler: async (url, init) => {
        attempt += 1;
        const meta = JSON.parse(init.body.get("meta"));
        if (meta.scope === "resume" && attempt <= 1) {
          return jsonResponse({ error: "conflict_foreign", name: "Old Name", webViewLink: "x" }, 409);
        }
        return jsonResponse({
          scope: meta.scope,
          fileId: `f-${meta.scope}`,
          name: meta.name,
          webViewLink: "x",
          version: "v2",
          mimeType: "application/vnd.google-apps.document",
          created: true,
          replaced: false,
          persisted: true,
        });
      },
    };
    vi.stubGlobal("fetch", makeFetch(state));
    await mount(baseProps());
    await flush();

    // See the "Overwrite" test above for why this is deliberately not
    // wrapped in `act()`.
    const savePromise = latest.saveToDrive({ activeScope: "resume", activeText: undefined, activeFileName: "" });
    await flushUntil(() => latest.prompt);
    expect(latest.prompt).toBeTruthy();

    await act(async () => {
      latest.prompt.onSaveAsNew();
    });
    await flush();
    await savePromise;
    await flush();

    const retry = state.calls
      .filter((c) => c.url.startsWith("/api/drive/save"))
      .map((c) => JSON.parse(c.init.body.get("meta")))
      .find((m) => m.scope === "resume" && m.onConflict);
    expect(retry.onConflict).toBe("new");
  });
});

// ---------------------------------------------------------------------------
// GET /api/drive/documents consumption.
// ---------------------------------------------------------------------------

describe("durable reference hydration", () => {
  it("hasDriveReference becomes true once GET /api/drive/documents returns a row for the open posting", async () => {
    const state = {
      calls: [],
      connected: true,
      configured: true,
      saveHandler: defaultSaveHandler(),
      documents: { resume: { fileId: "f1", contentHash: "abc", version: "v1", webViewLink: "https://x" } },
    };
    vi.stubGlobal("fetch", makeFetch(state));
    await mount(baseProps());
    await flush();
    await flush();
    expect(latest.hasDriveReference).toBe(true);
    expect(state.calls.some((c) => c.url.startsWith(`/api/drive/documents?jobId=${JOB_ID}`))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// WAVE5-SEAMS.md BLOCKER-1 -- statusFailed must be a REAL, reachable state,
// driven through an actual failing GET /api/drive/status, not injected.
// ---------------------------------------------------------------------------

describe("BLOCKER-1: a failed status fetch is a real, self-healing state", () => {
  it("a failing GET /api/drive/status resolves the hook to statusFailed, not checking (AC-C26)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (url.startsWith("/api/drive/status")) {
          return { ok: false, status: 500, json: async () => ({}) };
        }
        throw new Error(`Unhandled fetch in test: ${url}`);
      }),
    );

    await mount(baseProps());
    await flush();

    // Before the fix this reads "checking", and DriveActions renders null
    // for "checking" -- the whole feature vanishes for a connected user
    // whose status route 500s.
    expect(latest.status).toBe("statusFailed");
    expect(latest.connected).toBe(false);
  });

  it("self-heals once a later status call succeeds -- e.g. the AC-C23 focus re-check", async () => {
    let failStatus = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (url.startsWith("/api/drive/status")) {
          if (failStatus) return { ok: false, status: 500, json: async () => ({}) };
          return {
            ok: true,
            status: 200,
            json: async () => ({ connected: false, configured: true, email: "user@example.com" }),
          };
        }
        if (url.startsWith("/api/drive/documents")) {
          return { ok: true, status: 200, json: async () => ({ documents: {} }) };
        }
        throw new Error(`Unhandled fetch in test: ${url}`);
      }),
    );

    await mount(baseProps());
    await flush();
    expect(latest.status).toBe("statusFailed");

    failStatus = false;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await flush();
    await flush();

    // Without the reset this hook's fix adds alongside the reorder,
    // statusCheckFailed would stay true forever and this would still read
    // "statusFailed" even though configured/connected just resolved cleanly.
    expect(latest.status).toBe("disconnected");
  });
});

// ---------------------------------------------------------------------------
// WAVE5-SEAMS.md BLOCKER-2 -- a throw inside the save loop must be caught,
// never left to reject saveToDrive and strand the live region mid-sentence.
// ---------------------------------------------------------------------------

describe("BLOCKER-2: a throw inside the save loop is caught, not swallowed", () => {
  it("a corrupt/unusual .docx that JSZip can't parse ends the save in a real terminal state, not a stuck live region", async () => {
    const state = { calls: [], connected: true, configured: true, saveHandler: defaultSaveHandler() };
    vi.stubGlobal("fetch", makeFetch(state));

    await mount(baseProps({ tailoringMap: { [JOB_ID]: corruptResumeEntry() } }));
    await flush();

    // Before the fix this promise REJECTS -- saveToDrive has a `finally`
    // but no `catch` -- so an unwrapped await here would fail the test with
    // the JSZip error instead of letting the assertions below run.
    await act(async () => {
      await latest.saveToDrive({ activeScope: "resume", activeText: undefined, activeFileName: "" });
    });
    await flush();

    // The throw happens inside buildPreviewBlob, before any fetch.
    expect(state.calls.some((c) => c.url.startsWith("/api/drive/save"))).toBe(false);
    // driveBusy was cleared -- not stuck on "saving".
    expect(latest.status).toBe("connected");
    expect(latest.rows).toHaveLength(1);
    expect(latest.rows[0].kind).toBe("error");
    // The live region ends in a TERMINAL state, never left announcing a
    // save that will never finish.
    expect(latest.announcement.polite).not.toMatch(/Saving to Google Drive/);
    expect(latest.announcement.alert.length).toBeGreaterThan(0);
  });

  it("crypto.subtle being unavailable (a non-secure origin) is caught the same way -- driven by the API's actual absence", async () => {
    const state = { calls: [], connected: true, configured: true, saveHandler: defaultSaveHandler() };
    vi.stubGlobal("fetch", makeFetch(state));

    const realCrypto = globalThis.crypto;
    // Simulate the API's ABSENCE -- http://<LAN-ip> is a non-secure origin,
    // where window.crypto.subtle is genuinely undefined -- rather than a
    // mock that throws, which would prove nothing about the real failure.
    vi.stubGlobal("crypto", { getRandomValues: realCrypto.getRandomValues?.bind(realCrypto) });

    const rejections = [];
    const onRejection = (reason) => rejections.push(reason);
    process.on("unhandledRejection", onRejection);

    try {
      await mount(baseProps());
      await flush();
      await flush(); // give any escaping rejection a full macrotask to (not) surface

      // The hash-recompute effect (:421-440) must not leak an unhandled
      // promise rejection just because crypto is missing -- its neighbour
      // effect already guards its own fetch the same way.
      expect(rejections).toHaveLength(0);
      expect(latest.isStale).toBe(false);

      await act(async () => {
        await latest.saveToDrive({ activeScope: "resume", activeText: undefined, activeFileName: "" });
      });
      await flush();

      expect(state.calls.some((c) => c.url.startsWith("/api/drive/save"))).toBe(false);
      expect(latest.status).toBe("connected");
      expect(latest.rows.some((r) => r.kind === "error")).toBe(true);
      expect(latest.announcement.polite).not.toMatch(/Saving to Google Drive/);
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  });
});

// ---------------------------------------------------------------------------
// WAVE5-SEAMS.md MAJOR-1 -- the sent hash (meta.contentHash) and the
// compared hash (currentHashByScope) must be the SAME formula. Neither M7
// (sent side -> sha256Hex(text) alone) nor M13 (compared side -> a
// divergent tuple) may leave a clean save reading as stale.
// ---------------------------------------------------------------------------

describe("MAJOR-1: the sent hash and the compared hash must agree", () => {
  it("a clean save (no activeText divergence) leaves isStale false immediately after saving", async () => {
    const state = { calls: [], connected: true, configured: true, saveHandler: defaultSaveHandler() };
    vi.stubGlobal("fetch", makeFetch(state));

    await mount(baseProps());
    await flush();
    // Nothing saved yet -- no reference to compare against.
    expect(latest.isStale).toBe(false);

    await act(async () => {
      await latest.saveToDrive({ activeScope: "resume", activeText: undefined, activeFileName: "" });
    });
    await flush();

    const saveCalls = state.calls.filter((c) => c.url.startsWith("/api/drive/save"));
    const resumeMeta = saveCalls.map((c) => JSON.parse(c.init.body.get("meta"))).find((m) => m.scope === "resume");
    expect(typeof resumeMeta.contentHash).toBe("string");
    expect(resumeMeta.contentHash).toHaveLength(64);

    // If the SENT hash and the COMPARED hash ever drift onto two different
    // formulas -- in either direction -- a save of genuinely unchanged
    // content immediately reads as stale. isStale/stale are the one place
    // that divergence becomes observable through this hook's own return
    // value.
    expect(latest.isStale).toBe(false);
    expect(latest.stale).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WAVE5-SEAMS.md MAJOR-2 -- the stale-text seam Wave 6 exists for. A save
// carrying `activeText` must upload bytes reflecting that text, not
// whatever `entry` (the pre-commit, tailoringMap-sourced object) still
// holds.
// ---------------------------------------------------------------------------

describe("MAJOR-2: the active draft's text reaches the uploaded bytes", () => {
  it("a save carrying activeText produces uploaded bytes containing the DRAFT text, not entry.result", async () => {
    const storedText = "STORED RESUME TEXT";
    const activeDraftText = "FRESH DRAFT NOT YET COMMITTED";

    const templateBlob = await buildMinimalistDocx([], storedText);
    const templateB64 = arrayBufferToBase64(await templateBlob.arrayBuffer());

    const entry = {
      result: storedText,
      // REALISTIC, not empty: the dialog has not run commitDraft() yet, so
      // tailoringMap's resultLines array (like the rest of `entry`) is still
      // whatever it was before this edit -- populated with the STORED
      // pre-commit line, exactly like every real generated entry. An empty
      // array here would dodge the bug this test exists to catch: docx.js's
      // buildDocxFromUploadedTemplate only falls back to splitting `text`
      // when `generatedLines` is empty, so an empty resultLines makes this
      // test pass even if `activeText` never reaches the rebuild at all.
      resultLines: [storedText],
      docxB64: templateB64,
      docxPath: "",
      coverLetterResultLines: [], // cover scope excluded -- keeps this to one request
      coverLetterDocxB64: "",
      edited: { resume: false, cover: false },
      resumeFileName: "",
      coverLetterFileName: "",
    };

    const state = { calls: [], connected: true, configured: true, saveHandler: defaultSaveHandler() };
    vi.stubGlobal("fetch", makeFetch(state));

    await mount(baseProps({ tailoringMap: { [JOB_ID]: entry } }));
    await flush();

    await act(async () => {
      await latest.saveToDrive({ activeScope: "resume", activeText: activeDraftText, activeFileName: "" });
    });
    await flush();

    const saveCalls = state.calls.filter((c) => c.url.startsWith("/api/drive/save"));
    expect(saveCalls).toHaveLength(1); // only résumé -- cover has no text
    const uploadedBlob = saveCalls[0].init.body.get("file");
    const zip = await JSZip.loadAsync(await uploadedBlob.arrayBuffer());
    const xml = await zip.file("word/document.xml").async("string");

    expect(xml).toContain(activeDraftText);
    expect(xml).not.toContain(storedText);

    // meta.contentHash must reflect the SUPPLIED text too, not the stored
    // one -- otherwise the currency badge would misread this exact save.
    const meta = JSON.parse(saveCalls[0].init.body.get("meta"));
    const hashForDraft = await computeCurrentHash(entry, "resume", { text: activeDraftText });
    expect(meta.contentHash).toBe(hashForDraft);
  });
});

// ---------------------------------------------------------------------------
// Join test: the REAL previewBlobArgs output fed straight into the REAL
// resolveDocumentBlob/buildDocxFromUploadedTemplate -- no hand-built argument
// object standing in for either side. This is the seam the MAJOR-2 test
// above almost missed: MAJOR-2 proves the property through the whole hook
// (saveToDrive -> fetch -> multipart body), which is the right end-to-end
// check, but a hand-built args object in a lower-level test could just as
// easily have pinned the WRONG contract between the two real functions. This
// test instead calls previewBlobArgs itself and hands its literal return
// value to resolveDocumentBlob, so a regression in either function's
// understanding of the other's contract shows up here even if some future
// caller of previewBlobArgs gets the wiring wrong in a way MAJOR-2's fixture
// wouldn't exercise.
// ---------------------------------------------------------------------------

describe("join: previewBlobArgs' real output into resolveDocumentBlob's real rebuild branch", () => {
  it("a divergent text produces a docx whose paragraph is the draft, not the stored line, for a REALISTIC populated resultLines entry", async () => {
    const storedText = "STORED RESUME TEXT";
    const draftText = "FRESH DRAFT NOT YET COMMITTED";

    const templateBlob = await buildMinimalistDocx([], storedText);
    const templateB64 = arrayBufferToBase64(await templateBlob.arrayBuffer());

    const entry = {
      result: storedText,
      // Populated, matching the stored text -- the common case (a hand-edit
      // that hasn't reached tailoringMap's resultLines yet, not a freshly
      // generated entry that never had lines to begin with).
      resultLines: [storedText],
      docxB64: templateB64,
      docxPath: "",
      edited: { resume: false, cover: false },
    };

    const args = previewBlobArgs(entry, "resume", { text: draftText });
    const blob = await resolveDocumentBlob(args);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file("word/document.xml").async("string");

    expect(xml).toContain(draftText);
    expect(xml).not.toContain(storedText);
  });
});
