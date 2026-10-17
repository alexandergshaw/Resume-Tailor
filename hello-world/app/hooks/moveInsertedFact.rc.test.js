// @vitest-environment jsdom
//
// N92 Wave 1 (Control A) -- REACHABILITY. The move is reached the way a
// candidate reaches it: mount the REAL DocumentPreviewMount (which renders the
// REAL DocumentPreviewDialog + InsertedFactsStrip), insert a fact through the
// real accept path, then click the REAL per-fact move control. The handler
// `research.moveInsertedFact` is NEVER called directly -- a direct call cannot
// prove a user can reach the control, and reachability is the single
// most-repeated defect in this repo (loop-tdd rule 5; the sibling
// removeInsertedFact.rc.test.js is the template). Mounting via the MOUNT, not
// the Dialog, is deliberate: if the Mount fails to thread `onMove`, the arrows
// are inert and the fact does not move -- the exact wiring bug a Dialog-only
// harness hides.
//
// What is asserted is the DOWNLOAD-REBUILD SOURCE (coverLetterResultLines) and
// the persisted PUT coverVersion -- not only the on-screen text -- because the
// moved position is what a DOWNLOAD produces (AC-X3/A13). The AC's cited
// previewReloadKey :718 anchor is NOT assumed: this drives the observable
// result (the lines the download rebuilds from), per the brief.
//
// RED-on-HEAD: no move control exists (grep moveInsertedFact|moveForward =
// none, 2026-09-28), so the arrow buttons do not render and every assertion
// that one is present goes red.
//
// jsdom note: MUI's Dialog portals into document.body, so every DOM query goes
// through `document`.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";
import JSZip from "jszip";
import { createDocumentDownloaders } from "@/lib/document/docx";
import { saveGeneratedTemplate } from "@/lib/document/generatedTemplateStore";
import { buildPreviewBlob } from "@/lib/document/previewBlob";
const transport = vi.hoisted(() => ({ client: null }));
vi.mock("@/lib/supabase/client", async (importOriginal) => { const actual = await importOriginal(); return { ...actual, createClient: () => transport.client || actual.createClient() }; });

import { useCompanyResearch } from "./useCompanyResearch.js";
import { useDocumentPreview } from "./useDocumentPreview.js";
import DocumentPreviewMount from "@/app/components/DocumentPreviewMount.js";
import { sanitizeStoredFacts } from "@/lib/acceptedFacts/factStore.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";
import { recordDecision } from "@/lib/activityLog/appActivityLog.js";

// Partial mock: only recordDecision becomes a spy so we can assert the move is
// logged as a fact-position decision carrying NO letter text (AC-X1). Every
// other export (recordActivity, attachActivitySection, ...) stays real.
vi.mock("@/lib/activityLog/appActivityLog.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, recordDecision: vi.fn() };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };
const FACT = {
  id: "art-dublin",
  text: "Acme just opened a Dublin telemetry lab.",
  url: "https://news.example.com/acme/dublin-lab",
  title: "Acme opens a Dublin telemetry lab",
  placement: "intro",
};

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
let docxFixture = null;

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
  const research = useCompanyResearch({ tailoringMap, setTailoringMap, setPreviewReloadKey, supabase: docxFixture?.client, currentUser: docxFixture ? { id: "owner" } : null, coverLetterFile: docxFixture?.file });
  const preview = useDocumentPreview({
    tailoringMap,
    setTailoringMap,
    updateTailoringJob: () => {},
    resumeFile: null,
    coverLetterFile: null,
    additionalContext: "",
    aggressiveness: 50,
    contextFiles: [],
    downloadDocxFiles: docxFixture ? createDocumentDownloaders({ resumeFile: null, coverLetterFile: docxFixture.file, tailoringMap, applicationData: {} }).downloadDocxFiles : {},
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
    tailorEngine: docxFixture ? "gemini" : "embedded",
    previewReloadKey,
    scrapePreviewPosting: null,
    currentUser: null,
    resumeFile: null,
    coverLetterFile: null,
  });
}

