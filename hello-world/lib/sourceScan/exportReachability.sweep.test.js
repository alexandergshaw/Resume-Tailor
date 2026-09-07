// "Is this exported thing reachable from anything that ships?", as an
// executable invariant.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
// ---------------------------------------------------------------------------
// Three defects found by hand in one session, none of which any gate in this
// repo could see:
//
//   1. lib/duplicateApply/duplicateApplyLog.js -- a whole module with a
//      careful header and a green test suite, and NOTHING imported it. The
//      standing "every feature that can carry a log gets one, plus a visible
//      download button" rule was satisfied on paper and not at all for a user,
//      who had no log to read. (Wired up separately; it is reachable today.)
//   2. lib/tracking/applicationDigest.js's `parseDigestAnswer` -- exported,
//      tested, no production caller; the live route uses `buildCitedDigest`.
//   3. app/hooks/useKnowledgeScope.js's `summaryViewFor` -- `export`ed with no
//      importer at all, its six states pinned only indirectly through seven
//      jsdom mounts.
//
// All three had GREEN TESTS. That is the entire point: **a `.test.js` file is
// not a caller.** Reachability here starts from what Next.js actually loads --
// `app/**/page.js`, `app/**/layout.js`, `app/**/route.js` and `middleware.js`
// -- and follows only real imports out of those.
//
// The sibling sweeps (app/components/hrefSafety.sweep.test.js,
// app/components/windowOpenSafety.sweep.test.js,
// app/components/experience/knowledgeSafety.sweep.test.js) prove SAFETY
// properties. This one proves a WIRING property, and it uses the same shared,
// regex-literal-aware stripper they do -- lib/sourceScan/tokenizeSource.js --
// rather than a fourth private copy. One earlier fork of that stripper was
// silently wrong and under-reported real sites with no error at all.
//
// ---------------------------------------------------------------------------
// WHAT THE RESOLVER UNDERSTANDS, AND WHAT IT DOES NOT
// ---------------------------------------------------------------------------
// lib/sourceScan/exportGraph.js's header is the authoritative list and is
// longer than this summary. The short version:
//
//   UNDERSTOOD  every static import form (default, named, aliased, namespace,
//               side-effect, multi-line clauses); every export form
//               (`function`/`async function`/`function*`/`class`/`const`/
//               `let`/`var`, `default`, `export { a as b }`,
//               `export { a } from "s"`, `export * from "s"`,
//               `export * as ns from "s"`); dynamic `import("s")` with a
//               static string, including the `const { a } = await import(...)`
//               destructuring both production sites use; `./`, `../` and `@/`
//               specifiers resolved through `s`, `s.js`, `s.mjs`,
//               `s/index.js`; non-JS specifiers classified as assets rather
//               than silently "unresolved".
//
//   NOT         computed specifiers (`import(`./${x}.js`)`) -- none exist
//               here, and `no local specifier goes unresolved` below is what
//               makes that a checked fact rather than a hope;
//               namespace MEMBER access (`import * as ns` marks EVERY export
//               of that module used -- it can hide a dead export, never invent
//               one); whether an imported binding is actually used in the
//               importer (that is ESLint's `no-unused-vars`, which runs here);
//               `require()` (none in app/ or lib/); runtime/string-keyed
//               registration; anything outside app/ + lib/ + middleware.js.
//
// A `.js` file whose only importer lives under `test/` is therefore correctly
// reported unreachable -- `test/` is not shipping code.
//
// ---------------------------------------------------------------------------
// THE LEDGER, AND WHY IT HAS THREE BUCKETS INSTEAD OF ONE ALLOW-LIST
// ---------------------------------------------------------------------------
// A first run over this tree found 10 unreachable modules and 355 exported
// symbols that no shipping code asks for. An allow-list of 365 undifferentiated
// entries would BURY the findings it exists to surface, which is the exact
// failure mode this sweep must avoid. So the census is split by a MEASURED
// property, not by taste:
//
//   RULE TR-1 (299 symbols)  the export is unused by shipping code, but at
//       least one `.test.js` imports it BY NAME. This repo's dominant
//       convention is to widen a module's export surface so a unit test can
//       pin an internal helper or a threshold constant directly instead of
//       through the public function. Such a symbol has a real consumer, so it
//       is a deliberately widened surface rather than a lost feature. Covered
//       by rule and COUNTED EXACTLY -- not enumerated, because 299 lines of
//       boilerplate is how the 56 below would get lost. Raising that count is
//       a review event: see the assertion's own comment.
//
//   ORPHAN_EXPORTS (56 symbols)  unused by shipping code AND imported by no
//       test anywhere. Nothing in this repository reads these. Each carries
//       its own line and its own stated reason. This is where `summaryViewFor`
//       lands.
//
//   ALLOWED_UNREACHABLE_MODULES (7) / UNWIRED_MODULES (3)  whole files no
//       entry point can reach. The first seven are sweep and test
//       infrastructure and are justified one by one. The last three are
//       findings -- see the block comment above UNWIRED_MODULES.
//
// Every entry in every bucket must carry a reason; the sweep asserts that, so
// "add it to the list" is never the cheap way out. The two module buckets and
// ORPHAN_EXPORTS are matched EXACTLY: a new dead export fails this file on the
// day it is written, and so does a stale entry left behind after something is
// wired up or removed.
//
// NOTHING IS DELETED OR WIRED UP BY THIS FILE. It is a census.
//
// ---------------------------------------------------------------------------
// A SWEEP THAT FINDS NOTHING BECAUSE ITS SCANNER IS BROKEN IS INDISTINGUISHABLE
// FROM A CLEAN CODEBASE. The bottom of this file therefore carries a positive
// control (known-reachable exports ARE seen reachable, one per resolver
// feature), a false-negative control (a planted unreachable export IS caught),
// a false-positive control (an import or export written inside a comment or a
// string counts for nothing), and a BROKEN-SCANNER MUTANT: the graph is rebuilt
// over the real tree with a parser that returns nothing, and every positive
// control is asserted to go red.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { buildExportGraph, parseModuleSource, resolveSpecifier, entryKindOf } from "./exportGraph.js";
import { tokenizeSource } from "./tokenizeSource.js";

