// @vitest-environment jsdom
//
// N89 PART 1 (4b/TDD) -- THE OWNER'S FRESH-SESSION GEMINI COVER LETTER.
//
// THE BUG. A Gemini cover letter is filled from the candidate's UPLOADED
// template client-side; the engine returns NO server-side docx bytes and there
// is no stored docx_path. So on a FRESH in-session tailoring, fact insertion --
// which today assumes engine docx bytes to splice into -- refuses
// `no-engine-bytes` for BOTH the auto path (autoInsertFactsForJob) and the
// manual accept (acceptFacts), even though the uploaded template File is right
// there in session and the letter has lines. Part 1's fix: when there are no
// bytes but the in-session template File is present and the letter has lines,
// route the fact through the SAME planAcceptForEntry/planCoverFacts LINE path
// the byte engines already use and skip only the docx-byte splice; the existing
// rebuild (resolveDocumentBlob -> buildDocxFromUploadedTemplate) then carries
// the fact into the preview and the download.
//
// THREE SHAPES this file distinguishes (design N89.design-structure.r1 §1):
//   A. engine bytes present            -> SPLICE (unchanged; must not regress).
//   B. no bytes + template File present -> LINES  (THE FIX; the owner's case).
//   C. no bytes + no template File      -> REFUSE with today's
//      NO_ENGINE_BYTES_REASON, byte-identical (owner ruling: Part 2 dissolves
//      C by persisting the template; Part 1 leaves it exactly as-is).
//
// THE DISCRIMINATOR IS A NEW HOOK PARAM. Part 1 threads `coverLetterFile` into
// useCompanyResearch (page.js already holds it at :123; the hook does not
// receive it today). `canRebuild = isDocxResume(coverLetterFile)`. So Shape B
// vs Shape C differs ONLY by the File this harness hands the hook -- which is
// exactly what makes every Shape-B assertion RED on HEAD (the hook ignores the
// unknown param today and refuses no-engine-bytes).
//
// PRODUCTION-WIRING NOTE (loop-traps-tests "harness wires differently from
// production"): this harness passes `coverLetterFile` straight into the hook.
// The page.js -> useCompanyResearch hop that must ALSO pass it is a separate,
// silent wiring gap; it is pinned by page.coverLetterFileWiring.test.js, not
// here. Auto-path REACHABILITY (open the preview, the fact arrives on its own)
// is pinned by coverFactLineInsertAutoReach.rc.test.js. This file drives the
// hook functions directly for the finer behaviour (dedupe, placement,
// discriminator, non-regression) that the full mount cannot isolate -- the same
// division the landed autoInsertResolvesSavedCoverDocx.rc.test.js uses.
//
// jsdom notes (measurement-instruments): act() serializes async so what is
// proven is ORDERING, never true concurrency.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import { useCompanyResearch } from "./useCompanyResearch.js";
import { sanitizeStoredFacts } from "@/lib/acceptedFacts/factStore.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";
import { docxFileFromBase64 } from "@/lib/document/docx.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const USER_ID = "user-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };

// The candidate's fresh Gemini letter -- crafted lines so placement (N62) and
// dedupe (N81) can be asserted against exact paragraph indices.
// introIndex() = first line after 0 whose trim length > 40 => line 1.
// PLACEMENTS "current" anchor (/in my current role/i) => line 2. Distinct.
const LINES = [
  "Dear Hiring Manager,",
  "I am excited to apply for the Staff Engineer position at Acme and its ambitious mission.",
  "In my current role at Globex I lead a platform team building large telemetry systems.",
  "Thank you very much for considering my application.",
];
const INTRO_LINE = 1;
const CURRENT_LINE = 2;

// A researched article with a real, openable, non-redirect url (passes the
// auto-select predicate `articleUrlKey`) and a distinctive suggestion that is
// NOT a substring of any base line or of the other fact (loop-tdd fixture trap).
const FACT_X = {
  id: "art-x",
  title: "Acme opens a Dublin telemetry lab",
  url: "https://news.example.com/acme/dublin-lab",
  source: "news.example.com",
  summary: "Acme opened a telemetry lab in Dublin.",
  suggestion: "I admire the Dublin telemetry lab that opened this year.",
};
const FACT_Y = {
  id: "art-y",
  title: "Acme launches a mentorship program",
  url: "https://news.example.com/acme/mentorship",
  source: "news.example.com",
  summary: "Acme launched a mentorship program.",
  suggestion: "The new mentorship program stood out during my research.",
};
// A keyless article: real url + title but NO suggestion -- the eligibility
// filter must still drop it (auto-select predicate unchanged by the widening).
const FACT_KEYLESS = { id: "art-k", title: "Acme profiled", url: "https://press.example.org/acme", source: "press.example.org", summary: "A profile.", suggestion: "" };

