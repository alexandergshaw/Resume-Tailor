// The data ledgers for lib/sourceScan/exportReachability.sweep.test.js --
// split into their own module so that file could come in under the repo's
// 1000-line cap (it was 1056 lines at HEAD, then 1060 after an unrelated
// four-line addition finally tripped the 1000-line rule). Nothing here is
// scanning logic; every export below is DATA the sweep test checks the live
// scan's output against, entry by entry. See that file's own header for what
// the scanner understands and how the three buckets below are used.
//
// THIS MODULE IS ITSELF EXACTLY THE SHAPE LEDGER 1 BELOW DESCRIBES: a plain
// .js under lib/sourceScan, imported only by the sweep test that owns it, and
// therefore unreachable from anything that ships. It is not a .test.js for
// the same reason as its neighbours in that ledger -- importing a .test.js
// from another file replays that file's whole describe tree (see
// tokenizeSource.js's header for the 33-tests-instead-of-1 measurement).
// Because it is unreachable, it must carry its own entry on the
// ALLOWED_UNREACHABLE_MODULES ledger below -- and it does, immediately after
// its lib/sourceScan siblings. That is not an infinite regress: the entry is
// a static string naming this file's own path, not a call that re-enters
// anything, so it terminates the moment the array literal closes. Delete this
// paragraph's warning only if you also delete that self-entry; they are the
// same fact stated twice, once as prose and once as data the sweep test
// actually checks.

