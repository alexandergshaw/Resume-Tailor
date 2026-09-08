// ARCH-stats-in-strip r3 §2.7 / AC 26-28. FAILING TESTS, written before
// `lib/copilot/liveStale.js` exists. Every `it` below that names a behaviour
// of `staleAdjusted` is RED until the module lands; the two source-shape
// assertions are red for the same reason (the file is absent).
//
// THE CONTRACT THESE TESTS PIN (§2.7, §4.2):
//
//   export const STALE_AFTER_SEC = DEFAULT_WINDOW_SEC;   // imported, not restated
//   export function staleAdjusted(reading, { lastSampleAt, now }) -> reading | unmeasured twin
//
// WHY A PURE FUNCTION IS THE WHOLE TESTABLE SURFACE. The staleness rule is
// two clocks: `trimToWindow` anchors on the last sample's AUDIO clock
// (livePace.js:140-148), the staleness bound is a WALL-clock difference. The
// wall clock is the 1s ticker both clients already own, which runs only while
// capture runs (useLiveSession.js:267-271,
// usePracticeCaptureSession.js:123-127). So:
//
//   * WHILE CAPTURE RUNS `now` advances, and a window that can no longer
//     contain any sample renders unmeasured -- the STT-failure case.
//   * AFTER A DELIBERATE STOP the interval is torn down and `now` FREEZES,
//     so the session's true final reading survives for review in
//     DeliveryPanel. That is modelled here by calling the function twice with
//     the SAME `now`; it is not something a timer test can prove, because
//     there is no timer left to advance.
//
// NOT ASSERTED HERE, AND WHY: that the ticker actually stops on Stop is the
// two hooks' own behaviour, not this module's -- it is fenced by their
// existing tests plus AC 30's client-level check. This file only proves that
// GIVEN a frozen `now`, the reading survives, and GIVEN an advancing one past
// the bound, it does not.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_WINDOW_SEC } from "./livePace.js";

const MODULE_PATH = fileURLToPath(new URL("./liveStale.js", import.meta.url));

async function loadLiveStale() {
  // Reported as an ordinary assertion failure rather than an unresolved-
  // import stack, so an absent module reads as "the subject does not exist
  // yet" -- stickyQuestionGuards.test.js:33-39's own pattern.
  expect(existsSync(MODULE_PATH), "lib/copilot/liveStale.js does not exist yet").toBe(true);
  return import("./liveStale.js");
}

function sourceOf() {
  expect(existsSync(MODULE_PATH), "lib/copilot/liveStale.js does not exist yet").toBe(true);
  return readFileSync(MODULE_PATH, "utf8");
}

// Comments are stripped before the "no restated literal" scan: the module is
// REQUIRED to explain in prose why 30 seconds is the policy number (§2.7), and
// a guard that fails on its own mandated comment is a guard nobody keeps.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const MEASURED_PACE = { wordsPerMinute: 125.4, paceLabel: "conversational", measured: true };
const MEASURED_FILLERS = { fillerCount: 6, fillerRate: 12.5, fillerLabel: "heavy", measured: true };

describe("liveStale: STALE_AFTER_SEC is imported, never restated (AC 28)", () => {
  it("equals livePace.js's DEFAULT_WINDOW_SEC", async () => {
    const mod = await loadLiveStale();
    expect(mod.STALE_AFTER_SEC).toBe(DEFAULT_WINDOW_SEC);
  });

  it("imports DEFAULT_WINDOW_SEC from livePace and contains no restated 30", () => {
    // The failure this stops is silent and it is a DRIFT: `export const
    // STALE_AFTER_SEC = 30;` passes the equality test above today and stops
    // agreeing with the window the moment livePace.js's DEFAULT_WINDOW_SEC is
    // retuned. The reading would then expire on a bound unrelated to the
    // window it was computed over, in one direction or the other, with
    // nothing on screen to show it.
    const src = sourceOf();
    expect(src).toMatch(/import\s*\{[^}]*\bDEFAULT_WINDOW_SEC\b[^}]*\}\s*from\s*["']\.\/livePace(\.js)?["']/);
    expect(src).toMatch(/STALE_AFTER_SEC\s*=\s*DEFAULT_WINDOW_SEC/);
    const code = stripComments(src);
    expect(code.match(/\b30\b/g) || [], "the window length must not be restated as a literal").toHaveLength(0);
  });
});