// The EXACT residual refusal message on HEAD (useCompanyResearch.js:21-23).
// Inlined, not imported (the constant is not exported): this PINS that Part 1
// leaves it byte-identical for Shape C -- the owner ruling superseded AC-8's
// message flip, so a change here would be a regression, and this string going
// stale is itself the signal.
const NO_ENGINE_BYTES_REASON =
  "We can't add this to your cover letter right now because its saved file is missing. " +
  "Regenerate the cover letter in this session, then try again.";

let ENGINE_B64 = "";
let ENGINE_LINES = [];
let TEMPLATE_FILE = null;

beforeAll(async () => {
  const cl = await embeddedEngine.tailorCoverLetter({
    jobPosting: "Staff Engineer at Acme. React, Node, telemetry, accessibility.",
    jobTitle: "Staff Engineer",
    companyName: "Acme",
  });
  ENGINE_B64 = cl.docxB64;
  ENGINE_LINES = cl.resultLines;
});

let storageObjects = {};
let uploads = [];
let putBodies = [];
let store = { facts: [], removed: [], revision: null };
let researchArticles = [];
let probe = null;
let container = null;
let root = null;

function makeSupabase() {
  return {
    storage: {
      from: () => ({
        download: async (path) => {
          const b = storageObjects[path];
          return b ? { data: new Blob([b]), error: null } : { data: null, error: { message: "not found" } };
        },
        upload: async (path, bytes, opts) => {
          const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
          uploads.push({ path, bytes: arr, opts });
          storageObjects[path] = arr;
          return { error: null };
        },
      }),
    },
  };
}

function json(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

// coverLetterFile is a PROP so a test can flip only the discriminator (AC-9).
// A fresh docx File per mount avoids a consumed-stream hazard across renders.
function HookProbe({ initialMap, coverLetterFile = null, defaultPlacement = undefined }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const research = useCompanyResearch({
    tailoringMap,
    setTailoringMap,
    setPreviewReloadKey,
    defaultPlacement,
    supabase: makeSupabase(),
    currentUser: { id: USER_ID },
    // NEW param (P1-1). Ignored by HEAD => Shape B refuses => RED.
    coverLetterFile,
  });
  probe = { tailoringMap, setTailoringMap, research, previewReloadKey };
  return null;
}

// Shape B / C entry: cover TEXT but no bytes and no resolvable path. Whether it
// is B or C is decided by the coverLetterFile the HookProbe is given.
function geminiEntry(over = {}) {
  return {
    status: "done",
    result: "",
    resultLines: [],
    docxB64: "",
    docxPath: "",
    coverLetterResultLines: [...LINES],
    coverLetterDocxB64: "",
    coverLetterDocxPath: "",
    coverVersionId: "c1",
    ...over,
  };
}

// Shape A entry: real in-session engine bytes present (a byte engine, or an
// already-persisted splice). Uses the engine's OWN lines so the byte splice's
// stale-plan guard (the edit's `before` must be a paragraph of the engine doc)
// applies -- a custom-lines/engine-bytes mismatch would make the splice refuse,
// which is a fixture error, not the behaviour AC-5 pins. Must keep splicing.
function byteEntry(over = {}) {
  return geminiEntry({ coverLetterDocxB64: ENGINE_B64, coverLetterResultLines: [...ENGINE_LINES], ...over });
}

beforeEach(() => {
  storageObjects = {};
  uploads = [];
  putBodies = [];
  store = { facts: [], removed: [], revision: null };
  researchArticles = [];
  probe = null;
  TEMPLATE_FILE = docxFileFromBase64(ENGINE_B64); // a real .docx File (isDocxResume === true)
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const u = String(url);
    if (u.includes("/api/company-research")) return json({ articles: researchArticles, warnings: [] });
    if (u.includes("/api/accepted-facts")) {
      if (method === "GET") return json({ facts: store.facts, removed: store.removed, revision: store.revision });
      const body = JSON.parse(init.body);
      putBodies.push(body);
      store = {
        facts: sanitizeStoredFacts(body.facts),
        removed: Array.isArray(body.declinedUrls) ? body.declinedUrls : [],
        revision: (store.revision ?? 0) + 1,
      };
      return json({ facts: store.facts, removed: store.removed, revision: store.revision, versionSaved: !!body.coverVersion });
    }
    return json({});
  });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  if (container) container.remove();
  root = null;
  container = null;
  delete globalThis.fetch;
});

