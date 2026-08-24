// @vitest-environment jsdom
//
// Presentational only: props in, DOM out, no fetching, no session. Mounted
// under jsdom (matching MeetingTranscript.test.js and JobDescriptionTab.test.js's
// own per-file override) because this component's whole job — attribution
// that actually differs per source kind, an error that survives alongside
// existing insights, a Retry and a Nudge with real accessible names — is
// literally the render output, not extractable into a pure function.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import MeetingInsightList from "./MeetingInsightList.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

async function render(props) {
  await act(async () => {
    root.render(createElement(MeetingInsightList, props));
  });
}

function buttons() {
  return [...container.querySelectorAll("button")];
}

function buttonNamed(pattern) {
  return buttons().find((b) => pattern.test((b.getAttribute("aria-label") || b.textContent).trim()));
}

function baseProps(overrides) {
  return {
    insights: [],
    topic: "",
    topicChanged: false,
    loading: false,
    error: "",
    onRetry: vi.fn(),
    onNudge: vi.fn(),
    ...overrides,
  };
}

// Every fixture below is the shape insightContract.js's normalizeInsights
// ACTUALLY emits: `{ kind, pageId, pageTitle }` and nothing else. A non-page
// source keeps only its `kind` (normalizeSource strips the rest), so a
// fixture carrying, say, an `attachmentName` would be describing a response
// the pipeline cannot produce — and any branch tested through it would be
// dead code that is nonetheless green.
const pageInsight = {
  id: "i1",
  text: "Mention that reconciliation dropped from three days to under an hour.",
  kind: "point",
  source: { kind: "page", pageId: "p-1", pageTitle: "Payments migration" },
};

const modelInsight = {
  id: "i2",
  text: "Ask who owns the refund path after the cutover.",
  kind: "question",
  source: { kind: "model", pageId: null, pageTitle: null },
};

const attachmentInsight = {
  id: "i3",
  text: "The migration runbook lists three rollback steps.",
  kind: "gap",
  source: { kind: "attachment", pageId: null, pageTitle: null },
};

const transcriptInsight = {
  id: "i4",
  text: "They just said the SLA is 24 hours, not 48.",
  kind: "point",
  source: { kind: "transcript", pageId: null, pageTitle: null },
};

describe("attribution — visible, and only when honest (AC)", () => {
  it("names the page a page-sourced insight came from", async () => {
    await render(baseProps({ insights: [pageInsight] }));
    expect(container.textContent).toContain("From your page: Payments migration");
  });

  // Mutation this catches: restoring the "From your attachment: X" /
  // "From one of your attachments" branch. Nothing verifies an `attachment`
  // source — normalizeSource only checks a `page` source's id against the
  // pages a read actually included — and no attachment contents are sent on
  // a read at all, so that branch renders an unverifiable claim of
  // provenance on the model's say-so. The page-sourced card in the same list
  // is here for the same reason as the model test below: it proves this
  // card's silence is a per-card decision, not a component that renders no
  // attribution at all.
  it("claims NO source for an attachment-sourced insight, since nothing verifies one", async () => {
    await render(baseProps({ insights: [pageInsight, attachmentInsight] }));
    const cards = [...container.querySelectorAll(".MuiCard-root")];
    expect(cards).toHaveLength(2);
    const pageCard = cards.find((c) => c.textContent.includes(pageInsight.text));
    const attachmentCard = cards.find((c) => c.textContent.includes(attachmentInsight.text));
    expect(pageCard.textContent).toContain("From your page: Payments migration");
    expect(attachmentCard.textContent).not.toMatch(/From /);
    expect(container.textContent).not.toContain("attachment");
  });

  it("attributes a transcript-sourced insight to the meeting itself", async () => {
    await render(baseProps({ insights: [transcriptInsight] }));
    expect(container.textContent).toContain("From what was just said in this meeting");
  });

  // Positive/negative pair, on purpose: a component that never rendered
  // any attribution text at all would otherwise pass this assertion
  // vacuously. Rendering the page-sourced card in the SAME list proves the
  // model-sourced one's silence is a deliberate, per-card omission — not a
  // component-wide feature that happens to be missing — by checking the
  // TWO CARDS separately rather than the container as a whole (the page
  // card's own "From your page" text would otherwise make a whole-container
  // "not.toContain" assertion meaningless).
  it("does NOT imply a source for a model-composed insight, even alongside an attributed one", async () => {
    await render(baseProps({ insights: [pageInsight, modelInsight] }));
    const cards = [...container.querySelectorAll(".MuiCard-root")];
    expect(cards).toHaveLength(2);
    const pageCard = cards.find((c) => c.textContent.includes(pageInsight.text));
    const modelCard = cards.find((c) => c.textContent.includes(modelInsight.text));
    expect(pageCard.textContent).toContain("From your page: Payments migration");
    expect(modelCard.textContent).not.toMatch(/From /);
  });

  it("falls back to a generic phrase when a page source has no title", async () => {
    await render(
      baseProps({
        insights: [{ ...pageInsight, source: { kind: "page", pageId: "p-1", pageTitle: null, attachmentName: null } }],
      }),
    );
    expect(container.textContent).toContain("From one of your pages");
    expect(container.textContent).not.toContain("From your page: null");
  });
});

