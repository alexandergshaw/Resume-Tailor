// @vitest-environment jsdom
//
// N61 (LIVE DEFECT on main @7776915) -- CHAINED removal from a COALESCED
// paragraph, reached the way a candidate reaches it: mount the REAL
// DocumentPreviewMount (rendering the REAL DocumentPreviewDialog + the REAL
// InsertedFactsStrip), insert facts through the REAL accept path, then click the
// REAL one-click Remove control repeatedly. removeInsertedFact is NEVER called
// directly -- reachability is the property under test (loop-tdd rule 2/5).
//
// THE BUG (app/hooks/useCompanyResearch.js:498/513/521): every researched
// article defaults to the "intro" placement, so two or three accepted facts
// COALESCE onto ONE paragraph. removeInsertedFact computes survivors as
// `insertedFacts.filter(r => r.id !== factId)` and writes them straight back
// WITHOUT recomputing their character offsets against the now-shorter line. So
// after removing any fact except the LAST one on that line, every later
// same-line survivor carries a STALE offset:
//   * planRemoveFact(survivor) finds `before.slice(staleOffset,...) !== text`
//     and no-ops {changed:false} -> the survivor becomes UNREMOVABLE;
//   * markInsertedFacts with the stale offset matches nothing -> the survivor
//     is UNHIGHLIGHTED while still in the letter.
// An unremovable, unhighlightable claim reaching an employer.
//
// The verifier's strand.mjs measured exactly this: composed line
//   "...small team. Acme opened a Dublin lab. It raised forty million."
// record [{a@34},{b@60}]; remove a -> b now at 34 but its record still says 60;
// remove b -> {ok:false}; b permanently stuck; highlight marks 2 -> 0.
//
// WHY THE EXISTING TESTS MISSED IT (so this file does not repeat it):
//   * removeInsertedFact.rc.test.js inserts ONE fact and clicks Remove once.
//   * factRemoval.test.js's coalesced case removes A or B from a FRESHLY
//     computed record (correct offsets), never CHAINS a second removal off the
//     STORED record the hook actually writes back.
//
// jsdom note: MUI's Dialog portals into document.body, so every DOM query goes
// through `document`.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import { useCompanyResearch } from "./useCompanyResearch.js";
import { useDocumentPreview } from "./useDocumentPreview.js";
import DocumentPreviewMount from "@/app/components/DocumentPreviewMount.js";
import { sanitizeStoredFacts } from "@/lib/acceptedFacts/factStore.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";
import { renderModelToHtml } from "@/lib/document/docxPreview.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };

// THREE facts, all default ("intro") placement -> all coalesce onto the intro
// paragraph after its first sentence (position "after-first-sentence"), so there
// is candidate prose on BOTH sides of the inserted run (non-degenerate: not an
// end-of-paragraph append with nothing after it).
//
// FIXTURE NON-DEGENERACY (loop-tdd, the "reconstructing fixture" trap): the
// three texts are distinct full sentences and NONE is a substring of another, so
// a removal that cut the wrong span cannot coincidentally reconstruct a
// survivor, and a highlight cannot match a survivor at the wrong fact's offset.
// Distinct urls too, so identity is never ambiguous by url.
const FA = { id: "art-a", text: "Acme just opened a Dublin telemetry lab.", url: "https://news.example.com/acme/dublin", title: "Dublin lab", placement: "intro" };
const FB = { id: "art-b", text: "The firm doubled its research headcount last year.", url: "https://news.example.com/acme/headcount", title: "Headcount", placement: "intro" };
const FC = { id: "art-c", text: "Its platform now serves nine million active users.", url: "https://news.example.com/acme/platform", title: "Platform", placement: "intro" };

let ENGINE_B64 = "";
let ENGINE_LINES = [];