beforeEach(() => {
  docxFixture = null; transport.client = null;
  store = { facts: [], removed: [], revision: null };
  putBodies = [];
  probe = null;
  recordDecision.mockClear();
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
  delete globalThis.fetch; docxFixture = null; transport.client = null; vi.restoreAllMocks(); vi.unstubAllGlobals();
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

async function insertFactViaAccept() {
  await act(async () => {
    probe.research.openCompanyResearch(JOB);
  });
  await flush();
  await act(async () => {
    await probe.research.acceptFacts({ facts: [FACT], declinedUrls: [] });
  });
  await flush();
}

const laterButtons = () => [...document.querySelectorAll('[aria-label="Move this fact one sentence later"]')];
const earlierButtons = () => [...document.querySelectorAll('[aria-label="Move this fact one sentence earlier"]')];
const removeButtons = () => [...document.querySelectorAll('[aria-label="Remove this fact"]')];
const sourceLinks = () => [...document.querySelectorAll('[aria-label="Open the source article"]')];

function coverLines() {
  return probe.tailoringMap[JOB_ID]?.coverLetterResultLines || [];
}

// Click a move control the way a candidate does; the bytes path awaits a real
// docx (de)serialize, so advance real time until the move settles.
//
// N95 (authorized helper edit, plan §0.4 / brief): under the optimistic move
// the lines change SYNCHRONOUSLY on click, before the commit's PUT settles, and
// the per-fact in-flight guard keeps the clicked fact's row aria-busy until it
// does. Breaking on the lines-change alone would return MID-FLIGHT -- the next
// clickMove would land on a disabled arrow, and putBodies would not yet reflect
// the write. So wait for COMMIT-SETTLE: the lines changed AND the in-flight
// marker has cleared. On HEAD (no optimism, no aria-busy) this is identical to
// the old lines-change wait; it is a TIMING fix, not an invariant change, and
// the per-fact guard stays per-fact (never weakened to per-direction).
async function clickMove(getButtons, i = 0) {
  await flush();
  expect(getButtons().length, "the move control is not on screen -- it was never wired").toBeGreaterThan(i);
  const before = coverLines().join("\n");
  await act(async () => {
    getButtons()[i].click();
  });
  for (let n = 0; n < 25; n += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    if (coverLines().join("\n") !== before && !document.querySelector('[aria-busy="true"]')) break;
  }
  await flush();
}

describe("Control A is reachable by render-and-click (AC-A2/X3)", () => {
  it("renders one back and one forward control per inserted fact", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    await insertFactViaAccept();
    expect(coverLines().join("\n"), "the fact was never inserted -- the move test would be vacuous").toContain(FACT.text);
    expect(laterButtons().length, "no forward move control rendered -- the strip is not wired for onMove").toBe(1);
    expect(earlierButtons().length, "no backward move control rendered").toBe(1);
  });

  it("clicking forward relocates the fact later in the download-rebuild source and persists a coverVersion", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    await insertFactViaAccept();

    const before = coverLines().join("\n");
    const beforeAt = before.indexOf(FACT.text);
    const putsBefore = putBodies.length;
    await clickMove(laterButtons);

    const after = coverLines().join("\n");
    // moved toward the END of the letter (correct direction), still present once
    expect(after, "the fact left the letter on a move").toContain(FACT.text);
    expect(after.indexOf(FACT.text), "the fact did not move later in the letter").toBeGreaterThan(beforeAt);
    expect(after).not.toBe(before);
    // the move persisted -- the download rebuilds from these lines
    expect(putBodies.length, "the move made no write to the store").toBeGreaterThan(putsBefore);
    const put = putBodies[putBodies.length - 1];
    expect(put.coverVersion, "a move must persist a coverVersion or the download diverges").toBeTruthy();
    expect(put.coverVersion.lines.join("\n")).toContain(FACT.text);
    expect(put.coverVersion.lines.join("\n")).toBe(after);
  });

  it("forward then backward restores the download-rebuild source byte-identically", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    await insertFactViaAccept();

    const original = coverLines().join("\n");
    await clickMove(laterButtons);
    expect(coverLines().join("\n"), "forward did nothing -- the round-trip would be vacuous").not.toBe(original);
    await clickMove(earlierButtons);
    expect(coverLines().join("\n"), "forward+backward is not byte-identical").toBe(original);
  });
});

