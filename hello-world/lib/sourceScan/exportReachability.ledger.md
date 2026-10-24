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

Sections 4 and 5 are the exception: their append-only movement notes outgrew
this file and live in `exportReachability.ledger.history.md` (same section
numbers). Append new deltas for those two counts there; this file keeps their
explanatory text, the pinned values and the identity below.

Current pinned values, as of the last entry in each section:

| Assertion                                   | Pinned |
| ------------------------------------------- | ------ |
| `ALLOWED_UNREACHABLE_MODULES.length`        | 14     |
| `UNWIRED_MODULES` (exact list of 6 files)   | 6      |
| `ORPHAN_EXPORTS.length`                     | 65     |
| `TEST_REFERENCED.length` (rule TR-1)        | 450    |
| `UNUSED_IN_SHIPPING_MODULES.length`         | 515    |

The identity that ties the last three together, and that the test asserts
directly, is `UNUSED_IN_SHIPPING_MODULES = TEST_REFERENCED + ORPHANS`
(450 + 65 = 515).

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

## 2. UNWIRED_MODULES (pinned at 6, exact file list)

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

5 -> 7 (N157 SC-B): the same shape, twice more. The study-plan chunk's
persistence-foundation sub-chunk landed lib/studyPlan/studyPlanContract.js
and lib/studyPlan/studyPlanSchema.js with their unit suites
(studyPlanContract.test.js, studyPlanSchema.test.js) ahead of the later
sub-chunks that import them -- the store (SC-B-persist), the evidence
module (SC-A) and plan generation. Their only importers today are those
test siblings, and a test file is not a caller, so both are wholly
unreachable and belong here, not in ALLOWED_UNREACHABLE_MODULES (they are
shipping code, not sweep or test infrastructure). TWO entries added, none
removed. The other four pinned counts did not move: the migration .sql and
the .test.js files never enter the JS graph, and a wholly unreachable
module's exports are reported at module granularity, so these modules'
exports reach neither ORPHAN_EXPORTS nor TEST_REFERENCED. Each finding
names the module that will wire it; delete the line the day that import
lands.

7 -> 11 (N157 SC-A + SC-B-persist): the same shape a third time, four more.
SC-A landed lib/studyPlan/studyPlanEvidence.js and
lib/studyPlan/ensureStudyDigest.js; SC-B-persist landed
lib/studyPlan/studyPlanStore.js and lib/studyPlan/studyPlanProgressStore.js,
each with its suite, ahead of the surfaces that call them (the SC-C
walkthrough shell, plan generation, the SC-D refresh control). FOUR entries
added, none removed. The two older study-plan findings (studyPlanContract.js,
studyPlanSchema.js) stay on the list but were reworded: the call sites they
named (the store, the evidence module) now exist, but are themselves
unwired, so those two remain unreachable until a surface wires the chain.
The other four pinned counts did not move (14 / 65 / 427 / 492): these are
whole-file entries, not symbol-bucket changes.

