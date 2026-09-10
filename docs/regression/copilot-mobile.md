### R-157 | area: copilot-mobile | parallel-safe: yes | automatable: no

**Summary:** The interview copilot has no horizontal overflow anywhere between 320px and 430px, in either mode, through either entry point.

**Steps:**
1. Open the copilot BOTH ways: the `/copilot` route, and the "Interview Copilot" tab in the main nav (`app/page.js`, `mainTab === "copilot"`). The nav-tab path adds two more padding layers (`.page` and `.main` in `app/page.module.css`) and is the stricter case.
2. In device emulation, at each of 320, 375, 390 and 430 CSS px wide, in live mode and practice mode, run in the console:

       const vw = innerWidth;
       [...document.querySelectorAll('main *')]
         .filter(el => { const r = el.getBoundingClientRect(); return (r.width || r.height) && r.right > vw + 0.5; })
         .map(el => [el.tagName, el.textContent.trim().slice(0, 40)]);

3. Repeat with a live session started, and with practice mode showing a completed answer's review and feedback.

**Expected:** The array is empty every time. **Measure by element bounds, never by looking for a scrollbar.** `app/globals.css:20` sets `html { overflow-x: hidden }` -- deliberately, and scoped to `html` rather than `body` so the sticky header still pins -- so horizontal overflow here is silently CLIPPED AND UNREACHABLE rather than scrollable. A visual check cannot distinguish "fits" from "the right-hand third was deleted", which is how this shipped: measured at a 320px shell, the copilot's root Box had a min-content width of 327.8px against a 256px content box, and because `.main` is a flex column (so the child's `min-width: auto` floor applies) it overflowed by ~72px with no scrollbar and no visible symptom.

The dominant contributor was the three-option "Interviewer audio" `ToggleButtonGroup` in `SessionSetup.js`: a `ToggleButtonGroup` is `inline-flex` and never wraps internally, so the parent `Stack`'s `flexWrap` -- which was already present -- only ever wrapped BETWEEN the label and the group. **Adding `flexWrap` to a parent does nothing for a non-wrapping child**; the group itself has to change `orientation`. It stacks below `sm` through a bounded `theme.breakpoints.down("sm")` media query in `sx` -- NOT through the `orientation` prop, and NOT through an `{ xs, sm }` object. Both of those were tried and both are wrong here. `orientation="vertical"` did not take effect in this MUI build: the committed fiber carried `orientation: "vertical"` while the DOM still rendered `MuiToggleButtonGroup-horizontal` with `flex-direction: row`, at 320px, across a reload and a resize. And an `{ xs: ..., sm: undefined }` object never switches off, because `xs` compiles to `@media (min-width: 0px)` and is therefore true at EVERY width -- written that way first, it silently shipped detached 8px-radius buttons to the 1280px desktop. **Amended: an earlier draft of this case claimed the orientation was driven by `useIsMobile()` threaded down as a prop. It never was; `SessionSetup.js` has no `useIsMobile` import at all.** The second contributor was `MicPicker.js`'s hard `minWidth: 220` `FormControl`. **Amended: an earlier draft called that "the only fixed px width in the live file set", which is false** -- `PostingPicker.js`'s `maxWidth: 480` and `AnswerAids.js`'s `minmax(0, 150px)` are both fixed px values in live-mode components. Neither is a defect: a `maxWidth` is a ceiling over a fluid child and never constrains a phone, and `minmax(0, ...)` explicitly permits shrinking below its track size. What made `minWidth: 220` different is that it is a FLOOR with nothing allowed under it.

### R-158 | area: copilot-mobile | parallel-safe: yes | automatable: no

**Summary:** Every interactive control in the copilot is at least 44 CSS px tall on a phone.

**Steps:**
1. At 375px wide, in live mode and practice mode, run:

       const SEL = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=switch], [role=combobox], .MuiSwitch-switchBase';
       [...document.querySelectorAll('main ' + SEL.split(', ').join(', main '))]
         .filter(el => el.getAttribute('aria-hidden') !== 'true' && el.getAttribute('tabindex') !== '-1')
         .map(el => {
           const target = el.closest('.MuiInputBase-root') || el;
           return { h: target.getBoundingClientRect().height, label: (el.getAttribute('aria-label') || el.textContent || el.type || '').trim().slice(0, 40) };
         })
         .filter(x => x.h && x.h < 44);

