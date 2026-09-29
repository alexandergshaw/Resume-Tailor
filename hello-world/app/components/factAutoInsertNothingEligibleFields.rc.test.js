// @vitest-environment jsdom
//
// N90 FIX 2, THE THREADING + THE ALLOWLIST. The counts the function now returns
// on a `nothing-eligible` result (articleCount, droppedNoUrl,
// droppedNoSuggestion, droppedRemoved, droppedRemovedAlsoAccepted -- see
// autoInsertNothingEligibleCounts.test.js) are only useful if they actually
// reach the downloaded activity log. Two production changes carry them there,
// and this file pins BOTH with independent instruments:
//
//   (1) DocumentPreviewMount.js's `recordAutoInsertOutcome` must forward the
//       counts to recordDecision, GATED on code === "nothing-eligible" so no
//       other outcome's record shape changes.
//   (2) lib/activityLog/activityChannels.js's `fact-auto-insert` field
//       allowlist must LIST the five new names -- otherwise recordDecision's
//       closed whitelist (appActivityLog.js:190-192) silently drops them even
//       when (1) passes them. This is the "an injected fake cannot see the
//       layer that drops your argument" trap: a spy on recordDecision proves
//       (1) but is blind to (2); the real-ledger round trip below is the only
//       instrument that bites the allowlist.
//
// Both halves are RED on HEAD: recordAutoInsertOutcome does not set the counts,
// and the allowlist is [reason, count, code] so the ledger drops them.
//
// HARNESS: mounts the REAL DocumentPreviewMount (the sibling
// DocumentPreviewMount.autoInsertRecording.test.js pattern) and reaches the
// coordinating effect only by rendering with an articles-resolved research
// entry -- so the effect calls the stubbed autoInsertFactsForJob and forwards
// its result through the REAL recordAutoInsertOutcome. recordDecision is spied
// via a PARTIAL module mock (everything else stays real). A separate round-trip
// test drives the genuine createActivityLog / DECISION_LEDGER.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import DocumentPreviewMount from "./DocumentPreviewMount.js";
import { recordDecision, createActivityLog } from "@/lib/activityLog/appActivityLog.js";

