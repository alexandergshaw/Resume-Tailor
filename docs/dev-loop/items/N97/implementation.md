# N97 implementation handoff

Author /root/n97_author. Candidate awaits independent code check and verification; this report is evidence, not acceptance or delivery. No live DB/provider/deployment/installation was performed. Root owns state/backlog/gates/commit/push.

Accepted inputs: contracts 1900CD59...; persistence plan 173B9647... (round 2); Drive hash 6099B7...; Drive freshness 4F9D6531...; fact provenance C33AF97E... checked 4CE8F2E24596649E98D8D3B811320AF969205290EAFC71CE88F4F41B1DCACDDB. Exact manifests below bind the actual candidate.

## Delivered candidate behavior

Promotion activates the saved default and reports activation failure without false success. Resume/cover original Gemini uploaded bytes persist immutably under existing owner-scoped generated-version storage; same-run partial-failure binding remains usable, while unknown ownership and unrelated global files refuse. Actual generation, history restore, revise and download callers consume the original. Drive SAVE refreshes the active default and uses the same effective file for output/hash; user/entry/cache epochs fence stale completion. N151 active overrides retain precedence.

Fact accept/auto/remove/move/smooth share original-aware persistence, including edited line branches. Marker-bearing finished output references one verified original base ID, preserving exact raw original capture after a new derived-row reload. Native/no-marker output remains faithful; N151 new output removes inherited provenance. Missing/corrupt/foreign/unknown ownership refuses source-aware mutation before fact RPC. Failed upload/pending base ID does not claim durable success. Existing finished bytes can still be viewed. No SQL/route expansion or rival store.

## Author measurements

Initial public route regression was RED before source change: 2 failed/1 passed, exposing ignored activation and false 200 success. Final wave-local command below passed 28 files, 252 tests; it is not the full application verification/regression gate. Existing remove/move/smooth/N151 regressions separately passed 9 files/63 tests. Export reachability and line ceilings pass without ratchet changes.

From hello-world/: 

```text
node node_modules/vitest/vitest.mjs run app/api/templates/default/route.promoteToActive.test.js app/api/templates/default/route.test.js app/hooks/useCompanyResearch.templateSnapshot.test.js app/hooks/useDocumentPreview.setDefaultTemplate.test.js app/hooks/useDocumentPreview.templateSnapshot.test.js app/hooks/useManualTailor.templateSnapshot.test.js app/hooks/useDriveDocuments.templateSnapshot.test.js app/hooks/useDriveDocuments.connect.test.js app/components/DocumentPreviewMount.test.js lib/document/defaultTemplateClient.test.js lib/document/generatedTemplateLifecycle.integration.test.js lib/document/generatedTemplateStore.test.js lib/document/templateSnapshotCallers.census.test.js lib/supabase/persistGeneration.templateSnapshot.test.js lib/tracking/applicationPreviewEntry.test.js lib/acceptedFacts/commitFactMove.originalTemplate.test.js lib/document/regenerateIntoTemplate.originalTemplate.test.js lib/document/regenerateIntoTemplate.test.js app/hooks/regenerateIntoTemplate.integration.test.js lib/sourceScan/exportReachability.sweep.test.js lib/drive/lineCeiling.test.js app/hooks/removeInsertedFactDurability.rc.test.js app/hooks/removeInsertedFact.rc.test.js app/hooks/removeInsertedFact.coalesced.rc.test.js app/hooks/moveInsertedFact.spliceRefusal.test.js app/hooks/moveInsertedFact.rc.test.js lib/coverFacts/smoothTransition.confirmPersist.rc.test.js lib/coverFacts/smoothTransition.confirmFailure.test.js
node node_modules/eslint/bin/eslint.js app/api/templates/default/route.js app/page.js app/components/TrackingTab.js app/components/tracking/ApplicationCard.js app/hooks/useCompanyResearch.js app/hooks/useDocumentPreview.js app/hooks/useDriveDocuments.js app/hooks/useManualTailor.js lib/document/defaultTemplateCapture.js lib/document/defaultTemplateClient.js lib/document/docx.js lib/document/generatedTemplateStore.js lib/document/previewBlob.js lib/supabase/persistGeneration.js lib/tailor/documentScopes.js lib/tracking/applicationPreviewEntry.js lib/acceptedFacts/commitFactMove.js lib/acceptedFacts/commitSmoothedFact.js lib/document/regenerateIntoTemplate.js
```

