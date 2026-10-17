# N92 bounded reconciliation — verification report draft

Draft by /root/backlog_intake, requiring independent final/report check. This is a versioned coordination draft, not engine acceptance or shipped status. No source import, gates, live action or Git delivery was performed by this author. Status at draft: independently accepted copied implementation, actual focused37/37 and four executed mutation/control families. Coordinator reports exact five files imported to main; mandatory main gates are running. Actual live candidate and source publication remain pending. N166 camera live approval is a separate obligation; N175 source/live delivery does not prove N92.

## Requested partial scope and actual change

The backlog owner's N92 feature already has Move, reviewable Smooth/Apply/Undo and forward preference. This chunk repairs the client reconciliation of the existing successful commit's DOCX bytes/path. Both commitSmoothedFact and moveSuccessPatch now adopt actual returned string bytes (including explicit empty) and nonempty returned path or null. Pre-operation byte availability/edited/preMove flags no longer discard output. Upstream writer, native entry-byte fallback and native best-effort/session-only upload behavior remain unchanged; recovered originals still require durable upload. Refusals, cover-only rollback, edited flags, source IDs, other state and confirmation remain.

Meaningful baseline found stale client source pointers/bytes. It did NOT find incorrect saved DOCX content or formatting in the mounted fixtures: the existing real downloaded and preview text/font/provenance oracles passed before the final client-pointer failure. Describe this as source consistency after successful persistence, not as a broken-download fix.

This chunk does not close all38 N92 criteria or its whole backlog row. N86 shared preference, N165 global placement, provider/model quality, sentence segmentation and new native durability policy are excluded. No migration, paid call, login, deployment, external message or data cleanup authority implied.

## Candidate and accepted contracts

Base original main for isolated copy: cbd8fedf454de3592080c1a6f84f35a78ca80a12. This author worked only under .agnostic-loop/backlog-N166-camera/N92-work/hello-world; root main import is reported separately above. Copy/admission evidence remains N92-copy-proof.json and N92-copy-admission.check.md. Accepted plan next-N92-plan-r2.md467EB220287540BCB91D2D3958C1F433E47863A6710818826EF90ED3D89740FB and independent acceptance B428CF602009B5F3F3BE704AA13F943383EAC190BC79D74915238E992EEC6A79. Independent test design1FE76F92268139D7B6AA2D57DC73907E89CA6EE9380C04CC7D1DC7F149F81F2D/check469B69F61DC7BBFBB063BA94F6413E0E4E90E98BCDD45C38836DC241C8CA0F7C. Test R2 independent acceptance B112786F6ABBA1EEA581DA5AFC4920D6401ADCBE24C25984482B157B482B9C49. Baseline measurement/check B144F50213B15348A9DD3FCF71D2B593308993DB62839D5203DACE1494E3EBCD / BB5A9EA45F2BFAB9002042CCDE45E9B8F53873CC10B876787AFECC8E814FA7E9.

Current five paths/identities from N92/candidate-five.json:
- lib/acceptedFacts/commitSmoothedFact.js:42A2AFD5AF6BDDBA46F2542BF7CFEF30FEC25322E28C0E07FD2A962078EE5185
- lib/acceptedFacts/moveOptimism.js:3B1534E22B3DB920F18802FE091074698569651C134434B44ACB05339CDDB511
- lib/acceptedFacts/commitFactMove.originalTemplate.test.js:BB415B9CC4C94E0B7205FC1676EF932278A4CF494D0D8E0B53F027E971821CF9
- lib/acceptedFacts/moveOptimism.test.js:D309493E41A0EAD8F8CC44EBAB49A670C07EB91AE295EA0EFC624BC20122832F
- app/hooks/moveInsertedFact.rc.test.js:127323F58F3F4B250D8FC65C3EA393CAA52E48512070693B406A41395B31DB7D

Independent implementation R1 acceptance N92-implementation.check.md SHA5E0501452E045B5F56DA5D247E286E89502817546C2FEFFCA1AA905729A4B6B0: no findings. Confirms only five copied paths changed and original inputs unchanged; no main import or shipping acceptance inferred. R1 and R2 baseline test versions retained under N92/evidence/baseline-tests-r1 and baseline-tests-r2. Current production changes did not weaken new baseline oracles; only two obsolete pure legacy path expectations changed to accepted commit-output semantics.

## Actual measurements and criterion map

