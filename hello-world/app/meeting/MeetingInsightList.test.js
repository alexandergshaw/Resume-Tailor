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

describe("reference links — a per-insight control that pulls verified sources", () => {
  function findSourcesButtons() {
    return buttons().filter((b) => /find sources/i.test(b.getAttribute("aria-label") || ""));
  }

  const oneReference = { title: "Payments migration runbook", url: "https://docs.example.com/runbook", host: "docs.example.com" };

  // Mutation this catches: naming every card's control "Find sources" (or
  // any other fixed string) instead of folding the insight's own text into
  // the label. Two cards with an identical accessible name is exactly the
  // bug this repo has already shipped on another tab (see this file's own
  // header comment on attribution for the sibling discipline) and forbids
  // repeating here.
  it("gives each insight's control a DIFFERENT accessible name that identifies its own point", async () => {
    await render(baseProps({ insights: [pageInsight, modelInsight], onFindReferences: vi.fn() }));

    const controls = findSourcesButtons();
    expect(controls).toHaveLength(2);
    const names = controls.map((b) => b.getAttribute("aria-label"));
    expect(names[0]).not.toBe(names[1]);
    expect(names[0]).toContain(pageInsight.text);
    expect(names[1]).toContain(modelInsight.text);
  });

  // Mutation this catches: disabling the control while a lookup is in
  // flight, which removes it from the tab order — this file's own Nudge
  // control is already held to the identical rule (see the "stays enabled
  // and in the tab order" test above). The `disabled` assertion is what
  // actually carries this test: jsdom does not reproduce a real browser's
  // "a disabled button's tabIndex becomes -1", so a control that got
  // disabled would still report a non -1 tabIndex here — `disabled` is
  // strengthened INTO the assertion rather than relied on alone, per this
  // repo's own note on why that check is nearly vacuous by itself. The
  // aria-busy check pins Fix 3's own busy-state requirement on the same
  // control.
  it("keeps the control enabled and in the tab order while a lookup is loading, and marks it busy", async () => {
    await render(
      baseProps({
        insights: [pageInsight],
        onFindReferences: vi.fn(),
        referencesByInsightId: { [pageInsight.id]: { status: "loading", error: "", result: null } },
      }),
    );
    const control = findSourcesButtons()[0];
    expect(control.disabled).toBe(false);
    expect(control.tabIndex).not.toBe(-1);
    expect(control.getAttribute("aria-busy")).toBe("true");
  });

  // Fix 3, bullet 1: the aria-label used to stay EXACTLY "Find sources for:
  // …" through a loading fetch — an aria-label overrides the visible
  // "Finding sources…" text node entirely, so that visible change was
  // invisible to assistive tech even though it was plainly on screen. The
  // "Find sources for:" prefix is kept stable in both states (so a query
  // like this file's own findSourcesButtons() still finds the control while
  // it is loading), but the label itself is no longer identical between the
  // two states.
  it("reflects the loading state in its own accessible name, not just its visible text", async () => {
    await render(baseProps({ insights: [pageInsight], onFindReferences: vi.fn() }));
    const idleControl = findSourcesButtons()[0];
    const idleLabel = idleControl.getAttribute("aria-label");
    expect(idleLabel).toBe(`Find sources for: ${pageInsight.text}`);
    expect(idleControl.getAttribute("aria-busy")).toBe("false");

    await render(
      baseProps({
        insights: [pageInsight],
        onFindReferences: vi.fn(),
        referencesByInsightId: { [pageInsight.id]: { status: "loading", error: "", result: null } },
      }),
    );
    const loadingControl = findSourcesButtons()[0];
    const loadingLabel = loadingControl.getAttribute("aria-label");
    expect(loadingLabel).not.toBe(idleLabel);
    expect(loadingLabel).toContain(pageInsight.text);
  });

  // Fix 3, bullet 3: an unnamed role="progressbar" announces nothing at all
  // to a screen reader.
  it("gives the loading spinner its own accessible name", async () => {
    await render(
      baseProps({
        insights: [pageInsight],
        onFindReferences: vi.fn(),
        referencesByInsightId: { [pageInsight.id]: { status: "loading", error: "", result: null } },
      }),
    );
    const spinner = container.querySelector('[role="progressbar"]');
    expect(spinner).not.toBeNull();
    expect((spinner.getAttribute("aria-label") || "").length).toBeGreaterThan(0);
  });

  // Fix 3, bullet 4: results (and progress) used to arrive with no live
  // region at all — a sighted user sees the card change, a screen reader
  // user gets nothing unless they happen to already be focused on it.
  // Mounted empty before anything has happened (same discipline this file's
  // own topic-change region already follows — see its header comment): a
  // region that mounts already carrying its final text is unreliable.
  it("announces progress and a landed result through a polite live region, without moving focus", async () => {
    await render(baseProps({ insights: [pageInsight], onFindReferences: vi.fn() }));
    const statusRegions = () => [...container.querySelectorAll('[role="status"][aria-live="polite"]')];
    expect(statusRegions().some((el) => el.textContent === "")).toBe(true);

    await render(
      baseProps({
        insights: [pageInsight],
        onFindReferences: vi.fn(),
        referencesByInsightId: { [pageInsight.id]: { status: "loading", error: "", result: null } },
      }),
    );
    const loadingRegion = statusRegions().find((el) => el.textContent.includes(pageInsight.text));
    expect(loadingRegion).toBeDefined();
    expect(loadingRegion.textContent).toContain("Finding sources for:");

    await render(
      baseProps({
        insights: [pageInsight],
        onFindReferences: vi.fn(),
        referencesByInsightId: {
          [pageInsight.id]: { status: "done", error: "", result: { references: [oneReference], dropped: 0, grounded: true } },
        },
      }),
    );
    const doneRegion = statusRegions().find((el) => el.textContent.includes("reference"));
    expect(doneRegion).toBeDefined();
    expect(document.activeElement).toBe(document.body);
  });

  // Fix 3's failure path is carried by ReferenceResults' own role="alert"
  // Alert (already correct — MUI defaults an Alert's role to "alert"). This
  // pins that an error is NOT also pushed through the polite role="status"
  // region above it — a screen reader would otherwise hear the same failure
  // twice: once politely, once (correctly) as an interruption.
  it("does not duplicate a failure into the polite status region", async () => {
    await render(
      baseProps({
        insights: [pageInsight],
        onFindReferences: vi.fn(),
        referencesByInsightId: {
          [pageInsight.id]: { status: "error", error: "Could not reach the reference service.", result: null },
        },
      }),
    );
    const statusRegions = [...container.querySelectorAll('[role="status"][aria-live="polite"]')];
    expect(statusRegions.every((el) => !el.textContent.includes("Could not reach"))).toBe(true);
    expect(container.querySelector('[role="alert"]').textContent).toContain("Could not reach the reference service.");
  });

  it("calls onFindReferences with the insight when its control is pressed", async () => {
    const onFindReferences = vi.fn();
    await render(baseProps({ insights: [pageInsight], onFindReferences }));

    findSourcesButtons()[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    expect(onFindReferences).toHaveBeenCalledTimes(1);
    expect(onFindReferences).toHaveBeenCalledWith(pageInsight);
  });

  // Mutation this catches: rendering the URL (or nothing) as the link text
  // instead of the reference's own `title`, or dropping `rel`/`target` —
  // either one turns "cite something out loud" into a link the user cannot
  // safely open, matching CompanyBriefPanel.js's own ArticleCard discipline.
  it("renders a verified reference as a real link with the title as text, the host shown, and safe rel/target", async () => {
    await render(
      baseProps({
        insights: [pageInsight],
        onFindReferences: vi.fn(),
        referencesByInsightId: {
          [pageInsight.id]: { status: "done", error: "", result: { references: [oneReference], dropped: 0, grounded: true } },
        },
      }),
    );

    const link = container.querySelector("a[href]");
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toBe(oneReference.url);
    expect(link.textContent).toContain(oneReference.title);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(container.textContent).toContain(oneReference.host);
  });

  // Positive/negative pair: `dropped > 0` must say something honest, and
  // `dropped === 0` (the normal, nothing-filtered case) must say nothing of
  // the kind — without the negative half, a component that always rendered
  // this sentence would pass the positive assertion vacuously.
  it("states plainly when suggestions were dropped, and says nothing of the kind when none were", async () => {
    await render(
      baseProps({
        insights: [pageInsight],
        onFindReferences: vi.fn(),
        referencesByInsightId: {
          [pageInsight.id]: { status: "done", error: "", result: { references: [oneReference], dropped: 2, grounded: true } },
        },
      }),
    );
    expect(container.textContent).toContain("2 suggestions could not be verified and are not shown.");

    await render(
      baseProps({
        insights: [pageInsight],
        onFindReferences: vi.fn(),
        referencesByInsightId: {
          [pageInsight.id]: { status: "done", error: "", result: { references: [oneReference], dropped: 0, grounded: true } },
        },
      }),
    );
    expect(container.textContent).not.toContain("could not be verified");
  });

  // Positive/negative pair on the OTHER axis: `grounded === false` (no
  // search ran at all) must read differently from a search that ran and
  // came back with nothing citable (`grounded === true`, empty references).
  // Mutation this catches: collapsing both into one "nothing found" string,
  // which would tell the user their topic has no documentation when the
  // truth is nobody looked.
  it("says something different for 'no search ran' than for 'search ran, found nothing'", async () => {
    await render(
      baseProps({
        insights: [pageInsight],
        onFindReferences: vi.fn(),
        referencesByInsightId: {
          [pageInsight.id]: { status: "done", error: "", result: { references: [], dropped: 0, grounded: true } },
        },
      }),
    );
    expect(container.textContent).toContain("No verified references were found for this point.");
    expect(container.textContent).not.toContain("could not be checked against search results");

    await render(
      baseProps({
        insights: [pageInsight],
        onFindReferences: vi.fn(),
        referencesByInsightId: {
          [pageInsight.id]: { status: "done", error: "", result: { references: [], dropped: 0, grounded: false } },
        },
      }),
    );
    expect(container.textContent).toContain("could not be checked against search results");
    expect(container.textContent).not.toContain("No verified references were found for this point.");
  });

  // Mutation this catches, three ways:
  //   1. Clearing `result` on a failed retry (or omitting the Retry control
  //      entirely) — a failed lookup must show a Retry AND leave whatever
  //      references already loaded untouched, the identical rule the
  //      list-level insight error is already held to above.
  //   2. Fix 2: a bare `<Button>Retry</Button>` shared across cards — this
  //      repo has already shipped that exact bug once (identical controls,
  //      indistinguishable to a screen reader) and forbids repeating it.
  //   3. `onRetry={() => onFindReferences(list[0])}` — a failed retry on
  //      one card silently re-fetching a DIFFERENT card's insight. A
  //      single-insight version of this test cannot catch this: with only
  //      one card, "the wrong insight" and "the right insight" are the same
  //      object, so this needs a SECOND card in an error state to tell them
  //      apart.
  it("shows a Retry on a failed lookup, keeps the reference already on screen, and retries the CARD'S OWN insight", async () => {
    const onFindReferences = vi.fn();
    await render(
      baseProps({
        insights: [pageInsight, modelInsight],
        onFindReferences,
        referencesByInsightId: {
          [pageInsight.id]: {
            status: "error",
            error: "Could not reach the reference service.",
            result: { references: [oneReference], dropped: 0, grounded: true },
          },
          [modelInsight.id]: {
            status: "error",
            error: "Could not verify this point right now.",
            result: null,
          },
        },
      }),
    );

    const alerts = [...container.querySelectorAll('[role="alert"]')];
    expect(alerts.some((a) => a.textContent.includes("Could not reach the reference service."))).toBe(true);
    expect(container.querySelector("a[href]").textContent).toContain(oneReference.title);

    const retries = buttons().filter((b) => /^retry$/i.test(b.textContent.trim()));
    expect(retries).toHaveLength(2);
    const names = retries.map((b) => b.getAttribute("aria-label"));
    expect(names[0]).not.toBe(names[1]);
    expect(names[0]).toContain(pageInsight.text);
    expect(names[1]).toContain(modelInsight.text);

    // The SECOND card's retry must re-fetch the SECOND card's own insight —
    // not the first, which is what `list[0]` would silently do instead.
    retries[1].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(onFindReferences).toHaveBeenCalledWith(modelInsight);
    expect(onFindReferences).not.toHaveBeenCalledWith(pageInsight);
  });

  // Mutation this catches: reading the whole `referencesByInsightId` map
  // instead of this card's own keyed entry, which would let one insight's
  // references bleed onto a sibling card (or every card render the same
  // result). Checked as two DISTINCT cards rather than the container as a
  // whole, so a component that rendered nothing at all could not pass this
  // vacuously.
  it("does not leak one insight's references onto another insight's card", async () => {
    const otherReference = { title: "Refund SLA doc", url: "https://docs.example.com/sla", host: "docs.example.com" };
    await render(
      baseProps({
        insights: [pageInsight, modelInsight],
        onFindReferences: vi.fn(),
        referencesByInsightId: {
          [pageInsight.id]: { status: "done", error: "", result: { references: [oneReference], dropped: 0, grounded: true } },
          [modelInsight.id]: { status: "done", error: "", result: { references: [otherReference], dropped: 0, grounded: true } },
        },
      }),
    );

    const cards = [...container.querySelectorAll(".MuiCard-root")];
    expect(cards).toHaveLength(2);
    const pageCard = cards.find((c) => c.textContent.includes(pageInsight.text));
    const modelCard = cards.find((c) => c.textContent.includes(modelInsight.text));

    expect(pageCard.querySelector("a").textContent).toContain(oneReference.title);
    expect(pageCard.textContent).not.toContain(otherReference.title);
    expect(modelCard.querySelector("a").textContent).toContain(otherReference.title);
    expect(modelCard.textContent).not.toContain(oneReference.title);
  });

  it("renders no reference control at all when the caller did not wire one up", async () => {
    await render(baseProps({ insights: [pageInsight] }));
    expect(findSourcesButtons()).toHaveLength(0);
  });
});