2. Expand every disclosure first (setup, transcript history, submitted docs, prep context, sample answer) and start a practice answer, so their controls exist to be measured.
3. For `SpeakerChip`'s "Mark ... as me" button, the visual pill stays 20px on purpose -- verify its HIT area instead by tapping 10px above and 10px below it and confirming both activate it.

**Expected:** The filtered array is empty apart from `SpeakerChip`'s button, whose hit area is extended by a transparent `::after` (`TOUCH_PILL_SX` in `app/theme/mobileSx.js`) rather than by growing the pill -- a chip grown to 44px would dominate every transcript row. Twelve controls measured under 44px in live mode idle alone before this work, including both disclosure buttons, each of which is the ONLY route to its content while a session is live.

The mobile rules live in ONE place (`app/theme/mobileSx.js`; existing `app/copilot/` imports reach it through a re-export shim left at the old `app/copilot/mobileSx.js` path -- R-299) rather than being restated per call site, the same argument that makes `livePace.js` import `answerMetrics.js`'s thresholds instead of repeating them: two definitions of "big enough to tap" will drift.

**Amended: an earlier draft claimed "every value in that module is breakpoint-scoped so that at 600px and above the rendering is unchanged". That is false and must not be restored.** Three constants deliberately apply at every width -- `WRAP_ROW_SX` (a row should wrap wherever it does not fit, not only on a phone), `BREAK_LONG_WORDS_SX` (and `overflowWrap: "anywhere"` is NOT inert on desktop: unlike `break-word` it also feeds intrinsic min-content sizing), and `TOUCH_PILL_SX`'s positioning context -- while `PHONE_PANE_SX` is keyed to `md` and so changes the 600-899px band on purpose. The module's opening comment now states which is which. What IS a hard requirement, and what the rest of this paragraph is about, is narrower: **where a value is meant to be phone-only, its `sm`/`md` branch must be the property's real initial value.** `SpeakerChip` shipped a first version of this fix with `minWidth: { xs: 44, sm: 0 }`; the button had previously had no `min-width` at all, i.e. `auto`, which on a flex item is exactly what stops it being squeezed below its own label. `0` handed that floor back at every desktop width to buy nothing. Check any `sm`/`md` value that reads as "off" -- `0`, `none`, `visible` -- against what the property's INITIAL value actually was.

**Amended (chunk A — interview type):** `SEL` omitted `[role=combobox]`, which is what MUI's non-native `Select` actually renders (a `div`, never a `<select>` or a `<button>`) -- the sweep could not see the interview-type picker, or any other Select-based control, at all. It also had no exclusion for MUI's hidden native `<input>` (`aria-hidden="true"`, `tabindex="-1"`, ~21px), which the unfiltered `input:not([type=hidden])` clause matched as a false positive -- it is deliberately never a tap target. And a matched `<input>` nested inside a `.MuiInputBase-root` -- `PostingPicker`'s own Autocomplete field, measured at 28px -- was measured at its own height rather than its root's, when the 44px `InputBase` root beneath it is the actual tappable surface. Step 1 now adds `[role=combobox]` to `SEL`, filters out `aria-hidden`/`tabindex="-1"` matches before measuring, and measures the closest `.MuiInputBase-root` ancestor when one exists (the same class `app/theme/mobileSx.js` itself targets as "the outer clickable surface"), falling back to the element itself when there is none. The counts named elsewhere in this case predate this fix and are unchanged by it.

### R-159 | area: copilot-mobile | parallel-safe: yes | automatable: no

**Summary:** On a phone the page is the single scroll container -- no copilot pane is its own nested scroller, and every viewport-height value that does reach a phone is expressed in `dvh` with a `vh` fallback.