async function flush(times = 8) {
  for (let i = 0; i < times; i += 1) await act(async () => { await Promise.resolve(); });
}
async function drain(steps = 24) {
  for (let n = 0; n < steps; n += 1) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
}
async function mount(initialMap, opts = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(createElement(HookProbe, { initialMap, ...opts })); });
  await flush();
}
async function seedResearch(articles) {
  researchArticles = articles;
  await act(async () => { probe.research.openCompanyResearch(JOB); });
  await flush();
}
function coverLines() {
  return probe.tailoringMap[JOB_ID]?.coverLetterResultLines || [];
}
function occurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

// ===========================================================================
// AC-1 -- auto-insert on a FRESH Gemini letter INSERTS, it does not refuse.
// ===========================================================================
describe("AC-1: auto-insert into a fresh Gemini letter (no bytes, template File present)", () => {
  it("resolves {ok:true, count>=1}, inserts the fact into the lines, and does NOT refuse no-engine-bytes", async () => {
    await mount({ [JOB_ID]: geminiEntry() }, { coverLetterFile: TEMPLATE_FILE });
    await seedResearch([FACT_X]);

    let result;
    await act(async () => { result = await probe.research.autoInsertFactsForJob(JOB_ID, () => true); });
    await drain();

    // RED on HEAD: the hook ignores coverLetterFile and refuses at :731-732.
    expect(result.code, `auto-insert refused a fresh Gemini letter: ${result.reason || ""}`).not.toBe("no-engine-bytes");
    expect(result.ok, `auto-insert did not succeed on a fresh Gemini letter: ${result.reason || ""}`).toBe(true);
    expect(result.count).toBeGreaterThanOrEqual(1);
    expect(coverLines().join("\n")).toContain(FACT_X.suggestion);

    // Strategy is LINES not SPLICE: no bytes were spliced, so NOTHING was
    // uploaded and no docx bytes were written onto the entry. This is the
    // mutually-exclusive half of AC-5 seen from the Shape-B side; a mutant that
    // still spliced/uploaded here (or that wrote coverLetterDocxB64) fails.
    expect(uploads, "Shape B must not upload a spliced document (there are no bytes to splice)").toHaveLength(0);
    expect(probe.tailoringMap[JOB_ID].coverLetterDocxB64 || "").toBe("");
  });

  it("HAZARD (plan P1-2): the auto path completes without throwing (spliced/coverDocxPath must be fn-scoped)", async () => {
    // If the splice vars stay block-scoped, Shape B dereferences null in
    // setTailoringMap. A throw would surface as a rejected result / no insert.
    await mount({ [JOB_ID]: geminiEntry() }, { coverLetterFile: TEMPLATE_FILE });
    await seedResearch([FACT_X]);
    let error = null;
    let result;
    await act(async () => {
      try { result = await probe.research.autoInsertFactsForJob(JOB_ID, () => true); }
      catch (e) { error = e; }
    });
    await drain();
    expect(error, `auto-insert threw for Shape B: ${error && error.message}`).toBeNull();
    expect(result && result.ok, "auto-insert did not resolve ok for Shape B").toBe(true);
  });

  it("FAILURE DIRECTION (R-3): a keyless (ineligible) article is NOT inserted even after the byte gate widens", async () => {
    // The widening touches ONLY the byte gate; the auto-select eligibility
    // predicate (real url + suggestion text) must be unchanged. With a fresh
    // Gemini letter + a keyless article, the run must reach eligibility and
    // report nothing-eligible -- never insert, never still say no-engine-bytes.
    await mount({ [JOB_ID]: geminiEntry() }, { coverLetterFile: TEMPLATE_FILE });
    await seedResearch([FACT_KEYLESS]);
    let result;
    await act(async () => { result = await probe.research.autoInsertFactsForJob(JOB_ID, () => true); });
    await drain();

    expect(result.ok).toBe(false);
    // RED on HEAD: on HEAD this refuses no-engine-bytes BEFORE ever reaching
    // eligibility, so it never proves the eligibility gate still bites.
    expect(result.code, "the widened path must reach the eligibility gate, not the byte gate").toBe("nothing-eligible");
    expect(coverLines().join("\n")).not.toContain(FACT_KEYLESS.title);
    expect(putBodies, "an ineligible article was persisted").toHaveLength(0);
  });
});

