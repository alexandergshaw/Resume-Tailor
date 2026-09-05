// ACCEPTANCE tests for AC-C9 (failure is a first-class state, and the fallback
// is a UNION of two paths) and the parts of AC-C7 that live at the write.
//
// NODE environment on purpose (no jsdom docblock). AC section 0.6 measures that in
// jsdom `document.execCommand`, `navigator.clipboard`, `ClipboardEvent` and
// `DataTransfer` are ALL undefined, so every branch of the write is invisible
// there without a global stub -- and each stub is a mutation that leaks across
// files sharing a worker under `--no-file-parallelism`. Here the same branches
// are plain assertions against a hand-built `{navigator, document}`.
//
// TWO harness facts this file depends on, both asserted as controls below:
//
//   1. Node 22 has a REAL global `navigator` with no `.clipboard` (measured).
//      So a test that omits the deps and expects "no navigator" is testing the
//      wrong branch. Every branch test injects explicitly; ONE test uses the
//      defaults deliberately, to pin the default-parameter resolution.
//   2. A stubbed `execCommand` dispatches NO `copy` event (measured, jsdom and
//      here alike). So THE TEST decides whether the listener ran -- that is the
//      five-branch matrix's control variable, and it is what makes branch 2
//      (the whole reason the fallback is a union) directly constructible. The
//      event is hand-built `new Event("copy", {bubbles:true, cancelable:true})`
//      with a `defineProperty`'d fake `clipboardData`, dispatched SEPARATELY.
//      `cancelable: true` is mandatory: measured, a non-cancelable event
//      reports `defaultPrevented === false` after `preventDefault()`, so the
//      assertion AC-C9.2(c) turns on would be vacuous without it.

import { describe, it, expect, vi } from "vitest";
import { writePlainText } from "./plainText.js";

const WHOLE_DOCUMENT = "EVERY LINE OF THE USER'S RESUME";
const DOCUMENT_TEXT = "ALEX SHAW\n\nEXPERIENCE\nLed migration   \n";

// ---------------------------------------------------------------------------
// fakes
// ---------------------------------------------------------------------------

// An inline style bag that behaves the same whichever channel an implementation
// reaches for -- individual properties, `cssText`, or `setAttribute("style")`.
// The hardening assertions read the normalised view, so they pin the BEHAVIOUR
// (the node is off-screen and read-only while it is selected) rather than one
// spelling of it.
function makeStyle() {
  const style = {};
  Object.defineProperty(style, "cssText", {
    configurable: true,
    get() {
      return style._cssText || "";
    },
    set(value) {
      style._cssText = String(value);
      for (const declaration of String(value).split(";")) {
        const idx = declaration.indexOf(":");
        if (idx < 0) continue;
        const key = declaration.slice(0, idx).trim().replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
        if (key) style[key] = declaration.slice(idx + 1).trim();
      }
    },
  });
  return style;
}

function makeElement(tagName) {
  const attributes = {};
  const el = {
    tagName: String(tagName).toUpperCase(),
    value: "",
    readOnly: false,
    style: makeStyle(),
    parentNode: null,
    selectCalls: 0,
    focusCalls: 0,
    setAttribute(name, value) {
      attributes[String(name).toLowerCase()] = String(value);
      if (String(name).toLowerCase() === "readonly") el.readOnly = true;
      if (String(name).toLowerCase() === "style") el.style.cssText = String(value);
    },
    getAttribute(name) {
      const key = String(name).toLowerCase();
      return Object.prototype.hasOwnProperty.call(attributes, key) ? attributes[key] : null;
    },
    setSelectionRange() {},
    select() {
      el.selectCalls += 1;
    },
    focus() {
      el.focusCalls += 1;
    },
    blur() {},
    remove() {
      el.parentNode?.removeChild(el);
    },
  };
  return el;
}

function makeBody({ appendChildThrows = false } = {}) {
  const children = [];
  const body = {
    children,
    appendChild(node) {
      if (appendChildThrows) throw new Error("appendChild refused");
      children.push(node);
      node.parentNode = body;
      return node;
    },
    removeChild(node) {
      const i = children.indexOf(node);
      if (i >= 0) children.splice(i, 1);
      node.parentNode = null;
      return node;
    },
  };
  return body;
}