**Steps:**
1. At 375x812 in live mode, scroll the page with a drag that starts INSIDE the transcript pane, then inside the question feed, then inside the "Submitted for this application" panel.
2. Confirm `TranscriptView`, `QuestionFeed` and `SubmittedDocs` compute no `overflow-y: auto` and no height cap below `md`.
3. Widen past 900px and confirm all three return to being bounded, internally-scrolling panes.
4. In practice mode, confirm the camera preview does not exceed the viewport on a short or landscape phone.

**Expected:** Every drag scrolls the page. Below `md` the three panes grow with their content (`PHONE_PANE_SX`); at `md`+ their previous `minHeight: 340` / `maxHeight: 62vh` / `overflowY: auto` behaviour is unchanged. Two independent reasons, each sufficient on its own: a nested touch scroller steals the page-scroll gesture and makes the page feel stuck, and `62vh` is the LARGE-viewport height on iOS Safari, so a pane sized to it is taller than the visible area whenever the URL bar is expanded and its bottom rows sit under the chrome. Note it was plain `vh`, not `dvh` -- `CopilotClient.js` already does the `CSS.supports("height", "1dvh")` dance for its own live column, so the idiom existed and had simply not been applied here.

`SubmittedDocs` is the sharpest case: setting `overflow-y: auto` while `overflow-x` stays `visible` makes the computed `overflow-x` `auto` as well (CSS overflow spec), and its resume text is `white-space: pre-wrap`, which preserves the document's own long lines -- so it was a 260px-tall TWO-AXIS nested scroller on a ~250px-wide screen. It keys the same release to `md` as its two siblings, but deliberately does NOT spread `PHONE_PANE_SX`: that constant carries a `minHeight: 340` / `maxHeight: 62vh` pane geometry, while this panel has its own smaller, deliberate `SCROLL_MAX_HEIGHT = 260` cap that must survive. The breakpoint is shared; the cap is not. **Amended: this originally shipped keyed to `sm`, leaving it a bounded two-axis scroller between 600 and 899px while both siblings had already released -- two definitions of one rule, which is exactly the drift `app/theme/mobileSx.js` exists to prevent.**

`CopilotClient.js`'s live-height block was already correctly gated (`measureLiveHeight = live && !isMobile`, plus `height: { xs: "auto", sm: ... }`) -- that guard is complete at both the JS and CSS layers and must stay. Only its sibling `overflow` key had been left ungated, and that single omission is what made every other overflow on this page invisible while a session was live.

### R-160 | area: copilot-mobile | parallel-safe: yes | automatable: yes

**Summary:** A device that cannot capture a display surface is not offered the two sources that require one, and a source chosen on another device resolves to something runnable.