// ===========================================================================
// AC-4 -- manual accept reaches the same success, shows an honest notice, and
// refreshes the preview (P1-3: acceptFacts must now bump the reload key).
// ===========================================================================
describe("AC-4: manual accept into a fresh Gemini letter", () => {
  it("resolves {ok:true}, inserts, shows a rebuild-from-template notice (not the refusal), and bumps the reload key", async () => {
    await mount({ [JOB_ID]: geminiEntry() }, { coverLetterFile: TEMPLATE_FILE });
    await seedResearch([]); // opens the dialog / seeds jobId + accepted-facts
    const reloadBefore = probe.previewReloadKey;

    let result;
    await act(async () => {
      result = await probe.research.acceptFacts({
        facts: [{ id: FACT_X.id, text: FACT_X.suggestion, url: FACT_X.url, title: FACT_X.title, placement: "intro" }],
        declinedUrls: [],
      });
    });
    await flush();

    // RED on HEAD: acceptFacts refuses at :430-432 with NO_ENGINE_BYTES_REASON.
    expect(result.ok, `manual accept did not succeed on a fresh Gemini letter: ${result.reason || ""}`).toBe(true);
    expect(result.reason).not.toBe(NO_ENGINE_BYTES_REASON);
    expect(coverLines().join("\n")).toContain(FACT_X.suggestion);

    // An honest success notice -- non-empty, no error, and semantically the
    // "rebuilt from your uploaded template" message (LINE_REBUILD_NOTICE),
    // never the byte-splice notices. Keyed on meaning (rebuild + template), not
    // an exact literal, so it pins the promise the plan specified without
    // brittle-coupling the copy.
    expect(probe.research.companyResearch.acceptError, "manual Shape-B accept set an error").toBe("");
    const notice = probe.research.companyResearch.acceptNotice;
    expect(notice, "manual Shape-B accept showed no success notice (silent)").toBeTruthy();
    expect(notice).not.toBe(NO_ENGINE_BYTES_REASON);
    expect(notice).toMatch(/rebuild/i);
    expect(notice).toMatch(/template/i);

    // The preview beneath the dialog must repaint (P1-3): acceptFacts never
    // bumped the reload key on HEAD. Second half of RED on HEAD.
    expect(probe.previewReloadKey, "manual accept did not bump the preview reload key").toBeGreaterThan(reloadBefore);

    // Strategy LINES, not SPLICE: no upload, no bytes written.
    expect(uploads, "manual Shape-B accept uploaded a spliced document").toHaveLength(0);
    expect(probe.tailoringMap[JOB_ID].coverLetterDocxB64 || "").toBe("");
  });
});

// ===========================================================================
// AC-6 -- N81 id+presence dedupe carries through the LINE path, proving the fix
// routes through planAcceptForEntry/planCoverFacts rather than a hand-rolled
// line inserter. TWO rows can fail: the dedupe of the repeat, and the admission
// of a genuinely distinct fact.
// ===========================================================================
describe("AC-6: N81 dedupe holds on the Shape-B line path", () => {
  it("a repeated fact inserts once; a distinct fact still inserts", async () => {
    await mount({ [JOB_ID]: geminiEntry() }, { coverLetterFile: TEMPLATE_FILE });
    await seedResearch([]);

    async function accept(fact) {
      let r;
      await act(async () => {
        r = await probe.research.acceptFacts({
          facts: [{ id: fact.id, text: fact.suggestion, url: fact.url, title: fact.title, placement: "intro" }],
          declinedUrls: [],
        });
      });
      await flush();
      return r;
    }

    const first = await accept(FACT_X);
    // RED on HEAD: the first accept refuses (Shape B), so X never enters the
    // letter and the dedupe below can never be reached -- occurrence count is 0.
    expect(first.ok, `first accept refused: ${first.reason || ""}`).toBe(true);
    expect(occurrences(coverLines().join("\n"), FACT_X.suggestion), "fact X was not inserted on the first accept").toBe(1);

    // Row 1: re-accepting the SAME fact must NOT duplicate it (N81 id+presence).
    const second = await accept(FACT_X);
    expect(second.ok, "re-accept of the same fact should still resolve ok").toBe(true);
    expect(occurrences(coverLines().join("\n"), FACT_X.suggestion), "the repeated fact was inserted a second time -- dedupe bypassed").toBe(1);

    // Row 2: a genuinely distinct fact IS admitted.
    const third = await accept(FACT_Y);
    expect(third.ok, `distinct fact Y was refused: ${third.reason || ""}`).toBe(true);
    expect(occurrences(coverLines().join("\n"), FACT_Y.suggestion), "a distinct fact was not inserted").toBe(1);
  });
});

