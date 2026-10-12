# Export-reachability sweep: movement history (sections 4 and 5)

This file holds the append-only, per-chunk movement notes for the two pinned
counts that move most often: `TEST_REFERENCED.length` (section 4, rule TR-1)
and the `UNUSED_IN_SHIPPING_MODULES` total (section 5). They were split out of
`exportReachability.ledger.md` when that file passed the repo's 1000-line cap.
Every line below was moved verbatim, not summarised or reworded; nothing was
dropped and no count, assertion or scan logic changed.

The section numbers are kept identical to the main ledger on purpose: the notes
below, `exportReachability.sweep.test.js` and `exportReachability.ledger.js` all
cite "section 4" / "section 5" by number. The explanatory text for each
section, the current pinned values and the identity that ties them together
stay in `exportReachability.ledger.md`; sections 1-3 (and their histories) also
stay there.

When section 4 or section 5's count changes, append the new delta to the
matching block here (newest at the bottom, same `old -> new (chunk): what moved,
and why` shape), update the number in the test, and update the pinned-values
table in the main ledger.

---

## 4. TEST_REFERENCED, rule TR-1: movement notes (pinned at 445)

```text
299 -> 300, and NOT because the tree grew. This number was pinned at
299 while the comment beside it said "the true figure is 300:
docx.js's buildMinimalistDocx belongs here too and is invisible to the
scan". Fixing tokenizeSource.js's nested-template desync made that one
export visible, so the scanner now counts what the comment already
knew. The other two exports the desync hid (downloadMinimalistDocx,
resolveDocumentBlob) were hand-checked as genuinely reachable and land
in neither bucket, which is why this moves by exactly one.

300 -> 298, and this number FELL, which is the direction the comment
above never anticipated. Deleting the three unwired modules could not
touch this bucket directly -- their own exports were filed as
`unreachable-module` (exportGraph.js:412), never as `unused-export`.
What moved it was the deleted TESTS: lib/experience/untrustedText.test.js
was the only file in the repo importing knowledgeBase.js#SEPARATOR and
tailorContext.js#SEPARATOR, so both exports lost their sole consumer and
were demoted into the orphan ledger. Deleting a test can lower this
count by demoting an export it alone kept alive; that is worth knowing
before anyone reads a drop here as "we wired something up".

298 -> 303, and every one of the five is a widened surface, not a lost
feature. Four belong to the session-wide activity log
(lib/activityLog/), whose five modules ARE all reached from shipping
code -- app/layout.js -> AppHeader -> SettingsMenu -> ActivityLogButton
and SettingsMenu -> activityInstrumentation -- so none of them is on
either module ledger; these are the four symbols beside that live path
that only a test asks for:

  activityRedaction.js#REDACTED       the marker string the planted-
      secret suite asserts against, rather than re-spelling "[redacted]"
      in eight places.
  appActivityLog.js#createActivityLog the pure factory. The singleton
      beside it (recordActivity/attachActivitySection/
      activityLogSnapshot) is what ships; the factory exists so the
      recorder can be tested with an injected clock and without touching
      a module-level global, which is this repo's own reason for the
      `now = Date.now` idiom.
  appActivityLog.js#ACTIVITY_LOG_SCHEMA and #MAX_ACTIVITY_SECTIONS
      constants the suites pin directly instead of hard-coding 1 and 16.
      (MAX_ACTIVITY_EVENTS beside them is NOT here: activityLogDocument.js
      imports it to print the cap in the drop notice.)

The fifth, lib/applications/untrackChip.js#isHiddenFromTracking, is not
this feature's: it arrived with the untrack-chip work landing in the same
tree (app/hooks/useUntrackChip.js, app/components/StatusBar.js) and is
counted here only because this number is a whole-tree census.

303 -> 304, and the ONE symbol is
lib/rateLimit/index.js#clientIpFromHeaders. It is not a new export and it
did not change: it moved BUCKETS. While lib/rateLimit was unwired, every
one of its exports was classified `unreachable-module` and reported by
the module ledger above instead of here (exportGraph.js:412). Wiring the
limiter into app/api/copilot/ask/route.js -- the event that emptied
UNWIRED_MODULES two cases up -- made the module reachable, which
reclassified all four of its exports as ordinary `unused-export`
candidates, and this is the one of the four that no shipping code asks
for. The check this comment's own instructions ask for was made: it is a
HELPER BEING PINNED, not a feature built and never connected --
`identify()` applies it on every call (index.js:265), and the reason it
is exported is that four cases in rateLimit.test.js drive the
forged-x-forwarded-for defence directly (rotating the attacker-controlled
left-hand entries, and the too-short-chain refusal), which cannot be
reached through `identify` alone. The other three -- createRateLimiter,
identify, rateLimitHeaders -- are all imported by the route and land in
neither bucket.

ORPHANS is unchanged at 56, and nothing from the ask feature itself
appears in either half: every export of app/api/copilot/ask/route.js,
lib/copilot/askContext.js, askPrompt.js, askLocal.js, askTracking.js and
app/copilot/dashboard/AskAiBox.js is consumed by shipping code.
UNCHANGED at 304 across the bullet-truncation chunk, and that is worth a
sentence because the chunk DID add eight test-only exports. They landed in
the ORPHAN half instead, for two different reasons, both recorded on that
ledger: six are read through a DYNAMIC `await load()` in
lib/copilot/pointLength.test.js (a deliberate pattern so those cases could
fail before the module existed), and this index is built from STATIC
imports only, so the edge is real but invisible here. The eighth,
answerLocal.js#groundingCandidates, is called inside its own module.
Neither is a bucket move of the kind this number tracks.
304 -> 336. Two large features landed together: expandable sub-bullets
(expansionContract, expansionHonesty, expansionPrompt, expansionStore,
answerExpansionLocal, answerRequestPrologue) and the position glossary
(its constants, worker, store, ingest rules and citation join). Both follow
this repo's dominant convention of widening a module's export surface so a
unit suite can pin an internal helper or a threshold directly rather than
through the public function -- rule TR-1's whole subject.

The signal that this is a widened surface and not lost features is that the
orphan half moved INDEPENDENTLY and in the other direction (64 -> 63): an
export nothing at all asks for lands there, not here, and would have broken
the split assertion above instead of this count.

336 -> 342, and the +6 is +7 -1 rather than six new symbols. The seven
are lib/copilot/citationDetail.js's five caps (MAX_SECTION_WORDS,
MAX_SECTION_CHARS, MAX_QUOTE_CHARS, MAX_OUTLINE_HEADINGS,
MAX_HEADING_CHARS) plus `headingText` and the single-citation
`citationDetail` — rule TR-1's exact shape: the module's public entry
point, `attachCitationDetail`, IS asked for by shipping code
(app/api/copilot/answer/route.js, five call sites), and these seven are
the thresholds and the two helpers its unit suite pins directly so a cap
is never restated as a literal in a fixture.

The one that LEFT is lib/experience/knowledgeBase.js#splitBlocks, and it
left for the reason this bucket exists to make visible: it was an export
only a test asked for, and citationDetail.js — reachable from the answer
route — now imports it. That is the census working in the good
direction, and it is the same movement `standsAlone` and `materialQuote`
made one chunk earlier.

342 -> 351, and all nine are the glossary HOVER chunk's, in rule TR-1's
exact shape: a module's public entry point is reached by shipping code
and the widened surface is what its unit suite pins directly.
  * glossaryMatch.js#MAX_MARKS_PER_LINE, #EMPTY_GLOSSARY_INDEX,
    #buildGlossaryIndex, #findGlossaryMarks, #glossaryMarksFor -- the
    module IS reachable (AnswerLines.js imports `marksWithin`, and
    GlossaryProvider.js imports three more), and these five are what the
    matcher's own suite and its corpus sweep drive directly, because a
    tie-break and a straddle rule cannot be exercised through a render.
  * glossaryCard.js#NO_SOURCE_SENTENCE, #POSTING_ONLY_LINE,
    #sourceLinkLabel -- the wording constants the card's suite asserts by
    name rather than restating as literals in a fixture; the module's
    entry point, `glossaryCardModel`, IS imported by GlossaryTerm.js.
  * glossaryPanel.js#GLOSSARY_PANEL_ROWS -- the sixteen-state
    enumeration, exported so a test can assert there are sixteen of them
    rather than counting branches by eye. `glossaryPanelState` itself is
    imported by GlossaryProvider.js.

The orphan half is FROZEN at 63 across this chunk, and that is the load-
bearing half of the reading: every component this chunk added
(GlossaryTerm, GlossaryProvider) is reached from AnswerLines.js, so a
feature built and never wired would have landed in the other bucket.

351 -> 350, and the ONE symbol is GlossaryProvider.js#GlossaryProvider.
It is a bucket move, and the direction is the interesting part: when the
glossary UI landed, AnswerLines.js imported the CONTEXT HOOK out of that
module, so the module was reachable while the PROVIDER COMPONENT itself
had no shipping importer -- the feature rendered nothing because nothing
mounted it. Mounting it in CopilotClient.js and practice/PracticeClient.js
gave that export a real caller and this count fell by one.

Worth keeping, because it is the second time this has happened: the
ask-AI box shipped in 7e3d48c sending an empty applicationId for exactly
the same reason -- built, tested, and never wired at the mount site. A
count that falls when a feature is connected is the cheapest evidence
this census produces that something is actually reachable by a user.
350 -> 355: IP3's own five, all in prepStore.js's read/list surface
(readPrepPack, listPrepPacks, listPrepEvents, checkPackByteBudget) plus
prepContract.js's PREP_REASON_VALUES, each driven directly by
prepStore.test.js or interviewPrepMigrationShape.test.js while route.js
imports only the five write-path functions and the three rate/timeout
constants it actually calls. Rule TR-1's exact shape: a module's real
entry point ships (claimPrepPack, writePrepPackResult and the rest are
reachable from route.js) and these five are what its own suites pin
directly instead of driving them only through the shipping surface.
356 -> 357: prepPack.js (N16 wave B) went from a wholly unreachable
module -- its exports counted in neither half of this split, only in
the module-ledger mismatch that made the sweep red -- to a shipping
one, because route.js now imports `packStatus` to compute the
terminal write status on a normalized generation-path pack.
`packStatus` itself is reachable from that real call site and lands in
neither bucket. Its sibling export, `completeSections`, has no
shipping importer of its own (packStatus computes the count inline
rather than calling it) but IS imported by name from
prepPack.test.js -- rule TR-1's exact shape, so it lands here rather
than in ORPHAN_EXPORTS.

357 -> 356, and this is TWO INDEPENDENT MOVEMENTS netting to -1, not a
clean single step -- reading it as "nothing much happened" would miss
the case this bucket exists to catch (N33's own wave landing route.js's
GET handler and the O-15 exemption together).
  -3  prepStore.js#readPrepPack, prepStore.js#listPrepEvents and
      prepPack.js#completeSections all gained a REAL shipping importer:
      route.js's own GET handler (implemented this round) reads an
      existing pack and returns `{pack, status, completeSections,
      attemptsExhausted, candidateName, interviewerNames, error}` to
      PrepPackPanel.js. route.js now imports readPrepPack/
      listPrepEvents from prepStore.js and completeSections from
      prepPack.js, and calls all three in that handler. All three were
      previously exercised only by prepStore.test.js/prepPack.test.js;
      none demoted into ORPHAN_EXPORTS on the way out (their sole prior
      consumer was always a test, never nothing), so this bucket is the
      whole story for their departure -- this is the census working in
      the GOOD direction, the same shape GlossaryProvider's own mount
      demonstrated above.
  +2  prepParse.js's own O-15 exemption additions, detectedNameSpans
      and isUserSuppliedName (design-reconciled.r2.md ss4.2). Neither
      is imported BY NAME from a static import anywhere -- their own
      suite, nameExemption.test.js, reaches them only through a dynamic
      `await load()` this index cannot follow (the same shape the
      bullet-truncation chunk's seven used, see this file's header).
      What actually lands them here is a SEPARATE static edge:
      lib/interviewPrep/trustedNamesCallSites.sweep.test.js does
      `import * as ... from "./prepParse.js"` for its own call-site
      census, and a NAMESPACE import marks a module's ENTIRE export
      surface used (exportGraph.js's own documented behaviour -- the
      same mechanism app/copilot/useDraftAnswer.js demonstrates as a
      POSITIVE CONTROL below). Rule TR-1's exact shape: a widened
      surface with a real, if incidental, test consumer -- not a lost
      feature.
356 -> 357: AppViewDialog.js#saveTrustedNames, F-1's client-caller fix
-- real call site (`onSaveNames`, fired by PrepPackPanel.js's "Save"
button) is inside its OWN module, uncounted by cross-module edges (the
shape `answerLocal.js#groundingCandidates` shows above); it lands
here, not ORPHAN_EXPORTS (unmoved at 70), via the new
AppViewDialog.wiring.test.js's by-name import.
357 -> 361: N29 (the manual "prepare me for this interview" trigger)
and N41 (removing both interview-prep spend caps) widened four
modules' export surfaces the same way `saveTrustedNames` did just
above -- each symbol has a real call site inside its OWN module, and
its only CROSS-module consumer is the by-name import in the RED
acceptance test its own chunk landed with:
  app/api/interview-prep/route.js#triggerClassOf -- the allowlist/
    fail-safe-default helper the POST handler calls at route.js:311;
    route.triggerClass.test.js's `import { triggerClassOf } from
    "./route.js"` is the sole cross-module edge.
  app/components/AppViewDialog.js#messageFor and #fetchPrep --
    messageFor maps a usePrepGeneration result to the transient
    banner text (called at :201); fetchPrep re-reads a pack after a
    manual generate (called at :170 and :190). Both are imported by
    name from the same file, AppViewDialog.messageFor.test.js.
  app/components/tracking/PrepPackPanel.js#prepActionState -- the
    Generate control's status-to-label precedence, called at :363;
    PrepPackPanel.generate.test.js's by-name import lands it here.
Checked the opposite direction too: app/hooks/usePrepGeneration.js's
own export, `usePrepGeneration` -- the hook these four actually wire
the Generate control through -- is reachable and in NEITHER bucket:
AppViewDialog.js imports and calls it directly (:13, :174), so this
is a widened surface around a real feature, not a stranded one.
361 -> 364 (N45/N46 substrate): three pure helpers with a real call
site inside their OWN module and a by-name test importer:
  lib/interviewPrep/prepClaims.js#mintClaimId -- called internally by
    mintUniqueClaimId; prepClaims.test.js imports it directly to pin
    the `c/<section>/<hex>` shape and the section-name THROW. STILL
    here -- route.js never calls it directly, only mintSectionClaims.
  lib/interviewPrep/prepClaims.js#mintSectionClaims -- AC-CLAIM.9's own
    unit, imported by name only from prepClaims.test.js at the time.
  lib/interviewPrep/prepStore.js#pruneSectionRevisions -- AC-RET.1-3's
    retention unit, imported by name only from
    prepSectionRevisions.test.js; not yet triggered from any route
    handler in this wave (S7c's own history-append wiring landed
    without it -- retention is real, disclosed, deferred work, not
    this round's to add unasked).
364 -> 363 (N45/N46 S7c/S8): mintSectionClaims LEAVES this bucket --
route.js now imports it directly (both the whole-pack path, via
lib/interviewPrep/prepGenerationMerge.js's buildWholeCandidate, and
the section-scoped path, which calls it inline) -- a real shipping
consumer, not merely a test one. mintClaimId and pruneSectionRevisions
are unmoved; route.js still never calls either directly.
363 -> 362 -> 363 (N35 fix round, both halves of the same uncommitted
change): lib/document/coverLetterWeave.js#PLACEMENTS LEAVES this bucket
-- lib/acceptedFacts/factInsertion.js now imports it directly (the
verifier's own ruling: a hand-copied local anchor table had silently
dropped PLACEMENTS' `position` field). coverLetterWeave.js
#DEFAULT_PLACEMENT, imported at the same time, was already a real
shipping consumer of CompanyResearchDialog.js and does not move. That
-1 is exactly offset by a +1 from the SAME round's M4 fix:
lib/acceptedFacts/factStore.js#sanitizeStoredFacts is called only
inside factStore.js's own acceptFactsForJob (a same-module call this
index does not count, the AppViewDialog.js#saveTrustedNames shape
above), and its only cross-module reader is
factStore.sanitize.test.js's by-name import -- the ordinary TR-1
pattern, ENTERING this bucket the moment that guard was added. The
literal was pinned at 362 from the PLACEMENTS half alone, before
sanitizeStoredFacts existed in the same diff; re-run today it nets
back to 363, verified against the real import graph with each half in
isolation (PLACEMENTS absent + sanitizeStoredFacts present -> 363;
PLACEMENTS present + sanitizeStoredFacts absent -> 363; both present,
this checkout -> 363) as well as against the combined tree.
364 as of N69: the spacing tests read WORDPROCESSINGML_NS from docx.js
rather than re-typing the OOXML namespace string, which moved that
export out of the orphan ledger and into this bucket. A duplicated
namespace literal in a test is a worse outcome than a counted
test-only consumer -- the two would drift and the test would then be
asserting against a namespace the document does not use.
365 -> 366 (N92 Wave 1): lib/acceptedFacts/factMove.js's `sentenceBounds`
is exported for AC-A10's own direct segmenter unit
(factMove.sentenceBounds.test.js); its only Wave-1 consumer is that
test -- `planMoveFact` calls it internally, a same-module call this
index does not count (the sanitizeStoredFacts precedent above).
`planMoveFact` itself is NOT counted here: it has a real production
importer (useCompanyResearch.js's `moveInsertedFact`), so
ORPHAN_EXPORTS is unmoved at 70. One entry added to this bucket, none
added to the orphan ledger.
366 -> 368 (N92 Wave 3, net +2 of three ins, one out): the new
lib/coverFacts/smoothTransition.js exports `scopeSentences` and
`checkScope` (+2) -- each is called only from WITHIN that same module
(a same-module call this index does not count, same precedent) and
its only cross-module readers are smoothTransition.guards.test.js's
by-name imports. `SMOOTH_ENDPOINT` (+1) is read the same way, only by
smoothTransition.confirmPersist.rc.test.js -- app/components/
DocumentPreviewMount.js imports requestSmoothTransition/
confirmSmoothTransition/declineSmoothTransition directly, never this
constant. `checkAddedTokens` is NOT counted here despite also being
imported by that same test file: app/api/cover-fact-smooth/route.js
imports it too, a real production consumer, so it is reachable, not
test-referenced-only. Offsetting one of those three:
lib/acceptedFacts/factMove.js's `sentenceBounds` LEAVES this bucket
(-1) -- smoothTransition.js now imports it in production (deriving the
three in-scope sentences for a smoothing request), so it gains the
real cross-module consumer it lacked in Wave 1. Net 365 (Wave 1) + 3
(Wave 3 additions) - 1 (Wave 3's own production pickup) = ... restated
from THIS assertion's own prior value: 366 + 3 - 1 = 368.
ORPHAN_EXPORTS is unmoved at 70: every other Wave 3 export
(requestSmoothTransition, confirmSmoothTransition,
declineSmoothTransition) has a real production importer
(DocumentPreviewMount.js), and the route file itself is an entry
point, never counted as an orphan export of a module.
368 -> 386 (N105/N106 slice, net +18 of 19 in, 1 out). IN, by name:
  docx.js x7 -- HYPOTHETICAL_TOKEN (named imports in two suites) plus the
    six ex-orphans that arrived only via docx.hypotheticalMarker.test.js's
    namespace import (see ORPHAN_EXPORTS above);
  lib/review x9 -- contract.js#FLOOR_CATEGORIES, #assertWellFormed;
    flagPresentation.js#CHECK_LABELS, #FLAG_PRESENTATION, #REMOVAL_REASONS,
    #evidenceNote, #presentFlag; index.js#CATEGORY, #ORIGIN (suites pin the
    vocabulary tables and presenters by name; no shipping module imports
    these names);
  RemovedClaimsList.js#default (IdealResultBands imports its named
  LeftOutGroup/RemovedGroup instead), idealChainConfig.js#IDEAL_WORST_CASE_MS
  and idealDelivery.js#shouldAutoOpenIdealPreview, one each. The last stays
  here at the N107 go-live: only resolveIdealChipDelivery calls it, inside
  its own module, and page.js imports that wrapper instead.
OUT (1): lib/resume/parseEmployment.js#extractDateRange, which gained real
shipping importers (idealChronology.js and idealRealMaterial.js).
ORPHAN_EXPORTS moved separately (70 -> 67).
N104: 386 -> 385. flagPresentation.js#presentFlag gained a shipping
consumer (lib/review/classifyWeaknesses.js derives its 3 buckets from
presentFlag(...).tier), so it is no longer test-only.
N104 D/E: 385 -> 386 (+2, -1): regenerateSubmit.js#appendRegenerateFields and
#submitRegenerate, pinned by name by regenerateSubmit.test.js; only same-module callers.
N102: 386 -> 391 (+5): app/settings/answerAsMe.js#ANSWER_AS_ME_STORAGE_KEY,
#DEFAULT_ANSWER_AS_ME, #normalizeAnswerAsMe, #subscribe, #setAnswerAsMe -- pinned by
name by answerAsMe.test.js and used only inside their own module in production. The
other two exports stay OUT of this bucket: readAnswerAsMe has a shipping consumer
(lib/chat/chatbot.js) and useAnswerAsMe has one (app/components/ChatPanel.js).
N115 r2: 391 -> 392 (+1, -0): flagPresentation.js#groupFlagsBySpan LEFT the
reachable set. Its three shipping importers (ReviewFlagsPanel, IdealResultBands,
reviewPresentation) now call the new flagRows, which wraps it inside its own
module, so only flagPresentation.test.js still imports it. flagRows has shipping
importers and is in neither bucket; nothing joined the orphan half.
N125 wave A: 392 -> 394 (+2, -0): answerSessionCache.js#idealProjectPoolCache and
#idealProjectTailoredCache, pinned by name by idealProjectCaches.test.js and imported
by no shipping module YET (the N125 resolver that reads them lands in a later wave,
which takes both back out of this bucket). Test-referenced, not orphan: a suite does
import them. ORPHAN_EXPORTS unmoved at 66.
N125 wave B: 394 -> 396 (+4, -2). OUT (-2): the two ideal-project caches, now imported by
idealProjectResolver.js (shipping). IN (+4), from that resolver, pinned by name by
idealProjectResolver.test.js and reached by shipping code only through its idealPoolFor:
idealProjectPoolKey, idealProjectQuestionKey, startIdealProjectResolution, peekIdealProject.
Every other new export has a shipping importer (idealPoolFor, idealProjectTailoredKey,
resolveTailoredIdealProject, enrichIdealProject, fetchIdealProject, useIdealProject,
IdealProjectScope). ORPHAN_EXPORTS unmoved at 66.
N141: 396 -> 391 (-5, +0): the ideal-project / ready-example feature was deleted
whole. OUT (-5), each deleted with its module: idealProjectResolver.js's four
test-referenced symbols (idealProjectPoolKey, idealProjectQuestionKey,
startIdealProjectResolution, peekIdealProject) and idealProject.js#MAX_METRICS
(pinned by name by idealProjectMetrics.test.js, imported by no shipping module).
The two ideal-project caches were REMOVED from answerSessionCache.js together with
idealProjectCaches.test.js, so they leave the census outright rather than falling
back into this bucket. Nothing joined: no surviving module lost its only shipping
importer to the deletion. Measured by running the sweep's own scan over a HEAD
checkout and over the post-removal tree: the symmetric difference is exactly these
five (and ORPHAN_EXPORTS' MAX_SHAPE_TERMS, section 3).
N143: 391 -> 407 (+16, -0): the example-projects feature (invented "Ready example" /
"Example for this question" rows under a drafted answer). IN (+16), by name and by
module, each pinned by name by its module's own suite, each called ONLY from inside its
own module in production (so none is dead, and none is an orphan -- a suite does import
it):
  lib/copilot/projectExampleGen.js x11 -- the owner-tunable constants PROJECT_POOL_SIZE,
    POOL_BULLETS_MAX, POOL_BULLET_MAX_WORDS, POOL_TITLE_MAX_WORDS,
    POOL_GENERATION_TIMEOUT_MS, ON_THE_SPOT_TIMEOUT_MS (read by the prompts, the parser
    and the generate functions' default timeout), and the pure helpers buildPoolPrompt,
    buildOnTheSpotPrompt, parsePoolResponse, parseOnTheSpotResponse, stripPostingFigures
    (all four are called by generateProjectPool / generateOnTheSpotProject, which the two
    new routes import);
  lib/copilot/projectExampleSelect.js x2 -- POOL_FIT_THRESHOLD (read by selectPoolProject)
    and POOL_PENDING_MAX_AGE (read by isStalePending);
  lib/copilot/projectPoolPrewarm.js x1 -- AUTO_PROJECT_POOL_MAX_AGE_HOURS (read by
    selectAutoProjectPoolTargets);
  lib/copilot/projectExampleLive.js x2 -- ROW2_PENDING_MAX_MS (the default of
    startProjectExampleLive's watchdog) and normalizeLiveResult (called by it).
Every other export the feature added has a shipping importer and is in neither bucket:
generateProjectPool, generateOnTheSpotProject (the two routes), selectPoolProject,
isStalePending, buildProjectExample, selectAutoProjectPoolTargets,
AUTO_PROJECT_POOL_CONCURRENCY, getProjectPool, listProjectPools, upsertProjectPool,
finalProjectExample, projectExampleFromResponse, startProjectExampleLive,
fetchProjectExampleLive (answerClient.js, via the namespace import in useDraftAnswer.js
and useSampleAnswer.js), useApplicationProjectPool (page.js, CopilotClient.js,
PracticeClient.js). No new module is unreachable. ORPHAN_EXPORTS unmoved at 65. Measured
by running the sweep's own scan (exportReachability.scan.js) over the post-wave tree and
classifying every export of the fifteen files the feature touched.
N149: 407 -> 410 (+3, -0): "More detail" expanders elaborate with general knowledge, with
the materials as context. IN (+3), by name:
  lib/copilot/expansionPrompt.js#MAX_CONTEXT_CHARS -- the resume slice bound (4000),
    read inside buildExpansionUserTurn and pinned by name by expansionPrompt.test.js and
    expand/route.test.js; no shipping module imports it;
  lib/copilot/expansionTimeouts.js#DEFAULT_EXPANSION_SERVER_TIMEOUT_MS -- read only by
    clampExpansionServerTimeout inside its own module, pinned by name by
    expansionTimeouts.test.js and expansionStore.test.js;
  lib/copilot/answerLocal.js#isPastWorkLine -- LEFT the reachable set. Its only shipping
    importer was expansionHonesty.js, which retired it (the quote-everything cage that
    reached it, composedPasses, is deleted). It is still called inside answerLocal.js and
    still imported by name by answerLocal.test.js, so it lands here and not in the
    orphan half; it was not deleted.
Every other export the change added has a shipping importer and is in neither bucket:
answerLocal.js#namedEntityTokens (expansionHonesty.js), expansionTimeouts.js's
EXPANSION_CLIENT_TIMEOUT_MS (expansionClient.js) and clampExpansionServerTimeout
(lib/config/env.js), env.js#getExpansionTimeoutMs (expand/route.js). The one new module, lib/copilot/expansionTimeouts.js, is reachable
(expansionClient.js and env.js import it). projectStories.js#significantTerms also lost
its expansionHonesty.js importer but keeps many other shipping importers, so it did not
move. ORPHAN_EXPORTS unmoved at 65. Measured by running the sweep's own scan over the
post-change tree and classifying every export of the files the change touched.
N150: 410 -> 422 (+12, -0): the tech-buzzwords row (LLM-suggested terms under a drafted
answer, each expandable to a short general explanation). IN (+12), by name and by module,
each pinned by name by its module's own suite and each read ONLY from inside its own
module in production (so none is dead, and none is an orphan -- a suite does import it):
  lib/copilot/techTermsGen.js x6 -- the owner-tunable constants TECH_TERMS_COUNT,
    TECH_TERM_MAX_WORDS, TECH_TERMS_GEN_TIMEOUT_MS and TECH_TERMS_SYSTEM (read by the
    prompt builder, the parser and generateTechTerms' default timeout), and the pure
    helpers buildTechTermsPrompt and parseTechTermsResponse (both called by
    generateTechTerms, which the tech-terms route imports);
  lib/copilot/techTermDetailHonesty.js x2 -- TECH_TERM_DETAIL_MAX_SENTENCES and
    isFirstPersonClaim (both read by sanitizeTechTermDetail, which the tech-term-detail
    route imports);
  lib/copilot/techTermDetailStore.js x2 -- TECH_TERM_DETAIL_STORE_MAX (the LRU bound,
    read by the store's own write) and resetTechTermDetailStore (the store's test-only
    reset, the same role resetExpansionStore plays; never called from application code);
  lib/copilot/techTermsLive.js x2 -- TECH_TERMS_PENDING_MAX_MS (the default of
    startTechTerms' watchdog) and normalizeTechTermsResult (called by it).
Every other export the feature added has a shipping importer and is in neither bucket:
generateTechTerms (tech-terms route), TECH_TERM_DETAIL_SYSTEM and
buildTechTermDetailUserTurn (tech-term-detail route), sanitizeTechTermDetail
(tech-term-detail route), TECH_TERM_MAX_CHARS (the detail route and techTermsGen.js) and
techTermDetailKey (useTechTermDetails.js), subscribe / getSnapshot / getTechTermDetail /
beginTechTermDetail (useTechTermDetails.js), fetchTechTermDetail (useTechTermDetails.js),
startTechTerms (useDraftAnswer.js, useSampleAnswer.js, useRoomQuestions.js),
fetchTechTerms (answerClient.js, via the namespace import in the same three hooks), and
TechTermDetailScope / useTechTermDetailApi (CopilotClient.js, PracticeClient.js and
AnswerAids.js). No new module is unreachable: ALLOWED_UNREACHABLE_MODULES and
UNWIRED_MODULES unmoved at 14 and 5. ORPHAN_EXPORTS unmoved at 65. Measured by running
the sweep's own scan (exportReachability.scan.js) over the post-wire tree and
classifying every export of the ten new modules (seven under lib/copilot, the two
routes, useTechTermDetails.js) and the files the feature edited; the twelve names above
are the complete symmetric difference against the N149 baseline.

N151a: 422 -> 423 (+1, -0): the template library store and the mark-from-materials
control. IN (+1), by name: lib/document/templateSelectionStore.js#getSelection, the
read of a user's (user_id, kind) selection row. It is called only from inside its own
module in production (getActiveTemplateBytes resolves the selection through it) and
is pinned by name by templateSelectionStore.test.js; the library GET route does not
read it yet -- the N151b switcher is its first shipping consumer, so it is a widened
surface awaiting that chunk, not a dead one. Every other export the chunk added has a
shipping importer and is in neither bucket: setSelection (library route), and
getActiveTemplateBytes (default route), listTemplates / registerTemplate /
deleteTemplate (library route), registerTemplateFromBytes (useMaterialsLocker.js), and
the new routes' GET / POST / DELETE (Next.js entries). No new module is unreachable:
ALLOWED_UNREACHABLE_MODULES and UNWIRED_MODULES unmoved at 14 and 5. ORPHAN_EXPORTS
unmoved at 65. Measured by running the sweep's own scan (exportReachability.scan.js)
over the post-change tree and listing every export of the three new lib modules; the
one name above is the complete symmetric difference against the N150 baseline.
N151b: 423 -> 422 (+0, -1): the template switcher. OUT (-1), by name:
lib/document/templateSelectionStore.js#getSelection -- the N151a entry above, which
said its first shipping consumer would be the switcher: the library GET route now reads
it (the response's selectedId), so it has a production importer and leaves the bucket.
Nothing came in: every export the chunk added has a shipping importer and is in neither
bucket -- useTemplateLibrary (page.js), TemplateLibraryPanel's default export
(ApplyingControls.js), listLibraryTemplates / selectLibraryTemplate /
deleteLibraryTemplate (useTemplateLibrary.js), and the library route's new PUT (a
Next.js entry). No new module is unreachable: ALLOWED_UNREACHABLE_MODULES and
UNWIRED_MODULES unmoved at 14 and 5. ORPHAN_EXPORTS unmoved at 65. Measured by running
the sweep's own scan (exportReachability.scan.js) over the post-change tree and
listing every export of the two new modules and the files the chunk edited; the one
name above is the complete symmetric difference against the N151a baseline.
N153: 422 -> 424 (+2, -0): prefetch-on-render for the two per-click expanders. IN (+2),
by name, both in the one new pure module lib/copilot/prefetchQueue.js, both pinned by
name by prefetchQueue.test.js and both read ONLY from inside their own module in
production (so neither is dead, and neither is an orphan -- the suite imports them):
  lib/copilot/prefetchQueue.js#PREFETCH_CONCURRENCY -- the owner-tunable in-flight
    bound (3), the default of createPrefetchQueue;
  lib/copilot/prefetchQueue.js#createPrefetchQueue -- the factory the shared singleton
    is built from; the suite builds local queues with it to pin the concurrency bound
    and the two-layer dedupe without touching module-scope state.
Every other export the chunk added has a shipping importer and is in neither bucket:
copilotPrefetchQueue (useAnswerExpansions.js and useTechTermDetails.js) and
useWarmOnMount (ExpansionPanel.js and AnswerAids.js); the keyFor / prefetch methods are
properties of the two apis, not exports. No new module is unreachable:
ALLOWED_UNREACHABLE_MODULES and UNWIRED_MODULES unmoved at 14 and 5. ORPHAN_EXPORTS
unmoved at 65. Measured by running the sweep's own scan (exportReachability.scan.js)
over the post-change tree and listing every export of the two new modules and the files
the chunk edited; the two names above are the complete symmetric difference against the
N151b baseline.
N154: 424 -> 426 (+3, -1): the per-bullet "More detail" on the invented example-project
rows. IN (+3), by name, each pinned by name by its module's own suite and each read ONLY
from inside its own module in production (so none is dead, and none is an orphan -- a
suite does import it):
  lib/copilot/projectBulletDetailHonesty.js#PROJECT_BULLET_DETAIL_MAX_SENTENCES -- the
    owner-tunable sentence cap (6), read by sanitizeProjectBulletDetail;
  lib/copilot/projectBulletDetailStore.js#PROJECT_BULLET_DETAIL_STORE_MAX -- the LRU
    bound (200), read by the store's own write;
  lib/copilot/projectBulletDetailStore.js#resetProjectBulletDetailStore -- the store's
    test-only reset, the same role resetTechTermDetailStore plays; never called from
    application code.
OUT (-1), by name: lib/copilot/techTermDetailHonesty.js#isFirstPersonClaim -- the N150
entry above, which was test-referenced only; the new gate (projectBulletDetailHonesty.js,
reached from the project-bullet-detail route) imports it, so it has a production importer
and leaves the bucket. techTermDetailHonesty.js also gained two exports, stripMarkup and
splitSentences, both imported by that same gate, so neither is in either bucket.
Every other export the chunk added has a shipping importer and is in neither bucket:
projectBulletDetailKey and the three bound constants (the route, the prompt and
useProjectBulletDetails.js), PROJECT_BULLET_DETAIL_SYSTEM and
buildProjectBulletDetailUserTurn (the route), sanitizeProjectBulletDetail (the route),
fetchProjectBulletDetail (useProjectBulletDetails.js), subscribe / getSnapshot /
getProjectBulletDetail / beginProjectBulletDetail (useProjectBulletDetails.js),
ProjectBulletDetailScope / useProjectBulletDetailApi (CopilotClient.js, PracticeClient.js
and ProjectBulletDetail.js), ProjectBulletDetail's default export (AnswerAids.js), and the
new route's POST (a Next.js entry). No new module is unreachable:
ALLOWED_UNREACHABLE_MODULES and UNWIRED_MODULES unmoved at 14 and 5. ORPHAN_EXPORTS
unmoved at 65. Measured by running the sweep's own scan (exportReachability.scan.js) over
the post-change tree and listing every export of the eight new modules and the files the
chunk edited; the four names above are the complete symmetric difference against the N153
baseline.
N156: 426 -> 427 (+1, -0): the live-Clear two-step confirm (safety footgun fix).
IN (+1), by name:
  app/copilot/SessionControls.js#CLEAR_CONFIRM_WINDOW_MS -- the auto-revert window (4000ms)
    for the inline "Confirm clear?" arm state; read ONLY inside SessionControls' own
    setTimeout in production, and imported by SessionControls.compact.test.js (via a
    namespace import, which the scan credits as a test consumer through the `file#*` edge),
    so it is test-referenced, not an orphan. No feature was built-and-never-connected: the
    window governs behaviour the component already uses. ORPHAN_EXPORTS unmoved at 65;
    ALLOWED_UNREACHABLE_MODULES / UNWIRED_MODULES unmoved at 14 / 5.
