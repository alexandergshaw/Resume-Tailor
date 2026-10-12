# N157 SC-D wave D-b (step 4b TDD) -- the customization CONTROLS UI + hook + wiring

Seat: TDD. Authors tests + the authorized PD-SD-3 frozen-pin edits; no production code. Binds to
`docs/loop/N157.SC-D.design.r1.md` (D-b scope, DES-N157-D*) and the shipped D-a pieces
(`lib/studyPlan/studyPlanKnobs.js`, `STUDY_COPY.knobs`) + the C-c shell. Did NOT touch
`lib/sourceScan/exportReachability.*` (implementer runs the final SC-D census reconcile).

## Files created / edited

| File | Kind | Lines |
|---|---|---|
| `app/copilot/study/StudyPlanControls.test.js` | NEW (pre-plan / CreateStep, shell-driven) | 403 |
| `app/copilot/study/StudyPlanControls.staged.test.js` | NEW (post-plan / outline, fake timers) | 370 |
| `lib/studyPlan/studyPlanCopy.test.js` | EDIT -- AUTHORIZED frozen-pin: `notice.gemini` updated to the NEW PD-SD-3 string (line ~67) | +7 |
| `lib/studyPlan/studyPlanNotices.test.js` | EDIT -- AUTHORIZED: added one behavioural PD-SD-3 canary `it` | +11 |

Both new files mount the REAL `StudyPlanClient` shell and drive the REAL PostingPicker / disclosure /
controls / Create+Rebuild; every knob assertion reads the POST `/api/study-plan` BODY, never component
state. A direct-handler shortcut cannot satisfy these (reachability is first-class). Neither file touches
`exportReachability.*`.

## RED on HEAD: 25 reds, each for the right reason (verified in the working tree)

`Test Files  4 failed (4)` / `Tests  25 failed | 68 passed (93)`.

- **File A (15/15 red).** The D-b modules (`useStudyKnobs.js`, `StudyPlanControls.js`) and the shell wiring
  do not exist, so the "Customize your plan" disclosure is absent -> every panel/control test reds at the
  open-the-panel step. Zero-touch reds on a POSITIVE assertion (`body.knobs` deep-equals `normalizeKnobs(null)`,
  but HEAD sends `undefined` so the key is omitted). Egress test reds because `notice.gemini` lacks the
  PD-SD-3 sentence. None vacuous.
- **File B (8/8 red).** "Plan settings" disclosure absent -> reds at open-the-panel; staged tests also red
  because a knob change has no effect at all on HEAD (no draft, no dirty note).
- **Copy pin (1 red):** the new verbatim `notice.gemini` is not yet in production.
- **Notices canary (1 red):** `buildStudyPlanNotice({engine:"gemini"})` does not yet contain the egress
  sentence.

No vacuous reds. No `it.fails`. No source-text-contains assertion (the PD-SD-3 checks go through the real
builder / the rendered notice, not a source grep).

## The four named canaries (and their controls)

- **Staged-rebuild canary** (File B, "changing the mix shows the dirty note and fires NO build..."): after a
  post-plan knob change, `dirtyNote` is shown AND `callsToPlan() === 0` (staged). CONTROL in the same test:
  an explicit Rebuild fires exactly one build carrying the CHANGED ratio -- so "no fetch" is staging, not a
  dead control. Armed-window guard proven separately with progress (one tap only arms, reverts after
  `REBUILD_CONFIRM_WINDOW_MS`, still no build).
