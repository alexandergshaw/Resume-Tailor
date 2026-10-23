# N178 independent test plan

Author: /root/modal_ux_tests, independent of product author. Accepted input: brief-r2.md SHA256 0A64418E9CA5361B85B7740E01552F202F4D610AFD4AAAFEAA040E5CA545A757, acceptance brief-r2.check.md SHA256 94289A2E6FE66A09B61F5F3EC59C2484BF21C00B0E2A003DAB49642BD817B597. This is authored design requiring independent acceptance, not executed verification. Product and existing tests remain untouched. No execution/cache/browser/provider activity authorized by this packet.

## Write boundary and instruments

After coordinator acceptance only: new hello-world/app/components/DocumentPreviewDialog.workspace.test.js. Real DocumentPreviewDialog with React createRoot/act and per-file jsdom; real child components, no blanket MUI/dialog/tool mocks. Mock only existing external-effect seams necessary to avoid actual requests (callbacks are spies; loader supplies a small distinguishable model). Use existing mounted-test setup patterns, scoped innerText polyfill if absent, cleanup root/body/polyfill and restored matchMedia/global stubs. Never simulate browser geometry in jsdom.

Proposed targeted invocation from hello-world (coordinator serializes and admits execution): npm.cmd test -- app/components/DocumentPreviewDialog.workspace.test.js. First execute before product changes, retain actual RED output and candidate identity, establish each failing assertion is missing N178 behavior rather than fixture failure. After implementation execute unchanged file for GREEN. A fixture/setup failure is invalid RED evidence.

## Small meaningful new cases

T1 / N178-1,4: real modal title is explicitly associated with its heading. Find native Document tools button by accessible text; initially aria-expanded=false and nonempty aria-controls identifies exactly one existing named region. Initial available Resume keeps Preview/Edit visible outside this region. The tools subtree stays mounted while hidden: select representative existing child (Ask AI plus version selector with supplied versions), capture node identity, expand then collapse and expand again, require same nodes and correct expanded/hidden state. Invoke button with real click in jsdom; initial render, opening and closing must make zero research/scan/AI/revise/template callback calls. Require at least one actual optional control as positive corpus control. DOM containment/hidden checks are semantic evidence only; Enter/Space/tab order require browser.

T2 / N178-3,4,5: enter Edit using real toggle, locate sole contentEditable=true surface by its descriptive accessible name, capture node; insert distinctive changed HTML/text and dispatch input under act. Open/collapse/reopen tools without moving scope or mode; require identical editor node and unchanged draft contents, then close through existing footer Close; onSave receives edited resume payload and onClose fires. No-op control: opening/closing tools in Preview before typing invokes neither onSave nor external actions. Do not assert transient saves remain zero while editing because legitimate focus blur may flush. This tests preservation of typed content and identity, not native selection/execCommand. Existing suites test detailed copy/autosave/timing fidelity.

T3 / N178-3: fully supplied Resume/Cover/Email model with full callbacks. In Resume expanded tools expose supplied applicable controls and Edit/spacing/templates; switch Cover, reopen if disclosure policy resets, assert cover research reachable and read-only explanation absent; switch Email and expand tools, assert read-only explanation, no Edit or spacing/template/DOCX download; Copy text of the hiring email remains in actionbar. Check disabled unavailable tab as negative control with real available tabs proving switch helper worked. Do not require disclosure state persistence across scope (not in brief), only initially/reopen collapsed. Reopen dialog via controlled props and require collapsed tools. Existing visibleScopes/Ideal tests remain authoritative for hypothetical gating; do not duplicate mount pipeline.

T4 / N178-4 mobile DOM semantics: set scoped matchMedia fixture to actual hook breakpoint behavior, mount real modal and require mobile Close remains accessible; opening tools keeps same region/editor relationships. This case may be omitted if no unique mobile markup change beyond already exercised Close; it must not pretend to prove phone focus, keyboard activation, fullscreen geometry or touch scrolling. Those are browser obligations below.

No padding/color/stylesheet-name/class-string assertions. Do not snapshot CSS or count layout wrappers. New assertions are about meaningful relationships, preserved state and conditional actions. Existing direct-child/census gates remain unchanged.

## Existing exact regression paths (unchanged)

Run targeted source files as one serialized Vitest invocation after green; full app regression is mandatory separately:

- app/components/DocumentPreviewDialog.copy.test.js
- app/components/DocumentPreviewDialog.copyDownloadFidelity.test.js
- app/components/DocumentPreviewDialog.drive.test.js
- app/components/DocumentPreviewDialog.fileNameStaleness.test.js
- app/components/DocumentPreviewDialog.titleCopy.test.js
- app/components/DocumentPreviewDialog.titleCopyFeedback.test.js
- app/components/DocumentPreviewDialog.spacing.test.js
- app/components/DocumentPreviewDialog.visibleScopes.test.js
- app/components/DocumentPreviewDialog.setDefaultTemplateControl.test.js
- app/components/DocumentPreviewDialog.switchTemplateControl.test.js
- app/components/DocumentPreviewMount.test.js
- app/components/DocumentPreviewMount.visibleScopes.test.js
- app/components/DocumentPreviewMount.idealSurface.test.js
- app/components/DocumentPreviewMount.idealBands.test.js
- app/components/DocumentPreviewMount.review.test.js
- app/components/DocumentPreviewMount.reviewCovered.test.js
- app/components/DocumentPreviewMount.regenerate.test.js
- app/components/DocumentPreviewMount.regenerateFlow.test.js
- app/components/preview/insertedFactsEgressCoVisibility.census.test.js
- lib/drive/lineCeiling.test.js

Additional existing SpacingControl/preview child regressions are covered by mandatory complete npm.cmd test via trusted verification/regression gate; no existing file write grant. Any need to reveal tools in old test setup requires coordinator contract expansion for exact file, preserving its asserted oracle.

## Controls and isolated mutations

After green and explicit shared-resource reservation, coordinator/verifier copies candidate into isolated fixture or applies/restores bounded mutation under exclusive lock with before/after SHA proof. No simultaneous shared-tree mutations.

M1 disclosure family: force Document tools activation to do nothing while leaving button and region present. Confirm changed bytes, execute T1, require failure at expanded=true/reachable content rather than fixture setup; restore and rerun clean T1. Positive/no-op controls described above distinguish real optional corpus from empty subtree.

M2 preservation family: assign editor key from disclosure state, forcing remount when tools toggle. Confirm mutation actually remounts with node observation; T2 must fail identity or content oracle; restore and rerun clean T2. If implementation uses a stable different local variable, verifier mechanically adapts injected key, without changing expected behavior.

M3 scope family: render DOCX Edit control on Email (isolated candidate); T3 must fail absence assertion. Existing Resume/Cover positive assertions prevent all-controls-hidden false success. Restore and rerun clean T3.

Browser geometry family control: on isolated local candidate only, temporarily force workspace max-height:32px and overflow:hidden at 1280x720; actual visible-paper/reachability measurement must fail >=300px criterion while title/modal canary succeeds. Restore and remeasure clean candidate. Do not inject styles into production or call synthetic local evidence live verification.

## Browser and live measurement contract

Independently verify actual candidate at 1280x720, 1440x900 and 390x844, long context and four scopes plus longest available labels, after loading settles. Identify actual document paper (not DialogContent), workspace, paper and footer. Visible height is max(0,min(document.bottom,workspace.bottom,dialog.bottom,viewport.height)-max(document.top,workspace.top,dialog.top,0)), minus any overlapping fixed chrome. Require >=300px at 1280x720; >=40% viewport height at other two initial collapsed viewports. Require footer and every action rect fully within paper and viewport, no page horizontal overflow; expand and actually scroll to every tool, document and feedback while Close stays reachable. A modelled intersection must agree with screenshot/occlusion inspection.

Keyboard desktop/phone browser: focus enters labelled modal from real launcher, Tab and Shift+Tab stay in modal, tools respond to Enter and Space, collapsed descendants cannot receive tab focus, collapse does not strand focus hidden, arrows switch tabs, selector focus returns sensibly, Escape/Close flush edits and return focus to launcher. Real selection: select phrase, use existing font/style, toggle tools and verify editor/selection and edited contents survive; no new formatting semantics expected. Verify save/reopen with bounded disposable content and reconcile cleanup. Exercise truthful loading/failure/recovery and clipboard refusal where authorized; do not initiate external provider/login/Drive requests to manufacture coverage.

Canonical live URL https://resume-tailor-tan-psi.vercel.app/ is mandatory after candidate identity established. Record UTC, full candidate/deployed identity, steps, expected/observed, evidence references and cleanup; unknown deployed revision or missing session means changed-flow evidence pending. Local browser/render/gates, main remote equality and status alone do not prove live behavior. All six repository gates and source/final independent review remain coordinator obligations. No result has run or passed in this plan.
