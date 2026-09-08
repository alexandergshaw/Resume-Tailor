// REPRO -- the library-update prompt's dedupe set is written at SHOW time
// (app/page.js: `libraryPromptSeenRef`, a `useRef(new Set())`), so merely
// being OFFERED the "Update your tailoring library?" dialog burns the dedupe
// key. An accidental Escape press or backdrop click -- MUI's <Dialog> fires
// `onClose` for both -- costs the user their suggestions for the rest of the
// session, with no way back. The dialog's own body text ("nothing is saved
// until you confirm") tells the user dismissal is safe. It is not.
//
// The ruling: mark on DECISION, not on show. Keep the show-time insert (it
// doubles as an in-flight guard against a duplicate concurrent
// /api/library/extract scan of the same edit) but store the dedupe key on
// the prompt object, delete it from the set on dismissal, and keep it on a
// successful commit. The `edit:` fingerprint site additionally must un-mark
// on a failed or empty fetch, so a network blip doesn't burn it forever.
//
// WHY EXTRACT-AND-EVAL, NOT SOURCE-SCANNING: app/page.js is a single
// un-exported "use client" component (`export default function Home()`) and
// cannot be mounted or imported -- the same constraint recorded in
// app/page.autoTailoredUrl.test.js, app/page.duplicateApply.wiring.test.js,
// app/page.untrackChip.wiring.test.js and
// test/repro/appliedStatusDataLoss.test.js. Those files fall back to regex
// assertions on the source text when the code under test lives elsewhere,
// but here the buggy logic IS page.js's own closures over
// `libraryPromptSeenRef` / `libraryPrompt` -- a structural regex could only
// ever pin the shape of the fix, never observe "does the prompt actually
// come back after a dismissal", which is the one claim this bug is about.
//
// So this file locates the REAL function bodies of `maybeOfferLibraryUpdate`,
// `commitLibrarySuggestions`, `handleDocumentEdited`, and whatever `onClose`
// on <LibraryUpdateDialog> resolves to (an inline arrow before the fix, a
// named function after -- resolved generically, never by a hardcoded name),
// by signature/tag text (never a line number), and actually EXECUTES them
// via `new Function`, wiring the same free variables
// (`libraryPromptSeenRef`, `libraryPrompt`/`setLibraryPrompt`, `fetch`, ...)
// to test doubles. That is the only way to prove the loss -- and the fix --
// against the real logic without mounting the whole 3200-line component.

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { editFingerprint } from "@/lib/tailor/editMining";

const pageSource = readFileSync(fileURLToPath(new URL("./page.js", import.meta.url)), "utf8");