describe("Control A is not gated on cover bytes (AC-A9)", () => {
  it("moves the fact in the no-bytes (version-switch) state and drops bytes so the download rebuilds from lines", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    await insertFactViaAccept();
    const original = coverLines().join("\n");
    expect(original).toContain(FACT.text);

    // Simulate a version-switch / restored chip: session cover bytes cleared
    // (what selectDocumentVersion writes), lines still present. The accept path
    // REFUSES here; a move must NOT -- its safe outcome is the fact relocating.
    await act(async () => {
      probe.setTailoringMap((m) => ({ ...m, [JOB_ID]: { ...m[JOB_ID], coverLetterDocxB64: "" } }));
    });
    await flush();

    const putsBefore = putBodies.length;
    await clickMove(laterButtons);

    // the move proceeded on the text with no bytes to splice
    expect(coverLines().join("\n"), "the move was blocked in the no-bytes state").not.toBe(original);
    expect(coverLines().join("\n")).toContain(FACT.text);
    expect(probe.research.companyResearch.acceptError || "", "a move raised the accept path's missing-bytes refusal").toBe("");
    // and it persisted with docxPath dropped so the download rebuilds from lines
    // (never stale bytes carrying the old position)
    expect(putBodies.length).toBeGreaterThan(putsBefore);
    const put = putBodies[putBodies.length - 1];
    expect(put.coverVersion, "a move must persist a coverVersion").toBeTruthy();
    expect(put.coverVersion.docxPath, "no-bytes move must send docxPath:null to force a lines-rebuild").toBeNull();
    expect(put.coverVersion.lines.join("\n")).toBe(coverLines().join("\n"));
  });
});

describe("Control A preserves provenance and co-renders every egress control (AC-A12)", () => {
  it("after a move the source link and one-click Remove still work", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    await insertFactViaAccept();
    expect(sourceLinks().length, "no source link before the move -- provenance test would be vacuous").toBe(1);

    await clickMove(laterButtons);

    // provenance survived the move
    expect(sourceLinks().length, "the source link was lost on a move").toBe(1);
    expect(removeButtons().length, "the Remove control was lost on a move").toBe(1);

    // and the fact is still one-click removable from the moved position
    const before = coverLines().join("\n");
    await act(async () => {
      removeButtons()[0].click();
    });
    for (let n = 0; n < 25; n += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      if (coverLines().join("\n") !== before) break;
    }
    await flush();
    expect(coverLines().join("\n"), "the moved fact could not be removed").not.toContain(FACT.text);
  });
});

describe("Control A boundary controls are honestly disabled, not silently no-op (AC-A6)", () => {
  // A short letter with the fact at the LAST body sentence (line 1 is the last
  // body paragraph; "Sincerely," is the closing). Forward has nowhere to go ->
  // the control must be DISABLED and announced, never a live-looking arrow that
  // clicks to nothing (plan §8 W1-S4 SILENT row). Seeded directly because this
  // asserts the disabled RENDER, not insertion reachability (covered above).
  const BOUNDARY_TEXT = "Acme opened a Dublin lab.";
  function seededEntry() {
    const lines = ["Dear Hiring Manager,", `I lead the team. ${BOUNDARY_TEXT}`, "Sincerely,", "Jordan Rivera"];
    return entryWithEngineLetter({
      coverLetterResultLines: lines,
      coverLetterDocxB64: "",
      insertedFacts: [
        {
          id: "art-x",
          text: BOUNDARY_TEXT,
          lineIndex: 1,
          offset: lines[1].indexOf(BOUNDARY_TEXT),
          url: "https://news.example.com/acme/dublin-lab",
          title: "Acme opens a Dublin telemetry lab",
        },
      ],
    });
  }

  it("disables forward at the last body slot while backward stays live", async () => {
    await mount({ [JOB_ID]: seededEntry() });
    await openCoverPreview();
    // both controls render (else the disabled contract is vacuous)
    expect(laterButtons().length).toBe(1);
    expect(earlierButtons().length).toBe(1);
    // forward is at the boundary -> disabled+announced; backward can still move.
    expect(laterButtons()[0].disabled, "forward is not disabled at the last body slot -- a live-looking no-op").toBe(true);
    expect(earlierButtons()[0].disabled, "backward is wrongly disabled away from its boundary").toBe(false);
  });
});

