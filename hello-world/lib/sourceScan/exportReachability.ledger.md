# Export-reachability sweep: count derivation history

This file is the audit trail for the pinned counts in
`lib/sourceScan/exportReachability.sweep.test.js`. It used to live as running
comments beside each `expect(...)` in that file, and it was most of the file:
the executable assertions are small, the history is long. It was moved here
verbatim, not summarised, to bring the test under the repo's 1000-line cap.
Nothing was dropped and no count, assertion or scan logic changed.

Each pinned count in the test file has a section below. When a count changes,
append the new delta to the matching section here (newest at the bottom, same
`old -> new (chunk): what moved, and why` shape) and update the number in the
test. State every movement by name: a total that is right by coincidence is
worse than a red one, and several entries below exist because an earlier
comment named a single movement when the real delta was +2/-1.

Current pinned values, as of the last entry in each section:

| Assertion                                   | Pinned |
| ------------------------------------------- | ------ |
| `ALLOWED_UNREACHABLE_MODULES.length`        | 14     |
| `UNWIRED_MODULES` (exact list of 5 files)   | 5      |
| `ORPHAN_EXPORTS.length`                     | 66     |
| `TEST_REFERENCED.length` (rule TR-1)        | 396    |
| `UNUSED_IN_SHIPPING_MODULES.length`         | 462    |

The identity that ties the last three together, and that the test asserts
directly, is `UNUSED_IN_SHIPPING_MODULES = TEST_REFERENCED + ORPHANS`
(396 + 66 = 462).

---

## 1. ALLOWED_UNREACHABLE_MODULES (pinned at 14)

Whole files no entry point can reach: sweep and test infrastructure, each
justified in `exportReachability.ledger.js`. Source of the history: the
comment block under "keeps a stated reason on every allow-listed module".

```text
9 -> 10: lib/interviewPrep/__fixtures__/predictionCorpus.js, IP3's held-out
K1-PROHIBITION corpus. Same shape as practiceSessionTestDoubles.js and
driveWireProbe.js above it -- a fixture module its own suite imports by
name, never code that ships.
10 -> 11 (N22): lib/interviewPrep/migrationGrantReplay.js, the grant/revoke
replay extracted from interviewPrepEffectiveSchema.test.js to bring that
file under the 1000-line cap. ONE entry added, none removed -- stated
because this count has been bumped before with a comment naming a single
movement when the real delta was +2/-1, and a count that is right by
coincidence is worse than a red one.
12 -> 13 (N49): lib/sourceScan/exportReachability.scan.js, this file's own
scan (ROOT/PRODUCTION/TEST_FILES/GRAPH/TEST_REFERENCED/ORPHANS/
rejectedStatements and friends), extracted for the same reason as
exportReachability.ledger.js's own self-entry just above it.
13 -> 14 (N105 Step 10): lib/llm/ideal/__fixtures__/examplePair.js, the
example posting <-> resume pair four Ideal suites run through the real
pipeline. ONE entry added, none removed; same shape as predictionCorpus.js.
```

---

## 2. UNWIRED_MODULES (pinned at 5, exact file list)

Findings, not allow-listed: modules built and tested but not yet imported by
anything that ships. Wiring one up (or removing it) fails the exact module
match, which is the prompt to delete its line. Source of the history: the
comment block under "keeps the unwired-feature findings visible and
described", after its opening paragraph (which stays in the test).

```text
The three ORIGINAL findings were all acted on -- deleted, not wired. The
two that replaced them, the shared rate limiter and its store, were acted
on the other way: WIRED. app/api/copilot/ask/route.js imports
createRateLimiter/identify/rateLimitHeaders at module scope, which made
both modules reachable from shipping code and failed the exact match
above until their lines were deleted -- the prompt working as designed,
in the direction this bucket was actually built for.

[] -> 2 -> 1. IP3's own prepLog.js and prepTrigger.js both landed built
and tested in isolation with their consuming wave named but not yet
landed -- the ORIGINAL shape this bucket exists for, not sweep/test
infrastructure. prepTrigger.js's finding was independently measurable,
not just a header claim: app/prepTriggerSeams.test.js's must-fire
assertions were red against that checkout. Wave 8/9 landed its five
call sites, that suite is green, and the line is gone -- the prompt
working as designed, same as the rate-limiter pair above. prepLog.js
remains unwired.

1 -> 5 (N49): the same shape, four more times. An implementer landed
the acceptance tests named in PrepPackPanel.n49Frame.test.js,
citationLineAgreement.test.js, digestRoleScreen.test.js and
interviewerRoles.test.js, plus the modules that satisfy them, ahead of
this chunk's own later wiring steps (plan.r4.md sections 8.3-8.5) --
see the ledger's own finding on each of the four for its named call
site.
```

---

## 3. ORPHAN_EXPORTS (pinned at 66)

Exports unused by shipping code AND imported by no test anywhere (plus a
handful that a test reads only through a dynamic `await load()` this static
index cannot follow; each entry says which). Source of the history: the
comment block under "keeps a stated reason on every orphan".

