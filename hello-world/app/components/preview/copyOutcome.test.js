// ACCEPTANCE tests for AC-C10.1 (the enable gate) and the outcome contract
// AC-C11.2 rests on: ONE {polite, alert} object of which exactly one field is
// non-empty per outcome.
//
// NODE environment: this module is pure -- no React, no DOM. That is the whole
// reason the gate and the message table live here rather than inside the
// control, where every branch would need a rendered component to observe.
//
// WHAT THIS FILE DELIBERATELY DOES NOT ASSERT: the wording of the four
// disabled-state messages. `DISABLED_REASON`'s values are per-STATE while
// 1c's sentences are per-SCOPE ("The cover letter is still loading."), so the
// map alone cannot be compared against a finished sentence without guessing
// which side owns the substitution. The observable property -- four distinct,
// non-empty sentences, each naming the scope -- is asserted where it is
// actually observable, on a rendered control, in
// CopyDocumentControl.test.js's "four disabled states each announce their own
// reason" case. Totality of the map is asserted here, because that is the part
// a future sixth state silently breaks.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { copyStateFor, DISABLED_REASON, copyOutcome } from "./copyOutcome.js";

// fileURLToPath + join rather than `readFileSync(new URL(rel, import.meta.url))`
// -- the idiom lib/drive/lineCeiling.test.js uses -- so the helper keeps working
// verbatim if this file is ever given a jsdom environment, where the global URL
// is jsdom's class and node:fs rejects it with "The URL must be of scheme file".
const HERE = dirname(fileURLToPath(import.meta.url));
const srcOf = (rel) => readFileSync(join(HERE, rel), "utf8");

// Source text with comments removed, so a source-shape assertion cannot be
// satisfied by an implementer merely NAMING the thing in prose. The `[^:"'`]`
// guard keeps a "https://" inside a string literal from eating the rest of its
// line.
const codeOnly = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");

const COPY_STATES = ["unavailable", "unloaded", "loading", "errored", "ready"];

function nonEmptyString(value) {
  expect(typeof value).toBe("string");
  expect(value.length).toBeGreaterThan(0);
  return value;
}

// ---------------------------------------------------------------------------
// AC-C10.1 -- the four-conjunct gate, as one enum
// ---------------------------------------------------------------------------

describe("AC-C10.1 copyStateFor: available && docEntry != null && !loading && !error", () => {
  it.each([
    ["scope unavailable, whatever the entry says", false, { loading: false, html: "<p>A</p>" }, "unavailable"],
    ["scope unavailable and no entry", false, undefined, "unavailable"],
    ["first paint of every tab -- docState[tab] is undefined", true, undefined, "unloaded"],
    ["an explicit null entry", true, null, "unloaded"],
    ["mid-parse", true, { loading: true }, "loading"],
    ["the render errored", true, { loading: false, error: "Unable to render preview." }, "errored"],
    ["loaded and renderable", true, { loading: false, html: "<p>A</p>" }, "ready"],
    ["loaded but blank -- an empty document is READY, and refused at click time instead", true, { loading: false, html: "" }, "ready"],
  ])("%s -> %s", (_name, available, entry, expected) => {
    expect(copyStateFor(available, entry)).toBe(expected);
  });

  it("the `!= null` conjunct is what stops \"always enabled over a blank surface\" on the first paint", () => {
    // `ensureLoaded` runs in a PASSIVE useEffect, i.e. after paint, and the
    // render site falls through to a blank surface. On that frame
    // `docState[tab]?.loading` and `docState[tab]?.error` are both `undefined`,
    // so a three-conjunct gate reads "enabled" over a page with nothing on it.
    //
    // This is also the reason the gate must read `docState[tab]` DIRECTLY and
    // never the dialog's in-scope `const state = docState[tab] || {}` local --
    // that `|| {}` erases exactly the distinction this row measures, and the
    // resulting defect is invisible to every other assertion. Observed on the
    // real dialog in DocumentPreviewDialog.copy.test.js.
    expect(copyStateFor(true, undefined)).not.toBe("ready");
    expect(copyStateFor(true, {})).toBe("ready"); // an entry that EXISTS but is empty is a different state
  });

  it("is TOTAL: every input lands on one of the five states, and all five are reachable", () => {
    const seen = new Set();
    for (const available of [true, false, undefined, null, 0, 1]) {
      for (const entry of [undefined, null, {}, { loading: true }, { error: "x" }, { loading: false, html: "<p>A</p>" }, { loading: true, error: "x" }]) {
        const state = copyStateFor(available, entry);
        expect(COPY_STATES).toContain(state);
        seen.add(state);
      }
    }
    expect([...seen].sort()).toEqual([...COPY_STATES].sort());
  });
});

// ---------------------------------------------------------------------------
// DISABLED_REASON -- total over the enum, on purpose
// ---------------------------------------------------------------------------