describe("Control A records the move as a fact-position decision (AC-X1)", () => {
  it("logs a fact-position outcome carrying the direction but NO letter text", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    await insertFactViaAccept();
    recordDecision.mockClear();

    await clickMove(laterButtons);

    const calls = recordDecision.mock.calls.filter((c) => c[0] === "fact-position");
    expect(calls.length, "the move recorded no fact-position decision").toBeGreaterThan(0);
    const [, outcome, fields] = calls[calls.length - 1];
    expect(["acted", "skipped", "refused", "failed"]).toContain(outcome);
    expect(fields?.direction, "the recorded decision does not carry the move direction").toBeTruthy();
    // N77: no letter/company/url/title text in the record the caller passes.
    const serialized = JSON.stringify(fields || {});
    expect(serialized).not.toContain(FACT.text);
    expect(serialized).not.toContain(FACT.url);
    expect(serialized).not.toContain(FACT.title);
  });
});

// N92-DOCX last hop: real controls -> real preview download handler -> real
// downloader/resolver -> actual object-URL Blob linked to a save-anchor click.
// Supabase/HTTP and browser save are the only mocked boundaries here.
const DOCX_BASE = "11111111-1111-4111-8111-111111111111";
const DOCX_BODY = `I led the platform team. ${FACT.text} We shipped quickly.`;
const DOCX_LINES = ["Dear Hiring Manager,", DOCX_BODY, "I would relocate for the right team.", "Sincerely,", "Jordan Rivera"];
const DOCX_SMOOTHED = { status: "ok", before: "Leading the platform team,", fact: "we saw Acme just open a Dublin telemetry lab,", after: "which let us ship quickly." };
async function makeOriginalFixture() {
  const objects=new Map(),rows=new Map([[DOCX_BASE,{id:DOCX_BASE}]]),uploads=[];
  const zip=new JSZip();zip.file("[Content_Types].xml",'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file("word/document.xml",'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+DOCX_LINES.map(line=>'<w:p><w:r><w:rPr><w:rFonts w:ascii="OriginalSpecificFont"/></w:rPr><w:t>'+line+'</w:t></w:r></w:p>').join("")+'<w:sectPr/></w:body></w:document>');
  const file=new File([await zip.generateAsync({type:"uint8array"})],"original.docx");
  const client={auth:{getUser:async()=>({data:{user:{id:"owner"}}})},from:()=>{const filters={};const q={select:()=>q,eq:(key,value)=>{filters[key]=value;return q;},maybeSingle:async()=>({data:filters.user_id==="owner"?rows.get(filters.id)||null:null})};return q;},storage:{from:()=>({upload:async(path,bytes,options)=>{if(!options.upsert&&objects.has(path))return {error:{message:"exists"}};objects.set(path,new Blob([bytes]));uploads.push(path);return {};},download:async(path)=>({data:objects.get(path)||null,error:objects.has(path)?null:{statusCode:404,message:"not found"}})})}};
  await saveGeneratedTemplate(client,{kind:"cover",versionId:DOCX_BASE,userId:"owner",file});
  const saved=new Map(),downloads=[],revoked=[];
  const BrowserURL = URL;
  vi.stubGlobal("URL", class extends BrowserURL { static createObjectURL(blob) { const url=`blob:n92-${saved.size}`; saved.set(url,blob); return url; } static revokeObjectURL(url) { revoked.push(url); } });
  vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(function(){if(this.download)downloads.push({name:this.download,url:this.href,blob:saved.get(this.href)});});
  const previousFetch=globalThis.fetch;
  let smoothCalls=0;
  globalThis.fetch=vi.fn(async(url,init={})=>{
    if(String(url).includes("/api/cover-fact-smooth")){smoothCalls+=1;return json({smoothed:DOCX_SMOOTHED});}
    if(String(url).includes("/api/default-template"))return new Response(null,{status:404});
    return previousFetch(url,init);
  });
  docxFixture={client,file,objects,uploads,downloads,revoked,smoothCalls:()=>smoothCalls};transport.client=client;
  return docxFixture;
}
function recoveredEntry(){return entryWithEngineLetter({coverTemplateVersionId:DOCX_BASE,coverLetterResultLines:[...DOCX_LINES],coverLetterDocxB64:"",coverLetterDocxPath:"owner/generated/STALE-UNAVAILABLE.docx",edited:{cover:true},unrelated:"keep",insertedFacts:[{...FACT,lineIndex:1,offset:DOCX_BODY.indexOf(FACT.text)}]});}
async function observable(predicate,label){await vi.waitFor(async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});expect(predicate(),label).toBeTruthy();},{timeout:4000,interval:20});}
async function domClick(label){const button=[...document.querySelectorAll("button")].find(node=>node.getAttribute("aria-label")===label||node.textContent.trim()===label);expect(button,`missing actual DOM control: ${label}`).toBeTruthy();expect(button.disabled).toBe(false);await act(async()=>button.click());}
const WORD_NS="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const ORIGINAL_NS="urn:resume-tailor:original:1";
async function documentSemantics(blob){
  const zip=await JSZip.loadAsync(await blob.arrayBuffer());
  const xml=new DOMParser().parseFromString(await zip.file("word/document.xml").async("string"),"application/xml");
  expect(xml.getElementsByTagName("parsererror")).toHaveLength(0);
  const paragraphs=[...xml.getElementsByTagNameNS(WORD_NS,"p")].map(p=>[...p.getElementsByTagNameNS(WORD_NS,"t")].map(t=>t.textContent).join(""));
  const fonts=[...xml.getElementsByTagNameNS(WORD_NS,"rFonts")].map(node=>node.getAttributeNS(WORD_NS,"ascii"));
  const part=zip.file("customXml/resume-tailor-original.xml");
  const reference=part?new DOMParser().parseFromString(await part.async("string"),"application/xml").documentElement:null;
  return {paragraphs,fonts,reference};
}
function assertDocument(actual,expectedLines){
  expect(actual.paragraphs).toEqual(expectedLines);
  expect(actual.fonts).toContain("OriginalSpecificFont");
  expect(actual.reference,"actual saved document retains original provenance").toBeTruthy();
  expect(actual.reference.namespaceURI).toBe(ORIGINAL_NS);expect(actual.reference.localName).toBe("original");
  expect(actual.reference.getAttribute("kind")).toBe("cover");expect(actual.reference.getAttribute("version")).toBe(DOCX_BASE);
}
function assertLocatedFacts(expectedRecords){
  const current=probe.tailoringMap[JOB_ID],put=putBodies.at(-1);
  expect(current.insertedFacts).toEqual(expectedRecords);expect(put.coverVersion.insertedFacts).toEqual(expectedRecords);
  for(const record of expectedRecords){
    const line=current.coverLetterResultLines[record.lineIndex];expect(line.slice(record.offset,record.offset+record.text.length)).toBe(record.text);
    expect(line.split(record.text)).toHaveLength(2);expect(record.url).toBe(FACT.url);expect(record.title).toBe(FACT.title);
  }
}
async function savedCoverXml(fixture){
  const count=fixture.downloads.length;await domClick("Download .docx");await observable(()=>fixture.downloads.length===count+1,"real Download must click an anchor linked to the saved Blob");
  const saved=fixture.downloads.at(-1);expect(saved.blob).toBeTruthy();expect(saved.name).toMatch(/\.docx$/);expect(fixture.revoked).toContain(saved.url);
  return documentSemantics(saved.blob);
}
async function previewXml(fixture){const blob=await buildPreviewBlob(probe.tailoringMap[JOB_ID],"cover",{coverLetterFile:fixture.file});expect(blob).toBeTruthy();return documentSemantics(blob);}
async function assertCurrentSource(fixture){
  const current=probe.tailoringMap[JOB_ID],put=putBodies.at(-1);expect(put.coverVersion.docxPath).toBeTruthy();
  const stored=fixture.objects.get(put.coverVersion.docxPath);expect(stored).toBeTruthy();expect(current.coverLetterDocxB64).toBeTruthy();
  expect(Uint8Array.from(atob(current.coverLetterDocxB64),c=>c.charCodeAt(0))).toEqual(new Uint8Array(await stored.arrayBuffer()));
  expect(current.coverLetterDocxPath,"client path must be the successfully persisted commit path").toBe(put.coverVersion.docxPath);expect(current.unrelated).toBe("keep");
}