beforeAll(async () => {
  const cl = await embeddedEngine.tailorCoverLetter({
    jobPosting: "Staff Engineer at Acme. React, Node, telemetry, accessibility.",
    jobTitle: "Staff Engineer",
    companyName: "Acme",
  });
  ENGINE_B64 = cl.docxB64;
  ENGINE_LINES = cl.resultLines;
});

let store = { facts: [], removed: [], revision: null };
let putBodies = [];
let probe = null;
let container = null;
let root = null;

function json(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function entryWithEngineLetter(overrides = {}) {
  return {
    status: "done",
    result: "",
    resultLines: [],
    docxB64: "",
    docxPath: "",
    coverLetterResultLines: [...ENGINE_LINES],
    coverLetterDocxB64: ENGINE_B64,
    coverVersionId: "ver-1",
    ...overrides,
  };
}

function Probe({ initialMap }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const research = useCompanyResearch({ tailoringMap, setTailoringMap, setPreviewReloadKey });
  const preview = useDocumentPreview({
    tailoringMap,
    setTailoringMap,
    updateTailoringJob: () => {},
    resumeFile: null,
    coverLetterFile: null,
    additionalContext: "",
    aggressiveness: 50,
    contextFiles: [],
    downloadDocxFiles: {},
    startBackgroundResearch: research.startBackgroundResearch,
    setPreviewReloadKey,
    onDocumentEdited: () => {},
    currentUser: null,
    onCheckDuplicate: () => {},
  });
  probe = { tailoringMap, setTailoringMap, research, preview };
  return createElement(DocumentPreviewMount, {
    preview,
    tailoringMap,
    research,
    chat: { askAiAbout: () => {} },
    tailorEngine: "embedded",
    previewReloadKey,
    scrapePreviewPosting: null,
    currentUser: null,
    resumeFile: null,
    coverLetterFile: null,
  });
}

beforeEach(() => {
  store = { facts: [], removed: [], revision: null };
  putBodies = [];
  probe = null;
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const u = String(url);
    if (u.includes("/api/company-research")) return json({ articles: [], warnings: [] });
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

async function flush(times = 6) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mount(initialMap) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Probe, { initialMap }));
  });
  await flush();
}

async function openCoverPreview() {
  await act(async () => {
    probe.preview.openResumePreview(JOB, { tab: "cover" });
  });
  await flush();
}

// Insert the given facts through the REAL accept path in ONE click, so they
// coalesce (planCoverFacts groups all same-line facts into a single edit).
async function insertFactsViaAccept(facts) {
  await act(async () => {
    probe.research.openCompanyResearch(JOB);
  });
  await flush();
  await act(async () => {
    await probe.research.acceptFacts({ facts, declinedUrls: [] });
  });
  await flush();
}

function removeButtons() {
  return [...document.querySelectorAll('[aria-label="Remove this fact"]')];
}

// Click the Remove control at strip position `i` the way a candidate does, then
// wait for the render to settle. The removal awaits a real docx (de)serialize on
// the bytes path, so microtask flushes are not enough -- advance real time until
// the strip's row count stops changing (or the timeout elapses, e.g. when the
// click is a silent no-op, exactly the buggy case). We deliberately do NOT
// require the count to drop: whether the click actually removed anything is what
// the assertions decide, not the helper.
async function clickRemoveAt(i = 0) {
  await flush();
  const before = removeButtons().length;
  await act(async () => {
    removeButtons()[i].click();
  });
  for (let n = 0; n < 25; n += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    if (removeButtons().length !== before) break;
  }
  await flush();
}

function coverLines() {
  return probe.tailoringMap[JOB_ID]?.coverLetterResultLines || [];
}
function storedRecord() {
  return probe.tailoringMap[JOB_ID]?.insertedFacts || [];
}
function coalescedLine() {
  // The single paragraph the three intro facts landed on.
  return coverLines().find((l) => l.includes(FA.text) || l.includes(FB.text) || l.includes(FC.text)) || "";
}
function readabilitySeam(line) {
  return /\s{2,}|\s[.,;:!?]|^\s|\s$/.test(String(line));
}
function anySeam() {
  return coverLines().some((l) => readabilitySeam(l));
}

