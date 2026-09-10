### R-315 | area: sticky-stats-row | parallel-safe: yes | automatable: yes

**Summary:** The sticky strip's speaking-stats row (`app/copilot/dashboard/StatsRow.js`, mounted by `app/copilot/dashboard/StickyQuestionStrip.js`) renders in exactly the states the design's truth table allows and no others. The two that are easy to get wrong, and that nothing else in this document covers: **stats-only** -- a live session that has not detected a question yet, which is the ordinary OPENING of every interview -- must show the row with NO question panel and no `noQuestion` copy pinned over "Start session"; and **post-Stop with a question still on screen** -- the shipped behaviour where a question survives Stop -- must keep the question and DROP the row, because a dead session's last reading pinned to the top of the page reads as a live one.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism app/copilot/dashboard/StickyQuestionStrip.test.js app/copilot/dashboard/StatsRow.test.js`.
2. Read `const showStats = sessionLive && statsHosted;` in `app/copilot/dashboard/StickyQuestionStrip.js` against its own comment, and the `if (statsOnly && measured && !showStats) return null;` early return below it.
3. Read `useStickyTop.js`'s `isStatsHostable(headerH, rootPx, stripW)` and confirm it is a SECOND predicate that begins `if (!isHostable(headerH)) return false;` -- the row is never hosted where the question's own strip is not.