describe("DISABLED_REASON is TOTAL over the copyState enum", () => {
  it("has exactly one key per state -- no more and no fewer", () => {
    // A four-entry map plus a `?? ""` at the call site is the shape where a
    // future sixth state silently announces NOTHING -- which turns the
    // control into the dead end this design exists to remove.
    expect(Object.keys(DISABLED_REASON).sort()).toEqual([...COPY_STATES].sort());
  });

  it("carries an empty entry for \"ready\" -- there is no reason to give -- and a truthy one for each refusal", () => {
    expect(DISABLED_REASON.ready === "" || DISABLED_REASON.ready == null).toBe(true);
    for (const state of COPY_STATES.filter((s) => s !== "ready")) {
      expect(Boolean(DISABLED_REASON[state])).toBe(true);
    }
  });

  it("...and SOMEBODY READS IT -- a duplicate table inside the message builder is what a sixth state announces nothing through", () => {
    // The two rows above prove the map is well formed. Neither proves the map
    // is CONSUMED: a hardcoded per-state table inside the message builder
    // reproduces today's four sentences exactly, so every behavioural
    // assertion in this gate stays green while the exported map becomes
    // decoration -- and a future sixth `copyState` added to the map (the one
    // case totality exists for) announces nothing at all.
    //
    // OWNERSHIP, unpinned by the plan and therefore checked in BOTH places:
    // section 3.2.6 says the control "owns no string (they come from
    // copyOutcome)", while section 3.4's wave table hands W2-D
    // "`copyOutcome.js`'s `copyOutcome()` + `DISABLED_REASON`" -- i.e. the raw
    // per-STATE template, whose `{scope}`-shaped hole the control would then
    // have to fill itself. Two readings, two implementations. This row accepts
    // either consumer and pins only that one of them exists.
    const outcomeCode = codeOnly(srcOf("copyOutcome.js"));
    const controlCode = codeOnly(srcOf("CopyDocumentControl.js"));
    const DECLARATION = /export\s+const\s+DISABLED_REASON/g;
    const occurrences = (code) => (code.match(/DISABLED_REASON/g) || []).length;
    const declarations = (code) => (code.match(DECLARATION) || []).length;
    const reads = (code) => occurrences(code) - declarations(code);

    expect(reads(outcomeCode) + reads(controlCode)).toBeGreaterThan(0);

    // POSITIVE CONTROLS for the instrument, so the arithmetic above cannot be
    // green by accident:
    //   the declaration site it subtracts really is found...
    expect(declarations(outcomeCode)).toBe(1);
    //   ...the stripper really does remove a mention made only in prose...
    expect(codeOnly("const x = 1; // reads DISABLED_REASON, honest")).not.toContain("DISABLED_REASON");
    expect(codeOnly("/* DISABLED_REASON */ const x = 1;")).not.toContain("DISABLED_REASON");
    //   ...and it really does keep one made in code, including a protocol-
    //   bearing string on the same line.
    expect(codeOnly('const u = "https://x"; return DISABLED_REASON[state];')).toContain("DISABLED_REASON");
  });
});

// ---------------------------------------------------------------------------
// AC-C11.2 -- the {polite, alert} contract, over every shape the union produces
// ---------------------------------------------------------------------------

describe("AC-C11.2 copyOutcome: EXACTLY one of polite/alert is non-empty, for every outcome", () => {
  // Every shape `writePlainText` can return (the frozen six), plus the blank
  // refusal the control raises before ever calling it.
  const SUCCESSES = [
    { ok: true, via: "async" },
    { ok: true, via: "copyEvent" },
    { ok: true, via: "textarea" },
  ];
  const CLIPBOARD_FAILURES = [
    { ok: false, via: "copyEvent", reason: "unavailable" },
    { ok: false, via: "textarea", reason: "unavailable" },
    { ok: false, via: "textarea", reason: "refused" },
    { ok: false, via: "textarea", reason: "editModeRefused" },
  ];
  // The blank-document refusal NEVER reaches writePlainText: the control
  // checks `String(getText() ?? "").length === 0` first, in BOTH modes. So its
  // outcome carries NO `via` -- the copy was never attempted -- and
  // copyOutcome must accept that shape rather than an invented one.
  const BLANK_REFUSAL = { ok: false, reason: "empty" };

  it("the BLANK_REFUSAL fixture really does omit `via` -- self-test, so the row below is not vacuous", () => {
    expect(Object.prototype.hasOwnProperty.call(BLANK_REFUSAL, "via")).toBe(false);
  });

  it.each([...SUCCESSES, ...CLIPBOARD_FAILURES, BLANK_REFUSAL].map((r) => [JSON.stringify(r), r]))(
    "%s produces one message on exactly one channel",
    (_name, result) => {
      const outcome = copyOutcome(result, "Cover letter");
      expect(typeof outcome.polite).toBe("string");
      expect(typeof outcome.alert).toBe("string");
      // The failure this forecloses: revision 2's "a failure SHOULD
      // ADDITIONALLY reach role=alert" puts the same string in both regions
      // and the failure is announced TWICE.
      expect([outcome.polite.length > 0, outcome.alert.length > 0].filter(Boolean)).toHaveLength(1);
    },
  );

  it("success feeds POLITE only and names the scope captured at click time", () => {
    for (const result of SUCCESSES) {
      const outcome = copyOutcome(result, "Cover letter");
      nonEmptyString(outcome.polite);
      expect(outcome.alert).toBe("");
      expect(outcome.polite.toLowerCase()).toContain("cover letter");
      // AC-C2: the resume's announcement must never carry the cover letter's
      // name. Same result object, different label -> different sentence.
      expect(copyOutcome(result, "Resume").polite.toLowerCase()).toContain("resume");
      expect(copyOutcome(result, "Resume").polite.toLowerCase()).not.toContain("cover letter");
    }
  });

  it("every non-success feeds ALERT only, so it does not queue behind polite Drive chatter", () => {
    for (const result of [...CLIPBOARD_FAILURES, BLANK_REFUSAL]) {
      const outcome = copyOutcome(result, "Cover letter");
      nonEmptyString(outcome.alert);
      expect(outcome.polite).toBe("");
      expect(outcome.alert.toLowerCase()).toContain("cover letter");
    }
  });

  it("AC-C10.4.2: no failure message says \"below\" -- DialogContent PRECEDES DialogActions, so the text is ABOVE", () => {
    for (const result of [...CLIPBOARD_FAILURES, BLANK_REFUSAL]) {
      const alert = nonEmptyString(copyOutcome(result, "Resume").alert);
      expect(alert.toLowerCase()).not.toContain("below");
    }
    // Positive control for the instrument: the string this replaces, which
    // ships today in copyEmail, really does contain the word.
    expect("Couldn't copy -- select the text below and copy it manually.".toLowerCase()).toContain("below");
  });
});