// The production highlight computation, driven through the REAL loadPreviewModel
// the dialog itself uses (buildPreviewBlob -> parseDocxToModel ->
// markInsertedFacts(model, entry.insertedFacts)). We count marks off the STORED
// record the removal wrote back, not a freshly recomputed one -- that is the
// record production highlights from (useDocumentPreview.js:422).
async function factMarkCount() {
  const model = await probe.preview.loadPreviewModel("cover", { factHighlight: true });
  const html = renderModelToHtml(model);
  return { count: (html.match(/data-fact="1"/g) || []).length, html };
}

describe("instrument sanity (canaries)", () => {
  it("the readability-seam detector bites malformed prose and clears clean prose", () => {
    expect(readabilitySeam("A team.  Beyond that .")).toBe(true); // doubled space + space-before-punct
    expect(readabilitySeam(" leading")).toBe(true);
    expect(readabilitySeam("A perfectly ordinary sentence about work.")).toBe(false);
  });
  it("the three fixture facts are mutually non-substring (no accidental reconstruction)", () => {
    const t = [FA.text, FB.text, FC.text];
    for (let i = 0; i < t.length; i += 1) {
      for (let j = 0; j < t.length; j += 1) {
        if (i === j) continue;
        expect(t[i].includes(t[j]), `${t[i]} contains ${t[j]}`).toBe(false);
      }
    }
  });
});