vi.mock("@/lib/activityLog/appActivityLog.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, recordDecision: vi.fn() };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const COMPANY = "Umbrella Corporation";
const ARTICLE_TITLE = "Umbrella Q3 story";

// The nothing-eligible result the function returns AFTER FIX 2 -- counts and a
// canned reason/code, never content. articleCount = the drops summed.
const NOTHING_ELIGIBLE_WITH_COUNTS = {
  ok: false,
  severity: "info",
  code: "nothing-eligible",
  reason: "No eligible facts to insert.",
  articleCount: 3,
  droppedNoUrl: 0,
  droppedNoSuggestion: 0,
  droppedRemoved: 3,
  droppedRemovedAlsoAccepted: 1,
};

let removeInnerTextPolyfill = null;
beforeAll(() => {
  if (!("innerText" in document.createElement("div"))) {
    Object.defineProperty(HTMLElement.prototype, "innerText", {
      configurable: true,
      get() {
        return this.textContent;
      },
      set(value) {
        this.textContent = value;
      },
    });
    removeInnerTextPolyfill = () => {
      delete HTMLElement.prototype.innerText;
    };
  }
});
afterAll(() => {
  removeInnerTextPolyfill?.();
});

const researchResolvedWithArticle = () => ({
  loading: false,
  needsCompany: false,
  error: "",
  warnings: [],
  articles: [{ id: "art-1", url: "https://umbrella.example/story", suggestion: "They shipped X.", title: ARTICLE_TITLE }],
});

function baseProps(overrides = {}) {
  const research = {
    researchByJob: {},
    companyResearchByJob: {},
    openCompanyResearch: vi.fn(),
    // Stubbed at the function boundary -- the counts the function produces are
    // pinned in the hook-level file; here the concern is whether the effect
    // FORWARDS them and the ledger KEEPS them. Default: the nothing-eligible
    // result carrying the counts.
    autoInsertFactsForJob: vi.fn(async () => NOTHING_ELIGIBLE_WITH_COUNTS),
    removeInsertedFact: vi.fn(async () => ({ ok: true })),
    ...(overrides.research || {}),
  };
  return {
    preview: {
      resumePreview: {
        open: true,
        title: "Staff Engineer",
        company: COMPANY,
        tab: "cover",
        jobId: "job-1",
        posting: "",
        url: "",
        busy: {},
        notice: {},
        error: {},
      },
      previewScopeAvailable: vi.fn(() => false),
      loadPreviewModel: vi.fn(),
      closeResumePreview: vi.fn(),
      saveDocumentPreview: vi.fn(),
      renameDocument: vi.fn(),
      resubmitDocumentPreview: vi.fn(),
      downloadDocumentPreview: vi.fn(),
      applyFocusArea: vi.fn(),
      documentVersions: {},
      currentVersionId: {},
      selectDocumentVersion: vi.fn(),
      ...(overrides.preview || {}),
    },
    tailoringMap: overrides.tailoringMap || {},
    research,
    chat: { askAiAbout: vi.fn() },
    tailorEngine: "embedded",
    previewReloadKey: 0,
    scrapePreviewPosting: vi.fn(),
    currentUser: { id: "user-1" },
    resumeFile: null,
    coverLetterFile: null,
  };
}
function propsWithResearch(entry, extra = {}) {
  const p = baseProps(extra);
  p.research.researchByJob = { "job-1": entry };
  return p;
}
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
function autoInsertCalls() {
  return recordDecision.mock.calls.filter((c) => c[0] === "fact-auto-insert");
}

let container;
let root;
beforeEach(() => {
  vi.clearAllMocks();
  recordDecision.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 500, json: async () => null })),
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});

// ===========================================================================
// (1) THREADING -- the effect forwards the counts to recordDecision (RED).
// ===========================================================================
describe("N90 FIX 2: recordAutoInsertOutcome forwards the nothing-eligible counts (RED on HEAD)", () => {
  it("records skipped/nothing-eligible WITH the drop counts, from the effect", async () => {
    const props = propsWithResearch(researchResolvedWithArticle());
    await act(async () => {
      root.render(createElement(DocumentPreviewMount, props));
    });
    await flush();

    // The effect ran the function (articles path) and forwarded its result.
    expect(props.research.autoInsertFactsForJob, "the coordinating effect never ran the function").toHaveBeenCalledTimes(1);
    const calls = autoInsertCalls();
    expect(calls, "no fact-auto-insert decision was recorded").toHaveLength(1);
    const [, outcome, fields] = calls[0];
    // nothing-eligible normalizes to "skipped".
    expect(outcome).toBe("skipped");
    expect(fields.code).toBe("nothing-eligible");

    // THE CRITERION (RED on HEAD -- recordAutoInsertOutcome does not set these).
    expect(fields.articleCount, "articleCount was not forwarded to the record").toBe(3);
    expect(fields.droppedNoUrl, "droppedNoUrl was not forwarded").toBe(0);
    expect(fields.droppedNoSuggestion, "droppedNoSuggestion was not forwarded").toBe(0);
    expect(fields.droppedRemoved, "droppedRemoved was not forwarded").toBe(3);
    expect(
      fields.droppedRemovedAlsoAccepted,
      "droppedRemovedAlsoAccepted was not forwarded -- the field that exposes the bug never reaches the log",
    ).toBe(1);

    // No content leak reaches the recorded fields.
    const serialized = JSON.stringify(fields);
    expect(serialized).not.toContain(COMPANY);
    expect(serialized).not.toContain("umbrella.example");
    expect(serialized).not.toContain(ARTICLE_TITLE);
  });
});