11 -> 7 (N157 SC-gen): the first surface that calls the study-plan modules landed;
the computed graph (not a predicted figure) moved four of the eleven out.
app/api/study-plan/route.js imports studyPlanGenerate.js (new), which imports
studyPlanPrompt.js (new), studyPlanEvidence.js, studyPlanSchema.js and
studyPlanStore.js; the store imports studyPlanContract.js. FOUR removed, none
added, by name: lib/studyPlan/studyPlanContract.js, studyPlanSchema.js,
studyPlanStore.js, studyPlanEvidence.js. Two stay, because the route imports
neither: studyPlanProgressStore.js (SC-C walkthrough) and ensureStudyDigest.js
(SC-C's StudyPlanClient, SC-D refresh). Unlike the whole-file entries above, THIS
change moves symbol buckets (exports are classified per symbol once a module is
reachable): TR-1 427 -> 439 (section 4), total 492 -> 504 (section 5). ORPHAN
unmoved (section 3); ALLOWED_UNREACHABLE_MODULES stays 14.

7 -> 9 (N157 SC-C C-a): the same shape a fourth time, two more. The walkthrough
sub-chunk's first step landed two pure modules with their suites ahead of the
UI that imports them: lib/studyPlan/studyWalkthroughModel.js (GRADE, flattenPlan,
isDone, nextCard, summarize, planSignature; wired by the C-b walkthrough UI) and
lib/studyPlan/studyPlanCopy.js (the frozen STUDY_COPY strings; rendered by C-b and
C-c). Their only importers today are studyWalkthroughModel.test.js and
studyPlanCopy.test.js, and a test file is not a caller, so both are wholly
unreachable (measured: the computed unreachable set went 21 -> 23, which is
ALLOWED 14 + UNWIRED 9). TWO entries added, none removed, appended in that order.
Neither module moves a symbol bucket: a wholly unreachable module's exports are
reported at module granularity (the same reason as the 5 -> 7 and 7 -> 11 entries
above), and the one symbol that did leave TR-1 in this tree was NOT caused by
either of them -- see section 4. ORPHAN_EXPORTS unmoved at 65;
ALLOWED_UNREACHABLE_MODULES stays 14.

9 -> 5 (N157 SC-C C-c): the surface those four entries were waiting for landed, and
the computed graph (not a predicted figure) moved all four out. CopilotClient.js now
renders practice/PracticeSurface.js where it rendered PracticeClient; in its "Study
plan" sub-view PracticeSurface.js mounts study/StudyPlanClient.js, which imports
(directly, or through study/StudyWalkthrough.js, useStudyPlanRecord.js,
useStudyPlanBuild.js, StudyCreatePanel.js and the C-b components) every study-plan lib
module. FOUR removed, none added, by name: lib/studyPlan/studyPlanProgressStore.js
(StudyPlanClient's record and StudyWalkthrough's recordProgress), ensureStudyDigest.js
(StudyPlanClient's create path), studyWalkthroughModel.js (StudyWalkthrough,
useStudyPlanRecord) and studyPlanCopy.js (rendered everywhere, and by PostingPicker.js).
Measured by running the sweep's own scan twice over the same tree: as it stands, and
with the one mount edit reverted in memory (CopilotClient.js importing PracticeClient
again, PostingPicker.js not importing the copy registry). The reverted run reproduces
the OLD TR-1 pin exactly (438), which is what makes its diff against the new tree
trustworthy; its unreachable set is 37 against 19 now. Eighteen modules differ, and only
four of them were ever on this list: the four above. The other fourteen were never
entered here because they became reachable from birth in this change: the ten app/copilot
modules (practice/PracticeSurface.js, and under study/ StudyPlanClient.js,
StudyCreatePanel.js, useStudyPlanRecord.js, useStudyPlanBuild.js, StudyWalkthrough.js,
useStudyWalkthrough.js, StudyPlanOverview.js, StudyEvidenceCitation.js,
StudyProvenanceBanner.js) and the four new lib modules (studyPlanBuild.js,
studyPlanBrowser.js, studyPlanBuildClient.js, studyPlanNotices.js). Five of those ten,
the C-b components, were landed ahead of the mount with no line here, so the exact module
match was red for exactly them (28 computed unreachable against 23 ledgered) between C-b
and this change; it is green now (19 = ALLOWED 14 + UNWIRED 5). That 28 is the 37 less
the nine files this change created, not a separate run. This change moves symbol buckets
as well: TR-1 438 -> 441 (section 4), total 503 -> 506 (section 5). ORPHAN_EXPORTS
unmoved (section 3); ALLOWED_UNREACHABLE_MODULES stays 14. The five that remain are the
N49 modules, each awaiting its own wiring step.

5 -> 5 (N157 SC-D, D-a + D-b reconciled together): NO line added and none removed, measured
with the sweep's own scan over the finished tree (19 computed unreachable = ALLOWED 14 +
UNWIRED 5, identical set-for-set to the tree at HEAD, 19). The D-a pure model has no line
here: by the time the sweep was run over this tree its importer (the D-b shell) was already
in place, so the module was never measured unreachable. The three NEW modules are all
reachable from birth, by name:
lib/studyPlan/studyPlanKnobs.js (imported by study/StudyPlanClient.js for areaOptions,
isBuildableKnobs and suggestFocusAreas, by study/StudyPlanControls.js for the setters and
the summary, and by study/useStudyKnobs.js for knobsEqual), app/copilot/study/useStudyKnobs.js
and app/copilot/study/StudyPlanControls.js (both imported by StudyPlanClient.js, which
PracticeSurface.js mounts). The edited modules (StudyCreatePanel.js, StudyPlanOverview.js,
StudyWalkthrough.js, StudyPlanClient.js, studyPlanCopy.js) were already reachable. THIS change
does move symbol buckets, because lib/tracking/applicationDigest.js#DIGEST_SECTIONS gained its
first shipping importer (StudyPlanClient.js, which passes it to the model as seedAreas) and
the new module exports are classified per symbol: TR-1 441 -> 444 (section 4), total
506 -> 509 (section 5). ORPHAN_EXPORTS unmoved (section 3); ALLOWED_UNREACHABLE_MODULES stays
14.