**Steps:**
1. Read `hello-world/lib/copilot/captureSupport.js` and how `CopilotClient.js` seeds `source` from `localStorage` through `resolveInterviewerSource`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/captureSupport.test.js` from `hello-world/`.
3. In a desktop browser, confirm all three "Interviewer audio" options are enabled and stored-source behaviour is unchanged.
4. In devtools, delete `navigator.mediaDevices.getDisplayMedia` and reload. Confirm "Browser tab" and "System audio (speakers)" are disabled, that a visible sentence in the DOM explains why, and that the selection has become "In person (same microphone)".
5. Set `localStorage["copilot-audio-source"] = "tab"` on that same crippled profile, reload, and confirm the session still starts.

**Expected:** `getDisplayMedia` is unsupported on EVERY mobile browser -- Safari on iOS, Chrome for Android, Samsung Internet, Android Browser and Opera Mobile are all unsupported per caniuse. `lib/copilot/session.js`'s `THEM_CAPTURE_BY_SOURCE` maps `tab` and `system` straight onto functions that call it, and `start()` awaits `captureThem()` as its first act, so before this those two options were controls on a phone that could only ever throw.

Detection is FEATURE detection (`typeof mediaDevices?.getDisplayMedia === "function"`), never user-agent sniffing, and a key that merely exists is not enough -- a non-callable value would still throw. The explanation must be real text in the DOM: a `title=` or a `Tooltip` has no touch equivalent, so on the exact devices this exists for it would never be seen. The wording states a capability gap and never says "denied" or "permission" -- the browser never gets far enough to prompt -- and the test asserts those words are absent.

`unavailableSourceReason` is deliberately called with the fixed string `"tab"`, never with the current `source` state. `"tab"` and `"system"` share an identical reason, `"inperson"` always returns `""`, and a device without display capture is exactly the case where `source` has already been resolved to `"inperson"` -- so reading the reason off the selected source would go silent precisely when it is needed. The seed effect depends on `displayCapture` rather than `[]` for the same reason: detection lands after the first render, and without the re-run a phone's stored or default `"tab"` would never self-correct.

**`lib/copilot/session.js` is deliberately unchanged.** Its fallback of an unrecognized source to `captureTabAudio` is pinned by R-034/R-038/R-144 and must stay; this gate is in the UI only. On a device that DOES support display capture, `resolveInterviewerSource` reproduces today's behaviour exactly, including `"tab"` as the default -- pinned by its own assertion so a change to the default has to be deliberate rather than a side effect of this feature.


**RUN AND PASSED (2026-08-09), including the manual steps.** Recorded here rather than left as "verified by reading", because the automated tests cover `captureSupport.js` in isolation and prove nothing about the wiring.

Method, since the obstacle is real and will recur: the stub has to be installed BEFORE `CopilotClient`'s mount effect, which is where `displayCaptureSupported()` is called and the answer latched -- a `useEffect` in a wrapper races the child's own effect and loses. Two throwaway routes under `app/auth/` (public per `lib/supabase/middleware.js`), identical except that one shadows the method at MODULE scope, which evaluates during hydration before any render. Note `delete navigator.mediaDevices.getDisplayMedia` does NOT work: the method lives on `MediaDevices.prototype`, so deleting a non-existent own property returns true and changes nothing. `Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", { value: undefined, configurable: true })` is what actually hides it. Both routes deleted after the run.

Observed on the control (display capture present): all three options enabled, `"tab"` selected by default, no reason text rendered anywhere, Start enabled. With `localStorage["copilot-audio-source"] = "system"`, System audio came back selected -- stored source still honoured, unchanged by this feature.

Observed on the crippled device: `getDisplayMedia` absent, Browser tab and System audio both `disabled`, In person selected, Start still enabled. The reason rendered as a real `<p>` in the DOM (not a `title=`, not a tooltip) reading "This browser can't share a tab or your screen. Pick the In person (same microphone) option instead, or open the copilot in desktop Chrome or Edge to capture a call.", and contains neither "denied" nor "permission". With a stored `"system"` AND separately a stored `"tab"`, both resolved to In person -- and **`localStorage` still held the original value afterwards**, so a laptop preference is not clobbered by being read on a phone.

