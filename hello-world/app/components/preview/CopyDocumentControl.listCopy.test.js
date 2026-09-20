// @vitest-environment jsdom
//
// N36 REACHABILITY -- a human clicks "Copy text" and the bullets are on the
// clipboard.
//
// WHY THIS FILE EXISTS SEPARATELY FROM THE UNIT ROWS: this repo has shipped a
// form with no save wiring and a panel with no opening button past 14,000+
// passing tests, because every test called the mechanism directly. So the
// pipeline rows in lib/document prove the STRING is right, and this file
// proves a real activation of the real control puts that string on a real
// clipboard write path. Nothing here calls handleClick, writePlainText or
// htmlToPlainText as the action under test: the action is
// `container.querySelector("button").click()`.
//
// WHAT THIS FILE DOES *NOT* PROVE, stated plainly rather than implied:
//   - It does not prove the preview DIALOG wires getText/getHtml to this
//     control. That wiring lives in app/components/DocumentPreviewDialog.js
//     (:430 copySourceText, :950 getHtml -> activeSourceHtml) and is asserted
//     in app/components/DocumentPreviewDialog.copy.test.js, a file this seat
//     does not own and has not edited. The props supplied below are that
//     documented wiring, reproduced.
//   - It does not prove Microsoft Word or Google Docs RENDER the pasted
//     flavours as a bulleted list. No test in this repo touches a real OS
//     clipboard or a real paste target; that is a human check, named in the
//     notes artifact.
//
// THE JSDOM CLIPBOARD SEAM (measured and documented at length in this
// directory's CopyDocumentControl.test.js): document.execCommand,
// navigator.clipboard, ClipboardEvent and DataTransfer are ALL undefined
// here, so with the shipped defaults every click takes the same failure
// branch and never reaches the success region. The named install/remove pair
// below, and the two controls in "seam controls", are what keep that from
// turning this file green on the wrong region.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import CopyDocumentControl from "./CopyDocumentControl.js";
import { htmlToPlainText } from "@/lib/document/htmlToPlainText.js";
import { parseDocxToModel, renderModelToHtml } from "@/lib/document/docxPreview.js";
import JSZip from "jszip";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BULLET = "\u2022";
const MARKER = `${BULLET} `;

// ---------------------------------------------------------------------------
// the document under copy: a real .docx with real native Word numbering
// ---------------------------------------------------------------------------

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const listP = (text, numId) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const plainP = (text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

async function resumeHtml() {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>` +
      plainP("Staff Engineer, Acme Robotics") +
      listP("Led migration to microservices", "1") +
      listP("Built CI pipeline adopted by 12 teams", "1") +
      `</w:body></w:document>`,
  );
  zip.file(
    "word/numbering.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${NS}>` +
      '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>' +
      '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>',
  );
  return renderModelToHtml(await parseDocxToModel(await zip.generateAsync({ type: "nodebuffer" })));
}

// ---------------------------------------------------------------------------
// the seam
// ---------------------------------------------------------------------------

let removeExecCommandStub = null;
let removeClipboardStub = null;

// A hand-built CANCELABLE copy event with a defineProperty'd clipboardData: a
// stubbed execCommand fires no copy event of its own (measured), and a
// non-cancelable event reports defaultPrevented === false after
// preventDefault(), which would make that assertion vacuous.
function installCopyEventChannel(store) {
  document.execCommand = (command) => {
    if (command !== "copy") return false;
    const ev = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "clipboardData", {
      configurable: true,
      value: { setData: (type, value) => store.push({ type, value }) },
    });
    document.dispatchEvent(ev);
    return true;
  };
  removeExecCommandStub = () => {
    delete document.execCommand;
  };
}

// TEARDOWN RULE, copied from this directory's own seam: `delete`, never
// `= undefined` -- after `= undefined` a later file sharing this worker sees
// `"clipboard" in navigator === true`.
function installAsyncClipboard(writeTextCalls) {
  navigator.clipboard = {
    writeText: (t) => {
      writeTextCalls.push(t);
      return Promise.resolve();
    },
  };
  removeClipboardStub = () => {
    delete navigator.clipboard;
  };
}

let container;
let root;
let HTML;

beforeEach(async () => {
  HTML = await resumeHtml();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  removeExecCommandStub?.();
  removeExecCommandStub = null;
  removeClipboardStub?.();
  removeClipboardStub = null;
});