Independent verifier's actual command in isolated copy:
`node <original>/hello-world/node_modules/vitest/vitest.mjs run lib/acceptedFacts/commitFactMove.originalTemplate.test.js lib/acceptedFacts/moveOptimism.test.js app/hooks/moveInsertedFact.rc.test.js --reporter=json --outputFile=<ignored>/N92/{baseline|candidate-focused}.json`.
Installed executable C:/Program Files/nodejs/node.exe, copied hello-world cwd. Baseline21:39:56.0845557Z–21:40:26.9226382Z actualexit1:37 total,30pass,7fail,0skip. All seven were meaningful client-byte/path assertions, no harness/timeout/import/decode/proposal error, independently accepted. Candidate21:44:36.2052966Z–21:44:46.8728556Z actualexit0:37 total,37pass,0fail,0skip. Evidence candidate-focused.json EF7E9D694531598A62C5D813A83A11D73B860657F548DADA0A08BEA94C66035C; exit receipt340812E33B8AE746119AB752364FAD3E6DAE1ECCF7658132AFC7C8FF0BD4CCB7; raw logs preserved. Candidate focused result is independently accepted in reconciliation-focused.check.md; this author did not execute it.

- DOCX1: focused pass for actual mounted edited/recovered Move, real functional update, persisted PUT path, exact client decoded bytes versus stored object and real DOM download saved Blob, parsed paragraphs/locators. Initially entry bytes empty, but real resolveCoverEngineBytes can rebuild original bytes; do not claim hook hasCoverBytes=false. Pure/direct seam covers absent prior bytes independently.
- DOCX2: focused pass for edited/path-only recovered original with exact ordered namespace-aware paragraphs, original font and exact marker kind/version, both preview and separate actual downloader. Broader unedited/no-byte/native matrix, Word pagination and live behavior are not all measured by these two mounted cases.
- DOCX3: focused pass for real Smooth/Discard/Apply controls using only deterministic mocked HTTP proposal; no PUT before Apply, approved paragraphs/current records, actual anchor-linked saved Blob and source equality after success. No live provider/semantic faithfulness claim.
- DOCX4: focused pass for real Undo restoring exact pre-Smooth paragraphs and fact locators/provenance through second commit/download. Broader failed Undo/network recovery through UI remains an explicit receiver in future verification, not passed by successful Undo.
- DOCX5: focused passing direct strict-original upload/PUT refusal retains client state; existing original marker missing/corrupt/foreign/wrong-kind/pending guards remain. Native best-effort upload failure remains successful with usable session bytes/null stored path. Full same-job concurrent unrelated update, failed-Undo/network/409 control matrix is not all newly measured here. Existing uploaded-but-refused orphan remains separate residual.
- DOCX6: focused pass for pure explicit empty/null stale-source clearing, recovered fresh-output adoption, native no-candidate genuine empty output and nonempty entry fallback compatibility, actual native splice/best-effort upload failure. Native bytes/null path is session-only, not durable uploaded-document persistence after reload.
- DOCX7: PENDING. No N92 deployed candidate containment, actual canonical app Move/available approved Smooth/Undo/downloaded DOCX/save-reopen or independently accepted live-verification.record yet. Local object-URL interception faithfully measures download arguments/blob, not operating-system save, live auth/storage or physical Word rendering.

## Outstanding completion and delivery obligations

1. Four executed controls independently accepted in reconciliation-controls.check.md: baseline/no-op/restored37pass; Smooth path omission, Smooth byte omission, obsolete Move flags and disconnected mounted Download each fail intended assertions. Actual interval21:46:27.372Z–21:47:15.261Z. Stale-saved-payload replacement and failed-PUT-bypass mutants were not executed; do not claim all planned mutation families complete.
2. Coordinator reports exact five-file main import after accepted copied results. This author did not perform the import; bind main candidate and independent import fidelity before consumption.
3. Fresh serialized mandatory engine, app verification/regression, lint, build and backlog gates against imported main candidate are RUNNING, not yet passed at draft. Focused37pass does not replace them. No tsc gate exists.
4. Current source/report independent acceptance, coordinator state/backlog reconciliation without removing unclosed N92 scope, no retained/uncertain operation.
5. Normal main commit/push and actual npm.cmd run loop:delivery proving clean checkout/exact live remote commit; no publication evidence yet for N92.
6. Actual live N92 affected flow and downloaded-byte verification, known deployed revision containing candidate, relevant persistence/failure/recovery and authorized disposable-data cleanup, independently checked. A source chunk may be pushed with live pending but cannot be shipped/overall complete. Missing deployed candidate, session, proposal/spend authority or byte retrieval remains exact pending blocker; never fabricate proof or issue deployment command.

Owner/coordinator retains bounds and fixed22:10UTC deadline. This draft creates no continuation or provider grant. Broader requested scope remains pending until independently measured or explicitly dispositioned by owner; report partial results distinctly.

Versioned exact accepted-record provenance and hashes: records-index.md. This report draft remains pending independent acceptance; no shipped state or whole-backlog closure.