// ===========================================================================
// (1b) GATING CONTROL -- other outcomes' shape is unchanged (GREEN; a mutant
// that attaches the counts to every outcome reds this).
// ===========================================================================
describe("N90 FIX 2 control: a non-nothing-eligible outcome carries no drop counts", () => {
  it("an `acted` success records count only -- never the drop counts", async () => {
    const props = propsWithResearch(researchResolvedWithArticle(), {
      research: { autoInsertFactsForJob: vi.fn(async () => ({ ok: true, count: 2 })) },
    });
    await act(async () => {
      root.render(createElement(DocumentPreviewMount, props));
    });
    await flush();

    const calls = autoInsertCalls();
    expect(calls).toHaveLength(1);
    const [, outcome, fields] = calls[0];
    expect(outcome).toBe("acted");
    expect(fields.count).toBe(2);
    // The gate: the counts must NOT appear on a non-nothing-eligible record.
    expect(fields.droppedRemoved, "drop counts leaked onto an `acted` record -- the forwarding is not gated").toBeUndefined();
    expect(fields.articleCount, "drop counts leaked onto an `acted` record").toBeUndefined();
  });
});

// ===========================================================================
// (2) THE ALLOWLIST -- the real ledger KEEPS the new fields (RED).
// The spy above cannot see the whitelist that would drop an unlisted field.
// This drives the genuine recorder: on HEAD the fact-auto-insert allowlist is
// [reason, count, code], so every new count is dropped -> the asserted fields
// are missing -> RED. It also proves the whitelist still drops undeclared
// content (the company), so widening the list did not open the content door.
// ===========================================================================
describe("N90 FIX 2: the decision ledger keeps the new count fields (RED on HEAD)", () => {
  it("round-trips the nothing-eligible counts through the real recorder, still dropping undeclared content", () => {
    const log = createActivityLog({ now: () => 1, startedAt: 1 });
    log.recordDecision("fact-auto-insert", "skipped", {
      reason: "No eligible facts to insert.",
      code: "nothing-eligible",
      articleCount: 3,
      droppedNoUrl: 0,
      droppedNoSuggestion: 0,
      droppedRemoved: 3,
      droppedRemovedAlsoAccepted: 1,
      // An undeclared content field a careless caller might smuggle -- the
      // widened allowlist must STILL drop this.
      company: COMPANY,
    });

    const events = log.snapshot().events;
    const event = events.find((e) => e.type === "fact-auto-insert.skipped");
    expect(event, "skipped is not an accepted outcome for fact-auto-insert").toBeTruthy();

    // THE CRITERION (RED on HEAD -- the allowlist drops these five).
    expect(event.articleCount, "articleCount was dropped by the field allowlist").toBe(3);
    expect(event.droppedNoUrl, "droppedNoUrl was dropped by the allowlist").toBe(0);
    expect(event.droppedNoSuggestion, "droppedNoSuggestion was dropped by the allowlist").toBe(0);
    expect(event.droppedRemoved, "droppedRemoved was dropped by the allowlist").toBe(3);
    expect(event.droppedRemovedAlsoAccepted, "droppedRemovedAlsoAccepted was dropped by the allowlist").toBe(1);
    // Reason/code still survive, content still dropped.
    expect(event.code).toBe("nothing-eligible");
    expect(event.reason).toBe("No eligible facts to insert.");
    expect(event, "the widened allowlist let undeclared content through").not.toHaveProperty("company");
  });
});

// WHAT THIS FILE CANNOT CATCH. The function's own count computation is stubbed
// here (pinned in autoInsertNothingEligibleCounts.test.js). The spy half proves
// forwarding; the round-trip half proves the ledger keeps the fields -- neither
// alone would catch the other's break, which is why both are present. It does
// not assert the counts render anywhere on screen (the ruling is that these
// outcomes are silent; the reason string's absence from the DOM is pinned in
// DocumentPreviewMount.autoInsertRecording.test.js).