N157 SC-gen: 427 -> 439 (+12, -0): the generation route wires the study-plan modules into
the shipping graph, so their exports are classified per symbol for the first time (a wholly
unreachable module sits in no symbol bucket). Measured with the sweep's own scan over the
post-change tree: the twelve names below are every lib/studyPlan/ entry in TEST_REFERENCED,
and the count moved by exactly twelve, so no other module's exports moved.
IN (+12), by name, each read only by its own module or a test, or awaiting a named consumer:
  studyPlanContract.js#STUDY_PLAN_COLUMNS (the store reads the joined PROJECTION, not the list);
  studyPlanEvidence.js#adaptDigestToEvidence and #evidenceCitations (called by gatherEvidence
    and adaptDigestToEvidence in-module; studyPlanEvidence.test.js pins both);
  studyPlanGenerate.js#parseGeneratedPlan and #buildEmbeddedStudyPlan (called by
    generateStudyPlan in-module; studyPlanGenerate.test.js and
    studyPlanGenerate.embedded.test.js pin them);
  studyPlanSchema.js#DEFAULT_KNOBS and #STUDY_PLAN_VERSION (read by the schema's own
    normalizers), #isPartialPlan and #unsourcedTopicIds (read helpers the SC-C render will
    call), #buildProgressDelta (its only non-test importer is studyPlanProgressStore.js,
    itself unwired, section 2);
  studyPlanStore.js#readStudyPlan (the route writes a plan, it never reads one) and
    #writeStudyPlanProgress (SC-C injects it into studyPlanProgressStore.js).