5 -> 6 (N162 Wave A): the built-ahead-of-its-consumers shape once more, one module.
The N162 contract wave landed app/settings/includeCodingSolution.js, the shared
"include coding solution" toggle store (the app/settings/answerAsMe.js pattern: a
localStorage-backed useSyncExternalStore, ON only for the string "true"), with its suite
includeCodingSolution.test.js, ahead of the two things that write and read it -- the live
control and the request read -- which land in Wave D. Its only importer today is that test,
and a test file is not a caller, so it is wholly unreachable (measured: the computed
unreachable set went 19 -> 20, which is ALLOWED 14 + UNWIRED 6). ONE entry added, none
removed, appended last. The module moves no symbol bucket -- a wholly unreachable module's
exports are reported at module granularity, the same reason as the 5 -> 7 and 7 -> 11
entries above -- so the other pinned counts did not move (measured with the sweep's own
scan, not predicted): ORPHAN_EXPORTS unmoved at 65 (section 3), TR-1 unmoved at 445
(section 4), total unmoved at 510 (section 5), ALLOWED_UNREACHABLE_MODULES stays 14. The
three other Wave A edits (lib/copilot/answerGrounding.js, sampleAnswerState.js,
answerClient.js) are existing reachable modules and added no new export. Delete the line
the day a shipping module imports the store.

6 -> 5 (N162 Wave B reconcile): that day came. app/copilot/useDraftAnswer.js (the Wave C
live hook, already in the tree when this reconcile ran) imports readIncludeCodingSolution
from app/settings/includeCodingSolution.js, so the store is reachable and its line is
deleted. ONE removed, none added, by name: app/settings/includeCodingSolution.js. Measured
with the sweep's own scan over the tree as found, not predicted: 19 computed unreachable =
ALLOWED 14 + UNWIRED 5 (the five N49 modules). Wave B added no line of its own:
lib/copilot/ndjsonResponse.js (the NDJSON response wrapper moved out of
app/api/copilot/answer/route.js to hold that file inside the 940-line band
route.wiring.test.js pins) is imported by the route, so it is reachable from birth, and
lib/copilot/codingSolution.js, answerPrompts.js and the route are existing reachable
modules. Unlike the Wave A entry, THIS change moves symbol buckets, because a now-reachable
module's exports are classified per symbol: TR-1 445 -> 452 (+7, -0, section 4), total 510
-> 517 (section 5), ORPHAN_EXPORTS unmoved at 65 (section 3), ALLOWED_UNREACHABLE_MODULES
stays 14.

5 -> 5 (N162 Wave D reconcile): UNMOVED, measured with the sweep's own scan over the tree as
found. Wave D (the live control, the render-append, the client wiring) added no module and
removed none from this list: it edits existing reachable modules only (CodeSolution.js,
QuestionFeed.js, SampleAnswer.js, CopilotDashboard.js, answerStatus.js, SessionControls.js,
CopilotClient.js, PracticeClient.js), and the store module was already out of section 2 since the
Wave B reconcile. The computed unreachable set stays 19 = ALLOWED 14 + UNWIRED 5. THIS change
does move one symbol bucket: TR-1 452 -> 451 (-1, section 4), total 517 -> 516 (section 5),
ORPHAN_EXPORTS unmoved at 65 (section 3).

