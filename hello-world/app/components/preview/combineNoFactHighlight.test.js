// @vitest-environment jsdom
//
// N61 (regression GUARD, green on HEAD -- see report) -- THE COMBINED DOCUMENT
// MUST NOT CARRY THE FACT HIGHLIGHT. Combine builds an employer-bound document
// from the SAME render models the preview builds; the on-screen preview marks
// inserted facts (a yellow <mark data-fact>), but that mark must never bake into
// the file a candidate sends. The checker verified this holds today because
// CombineDocumentsControl calls its model loader with NO highlight option. This
// pins that property so the N61 fix (making the review strip always visible) does
// not accidentally start marking up the combined file.
//
// WHY THE MODEL, NOT THE .docx BYTES: the combined .docx serializer
// (combineDocuments.js#runPropsXml) writes bold/italic/underline/size/color and
// ignores `insertedFact`, so the .docx bytes are silent about the mark even if
// combine DID request it -- a bytes assertion would be vacuously green against
// the very mutation this guards. The combined PDF path
// (combinedHtml -> renderModelToHtml) DOES render the mark, so the honest,
// format-independent property is "the models handed to the combiner carry no
// inserted-fact run". We capture those models and render them the way the PDF
// path does.
//
// FAITHFUL LOADER: `loadModel` here mirrors useDocumentPreview.js:422 exactly --
// it marks the cover model IFF called with { factHighlight: true }. So if
// CombineDocumentsControl's handler ever passed that option (the faithful
// mutation), the captured cover model would carry the mark and the assertion
// would go red. The control below proves the marker fires when asked, so the
// "no mark" assertion is not vacuous.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

import { linesToModel, renderModelToHtml } from "@/lib/document/docxPreview.js";
import { markInsertedFacts } from "@/lib/document/versionDiff.js";

// Capture the models the combiner is handed, and never touch the filesystem or
// the print pipeline.
const captured = { models: null, calls: 0 };
vi.mock("@/lib/document/combineDocuments", () => ({
  downloadCombinedDocuments: vi.fn(async ({ models } = {}) => {
    captured.models = models;
    captured.calls += 1;
    return null;
  }),
}));

// Imported AFTER the mock is declared so the component binds the mocked combiner.
import CombineDocumentsControl from "./CombineDocumentsControl.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FACT = "Acme just opened a Dublin telemetry lab.";
const COVER_LINES = ["Dear Hiring Manager,", `I lead platform teams. ${FACT} It shows my focus.`, "Sincerely,"];
const RESUME_LINES = ["Alex Shaw", "Staff Engineer building telemetry platforms."];
const FACT_LINE = 1;
const FACT_OFFSET = COVER_LINES[FACT_LINE].indexOf(FACT);
// The stored inserted-fact locator, exactly the shape markInsertedFacts consumes.
const FACT_LOCATORS = [{ id: "f1", text: FACT, lineIndex: FACT_LINE, offset: FACT_OFFSET }];

// Mirrors useDocumentPreview.js:422: the highlight is applied ONLY when the
// caller asks for it (opts.factHighlight) and only for the cover scope.
function loadModel(scope, opts = {}) {
  const base = scope === "cover" ? linesToModel(COVER_LINES) : linesToModel(RESUME_LINES);
  const marked = opts.factHighlight && scope === "cover" ? markInsertedFacts(base, FACT_LOCATORS) : base;
  return Promise.resolve(marked);
}

const SCOPES_BOTH = {
  resume: { available: true, text: RESUME_LINES.join("\n") },
  cover: { available: true, text: COVER_LINES.join("\n") },
};

let container = null;
let root = null;

beforeEach(() => {
  captured.models = null;
  captured.calls = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  if (container) container.remove();
  root = null;
  container = null;
});

async function renderControl() {
  await act(async () => {
    root.render(
      createElement(CombineDocumentsControl, {
        canCombine: true,
        scopes: SCOPES_BOTH,
        loadModel,
        commitDraft: () => {},
        company: "Acme",
        jobTitle: "Staff Engineer",
        combineFormat: "docx",
        setCombineFormat: () => {},
        combining: false,
        setCombining: () => {},
        combineError: "",
        setCombineError: () => {},
        anyBusy: false,
      }),
    );
  });
}

function combineButton() {
  return [...document.body.querySelectorAll("button")].find((b) => (b.textContent || "").trim().startsWith("Download combined"));
}

async function clickCombine() {
  const btn = combineButton();
  if (!btn) throw new Error('"Download combined" control not rendered');
  await act(async () => {
    btn.click();
  });
  for (let n = 0; n < 20; n += 1) {
    await act(async () => {
      await Promise.resolve();
    });
    if (captured.calls > 0) break;
  }
}

describe("instrument sanity (canary): the fact-mark instrument fires when highlighting IS requested", () => {
  it("markInsertedFacts + renderModelToHtml produce a data-fact mark for the cover model", async () => {
    // If this did not fire, the "no data-fact" assertion below would be vacuous.
    const marked = await loadModel("cover", { factHighlight: true });
    const html = renderModelToHtml(marked);
    expect(html, "the highlight instrument did not mark the requested cover model").toContain('data-fact="1"');
    expect(html, "the marked run does not carry the fact text").toContain(FACT);
  });

  it("without the option, the same loader returns an UNmarked model (the loader is honest)", async () => {
    const plain = await loadModel("cover");
    expect(renderModelToHtml(plain)).not.toContain('data-fact="1"');
    // sanity: the fact text is still present -- only the MARK is absent.
    expect(renderModelToHtml(plain)).toContain(FACT);
  });
});

describe("N61 guard: Combine builds an employer-bound document with NO fact highlight", () => {
  it("the models handed to the combiner carry no inserted-fact run, though the fact text is present", async () => {
    await renderControl();
    await clickCombine();

    expect(captured.calls, "the combiner was never invoked -- click did not reach the handler").toBe(1);
    expect(Array.isArray(captured.models), "no models captured").toBe(true);
    expect(captured.models.length, "combine did not load both documents").toBe(2);

    // The whole combined render (both documents), the way the PDF path renders it.
    const combinedHtml = captured.models.map((m) => renderModelToHtml(m)).join("\n");
    // Non-vacuity: the cover letter (with its fact) really is in the combined
    // output, so "no mark" is a claim about the right document.
    expect(combinedHtml, "the fact-bearing cover letter is not in the combined output").toContain(FACT);
    // THE PROPERTY: no inserted-fact mark reaches the employer-bound file. Faithful
    // mutation: CombineDocumentsControl calling loadModel(scope, { factHighlight: true })
    // would mark the captured cover model and turn this red.
    expect(combinedHtml, "the combined document carries the inserted-fact highlight -- it must not").not.toContain('data-fact="1"');
  });
});
