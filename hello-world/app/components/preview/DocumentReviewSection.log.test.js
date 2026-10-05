// @vitest-environment jsdom
//
// N113 part 3 -- the review action reports to the app's existing activity log
// (feature-logs standing rule: a feature that can carry a log gets one, plus a
// clearly visible download, through the ONE shared primitive). Driven the way a user
// drives it: the REAL button, the REAL recorder (the default activity log), and the
// REAL download control reading the log back.
//
//   * a review that runs appends ONE record under document-review.<outcome>, with
//     counts and codes (surface, scope, kind, flag count, engine mode, coverage)
//     and NOTHING of the document: no title, no excerpt, no line of the resume;
//   * every other way a click can end (empty, covered, could not run) is its own
//     record, never silence and never a ran-and-clean record;
//   * a click that starts no review (a second click in the same tick) records
//     nothing more;
//   * once a result is on screen the section offers the download, once, and the
//     file it produces names the review and none of the document.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/document/download.js", () => ({ triggerBlobDownload: vi.fn() }));
// The real chokepoint, wrapped so one case can make it reject.
vi.mock("@/lib/review/runDocumentReview.js", async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, runDocumentReview: vi.fn(real.runDocumentReview) };
});

import { triggerBlobDownload } from "@/lib/document/download.js";
import { runDocumentReview } from "@/lib/review/runDocumentReview.js";
import { activityLogSnapshot } from "@/lib/activityLog/appActivityLog.js";
import DocumentReviewSection from "./DocumentReviewSection.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = vi.fn(() => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  triggerBlobDownload.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const SECRET_LINE = "Improved the Zephyrdyne ledger throughput by 300% at Initech.";
const SECRET_TITLE = "Initech - Principal Zephyrdyne Engineer";
const RESUME = { kind: "applicationReady", scope: "resume", title: SECRET_TITLE, resultLines: [SECRET_LINE] };

const buttons = () => [...container.querySelectorAll("button")];
const reviewButton = () => buttons().find((b) => /\breview/i.test((b.textContent || "").trim()));
const downloadButton = () => buttons().find((b) => /download activity log/i.test(b.textContent || ""));
const reviewEvents = () => activityLogSnapshot().events.filter((e) => String(e.type).startsWith("document-review."));

async function render(props) {
  await act(async () => root.render(createElement(DocumentReviewSection, props)));
}
async function click() {
  await act(async () => {
    reviewButton().click();
  });
}

describe("a review that runs is recorded", () => {
  it("appends one document-review.acted record with counts and codes, on the modal surface", async () => {
    const before = reviewEvents().length;
    await render({ surface: "modal", request: RESUME });
    await click();
    const added = reviewEvents().slice(before);
    expect(added).toHaveLength(1);
    const [event] = added;
    expect(event.channel).toBe("act");
    expect(event.type).toBe("document-review.acted");
    expect(event.surface).toBe("modal");
    expect(event.scope).toBe("resume");
    expect(event.reason).toBe("reviewed");
    expect(event.kind).toBe("partial");
    expect(event.coverageComplete).toBe(false);
    expect(event.engineMode).toBe("mechanical-only");
    expect(event.lineCount).toBe(1);
    // The planted unbaselined metric is a real flag, so the count is real, not zero.
    expect(event.flagCount).toBeGreaterThanOrEqual(1);
  });

  it("records the chat surface as the chat", async () => {
    const before = reviewEvents().length;
    await render({ surface: "chat", request: { ...RESUME, scope: "cover" } });
    await click();
    const [event] = reviewEvents().slice(before);
    expect(event.surface).toBe("chat");
    expect(event.scope).toBe("cover");
  });

  it("never records the title, an excerpt or a line of the document", async () => {
    await render({ surface: "modal", request: RESUME });
    await click();
    expect(reviewEvents().length).toBeGreaterThan(0);
    // CONTROL: the planted line really is on screen as a quoted excerpt, so the
    // absence below is not an absence of the thing being looked for.
    expect([...container.querySelectorAll("[data-quoted]")].some((n) => (n.textContent || "").includes("Zephyrdyne"))).toBe(true);
    const logged = JSON.stringify(activityLogSnapshot().events);
    expect(logged).not.toContain("Zephyrdyne");
    expect(logged).not.toContain("Initech");
    expect(logged).not.toContain("300%");
  });

  it("two clicks in one tick start one review and record one", async () => {
    const before = reviewEvents().length;
    await render({ surface: "modal", request: RESUME });
    await act(async () => {
      const button = reviewButton();
      button.click();
      button.click();
    });
    expect(reviewEvents().length - before).toBe(1);
  });
});