Targeted production ESLint exited 0 on the final source bytes (19 admitted production paths). The final additional ZIP-propagation and unknown-auth oracles passed: node node_modules/vitest/vitest.mjs run lib/acceptedFacts/commitFactMove.originalTemplate.test.js — 1 file/10 tests, exit 0. This adds two tests after the 252-test wave without changing production bytes.

Mutations: from repository root, node .agnostic-loop/n97-author-mutations.mjs exited 0. All 16 families passed baseline green, harmless-comment green, intended mutant red, restored green. Each unique actual source seam and before/after source hash is recorded; no shared source writes/restores. Families: immutable upload, tenant predicate, same-run partial fallback, unknown-auth refusal, persistence last hop, promotion activation, job/feed egress, Drive SAVE override, raw capture, Drive source identity hash, fresh default, marker before upload, marker-failure refusal, N151 marker clearing, shared move writer refusal. Harness SHA256 0F8252FB41846CFC56AED4BA3608362E4E51CD133ED0EA7247318FE9221DB023; result SHA256 E909B982E4A8FE2C852A4E5C3E2A23267D23FF27EB9FE05B6DDE5D7640600E15. JSON binds all mutated sources to current bytes. Page egress/call-site families are source assertions; byte/lifecycle and hook regressions supply complementary runtime evidence. Independent verifier must assess these limits.

Earlier broad focused run had 6 failures: 5 old synthetic-row exact mapper-shape assertions and 1 test-only export count. Fixed production compatibility for no-ID synthetic rows and made capture helper internal; old assertions preserved. Subsequent relevant regressions passed. Vitest/jsdom cross-realm digest fixture uses real Node SHA256, not a constant hash.

An automatic approval review rejected an attempted command constructing a new test from an existing test prefix, describing it as overwriting the existing suite. Nothing applied. Explicit creation of the separate new test file succeeded; existing suite retained. Other failed commands were wrong-directory/missing-file or sandbox Node realpath EPERM; scoped offline escalated test commands resolved execution. No failed mandatory gate was weakened.

## Limits and pending handoff

Independent implementation judgment, full serialized app/engine/backlog gates, as-built security/UX evidence, final report acceptance and verified remote delivery remain root/verifier obligations. Fixtures do not establish live schema/RLS/storage availability or Gemini/provider service behavior. No live schema proof is claimed. RPC failure after upload can leave an unreferenced object as before; there is no rollback guarantee. Preexisting originals already lost cannot be reconstructed.

## Round 1 candidate source and affected test identities (historical)

SHA256 of raw working-tree bytes; root-owned tools/state/docs changes are excluded. Relevant unchanged regression files are in the measured command but need no author ownership claim.