- **Schema-JOIN canary** (File A, "a mixed customization emits exactly the four keys and a normalizer-STABLE
  object"): `body.knobs` deep-equals `normalizeKnobs(body.knobs)` AND `Object.keys` are exactly the four,
  with each selection present (so the shape check is not passing over an empty default).
- **Skip-last canary** (File B, "the other area's Skip is disabled with a visible aria-describedby reason"):
  after skipping one of two areas, the last-included Skip is `disabled` and its `aria-describedby` resolves
  to a visible node carrying `lastIncludedReason`.
- **PD-SD-3 canary**: the notices behavioural test + File A egress test assert the gemini notice CONTAINS
  "Any focus or skip choices you set are sent to Gemini with it."; the frozen verbatim pin was updated in
  the same ruling; the embedded notice is unchanged (over-fire control asserts embedded does NOT carry it).

## Mutants WATCHED (isolated reference tree; a node_modules junction; discarded after)

Built the full D-b reference (`useStudyKnobs.js`, `StudyPlanControls.js`, the four C-c wiring edits, the
`notice.gemini` append) in a scratchpad COPY of the working tree (so it sees the uncommitted D-a modules),
with `node_modules` junctioned to the real install. Discarded the junction with `rmdir` (never followed)
then the tree; real install verified intact.

- **M-shape** -- `useStudyKnobs.setKnobs` emits `pace.hoursPerDay` (a field the schema drops). Ran File A:
  ONLY "a mixed customization ... normalizer-STABLE object" reds (`normalizeKnobs(out)` stops equalling
  `out`); the other 14 stay green. Died as an ASSERTION, not an instrument error. No-op control: green.
- **M-skiplast** -- `StudyPlanControls` `AreaRow` sets `skipBlocked = false`. Ran File B: ONLY "the other
  area's Skip is disabled..." reds (the last Skip is enabled, `aria-describedby` absent); other 7 green.
  Died as an ASSERTION. No-op control: green.
- Rebuilt ZERO mutants (neither was an instrument failure).

## Satisfiability PROVEN (the reds describe a build that exists, and do not break neighbours)

In the reference tree, my 2 new files + 10 landed neighbours ran **12 files / 202 tests, all green**:
`StudyPlanControls.test.js`, `StudyPlanControls.staged.test.js`, `StudyPlanClient.test.js`,
`StudyPlanClient.banner.test.js`, `StudyPlanOverview.test.js`, `StudyWalkthrough.contract.test.js`,
`StudyWalkthrough.mobile.test.js`, `studyPlanCopy.test.js`, `studyPlanNotices.test.js`,
`studyPlanNotices.fill.test.js`, `studyPlanKnobs.test.js`, `studyPlanKnobsCopy.test.js`. In particular the
banner test's `{ applicationId, engine, knobs: normalizeKnobs(STORED_KNOBS) }` wire assertion still holds
after `startBuild` switches to `knobs: effective` (no draft -> effective == normalized stored base).

## What I could NOT verify (invalid, not zero)

- **O (owner phone-pane):** rendered px, 320/375/390/430 overflow, whether the mix `ToggleButtonGroup` wraps
  at 320 with "Mostly review" (-> ToggleButtonGroup vs RadioGroup fallback), selected/unselected toggle
  contrast, the numeric keypad. jsdom has no layout; the touch-FLOOR (`min-height: 44px` at xs via
  `atWidth` + `MOBILE_TAP_MIN`) IS pinned, the rendered height is not.
- **G (owner / Gemini):** whether Focus / days / skipped areas actually shape the Gemini plan; the limiter
  under iterative rebuilds.
- **Census:** the export-reachability effect of the new unwired modules and `DIGEST_SECTIONS` gaining its
  first production importer -- the implementer runs the reconcile.

## What the implementer must know

**The four C-c shell wiring edits (as the passing reference built them):**

1. `StudyCreatePanel.CreateStep`: add optional `settings` (ReactNode, rendered BETWEEN the egress notice and
   the Create `Button`) and `createBlockedReason` (disables Create and names a visible `aria-describedby`
   reason). Absent => byte-identical to HEAD.
2. `StudyPlanClient`: call `useStudyKnobs(applicationId, record.knobs)` -> `{ effective, dirty, setKnobs }`;
   derive `areaOptions({ plan: record.plan, knobs: effective, seedAreas: DIGEST_SECTIONS })` and
   `suggestFocusAreas({ plan: record.plan, seen: record.progress?.seen })`; build ONE `StudyPlanControls`
   element; **change `startBuild` to send `knobs: effective`** (replacing `record.knobs ?? undefined`); pass
   `settings={controlsPanel}` + `createBlockedReason` to `CreateStep`, and
   `settings={{ panel, dirty: hasPlan && dirty, blockedReason }}` to `StudyWalkthrough`. **`DIGEST_SECTIONS`
   is imported by the SHELL, not by the pure model** (first production importer -- this is what moves the
   census).
3. `StudyWalkthrough`: forward ONE optional `settings` prop through to `StudyPlanOverview`.
4. `StudyPlanOverview`: render `settings.panel` inside the OPEN outline (above the egress notice + Rebuild);
   honour `settings.blockedReason` on the Rebuild button.

**Hard contracts the tests pin (do not design around them):**

- The days control must render a real `<label>` carrying `daysLegend` (tests find the input by that label)
  AND sit in a fieldset with a `<legend>` (one fieldset+legend per knob, no headings in the panel -- C1).
  In the reference both carry the same text; you may visually-hide the legend, but keep BOTH a `<label>` and
  a fieldset/legend.
- Each area row is `role="group"` labelled by a label element whose text IS the area name; the two toggles
  are named by VISIBLE TEXT ONLY (no `aria-label` override, WCAG 2.5.3) and carry `aria-pressed`. NOTE MUI's
  `ToggleButtonGroup` is itself `role="group"` -- the tests locate the row from its label element, so keep a
  distinct label node per row.
- The panel root is `role="group"` with an `aria-label`/`aria-labelledby`, conditionally rendered (absent
  from the DOM when closed), `aria-expanded`/`aria-controls` on the disclosure.
- Knobs on the wire MUST be normalizer-stable: emit every knob object through `normalizeKnobs`; never emit
  `pace.hoursPerDay` or any dropped/unnormalized field (M-shape).
- Per-engine: under `engine === "embedded"` NO operable Gemini-only knob (no enabled Focus toggle; days
  field absent or disabled) and the `embeddedCaption` shows; the mix + Skip stay operable. Every other
  engine value reads as Gemini (all four, `geminiCaption`).
- `studyPlanCopy.js`: append to `notice.gemini`, at the very end, EXACTLY (leading space):
  ` Any focus or skip choices you set are sent to Gemini with it.` Match the updated pin byte-for-byte; the
  embedded notice is unchanged.
- The draft is per-application (dropped on application switch), per-stored-base (retired when a successful
  rebuild changes the stored knobs), survives panel/outline churn, and is KEPT by a failed/preserved
  rebuild (the shell's `retryBuild` re-sends `effective`).

## Proposed ledger lines

| ID | Requirement (checkable) | Decidability | Instrument / evidence |
|---|---|---|---|
| DES-N157-D-b1 | The controls are REACHABLE through the shell: a "Customize your plan" (create) / "Plan settings" (outline) disclosure opens a role=group panel; a user click on each control changes the POST `/api/study-plan` body | J (wire body) | `StudyPlanControls.test.js`, `.staged.test.js` |
| DES-N157-D-b2 | Every knob object on the wire is normalizer-STABLE and has exactly the four schema keys | J | shape canary; mutant M-shape watched dead |
| DES-N157-D-b3 | Zero-touch create sends `knobs` deep-equal to `normalizeKnobs(null)` (never `undefined`); Create stays the one contained button | J | zero-touch test + CONTROL |
| DES-N157-D-b4 | A post-plan knob change is STAGED: dirty note shown, no build fired; the explicit (armed) Rebuild carries the changed knobs; the `REBUILD_CONFIRM_WINDOW_MS` guard holds | J, fake timers | staged canary + armed test |
| DES-N157-D-b5 | Draft is per-application and per-stored-base: dropped on application switch, retired by a successful rebuild, KEPT by a preserved rebuild (Try again re-sends it), survives panel/outline churn | J | File B draft-lifecycle block |
| DES-N157-D-b6 | The last included area's Skip is disabled with a visible `aria-describedby` reason | J | skip-last canary; mutant M-skiplast watched dead |
| DES-N157-D-b7 | Days commits only whole 1..`MAX_PLAN_DAYS`; an invalid value shows the `<max>`-slotted error and does not reach the normalizer | J | days valid/invalid tests |
| DES-N157-D-b8 | Pre-first-plan area options are `DIGEST_SECTIONS` (fed in by the shell as `seedAreas`); the panel mounts with no plan without crashing | J | areaOptions pre-plan test |
| DES-N157-D-b9 | Focus writes the AREA LABEL into `weakTopicIds` (never a topic id), and never also into `excludedAreas` | J | Focus-toggle wire test (PD-SD-1) |
| DES-N157-D-b10 | Per-engine honesty: embedded hides/disables the Gemini-only knobs + shows `embeddedCaption`; gemini shows all four + `geminiCaption` | J | per-engine tests (knobEffects) |
| DES-N157-D-b11 | PD-SD-3: the Gemini egress notice names the focus/skip choices; the frozen `notice.gemini` pin is updated verbatim; embedded unchanged | N + J | `studyPlanNotices.test.js`, `studyPlanCopy.test.js`, File A egress test |
| DES-N157-D-b12 | Touch floor (`min-height: 44px` at xs from `MOBILE_TAP_MIN`) on the disclosure, a mix segment and an area toggle; auto above; toggles carry `aria-pressed` | J (`atWidth`) | mobile test block |
| DES-N157-D-b13 | Rendered px, 320 overflow, ToggleButtonGroup wrap, toggle contrast, numeric keypad | **O (phone-pane)** | NOT jsdom; owner probe |
| DES-N157-D-b14 | Whether Gemini honours focus/days/skip; limiter under iterative rebuilds | **G (owner/Gemini)** | no seat marks green |
