// @vitest-environment jsdom
//
// N145 + N146a Wave B, seam 1 — the STALE Row-1 render and the "Try again"
// retry control, rendered through the REAL AnswerAids component (the thing a
// human drives, per measurement-instruments: a direct handler call does not
// satisfy a reachability criterion, so the button is found in the DOM and a
// real click is dispatched at it).
//
// GROUNDING (cite file:line):
//   - AnswerAids.js:285-295 rowOneView maps status -> view; "stale" is NOT a
//     case today, so it falls to default -> {kind:"failed"}, and RowOne
//     (AnswerAids.js:352-366) renders the FAILED quiet line under the
//     EXAMPLE_DT_READY label ("Ready example"). So on HEAD a status:"stale"
//     pick shows "Couldn't prepare examples for this posting." with no
//     title/bullets.
//   - lib/copilot/projectExampleSelect.js:235-259 (SHIPPED, sub-chunk 2) emits
//     { status:"stale", competency, domain, title, bullets, hypothetical:true,
//     engine } for a FAILED pool that still carries a matched shown pick. This
//     file is the RENDER half that does not exist yet.
//   - OWNER RULING 2026-10-12: serve last-good FLAGGED STALE, never as a fresh
//     'ready' benchmark; add a "Try again" retry on the CURRENT surface only.
//
// WHAT IS jsdom-DECIDABLE here: that stale content renders with the invented
// lead AND is flagged DISTINCT from the fresh "Ready example" label; that the
// button appears only for failed/stale + a supplied handler, is named exactly
// "Try again", fires its handler on a real click, and while in flight stays
// mounted + focusable + aria-disabled with the click ignored. NOT decidable
// here (owner/1c copy): the exact stale caption/label strings and any phone
// geometry of the flag's wrap — so this file pins the PROPERTY (distinct from
// "Ready example", content still shown) and never the exact stale wording.
//
// The idle/in-flight control LABELS ("Try again" / "Trying again") are the
// settled UX r1 strings (docs/loop/N143.ux.r1.md:117,147-160) the brief names
// verbatim; changing one is a ruling, not an edit.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import AnswerAids from "./AnswerAids.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const GROUP_LABEL = "Example projects (invented)";
const DT_READY = "Ready example";
const LEAD_BOLD = "Not from your resume.";
const R1_FAILED = "Couldn't prepare examples for this posting.";
const RETRY_LABEL = "Try again"; // UX r1 R1_RETRY (brief: accessible name exactly this)
const RETRYING_LABEL = "Trying again"; // UX r1 in-flight label

// The SHIPPED stale shape (projectExampleSelect.js buildProjectExample's stale
// arm), built here as a literal rather than derived from the producer — a
// canary built from the thing under test proves only consistency.
const STALE = (over = {}) => ({
  status: "stale",
  competency: "incident response",
  domain: "SRE",
  title: "Rebuilt the paging rotation",
  bullets: ["Cut alert noise from 5 to 1 per shift", "Mean time to ack within the target"],
  hypothetical: true,
  engine: "gemini",
  ...over,
});

// The same entry as a READY pick, so a mutant that renders stale identically
// to ready produces BYTE-IDENTICAL text to this and the distinctness canary
// below bites.
const READY_SAME = (over = {}) => ({ ...STALE(), status: "ready", ...over });

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
  // Read document.body (MUI portals land there), and return the mount node for
  // DOM queries.
  return { text: document.body.textContent || "", el: container };
}

// The one, exact "Try again"/"Trying again" control — a real native <button>
// whose ACCESSIBLE NAME is its own text (no Tooltip, which would replace that
// name). Returns null when absent.
function retryButton(el, label) {
  const buttons = Array.from(el.querySelectorAll("button"));
  const matches = buttons.filter((b) => (b.textContent || "").trim() === label);
  if (matches.length === 0) return null;
  expect(matches.length, `exactly one "${label}" control`).toBe(1);
  const btn = matches[0];
  // The name comes from the text, never an aria-label a Tooltip would inject.
  expect(btn.getAttribute("aria-label")).toBeNull();
  return btn;
}