describe("N61 blocker: chained removal from a coalesced paragraph (AC-N61.14/.16)", () => {
  it("FIXTURE really coalesces: three intro facts land on ONE paragraph with prose on both sides", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    await insertFactsViaAccept([FA, FB, FC]);

    const line = coalescedLine();
    // all three on the SAME line -> genuinely coalesced (else this whole file
    // would be testing three independent single-fact removals, and vacuous).
    expect(line, "fact A not on the coalesced line").toContain(FA.text);
    expect(line, "fact B not on the coalesced line").toContain(FB.text);
    expect(line, "fact C not on the coalesced line").toContain(FC.text);
    // exactly one line carries them (one coalesced edit, not three lines).
    const carrying = coverLines().filter((l) => l.includes(FA.text) || l.includes(FB.text) || l.includes(FC.text));
    expect(carrying.length, "the facts spread across multiple lines -- not coalesced").toBe(1);
    // prose on BOTH sides of the inserted run (after-first-sentence placement).
    const firstAt = Math.min(line.indexOf(FA.text), line.indexOf(FB.text), line.indexOf(FC.text));
    const lastFact = [FA, FB, FC].map((f) => line.indexOf(f.text) + f.text.length).reduce((a, b) => Math.max(a, b), 0);
    expect(firstAt, "no candidate prose before the inserted run").toBeGreaterThan(0);
    expect(lastFact, "no candidate prose after the inserted run").toBeLessThan(line.length);
    // three removable rows, one per fact.
    expect(removeButtons().length).toBe(3);
  });

  it("remove FIRST then the next survivor: BOTH leave, the third stays intact (front-to-back)", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    await insertFactsViaAccept([FA, FB, FC]);
    expect(removeButtons().length, "facts never inserted -- test would be vacuous").toBe(3);
    window.confirm = () => {
      throw new Error("removal must not open a confirmation dialog");
    };

    // Remove the FIRST row (FA, lowest offset). This one succeeds even on HEAD.
    await clickRemoveAt(0);
    expect(coalescedLine(), "FA was not removed by the first click").not.toContain(FA.text);
    expect(coalescedLine(), "FB vanished when only FA was removed").toContain(FB.text);
    expect(coalescedLine(), "FC vanished when only FA was removed").toContain(FC.text);
    // NON-VACUITY for the second click: two rows remain and are clickable.
    expect(removeButtons().length, "second Remove control not reachable -- chain would be vacuous").toBe(2);

    // Remove the NEW first row (FB). On HEAD its STORED offset is stale (FA's
    // removal shifted it left) -> planRemoveFact no-ops -> FB is stuck. RED.
    await clickRemoveAt(0);
    expect(coalescedLine(), "FB is STILL in the download-rebuild source -- unremovable stranded fact").not.toContain(FB.text);
    expect(coalescedLine(), "FC vanished when FB was removed").toContain(FC.text);
    expect(removeButtons().length, "FB's row did not leave the strip").toBe(1);

    // And the last one removes cleanly, leaving a readable letter.
    await clickRemoveAt(0);
    expect(coalescedLine(), "FC could not be removed").not.toContain(FC.text);
    expect(removeButtons().length).toBe(0);
    expect(anySeam(), "removal left a readability seam in the paragraph").toBe(false);
  });

  it("remove MIDDLE then LAST: both leave (a different order, a different stranded survivor)", async () => {
    // Removing the middle fact strands the LAST one (a DIFFERENT survivor than
    // the front-to-back case above) -- the bug is order-dependent, so more than
    // one order is pinned (loop-tdd rule 12: prove the guard over the class, not
    // one instance).
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    await insertFactsViaAccept([FA, FB, FC]);
    expect(removeButtons().length).toBe(3);

    // Remove the MIDDLE row (FB). Succeeds on HEAD (its offset is still correct
    // before anything shifts), and strands FC (later on the line).
    await clickRemoveAt(1);
    expect(coalescedLine()).not.toContain(FB.text);
    expect(coalescedLine(), "FA vanished when FB was removed").toContain(FA.text);
    expect(coalescedLine(), "FC vanished when FB was removed").toContain(FC.text);
    expect(removeButtons().length, "next Remove control not reachable").toBe(2);

    // Now remove FC (the LAST fact, now the second remaining row). On HEAD its
    // stored offset is stale from FB's removal -> no-op -> stuck. RED.
    await clickRemoveAt(1);
    expect(coalescedLine(), "FC is STILL in the download-rebuild source -- stranded by the middle removal").not.toContain(FC.text);
    expect(coalescedLine(), "FA vanished when FC was removed").toContain(FA.text);
    expect(removeButtons().length).toBe(1);
    expect(anySeam()).toBe(false);
  });

  it("CONTROL (green on HEAD): back-to-front removal never strands, so all three leave", async () => {
    // Removing from the LAST fact backward means no survivor is ever shifted
    // before its own removal -- the mechanism works in this order. This control
    // proves the render-and-click harness, the accept path and the removal
    // wiring are all sound, so the RED cases above fail for the stated
    // order-dependent reason and NOT because the harness is broken.
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    await insertFactsViaAccept([FA, FB, FC]);
    expect(removeButtons().length).toBe(3);

    await clickRemoveAt(2); // FC (last)
    expect(coalescedLine()).not.toContain(FC.text);
    expect(removeButtons().length).toBe(2);
    await clickRemoveAt(1); // FB
    expect(coalescedLine()).not.toContain(FB.text);
    expect(removeButtons().length).toBe(1);
    await clickRemoveAt(0); // FA
    expect(coalescedLine()).not.toContain(FA.text);
    expect(removeButtons().length).toBe(0);
    expect(anySeam()).toBe(false);
  });
});

