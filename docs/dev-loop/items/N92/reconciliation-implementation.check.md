# N92 copied reconciliation implementation — independent R1 check

Checker `/root/wave_report_checker`, independent of author `/root/backlog_intake`. Reviewed actual five copied-file changes against accepted plan467EB220287540BCB91D2D3958C1F433E47863A6710818826EF90ED3D89740FB, accepted test artifactB112786F6ABBA1EEA581DA5AFC4920D6401ADCBE24C25984482B157B482B9C49 and measured baseline acceptanceBB5A9EA45F2BFAB9002042CCDE45E9B8F53873CC10B876787AFECC8E814FA7E9. No tests, source writes, import, Git/browser/provider/state action performed. Only this ignored check written; model/usage unavailable.

Verdict: **ACCEPTED**, no findings. Clean first implementation-review round ends; independent focused/regression/control measurement may proceed on exact copied bytes. This is not shipping/main-import acceptance or a gate result.

Accepted identities:

- commitSmoothedFact.js:42A2AFD5AF6BDDBA46F2542BF7CFEF30FEC25322E28C0E07FD2A962078EE5185
- moveOptimism.js:3B1534E22B3DB920F18802FE091074698569651C134434B44ACB05339CDDB511
- commitFactMove.originalTemplate.test.js:BB415B9CC4C94E0B7205FC1676EF932278A4CF494D0D8E0B53F027E971821CF9
- moveOptimism.test.js:D309493E41A0EAD8F8CC44EBAB49A670C07EB91AE295EA0EFC624BC20122832F
- moveInsertedFact.rc.test.js:127323F58F3F4B250D8FC65C3EA393CAA52E48512070693B406A41395B31DB7D

Smooth now adopts actual successful commit bytes and path, with explicit string/empty/null normalization, only after commit.ok. Functional state merge retains unrelated current fields/jobs, edited flags and original-template identities. Existing refusal return, accepted-facts revisions/records and preview reload remain unchanged. Upstream hasCoverBytes/edited values still choose writer behavior; they no longer discard its successful returned output. Native actual fallback and best-effort bytes/null-path success remain whatever the unchanged producer returns, while strict original failure remains refusal.

Move success patch likewise consumes only moved/current commit values, retaining public object-call compatibility when callers still pass old unused properties. Private path normalizer no longer restores stale preMove paths. Actual sole shipping caller checks commit.ok before success patch, merges it over current state and retains exact cover-only rollback on failure. No optimistic timing, original marker, auth, writer, download, segmentation, model, preference or concurrency behavior was changed. Empty/nonstring outputs clear stale sources per accepted contract; no alternate legacy producer was found or invented.

Test changes beyond accepted baseline are only the two obsolete pure expectations/descriptions: absent old bytes now adopts actual fresh path; hand-edited success respects returned null instead of stale preMove. Other pure positive controls and all seven new failure oracles remain. Original-template and real mounted saved-Blob test identities are unchanged from independently measured RED; no failed semantic/download assertion was removed. Repaired behavior is not presumed before actual execution.

Full2232-entry literal-path comparison shows exactly five permitted copied paths changed and zero original-main input drift. Security/privacy/UX/reliability triage remains bounded: successful durable-source/client alignment changes, no new data/auth/storage surface or control; original refusal and confirmation gates remain. Additional specialist redesign is not triggered by these exact two local patches. Main import requires independently measured focused/control success and exact output provenance; all mandatory gates and actual live candidate verification remain afterward. Fixed deadline and serialized shared resources remain; no paid/provider authority or automatic dispatch is implied.