5 -> 6 (N177 package foundation): ONE entry added, none removed, by name:
lib/document/resumeFormattingPackage.js. The Node DOCX package validator has
no shipping caller; its package tests are not a production importer. The
accepted N177 full-cleanup plan names lib/document/resumeFormattingCommit.js
and app/api/resume-formatting/route.js as the missing service/route chain.
This is an unfinished-feature finding, not ALLOWED sweep infrastructure.
The exact census changes from 19 to 20 = ALLOWED 14 + UNWIRED 6; the original
five findings and ALLOWED 14 are unchanged. As a whole-module finding it does
not change the symbol buckets: ORPHAN 65, TR-1 450, total 515 remain pinned.
The prior full verification failure remains a failure; this amendment needs
fresh verification against its own candidate and does not relabel that run.
Remove the finding when a genuine shipping caller reaches the validator.
N177 still owns the formatting-check button, current-editor cleanup,
reversible saved before/cleanup versions, pinned exports and candidate-bound
live verification; foundation publication establishes none of those flows.
```

---

## 3. ORPHAN_EXPORTS (pinned at 65)

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
66 -> 65 (N141): lib/copilot/idealProject.js#MAX_SHAPE_TERMS out -- the module
was deleted with the rest of the ideal-project / ready-example feature. ONE
entry removed, none added; its entry in exportReachability.ledger.js went with
it.
65 -> 65 (N157 SC-gen): UNMOVED, measured with the sweep's own scan. None of the six
newly classified study-plan modules exports an orphan: every export with no shipping
importer is imported by a test and lands in TR-1 (section 4). Near miss:
studyPlanGenerate.js#buildEmbeddedStudyPlan, called only in-module until
studyPlanGenerate.embedded.test.js imported it; without it, the 66th entry here.
65 -> 65 (N157 SC-D): UNMOVED, set-for-set identical to the tree at HEAD, measured with the
sweep's own scan. None of the three new modules (studyPlanKnobs.js, useStudyKnobs.js,
StudyPlanControls.js) exports an orphan: the four studyPlanKnobs.js exports with no shipping
importer are all read by name from studyPlanKnobs.test.js and land in TR-1 (section 4).
65 -> 65 (N162 Wave B reconcile): UNMOVED, measured with the sweep's own scan. The six
includeCodingSolution.js exports that are not yet read by shipping code are all imported by
name from includeCodingSolution.test.js, and codingSolution.js#embeddedCodingFallback is
imported by name from codingSolution.test.js, so all seven land in TR-1 (section 4).
65 -> 65 (N162 Wave D reconcile): UNMOVED, set-for-set identical, measured with the sweep's own
scan. The one export that moved (app/settings/includeCodingSolution.js#useIncludeCodingSolution)
left TR-1 for "used by shipping code", not for this bucket (section 4); the other five store
exports and codingSolution.js#embeddedCodingFallback stay test-imported and in TR-1.
```

---

## 4. TEST_REFERENCED, rule TR-1 (pinned at 450)

Exports unused by shipping code that at least one `.test.js` imports BY NAME.
A raise is a review event: check the new export is a helper being pinned, not
a feature built and never connected, then update the number. Source of the
history: the comment block under "[RULE TR-1] counts the exports whose only
consumer is a test, exactly", after its opening paragraph (which stays in the
test).

Full movement history (append-only, newest at the bottom): see
`exportReachability.ledger.history.md`, section 4. Append new TR-1 deltas there.

---

## 5. UNUSED_IN_SHIPPING_MODULES total (pinned at 515)

The sum of the two halves above (`TEST_REFERENCED + ORPHANS`); the test also
asserts that identity directly, so the split is pinned and not only the total.
Source of the history: the comment block under the "pin the split rather than
only the total" assertion.

Full movement history (append-only, newest at the bottom): see
`exportReachability.ledger.history.md`, section 5. Append new total deltas there.