describe("1c section 7.4: the strip and the live regions carry THE SAME string, so they cannot drift", () => {
  it.each([
    ["success", { ok: true, via: "async" }],
    ["clipboard failure", { ok: false, via: "textarea", reason: "refused" }],
    ["blank refusal", { ok: false, reason: "empty" }],
  ])("%s: `visible` is byte-identical to whichever region carries the message", (_name, result) => {
    const outcome = copyOutcome(result, "Hiring email");
    // There is no abbreviated visual variant and no verbose spoken variant.
    // Making them one string is what makes the two structurally unable to
    // disagree, rather than merely unlikely to.
    expect(outcome.visible).toBe(outcome.polite || outcome.alert);
    nonEmptyString(outcome.visible);
  });
});

describe("1c section 7.3: `persist` is true ONLY for a clipboard failure", () => {
  it("a success auto-dismisses", () => {
    expect(copyOutcome({ ok: true, via: "async" }, "Resume").persist).toBe(false);
  });

  it("a blank-document refusal auto-dismisses -- it carries no instruction to read", () => {
    expect(copyOutcome({ ok: false, reason: "empty" }, "Resume").persist).toBe(false);
  });

  it.each([
    [{ ok: false, via: "copyEvent", reason: "unavailable" }],
    [{ ok: false, via: "textarea", reason: "refused" }],
    [{ ok: false, via: "textarea", reason: "editModeRefused" }],
  ])("a clipboard failure PERSISTS: %s", (result) => {
    // These carry an INSTRUCTION ("select the document text and copy it
    // manually"). Auto-dismissing an instruction mid-read is a defect, and
    // today's copyEmail does exactly that on a 3 s timer. Declared behaviour
    // change to a shipped control, not an accident.
    expect(copyOutcome(result, "Resume").persist).toBe(true);
  });
});

describe("AC-C7 / 1c section 6.3: no announcement string carries an invisible codepoint or a bare counter", () => {
  it("sweeps every outcome shape", () => {
    // Constructed with escapes. mui-a11y-traps item 6 records that a
    // zero-width nonce added to defeat React's coalescing bail leaked U+200B
    // into copied text in this repo BEFORE.
    const INVISIBLE = new RegExp("[\\u200B\\u200C\\u200D\\u2060\\uFEFF\\u00AD]");
    // MANDATORY SELF-TEST: one typo in the character class yields a
    // permanently-green sweep.
    expect(INVISIBLE.test("Java" + String.fromCharCode(0x200b) + "Script")).toBe(true);

    const shapes = [
      { ok: true, via: "async" },
      { ok: true, via: "copyEvent" },
      { ok: true, via: "textarea" },
      { ok: false, via: "copyEvent", reason: "unavailable" },
      { ok: false, via: "textarea", reason: "refused" },
      { ok: false, via: "textarea", reason: "editModeRefused" },
      { ok: false, reason: "empty" },
    ];
    for (const shape of shapes) {
      for (const label of ["Resume", "Cover letter", "Hiring email"]) {
        const outcome = copyOutcome(shape, label);
        const message = nonEmptyString(outcome.polite || outcome.alert);
        expect(INVISIBLE.test(message)).toBe(false);
        // The per-announcement counter is a React `key` ONLY. The failure
        // this forecloses is an implementer who reads "make each announcement
        // distinct" and writes "Copied (2)" -- which satisfies a
        // mutation-count assertion, passes an invisible-codepoint sweep, and
        // ships a counter into the speech stream.
        expect(message).not.toMatch(/\d/);
      }
    }
  });
});