function findMatchingClose(source, openIndex, openChar, closeChar) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === openChar) depth++;
    else if (source[i] === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Locates a function by its EXACT signature text (copy-pasted from the real
// source, not a line number), then captures the full `{ ... }` body by
// brace-depth counting so a nested block never truncates the match.
function extractFunctionBySignature(source, signatureLiteral) {
  const idx = source.indexOf(signatureLiteral);
  if (idx === -1) return null;
  const braceStart = idx + signatureLiteral.length - 1;
  if (source[braceStart] !== "{") return null;
  const braceEnd = findMatchingClose(source, braceStart, "{", "}");
  if (braceEnd === -1) return null;
  return source.slice(idx, braceEnd + 1);
}

const maybeOfferSrc = extractFunctionBySignature(pageSource, "function maybeOfferLibraryUpdate(payload, jobId) {");
const commitSrc = extractFunctionBySignature(
  pageSource,
  "async function commitLibrarySuggestions(entries, { retailor = false } = {}) {",
);
const handleEditedSrc = extractFunctionBySignature(
  pageSource,
  "async function handleDocumentEdited({ jobId, addedText }) {",
);

// <LibraryUpdateDialog>'s onClose is whatever the call site wires it to -- an
// inline arrow today, a named function after the fix. Resolved generically
// (by whatever identifier or expression is actually there) so this test does
// not hardcode a name the fix is free to choose.
function extractDismissHandler(source) {
  const tagStart = source.indexOf("<LibraryUpdateDialog");
  if (tagStart === -1) return null;
  const tagEnd = source.indexOf("/>", tagStart);
  if (tagEnd === -1) return null;
  const tagText = source.slice(tagStart, tagEnd + 2);
  const attrIdx = tagText.indexOf("onClose={");
  if (attrIdx === -1) return null;
  const braceStart = attrIdx + "onClose=".length;
  const braceEnd = findMatchingClose(tagText, braceStart, "{", "}");
  if (braceEnd === -1) return null;
  const expr = tagText.slice(braceStart + 1, braceEnd).trim();
  const identMatch = expr.match(/^[A-Za-z_$][\w$]*$/);
  if (identMatch) {
    const name = identMatch[0];
    const fnBody = extractFunctionBySignature(source, `function ${name}() {`);
    if (!fnBody) throw new Error(`onClose references '${name}' but no 'function ${name}() {' was found in page.js`);
    return { name, declSrc: fnBody };
  }
  return { name: "__dismissHandler", declSrc: `const __dismissHandler = (${expr});` };
}

const dismiss = extractDismissHandler(pageSource);

if (!maybeOfferSrc || !commitSrc || !handleEditedSrc || !dismiss) {
  throw new Error(
    "Could not locate one of the library-prompt functions in app/page.js by signature -- " +
      "update the signature literals in this test if the functions were legitimately renamed.",
  );
}

// Builds a fresh, isolated copy of the real page.js logic, closing over test
// doubles for everything that isn't the dedupe/prompt state itself.
function buildHarness({ libraryPromptSeenRef, fetchImpl, trackedJobs = [], handleTailorJob = vi.fn() }) {
  const bodySrc = [
    "let libraryPrompt = null;",
    'function setLibraryPrompt(updater) { libraryPrompt = typeof updater === "function" ? updater(libraryPrompt) : updater; }',
    maybeOfferSrc,
    commitSrc,
    handleEditedSrc,
    dismiss.declSrc,
    "return {",
    "  maybeOfferLibraryUpdate: maybeOfferLibraryUpdate,",
    "  commitLibrarySuggestions: commitLibrarySuggestions,",
    "  handleDocumentEdited: handleDocumentEdited,",
    `  dismissLibraryPrompt: ${dismiss.name},`,
    "  getLibraryPrompt: function () { return libraryPrompt; },",
    "  __setLibraryPromptForTest: setLibraryPrompt,",
    "};",
  ].join("\n\n");

  const factory = new Function(
    "libraryPromptSeenRef",
    "fetch",
    "editFingerprint",
    "annotateAndRank",
    "recordMatchGaps",
    "updateTailoringJob",
    "trackedJobs",
    "handleTailorJob",
    bodySrc,
  );

  return factory(
    libraryPromptSeenRef,
    fetchImpl || vi.fn(),
    editFingerprint,
    (buzzwords) => buzzwords,
    () => {},
    () => {},
    trackedJobs,
    handleTailorJob,
  );
}

const matchPayload = { librarySuggestions: { buzzwords: [{ canonical: "kubernetes" }] } };

describe("REPRO: dismissing the library-update prompt must not burn its dedupe key", () => {
  it("re-offers the SAME job's suggestions after an Escape/backdrop dismissal", () => {
    const libraryPromptSeenRef = { current: new Set() };
    const api = buildHarness({ libraryPromptSeenRef });

    api.maybeOfferLibraryUpdate(matchPayload, "job-1");
    expect(api.getLibraryPrompt()).not.toBeNull(); // sanity: it showed

    api.dismissLibraryPrompt(); // Escape / backdrop click / "Not now" all route here
    expect(api.getLibraryPrompt()).toBeNull(); // sanity: dialog closed

    // The user made no decision. Re-tailoring the SAME job must be able to
    // offer the SAME suggestions again.
    api.maybeOfferLibraryUpdate(matchPayload, "job-1");
    expect(api.getLibraryPrompt()).not.toBeNull();
  });

  it("dismissing a manual-sourced prompt (no dedupeKey) does not throw and still clears it", () => {
    const libraryPromptSeenRef = { current: new Set() };
    const api = buildHarness({ libraryPromptSeenRef });
    api.__setLibraryPromptForTest({
      promptId: "manual-1",
      jobId: "job-9",
      source: "manual",
      suggestions: { buzzwords: [] },
    });
    expect(() => api.dismissLibraryPrompt()).not.toThrow();
    expect(api.getLibraryPrompt()).toBeNull();
  });
});

describe("PIN: a real decision keeps suppressing the prompt -- the fix must not regress into nagging", () => {
  it("a successful commit keeps the same job suppressed", async () => {
    const libraryPromptSeenRef = { current: new Set() };
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ added: ["kubernetes"] }) });
    const api = buildHarness({ libraryPromptSeenRef, fetchImpl });

    api.maybeOfferLibraryUpdate(matchPayload, "job-2");
    expect(api.getLibraryPrompt()).not.toBeNull();

    const result = await api.commitLibrarySuggestions([{ canonical: "kubernetes", category: "tech_skill" }], {
      retailor: false,
    });
    expect(result.ok).toBe(true);
    expect(api.getLibraryPrompt()).toBeNull();

    // A real decision was made -- re-tailoring must not nag again.
    api.maybeOfferLibraryUpdate(matchPayload, "job-2");
    expect(api.getLibraryPrompt()).toBeNull();
  });
});