describe("topic — shown, and a change is perceivable without colour alone", () => {
  it("shows the current topic", async () => {
    await render(baseProps({ topic: "Payments migration cutover" }));
    expect(container.textContent).toContain("Payments migration cutover");
  });

  it("shows a placeholder rather than a blank heading before a topic is known", async () => {
    await render(baseProps({ topic: "" }));
    expect(container.textContent).toContain("Not yet identified");
  });

  it("does not mark the very first topic on mount as a 'change'", async () => {
    // The route reports the first topic a meeting ever gets with
    // topicChanged:false — there is nothing it changed FROM.
    await render(baseProps({ topic: "Payments migration cutover", topicChanged: false }));
    expect(container.textContent).not.toContain("just changed");
  });

  it("marks a real topic change with real text, not colour alone", async () => {
    await render(baseProps({ topic: "Payments migration cutover", topicChanged: false }));
    expect(container.textContent).not.toContain("just changed");
    await render(baseProps({ topic: "Refund SLAs", topicChanged: true }));
    expect(container.textContent).toContain("just changed");
    expect(container.textContent).toContain("Refund SLAs");
  });

  // Mutation this catches: re-deriving the change from the topic strings
  // (`prevTopic !== topic`) instead of reading the route's verdict.
  // normalizeTopic compares NORMALIZED text, so a trailing period or a
  // trivial rephrase of the same subject is deliberately NOT a change; a
  // raw `!==` here would announce exactly that noise and interrupt the user
  // mid-meeting for nothing.
  it("does not invent a change of its own when the text differs but the read says it did not change", async () => {
    await render(baseProps({ topic: "Payments migration cutover", topicChanged: false }));
    await render(baseProps({ topic: "Payments migration cutover.", topicChanged: false }));
    expect(container.textContent).toContain("Payments migration cutover.");
    expect(container.textContent).not.toContain("just changed");
  });

  // Mutation this catches: latching the cue (setting it once and never
  // clearing it), which is what pinned "(just changed)" beside the heading
  // for the rest of the meeting and stopped it meaning "just".
  it("clears the cue on a later read that did not change the topic", async () => {
    await render(baseProps({ topic: "Refund SLAs", topicChanged: true }));
    expect(container.textContent).toContain("just changed");

    await render(baseProps({ topic: "Refund SLAs", topicChanged: false }));
    expect(container.textContent).not.toContain("just changed");
    // The live region empties too, so a later announcement is a genuine text
    // change on an already-mounted node rather than a repeat of stale copy.
    expect(container.querySelector('[role="status"][aria-live="polite"]').textContent).toBe("");
  });

  it("announces the change through a live region without moving focus", async () => {
    await render(baseProps({ topic: "Payments migration cutover", topicChanged: false }));
    const status = container.querySelector('[role="status"][aria-live="polite"]');
    // Mounted (and empty) BEFORE the announcement exists — a live region that
    // mounts already carrying its final text is unreliable.
    expect(status).not.toBeNull();
    expect(status.textContent).toBe("");

    await render(baseProps({ topic: "Refund SLAs", topicChanged: true }));
    expect(status.textContent).toContain("Refund SLAs");
    expect(document.activeElement).toBe(document.body);
  });
});

describe("loading and empty states — read as listening, never as failure", () => {
  it("shows a listening indicator while loading", async () => {
    await render(baseProps({ loading: true }));
    expect(container.textContent).toContain("Listening for insights");
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  it("reads as listening, not failure, when empty and not loading", async () => {
    await render(baseProps({ insights: [], loading: false, error: "" }));
    expect(container.textContent).toContain("Listening");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("does not show the empty 'listening' message once insights exist", async () => {
    await render(baseProps({ insights: [pageInsight] }));
    expect(container.textContent).not.toContain("insights will appear here");
  });
});

describe("error — shown in place with Retry, never clears existing insights", () => {
  it("shows the error and a working Retry control", async () => {
    const props = baseProps({ error: "Could not reach the insight service." });
    await render(props);
    expect(container.textContent).toContain("Could not reach the insight service.");
    const retry = buttonNamed(/retry/i);
    expect(retry).toBeDefined();
    retry.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps existing insights on screen alongside the error", async () => {
    await render(baseProps({ insights: [pageInsight], error: "Could not reach the insight service." }));
    expect(container.textContent).toContain(pageInsight.text);
    expect(container.textContent).toContain("Could not reach the insight service.");
  });

  it("does not show the empty 'listening' message while an error is showing", async () => {
    await render(baseProps({ insights: [], error: "Could not reach the insight service." }));
    expect(container.textContent).not.toContain("insights will appear here");
  });
});

describe("nudge control — a real accessible name, never disabled out of the tab order", () => {
  it("has an accessible name that says what it does, not just 'Nudge'", async () => {
    await render(baseProps());
    const nudge = buttons().find((b) => /nudge/i.test(b.textContent));
    expect(nudge).toBeDefined();
    const accessibleName = nudge.getAttribute("aria-label") || nudge.textContent;
    expect(accessibleName.trim().toLowerCase()).not.toBe("nudge");
    expect(accessibleName.length).toBeGreaterThan("Nudge".length);
  });

  it("calls onNudge when pressed", async () => {
    const props = baseProps();
    await render(props);
    const nudge = buttons().find((b) => /nudge/i.test(b.textContent));
    nudge.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(props.onNudge).toHaveBeenCalledTimes(1);
  });

  it("stays enabled and in the tab order", async () => {
    await render(baseProps());
    const nudge = buttons().find((b) => /nudge/i.test(b.textContent));
    expect(nudge.disabled).toBe(false);
    expect(nudge.tabIndex).not.toBe(-1);
  });

  it("renders no nudge control at all when the caller did not wire one up", async () => {
    const props = baseProps();
    delete props.onNudge;
    await render(props);
    expect(buttons().find((b) => /nudge/i.test(b.textContent))).toBeUndefined();
  });
});

describe("insight kind — every card is not identical", () => {
  it("labels a question differently from a point", async () => {
    await render(baseProps({ insights: [pageInsight, modelInsight] }));
    expect(container.textContent).toContain("Point");
    expect(container.textContent).toContain("Question");
  });
});
