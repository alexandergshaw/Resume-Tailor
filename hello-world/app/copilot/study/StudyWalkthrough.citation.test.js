// @vitest-environment jsdom
//
// N157 SC-C sub-chunk C-b -- bounded SOURCES under a card (StudyEvidenceCitation).
// Binds to design r2 Sec 3.2 ("sources under a card"), Sec 7 copy, and reuses the
// SHIPPED url controls (imported, never reimplemented):
//   safeExternalHref            lib/url/safeExternalHref.js
//   citationHost,servesGroundingRedirect  lib/tracking/citationHref.js
// The citation element is FROZEN to { url } (studyPlanEvidence.js) -- the UI
// re-derives host and href from that url at render, because a persisted row is
// untrusted at the render boundary (the generator already filtered once; the UI
// defends again).
//
// MAX_INLINE_SOURCES is a NAMED CONSTANT single-sourced in C-b's module and
// IMPORTED here (orchestrator ruling): the test counts by the constant, so
// retuning the cap never reds this file. The implementer must export
// MAX_INLINE_SOURCES from ./StudyEvidenceCitation.js.
//
// jsdom LIMIT (stated): there is no layout, so "inline" is read as DOM presence
// under the house conditional-render pattern (RoleDrill's "revealed panel
// mounted ONLY when visible"), never as a painted box.
//
// RED REASON (greenfield): ./StudyWalkthrough.js and ./StudyEvidenceCitation.js
// are absent -> collection fails.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import { makeTheme } from "@/app/theme/index.js";
import { STUDY_COPY } from "@/lib/studyPlan/studyPlanCopy.js";
import { normalizePlan, normalizeProgress } from "@/lib/studyPlan/studyPlanSchema.js";

import StudyWalkthrough from "./StudyWalkthrough.js";
import { MAX_INLINE_SOURCES } from "./StudyEvidenceCitation.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const noopWriter = () => Promise.resolve({ written: true, error: null });

// A single READ card (sources show immediately, no reveal needed) carrying the
// given citations verbatim.
function planWithCitations(citations) {
  return normalizePlan({
    engine: "gemini",
    provenance: { research: "complete", unsourcedTopicIds: [] },
    modules: [
      {
        id: "m1",
        title: "Module",
        topics: [{ id: "t1", title: "Topic", items: [{ topicHint: "t1", kind: "new", text: "A read line with sources.", citations }] }],
      },
    ],
  });
}

let container;
let root;

async function mount(plan) {
  await act(async () => {
    root.render(
      createElement(
        ThemeProvider,
        { theme: makeTheme("light") },
        createElement(StudyWalkthrough, {
          applicationId: "app-cite",
          plan,
          progress: normalizeProgress({}),
          writer: noopWriter,
          saveError: null,
          researchedAt: null,
          researchReason: null,
          engine: "gemini",
          buildBusy: false,
        }),
      ),
    );
  });
}

function anchors() {
  return [...container.querySelectorAll("a[href]")];
}
function buttonStartingWith(prefix) {
  return [...document.body.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(prefix));
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("MAX_INLINE_SOURCES: a card with more hosts than the cap shows at most the cap inline (R9)", () => {
  it("renders no more than MAX_INLINE_SOURCES inline anchors and a 'Show all sources' disclosure", async () => {
    expect(MAX_INLINE_SOURCES).toBeGreaterThan(0); // the import resolved to a real number

    // cap + 2 DISTINCT safe hosts.
    const hosts = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf"].slice(0, MAX_INLINE_SOURCES + 2);
    const citations = hosts.map((h, i) => ({ url: `https://${h}.example/p${i}` }));
    await mount(planWithCitations(citations));

    // At most the cap inline, before expanding.
    expect(anchors().length).toBeLessThanOrEqual(MAX_INLINE_SOURCES);

    // ...and the rest live behind a disclosure, with no slot token leaked.
    const showAll = buttonStartingWith("Show all sources");
    expect(showAll, "disclosure button missing").toBeTruthy();
    expect(showAll.textContent).toMatch(/^Show all sources \(\d+\)$/);
    expect(showAll.textContent).not.toContain("<n>");

    // Expanding reveals the rest (the DOM gains anchors) -- the control is not a
    // dead end. (over-/under-fire control for the cap: capped, not simply empty.)
    const before = anchors().length;
    await act(async () => showAll.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
    expect(anchors().length).toBeGreaterThan(before);
  });
});

describe("Sources dedupe by host, keeping the first url (Sec 3.2)", () => {
  it("two urls on the same host render one anchor, to the first url", async () => {
    await mount(
      planWithCitations([
        { url: "https://same.example/one" },
        { url: "https://same.example/two" },
      ]),
    );
    const sameHost = anchors().filter((a) => a.getAttribute("href").includes("same.example"));
    expect(sameHost).toHaveLength(1);
    expect(sameHost[0].getAttribute("href")).toBe("https://same.example/one");
  });
});

describe("The render boundary RE-DEFENDS: safeExternalHref + redirect guard applied to the persisted row", () => {
  it("a javascript: url is never an anchor and renders as inert 'source link unavailable' text", async () => {
    await mount(planWithCitations([{ url: "javascript:alert(1)" }]));
    // No anchor carries the refused scheme...
    expect(anchors().some((a) => (a.getAttribute("href") || "").startsWith("javascript:"))).toBe(false);
    // ...and the refusal is shown as inert text, not silently dropped.
    expect(container.textContent).toContain(STUDY_COPY.sources.linkUnavailable);
  });

  it("a Gemini grounding-redirect host is never rendered as a link", async () => {
    await mount(
      planWithCitations([{ url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc123" }]),
    );
    expect(anchors().some((a) => (a.getAttribute("href") || "").includes("vertexaisearch"))).toBe(false);
  });

  it("[control] an ordinary safe url DOES render as an external anchor (the filter is not deaf)", async () => {
    await mount(planWithCitations([{ url: "https://publisher.example/article" }]));
    const live = anchors().filter((a) => a.getAttribute("href") === "https://publisher.example/article");
    expect(live).toHaveLength(1);
    // External links open safely.
    expect(live[0].getAttribute("rel") || "").toContain("noopener");
  });
});