| Path | SHA256 |
| --- | --- |
| hello-world/app/api/templates/default/route.js | 5610E90D68E20942BB58561205A3677141A14AF456CB5DB17A4F280606DD5DA2 |
| hello-world/app/page.js | E32BEB6161640065A34D23D2D2C2F5FF09934B51012B5551D62E18EAE7096BFE |
| hello-world/app/components/TrackingTab.js | 4A08D03A9E3DCC7DFC80095CBB99CF574B206C2B531B11044226821198087980 |
| hello-world/app/components/tracking/ApplicationCard.js | 30F79730661CD49B22A28FA1AB32570867A7E006E36D0F363FE09198B9003A37 |
| hello-world/app/hooks/useCompanyResearch.js | 6D7C6D4A84696704B5A55414E8C7DA024F4608DCFE11BD95B80FCA3EF023757A |
| hello-world/app/hooks/useDocumentPreview.js | 7A772A9A44AA118B09FE1DCBA9035DE2A4D7D071A071F5E137AEC0697ED5FE4A |
| hello-world/app/hooks/useDriveDocuments.js | 567260BB6A3747614CDA7993F61DEBE010D8DBC3AC97764B6C33B6349B4184CC |
| hello-world/app/hooks/useManualTailor.js | F3C03F9470B701674E4B82931429285251F5DAE644124DA5FCAC7D362FCCC946 |
| hello-world/lib/document/defaultTemplateCapture.js | CE78AC495F1FB0EC9821559CF70CE14C3630E2C396F1A6935AD74D9BAAB5CC12 |
| hello-world/lib/document/defaultTemplateClient.js | 2AE1C122D72A842C53DAB2949822F2345305F422B8BD219C26F5E9CF4EBB9B1C |
| hello-world/lib/document/docx.js | 0B98359E0320B22AE4412178B221D8E133333D942B07A1F1BBA0AE1ED78E78EE |
| hello-world/lib/document/generatedTemplateStore.js | 512D33302090097AD7D8E8371210F6283D4E0A299CC1A0796AEAADEC5F3792D2 |
| hello-world/lib/document/previewBlob.js | 92F085F195329C237BC1E3F2EDAB944D044B59B44723966C0830356661B60EFB |
| hello-world/lib/supabase/persistGeneration.js | 71353C7E1CC8BD4B0437AE9ADAC7E3B70DDA5644F81A82E159344FF7708E09CC |
| hello-world/lib/tailor/documentScopes.js | 45BF2451FCE836456823E5D6456F32B3B6FF70021F57B7E966C82CCFEADAE7F5 |
| hello-world/lib/tracking/applicationPreviewEntry.js | A614F7D4070FABCAB4DAA54D7285769CA1CA5ACDF3847E1E13E7F59626FAA672 |
| hello-world/lib/acceptedFacts/commitFactMove.js | 588D235A04E6E7DC52BADCAB9DA28846629EBD03C6116B9C2F6E2023B1DC5F6F |
| hello-world/lib/acceptedFacts/commitSmoothedFact.js | D3E4710D3E5CB18201FCA4E3968B842F6BC1CF2CE2B2C8F66D718DF8851AD591 |
| hello-world/lib/document/regenerateIntoTemplate.js | 881E74F6BD0B9B605E6D25E1714DFA1CFC3B4166FF383E16F851DBA4FB76F5DB |
| hello-world/app/api/templates/default/route.promoteToActive.test.js | 22DE5B513070D38FB32EE5280B9F28731BFB4F05421CF2C6A4713D494FA0AC4C |
| hello-world/app/api/templates/default/route.test.js | 324167824F24474DE465AC6F947588BD1E9B4A0C358ECD3E9368052126518951 |
| hello-world/app/hooks/useCompanyResearch.templateSnapshot.test.js | FD273D9E8DE728903D6B0BCF765CBCD4CBCCF701498946EC456BCF0F959A4CD1 |
| hello-world/app/hooks/useDocumentPreview.setDefaultTemplate.test.js | AF91C801D8AAC21636048F05DF389E87AE0258C29044FF525662D2B91228BA50 |
| hello-world/app/hooks/useDocumentPreview.templateSnapshot.test.js | 996205E2161FA112578263164147F3E345C9CE85E7E215D54E75B681378A65BB |
| hello-world/app/hooks/useManualTailor.templateSnapshot.test.js | 3C5D69D7E4626EF026314E80470B2E52FBCC1461D565E013D7451619A42C3013 |
| hello-world/app/hooks/useDriveDocuments.templateSnapshot.test.js | 666FFB18CC1A465466F913DCDBD90864EBF0E7D36F4233A4A1346CEDC02AF589 |
| hello-world/app/hooks/useDriveDocuments.connect.test.js | 6CF40248DA834C8C395DB0C12EEB8AC4865EF973570214655CE1D622C0ACC92A |
| hello-world/app/components/DocumentPreviewMount.test.js | 696FA4FCC6C07881B86BEAD6496F9474165230B9DFD878B49E972BDF9E292A0C |
| hello-world/lib/document/defaultTemplateClient.test.js | 2D568DCB767BC75B666D4CCEBEC4B964767DB535CD606DA10AC7DDB2C632C2EB |
| hello-world/lib/document/generatedTemplateLifecycle.integration.test.js | 2595B66A1E8295A155FFFBB8DA1CDA65E138827C6B886018A8932F8FD62B2E04 |
| hello-world/lib/document/generatedTemplateStore.test.js | 8B05B33FB3315D618330A131EFC024D6B5E591235B0EE9C946BBC4A0661895CC |
| hello-world/lib/document/templateSnapshotCallers.census.test.js | 770F11167CDD8938550991D2B3F7954B89415BF1219EF90566EBFBE04FDB39BF |
| hello-world/lib/supabase/persistGeneration.templateSnapshot.test.js | 72C42317992F3B2B91EBCAADB072E88474F41213EA6359CAF2C016E5EB1520D7 |
| hello-world/lib/acceptedFacts/commitFactMove.originalTemplate.test.js | 34C9FB018B94B4C1CFF7E9D47B0EFC320F7E85C09E038B1C3A49860A7280C542 |
| hello-world/lib/document/regenerateIntoTemplate.originalTemplate.test.js | AC06112EC8DBAA9CAC088BA38C7F988F474FC63C41F9F836C27B620AD5F678A3 |