Every other export of the six reachable modules has a shipping importer and is in neither
bucket: STUDY_PLANS_TABLE, MERGE_STUDY_PLAN_PROGRESS_FN, STUDY_PLAN_PROJECTION,
normalizeKnobs, normalizePlan, normalizeProgress, itemKey, isSingleItemSeenDelta,
writeStudyPlan, gatherEvidence, STUDY_PLAN_SYSTEM, buildStudyPlanUserTurn,
generateStudyPlan, and the route's POST (a Next.js entry). ORPHAN_EXPORTS unmoved at 65;
ALLOWED_UNREACHABLE_MODULES / UNWIRED_MODULES at 14 / 7.
N157 SC-C C-a: 439 -> 438 (+0, -1): the study-plan route gained the read seam for the
preserve-last-good guard. OUT (-1), by name, measured by running the sweep's own
classification twice over the same tree -- once as it stands, once with the two modified
files app/api/study-plan/route.js and lib/studyPlan/studyPlanGenerate.js (and their suites)
reverted to HEAD and the two new modules dropped -- and diffing the TR-1 key sets:
  lib/studyPlan/studyPlanStore.js#readStudyPlan -- recorded above as "the route writes a
    plan, it never reads one". app/api/study-plan/route.js now imports it at module scope and
    passes it as `readExistingPlan: (args) => readStudyPlan(supabase, args)`, the seam
    studyPlanGenerate.js uses to decide whether a stored plan is worth preserving. A
    shipping module (the route is reachable: it is a Next.js entry) asks for the name, so it
    leaves both buckets. The symmetric difference against HEAD is exactly this one key:
    nothing entered, and ORPHAN_EXPORTS is identical set-for-set.