const ROOT = process.cwd();

// ---------------------------------------------------------------------------
// The universe: every production `.js` under app/ and lib/, plus middleware.js.
// ---------------------------------------------------------------------------
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".js")) out.push(full);
  }
  return out;
}

const rel = (full) => path.relative(ROOT, full).split(path.sep).join("/");

const PRODUCTION = new Map();
const TEST_FILES = new Map();
for (const dir of ["app", "lib", "test"]) {
  for (const full of walk(path.join(ROOT, dir))) {
    const r = rel(full);
    const src = readFileSync(full, "utf8");
    if (r.endsWith(".test.js") || r.startsWith("test/")) TEST_FILES.set(r, src);
    else PRODUCTION.set(r, src);
  }
}
PRODUCTION.set("middleware.js", readFileSync(path.join(ROOT, "middleware.js"), "utf8"));

const GRAPH = buildExportGraph({ files: PRODUCTION });
const DEAD_KEYS = new Set(GRAPH.deadExports.map((d) => `${d.file}#${d.name}`));

/** Which exported names does any test file import from this module? */
function testImportIndex(files) {
  const index = new Map();
  const fileSet = new Set(PRODUCTION.keys());
  for (const [from, src] of files) {
    for (const edge of parseModuleSource(src).imports) {
      const r = resolveSpecifier(edge.spec, from, fileSet);
      if (r.kind !== "module") continue;
      const add = (name) => {
        const key = `${r.file}#${name}`;
        if (!index.has(key)) index.set(key, new Set());
        index.get(key).add(from);
      };
      if (edge.namespace) add("*");
      for (const name of edge.names) add(name);
    }
  }
  return index;
}
const TEST_IMPORTS = testImportIndex(TEST_FILES);
const importedByATest = (file, name) => TEST_IMPORTS.has(`${file}#${name}`) || TEST_IMPORTS.has(`${file}#*`);

// Symbols in a module shipping code DOES reach, that shipping code never asks
// for. (Exports of a wholly unreachable module are reported at module
// granularity instead, by the two module ledgers.)
const UNUSED_IN_SHIPPING_MODULES = GRAPH.deadExports.filter((d) => d.reason === "unused-export");
const TEST_REFERENCED = UNUSED_IN_SHIPPING_MODULES.filter((d) => importedByATest(d.file, d.name));
const ORPHANS = UNUSED_IN_SHIPPING_MODULES.filter((d) => !importedByATest(d.file, d.name));

// ---------------------------------------------------------------------------
// LEDGER 1 -- whole modules no entry point can reach, WITH a reason.
// ---------------------------------------------------------------------------
const ALLOWED_UNREACHABLE_MODULES = [
  {
    file: "lib/sourceScan/exportGraph.js",
    why: "this sweep's own scanner; a plain module rather than a .test.js precisely because importing a test file would execute its describe tree (see tokenizeSource.js's header for the 33-tests-instead-of-1 measurement)",
  },
  {
    file: "lib/sourceScan/tokenizeSource.js",
    why: "the one shared regex-literal-aware stripper the three shipped safety sweeps and this one all import; sweep infrastructure never ships to a browser",
  },
  {
    file: "lib/sourceScan/stripSqlComments.js",
    why: "sweep infrastructure for the supabase/migrations scans, same shape and same reason as tokenizeSource.js",
  },
  {
    file: "app/components/experience/experienceTabTestHarness.js",
    why: "shared jsdom harness (fetch stubs, page fixtures, PageEditor/AttachmentPanel mock modules) for the four ExperienceTab suites; it is a .js and not a .test.js so that importing it does not re-run another suite's describes",
  },
  {
    file: "lib/copilot/practiceSessionTestDoubles.js",
    why: "shared fake AudioContext/MediaStream/getUserMedia doubles for practiceSession.test.js and practiceSession.micDevice.test.js; same shared-fixture shape as experienceTabTestHarness.js",
  },
  {
    file: "lib/drive/driveWireProbe.js",
    why: "shared request-capturing probe for the Drive wire tests (route.wire.test.js, driveClient.wire.test.js) that assert what actually goes on the wire",
  },
  {
    file: "lib/llm/geminiWireProbe.js",
    why: "shared Gemini request-capturing probe used by eight wire tests; it exists because the `tools`-nesting defect was invisible to every non-wire test in the repo",
  },
];

// ---------------------------------------------------------------------------
// LEDGER 2 -- FINDINGS. Whole modules, built and tested, that NOTHING SHIPPING
// REACHES. This is the duplicateApplyLog shape, and there are three more of it.
//
// These are deliberately NOT in the allow-list above: they carry a `finding`,
// not a `why`, because there is no reason they should be unreachable -- only a
// product decision nobody has made yet. Wiring them up or deleting them is out
// of this sweep's scope; the sweep's job is to stop them being invisible.
// ---------------------------------------------------------------------------
const UNWIRED_MODULES = [
  {
    file: "app/components/AutoTailorTab.js",
    finding:
      "A whole tab component -- default export AutoTailorTab, with its own jsdom render suite (AutoTailorTab.test.js) covering the View link and the Apply button's enabled state -- that NO file imports. app/page.js mentions it only inside a comment (page.js:1787). A user cannot reach this tab.",
  },
  {
    file: "lib/experience/attachmentText.js",
    finding:
      "extractAttachmentText plus three byte/char limits, written TDD-first with a full suite, imported by nothing but its own test. Attachment text extraction is not wired into any route or component.",
  },
  {
    file: "lib/experience/untrustedText.js",
    finding:
      "neutralizeUntrustedText -- the fence PLUS a re-paragrapher, for untrusted page/attachment text -- imported by nothing but its own test. Still unreachable, but the finding is now NARROWER than when this sweep first reported it: 36bfa73 split the fence half out to lib/llm/untrustedFence.js, which IS wired, at the job-posting slot in lib/llm/tailorResume.js. What remains unreachable here is the re-paragrapher, whose designed upstream (extractAttachmentText, above) is itself unwired -- so this module's own boundary still carries no traffic.",
  },
];