describe("N61 blocker: highlight after removal, from the STORED record (AC-N61.13)", () => {
  it("CONTROL: before any removal, all three coalesced facts are highlighted", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    await insertFactsViaAccept([FA, FB, FC]);
    const { count, html } = await factMarkCount();
    // The instrument fires: three located facts -> three marks. (If this were 0
    // the drop-to-0 assertion below would be vacuous.)
    expect(count, "highlight instrument never fired -- the drop test would be vacuous").toBe(3);
    for (const f of [FA, FB, FC]) {
      expect(html.includes(`${f.text}</mark>`), `fact not highlighted pre-removal: ${f.text}`).toBe(true);
    }
  });

  it("after removing ONE coalesced fact, every SURVIVOR is still highlighted", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    await insertFactsViaAccept([FA, FB, FC]);

    await clickRemoveAt(0); // remove FA; FB and FC survive (with stale offsets on HEAD)

    const survivors = storedRecord();
    // sanity: exactly the two survivors are still stored.
    expect(survivors.map((r) => r.id).sort()).toEqual([FB.id, FC.id].sort());

    const { count, html } = await factMarkCount();
    // Production marks from the STORED record. On HEAD both survivors carry
    // stale offsets, so markInsertedFacts matches neither -> marks drop to 0
    // (the verifier measured 2 -> 0). Every survivor must stay marked.
    expect(count, "surviving facts lost their highlight after a sibling was removed").toBe(2);
    expect(html.includes(`${FB.text}</mark>`), "survivor FB is unhighlighted while still in the letter").toBe(true);
    expect(html.includes(`${FC.text}</mark>`), "survivor FC is unhighlighted while still in the letter").toBe(true);
  });
});

describe("N61 regression guard: the survivor-offset class invariant (AC-N61.16)", () => {
  // The invariant a future change must never break: after ANY single removal
  // from a coalesced line, EVERY surviving stored record's offset must locate
  // its OWN text in the resulting line. Asserted over the whole survivor class
  // (both remaining facts), not the one that happened to break -- and proved to
  // bite a survivor OTHER than the removed fact.
  function assertRecordsLocate(where) {
    const lines = coverLines();
    for (const r of storedRecord()) {
      const at = String(lines[r.lineIndex] ?? "").slice(r.offset, r.offset + r.text.length);
      expect(at, `${where}: stored record for ${r.id} does not locate its own text (offset ${r.offset} stale)`).toBe(r.text);
    }
  }

  it("CONTROL: the freshly inserted records all locate their own text", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    await insertFactsViaAccept([FA, FB, FC]);
    expect(storedRecord().length).toBe(3);
    assertRecordsLocate("post-insert"); // holds on HEAD -- the invariant is satisfiable
  });

  it("after removing the FIRST fact, both survivors' records still locate their text", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    await insertFactsViaAccept([FA, FB, FC]);
    await clickRemoveAt(0);
    expect(storedRecord().length, "survivors were dropped from the record").toBe(2);
    assertRecordsLocate("after removing FA"); // RED on HEAD: FB & FC offsets stale
  });

  it("after removing the MIDDLE fact, the stranded LAST survivor's record still locates its text", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    await insertFactsViaAccept([FA, FB, FC]);
    await clickRemoveAt(1);
    expect(storedRecord().length).toBe(2);
    assertRecordsLocate("after removing FB"); // RED on HEAD: FC offset stale
  });
});