// A selection stand-in with nothing selected. Supplied on BOTH the document and
// its `defaultView` so an implementation that saves and restores the user's
// selection through either channel is exercised, rather than being pushed into
// its own catch by a missing method and reported as `refused` for a reason that
// has nothing to do with the branch under test.
function makeSelection() {
  return {
    rangeCount: 0,
    isCollapsed: true,
    getRangeAt() {
      throw new Error("no range");
    },
    removeAllRanges() {},
    addRange() {},
    toString() {
      return "";
    },
  };
}

class FakeDocument extends EventTarget {
  constructor({ execCommand, createElementThrows = false, appendChildThrows = false } = {}) {
    super();
    this.body = makeBody({ appendChildThrows });
    this.created = [];
    this.execCommandCalls = [];
    this.activeElement = makeElement("div");
    this._createElementThrows = createElementThrows;
    this._selection = makeSelection();
    this.defaultView = { getSelection: () => this._selection };
    if (typeof execCommand === "function") {
      this.execCommand = (...args) => {
        this.execCommandCalls.push(args);
        return execCommand(this, ...args);
      };
    }
  }

  getSelection() {
    return this._selection;
  }

  createElement(tag) {
    if (this._createElementThrows) throw new Error("createElement refused");
    const el = makeElement(tag);
    this.created.push(el);
    return el;
  }
}

// A clipboardData stand-in that records every attempt AND what actually landed.
function makeClipboardData({ throwOnSet = false } = {}) {
  const attempts = [];
  const stored = {};
  return {
    attempts,
    stored,
    setData(type, value) {
      attempts.push({ type, value });
      if (throwOnSet) throw new Error("setData denied");
      stored[type] = value;
      return true;
    },
  };
}

// Hand-built, cancelable, dispatched SEPARATELY -- see the header.
function fireCopy(doc, clipboardData) {
  const ev = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: clipboardData, configurable: true });
  doc.dispatchEvent(ev);
  return ev;
}

// `execCommand` behaves differently on the copy-event step and the textarea
// step, so the stub is a script of per-call behaviours.
function execScript(steps) {
  let i = 0;
  return (doc, ...args) => {
    const step = steps[Math.min(i, steps.length - 1)];
    i += 1;
    return step(doc, ...args);
  };
}

function asyncNavigator({ writeText, write } = {}) {
  return { clipboard: { writeText: writeText || vi.fn(async () => {}), write: write || vi.fn(async () => {}) } };
}

function textareaOf(doc) {
  return doc.created.find((el) => el.tagName === "TEXTAREA") || null;
}

// ---------------------------------------------------------------------------
// harness controls -- if either is red, nothing below can be trusted
// ---------------------------------------------------------------------------