The sharpest part, and the reason step 5 exists: pressing Start with `getDisplayMedia` replaced by a getter that counts reads gave **zero accesses** -- the in-person path does not call it, and does not so much as look at it. `getUserMedia` was called exactly once, with `{audio: {echoCancellation, noiseSuppression, autoGainControl}}` and **no `deviceId` own-key at all** (System default, which is R-101's requirement, incidentally re-confirmed here). The session then failed on "Microphone unavailable (Permission denied)", which is the browser pane blocking microphone access and not a product fault; what matters is that it failed at the MICROPHONE and never at display capture. Before this feature that same click would have thrown `getDisplayMedia is not a function` as `start()`'s first act.

A full end-to-end session still has not been run on a real phone -- that needs a device, a microphone grant, and an STT key. This case does not claim otherwise.

### R-161 | area: copilot-mobile | parallel-safe: yes | automatable: no

**Summary:** Practice mode's drill is reachable on a phone, and its reordering moves the DOM rather than only the pixels.

**Steps:**
1. At 390x844 in practice mode with a posting selected, confirm the question card appears above the five-panel dashboard, with the compact self-view above both.
2. **Tab through the page from the top and confirm the focus order matches the visual order** -- "Start answering" must be reached before the dashboard's "Show sample answer", not after it.
3. Widen past 900px and confirm the order returns to exactly what it was before this work: dashboard above the question card, full-size camera preview beside the transcript in the bottom row.
4. Confirm only ONE `<video>` element is bound to the camera stream at any width: check `document.querySelectorAll('video').length` and which have a `srcObject`.
5. Rotate/resize across the 900px boundary while a sample answer is revealed and confirm it stays revealed.

**Expected:** Before this work the dashboard sat between the controls and the question card, putting "Start answering" ~1990px down (about 2.9 screens) and the self-view ~2100-3400px down -- so a candidate could never see the question and their own face at once, which is practice mode's entire premise.

**Step 2 is the point of this case.** The first implementation used breakpoint-keyed CSS `order` on a flex column. That moves the paint order and leaves the DOM alone, so below `md` a keyboard or screen-reader user met the dashboard -- including its "Show sample answer" button -- BEFORE the question card while every sighted user saw the opposite: a visual/focus order mismatch, WCAG 2.4.3 and 1.3.2. Reordering the rendered array instead keeps the two in agreement. The `key`s on those two blocks are load-bearing: React matches keyed children across a reorder, so crossing the breakpoint MOVES them rather than remounting them, and `CopilotDashboard`'s panels carry `aria-live` regions that go unannounced if they remount already holding their final text.

The reveal gate must survive the reorder: the dashboard and the question card share ONE `useSampleAnswer` instance, because a second visibility flag would let them disagree about whether the model's answer is on screen. Likewise only one `<video>` may hold the stream -- the compact self-view is the same component re-placed, not a second copy.

**What must NOT be done to shorten the scroll:** the privacy notice at the top of `PracticeSetup.js` is the largest single block of height, and collapsing it behind a disclosure is forbidden. This codebase has shipped that failure twice -- a posting-grounding fact appended to a dismissible consent `Alert` (BUG-H4), and a recording notice that vanished the moment `start()` collapsed the setup block (BUG-4). A disclosure may not live inside a dismissible or collapsible container, and "it was too tall on mobile" is not an exception.

### R-165 | area: copilot-mobile | parallel-safe: yes | automatable: no

**Summary:** The live transcript still follows the newest line on a phone, where the pane is no longer its own scroll container.

**Steps:**
1. Start a live session at 375px, expand "Show transcript and question history", and let several turns of speech arrive.
2. Confirm the newest line is brought into view as it arrives.
3. Scroll UP to re-read an earlier line and confirm you are NOT dragged back down by the next arriving line.
4. Repeat both at >= 900px, where the pane IS its own bounded scroller, and confirm the behaviour there is unchanged from before the mobile pass.

**Expected:** Auto-follow works in both regimes, and which regime applies is read from the ELEMENT (`scrollHeight > clientHeight`), never from a duplicated breakpoint in JS -- a second `useMediaQuery` would be free to drift from the CSS that actually decides it.

This case exists because the mobile pass broke it and nothing caught it. `TranscriptView` kept the newest line visible by writing `el.scrollTop = el.scrollHeight` and recomputing a stick-to-bottom flag in `onScroll`. Applying `PHONE_PANE_SX` set `overflowY: visible` with no height cap below `md` -- deliberately, so the page is the single scroller on a phone (R-159) -- which means the pane stopped being a scroll container at all: `scrollHeight === clientHeight`, the `scrollTop` write became inert, and `onScroll` never fired again. Mid-interview on a phone the newest line simply went off-screen with nothing to bring it back, while the code still READ as though it worked, which is worse than the feature being absent.

Severity was limited only by an unrelated accident: live mode collapses the transcript disclosure by default, so the pane is opt-in during a session. That is not a mitigation to rely on -- step 1 opens it.

The general lesson, and the reason this is its own case rather than a footnote on R-159: **removing a scroll container silently disables every behaviour built on it.** Anything reading `scrollTop`, `scrollHeight`, `onScroll`, or `scrollIntoView` against that element becomes dead code that still type-checks, still lints, and still looks correct in review. When a pane stops being `overflow: auto` at any breakpoint, grep the component for those four names before assuming the change is presentational.