## Final round 2 bounded correction and current manifest

Independent round 1 review implementation.check.md 1AC6D14FA1B4A872A595EE499C48E5A571B3382DD074EC20678C223C9388EA38 identified two P2 classes. Root admitted correction of these classes only; no new design, ownership, or gates. Historical observations/manifests above remain evidence of round 1 and are superseded for current bytes ONLY by this final manifest.

SCOPE-PROVENANCE-CLASSIFICATION: capture uses rich per-scope source outcome whenever faithful server bytes/path exist; stale shared entry.engine no longer bypasses native classification. Hard refusal of invalid/foreign/missing original remains. Actual hook regression runs Gemini entry -> N151 native regeneration -> selection of its new stored UUID -> public promotion byte identity -> revise sending the same faithful native bytes. External fake DB/storage retains native finished bytes but no original snapshot. Original-before-derived failure controls remain unchanged.

NOOP-DOCUMENT-PERSISTENCE: acceptFacts gates its document persist helper on coverChanged. Unchanged source-aware repeated accept keeps merged-facts RPC with coverVersion:null, no output upload, unchanged finished bytes/text, and succeeds after the original snapshot becomes unavailable. Document mutation paths retain durability/original guards.

Both added real-hook regressions were measured RED before source fixes: node node_modules/vitest/vitest.mjs run app/hooks/useCompanyResearch.templateSnapshot.test.js app/hooks/useDocumentPreview.templateSnapshot.test.js — 2 failures/11 passed, specifically missing promotion and unnecessary missing-original refusal. After correction, the same tests and original-provenance controls passed: 6 files/32 tests using:

```text
node node_modules/vitest/vitest.mjs run app/hooks/useCompanyResearch.templateSnapshot.test.js app/hooks/useDocumentPreview.templateSnapshot.test.js lib/document/generatedTemplateLifecycle.integration.test.js lib/acceptedFacts/commitFactMove.originalTemplate.test.js lib/document/regenerateIntoTemplate.originalTemplate.test.js app/hooks/useDocumentPreview.setDefaultTemplate.test.js
node node_modules/vitest/vitest.mjs run lib/drive/lineCeiling.test.js lib/sourceScan/exportReachability.sweep.test.js app/hooks/regenerateIntoTemplate.integration.test.js lib/document/regenerateIntoTemplate.test.js app/hooks/removeInsertedFact.rc.test.js app/hooks/moveInsertedFact.rc.test.js
node node_modules/eslint/bin/eslint.js lib/document/defaultTemplateCapture.js app/hooks/useCompanyResearch.js
```

Adjacent regression/unchanged ratchets passed 6 files/89 tests; changed-source ESLint exited 0. All commands run from hello-world/. No tests/assertions/scenarios or ratchets removed. Final source changes are limited to defaultTemplateCapture.js and useCompanyResearch.js; tests added within their two existing admitted snapshot files. A fake-query update method was added for actual version selection to eliminate unrelated fixture warning.

Refreshed source-bound isolated mutation command (repository root): node .agnostic-loop/n97-author-mutations.mjs, exit 0. All 18 families pass baseline/comment/restored green and intended mutant red. Two new families restore stale engine classification and force unchanged document persistence; each uniquely mutates actual production source, with actual same-source conditional execution and external collaborators injected. Existing 16 families rerun against final source bytes; before/after source identities remain equal. Harness SHA256 49325B30E4618E0597DDB82727A05CFFBFE2EA599A01EFABCB4D06D584AA7BD2; result SHA256 DACCE09A38BEB29A3451AF2F3860F9DE199A8AA4418D60F5453AADE292352F78. No shared source write/restore or running author operation remains.