describe("REPRO: the edit: fingerprint must not be burned by a failed or empty scan", () => {
  const addedText = "Led the Kubernetes migration end to end across three engineering teams.";

  it("un-marks the fingerprint when the fetch rejects (network failure)", async () => {
    const libraryPromptSeenRef = { current: new Set() };
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const api = buildHarness({ libraryPromptSeenRef, fetchImpl });
    const fingerprint = `edit:job-3:${editFingerprint(addedText)}`;

    await api.handleDocumentEdited({ jobId: "job-3", addedText });

    expect(libraryPromptSeenRef.current.has(fingerprint)).toBe(false);
  });

  it("un-marks the fingerprint when the response is not ok (e.g. signed out)", async () => {
    const libraryPromptSeenRef = { current: new Set() };
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const api = buildHarness({ libraryPromptSeenRef, fetchImpl });
    const fingerprint = `edit:job-4:${editFingerprint(addedText)}`;

    await api.handleDocumentEdited({ jobId: "job-4", addedText });

    expect(libraryPromptSeenRef.current.has(fingerprint)).toBe(false);
  });

  it("un-marks the fingerprint when the scan comes back with nothing new", async () => {
    const libraryPromptSeenRef = { current: new Set() };
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ buzzwords: [] }) });
    const api = buildHarness({ libraryPromptSeenRef, fetchImpl });
    const fingerprint = `edit:job-5:${editFingerprint(addedText)}`;

    await api.handleDocumentEdited({ jobId: "job-5", addedText });

    expect(libraryPromptSeenRef.current.has(fingerprint)).toBe(false);
  });

  it("[pin] does NOT un-mark on success-with-suggestions -- the in-flight guard must survive", async () => {
    const libraryPromptSeenRef = { current: new Set() };
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ buzzwords: [{ canonical: "kubernetes" }] }),
    });
    const api = buildHarness({ libraryPromptSeenRef, fetchImpl });
    const fingerprint = `edit:job-6:${editFingerprint(addedText)}`;

    await api.handleDocumentEdited({ jobId: "job-6", addedText });

    expect(api.getLibraryPrompt()).not.toBeNull();
    expect(libraryPromptSeenRef.current.has(fingerprint)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // A second identical edit while the first is still marked (as a decision,
    // post-fix; as the old show-time guard, pre-fix) must not re-fetch.
    await api.handleDocumentEdited({ jobId: "job-6", addedText });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