// ===========================================================================
// AC-7 -- N62 placement ("Let the app decide") is honored on the line path.
// The auto path places each fact at the saved defaultPlacement, resolved by the
// same planCoverFacts -- not hard-coded to intro/paragraph-end.
// ===========================================================================
describe("AC-7: placement is honored on the Shape-B line path", () => {
  it("a saved non-default placement lands the fact in the anchored paragraph, not the intro", async () => {
    // defaultPlacement "current" anchors on /in my current role/i (line 2);
    // the intro fallback would be line 1. A hard-coded-intro line path fails.
    await mount({ [JOB_ID]: geminiEntry() }, { coverLetterFile: TEMPLATE_FILE, defaultPlacement: "current" });
    await seedResearch([FACT_X]);

    let result;
    await act(async () => { result = await probe.research.autoInsertFactsForJob(JOB_ID, () => true); });
    await drain();

    expect(result.ok, `auto-insert refused: ${result.reason || ""}`).toBe(true);
    const lines = coverLines();
    // RED on HEAD: no insert happens, so line 2 never gains the fact.
    expect(lines[CURRENT_LINE], "the fact did not land in the anchored 'current role' paragraph").toContain(FACT_X.suggestion);
    expect(lines[INTRO_LINE], "the fact was hard-coded into the intro paragraph, ignoring the saved placement").not.toContain(FACT_X.suggestion);
  });
});

// ===========================================================================
// AC-8 / RESIDUAL (Shape C) -- owner ruling: leave EXACTLY as today. no bytes,
// no path, and NO in-session template File => refuse with the byte-identical
// NO_ENGINE_BYTES_REASON, no write, no line change. This is GREEN on HEAD and
// must STAY green -- it is the boundary control: a build that always inserts, or
// that changes the residual message, fails here.
// ===========================================================================
describe("AC-8/residual (Shape C): no bytes + no template File still refuses honestly, unchanged", () => {
  it("auto path refuses no-engine-bytes with the exact HEAD message and writes nothing", async () => {
    await mount({ [JOB_ID]: geminiEntry() }, { coverLetterFile: null });
    await seedResearch([FACT_X]);
    let result;
    await act(async () => { result = await probe.research.autoInsertFactsForJob(JOB_ID, () => true); });
    await drain();

    expect(result.ok).toBe(false);
    expect(result.code).toBe("no-engine-bytes");
    expect(result.reason).toBe(NO_ENGINE_BYTES_REASON);
    expect(coverLines().join("\n")).not.toContain(FACT_X.suggestion);
    expect(putBodies).toHaveLength(0);
  });

  it("manual accept refuses with the exact HEAD message and writes nothing", async () => {
    await mount({ [JOB_ID]: geminiEntry() }, { coverLetterFile: null });
    await seedResearch([]);
    let result;
    await act(async () => {
      result = await probe.research.acceptFacts({
        facts: [{ id: FACT_X.id, text: FACT_X.suggestion, url: FACT_X.url, title: FACT_X.title, placement: "intro" }],
        declinedUrls: [],
      });
    });
    await flush();

    expect(result.ok).toBe(false);
    expect(result.reason).toBe(NO_ENGINE_BYTES_REASON);
    expect(probe.research.companyResearch.acceptError).toBe(NO_ENGINE_BYTES_REASON);
    expect(coverLines().join("\n")).not.toContain(FACT_X.suggestion);
    expect(putBodies).toHaveLength(0);
  });
});