// ---------------------------------------------------------------------------
// LEDGER 1 -- whole modules no entry point can reach, WITH a reason.
// ---------------------------------------------------------------------------
export const ALLOWED_UNREACHABLE_MODULES = [
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
    file: "lib/sourceScan/exportReachability.ledger.js",
    why: "this file. The data ledgers for exportReachability.sweep.test.js (ALLOWED_UNREACHABLE_MODULES, UNWIRED_MODULES, ORPHAN_EXPORTS, DESYNCED_STATEMENTS), split out to bring that file under the 1000-line cap; a plain .js and not a .test.js for the same reason as exportGraph.js above, and unreachable for the same reason as every other entry in this ledger -- only the sweep test imports it, by name",
  },
  {
    file: "app/components/experience/experienceTabTestHarness.js",
    why: "shared jsdom harness (fetch stubs, page fixtures, PageEditor/AttachmentPanel mock modules) for the four ExperienceTab suites; it is a .js and not a .test.js so that importing it does not re-run another suite's describes",
  },
  {
    file: "app/theme/computedStyleAtWidth.js",
    why: "the computed-cascade width-emulation harness (bustStyleCache/atWidth) extracted from InterviewTypePicker.test.js so app/theme/mobileSx.test.js could share it without re-deriving the jsdom media-rewrite and style-cache-bust trap; it is a .js and not a .test.js so that importing it does not replay the original suite",
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
// REACHES. This is the duplicateApplyLog shape.
//
// These are deliberately NOT in the allow-list above: they carry a `finding`,
// not a `why`, because there is no reason they should be unreachable -- only a
// product decision nobody has made yet. Wiring them up or deleting them is out
// of this sweep's scope; the sweep's job is to stop them being invisible.
//
// EMPTY, and empty is the RESOLVED state, not the untested one. The three that
// stood here -- app/components/AutoTailorTab.js, lib/experience/attachmentText.js
// and lib/experience/untrustedText.js -- were surfaced by this ledger, reviewed
// by the owner, and DELETED along with their suites. That is the ledger doing
// precisely what its own comment above promises: a finding held in a named
// bucket until a human decides, then removed when they do.
//
// Two notes for whoever adds the next entry:
//   - lib/llm/untrustedFence.js is NOT affected. 36bfa73 had already split the
//     prompt-injection fence out of untrustedText.js into its own module, wired
//     at the job-posting slot in lib/llm/tailorResume.js. untrustedText.js only
//     re-exported QUOTE_PREFIX for its own test's benefit; nothing shipping
//     reached the fence through it, so deleting it disarmed nothing.
//   - The "a test file is not a caller" property this bucket used to
//     demonstrate is now asserted against ALLOWED_UNREACHABLE_MODULES instead
//     (see the sweep test), so an empty bucket here cannot make that test
//     vacuous.
// ---------------------------------------------------------------------------
export const UNWIRED_MODULES = [
  {
    file: "lib/rateLimit/index.js",
    finding:
      "The shared rate limiter, written deliberately ahead of its callers because there is no rate limiting anywhere under app/api/ and two queued model-calling endpoints (the copilot ask-AI box and the sub-bullet expansion route) would otherwise each invent their own bound. It is unwired ON PURPOSE and only for as long as neither of those has landed: the first route to import createRateLimiter fails the exact match above, which is the prompt to delete this entry. If both features are abandoned, this module should be deleted rather than allow-listed -- an unreachable security control protects nothing.",
  },
  {
    file: "lib/rateLimit/memoryStore.js",
    finding:
      "The in-process store behind lib/rateLimit/index.js, unreachable for exactly the same reason and on the same terms. Worth stating separately because it carries a limit its own header records: a per-instance counter bounds a caller to limit x instanceCount, not limit, so on a serverless fleet it converts an unbounded loop against a paid endpoint into a bounded one without being a fleet-wide guarantee. Its two-operation interface exists so a Redis-backed store can replace it without touching a caller.",
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
export const ORPHAN_EXPORTS = [
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
    why: "CORRECTED, and left in place after a delete was proposed on the strength of the old wording. The previous line here read 'never referenced anywhere, including inside docx.js'; that was FALSE. resolveDocumentBlob calls it three times (docx.js:503, :509, :515) and resolveDocumentBlob is imported by StatusBar.js, TrackingTab.js and previewBlob.js -- so this is live code on the edited-download rebuild path, the exact operation the download-rebuild rule cares about. Only the `export` keyword is surplus: no OTHER module imports the name, which is all `unused-export` has ever meant. Do not delete this symbol",
  },
  {
    file: "lib/experience/knowledgeBase.js",
    name: "EXCERPT_HEADING_SUFFIX",
    why: "declared and exported and not referenced even inside knowledgeBase.js -- vestigial; its neighbour ELISION_MARKER is imported by knowledgeBase.test.js, this one by nothing. (SEPARATOR used to belong in that same sentence; it has since joined this ledger itself -- see its own entry below.)",
  },
  {
    file: "lib/experience/knowledgeBase.js",
    name: "SEPARATOR",
    why: "the \"──── PAGE BOUNDARY ────\" string this module joins included pages with, applied twice inside knowledgeBase.js (the budget's separator cost, and the join itself). MIGRATED here from rule TR-1's bucket: its one and only importer was lib/experience/untrustedText.test.js, which asserted the neutralizer quoted this exact structural token, and that test was deleted with its unreachable module. The constant is unchanged and still load-bearing internally -- only its outside reader is gone",
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
    file: "lib/experience/tailorContext.js",
    name: "SEPARATOR",
    why: "the \"---\" string this module joins context pieces with, applied twice inside tailorContext.js (the budget's separator cost, and the join itself). MIGRATED here from rule TR-1's bucket for the same reason as knowledgeBase.js#SEPARATOR above: lib/experience/untrustedText.test.js was its only importer, aliased as TAILOR_SEPARATOR to prove the neutralizer defused a forged \"---\", and that suite went with its unreachable module",
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
// are visible and this list is empty. It is KEPT, empty, because the sweep
// test's own assertions over this ledger turn it into a live guard: anything
// the codeMask confirmation ever throws away again must be added here WITH A
// REASON, by a human, instead of vanishing. An empty ledger is the assertion
// "the scanner has no blind spot today" -- and unlike the sentence that
// started all this, it can fail.
// ---------------------------------------------------------------------------
export const DESYNCED_STATEMENTS = [];