// The props are DocumentPreviewDialog's documented wiring, reproduced:
// getText = () => htmlToPlainText(activeSourceHtml()) (:430) and
// getHtml = activeSourceHtml (:950).
function props(overrides = {}) {
  return {
    getText: () => htmlToPlainText(HTML),
    getHtml: () => HTML,
    copyState: "ready",
    scopeLabel: "Resume",
    accessibleName: "Copy text of the resume",
    variant: "outlined",
    mode: "view",
    onOutcome: vi.fn(),
    ...overrides,
  };
}

async function render(p) {
  await act(async () => {
    root.render(createElement(CopyDocumentControl, p));
  });
  expect(document.querySelectorAll("button")).toHaveLength(1);
}

// THE ACTIVATION: a real click on the real rendered control. Never a direct
// call to the handler -- a handler call cannot fail when the button is
// missing, disabled or unrendered, which is exactly the class of defect this
// repo has shipped behind green suites.
async function clickTheButton() {
  const button = container.querySelector("button");
  expect(button).not.toBeNull();
  expect(button.tagName).toBe("BUTTON");
  await act(async () => {
    button.click();
  });
}

describe("seam controls", () => {
  it("this jsdom supplies no clipboard surface of its own, so the stubs below are the whole success region", () => {
    expect(typeof document.execCommand).toBe("undefined");
    expect(typeof navigator.clipboard).toBe("undefined");
  });

  it("the corpus really is a list-bearing document -- otherwise every row below is vacuous", async () => {
    // RED ON HEAD: renderModelToHtml emits no <li> today, which is N36.
    expect(HTML).toContain("<li");
    expect(HTML).toContain("<ul");
  });
});

describe("N36 reachability: clicking the real Copy text button puts the bullets on the clipboard", () => {
  it("the plain flavour carries a marker on each bullet and none on the job title", async () => {
    const store = [];
    installCopyEventChannel(store);
    await render(props());
    await clickTheButton();

    const plain = store.find((row) => row.type === "text/plain");
    expect(plain).toBeDefined();
    expect(plain.value).toBe(
      ["Staff Engineer, Acme Robotics", `${MARKER}Led migration to microservices`, `${MARKER}Built CI pipeline adopted by 12 teams`].join("\n"),
    );
    expect(plain.value.split("\n").filter((l) => l.startsWith(MARKER))).toHaveLength(2);
  });

  it("the rich flavour carries real <ul>/<li> markup, which is what Word and Google Docs paste as a list", async () => {
    const store = [];
    installCopyEventChannel(store);
    await render(props());
    await clickTheButton();

    const rich = store.find((row) => row.type === "text/html");
    expect(rich).toBeDefined();
    expect(rich.value).toContain("<ul");
    expect(rich.value).toContain("<li");
    expect(rich.value).toContain("Led migration to microservices");
    // Both flavours are written, from the same click, in the frozen order the
    // copy-event branch uses (plain first, then rich).
    expect(store.map((row) => row.type)).toEqual(["text/plain", "text/html"]);
  });

  it("the ASYNC path -- which no browser lets carry text/html -- still delivers the markers", async () => {
    // THE ROW THAT MAKES THE MARKER LOAD-BEARING. text/html rides ONLY the
    // copy-event channel; when the async Clipboard API is available and no
    // rich flavour is supplied, or when the copy-event branch fails, the user
    // gets plain text alone. That is also the flavour every ATS <textarea>
    // consumes. So this is the path where losing the marker loses the list.
    const writeTextCalls = [];
    installAsyncClipboard(writeTextCalls);
    await render(props({ getHtml: undefined }));
    await clickTheButton();

    expect(writeTextCalls).toHaveLength(1);
    expect(writeTextCalls[0]).toContain(`${MARKER}Led migration to microservices`);
    expect(writeTextCalls[0]).toBe(htmlToPlainText(HTML));
  });

  it("UNDER-FIRE CONTROL: with the control disabled, the same click writes nothing at all", async () => {
    // Without this, a build that copied on render (or on mount) would satisfy
    // every row above. It also pins that the gate is still the gate: the
    // marker change must not turn a refusal into a write.
    const store = [];
    installCopyEventChannel(store);
    const onOutcome = vi.fn();
    await render(props({ copyState: "loading", onOutcome }));
    await clickTheButton();

    expect(store).toHaveLength(0);
    expect(onOutcome).toHaveBeenCalledTimes(1); // it refused out loud, it did not do nothing
  });

  it("NO-WRITE-WITHOUT-A-CLICK CONTROL: rendering alone puts nothing on the clipboard", async () => {
    const store = [];
    installCopyEventChannel(store);
    const p = props();
    await render(p);
    expect(store).toHaveLength(0);
    // ...and the click is what changes that, in the same test, so the two
    // observations cannot drift apart.
    await clickTheButton();
    expect(store.length).toBeGreaterThan(0);
  });
});