Current complete source/affected-test manifest (raw working-tree SHA256):

| Path | SHA256 |
| --- | --- |
| hello-world/app/api/templates/default/route.js | 5610E90D68E20942BB58561205A3677141A14AF456CB5DB17A4F280606DD5DA2 |
| hello-world/app/page.js | E32BEB6161640065A34D23D2D2C2F5FF09934B51012B5551D62E18EAE7096BFE |
| hello-world/app/components/TrackingTab.js | 4A08D03A9E3DCC7DFC80095CBB99CF574B206C2B531B11044226821198087980 |
| hello-world/app/components/tracking/ApplicationCard.js | 30F79730661CD49B22A28FA1AB32570867A7E006E36D0F363FE09198B9003A37 |
| hello-world/app/hooks/useCompanyResearch.js | D604F15D1A446B020DDB25B476BB7F77FC1BCCEB423857C4997F2151580D6CF9 |
| hello-world/app/hooks/useDocumentPreview.js | 7A772A9A44AA118B09FE1DCBA9035DE2A4D7D071A071F5E137AEC0697ED5FE4A |
| hello-world/app/hooks/useDriveDocuments.js | 567260BB6A3747614CDA7993F61DEBE010D8DBC3AC97764B6C33B6349B4184CC |
| hello-world/app/hooks/useManualTailor.js | F3C03F9470B701674E4B82931429285251F5DAE644124DA5FCAC7D362FCCC946 |
| hello-world/lib/document/defaultTemplateCapture.js | 7CE68C9AA70A8B003755736D55BD8120E82BA62FEE2FD74077053EC9059715C6 |
| hello-world/lib/document/defaultTemplateClient.js | 2AE1C122D72A842C53DAB2949822F2345305F422B8BD219C26F5E9CF4EBB9B1C |
| hello-world/lib/document/docx.js | 0B98359E0320B22AE4412178B221D8E133333D942B07A1F1BBA0AE1ED78E78EE |
| hello-world/lib/document/generatedTemplateStore.js | 512D33302090097AD7D8E8371210F6283D4E0A299CC1A0796AEAADEC5F3792D2 |
| hello-world/lib/document/previewBlob.js | 92F085F195329C237BC1E3F2EDAB944D044B59B44723966C0830356661B60EFB |
| hello-world/lib/supabase/persistGeneration.js | 71353C7E1CC8BD4B0437AE9ADAC7E3B70DDA5644F81A82E159344FF7708E09CC |
| hello-world/lib/tailor/documentScopes.js | 45BF2451FCE836456823E5D6456F32B3B6FF70021F57B7E966C82CCFEADAE7F5 |
| hello-world/lib/tracking/applicationPreviewEntry.js | A614F7D4070FABCAB4DAA54D7285769CA1CA5ACDF3847E1E13E7F59626FAA672 |
| hello-world/lib/acceptedFacts/commitFactMove.js | 588D235A04E6E7DC52BADCAB9DA28846629EBD03C6116B9C2F6E2023B1DC5F6F |
| hello-world/lib/acceptedFacts/commitSmoothedFact.js | D3E4710D3E5CB18201FCA4E3968B842F6BC1CF2CE2B2C8F66D718DF8851AD591 |
| hello-world/lib/document/regenerateIntoTemplate.js | 881E74F6BD0B9B605E6D25E1714DFA1CFC3B4166FF383E16F851DBA4FB76F5DB |
| hello-world/app/api/templates/default/route.promoteToActive.test.js | 22DE5B513070D38FB32EE5280B9F28731BFB4F05421CF2C6A4713D494FA0AC4C |
| hello-world/app/api/templates/default/route.test.js | 324167824F24474DE465AC6F947588BD1E9B4A0C358ECD3E9368052126518951 |
| hello-world/app/hooks/useCompanyResearch.templateSnapshot.test.js | 97529B85D42A3279475C3A65295F21BD8F1ED13F14C26446D2D26C3961131E4C |
| hello-world/app/hooks/useDocumentPreview.setDefaultTemplate.test.js | AF91C801D8AAC21636048F05DF389E87AE0258C29044FF525662D2B91228BA50 |
| hello-world/app/hooks/useDocumentPreview.templateSnapshot.test.js | F146E06C0A2AAC96325284EE3F3C20BC67AF4ADCD4E9BCA27D7A47F1C1B44AC4 |
| hello-world/app/hooks/useManualTailor.templateSnapshot.test.js | 3C5D69D7E4626EF026314E80470B2E52FBCC1461D565E013D7451619A42C3013 |
| hello-world/app/hooks/useDriveDocuments.templateSnapshot.test.js | 666FFB18CC1A465466F913DCDBD90864EBF0E7D36F4233A4A1346CEDC02AF589 |
| hello-world/app/hooks/useDriveDocuments.connect.test.js | 6CF40248DA834C8C395DB0C12EEB8AC4865EF973570214655CE1D622C0ACC92A |
| hello-world/app/components/DocumentPreviewMount.test.js | 696FA4FCC6C07881B86BEAD6496F9474165230B9DFD878B49E972BDF9E292A0C |
| hello-world/lib/document/defaultTemplateClient.test.js | 2D568DCB767BC75B666D4CCEBEC4B964767DB535CD606DA10AC7DDB2C632C2EB |
| hello-world/lib/document/generatedTemplateLifecycle.integration.test.js | 2595B66A1E8295A155FFFBB8DA1CDA65E138827C6B886018A8932F8FD62B2E04 |
| hello-world/lib/document/generatedTemplateStore.test.js | 8B05B33FB3315D618330A131EFC024D6B5E591235B0EE9C946BBC4A0661895CC |
| hello-world/lib/document/templateSnapshotCallers.census.test.js | 770F11167CDD8938550991D2B3F7954B89415BF1219EF90566EBFBE04FDB39BF |
| hello-world/lib/supabase/persistGeneration.templateSnapshot.test.js | 72C42317992F3B2B91EBCAADB072E88474F41213EA6359CAF2C016E5EB1520D7 |
| hello-world/lib/acceptedFacts/commitFactMove.originalTemplate.test.js | 34C9FB018B94B4C1CFF7E9D47B0EFC320F7E85C09E038B1C3A49860A7280C542 |
| hello-world/lib/document/regenerateIntoTemplate.originalTemplate.test.js | AC06112EC8DBAA9CAC088BA38C7F988F474FC63C41F9F836C27B620AD5F678A3 |