async function click(el) {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

describe("Row 1 STALE renders the last-good example, FLAGGED DISTINCT from a fresh benchmark (N146a-5)", () => {
  it("[positive] shows the invented lead, the title and the bullets", async () => {
    const { text, el } = await render({ projectExample: STALE() });
    expect(text).toContain(GROUP_LABEL);
    expect(text).toContain(LEAD_BOLD); // still invented content
    expect(text).toMatch(/invented/i);
    expect(text).toContain("Rebuilt the paging rotation");
    expect(text).toContain("Cut alert noise from 5 to 1 per shift");
    // Rendered as real list items, like a ready pick.
    const bullets = Array.from(el.querySelectorAll("li")).map((li) => li.textContent);
    expect(bullets.some((t) => t.includes("Mean time to ack within the target"))).toBe(true);
  });

  it("[distinctness canary] a stale pick is NOT presented as the fresh 'Ready example' benchmark", async () => {
    // Positive control: the SAME entry as READY uses the "Ready example" label.
    const ready = await render({ projectExample: READY_SAME() });
    expect(ready.text).toContain(DT_READY);
    const readyText = ready.text;

    // Re-render as STALE with identical content. It must still show the
    // content, but must NOT read as "Ready example", and its visible text must
    // DIFFER from the ready render (a distinct flag/label). A mutant that
    // renders stale through the ready branch makes these identical and trips
    // BOTH assertions. RED on HEAD because stale currently renders as the
    // FAILED quiet line under the "Ready example" label.
    const stale = await render({ projectExample: STALE() });
    expect(stale.text).toContain("Rebuilt the paging rotation"); // content is served
    expect(stale.text).not.toContain(DT_READY); // never the fresh benchmark label
    expect(stale.text).not.toBe(readyText); // flagged distinct from a fresh pick
  });

  it("[malformed stale -> failed] a stale payload that fails the shown-entry guard shows no benchmark content", async () => {
    // isShownEntry gate (AnswerAids.js:266-275): empty bullets is not a
    // renderable example, so it must fall to the failed line, never title.
    const { text, el } = await render({ projectExample: STALE({ bullets: [] }) });
    expect(text).toContain(R1_FAILED);
    expect(text).not.toContain("Rebuilt the paging rotation");
    expect(el.querySelectorAll("li").length).toBe(0);
  });

  it("ambiguous provenance renders AS hypothetical: a stale entry with hypothetical missing still shows the lead", async () => {
    const row = STALE();
    delete row.hypothetical;
    const { text } = await render({ projectExample: row });
    expect(text).toContain(LEAD_BOLD);
    expect(text).toContain("Rebuilt the paging rotation");
  });
});

describe('the "Try again" control appears only for failed/stale + a supplied handler (N145-1)', () => {
  it("[failed + handler] renders a 'Try again' button and a real click fires the handler once", async () => {
    const onRetryRowOne = vi.fn();
    const { el } = await render({ projectExample: { status: "failed" }, onRetryRowOne });
    const btn = retryButton(el, RETRY_LABEL);
    expect(btn, "a Try again button for a failed Row 1").not.toBeNull();
    await click(btn);
    expect(onRetryRowOne).toHaveBeenCalledTimes(1);
  });

  it("[stale + handler] renders a 'Try again' button and a real click fires the handler once", async () => {
    const onRetryRowOne = vi.fn();
    const { el } = await render({ projectExample: STALE(), onRetryRowOne });
    const btn = retryButton(el, RETRY_LABEL);
    expect(btn, "a Try again button for a stale Row 1").not.toBeNull();
    await click(btn);
    expect(onRetryRowOne).toHaveBeenCalledTimes(1);
  });

  // DISCLOSED: the four cases below assert the ABSENCE of a button that does
  // not exist on HEAD, so they pass VACUOUSLY until the control lands. They
  // are kept because once it lands they pin that the control is NOT hardwired
  // on: it must be absent for ready/warming/no_match and absent with no
  // handler supplied.
  it("[control] ready + handler shows NO Try again (regenerating the pool does not fix a good pick)", async () => {
    const { el } = await render({ projectExample: READY_SAME(), onRetryRowOne: vi.fn() });
    expect(retryButton(el, RETRY_LABEL)).toBeNull();
  });

  it("[control] warming (pending) + handler shows NO Try again (already in flight)", async () => {
    const { el } = await render({ projectExample: { status: "pending" }, onRetryRowOne: vi.fn() });
    expect(retryButton(el, RETRY_LABEL)).toBeNull();
  });

  it("[control] no_match + handler shows NO Try again (a per-question miss is not a pool failure)", async () => {
    const { el } = await render({ projectExample: { status: "no_match" }, onRetryRowOne: vi.fn() });
    expect(retryButton(el, RETRY_LABEL)).toBeNull();
  });

  it("[control] failed WITHOUT a handler shows NO Try again (the button is not hardwired on)", async () => {
    const { el } = await render({ projectExample: { status: "failed" } });
    expect(retryButton(el, RETRY_LABEL)).toBeNull();
  });
});

describe("while a retry is in flight the control stays reachable but inert (N145-2)", () => {
  it("rowOneRetrying: stays mounted + focusable, aria-disabled, label 'Trying again', click ignored", async () => {
    const onRetryRowOne = vi.fn();
    const { el } = await render({
      projectExample: { status: "failed" },
      onRetryRowOne,
      rowOneRetrying: true,
    });
    // Named by the in-flight label now, still a real button.
    const btn = retryButton(el, RETRYING_LABEL);
    expect(btn, "the in-flight control stays mounted").not.toBeNull();
    // NOT native-disabled (a disabled/unmounted focused control drops focus to
    // <body>, UX r1 4.2), but marked aria-disabled.
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    // Still focusable.
    await act(async () => btn.focus());
    expect(document.activeElement).toBe(btn);
    // The click is ignored while in flight.
    await click(btn);
    expect(onRetryRowOne).not.toHaveBeenCalled();
  });

  it("[control] NOT retrying, a double click fires the handler twice (AnswerAids does not dedupe; the client's single-flight does)", async () => {
    const onRetryRowOne = vi.fn();
    const { el } = await render({ projectExample: { status: "failed" }, onRetryRowOne });
    const btn = retryButton(el, RETRY_LABEL);
    expect(btn).not.toBeNull();
    await click(btn);
    await click(btn);
    expect(onRetryRowOne).toHaveBeenCalledTimes(2);
  });
});