// ---------------------------------------------------------------------------
// LEDGER 3 -- exported symbols in a REACHABLE module that neither shipping code
// nor any test imports. Nothing in this repository reads these.
//
// `internal` records the measured fact that decides how each line reads: how
// many times the symbol's own module mentions it in real code (its declaration
// counts as one). `internal: 1` means the module does not even use it itself.
// ---------------------------------------------------------------------------
const ORPHAN_EXPORTS = [
  {
    file: "app/components/FormattedContent.js",
    name: "normalizeJobDescriptionText",
    why: "used once inside its own module by the FormattedContent renderer; the `export` keyword is the only thing that is surplus, and un-exporting it is a one-word change a human should make deliberately",
  },
  {
    file: "app/components/library/EditDialog.js",
    name: "FieldInput",
    why: "the schema-field sub-renderer EditDialog itself renders; exported for reuse that never happened, and no other dialog imports it",
  },
  {
    file: "app/copilot/usePrepContext.js",
    name: "PREP_STORAGE_KEY",
    why: "the localStorage key this module's own store reads and writes; exported for symmetry with app/settings/engine.js's ENGINE_STORAGE_KEY, which is equally unread",
  },
  {
    file: "app/hooks/useKnowledgeScope.js",
    name: "summaryViewFor",
    why: "FINDING (case 3 of the three this sweep was built for): the six-state view model for a knowledge summary row, exported with no importer at all; its states are pinned only indirectly through jsdom mounts of the panel. A human should decide whether the panel should call it directly or whether the export should go",
  },
  {
    file: "lib/chat/localAssistant.js",
    name: "likelyQuestions",
    why: "used once inside localAssistant's own answer path; nothing outside asks for the question list on its own",
  },
  {
    file: "lib/chat/localAssistant.js",
    name: "classifyIntents",
    why: "the plural form of the intent classifier, consumed only by classifyIntent in this same module",
  },
  {
    file: "lib/chat/localAssistant.js",
    name: "classifyIntent",
    why: "used four more times inside localAssistant; exported alongside classifyIntents for symmetry and imported by nobody",
  },
  {
    file: "lib/copilot/answerCompanyFacts.js",
    name: "FACTS_DEADLINE_MS",
    why: "the module's own deadline constant, read once in this file; a caller that wanted to align its own timeout with it would import it, and none does",
  },
  {
    file: "lib/copilot/answerMetrics.js",
    name: "DISCOURSE_MARKER_PHRASES",
    why: "the discourse-marker vocabulary this module's filler scoring uses internally; the two FILLER_RATE thresholds beside it ARE imported by a test, this list is not",
  },
  {
    file: "lib/copilot/bodyLanguage.js",
    name: "MIN_FACE_SAMPLES",
    why: "a coverage threshold used eight more times inside bodyLanguage.js; one of eighteen exported tuning constants, most of which a test does read -- this one nothing does",
  },
  {
    file: "lib/copilot/bodyLanguage.js",
    name: "MIN_GESTURE_SAMPLES",
    why: "same shape as MIN_FACE_SAMPLES: an internal coverage threshold exported for symmetry with its neighbours and read by nothing outside",
  },
  {
    file: "lib/copilot/idealProject.js",
    name: "MAX_SHAPE_TERMS",
    why: "an internal cap on extracted shape terms, applied once in this module; exported alongside MAX_METRICS, which a test does import",
  },
  {
    file: "lib/copilot/projectStories.js",
    name: "UNTITLED_PROJECT_TITLE",
    why: "the fallback title this module substitutes; a component rendering that fallback would want to import it rather than re-spell it, and none does",
  },
  {
    file: "lib/copilot/resumeAnchor.js",
    name: "MAX_DESCRIPTION_LINES",
    why: "an internal truncation limit applied once here; exported next to gateHeaderPair, which a test imports",
  },
  {
    file: "lib/document/combineDocuments.js",
    name: "buildCombinedDocxBlob",
    why: "an internal step of downloadCombinedDocuments (the one export CombineDocumentsControl.js actually imports); exported but never called from outside, and its own test imports combinedDocumentXml/combinedHtml instead",
  },
  {
    file: "lib/document/combineDocuments.js",
    name: "printCombinedHtml",
    why: "the hidden-iframe print path, called once by downloadCombinedDocuments; the browser-only Save-as-PDF step is not reachable on its own from any component",
  },
  {
    file: "lib/document/docx.js",
    name: "WORDPROCESSINGML_NS",
    why: "the OOXML namespace string, used eight more times inside docx.js; one of twenty exports of a module whose consumers import six of them and whose only sibling test file (docxPreview.test.js) imports none of these nine",
  },
  {
    file: "lib/document/docx.js",
    name: "docxFileFromBase64",
    why: "declared and exported and not referenced even inside docx.js -- vestigial; a human should confirm it is not a half-landed step of the download-rebuild work before it goes",
  },
  {
    file: "lib/document/docx.js",
    name: "getDirectChildrenByTag",
    why: "an XML-walking helper used twice more inside docx.js; exported for a test that does not exist",
  },
  {
    file: "lib/document/docx.js",
    name: "getParagraphPlainText",
    why: "used five more times inside docx.js's paragraph handling; no external importer",
  },
  {
    file: "lib/document/docx.js",
    name: "fitLinesToTemplate",
    why: "declared and exported and never referenced, not even inside docx.js -- vestigial, and adjacent to the template-rebuild path the download work touched; a human should look before deleting",
  },
  {
    file: "lib/document/docx.js",
    name: "extractTemplateLinesFromDocx",
    why: "used once inside docx.js; the uploaded-template reading step, exported but reached only through its own module",
  },
  {
    file: "lib/document/docx.js",
    name: "setParagraphText",
    why: "used twice more inside docx.js's docx rewriting; no external importer",
  },
  {
    file: "lib/document/docx.js",
    name: "buildDocxFromUploadedTemplate",
    why: "declared and exported and never referenced anywhere, including inside docx.js -- and its name is exactly the operation the download-rebuild rule cares about, so this one deserves a human's eyes rather than a delete",
  },
  {
    file: "lib/experience/knowledgeBase.js",
    name: "EXCERPT_HEADING_SUFFIX",
    why: "declared and exported and not referenced even inside knowledgeBase.js -- vestigial; its neighbours ELISION_MARKER and SEPARATOR are both imported by tests, this one by nothing",
  },
  {
    file: "lib/experience/knowledgeBase.js",
    name: "MAX_ATTACHMENT_CHARS_PER_PAGE",
    why: "an internal per-page attachment budget applied once here; nothing outside reads the budget it enforces",
  },
  {
    file: "lib/experience/knowledgeBase.js",
    name: "EXCERPT_SHARE_DIVISOR",
    why: "an internal excerpt-budget divisor applied once here; exported for symmetry with the other sixteen knowledge-base constants",
  },
  {
    file: "lib/experience/pageRanking.js",
    name: "rankingQueryTerms",
    why: "the term extractor rankPages uses internally; the ranking module's public surface is rankPages, and nothing imports the term list on its own",
  },
  {
    file: "lib/feed/selectQueueCandidates.js",
    name: "matchesIncludedCompany",
    why: "declared and exported and not referenced even inside selectQueueCandidates.js -- vestigial, while the other nine predicates beside it are all used or test-imported; a human should check whether an include-company filter was dropped from the queue selection",
  },
  {
    file: "lib/gmail/emailUtils.js",
    name: "scoreMessageForApplication",
    why: "used once by matchMessagesToApplications, which is the one thing app/page.js dynamically imports from this module; the scorer itself has no outside caller",
  },
  {
    file: "lib/gmail/emailUtils.js",
    name: "getCompanyNamesFromApplications",
    why: "declared and exported and not referenced even inside emailUtils.js -- vestigial",
  },
  {
    file: "lib/gmail/emailUtils.js",
    name: "formatMessageDate",
    why: "declared and exported and not referenced even inside emailUtils.js -- a presentation helper for a Gmail list view that nothing renders",
  },
  {
    file: "lib/llm/engines/tailor-lite/docxModel.js",
    name: "decodeXml",
    why: "used twice more inside docxModel.js; the deletable tailor-lite folder exports it, but ImportToLibraryDialog and engine.js import only loadDocx/documentLines/findPlaceholders/FIXED_ENTRY_DATE",
  },
  {
    file: "lib/llm/engines/tailor-lite/docxModel.js",
    name: "encodeXml",
    why: "used five more times inside docxModel.js's serialisation; no importer outside the folder",
  },
  {
    file: "lib/llm/engines/tailor-lite/docxModel.js",
    name: "paragraphText",
    why: "used three more times inside docxModel.js; exported next to documentLines, which IS imported",
  },
  {
    file: "lib/llm/engines/tailor-lite/docxModel.js",
    name: "paragraphTextWithBreaks",
    why: "the line-break-preserving variant of paragraphText, used once here and nowhere else",
  },
  {
    file: "lib/llm/engines/tailor-lite/index.js",
    name: "ENGINE_VERSION",
    why: "re-exported through tailor-lite's single public entry point beside embeddedEngine (which the engine registry does import); the version string itself is read by nothing, and this file's own header says nothing else reaches inside the folder",
  },
  {
    file: "lib/meeting/insightsLocal.js",
    name: "TOPIC_TERM_COUNT",
    why: "one of five tuning constants this module applies internally and exports; the local insight heuristics are consumed only through their functions",
  },
  {
    file: "lib/meeting/insightsLocal.js",
    name: "MEDIUM_CONFIDENCE_MIN_WORDS",
    why: "same shape as TOPIC_TERM_COUNT: an internal confidence threshold, applied once here, imported by nothing",
  },
  {
    file: "lib/meeting/insightsLocal.js",
    name: "ANSWER_WINDOW_TURNS",
    why: "same shape: an internal transcript-window size, applied once here, imported by nothing",
  },
  {
    file: "lib/meeting/insightsLocal.js",
    name: "SUBSTANTIVE_REPLY_MIN_WORDS",
    why: "same shape: an internal reply-length threshold, applied once here, imported by nothing",
  },
  {
    file: "lib/meeting/insightsLocal.js",
    name: "TOP_PAGE_COUNT",
    why: "same shape: an internal cap on cited pages, applied once here, imported by nothing",
  },
  {
    file: "lib/meeting/meetingContext.js",
    name: "rankMeetingPages",
    why: "the page ranker buildMeetingContext uses internally; the context builder is the public surface and the ranker has no outside caller",
  },
  {
    file: "lib/scrape/fetchUrlContent.js",
    name: "parseIPv4",
    why: "an SSRF-guard helper feeding isBlockedHost inside this module; the guard's behaviour is exercised through fetchUrlContent, which is what every route imports",
  },
  {
    file: "lib/scrape/fetchUrlContent.js",
    name: "parseIPv6",
    why: "same shape as parseIPv4: an internal address parser behind the blocked-host check, exported and imported by nothing",
  },
  {
    file: "lib/scrape/fetchUrlContent.js",
    name: "decodeHtmlEntities",
    why: "used four more times inside this module's HTML-to-text path; no outside importer",
  },
  {
    file: "lib/scrape/fetchUrlContent.js",
    name: "parseJsonLenient",
    why: "used twice more inside findEmbeddedJobPosting's JSON-LD handling; exported and imported by nothing",
  },
  {
    file: "lib/scrape/screenshotOcr.js",
    name: "isChromeLine",
    why: "the browser-chrome line filter, used seven more times inside screenshotOcr.js's line cleanup",
  },
  {
    file: "lib/scrape/screenshotOcr.js",
    name: "ocrLines",
    why: "used once inside this module between ocrImage and fieldsFromText; the route imports the whole pipeline, not this step",
  },
  {
    file: "lib/supabase/materials.js",
    name: "safeMaterialName",
    why: "the storage-name sanitiser this module applies to its own uploads; a caller building a material path itself would want it, and none does",
  },
  {
    file: "lib/supabase/upsertInterviewStage.js",
    name: "deleteInterviewStage",
    why: "declared and exported and referenced nowhere, including inside its own module -- a complete CRUD verb with no delete path in the UI. A human should decide whether interview stages are meant to be deletable",
  },
  {
    file: "lib/tailor/editRules.js",
    name: "MAX_RULES_PER_REQUEST",
    why: "an internal cap applied once here; the route imports the rule builders, not the cap",
  },
  {
    file: "lib/tailor/localSignals.js",
    name: "writeSignals",
    why: "the writer half of a read/write localStorage pair, used seven more times inside localSignals.js by the higher-level recorders that ARE imported; nothing outside calls the raw writer",
  },
  {
    file: "lib/techwatch/item.js",
    name: "TIME_PRECISIONS",
    why: "the allowed time-precision vocabulary this module validates against internally; CATEGORIES beside it is equally unread, but a test does import other members of this file",
  },
  {
    file: "lib/url/safeExternalHref.js",
    name: "default",
    why: "`export default safeExternalHref` shipped beside the named export for import-style symmetry; every one of the gate's callers -- and hrefSafety.sweep.test.js's rule -- uses the named form",
  },
  {
    file: "lib/url/safeRedirectPath.js",
    name: "default",
    why: "same default-alias-for-symmetry shape as safeExternalHref.js; the named export is what the auth callback route imports",
  },
];