NOT the cause, by the same measurement: studyWalkthroughModel.js imports
studyPlanSchema.js#itemKey, but (a) the scan credits only imports made by SHIPPING modules
(exportGraph.js, the `for (const rel of shipping)` pass), and studyWalkthroughModel.js is
unreachable (section 2); and (b) itemKey already had a shipping importer
(studyPlanGenerate.js) and was never in TR-1. Dropping the two new modules alone leaves the
TR-1 key set unchanged (438 either way). studyPlanStore.js#writeStudyPlanProgress stays in TR-1 (SC-C still injects
it into studyPlanProgressStore.js, unwired). ORPHAN_EXPORTS unmoved at 65;
ALLOWED_UNREACHABLE_MODULES / UNWIRED_MODULES at 14 / 9.
N157 SC-C C-c: 438 -> 441 (+7, -4): the practice mount wires the whole study-plan chain
(section 2), so the exports of every now-reachable module are classified per symbol for
the first time. Measured with the sweep's own scan, run over the tree as it stands and over
the same tree with the mount edit reverted in memory (that run reproduces 438 exactly); the
symmetric difference of the two TR-1 key sets is the eleven names below, and ORPHAN_EXPORTS
is identical set-for-set.
IN (+7), by name, each read only by its own module or a test:
  app/copilot/study/StudyEvidenceCitation.js#MAX_INLINE_SOURCES -- the inline-source cap,
    used by that module's own slice; pinned by StudyWalkthrough.citation.test.js;
  app/copilot/study/StudyPlanOverview.js#REBUILD_CONFIRM_WINDOW_MS -- the armed-rebuild
    window, used by the component's own timer; imported by StudyPlanOverview.test.js;
  app/copilot/study/useStudyWalkthrough.js#STUDY_ADVANCE_GUARD_MS -- the post-advance
    inert window, used by the hook's own timer; imported by StudyWalkthrough.advanceGuard
    .test.js and useStudyWalkthrough.navigation.test.js;
  lib/studyPlan/ensureStudyDigest.js#requestStudyDigest -- the one POST that
    ensureStudyDigest and refreshStudyDigest wrap (the shell calls those two); pinned by
    ensureStudyDigest.wire.test.js;
  lib/studyPlan/studyPlanBuild.js#resetStudyPlanBuildStore -- the test-only store reset,
    imported by studyPlanBuild.test.js and the StudyPlanClient suites;
  lib/studyPlan/studyPlanProgressStore.js#STUDY_PLAN_RECORD_STORE_MAX (the LRU bound,
    pinned by studyPlanProgressStore.test.js) and #resetStudyPlanProgressStore (the
    test-only reset, imported by that suite and the StudyPlanClient suites).