describe("N61 second finding: a refused removal must surface a reason (silent failure)", () => {
  // DocumentPreviewMount.js:96 wires onRemove as
  //   (factId) => research.removeInsertedFact(insertedFactsJobId, factId)
  // which DISCARDS the {ok:false, reason} the hook returns. So a removal the
  // hook refuses shows the candidate nothing -- exactly what made the blocker
  // invisible. We drive a refusal (a stale STORED record, as a restored chip /
  // version switch leaves behind) and require the UI to say something readable
  // AND not pretend the fact left.
  const STALE = { id: "stale-1", text: FA.text, lineIndex: 1, offset: 5, url: FA.url, title: FA.title };
  // Broad, failure-semantic vocabulary -- gives the implementer latitude on copy
  // (loop-tdd: pin that a reason appears, not the exact words).
  const FAIL_CUE = /couldn['’]?t|could not|unable to|no longer|not removed|failed to remove|try again|wasn['’]?t removed/i;

  function bodyText() {
    return document.body.textContent || "";
  }

  it("CANARY: the failure-cue matches a refusal message and not ordinary cover-letter prose", () => {
    expect(FAIL_CUE.test("That fact is no longer in the letter.")).toBe(true);
    expect(FAIL_CUE.test("Couldn't remove that fact. Try again.")).toBe(true);
    expect(FAIL_CUE.test("I am excited to apply for the Staff Engineer role at Acme.")).toBe(false);
  });

  it("a refused removal shows a readable message and leaves the row in place (not a silent no-op)", async () => {
    // Entry carries a STORED inserted-fact record that does NOT match the letter
    // (the text is not at that offset), so planRemoveFact no-ops {ok:false}.
    await mount({ [JOB_ID]: entryWithEngineLetter({ insertedFacts: [STALE] }) });
    await openCoverPreview();
    await flush();

    // The strip renders the row (insertedFacts.length > 0). Baseline: no failure
    // message yet -- also a canary that the letter body itself carries no cue.
    expect(removeButtons().length, "stale-record row not rendered -- test would be vacuous").toBe(1);
    expect(FAIL_CUE.test(bodyText()), "a failure cue was visible before any click").toBe(false);

    await clickRemoveAt(0); // the hook refuses; on HEAD onRemove discards it

    // The fact could not be removed, so the row must remain (the candidate is
    // not misled into thinking it worked)...
    expect(removeButtons().length, "the row vanished though the removal was refused").toBe(1);
    // ...AND the candidate is told, in words, that it did not happen. RED on
    // HEAD: onRemove throws away the {ok:false} reason, so nothing is shown.
    expect(FAIL_CUE.test(bodyText()), "a refused removal showed the candidate nothing -- silent failure").toBe(true);
  });
});

describe("N61 latent guard: identity is per-fact, not per-url (AC-N61.20)", () => {
  // removeInsertedFact keys its retracted log on `record.url || record.id`
  // (useCompanyResearch.js:500). Two facts sharing one url are latent today
  // (every card carries a distinct url), but a shared url must never make
  // removing one drop or mis-identify the other. We remove the LAST of two
  // same-url facts (so the offset bug does not confound this) and check the
  // survivor stays whole, correctly located, and present in the store.
  const U = "https://news.example.com/acme/shared";
  const S1 = { id: "art-s1", text: "Acme just opened a Dublin telemetry lab.", url: U, title: "One", placement: "intro" };
  const S2 = { id: "art-s2", text: "The firm doubled its research headcount last year.", url: U, title: "Two", placement: "intro" };

  it("two distinct facts always get distinct, non-null stored ids (identity unambiguous by construction)", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    await insertFactsViaAccept([S1, S2]);
    const ids = storedRecord().map((r) => r.id);
    expect(ids.length).toBe(2);
    expect(ids.every((id) => typeof id === "string" && id.length > 0), "a stored record has a null/empty id").toBe(true);
    expect(new Set(ids).size, "two distinct facts collapsed to one id").toBe(2);
  });

  it("removing one same-url fact keeps the other whole, located, and in the store", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    await insertFactsViaAccept([S1, S2]);
    expect(removeButtons().length).toBe(2);

    await clickRemoveAt(1); // remove the LAST (S2) -- no survivor is shifted

    expect(coalescedLine(), "the removed same-url fact is still present").not.toContain(S2.text);
    expect(coalescedLine(), "removing S2 also dropped its same-url sibling S1").toContain(S1.text);
    // survivor still correctly located...
    const surv = storedRecord();
    expect(surv.map((r) => r.id)).toEqual([S1.id]);
    const line = coverLines()[surv[0].lineIndex];
    expect(line.slice(surv[0].offset, surv[0].offset + surv[0].text.length)).toBe(S1.text);
    // ...and still in the persisted store (not dropped by a url-keyed collision).
    const put = putBodies[putBodies.length - 1];
    expect(put.facts.map((f) => f.id)).toContain(S1.id);
    expect(put.facts.map((f) => f.id)).not.toContain(S2.id);
  });
});