// ---------------------------------------------------------------------------
// Helpers shared by the assertions and the controls.
// ---------------------------------------------------------------------------
const keyOf = (e) => `${e.file}#${e.name}`;
const sorted = (xs) => [...xs].sort();

/**
 * A reachable export, as this sweep defines it: the module ships, the scanner
 * SAW the symbol, and nothing reported it dead. All three clauses matter --
 * dropping the middle one is what lets a scanner that returns nothing pass
 * every positive control vacuously.
 */
function isReachableExport(graph, file, name) {
  if (!graph.shipping.has(file)) return false;
  const names = (graph.exportsByFile.get(file) || []).map((e) => e.name);
  if (!names.includes(name)) return false;
  return !graph.deadExports.some((d) => d.file === file && d.name === name);
}

// ---------------------------------------------------------------------------
// THE SCANNER'S OWN BLIND SPOT, MADE VISIBLE.
//
// Every `import`/`export` this scanner accepts is confirmed against
// tokenizeSource()'s `codeMask` view, so a statement written inside a comment
// or a template literal cannot register. The other side of that check is a
// blind spot: if the tokenizer wrongly believes a region is string data, a REAL
// statement there is silently dropped -- the module's export surface shrinks
// and a dead export in it can never be reported. That is an under-report with
// no error, which is the precise failure this repo already shipped once.
//
// So the rejected statements are enumerated rather than trusted. Anything the
// codeMask check throws away must be on this list with a reason.
//
// THIS LEDGER IS NOW EMPTY, AND THE HISTORY IS WHY IT STAYS HERE.
//
// It used to carry three entries. lib/document/docx.js:358 is
//
//     return `<w:p>…${runProps ? `<w:rPr>${runProps}</w:rPr>` : ""}…</w:p>`;
//
// -- a template literal NESTED inside another template literal's `${…}` hole.
// lib/sourceScan/tokenizeSource.js's header named exactly this shape as its
// one KNOWN LIMIT and asserted "There is no such shape in this app today".
// That sentence was false when it was written: a census over all 1107 .js
// files found 55 nested templates across 44 files. Because the tokenizer
// treated a template as opaque between two backticks, it closed the outer
// template on the INNER one's opening backtick, every pairing inverted, and
// 2454 characters across lines 358-518 of docx.js were blanked out of
// `codeMask` -- silently, which is how it survived. Three real top-level
// exports (buildMinimalistDocx, downloadMinimalistDocx, resolveDocumentBlob)
// were invisible to this scan, and windowOpenSafety.sweep.test.js -- reading
// the same view -- was blind to the same region and would have reported
// CLEAN on any navigation planted there.
//
// tokenizeSource.js now models `${}` holes with a real stack, so all three
// are visible and this list is empty. It is KEPT, empty, because the test
// below turns it into a live guard: anything the codeMask confirmation ever
// throws away again must be added here WITH A REASON, by a human, instead of
// vanishing. An empty ledger is the assertion "the scanner has no blind spot
// today" -- and unlike the sentence that started all this, it can fail.
// ---------------------------------------------------------------------------
const DESYNCED_STATEMENTS = [];