describe("liveStale: staleAdjusted while capture is running (AC 26)", () => {
  it("keeps a reading whose last sample is exactly STALE_AFTER_SEC old — the bound is `>`, not `>=`", async () => {
    const { staleAdjusted, STALE_AFTER_SEC } = await loadLiveStale();
    const lastSampleAt = 1_000_000;
    const now = lastSampleAt + STALE_AFTER_SEC * 1000;
    expect(staleAdjusted(MEASURED_PACE, { lastSampleAt, now })).toEqual(MEASURED_PACE);
  });

  it("renders pace unmeasured one millisecond past the bound — and NEVER 0 wpm", async () => {
    const { staleAdjusted, STALE_AFTER_SEC } = await loadLiveStale();
    const lastSampleAt = 1_000_000;
    const now = lastSampleAt + STALE_AFTER_SEC * 1000 + 1;
    const out = staleAdjusted(MEASURED_PACE, { lastSampleAt, now });
    expect(out.measured).toBe(false);
    // AC-I2.14, restated for this module: a missing measurement is not a
    // measurement of zero. `wordsPerMinute: 0` would render "0 wpm ·
    // Slow" -- a plausible, wrong, and unflattering reading of a candidate
    // who has simply gone quiet, or whose STT socket has died.
    expect(out.wordsPerMinute).toBeNull();
    expect(out.paceLabel).toBeNull();
    expect(out.wordsPerMinute).not.toBe(0);
  });

  it("renders fillers unmeasured past the bound — and NEVER 0.0% filler", async () => {
    const { staleAdjusted, STALE_AFTER_SEC } = await loadLiveStale();
    const lastSampleAt = 1_000_000;
    const now = lastSampleAt + STALE_AFTER_SEC * 1000 + 1;
    const out = staleAdjusted(MEASURED_FILLERS, { lastSampleAt, now });
    expect(out.measured).toBe(false);
    expect(out.fillerRate).toBeNull();
    expect(out.fillerLabel).toBeNull();
    expect(out.fillerRate).not.toBe(0);
  });

  it("leaves an already-unmeasured reading unmeasured rather than inventing one", async () => {
    const { staleAdjusted } = await loadLiveStale();
    const unmeasured = { wordsPerMinute: null, paceLabel: null, measured: false };
    const out = staleAdjusted(unmeasured, { lastSampleAt: 1_000_000, now: 1_000_100 });
    expect(out.measured).toBe(false);
    expect(out.wordsPerMinute).toBeNull();
  });

  it("does not mutate the reading it is handed", async () => {
    const { staleAdjusted, STALE_AFTER_SEC } = await loadLiveStale();
    const input = { ...MEASURED_PACE };
    staleAdjusted(input, { lastSampleAt: 0, now: STALE_AFTER_SEC * 1000 + 5000 });
    // The same objects go to BOTH the strip and CopilotDashboard (§2.7), so a
    // mutating implementation would silently expire the dashboard's copy too.
    expect(input).toEqual(MEASURED_PACE);
  });
});

describe("liveStale: after a deliberate Stop the ticker freezes (AC 27)", () => {
  it("preserves the final reading indefinitely while `now` does not advance", async () => {
    const { staleAdjusted, STALE_AFTER_SEC } = await loadLiveStale();
    // Stop tears down the 1s interval, so `now` is whatever it was on the last
    // tick before Stop. Re-rendering the dashboard any number of times cannot
    // move it, which is exactly why the final reading survives for review.
    const lastSampleAt = 5_000_000;
    const frozenNow = lastSampleAt + 4_000; // 4s of talking after the last sample
    for (let i = 0; i < 5; i += 1) {
      expect(staleAdjusted(MEASURED_PACE, { lastSampleAt, now: frozenNow })).toEqual(MEASURED_PACE);
      expect(staleAdjusted(MEASURED_FILLERS, { lastSampleAt, now: frozenNow })).toEqual(MEASURED_FILLERS);
    }
    // ...and the contrast: had the clock kept running, the same reading would
    // have expired. This is the pair that shows the rule turns on `now`
    // advancing and on nothing else.
    const laterNow = lastSampleAt + STALE_AFTER_SEC * 1000 + 1;
    expect(staleAdjusted(MEASURED_PACE, { lastSampleAt, now: laterNow }).measured).toBe(false);
  });

  it("does not throw when no sample has been recorded this session", async () => {
    const { staleAdjusted } = await loadLiveStale();
    // `resetForSession` clears lastSampleAt (§2.7 supporting change 1), and it
    // clears the readings alongside it, so a MEASURED reading with a null
    // lastSampleAt is unreachable. What must hold is only that the first frame
    // of a fresh session does not throw and does not fabricate a number.
    const out = staleAdjusted(
      { wordsPerMinute: null, paceLabel: null, measured: false },
      { lastSampleAt: null, now: 1_000_000 },
    );
    expect(out).toBeTruthy();
    expect(out.measured).toBe(false);
    expect(out.wordsPerMinute).toBeNull();
  });
});