describe("every other way a click can end is its own record", () => {
  it("an empty document is document-review.refused, kind empty", async () => {
    const before = reviewEvents().length;
    await render({ surface: "modal", request: { ...RESUME, resultLines: undefined, text: "   " } });
    await click();
    const [event] = reviewEvents().slice(before);
    expect(event.type).toBe("document-review.refused");
    expect(event.kind).toBe("empty");
    expect(event).not.toHaveProperty("flagCount");
  });

  it("a covered tab is document-review.skipped, and runs no review", async () => {
    const before = reviewEvents().length;
    runDocumentReview.mockClear();
    await render({ surface: "modal", request: RESUME, covered: true });
    await click();
    expect(runDocumentReview).not.toHaveBeenCalled();
    const [event] = reviewEvents().slice(before);
    expect(event.type).toBe("document-review.skipped");
    expect(event.kind).toBe("covered");
  });

  it("a review that could not run is document-review.failed, with the failure text nowhere in it", async () => {
    const before = reviewEvents().length;
    runDocumentReview.mockRejectedValueOnce(new Error(`boom ${SECRET_LINE}`));
    await render({ surface: "chat", request: RESUME });
    await click();
    const [event] = reviewEvents().slice(before);
    expect(event.type).toBe("document-review.failed");
    expect(event.kind).toBe("failed");
    expect(JSON.stringify(event)).not.toContain("Zephyrdyne");
  });

  it("a busy host starts no review and records nothing", async () => {
    const before = reviewEvents().length;
    await render({ surface: "chat", request: RESUME, busy: true });
    await click();
    expect(reviewEvents().length).toBe(before);
  });
});

describe("the download control", () => {
  it("is absent before any review, present once a result is shown, and present once", async () => {
    await render({ surface: "modal", request: RESUME });
    expect(downloadButton(), "nothing has run yet, so there is nothing to offer").toBeUndefined();
    await click();
    expect(buttons().filter((b) => /download activity log/i.test(b.textContent || ""))).toHaveLength(1);
    expect(downloadButton().hasAttribute("disabled")).toBe(false);
  });

  it("is on the chat surface too", async () => {
    await render({ surface: "chat", request: RESUME });
    await click();
    expect(downloadButton()).toBeTruthy();
  });

  it("is offered after a refusal as well: every outcome has a record to download", async () => {
    await render({ surface: "modal", request: { ...RESUME, resultLines: undefined, text: "" } });
    await click();
    expect(downloadButton()).toBeTruthy();
  });

  it("one click produces one markdown file that names the review and none of the document", async () => {
    await render({ surface: "modal", request: RESUME });
    await click();
    await act(async () => {
      downloadButton().click();
    });
    expect(triggerBlobDownload).toHaveBeenCalledTimes(1);
    const [blob, fileName] = triggerBlobDownload.mock.calls[0];
    expect(blob.type).toBe("text/markdown");
    expect(fileName).toMatch(/^activity-log-.*\.md$/);
    const text = await blob.text();
    expect(text).toContain("document-review.acted");
    expect(text).not.toContain("Zephyrdyne");
    expect(text).not.toContain("Initech");
  });

  it("does not duplicate the one the regenerate report already carries", async () => {
    const report = createElement("div", { "data-testid": "report" }, createElement("button", { type: "button" }, "Download activity log"));
    await render({ surface: "modal", request: RESUME, regenerateReport: report });
    await click();
    expect(buttons().filter((b) => /download activity log/i.test(b.textContent || ""))).toHaveLength(1);
  });
});