/** Line-start import/export tokens the codeMask confirmation threw away. */
function rejectedStatements(files) {
  const out = [];
  for (const [file, src] of files) {
    const { codeMask } = tokenizeSource(src);
    const re = /(^|\n)([^\S\n]*)(import|export)\b/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const at = m.index + m[1].length + m[2].length;
      if (codeMask.slice(at, at + m[3].length) === m[3]) continue;
      const text = src.slice(at, at + 120).split("\n")[0];
      const named = /^(?:import|export)\s+(?:async\s+)?(?:function|class|const|let|var|default)?\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(text);
      out.push({ file, name: named ? named[1] : text.trim().slice(0, 40), line: src.slice(0, at).split("\n").length });
    }
  }
  return out;
}

describe("the scanner's blind spot is enumerated, not trusted", () => {
  it("throws away exactly the statements on the desync ledger, and no others", () => {
    const rejected = rejectedStatements(PRODUCTION);
    expect(sorted(rejected.map(keyOf)), "a real import/export was silently dropped by the codeMask check").toEqual(
      sorted(DESYNCED_STATEMENTS.map(keyOf)),
    );
  });

  it("keeps a stated reason on every dropped statement", () => {
    for (const entry of DESYNCED_STATEMENTS) {
      expect(entry.why.length, `${keyOf(entry)} is excused with no reason`).toBeGreaterThan(60);
    }
  });

  it("reads the shape that used to defeat it, and sees straight through it now", () => {
    // The regression test for the fix. docx.js:358 still carries the nested
    // template (so this is a real fixture, not a hypothetical), and all three
    // exports the desync used to hide are now visible as real code.
    const src = readFileSync(path.join(ROOT, "lib/document/docx.js"), "utf8");
    expect(src).toMatch(/\$\{runProps \? `<w:rPr>\$\{runProps\}<\/w:rPr>` : ""\}/);
    const { codeMask } = tokenizeSource(src);
    for (const name of ["buildMinimalistDocx", "downloadMinimalistDocx", "resolveDocumentBlob"]) {
      expect(codeMask, `${name} is invisible to the scanner again`).toContain(
        `export async function ${name}`,
      );
    }
    // And the tokenizer refuses to hand back a view it could not parse,
    // rather than blanking a region and letting this sweep report clean.
    expect(() => tokenizeSource("const a = `never closed;\n")).toThrow();
  });
});