**Expected:** All 49 tests across the two files pass. The truth table is asserted state by state: *"rows 1 and 1'"* (question + both readings when hosted; question only when not), *"rows 2 and 2'"* (a live session with nothing measured yet still holds the row -- the reservation is held from the session's first frame, so an eighth word landing mid-answer changes TEXT, never layout), *"row 3"* (statsOnly mounts the row with no question panel and no `noQuestion` copy), *"row 3'"* (statsOnly with the row not hosted renders `null`, not an empty sticky box), *"ROW 5"* (a question that survives Stop keeps the question and drops the row), *"row 6"* (question, session over, nothing measured -- byte-identical to pre-feature output), and *"AC 40"* which re-derives the whole `sessionLive && statsHosted` product over the full 2x2x2 table.

**The `sessionLive` conjunct is the load-bearing half and is proved so by mutation.** Reducing `const showStats = sessionLive && statsHosted` to `const showStats = statsHosted` turns exactly three of these red, and ROW 5 is not vacuous -- its control (same fixtures, `sessionLive` flipped) passes in the same run:

```
FAIL ... > ROW 5 - a question that survives Stop keeps the question and DROPS the row (AC 25)
AssertionError: a finished session's reading must not stay pinned: expected true to be false
FAIL ... > row 6 - question, session over, nothing measured: byte-identical to today
FAIL ... > AC 40 - the row is rendered iff (sessionLive && statsHosted), over the full 2x2x2 table
AssertionError: sessionLive=false statsHosted=true anyMeasured=true: expected true to be false
Tests  3 failed | 33 passed (36)
```

**`sessionLive` is deliberately NOT the component's pre-existing `live` prop.** `live` defaults to `true` and drives `HeldQuestionPanel`'s caption; reusing it would leave the row rendered after Stop, which is exactly what ROW 5 forbids. `sessionLive` defaults to `false` -- unchanged behaviour for every caller that predates the prop, and the SAFE value for a caller that forgets it. `statsOnly` defaults `false` for the same reason, but is NOT safe to omit at a mount site: omitting it there pins `copy.noQuestion` over SessionSetup/PracticeControls the moment a live session with no question yet reaches the strip.

### R-316 | area: sticky-stats-row | parallel-safe: yes | automatable: yes

**Summary:** A stats-only strip that collapses to `null` on an unhostable geometry must come back when that SAME mount is later resized into a hostable one. This is the defect the post-verification fix in `app/copilot/useStickyTop.js` closes: the collapse unmounts the very Box `stripRef` measures through, so `measure()` used to read a fabricated zero-width rect forever and `isStatsHostable`'s width clause could never pass again -- the speaking stats were lost for the rest of a session that had no question yet, on the majority of configurations, recoverable only by ending the session. **No fresh-mount test can see this**, and the suite's own geometry harness builds a fresh root per cell by design, which is why 44 green tests sat on top of it.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism app/copilot/dashboard/StickyQuestionStrip.test.js app/copilot/useStickyTop.test.js`.
2. Read the three pieces of the fix in `app/copilot/useStickyTop.js`: the `if (!stripRef.current) { setMeasured(false); return; }` branch inside `measure()`; the SECOND `useLayoutEffect` keyed on `[measured, measure]` that re-runs `measure()` whenever `measured` is false; and `roRef`, the shared `ResizeObserver` handle that lets that effect re-`observe()` the node that just remounted.
3. Read the `describe("MAJOR-1 regression: ...")` block at the end of `StickyQuestionStrip.test.js` and confirm both its tests reuse ONE root across the geometry change -- and that the second is a CONTROL with a question present, so the ref never unmounts.

**Expected:** All 43 tests across the two files pass, including *"a stats-only mount that collapses to null on a refused geometry comes back once the SAME mount resizes into a hostable one"* and its control.

**Both halves of the fix are proved load-bearing by mutation, and the control isolates the cause.** Restoring the pre-fix shape of `measure()` -- `const stripRect = stripRef.current ? stripRef.current.getBoundingClientRect() : { width: 0, height: 0 };` in place of the null-ref reset -- kills the recovery test and nothing else, with the control still green:

```
FAIL ... > a stats-only mount that collapses to null on a refused geometry comes back
          once the SAME mount resizes into a hostable one
AssertionError: the row must come back once the SAME mount resizes into a hostable geometry
- Expected: /\bwpm\b|% filler|speed: not measured yet|filler: not measured yet/
+ Received: ""
Tests  1 failed | 35 passed (36)
```

Deleting the second `useLayoutEffect` instead takes down **16** tests across the two files, because that effect is now the ONLY caller of `measure()` on mount -- the first effect registers the listener and the observer and nothing else.

**`measured` settles; it does not oscillate.** The reset is not a loop: `measure()` sets `measured` false only when it finds no strip to read, the re-probe effect then re-runs `measure()` against a Box that React has already remounted and attached the ref for in that same commit, and the successful measurement latches `measured` true again, at which point the effect returns immediately. **Measured, not argued:** one collapse-then-recover costs exactly **two** `measure()` passes (one null-ref probe, one real reading), three consecutive collapse/recover cycles on ONE mount cost 2 up / 1 down every time with no growth, and a genuinely unhostable geometry ends at `innerHTML === ""` rather than at an empty box. A `ResizeObserver` that re-fires on every `observe()` -- the spec's behaviour when the newly observed node has a size that differs from the zero it starts at -- adds one extra pass per transition and still terminates, because a node detached by the collapse measures 0x0, equals its last reported size, and is therefore not an active observation.

### R-317 | area: sticky-stats-row | parallel-safe: yes | automatable: yes

**Summary:** Neither line of the speaking-stats row ever prints a fabricated zero. Each reading gates on its OWN `measured` flag -- never a combined gate, never object truthiness, since `computeLivePace`/`computeLiveFillers` return an object on every path -- and an unmeasured reading renders the shipped literal `speed: not measured yet` / `filler: not measured yet` verbatim, whatever numeric fields the reading object happens to still be carrying.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism app/copilot/dashboard/StatsRow.test.js`.
2. Read `paceText`/`fillerText` in `app/copilot/dashboard/StatsRow.js` and confirm each opens with its own `if (!pace?.measured)` / `if (!fillers?.measured)` guard returning the literal, and that the two literals are the ones `CopilotDashboard.js` already ships.

**Expected:** All 13 tests pass, including *"renders BOTH shipped literals verbatim when neither reading is measured"*, *"never prints 0 wpm or 0.0% filler, even when the unmeasured reading carries a zero"*, both *"gates each line on its OWN measured flag"* cases (each direction), and *"shows the real filler reading for a zero-duration frame"* -- a genuinely measured `0.0%` is NOT suppressed, which is the distinction a naive `if (!value) return "not measured"` would destroy.

**Verified by mutation.** Deleting the pace guard alone -- so the numeric formatter runs on an unmeasured reading -- turns six tests red across this file and `StickyQuestionStrip.test.js`, printing exactly the fabrication the rule exists to forbid:

```
AssertionError: expected '0 wpm · null' to be 'speed: not measured yet'
AssertionError: expected '0 wpm · Slow' to be 'speed: not measured yet'
Tests  6 failed | 43 passed (49)
```

The second of those is the one that matters: the fixture's unmeasured reading still carries `wordsPerMinute: 0` and `paceLabel: "slow"`, so a gate keyed on the VALUE rather than on `measured` renders a confident, wrong reading rather than an obviously broken one.

### R-318 | area: sticky-stats-row | parallel-safe: yes | automatable: yes

**Summary:** A speaking-stats reading expires on a WALL clock bounded by `DEFAULT_WINDOW_SEC`, **imported from `lib/copilot/livePace.js` and never restated** (`lib/copilot/liveStale.js`). `trimToWindow` anchors its rolling window to the last sample's own audio-clock `end`, so once a speech-to-text socket stops delivering frames the last computed reading would otherwise persist forever with `measured` still true. A deliberate Stop is the opposite case and must NOT expire anything: both clients' 1-second tickers are torn down at Stop, `now` freezes, and the session's true final reading survives for as long as the user looks at it.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism lib/copilot/liveStale.test.js`.
2. Read `export const STALE_AFTER_SEC = DEFAULT_WINDOW_SEC;` in `lib/copilot/liveStale.js` and the comment above it explaining that the window and the staleness bound are two different clocks that want the same number today -- a policy call, not an identity -- so a second literal here would silently stop agreeing the moment `DEFAULT_WINDOW_SEC` is retuned.
3. Read `staleAdjusted` and confirm it returns a NEW object (`{ ...reading, measured: false }` with every value field nulled) and never mutates its argument -- the same adjusted objects are handed to both the sticky strip and `CopilotDashboard`'s `DeliveryPanel`.

**Expected:** All 9 tests pass: *"equals livePace.js's DEFAULT_WINDOW_SEC"*, *"imports DEFAULT_WINDOW_SEC from livePace and contains no restated 30"*, *"keeps a reading whose last sample is exactly STALE_AFTER_SEC old -- the bound is `>`, not `>=`"*, the two "past the bound" cases which additionally assert the expired reading renders as the literal and **never as 0 wpm / 0.0% filler**, *"leaves an already-unmeasured reading unmeasured rather than inventing one"*, *"does not mutate the reading it is handed"*, and *"preserves the final reading indefinitely while `now` does not advance"*.

**Verified by mutation.** Replacing the import with the equal literal (`export const STALE_AFTER_SEC = 30;`) leaves every behavioural test green and is caught only by the source-level pin -- which is the entire reason that pin exists:

```
AssertionError: expected '// ARCH-stats-in-strip r3 §2.7 - the …' to match /STALE_AFTER_SEC\s*=\s*DEFAULT_WINDOW_…/
Tests  1 failed | 8 passed (9)
```

### R-319 | area: sticky-stats-row | parallel-safe: yes | automatable: partly

**Summary:** The row reserves its own height with `minHeight: calc(4px + 2.51rem)` and never a fixed `height`, so the strip does not reflow -- and does not push the question down -- when a reading arrives mid-answer. This is why the row is rendered from the session's first frame rather than when the first reading lands: presence is constant, only the TEXT changes.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism app/copilot/dashboard/StickyQuestionStrip.test.js app/copilot/dashboard/StatsRow.test.js`.
2. Read `const STATS_RESERVE = "calc(4px + 2.51rem)"` in `app/copilot/dashboard/StatsRow.js` and the comment above the `<Box>` explaining why it is `minHeight` and never `height`: above the width bound the content never exceeds the reservation, below it the row is not hosted at all, so the only failure a wrong bound can produce is a slightly TALLER strip, never a truncated reading.
3. In a real browser with a live session on screen, read the row element's `getBoundingClientRect().height` and its container strip's height while the readings are unmeasured, then again once both have been measured. Neither number may change.

**Expected:** All 49 tests pass, including *"declares minHeight: calc(4px + 2.51rem) and never a fixed `height`"*, *"puts each reading in its own element -- two siblings, never one wrapping row"*, and *"AC 43 -- the first measurement changes the TEXT, never the row's presence or identity"*. Step 3 measured in Chrome at a 375px-wide viewport, root 16px, strip width 351: row height **44.16 -> 44.16**, strip height **192.13 -> 192.13**, capped question box **123.97 -> 123.97** as the text goes from `speed: not measured yet` / `filler: not measured yet` to `125 wpm · Conversational` / `12.5% filler · Heavy filler`. Computed `min-height` reads back as exactly `44.16px`.

**Verified by mutation.** Dropping `minHeight: STATS_RESERVE` from the row's `sx` leaves every rendering test green -- jsdom has no layout engine and cannot see a reflow -- and is caught only by the source pin, which is why that pin is written as a source assertion rather than as a style read:

```
AssertionError: expected '"use client";\n\nimport Box from "@mu…' to match /minHeight\s*:/
Tests  1 failed | 12 passed (13)
```

**One reading per LINE, not a wrapping flex row.** The shipped `ReadingSlot`/`DeliveryPanel` treatment in `CopilotDashboard.js` reflows across strip widths (worst delta 100px over the sweep the design measured), and a strip that reflows as a reading arrives pushes the question down with it. Two fixed lines plus a constant `minHeight` make the row's height a function of root font size alone, never of the text inside it -- which is also what absorbs an implausible four-digit wpm from a short-span frame (`computeLivePace` clamps nothing) as a taller row rather than a cut-off one.

### R-321 | area: sticky-stats-row | parallel-safe: no | automatable: no

**Summary:** The geometric facts about the speaking-stats row that jsdom cannot observe, and that no test in this repo asserts: that the strip is really pinned with the row on it, that the row is really on screen when the page is scrolled, that the reservation is really the pixel height it claims, that the row's arrival really costs the question nothing, and -- the one that has no automated proxy at all -- that the collapse-and-recover cycle from R-316 resolves **before the browser paints**, so a recovering strip never flashes an empty bar. Every test in the suite stays green when both of `useStickyTop.js`'s effects are downgraded from `useLayoutEffect` to `useEffect` (verified: 51 passed, 0 failed), so this case is the only thing standing between that downgrade and a shipped visual regression.

**Steps:**
1. Start the dev server (`npm run dev` from `hello-world`) and open a live copilot session in a real browser, sized to a 375x812 viewport at root font size 16px. If a live session is impractical, mount `StickyQuestionStrip` with `statsOnly`/`sessionLive` both true on a throwaway page under `hello-world/app/auth/<name>/page.js` -- `AppHeader` is deliberately hidden on `/auth/*`, so stand in a `position: sticky; top: 0; height: 51px` element carrying `data-app-header=""`, and put roughly 4000px of page content BELOW the strip. The strip must be a direct child of a tall containing block or `position: sticky` silently does nothing. **Delete the throwaway page and confirm with `git status` afterwards.**
2. With both readings measured, read the strip's outer element and its two children. Then scroll to `window.scrollY = 1500` and read them again.
3. Toggle the readings between measured and unmeasured and re-read the row's height and the strip's height.
4. Toggle `sessionLive` off and on -- i.e. the row present and absent -- and read the capped box's computed `max-height` and its `getBoundingClientRect().height` in both states.
5. Shrink the viewport to 375x500 (a geometry where the question's strip is still hostable but the ROW is not) and fire the `resize` a real window resize or rotation fires. Then restore 375x812 and fire it again. **Watch the strip while this happens.**
6. Repeat step 5 twice more on the same page load, without reloading.

**Expected:** Every measurement below matches, and step 5 shows no empty bar at any point.

| measurement | expected |
|---|---|
| capped box `max-height`, row present / absent | **228.3px** / **228.3px** -- unchanged, the cap is never debited for the row |
| capped box height, row present / absent | identical in both (measured **123.97px** both ways for this harness's question; an earlier harness at the same cap measured **219.97px** both ways for a longer one -- the durable assertion is that the two are EQUAL, not the absolute value) |
| row height reserved | **44.16px**, and computed `min-height` reads back `44.16px` = `calc(4px + 2.51rem)` |
| row height, unmeasured -> measured | **44.16 -> 44.16**; strip **192.13 -> 192.13**; capped box **123.97 -> 123.97** |
| strip growth from the row | **56.16px** (44.16 row + the row's own 12px `mt: 1.5`) |
| strip at `scrollY = 1500` | `position: sticky`, `top: 51px`, measured `getBoundingClientRect().top` = **51.00**, exactly the header's `bottom` -- pinned, and not over the header |
| row at `scrollY = 1500` | still on screen -- top **186.97**, bottom **231.13** |

**Step 5 is the one this case exists for.** The strip must vanish on the shrink and **come back with the row on it** on the restore, and at no point may an empty bar appear. Measured in Chrome with a `MutationObserver` on the strip's parent: the shipped source produces **one** mutation batch on recovery, going straight from "no strip" to the final 56.16px row-bearing strip. With both effects changed to `useEffect` the identical sequence produces **two** -- an intermediate `height: 12px`, empty-text box that survives into its own event-loop task, which is a paintable frame:

```
SHIPPED (useLayoutEffect)  muts: [ {has:true, h:56.16, txt:"125 wpm · Conversati"} ]
MUT      (useEffect)       muts: [ {has:true, h:12,    txt:""},
                                   {has:true, h:56.16, txt:"125 wpm · Conversati"} ]
```

Step 6 must reproduce step 5 exactly, three times over: recovery is not a one-shot latch. Measured: three consecutive collapse/recover cycles on one page load, each recovering to the same 56.16px strip in a single mutation, with an empty browser error log throughout.

**Two harness notes for whoever re-runs this.** CDP viewport emulation (devtools device toolbar, `Emulation.setDeviceMetricsOverride`) changes `document.documentElement.clientHeight` **without dispatching `window.resize`** -- measured, twice, in two separate sessions -- so step 5 needs the event fired explicitly after the emulated resize; a real window drag or a device rotation does fire it. And a Chrome tab that is not being rendered (a hidden devtools panel, a background tab) runs no `requestAnimationFrame` callbacks and delivers no `ResizeObserver` notifications at all, so the observer-driven half of the recovery path cannot be exercised there -- only the `resize`-listener half. Geometry reads (`getBoundingClientRect`, `getComputedStyle`) are unaffected and stay accurate.