```text
56 -> 56, and the SAME TOTAL HIDES TWO OPPOSITE MOVEMENTS. Do not read
this as "nothing happened".

  -2  selectQueueCandidates.js#matchesIncludedCompany and
      upsertInterviewStage.js#deleteInterviewStage were acted on and
      DELETED. Both were referenced nowhere -- not by shipping code, not
      by a test, not even inside their own module -- which is what their
      entries said and what a by-name and by-path grep of the whole repo
      confirmed before the cut.
  +2  knowledgeBase.js#SEPARATOR and tailorContext.js#SEPARATOR MIGRATED
      IN from rule TR-1's bucket. Neither symbol changed. Their sole
      importer was lib/experience/untrustedText.test.js, and deleting
      that unreachable module's suite took the last outside reader of
      both with it. This is the census working: a deletion elsewhere
      demoted two exports, and the split moved even though the total
      did not.

The third symbol reviewed alongside the two deletions,
docx.js#buildDocxFromUploadedTemplate, turned out to be LIVE and was
kept (see its corrected entry above), so it still occupies a line here.
56 -> 64: the bullet-truncation chunk's eight, all added with reasons.
SEVEN of them are read by a test and are here only because that read goes
through a dynamic `await load()` this static index cannot follow -- so
unlike every entry above them, "nothing in this repository reads these"
is NOT true of the seven, and the bucket's headline claim is weaker for
them than for the rest. That is stated on each entry rather than left for
someone to discover by deleting one. The eighth,
answerLocal.js#groundingCandidates, is the ordinary shape: read inside its
own module, with the `export` keyword the only surplus part.
64 -> 63, and the total again hides movement in BOTH directions.
  -2  pointLength.js#standsAlone and materialQuote.js#materialQuote gained
      real importers when the expandable-sub-bullets feature landed. Both
      entries said in so many words that they had no direct importer; that
      stopped being true, so they left. This is the bucket working: it
      surfaced two exports whose only justification was "nothing imports
      this yet", and something did.
  +1  useAnswerExpansions.js#useAnswerExpansions, the ordinary shape --
      used once inside its own module, with the names shipping code
      actually imports (ExpansionScope, useExpansionApi) reachable.
63 -> 71: IP3's own eight, every one built ahead of its consuming wave
and cited against its own design section rather than guessed --
prepConstants.js's PREP_GENERATION_MAX_ATTEMPTS, PREP_ROUTE_MAX_DURATION_S,
PREP_GENERATION_TIMEOUT_FLOOR_MS, PREP_ROUTE_RESERVE_MS and
PREP_LEASE_SLACK_MS; prepContract.js's PREP_LIST_COLUMNS and
PREP_SPEND_COLUMNS (each used once, internally, to build the
*_PROJECTION string that IS reachable); and prepParse.js's
containsDetectedName, used internally by this file's own O-15 choke
point but not yet pinned by a test of its own. None of the eight
demoted an existing entry -- this is new surface, not a SEPARATOR move.
71 -> 70 (N16 wave D): prepParse.js#containsDetectedName is no longer an
orphan -- buildEmbeddedPack screens position.title/company through it before
interpolating, so it has a real shipping consumer now. ONE entry removed,
none added; the same single movement as the TR-1 bump above.
70 -> 72 (N45/N46): prepContract.js's two new PREP_REVISION_COLUMNS and
PREP_REVISION_LIST_COLUMNS, the exact same shape as the already-listed
PREP_LIST_COLUMNS/PREP_SPEND_COLUMNS pair -- each used once, internally,
to build the *_PROJECTION string prepStore.js's new revision reads
actually import. Two entries added, none removed.
72 -> 71 (N69): WORDPROCESSINGML_NS left this ledger when the spacing
tests began importing it instead of re-typing the OOXML namespace, so
it is now counted as test-referenced above. One entry removed, none
added -- the same single movement as the TR-1 bump.
70 -> 67 (N105/N106): SIX out, THREE in. Out: the six docx.js entries moved
to TR-1 only because docx.hypotheticalMarker.test.js namespace-imports
docx.js (counted as a read of every export); still unread by name. In:
tailorLevel.js's three unwired caption symbols. MIN_CONTENT_OVERLAP and
REMOVED_COPY_MESSAGES also surfaced and were un-exported, not ledgered.
Details are in the ledger beside each entry.
67 -> 66 (N107): LEVEL_CAPTIONS out (ApplyingControls.js renders the slider
caption from it); none in.
```

---

## 4. TEST_REFERENCED, rule TR-1 (pinned at 396)

Exports unused by shipping code that at least one `.test.js` imports BY NAME.
A raise is a review event: check the new export is a helper being pinned, not
a feature built and never connected, then update the number. Source of the
history: the comment block under "[RULE TR-1] counts the exports whose only
consumer is a test, exactly", after its opening paragraph (which stays in the
test).

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
```

---

## 5. UNUSED_IN_SHIPPING_MODULES total (pinned at 462)

The sum of the two halves above (`TEST_REFERENCED + ORPHANS`); the test also
asserts that identity directly, so the split is pinned and not only the total.
Source of the history: the comment block under the "pin the split rather than
only the total" assertion.

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
```