// ---------------------------------------------------------------------------
describe("the scan actually ran", () => {
  it("reads a real, whole tree rather than an empty one", () => {
    // Lower bounds, so ordinary growth does not fail this file for the wrong
    // reason -- but zero, or a tenth of the tree, must be impossible.
    expect(PRODUCTION.size).toBeGreaterThanOrEqual(550);
    expect(TEST_FILES.size).toBeGreaterThanOrEqual(500);
    const totalExports = [...GRAPH.exportsByFile.values()].reduce((n, list) => n + list.length, 0);
    expect(totalExports).toBeGreaterThanOrEqual(1500);
  });

  it("starts from the Next.js entry points, and from all of them", () => {
    expect(GRAPH.entries.length).toBeGreaterThanOrEqual(80);
    expect(GRAPH.entries).toContain("middleware.js");
    expect(GRAPH.entries).toContain("app/layout.js");
    expect(GRAPH.entries).toContain("app/page.js");
    expect(GRAPH.entries).toContain("app/copilot/page.js");
    expect(GRAPH.entries).toContain("app/api/tailor/route.js");
    // Every entry the walker found is an entry the graph started from.
    const walked = [...PRODUCTION.keys()].filter((r) => entryKindOf(r) !== null);
    expect(sorted(GRAPH.entries)).toEqual(sorted(walked));
  });

  it("reaches nearly the whole tree, so a broken BFS cannot look like a clean one", () => {
    expect(GRAPH.shipping.size).toBeGreaterThanOrEqual(500);
  });

  it("leaves no local specifier unresolved", () => {
    // THE load-bearing guard. A resolver that silently fails to resolve `./x`
    // drops the edge, and everything behind that edge looks dead -- a sweep
    // that cries wolf on real, wired code. If this ever fails, the resolver is
    // wrong, not the code.
    expect(
      GRAPH.unresolved.map((u) => `${u.file}:${u.line} -> ${u.spec}`),
      "a relative or @/-aliased specifier did not resolve to a file in the universe",
    ).toEqual([]);
    // …and it is empty because everything resolved, not because nothing was
    // read. Without this line a scanner that parses nothing passes here.
    expect(parseModuleSource(PRODUCTION.get("app/layout.js")).imports.length).toBeGreaterThan(3);
  });
});

describe("every module is reachable from something that ships, or is on a ledger with a reason", () => {
  it("matches the two module ledgers exactly", () => {
    const ledgered = sorted([
      ...ALLOWED_UNREACHABLE_MODULES.map((e) => e.file),
      ...UNWIRED_MODULES.map((e) => e.file),
    ]);
    // EXACT, in both directions. A newly orphaned module fails here on the day
    // it is written; so does a ledger entry left behind after something is
    // wired up, which keeps the census honest instead of merely permissive.
    expect(sorted(GRAPH.unreachableModules)).toEqual(ledgered);
  });

  it("keeps a stated reason on every allow-listed module", () => {
    for (const entry of ALLOWED_UNREACHABLE_MODULES) {
      expect(entry.why.length, `${entry.file} is allow-listed with no real reason`).toBeGreaterThan(40);
    }
    expect(ALLOWED_UNREACHABLE_MODULES).toHaveLength(7);
  });

  it("keeps the unwired-feature findings visible and described", () => {
    // These are NOT allow-listed. They are findings held in a named bucket so
    // that they cannot quietly become "just how it is". Wiring one up (or
    // removing it) fails the exact match above, which is the prompt to delete
    // its line here.
    expect(UNWIRED_MODULES.map((e) => e.file)).toEqual([
      "app/components/AutoTailorTab.js",
      "lib/experience/attachmentText.js",
      "lib/experience/untrustedText.js",
    ]);
    for (const entry of UNWIRED_MODULES) {
      expect(entry.finding.length, `${entry.file} is recorded as unwired with no description`).toBeGreaterThan(60);
    }
  });

  it("does not let a test file count as a caller", () => {
    // The property the whole sweep rests on, asserted directly against the
    // three findings: each has a green test suite importing it, and each is
    // still unreachable.
    for (const { file } of UNWIRED_MODULES) {
      expect(GRAPH.shipping.has(file)).toBe(false);
      const importers = [...TEST_IMPORTS.entries()]
        .filter(([key]) => key.startsWith(`${file}#`))
        .flatMap(([, from]) => [...from]);
      expect(importers.length, `${file} was expected to have at least one test importer`).toBeGreaterThan(0);
    }
  });
});