Frozen for final independent delta check; independent acceptance, full gates and delivery remain pending. No further substantive implementation review round is available after this round 2.


## Post-verification exact inventory maintenance

Coordinator reported a terminal independent full-suite failure with two failures: the exact cover-byte module inventory and an unrelated grounding test's unchanged 5000 ms timeout under load. The verifier's session 29794 exited 1 and source lock was explicitly released before this edit. Root admitted exactly one test-file inventory addition; this is maintenance of the actual known set, not a production correction or new substantive review round.

Added ONLY lib/document/defaultTemplateCapture.js to EXPECTED_COVER_CAPABLE in hello-world/lib/acceptedFacts/coverBytePaths.census.test.js, with a brief reference to its real lifecycle/fact-persistence tests. git diff shows one added array row. Parser, assertions, canaries, resume-only exclusions and all timeouts remain unchanged. No grounding test or production file was changed.

From hello-world/: node node_modules/vitest/vitest.mjs run lib/acceptedFacts/coverBytePaths.census.test.js — exit 0, 1 file/9 tests passed. The current manifest gains this one exact additional test identity; all earlier current candidate identities remain unchanged:

| Path | SHA256 |
| --- | --- |
| hello-world/lib/acceptedFacts/coverBytePaths.census.test.js | F7466B06F9A8CE9B7333BCED5B91017D0FDC87C6D23C5AAA29BD223ADBA12915 |

Mechanically re-compared every mutation-report sourceIdentity against actual source bytes: all match; existing 18-family mutation evidence remains bound to unchanged production. The entire mandatory gate must be rerun by the independent verifier; this focused pass does not clear the full-suite failure or timeout. No operation remains active. Frozen pending checker fidelity and independent full verification.