// ===========================================================================
// AC-9 -- the discriminator IS the in-session template File, and it must be a
// .docx (canRebuild = isDocxResume, not mere presence).
// ===========================================================================
describe("AC-9: the template File is the B/C discriminator", () => {
  it("the SAME entry succeeds with a .docx template File and refuses without one", async () => {
    // With a File:
    await mount({ [JOB_ID]: geminiEntry() }, { coverLetterFile: TEMPLATE_FILE });
    await seedResearch([FACT_X]);
    let withFile;
    await act(async () => { withFile = await probe.research.autoInsertFactsForJob(JOB_ID, () => true); });
    await drain();
    expect(withFile.ok, "identical entry refused WITH a template File present").toBe(true);

    if (root) await act(async () => root.unmount());
    root = null;
    if (container) container.remove();
    container = null;
    uploads = [];
    putBodies = [];
    store = { facts: [], removed: [], revision: null };

    // Without a File (only difference):
    await mount({ [JOB_ID]: geminiEntry() }, { coverLetterFile: null });
    await seedResearch([FACT_X]);
    let withoutFile;
    await act(async () => { withoutFile = await probe.research.autoInsertFactsForJob(JOB_ID, () => true); });
    await drain();
    expect(withoutFile.ok, "identical entry succeeded WITHOUT a template File").toBe(false);
    expect(withoutFile.code).toBe("no-engine-bytes");
  });

  it("a non-.docx File is NOT a rebuildable template (canRebuild uses isDocxResume, not truthiness)", async () => {
    const txtFile = new File(["not a docx"], "notes.txt", { type: "text/plain" });
    await mount({ [JOB_ID]: geminiEntry() }, { coverLetterFile: txtFile });
    await seedResearch([FACT_X]);
    let result;
    await act(async () => { result = await probe.research.autoInsertFactsForJob(JOB_ID, () => true); });
    await drain();
    // A mutant using `canRebuild = !!coverLetterFile` would insert here.
    expect(result.ok, "a non-docx File was wrongly treated as a rebuildable template").toBe(false);
    expect(result.code).toBe("no-engine-bytes");
    expect(coverLines().join("\n")).not.toContain(FACT_X.suggestion);
  });
});

// ===========================================================================
// AC-5 (NON-REGRESSION, GREEN on HEAD) -- when engine bytes resolve, the SPLICE
// path is still taken (upload happens, coverLetterDocxB64 is set), never the
// line-only fallback. Guards the fix from cannibalising the working byte path.
// ===========================================================================
describe("AC-5: bytes present => splice, not the line fallback (must not regress)", () => {
  it("manual accept with in-session bytes splices and sets coverLetterDocxB64", async () => {
    await mount({ [JOB_ID]: byteEntry() }, { coverLetterFile: TEMPLATE_FILE });
    await seedResearch([]);
    let result;
    await act(async () => {
      result = await probe.research.acceptFacts({
        facts: [{ id: FACT_X.id, text: FACT_X.suggestion, url: FACT_X.url, title: FACT_X.title, placement: "intro" }],
        declinedUrls: [],
      });
    });
    await flush();

    expect(result.ok).toBe(true);
    expect(coverLines().join("\n")).toContain(FACT_X.suggestion);
    // The splice ran: a spliced document was uploaded and the bytes changed.
    expect(uploads.length, "a bytes-present accept did NOT splice/upload -- dropped to the line fallback").toBeGreaterThan(0);
    const b64 = probe.tailoringMap[JOB_ID].coverLetterDocxB64 || "";
    expect(b64.length).toBeGreaterThan(0);
    expect(b64, "coverLetterDocxB64 was not updated by the splice").not.toBe(ENGINE_B64);
  });

  it("auto path with in-session bytes splices and uploads", async () => {
    await mount({ [JOB_ID]: byteEntry() }, { coverLetterFile: TEMPLATE_FILE });
    await seedResearch([FACT_X]);
    await act(async () => { await probe.research.autoInsertFactsForJob(JOB_ID, () => true); });
    await drain();

    expect(coverLines().join("\n")).toContain(FACT_X.suggestion);
    expect(uploads.length, "a bytes-present auto-insert did NOT splice/upload").toBeGreaterThan(0);
    expect((probe.tailoringMap[JOB_ID].coverLetterDocxB64 || "").length).toBeGreaterThan(0);
  });
});