describe("every export of a shipping module is asked for, or is on a ledger with a reason", () => {
  it("matches the orphan ledger exactly", () => {
    expect(sorted(ORPHANS.map(keyOf))).toEqual(sorted(ORPHAN_EXPORTS.map(keyOf)));
  });

  it("keeps a stated reason on every orphan", () => {
    // An entry with no reason is how a real finding gets buried. The length
    // floor is deliberately high enough that a placeholder cannot satisfy it.
    for (const entry of ORPHAN_EXPORTS) {
      expect(entry.why.length, `${keyOf(entry)} is on the ledger with no real reason`).toBeGreaterThan(60);
    }
    expect(ORPHAN_EXPORTS).toHaveLength(56);
  });

  it("[RULE TR-1] counts the exports whose only consumer is a test, exactly", () => {
    // Raising this number means someone widened a module's export surface and
    // only a test consumed the new symbol. That is usually this repo's normal
    // whitebox-unit-test convention -- and it is ALSO exactly what
    // duplicateApplyLog.js, parseDigestAnswer and summaryViewFor looked like
    // the day before a human noticed. So it is a review event, not a warning:
    // check the new export is a helper being pinned, not a feature that was
    // built and never connected, then update the number.
    //
    // 299 -> 300, and NOT because the tree grew. This number was pinned at
    // 299 while the comment beside it said "the true figure is 300:
    // docx.js's buildMinimalistDocx belongs here too and is invisible to the
    // scan". Fixing tokenizeSource.js's nested-template desync made that one
    // export visible, so the scanner now counts what the comment already
    // knew. The other two exports the desync hid (downloadMinimalistDocx,
    // resolveDocumentBlob) were hand-checked as genuinely reachable and land
    // in neither bucket, which is why this moves by exactly one.
    expect(TEST_REFERENCED.length).toBe(300);
    // A classifier that swept everything into this bucket would make the
    // orphan ledger vacuous, so pin the split rather than only the total.
    expect(UNUSED_IN_SHIPPING_MODULES.length).toBe(TEST_REFERENCED.length + ORPHANS.length);
    // 355 -> 356, carrying the same single export; ORPHANS is unchanged.
    expect(UNUSED_IN_SHIPPING_MODULES.length).toBe(356);
  });

  it("still reports the two symbol-level cases this sweep was built for", () => {
    // Case 3: no importer at all -- an orphan.
    expect(ORPHANS.map(keyOf)).toContain("app/hooks/useKnowledgeScope.js#summaryViewFor");
    // Case 2: exported, tested, no production caller -- rule TR-1's bucket.
    // Naming it here means TR-1 can never be mistaken for "these are all fine".
    expect(TEST_REFERENCED.map(keyOf)).toContain("lib/tracking/applicationDigest.js#parseDigestAnswer");
    // …while the thing the live route DOES call is seen as reachable. (It
    // lives one module over, in digestCitations.js -- which is the point:
    // parseDigestAnswer was superseded, not merely uncalled.)
    expect(isReachableExport(GRAPH, "lib/tracking/digestCitations.js", "buildCitedDigest")).toBe(true);
  });

  it("never reports a framework contract as dead", () => {
    // A route's GET, a page's default, middleware's config: consumed by
    // Next.js, not by an import. Reporting those would drown everything else.
    const frameworkNoise = GRAPH.deadExports.filter(
      (d) => entryKindOf(d.file) !== null && ["default", "GET", "POST", "PATCH", "DELETE", "runtime", "config", "metadata"].includes(d.name),
    );
    expect(frameworkNoise.map(keyOf)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// CONTROL 1 -- POSITIVE. Real repo symbols that ARE reachable, one per resolver
// feature. If the scanner stops seeing these, every assertion above is passing
// vacuously.
// ---------------------------------------------------------------------------
const POSITIVE_CONTROLS = [
  { file: "lib/url/safeExternalHref.js", name: "safeExternalHref", feature: "plain named import, several hops from an entry point" },
  { file: "app/settings/engine.js", name: "useEngine", feature: "imported by both relative and @/-aliased specifiers" },
  { file: "lib/supabase/middleware.js", name: "updateSession", feature: "reached from middleware.js, not from app/" },
  { file: "app/components/AppHeader.js", name: "default", feature: "a default export used only as a JSX element" },
  { file: "lib/gmail/emailUtils.js", name: "matchMessagesToApplications", feature: "reached ONLY by `const { … } = await import(…)` in app/page.js" },
  { file: "lib/supabase/writePosition.js", name: "writePositionMerged", feature: "reached only by a dynamic import inside lib/" },
  { file: "app/theme/tokens.js", name: "tokens", feature: "reached only through `export { … } from` in app/theme/index.js" },
  { file: "lib/copilot/stt/index.js", name: "createSttStream", feature: "specifier resolved through a directory's index.js" },
  { file: "lib/llm/engines/index.js", name: "getEngine", feature: "a barrel module reached by directory specifier" },
  { file: "lib/copilot/answerClient.js", name: "draftAnswer", feature: "module namespace-imported by app/copilot/useDraftAnswer.js" },
];

describe("[positive control] known-reachable exports are seen as reachable", () => {
  for (const { file, name, feature } of POSITIVE_CONTROLS) {
    it(`sees ${file}#${name} (${feature})`, () => {
      expect(isReachableExport(GRAPH, file, name), `${file}#${name} vanished -- the scanner is broken`).toBe(true);
    });
  }

  it("proves the namespace-import control really is a namespace import", () => {
    // Otherwise the answerClient row above would pass for the wrong reason.
    const src = readFileSync(path.join(ROOT, "app/copilot/useDraftAnswer.js"), "utf8");
    expect(src).toMatch(/import \* as answerClientModule from "@\/lib\/copilot\/answerClient"/);
  });

  it("proves the dynamic-import control really is a dynamic import", () => {
    const src = readFileSync(path.join(ROOT, "app/page.js"), "utf8");
    expect(src).toMatch(/const \{ matchMessagesToApplications, classifyMessage \} = await import\(/);
  });
});

// ---------------------------------------------------------------------------
// CONTROL 2 -- FALSE NEGATIVE. A synthetic project carrying a planted
// unreachable module and a planted unused export. Both must be caught.
// ---------------------------------------------------------------------------
const PLANTED = new Map([
  [
    "app/page.js",
    `import { used } from "@/lib/planted/live.js";
     import Widget from "./Widget.js";
     import "./side-effect.js";
     export const runtime = "nodejs";
     export default function Page() { return <Widget value={used()} />; }`,
  ],
  ["app/Widget.js", `export default function Widget() { return null; }\nexport const WIDGET_LIMIT = 3;`],
  ["app/side-effect.js", `globalThis.__planted = 1;`],
  [
    "lib/planted/live.js",
    `export function used() { return 1; }
     export function neverCalled() { return 2; }`,
  ],
  ["lib/planted/orphanModule.js", `export function alsoNeverCalled() { return 3; }`],
]);

describe("[false-negative control] planted dead code is caught", () => {
  const g = buildExportGraph({ files: PLANTED });
  const keys = g.deadExports.map(keyOf);

  it("catches an exported function in a live module that nothing imports", () => {
    expect(keys).toContain("lib/planted/live.js#neverCalled");
  });

  it("catches a whole module no entry point reaches", () => {
    expect(g.unreachableModules).toContain("lib/planted/orphanModule.js");
    expect(keys).toContain("lib/planted/orphanModule.js#alsoNeverCalled");
  });

  it("catches an unused export beside a used default in the SAME file", () => {
    // The summaryViewFor shape: the module ships, its default is rendered, and
    // one named export beside it is reached by nothing.
    expect(keys).toContain("app/Widget.js#WIDGET_LIMIT");
    expect(keys).not.toContain("app/Widget.js#default");
  });

  it("does not mistake the live export, the entry's default, or segment config for dead code", () => {
    expect(keys).not.toContain("lib/planted/live.js#used");
    expect(keys).not.toContain("app/page.js#default");
    expect(keys).not.toContain("app/page.js#runtime");
  });

  it("keeps a side-effect-only import's module reachable", () => {
    expect(g.shipping.has("app/side-effect.js")).toBe(true);
    expect(g.unreachableModules).not.toContain("app/side-effect.js");
  });
});

// ---------------------------------------------------------------------------
// CONTROL 3 -- FALSE POSITIVE. An import or an export written inside a comment,
// a string or a template literal is not code and must count for nothing --
// neither as an edge that keeps something alive, nor as a symbol to report.
// ---------------------------------------------------------------------------
const COMMENTED = new Map([
  [
    "app/page.js",
    `// import { ghost } from "@/lib/ghost/onlyInAComment.js";
     /* export function alsoAGhost() {}
        import Ghost from "./Ghost.js"; */
     const prose = "import { stringGhost } from './nowhere.js'";
     const tpl = \`export function templateGhost() {}\`;
     const re = /[\\\\/:*?"<>|]/g;
     import { real } from "@/lib/ghost/real.js";
     export default function Page() { return real(prose, tpl, re); }`,
  ],
  ["lib/ghost/real.js", `export function real() { return 1; }\nexport function unreferenced() { return 2; }`],
  ["lib/ghost/onlyInAComment.js", `export function ghost() { return 3; }`],
]);

describe("[false-positive control] an import or export inside a comment or a string counts for nothing", () => {
  const g = buildExportGraph({ files: COMMENTED });
  const keys = g.deadExports.map(keyOf);

  it("does not let a commented-out import keep a module alive", () => {
    expect(g.unreachableModules).toContain("lib/ghost/onlyInAComment.js");
  });

  it("does not invent exports out of a comment or a template literal", () => {
    expect(keys).not.toContain("app/page.js#alsoAGhost");
    expect(keys).not.toContain("app/page.js#templateGhost");
  });

  it("still finds the real import that follows a regex literal containing a quote", () => {
    // The measured shape that silently blanked a real site out of a shipped
    // sweep: `/[\\/:*?"<>|]/g`. If the shared tokenizer regressed, the `real`
    // edge would disappear and lib/ghost/real.js would look unreachable.
    expect(g.shipping.has("lib/ghost/real.js")).toBe(true);
    expect(keys).not.toContain("lib/ghost/real.js#real");
    expect(keys).toContain("lib/ghost/real.js#unreferenced");
  });

  it("[real file] does not count the import statements quoted inside this repo's own prose", () => {
    // The strongest available false-positive control: eslint.config.mjs is not
    // in the universe, but lib/sourceScan/exportGraph.js's own header quotes
    // `import * as ns from "m"` and `export { a } from "s"` in a block comment.
    // Neither may register as an edge.
    const src = readFileSync(path.join(ROOT, "lib/sourceScan/exportGraph.js"), "utf8");
    expect(src).toContain('export { a } from "s"');
    const parsed = parseModuleSource(src);
    expect(parsed.imports.map((i) => i.spec)).toEqual(["node:path", "./tokenizeSource.js"]);
  });
});

// ---------------------------------------------------------------------------
// CONTROL 4 -- THE BROKEN-SCANNER MUTANT. Rebuild the graph over the REAL tree
// with a parser that returns nothing, and prove the sweep goes red. A scanner
// that finds nothing must never be mistaken for a clean codebase.
// ---------------------------------------------------------------------------
describe("[mutant] a scanner that returns nothing fails every control", () => {
  const BLIND = () => ({ imports: [], exports: [] });
  const mutant = buildExportGraph({ files: PRODUCTION, parse: BLIND });

  for (const { file, name } of POSITIVE_CONTROLS) {
    it(`turns the positive control ${file}#${name} red`, () => {
      expect(isReachableExport(mutant, file, name)).toBe(false);
    });
  }

  it("turns the module ledger red", () => {
    const ledgered = sorted([
      ...ALLOWED_UNREACHABLE_MODULES.map((e) => e.file),
      ...UNWIRED_MODULES.map((e) => e.file),
    ]);
    expect(sorted(mutant.unreachableModules)).not.toEqual(ledgered);
    // With no import edges, everything but the 83 entry files falls out of the
    // shipping set -- the opposite of a quiet pass.
    expect(mutant.unreachableModules.length).toBeGreaterThan(400);
  });

  it("turns the orphan ledger and rule TR-1's count red", () => {
    const mutantUnused = mutant.deadExports.filter((d) => d.reason === "unused-export");
    expect(mutantUnused).toHaveLength(0);
    expect(mutantUnused.length).not.toBe(355);
    expect(sorted(mutantUnused.map(keyOf))).not.toEqual(sorted(ORPHAN_EXPORTS.map(keyOf)));
  });

  it("turns the false-negative control red", () => {
    const blindPlanted = buildExportGraph({ files: PLANTED, parse: BLIND });
    expect(blindPlanted.deadExports.map(keyOf)).not.toContain("lib/planted/live.js#neverCalled");
  });
});