OUT (-4), by name, each gaining its first shipping importer now that the importer is
reachable:
  lib/studyPlan/studyPlanSchema.js#buildProgressDelta -- studyPlanProgressStore.js
    (recordProgress builds its one-card delta with it); section 4's SC-gen entry had
    recorded it as "its only non-test importer is studyPlanProgressStore.js, itself
    unwired";
  lib/studyPlan/studyPlanSchema.js#isPartialPlan -- study/StudyProvenanceBanner.js;
  lib/studyPlan/studyPlanSchema.js#unsourcedTopicIds -- study/StudyPlanOverview.js (the
    "Unsourced" chip per topic); both recorded at SC-gen as "read helpers the SC-C render
    will call";
  lib/studyPlan/studyPlanStore.js#writeStudyPlanProgress -- lib/studyPlan/studyPlanBrowser.js
    (the writer bound for recordProgress), recorded at SC-gen as "SC-C injects it into
    studyPlanProgressStore.js".
NOT in either list, because they have shipping importers from birth: the new modules'
other exports (studyPlanBuild.js#BUILD_INTENTS, #run, #skipsResearch, #subscribe,
#getSnapshot, #getBuildState; studyPlanBrowser.js#bindStudyPlan;
studyPlanBuildClient.js#requestStudyPlanBuild; studyPlanNotices.js#buildStudyPlanNotice,
#fillStudyCopy; studyWalkthroughModel.js and studyPlanCopy.js, every export). BUILD_INTENTS
is an object whose members StudyPlanClient.js names, which is what keeps it out of this list.
ORPHAN_EXPORTS unmoved at 65; ALLOWED_UNREACHABLE_MODULES / UNWIRED_MODULES at 14 / 5.
N157 SC-D: 441 -> 444 (+4, -1): the customization controls (D-a pure model + D-b hook,
panel and shell wiring). Measured with the sweep's own scan run over two trees and the TR-1
key sets diffed: the tree as it stands, and the committed HEAD tree extracted with
`git archive` into a scratch directory (that run reproduces 441 / 65 / 506 and 19 unreachable
modules exactly, which is what makes the diff trustworthy). The symmetric difference is the
five names below, ORPHAN_EXPORTS is identical set-for-set, and the unreachable-module set is
identical set-for-set.
IN (+4), by name, each read only by its own module or a test:
  lib/studyPlan/studyPlanKnobs.js#MIN_PLAN_DAYS -- the lower bound of the days field, used by
    setDaysUntil in-module; pinned to 1 by studyPlanKnobs.test.js;
  lib/studyPlan/studyPlanKnobs.js#MAX_AREA_OPTIONS -- the row cap of the Areas list, used by
    areaOptions in-module; pinned as a positive integer and exercised by the cap rows of
    studyPlanKnobs.test.js;
  lib/studyPlan/studyPlanKnobs.js#MAX_AREA_LABEL -- the label slice, used by labelOf in-module;
    same suite, same reason;
  lib/studyPlan/studyPlanKnobs.js#areaOf -- the topic-to-area-label helper, called by areaOptions
    and suggestFocusAreas in-module; oracle rows 1-2 (and the labels-not-ids canary) of
    studyPlanKnobs.test.js.
  All four are the retunable caps and one pure helper that a unit suite reads directly, the
  widened-surface shape this bucket exists to count; none is a feature built and never
  connected (the controls' own call sites use the other fourteen exports, below).
OUT (-1), by name, gaining its first shipping importer:
  lib/tracking/applicationDigest.js#DIGEST_SECTIONS -- recorded when the model was designed as
    "exported, but its only importers are its own file and its test". app/copilot/study/
    StudyPlanClient.js now imports it and passes it to areaOptions as `seedAreas`, so the
    pre-first-plan Areas list is the seven digest headings (the pure model deliberately does
    not import it).
NOT in either list, because they have shipping importers from birth: studyPlanKnobs.js's other
fourteen exports (AREA_STATE, MAX_PLAN_DAYS, RATIO_PRESETS, areaState, setAreaState,
setNewReviewRatio, ratioPresetId, setDaysUntil, knobEffects and summarizeKnobs, imported by
study/StudyPlanControls.js; areaOptions, isBuildableKnobs and suggestFocusAreas, by
study/StudyPlanClient.js; knobsEqual, by study/useStudyKnobs.js), and the default exports of
useStudyKnobs.js and StudyPlanControls.js (StudyPlanClient.js). studyPlanCopy.js gained no
export (the knobs group and the notice.gemini sentence are strings inside STUDY_COPY).
ORPHAN_EXPORTS unmoved at 65; ALLOWED_UNREACHABLE_MODULES / UNWIRED_MODULES unmoved at 14 / 5.
N145-N146a Wave A1: 444 -> 445 (+1, -0): the privacy-notice assembly moved out of
app/copilot/practice/PracticeClient.js into lib/copilot/practiceNotices.js to bring that file
back under its 950-line ceiling. Measured with the sweep's own scan (the TR-1 key set printed
after the move; the only practiceNotices.js key in it is the one below, and
practiceRoomQuestionPrivacy.js has none).
IN (+1), by name, losing its only shipping importer:
  lib/copilot/practiceNotices.js#buildPrivacyNotice -- PracticeClient.js used to import and call
    it directly; it now imports buildPracticeNotice, which calls buildPrivacyNotice from inside
    practiceNotices.js (an in-module call is not an importer). Its importers are now tests only
    (practiceNotices.test.js, practiceNotices.noPreDraft.test.js, knowledgeBaseDisclosure.test.js
    and practiceNotices.buildPracticeNotice.test.js), which pin its wording. It is the same
    widened-surface shape this bucket counts: a helper kept exported so the unit suites can
    sweep its 256 flag combinations directly, not a feature built and never connected (it is
    still on the live path, one call deeper).
OUT (-0): none.
NOT in either list, because they have a shipping importer from birth: buildPracticeNotice and
submittedDocsFlagsFor (both imported by PracticeClient.js), which are the two exports this move
added. roomQuestionPrivacyClause (practiceRoomQuestionPrivacy.js) keeps its PracticeClient.js
importer, because the room-question sentence is still composed at the call site and handed to
buildPracticeNotice as a string.
ORPHAN_EXPORTS unmoved at 65; ALLOWED_UNREACHABLE_MODULES / UNWIRED_MODULES unmoved at 14 / 5.
```

---

## 5. UNUSED_IN_SHIPPING_MODULES total: movement notes (pinned at 510)

```text
356 -> 354: exactly the two orphan symbols that were deleted
(matchesIncludedCompany, deleteInterviewStage). The two SEPARATORs
crossed from one half of the split to the other, which is invisible in
this total by construction -- 300 + 56 and 298 + 56 differ by the two
deletions alone.
354 -> 359: exactly the five above, with ORPHAN_EXPORTS unmoved at 56.
The activity log deliberately contributes ZERO orphans -- two constants
it started with (MAX_ACTIVITY_FIELD_CHARS, truncateField in
activityRedaction.js) were caught by this very assertion on their first
run and un-exported, because both are applied inside that module and read
nowhere else.
359 -> 360: the single reclassified clientIpFromHeaders described above,
with ORPHAN_EXPORTS again unmoved at 56 -- 304 + 56. This total moving by
exactly one, in step with TEST_REFERENCED and with the orphan half
frozen, is what says the change was a bucket move rather than a new
export surface.
360 -> 368: the bullet-truncation chunk's eight, ALL of them in the orphan
half -- 304 + 64. Note which way this went, because the first reading of
it was wrong: the eight look like rule TR-1's shape (a widened surface a
suite pins directly) and they were briefly recorded as such, but TR-1's
index follows STATIC imports only and seven of the eight are read through
a dynamic `await load()`. The census reported them as orphans, which is
what this file's numbers actually say; the enumerated ledger is what
carries the truth that a test does read them.
368 -> 399 = 336 + 63, and the two halves moved in OPPOSITE directions:
rule TR-1's bucket gained 32 as two large features widened their export
surfaces for their unit suites, while the orphan half LOST one on net
because `standsAlone` and `materialQuote` finally gained real importers.
A feature built and never wired would have moved both the same way; that
it did not is the evidence this total cannot show on its own, which is why
the split assertion above is the one that matters.
399 -> 405 = 342 + 63, with the orphan half FROZEN. The citation-detail
chunk added no orphan at all: its one public entry point is imported by
the answer route, and every other export it added is read by name from
a static import in its own suite. A feature built and never wired would
have shown up in the other half.
405 -> 414 = 351 + 63, the orphan half again FROZEN. Same reading as the
citation-detail chunk before it: the glossary hover's nine are all
thresholds, wording constants and an enumeration that its suites read by
name from static imports, and its two new components are both reached
from AnswerLines.js.
414 -> 413 = 350 + 63, orphan half still FROZEN. The single step down is
GlossaryProvider gaining its mount, described at the TR-1 assertion above.
Note the direction: every other movement in this file's history has been
upward, as features widened their export surfaces. A DECREASE here means
shipping code started asking for something only a test used to ask for.
413 -> 426 = 355 + 71, both halves widening together (see each
assertion's own comment above for its half of IP3's thirteen). Both
moving the same direction is expected here, not a red flag on its own --
the split assertion just above is what would catch a feature built and
never wired, and neither half of IP3's total came from a bucket move.
426 -> 427, the orphan half unmoved -- but that total was previously
recorded here as a single clean +1 (only newerQuestionCount moving),
and that comment was itself wrong (M2, fresh delta review): it is a
net of TWO arrivals and ONE departure, not one arrival alone. All
three, by name:
  => lib/copilot/cuePolicy.js#effectiveAttribution (IN, undocumented
     until now): its own suite, cuePolicy.effective.test.js, is the
     ONLY static importer anywhere in the tree -- every production
     call (qualifiesForCue, resolveCueAction, cueAvailabilityNotice,
     cueRowNote) is internal to cuePolicy.js itself, so rule TR-1's
     bucket is exactly where this belongs: reachable in practice
     through its own module, but not imported BY NAME from any
     shipping module.
  => lib/copilot/currentQuestion.js#newerQuestionCount (IN, as
     before): the N18 delta review F1 pin retirement deleted
     lib/copilot/questionPin.js and app/copilot/useQuestionPin.js
     outright, and that deletion was the sole shipping importer of
     this export -- currentQuestion.test.js already imported it
     directly, so losing its production caller moved it from
     "reachable" into rule TR-1's bucket rather than into
     ORPHAN_EXPORTS.
  <= lib/copilot/questionPin.js#PIN_SUPERSEDED_MAX_MS (OUT): the SAME
     deletion did not merely leave this bucket unaffected, as the
     previous comment claimed ("their own exports leave the graph
     entirely, not this bucket") -- this export WAS already counted
     inside it (rule TR-1's own shape: a test-only constant on a
     module with a real shipping entry point), so deleting the whole
     module removed it from the graph AND from this bucket. Its
     departure is what masked effectiveAttribution's arrival: +2/-1
     nets to the same +1 the old comment described, by coincidence,
     not by the reasoning it gave.
427 -> 428: prepPack.js (N16 wave B), described just above at the
TEST_REFERENCED assertion -- wiring `packStatus` into route.js made
the module reachable, and its lone unreached export, `completeSections`,
is why the total rises by one rather than two: `packStatus` itself is
an ordinary reachable export, not counted in either half of this split.
428 -> 427 (N16 wave D): prepParse.js#containsDetectedName LEFT the orphan
ledger because it gained a real shipping consumer -- buildEmbeddedPack (now
in prepPack.js) screens `position.title`/`company` through it before
interpolating them, since those values come from external job feeds and are
not our own text. ONE movement, OUT, none in. Stated by name because this
count has been bumped before with a comment naming a single movement when
the real delta was +2/-1.
427 -> 426: the same -1 net described just above, in step with
TEST_REFERENCED -- ORPHAN_EXPORTS is unmoved at 70 throughout, so the
total's -1 IS the TR-1 bucket's -1, not a second, independent change.
426 -> 427: saveTrustedNames (see the TEST_REFERENCED assertion above).
427 -> 431: the same four described just above at the TEST_REFERENCED
assertion (triggerClassOf, messageFor, fetchPrep, prepActionState),
with ORPHAN_EXPORTS unmoved at 70 -- this total's +4 IS the TR-1
bucket's +4, not a second, independent change.
431 -> 436 (N45/N46 substrate): TR-1's own +3 (mintClaimId,
mintSectionClaims, pruneSectionRevisions) plus ORPHAN_EXPORTS' own +2
(PREP_REVISION_COLUMNS, PREP_REVISION_LIST_COLUMNS) -- both described
at their own assertions above; this total was exactly their sum.
436 -> 435 (N45/N46 S7c/S8): TR-1's own -1 (mintSectionClaims wired
into route.js -- see that assertion above), ORPHAN_EXPORTS unmoved at
72. The new pure modules this wave adds (lib/interviewPrep/
prepSection.js, lib/interviewPrep/prepGenerationMerge.js) contribute
NOTHING to either bucket: every export of both is imported by name
from route.js (a real shipping consumer) -- prepGenerationMerge.js's
own `mintWholeReplace` is deliberately module-private rather than
exported for exactly this reason, since its only caller is inside the
same file.
435 -> 436 (N92 Wave 1): exactly TEST_REFERENCED's own +1
(sentenceBounds, described at that assertion above), with
ORPHAN_EXPORTS unmoved at 70 -- this total's +1 IS the TEST_REFERENCED
bucket's +1, not a second, independent change.
436 -> 438 (N92 Wave 3): exactly TEST_REFERENCED's own net +2
(scopeSentences, checkScope, SMOOTH_ENDPOINT in; sentenceBounds out --
described at that assertion above), with ORPHAN_EXPORTS unmoved at 70
-- this total's +2 IS the TEST_REFERENCED bucket's +2, not a second,
independent change.
438 -> 453 (N105/N106 slice): TEST_REFERENCED's +18 (368 -> 386) and
ORPHAN_EXPORTS' -3 (70 -> 67), described at their own assertions above.
453 -> 452 (N107): exactly ORPHAN_EXPORTS' -1 (67 -> 66, LEVEL_CAPTIONS),
with TEST_REFERENCED unmoved at 386. The go-live's other new exports
(resolveIdealChipDelivery, idealChipPreviewContext, idealUnavailableRefusal,
useLatestRef, buildGreenhouseSearchUrl) each have a shipping importer.
N104: 452 -> 451 (presentFlag gained a shipping consumer; the new N104
module exports are all wired, so net -1). TEST_REFERENCED 385 + ORPHANS 66.
N104 D/E: 451 -> 452 (TEST_REFERENCED's +1; ORPHAN_EXPORTS unmoved at 66).
N102: 452 -> 457 (TEST_REFERENCED's +5 from answerAsMe.js; ORPHAN_EXPORTS
unmoved at 66 -- all five are test-referenced, none are new orphans).
N115 r2: 457 -> 458 (TEST_REFERENCED's +1, groupFlagsBySpan, described above;
ORPHAN_EXPORTS unmoved at 66). TEST_REFERENCED 392 + ORPHANS 66.
N125 wave A: 458 -> 460 (TEST_REFERENCED's +2, the two ideal-project caches; ORPHANS
unmoved at 66). TEST_REFERENCED 394 + ORPHANS 66.
N125 wave B: 460 -> 462 (TEST_REFERENCED's +2 net, described above; ORPHAN_EXPORTS unmoved
at 66). TEST_REFERENCED 396 + ORPHANS 66.
N141: 462 -> 456 (TEST_REFERENCED's -5, idealProjectResolver.js's four symbols and
idealProject.js#MAX_METRICS, plus ORPHAN_EXPORTS' -1, idealProject.js#MAX_SHAPE_TERMS,
all described above). TEST_REFERENCED 391 + ORPHANS 65.
N143: 456 -> 472 (TEST_REFERENCED's +16, the example-projects feature's test-pinned
constants and pure helpers, named at section 4; ORPHAN_EXPORTS unmoved at 65). The
total moving by exactly the TR-1 half's +16 with the orphan half frozen is what says
this was a widened export surface for unit suites and not a feature built and never
wired. TEST_REFERENCED 407 + ORPHANS 65.
N149: 472 -> 475 (TEST_REFERENCED's +3, named at section 4: MAX_CONTEXT_CHARS,
DEFAULT_EXPANSION_SERVER_TIMEOUT_MS, and isPastWorkLine leaving the reachable set;
ORPHAN_EXPORTS unmoved at 65). The total moving by exactly the TR-1 half's +3 with the
orphan half frozen is what says none of it is a feature built and never wired.
TEST_REFERENCED 410 + ORPHANS 65.
N150: 475 -> 487 (TEST_REFERENCED's +12, named at section 4: techTermsGen.js x6,
techTermDetailHonesty.js x2, techTermDetailStore.js x2, techTermsLive.js x2;
ORPHAN_EXPORTS unmoved at 65). The total moving by exactly the TR-1 half's +12 with the
orphan half frozen is what says this was a widened export surface for unit suites and
not a feature built and never wired. TEST_REFERENCED 422 + ORPHANS 65.
N151a: 487 -> 488 (TEST_REFERENCED's +1, templateSelectionStore.js#getSelection, named at
section 4; ORPHAN_EXPORTS unmoved at 65). The total moving by exactly the TR-1 half's +1
with the orphan half frozen is what says this was a widened export surface for a unit
suite (its N151b consumer is the switcher) and not a feature built and never wired.
TEST_REFERENCED 423 + ORPHANS 65.
N151b: 488 -> 487 (TEST_REFERENCED's -1, templateSelectionStore.js#getSelection gaining
its shipping consumer in the library GET route, named at section 4; ORPHAN_EXPORTS
unmoved at 65). The total moving by exactly the TR-1 half's -1 with the orphan half
frozen is what says a widened surface got its promised consumer, nothing was lost.
TEST_REFERENCED 422 + ORPHANS 65.
N153: 487 -> 489 (TEST_REFERENCED's +2, named at section 4: prefetchQueue.js's
PREFETCH_CONCURRENCY and createPrefetchQueue; ORPHAN_EXPORTS unmoved at 65). The total
moving by exactly the TR-1 half's +2 with the orphan half frozen is what says this was a
widened export surface for a unit suite and not a feature built and never wired.
TEST_REFERENCED 424 + ORPHANS 65.
N154: 489 -> 491 (TEST_REFERENCED's +3 -1 = +2, named at section 4: IN
PROJECT_BULLET_DETAIL_MAX_SENTENCES, PROJECT_BULLET_DETAIL_STORE_MAX and
resetProjectBulletDetailStore; OUT techTermDetailHonesty.js#isFirstPersonClaim, which
gained a shipping importer in projectBulletDetailHonesty.js; ORPHAN_EXPORTS unmoved at
65). The total moving by exactly the TR-1 half's net +2 with the orphan half frozen is
what says this was a widened export surface for unit suites and not a feature built and
never wired. TEST_REFERENCED 426 + ORPHANS 65.
N156: 491 -> 492 (TEST_REFERENCED's +1, named at section 4:
SessionControls.js#CLEAR_CONFIRM_WINDOW_MS; ORPHAN_EXPORTS unmoved at 65). The total
moving by exactly the TR-1 half's +1 with the orphan half frozen is what says this was a
single widened export for its unit suite (the Clear-confirm window, used internally by the
component) and not a feature built and never wired. TEST_REFERENCED 427 + ORPHANS 65.
N157 SC-gen: 492 -> 504 (TEST_REFERENCED's +12, the twelve study-plan symbols named at
section 4; ORPHAN_EXPORTS unmoved at 65, section 3). The total moving by exactly the TR-1
half's +12 with the orphan half frozen says this was a widened export surface for unit
suites and named later consumers, not a feature built and never wired. It moves now, not at
the earlier study-plan sub-chunks, because those modules were wholly unreachable (section
2) and such a module's exports are in neither half. TEST_REFERENCED 439 + ORPHANS 65.
N157 SC-C C-a: 504 -> 503 (TEST_REFERENCED's -1, named at section 4:
studyPlanStore.js#readStudyPlan, which gained a shipping importer when
app/api/study-plan/route.js began passing it as the preserve-last-good guard's read seam;
ORPHAN_EXPORTS unmoved at 65, section 3). The total moving by exactly the TR-1 half's -1
with the orphan half frozen is what says a widened surface got its promised consumer
(section 4 had recorded it as "the route writes a plan, it never reads one"), nothing was
lost. The two new unwired modules (studyWalkthroughModel.js, studyPlanCopy.js, section 2)
contribute NOTHING to either half: they are wholly unreachable, so their exports are in
neither. TEST_REFERENCED 438 + ORPHANS 65.
N157 SC-C C-c: 503 -> 506 (TEST_REFERENCED's +7 -4 = +3, the eleven symbols named at
section 4: IN MAX_INLINE_SOURCES, REBUILD_CONFIRM_WINDOW_MS, STUDY_ADVANCE_GUARD_MS,
requestStudyDigest, resetStudyPlanBuildStore, STUDY_PLAN_RECORD_STORE_MAX and
resetStudyPlanProgressStore; OUT buildProgressDelta, isPartialPlan, unsourcedTopicIds and
writeStudyPlanProgress, each gaining its first shipping importer; ORPHAN_EXPORTS unmoved
at 65, section 3, identical set-for-set). The total moving by exactly the TR-1 half's net
+3 with the orphan half frozen is what says this was widened export surface for unit
suites (the timing constants, the test-only resets, the wrapped POST) plus four widened
helpers that got their promised consumers, and not a feature built and never wired. It
moves now because the four study-plan modules on section 2's list became reachable, and a
wholly unreachable module's exports are in neither half. TEST_REFERENCED 441 + ORPHANS 65.
N157 SC-D: 506 -> 509 (TEST_REFERENCED's +4 -1 = +3, the five symbols named at section 4: IN
studyPlanKnobs.js#MIN_PLAN_DAYS, #MAX_AREA_OPTIONS, #MAX_AREA_LABEL and #areaOf; OUT
applicationDigest.js#DIGEST_SECTIONS, gaining its first shipping importer in StudyPlanClient.js;
ORPHAN_EXPORTS unmoved at 65, section 3, identical set-for-set). The total moving by exactly
the TR-1 half's net +3 with the orphan half frozen is what says this was a widened export
surface (three retunable caps and one pure helper, read by name by studyPlanKnobs.test.js) plus
one widened constant that got its promised consumer, and not a feature built and never wired.
The three new modules add no unreachable file (section 2), so no export sits in neither half.
TEST_REFERENCED 444 + ORPHANS 65.
N145-N146a Wave A1: 509 -> 510 (TEST_REFERENCED's +1 -0, the one symbol named at section 4: IN
practiceNotices.js#buildPrivacyNotice, whose only shipping importer PracticeClient.js now
reaches it through buildPracticeNotice instead; ORPHAN_EXPORTS unmoved at 65, section 3,
identical set-for-set). The total moving by exactly the TR-1 half's net +1 with the orphan
half frozen is what says this was a relocation of a call one level deeper and not a feature
built and never wired. No new unreachable file (section 2), so no export sits in neither half.
TEST_REFERENCED 445 + ORPHANS 65.
```