describe("N92 DOCX control-to-saved-Blob reconciliation",()=>{
  it("edited recovered Move compares actual saved download, preview and current persisted source",async()=>{
    const fixture=await makeOriginalFixture();await mount({[JOB_ID]:recoveredEntry(),other:{sentinel:"untouched"}});await openCoverPreview();
    expect(fixture.objects.has(`owner/templates/generated/cover/${DOCX_BASE}.docx`),"original writer positive control").toBe(true);expect(probe.tailoringMap[JOB_ID].coverLetterDocxB64).toBe("");
    const puts=putBodies.length;await domClick("Move this fact one sentence later");await observable(()=>putBodies.length>puts&&!document.querySelector('[aria-busy="true"]'),"Move commit settles");
    const movedBody=`I led the platform team. We shipped quickly. ${FACT.text}`;
    const expectedLines=[DOCX_LINES[0],movedBody,...DOCX_LINES.slice(2)];
    expect(coverLines()).toEqual(expectedLines);const expectedRecords=[{...recoveredEntry().insertedFacts[0],offset:movedBody.indexOf(FACT.text)}];assertLocatedFacts(expectedRecords);
    assertDocument(await savedCoverXml(fixture),expectedLines);assertDocument(await previewXml(fixture),expectedLines);
    expect(probe.tailoringMap.other).toEqual({sentinel:"untouched"});await assertCurrentSource(fixture);
  },15000);
  it("real Smooth proposal, Discard, Apply and Undo save exact approved/restored paragraphs and fact locators",async()=>{
    const fixture=await makeOriginalFixture();await mount({[JOB_ID]:recoveredEntry()});await openCoverPreview();
    const beforeLines=[...coverLines()],beforeRecords=structuredClone(probe.tailoringMap[JOB_ID].insertedFacts),beforeEntry=probe.tailoringMap[JOB_ID],puts=putBodies.length;
    await domClick("Smooth the transition into this fact");await observable(()=>!!document.querySelector('[aria-label="Apply the smoothed version"]'),"guard-valid proposal becomes reviewable");
    expect(putBodies).toHaveLength(puts);expect(probe.tailoringMap[JOB_ID]).toBe(beforeEntry);await domClick("Discard the smoothed version");expect(coverLines()).toEqual(beforeLines);expect(probe.tailoringMap[JOB_ID].insertedFacts).toEqual(beforeRecords);
    await domClick("Smooth the transition into this fact");await observable(()=>!!document.querySelector('[aria-label="Apply the smoothed version"]'),"second proposal appears");await domClick("Apply the smoothed version");await observable(()=>putBodies.length===puts+1&&!!document.querySelector('[aria-label="Undo the smoothing"]'),"Apply is persisted before Undo appears");
    const appliedBody="Leading the platform team, we saw Acme just open a Dublin telemetry lab, which let us ship quickly.";
    const appliedLines=[DOCX_LINES[0],appliedBody,...DOCX_LINES.slice(2)];expect(coverLines()).toEqual(appliedLines);
    const appliedRecords=[{...beforeRecords[0],text:DOCX_SMOOTHED.fact,offset:DOCX_SMOOTHED.before.length+1}];assertLocatedFacts(appliedRecords);
    assertDocument(await savedCoverXml(fixture),appliedLines);assertDocument(await previewXml(fixture),appliedLines);
    const appliedPath=putBodies.at(-1).coverVersion.docxPath,afterApply=probe.tailoringMap[JOB_ID];
    const appliedStored=new Uint8Array(await fixture.objects.get(appliedPath).arrayBuffer());
    expect(Uint8Array.from(atob(afterApply.coverLetterDocxB64),c=>c.charCodeAt(0))).toEqual(appliedStored);
    await domClick("Undo the smoothing");await observable(()=>putBodies.length===puts+2&&!document.querySelector('[aria-label="Undo the smoothing"]'),"Undo finishes its real restore commit");
    expect(coverLines()).toEqual(beforeLines);assertLocatedFacts(beforeRecords);
    assertDocument(await savedCoverXml(fixture),beforeLines);assertDocument(await previewXml(fixture),beforeLines);
    expect(fixture.smoothCalls()).toBe(2);expect(afterApply.coverLetterDocxPath,"Apply client pointer must equal its committed version").toBe(appliedPath);await assertCurrentSource(fixture);
  },20000);
});