describe("harness controls", () => {
  it("this node environment supplies a real Event/EventTarget with working cancelable semantics", () => {
    expect(typeof EventTarget).toBe("function");
    expect(typeof Event).toBe("function");
    const target = new EventTarget();
    const cancelable = new Event("copy", { bubbles: true, cancelable: true });
    target.addEventListener("copy", (e) => e.preventDefault(), { once: true });
    target.dispatchEvent(cancelable);
    expect(cancelable.defaultPrevented).toBe(true);
    // The vacuity control AC-C9.2(c) names: without `cancelable: true` the
    // same preventDefault() leaves defaultPrevented false, so an assertion
    // written on a non-cancelable event proves nothing.
    const nonCancelable = new Event("copy", { bubbles: true, cancelable: false });
    target.addEventListener("copy", (e) => e.preventDefault(), { once: true });
    target.dispatchEvent(nonCancelable);
    expect(nonCancelable.defaultPrevented).toBe(false);
  });

  it("Node's global navigator is a real object with NO clipboard, and there is no global document", () => {
    // G-20: `navigator = globalThis.navigator` therefore resolves to a real
    // Navigator, not to undefined. A branch test that relies on the default
    // is testing something other than what its author thinks.
    expect(typeof globalThis.navigator).toBe("object");
    expect(globalThis.navigator).not.toBe(null);
    expect(globalThis.navigator.clipboard).toBeUndefined();
    expect(typeof globalThis.document).toBe("undefined");
  });

  it("a stubbed execCommand dispatches NO copy event -- the matrix's control variable is the test, not the stub", () => {
    const doc = new FakeDocument({ execCommand: () => true });
    let fired = 0;
    doc.addEventListener("copy", () => {
      fired += 1;
    });
    doc.execCommand("copy");
    expect(fired).toBe(0);
    fireCopy(doc, makeClipboardData());
    expect(fired).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// STEP 1 -- the async branch
// ---------------------------------------------------------------------------

describe("AC-C9.1 step 1: the async clipboard branch", () => {
  it("writes through navigator.clipboard.writeText and reports via:\"async\"", async () => {
    const writeText = vi.fn(async () => {});
    const doc = new FakeDocument({ execCommand: () => true });
    const result = await writePlainText(DOCUMENT_TEXT, { navigator: asyncNavigator({ writeText }), document: doc });
    expect(result).toEqual({ ok: true, via: "async" });
    expect(writeText).toHaveBeenCalledTimes(1);
    // AC-C7: text/plain only. The argument is a STRING, byte for byte the
    // document -- no trim, no newline collapsing between the derivation and
    // the write.
    expect(typeof writeText.mock.calls[0][0]).toBe("string");
    expect(writeText.mock.calls[0][0]).toBe(DOCUMENT_TEXT);
    // The synchronous fallback must not also run: two writes of one copy.
    expect(doc.execCommandCalls).toHaveLength(0);
  });

  it("AC-C7: navigator.clipboard.write (the rich-flavour API) is NEVER called", async () => {
    const write = vi.fn(async () => {});
    const nav = asyncNavigator({ write });
    await writePlainText(DOCUMENT_TEXT, { navigator: nav, document: new FakeDocument({ execCommand: () => true }) });
    expect(write).not.toHaveBeenCalled();
    // Positive control: the stub really is reachable, so "never called" is a
    // fact about the implementation and not about a missing spy.
    await nav.clipboard.write();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("falls THROUGH on rejection -- a rejected writeText copied nothing, so there is no double-write risk", async () => {
    const clipboardData = makeClipboardData();
    const doc = new FakeDocument({
      execCommand: execScript([
        (d) => {
          fireCopy(d, clipboardData);
          return true;
        },
      ]),
    });
    const writeText = vi.fn(async () => {
      throw new Error("Document is not focused");
    });
    const result = await writePlainText(DOCUMENT_TEXT, { navigator: asyncNavigator({ writeText }), document: doc });
    // The commonest rejection ("document is not focused") is exactly where a
    // user-gesture path still works, so the union must keep going.
    expect(result).toEqual({ ok: true, via: "copyEvent" });
    expect(clipboardData.stored["text/plain"]).toBe(DOCUMENT_TEXT);
  });

  it("skips the branch when there is no writeText at all (an insecure-context origin)", async () => {
    const clipboardData = makeClipboardData();
    const doc = new FakeDocument({
      execCommand: execScript([
        (d) => {
          fireCopy(d, clipboardData);
          return true;
        },
      ]),
    });
    const result = await writePlainText(DOCUMENT_TEXT, { navigator: {}, document: doc });
    expect(result).toEqual({ ok: true, via: "copyEvent" });
  });
});

// ---------------------------------------------------------------------------
// STEP 2 -- the copy-event branch. All five rows of AC-C9.2(b).
// ---------------------------------------------------------------------------

describe("AC-C9.2(b) the five-branch copy-event matrix: success is VERIFIED, never inferred", () => {
  it("branch 1 -- exec true + the event fires + setData succeeds: ok, and defaultPrevented is TRUE", async () => {
    const clipboardData = makeClipboardData();
    let event = null;
    const doc = new FakeDocument({
      execCommand: execScript([
        (d) => {
          event = fireCopy(d, clipboardData);
          return true;
        },
      ]),
    });
    const result = await writePlainText(DOCUMENT_TEXT, { navigator: {}, document: doc });
    expect(result).toEqual({ ok: true, via: "copyEvent" });
    expect(clipboardData.attempts).toHaveLength(1);
    expect(clipboardData.attempts[0].type).toBe("text/plain");
    expect(typeof clipboardData.attempts[0].value).toBe("string");
    expect(clipboardData.attempts[0].value).toBe(DOCUMENT_TEXT);
    // AC-C9.2(c): preventDefault() is LOAD-BEARING. Omit it and the spec
    // copies the current SELECTION instead of the data set -- and in this
    // dialog the selection can include DriveResultRegion's two visuallyHidden
    // regions, because `visuallyHidden` is a clip-rect, so "Saved 2 documents
    // to Drive" lands in an ATS resume field. The assertion is on
    // defaultPrevented, NOT merely on setData having been called.
    expect(event.defaultPrevented).toBe(true);
  });

  it("branch 2 -- exec true but the event NEVER fires (Safari/WKWebView < 18.4): falls through to the textarea", async () => {
    // This is the whole reason the fallback is a union rather than a choice.
    // On those WebKits execCommand("copy") required an existing selection and
    // could return true while the listener never ran; the textarea path works
    // there PRECISELY because it creates the selection.
    const clipboardData = makeClipboardData();
    const doc = new FakeDocument({
      execCommand: execScript([() => true, () => true]),
    });
    const result = await writePlainText(DOCUMENT_TEXT, { navigator: {}, document: doc });
    expect(result).toEqual({ ok: true, via: "textarea" });
    expect(doc.execCommandCalls).toHaveLength(2);
    expect(clipboardData.attempts).toHaveLength(0);
    expect(textareaOf(doc)?.selectCalls).toBe(1);
  });

  it("branch 3 -- exec returns false: reported as a FAILURE even though the write may have landed", async () => {
    // Deliberate, and the right way round for this domain: a false "Copied."
    // over an unwritten clipboard costs the application; a false failure costs
    // one extra click.
    const clipboardData = makeClipboardData();
    const doc = new FakeDocument({
      execCommand: execScript([
        (d) => {
          fireCopy(d, clipboardData);
          return false;
        },
        () => false,
      ]),
    });
    const result = await writePlainText(DOCUMENT_TEXT, { navigator: {}, document: doc });
    expect(result).toEqual({ ok: false, via: "textarea", reason: "refused" });
    expect(clipboardData.attempts).toHaveLength(1);
  });

  it("branch 4 -- the event fires with a NULL clipboardData: no success, nothing stored", async () => {
    const doc = new FakeDocument({
      execCommand: execScript([
        (d) => {
          fireCopy(d, null);
          return true;
        },
        () => false,
      ]),
    });
    const result = await writePlainText(DOCUMENT_TEXT, { navigator: {}, document: doc });
    expect(result).toEqual({ ok: false, via: "textarea", reason: "refused" });
  });

  it("branch 5 -- setData throws: no success, and nothing landed on the clipboard", async () => {
    const clipboardData = makeClipboardData({ throwOnSet: true });
    const doc = new FakeDocument({
      execCommand: execScript([
        (d) => {
          fireCopy(d, clipboardData);
          return true;
        },
        () => false,
      ]),
    });
    const result = await writePlainText(DOCUMENT_TEXT, { navigator: {}, document: doc });
    expect(result).toEqual({ ok: false, via: "textarea", reason: "refused" });
    expect(clipboardData.attempts).toHaveLength(1); // it was attempted...
    expect(Object.keys(clipboardData.stored)).toHaveLength(0); // ...and nothing landed
  });

  it("returns unavailable, WITHOUT reaching the textarea, when document.execCommand is not a function", async () => {
    const doc = new FakeDocument(); // no execCommand installed at all
    const result = await writePlainText(DOCUMENT_TEXT, { navigator: {}, document: doc });
    expect(result).toEqual({ ok: false, via: "copyEvent", reason: "unavailable" });
    expect(doc.created).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC-C9.2(a) -- the stale-listener hijack. A POSITIVE test, not a review note.
// ---------------------------------------------------------------------------

describe("AC-C9.2(a) the copy listener is removed in a finally, NEVER with {once:true}", () => {
  it("leaves ZERO listeners after an attempt whose event never fired", async () => {
    // With {once:true} and the inert branch, the listener stays attached to
    // `document` FOR THE SESSION. The user's next real Ctrl+C -- on a phrase
    // they deliberately selected in the preview -- hits it, calls
    // preventDefault() and writes the WHOLE DOCUMENT instead.
    const doc = new FakeDocument({ execCommand: execScript([() => true, () => false]) });
    await writePlainText(WHOLE_DOCUMENT, { navigator: {}, document: doc });

    const later = makeClipboardData();
    const userEvent = fireCopy(doc, later);
    expect(later.attempts).toHaveLength(0);
    expect(userEvent.defaultPrevented).toBe(false);
  });

  it("POSITIVE CONTROL: the {once:true} shape really does hijack, on this same harness", async () => {
    // Two lines. Without this row, the assertion above is indistinguishable
    // from a harness that cannot dispatch a copy event at all.
    const doc = new FakeDocument({ execCommand: execScript([() => true, () => false]) });
    doc.addEventListener(
      "copy",
      (e) => {
        e.clipboardData.setData("text/plain", WHOLE_DOCUMENT);
        e.preventDefault();
      },
      { once: true },
    );

    const later = makeClipboardData();
    const userEvent = fireCopy(doc, later);
    expect(later.attempts).toHaveLength(1);
    expect(later.stored["text/plain"]).toBe(WHOLE_DOCUMENT);
    expect(userEvent.defaultPrevented).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// STEP 3 -- the textarea branch, fenced to view mode
// ---------------------------------------------------------------------------

describe("AC-C9.1 step 3: the textarea path, hardened over ChatPanel's version", () => {
  it("is OFF-SCREEN and READ-ONLY at the moment execCommand runs, and carries the exact text", async () => {
    // Never display:none / visibility:hidden -- both make the text
    // unselectable, so execCommand copies nothing. Never visible at the end of
    // <body> either: ChatPanel's version appends it there and .select()
    // scrolls the page.
    let seen = null;
    const doc = new FakeDocument({
      execCommand: execScript([
        () => true, // step 2: inert, so step 3 runs
        (d) => {
          const ta = textareaOf(d);
          seen = {
            inBody: d.body.children.includes(ta),
            selectCalls: ta.selectCalls,
            value: ta.value,
            readOnly: ta.readOnly || ta.getAttribute("readonly") !== null,
            position: ta.style.position,
            left: ta.style.left,
            display: ta.style.display,
            visibility: ta.style.visibility,
          };
          return true;
        },
      ]),
    });
    const result = await writePlainText(DOCUMENT_TEXT, { navigator: {}, document: doc });
    expect(result).toEqual({ ok: true, via: "textarea" });
    expect(seen).not.toBeNull();
    expect(seen.inBody).toBe(true);
    expect(seen.selectCalls).toBe(1);
    expect(seen.value).toBe(DOCUMENT_TEXT);
    expect(seen.readOnly).toBe(true);
    expect(seen.position).toBe("fixed");
    expect(Number.parseFloat(seen.left)).toBeLessThanOrEqual(-1000);
    expect(seen.display === "none").toBe(false);
    expect(seen.visibility === "hidden").toBe(false);
  });

  it("removes the node in a FINALLY, even when execCommand throws", async () => {
    const doc = new FakeDocument({
      execCommand: execScript([
        () => true, // step 2: inert
        () => {
          throw new Error("execCommand exploded");
        },
      ]),
    });
    const result = await writePlainText(DOCUMENT_TEXT, { navigator: {}, document: doc });
    expect(result).toEqual({ ok: false, via: "textarea", reason: "refused" });
    expect(doc.created.some((el) => el.tagName === "TEXTAREA")).toBe(true); // it really was created...
    expect(doc.body.children).toHaveLength(0); // ...and it is gone
  });

  it("repeats the execCommand guard as its own first statement (the never-throws contract holds by SHAPE)", async () => {
    // Redundant against a correct step 2, and that is the point: the guard is
    // what makes the contract independent of how step 2 is read. Reached here
    // by handing step 3 a document whose execCommand disappears between the
    // two steps -- the same state an implementer produces by reading step 2's
    // `return` as a fall-through.
    const doc = new FakeDocument({
      execCommand: execScript([
        (d) => {
          delete d.execCommand;
          return true;
        },
      ]),
    });
    const result = await writePlainText(DOCUMENT_TEXT, { navigator: {}, document: doc });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unavailable");
  });
});

describe("AC-C9.1 / AC-C4: the textarea is FENCED to view mode", () => {
  it("refuses in edit mode and never creates, appends or selects a textarea", async () => {
    // .select() TAKES FOCUS, and in edit mode the contentEditable's
    // onBlur={() => { saveSelection(); commitDraft(); }} then fires
    // commitDraft -> onSave -> saveDocumentPreview -> `edited` flips. That is
    // exactly the harm AC-C4 exists to prevent, arriving through AC-C9's own
    // door: the user's next Download .docx would then be a rebuild of the
    // extracted text onto the template rather than the engine .docx served
    // verbatim.
    const doc = new FakeDocument({ execCommand: execScript([() => true]) });
    const result = await writePlainText(DOCUMENT_TEXT, { navigator: {}, document: doc, mode: "edit" });
    expect(result).toEqual({ ok: false, via: "textarea", reason: "editModeRefused" });
    expect(doc.created).toHaveLength(0);
    expect(doc.body.children).toHaveLength(0);
  });

  it("POSITIVE CONTROL: the identical call in view mode DOES create and select one", async () => {
    const doc = new FakeDocument({ execCommand: execScript([() => true, () => true]) });
    const result = await writePlainText(DOCUMENT_TEXT, { navigator: {}, document: doc, mode: "view" });
    expect(result).toEqual({ ok: true, via: "textarea" });
    expect(textareaOf(doc)?.selectCalls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The contract: never throws, never rejects. Proved by test, not by comment.
// ---------------------------------------------------------------------------

describe("writePlainText never throws and never rejects -- failure is a VALUE", () => {
  // The discriminator itself, proved able to report "rejected". Without this
  // control, a settle() that silently always answered "resolved" would make
  // every row below green.
  const settle = (p) => p.then(() => "resolved", () => "rejected");

  it("POSITIVE CONTROL: the discriminator really can see a rejection", async () => {
    expect(await settle(Promise.reject(new Error("control")))).toBe("rejected");
    expect(await settle(Promise.resolve(1))).toBe("resolved");
  });

  it.each([
    ["both deps undefined", { navigator: undefined, document: undefined }],
    ["both deps empty objects", { navigator: {}, document: {} }],
    ["a document whose execCommand throws", { navigator: {}, document: new FakeDocument({ execCommand: () => { throw new Error("boom"); } }) }],
    ["a document whose createElement throws", { navigator: {}, document: new FakeDocument({ execCommand: execScript([() => true]), createElementThrows: true }) }],
    ["a document whose appendChild throws", { navigator: {}, document: new FakeDocument({ execCommand: execScript([() => true]), appendChildThrows: true }) }],
    ["a navigator whose writeText throws synchronously", { navigator: { clipboard: { writeText: () => { throw new TypeError("not a function here"); } } }, document: {} }],
  ])("resolves to ok:false for %s", async (_name, deps) => {
    const promise = writePlainText(DOCUMENT_TEXT, deps);
    expect(await settle(promise)).toBe("resolved");
    const result = await promise;
    expect(result).toBeTruthy();
    expect(result.ok).toBe(false);
    expect(typeof result.reason).toBe("string");
  });

  it("resolves with the default parameters, in an environment that has a navigator but no document", async () => {
    // Pins the ONE line that decides whether the shipped control can reach a
    // clipboard at all -- `navigator = globalThis.navigator`,
    // `document = globalThis.document`. Node 22's navigator is real and has
    // no clipboard, and there is no global document, so this lands on step 2's
    // guard. jsdom lands on the same result for a different reason (measured),
    // which is why the acceptance suites carry their own positive control.
    const result = await writePlainText(DOCUMENT_TEXT);
    expect(result).toEqual({ ok: false, via: "copyEvent", reason: "unavailable" });
  });
});

// ---------------------------------------------------------------------------
// The four reason literals -- the frozen vocabulary
// ---------------------------------------------------------------------------

describe("the reason vocabulary is exactly four literals, and \"inert\" is never one of them", () => {
  it("never returns \"inert\": the inert branch falls through and the caller sees step 3's reason", async () => {
    // "inert" is internal to step 2's branch table. Exporting it as a fifth
    // literal invites a consumer to branch on a value nothing ever produces.
    const doc = new FakeDocument({ execCommand: execScript([() => true, () => false]) });
    const result = await writePlainText(DOCUMENT_TEXT, { navigator: {}, document: doc });
    expect(result.reason).toBe("refused");
    expect(result.reason).not.toBe("inert");
  });

  it("every reachable reason is one of unavailable | refused | editModeRefused", async () => {
    const REASONS = ["unavailable", "refused", "editModeRefused"];
    const results = await Promise.all([
      writePlainText("x", { navigator: {}, document: new FakeDocument() }),
      writePlainText("x", { navigator: {}, document: new FakeDocument({ execCommand: execScript([() => false, () => false]) }) }),
      writePlainText("x", { navigator: {}, document: new FakeDocument({ execCommand: execScript([() => false]) }), mode: "edit" }),
    ]);
    for (const result of results) {
      expect(result.ok).toBe(false);
      expect(REASONS).toContain(result.reason);
      expect(["async", "copyEvent", "textarea"]).toContain(result.via);
    }
    // The three really are distinct, so "is one of" is not satisfied by one
    // literal repeated three times.
    expect(new Set(results.map((r) => r.reason)).size).toBe(3);
  });

  it("a successful result carries NO reason key at all", async () => {
    const result = await writePlainText("x", { navigator: asyncNavigator(), document: new FakeDocument() });
    expect(result).toEqual({ ok: true, via: "async" });
    expect(Object.prototype.hasOwnProperty.call(result, "reason")).toBe(false);
  });
});
