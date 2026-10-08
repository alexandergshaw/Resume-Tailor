// @vitest-environment jsdom
//
// N143 fix round F2 (M2 copy): the warming line promises "Shows from your next
// question." That promise is only honest where something actually makes it come
// true -- the self-heal re-fires the prewarm for a PENDING pool
// (useApplicationProjectPool's noteRowOneStatus). A FAILED pool is not retried
// automatically, so its line must be the quiet failure text with NO promise in
// it; and a pool READ that errored or timed out reaches the card as `failed`
// (F1: lib/copilot/projectExampleRead.js), so it must render that failure text,
// never the warming one. NA (no Row 1 value at all) must still render nothing.
//
// Rendered through the REAL AnswerAids and asserted off the DOM.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import AnswerAids from "./AnswerAids.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const R1_WARMING = "Still being prepared. Shows from your next question.";
const R1_FAILED = "Couldn't prepare examples for this posting.";
const PROMISE = /next question/i;

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(props) {
  await act(async () => {
    root.render(createElement(AnswerAids, props));
  });
  return container.textContent || "";
}

describe("the 'next question' promise is made only for a pending pool", () => {
  it("[positive control] a pending Row 1 says it will show from the next question", async () => {
    const text = await render({ projectExample: { status: "pending" } });
    expect(text).toContain(R1_WARMING);
    expect(text).toMatch(PROMISE);
  });

  it("a failed Row 1 shows the quiet failure text and promises nothing", async () => {
    const text = await render({ projectExample: { status: "failed" } });
    expect(text).toContain(R1_FAILED);
    expect(text).not.toMatch(PROMISE);
    expect(text).not.toContain("Still being prepared");
  });

  it("a pool-read error (what the answer route sends as failed) renders the failure text, not warming", async () => {
    // The shape F1's read-error path puts on the done frame: nothing but the status.
    const text = await render({ projectExample: { status: "failed" }, finalOnly: false });
    expect(text).toContain(R1_FAILED);
    expect(text).not.toContain(R1_WARMING);
  });

  it("a past question's failed card (history) keeps the failure text and still promises nothing", async () => {
    const text = await render({ projectExample: { status: "failed" }, finalOnly: true });
    expect(text).toContain(R1_FAILED);
    expect(text).not.toMatch(PROMISE);
  });

  it("an unrecognised status is treated as failed, never as warming", async () => {
    const text = await render({ projectExample: { status: "unavailable" } });
    expect(text).toContain(R1_FAILED);
    expect(text).not.toMatch(PROMISE);
  });
});

describe("NA still renders nothing", () => {
  it("no Row 1 and no Row 2 and no other aids renders an empty component", async () => {
    await render({});
    expect(container.textContent).toBe("");
    expect(container.childElementCount).toBe(0);
  });

  it("an explicitly undefined Row 1 and Row 2 renders nothing either", async () => {
    await render({ projectExample: undefined, projectExampleLive: undefined });
    expect(container.childElementCount).toBe(0);
  });

  it("[control] the same mount does render once a Row 1 value exists, so the empty result is the NA rule", async () => {
    await render({ projectExample: { status: "failed" } });
    expect(container.childElementCount).toBeGreaterThan(0);
  });
});
