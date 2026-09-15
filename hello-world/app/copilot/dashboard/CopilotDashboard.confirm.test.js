// @vitest-environment jsdom
//
// AC-N18.1..N18.14 — wave 3, the UI. CopilotDashboard renders the confirm
// gate's already-resolved `current`/`currentIsSeed`/`history`/`waiting`
// straight through as props (never re-deriving resolveConfirmedView itself
// — see this file's own module doc and CopilotClient.js's destructure for
// where that single computation actually happens). Rendered with
// react-dom/client, the same idiom this suite already uses for a full
// component render (QuestionFeed.test.js, CopilotDashboard.render.test.js).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import CopilotDashboard from "./CopilotDashboard.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

function entry(id, question, overrides = {}) {
  return {
    id,
    question,
    at: Date.now(),
    status: "done",
    points: [`Point for ${question}`],
    cues: [],
    buzzwords: [],
    anchor: null,
    idealProject: null,
    pageSources: [],
    error: "",
    ...overrides,
  };
}

function baseProps(overrides = {}) {
  return {
    questions: [],
    pace: { measured: false },
    fillers: { measured: false },
    ...overrides,
  };
}

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
    root.render(createElement(CopilotDashboard, props));
  });
}

function text() {
  return container.textContent || "";
}

function findButton(pattern) {
  return [...container.querySelectorAll("button")].find(
    (b) => pattern.test(b.textContent) || pattern.test(b.getAttribute("aria-label") || ""),
  );
}

describe("AC-N18: a newly detected question does not replace the displayed answer until confirmed", () => {
  it("keeps showing the confirmed current entry's own answer once a second question arrives, unrevealed", async () => {
    const q1 = entry(1, "Tell me about a conflict you resolved.", { status: "done", points: ["Handled it calmly."] });
    const q2 = entry(2, "Why do you want to leave your current role?", { status: "done", points: ["Growth."] });

    await render(
      baseProps({
        questions: [q1, q2],
        current: q1,
        currentIsSeed: false,
        waiting: [q2],
        onConfirmQuestion: vi.fn(),
      }),
    );

    // The displayed answer is still q1's, not q2's.
    expect(text()).toContain("Handled it calmly.");
    expect(text()).not.toContain("Growth.");
  });

  // Control: proves the assertion above can actually fail — the SAME check,
  // run once `current` really is q2, must flip.
  it("[control] once `current` really is the newer entry, its answer DOES show", async () => {
    const q1 = entry(1, "Tell me about a conflict you resolved.", { status: "done", points: ["Handled it calmly."] });
    const q2 = entry(2, "Why do you want to leave your current role?", { status: "done", points: ["Growth."] });

    await render(baseProps({ questions: [q1, q2], current: q2, currentIsSeed: false, waiting: [] }));

    expect(text()).toContain("Growth.");
  });
});

describe("AC-N18.4/N18.5: the waiting surface shows the waiting question's own text", () => {
  it("renders each waiting entry's question text as a button", async () => {
    const q2 = entry(2, "Why do you want to leave your current role?", { status: "done" });
    const q3 = entry(3, "What's your biggest weakness?", { status: "loading" });

    await render(
      baseProps({
        questions: [entry(1, "seed"), q2, q3],
        current: entry(1, "seed"),
        currentIsSeed: false,
        waiting: [q2, q3],
        onConfirmQuestion: vi.fn(),
      }),
    );

    expect(text()).toContain("Why do you want to leave your current role?");
    expect(text()).toContain("What's your biggest weakness?");
    // "Label by state": drafting is called out for the still-loading one.
    const draftingButton = findButton(/what's your biggest weakness/i);
    expect(draftingButton.getAttribute("aria-label")).toMatch(/drafting/i);
  });

  it("clicking a waiting entry's button confirms exactly that one, out of order", async () => {
    const onConfirmQuestion = vi.fn();
    const q2 = entry(2, "Second question");
    const q3 = entry(3, "Third question");

    await render(
      baseProps({
        questions: [entry(1, "seed"), q2, q3],
        current: entry(1, "seed"),
        currentIsSeed: false,
        waiting: [q2, q3],
        onConfirmQuestion,
      }),
    );

    // Pick the THIRD question first — the out-of-order case AC-N18.5 names.
    const button = findButton(/third question/i);
    await act(async () => {
      button.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(onConfirmQuestion).toHaveBeenCalledTimes(1);
    expect(onConfirmQuestion).toHaveBeenCalledWith(q3);
  });

  it("renders nothing when nothing is waiting", async () => {
    await render(baseProps({ current: entry(1, "seed"), currentIsSeed: false, waiting: [] }));
    expect(text()).not.toContain("Waiting to show");
  });
});

describe("AC-N18.7/N18.8: confirming shows the entry, and the previous one appears in history, collapsed", () => {
  it("a history item renders NO answer content until expanded, then shows it after one click", async () => {
    const past = entry(1, "Tell me about a conflict you resolved.", {
      status: "done",
      points: ["A very specific resolution detail."],
    });
    const current = entry(2, "Why do you want to leave your current role?", { status: "done", points: ["Growth."] });

    await render(baseProps({ questions: [past, current], current, currentIsSeed: false, history: [past] }));

    // The past question's TITLE is visible in the collapsed header row...
    expect(text()).toContain("Tell me about a conflict you resolved.");
    // ...but its answer content is not mounted at all yet.
    expect(text()).not.toContain("A very specific resolution detail.");

    // ONE click expands it.
    const header = findButton(/tell me about a conflict you resolved/i);
    expect(header).toBeTruthy();
    await act(async () => {
      header.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(text()).toContain("A very specific resolution detail.");
  });

  // Control: proves the absence assertion above is discriminating, not
  // vacuously true of a component that renders nothing for history at all.
  it("[control] the answer text really is in the tree once expanded — same fixture, asserted positively after the click only", async () => {
    const past = entry(1, "A past question about teamwork.", { status: "done", points: ["Distinctive detail X."] });
    await render(baseProps({ questions: [past], current: entry(2, "current"), currentIsSeed: false, history: [past] }));
    expect(text()).not.toContain("Distinctive detail X.");
    const header = findButton(/a past question about teamwork/i);
    await act(async () => {
      header.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(text()).toContain("Distinctive detail X.");
  });

  it("renders nothing when history is empty", async () => {
    await render(baseProps({ current: entry(1, "seed"), currentIsSeed: false, history: [] }));
    expect(text()).not.toContain("Previous questions");
  });
});

describe("AC-N18.13/F-F7: the reveal gate on the seed entry", () => {
  it("hides the answer behind a reveal button while currentIsSeed is true", async () => {
    const seed = entry(1, "Tell me about yourself.", { status: "done", points: ["A specific accomplishment."] });
    const onConfirmQuestion = vi.fn();
    await render(
      baseProps({
        questions: [seed],
        current: seed,
        currentIsSeed: true,
        answerHidden: true,
        onRevealAnswer: () => onConfirmQuestion(seed),
        revealLabel: "Show answer",
        announceHiddenReadiness: true,
      }),
    );

    expect(text()).not.toContain("A specific accomplishment.");
    const reveal = findButton(/show answer/i);
    expect(reveal).toBeTruthy();

    await act(async () => {
      reveal.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(onConfirmQuestion).toHaveBeenCalledWith(seed);
  });

  it("[control] once revealed (answerHidden false), the SAME entry's content shows with no extra click", async () => {
    const seed = entry(1, "Tell me about yourself.", { status: "done", points: ["A specific accomplishment."] });
    await render(baseProps({ questions: [seed], current: seed, currentIsSeed: false, answerHidden: false }));
    expect(text()).toContain("A specific accomplishment.");
  });
});

describe("F-F6: useCurrentQuestionAnnouncement re-verified — every confirm can now trigger its swap branch", () => {
  // Before N18, a swap between two already-`done` entries (the only shape
  // that trips this hook's "Current question: X" prefix) was a rare
  // fallback (a retroactive provisional remap). Under N18 it is the NORMAL
  // path: confirming a waiting entry that finished drafting while it waited
  // is exactly that shape. This re-verifies the hook still announces it
  // correctly rather than assuming the existing hook "just works" unchanged.
  it("announces which question is now current when confirming swaps onto an already-done entry", async () => {
    const q1 = entry(1, "First question.", { status: "done", points: ["One."] });
    const q2 = entry(2, "Second question.", { status: "done", points: ["Two."] });

    await render(baseProps({ questions: [q1, q2], current: q1, currentIsSeed: false, waiting: [q2] }));
    const region = () => container.querySelector('[role="status"]');
    // Initial mount: no swap yet, just the plain status.
    expect(region().textContent).toBe("Answer ready, 1 point");

    // Simulate the confirm: `current` swaps straight from q1 to the
    // already-`done` q2 (exactly what CopilotClient hands down after the
    // waiting button's onConfirmQuestion(q2) call resolves).
    await render(baseProps({ questions: [q1, q2], current: q2, currentIsSeed: false, waiting: [], history: [q1] }));

    expect(region().textContent).toBe('Current question: "Second question.". Answer ready, 1 point');
  });

  // Control: proves the prefix is tied to the SWAP, not merely to q2 being
  // current — rendering q2 as current from the very first render (no prior
  // entry to swap FROM) must not carry the prefix.
  it("[control] no prefix when the entry was already current on the very first render", async () => {
    const q2 = entry(2, "Second question.", { status: "done", points: ["Two."] });
    await render(baseProps({ questions: [q2], current: q2, currentIsSeed: false }));
    const region = container.querySelector('[role="status"]');
    expect(region.textContent).toBe("Answer ready, 1 point");
  });
});

describe("F-F7 extension: focus still moves on a confirm AFTER the seed's own reveal", () => {
  // The reveal button that triggers a LATER confirm (a WaitingList button)
  // unmounts the instant its entry stops being `waiting` — the exact same
  // "control vanishes, focus falls to <body>" shape F7 originally fixed for
  // the seed's own reveal button. This proves the fix now covers that case
  // too, driven through a real CopilotClient-style prop sequence (seed
  // revealed, then a second confirm swaps `current`).
  it("moves focus onto the newly-current answer container after a second confirm, not just the first", async () => {
    const seed = entry(1, "Tell me about yourself.", { status: "done", points: ["Seed point."] });
    const q2 = entry(2, "Second question.", { status: "done", points: ["Second point."] });

    // Mount already past the seed's own reveal (currentIsSeed: false),
    // exactly the state CopilotClient hands down right after the seed's
    // "Show answer" click.
    await render(
      baseProps({
        questions: [seed, q2],
        current: seed,
        currentIsSeed: false,
        answerHidden: false,
        announceHiddenReadiness: true,
        waiting: [q2],
        onConfirmQuestion: vi.fn(),
      }),
    );

    // Now simulate the SECOND confirm: `current` swaps to q2, exactly what
    // CopilotClient hands down once the candidate clicks q2's waiting button.
    await render(
      baseProps({
        questions: [seed, q2],
        current: q2,
        currentIsSeed: false,
        answerHidden: false,
        announceHiddenReadiness: true,
        waiting: [],
        history: [seed],
      }),
    );

    expect(text()).toContain("Second point.");
    // B3: `document.body` satisfies `document.activeElement?.tabIndex ===
    // -1` (undefined !== -1 is false only because activeElement defaults to
    // body when nothing is focused — but body has no tabIndex property at
    // all, so `undefined` compared against `-1` was in fact never true; the
    // REAL zero-power hole was that a component that never focuses anything
    // leaves `document.activeElement` at `document.body`, and NEITHER this
    // assertion NOR the old one below actually distinguished that state from
    // a real focus move). Assert the three facts that together rule out
    // "nothing was focused": focus left the body, it landed INSIDE this
    // render's container, and it is the SAME node as the one revealed
    // container the component marks `tabIndex={-1}` — not merely A node
    // with that attribute somewhere else on the page.
    const revealed = container.querySelector('[tabindex="-1"]');
    expect(revealed).toBeTruthy();
    expect(document.activeElement).not.toBe(document.body);
    expect(container.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(revealed);
  });

  // Control: proves the assertion above can actually fail — the SAME check,
  // run against a re-render that changes nothing, must not steal focus away
  // from wherever the user actually put it. `document.body.focus()` is a
  // no-op in jsdom (body is not a focusable element), so B3's fix moves
  // focus to a REAL focusable element outside the container first — a
  // control that merely called `document.body.focus()` would be vacuous:
  // `document.activeElement` already defaults to `document.body` with
  // nothing focused at all, so that assertion held whether or not the
  // component did anything.
  //
  // N18 delta review F3: BOTH renders pass a FRESH `onRevealAnswer: () => {}`
  // arrow — the exact shape CopilotClient.js:903 actually passes (a new
  // inline arrow on every render) — so `onReveal` changes identity between
  // the two renders and the effect's dependency array is NOT fully
  // unchanged. Before this fix, both renders omitted `onRevealAnswer`
  // entirely, so all four deps (`answerHidden`, `onReveal`, `current?.id`,
  // `announceHiddenReadiness`) were byte-identical across both renders and
  // React skipped the effect outright — the control passed because nothing
  // ran, not because the guard inside it correctly declined to steal focus.
  // With the effect actually re-running here, the control proves the GUARD
  // itself: `current` stays the same id and `answerHidden` never transitions
  // true -> false, so `revealedJustNow`/`swappedAfterActivation` both read
  // false and the effect's own body correctly does nothing.
  it("[control] does not steal focus on a re-render that doesn't change `current`", async () => {
    const seed = entry(1, "Tell me about yourself.", { status: "done", points: ["Seed point."] });
    await render(
      baseProps({
        questions: [seed],
        current: seed,
        currentIsSeed: false,
        answerHidden: false,
        announceHiddenReadiness: true,
        onRevealAnswer: () => {},
      }),
    );
    // A REAL focusable element, outside this render's container entirely,
    // deliberately focused before the re-render.
    const outsideButton = document.createElement("button");
    document.body.appendChild(outsideButton);
    outsideButton.focus();
    expect(document.activeElement).toBe(outsideButton);

    await render(
      baseProps({
        questions: [seed],
        current: seed,
        currentIsSeed: false,
        answerHidden: false,
        announceHiddenReadiness: true,
        onRevealAnswer: () => {},
      }),
    );

    expect(document.activeElement).toBe(outsideButton);
    outsideButton.remove();
  });
});

describe("M7: the current panel's undo control", () => {
  it("calls onUnconfirm with the current entry's id when clicked", async () => {
    const onUnconfirm = vi.fn();
    const current = entry(1, "Tell me about yourself.", { status: "done", points: ["A specific accomplishment."] });
    await render(
      baseProps({
        questions: [current],
        current,
        currentIsSeed: false,
        answerHidden: false,
        onUnconfirm,
      }),
    );
    const undo = findButton(/not the interviewer/i);
    expect(undo).toBeTruthy();
    await act(async () => {
      undo.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(onUnconfirm).toHaveBeenCalledTimes(1);
    expect(onUnconfirm).toHaveBeenCalledWith(1);
  });

  it("also reaches the seed's own first confirm (the cold-start trap M7 fixes)", async () => {
    const onUnconfirm = vi.fn();
    const seed = entry(1, "Tell me about yourself.", { status: "done", points: ["A specific accomplishment."] });
    // The state right after the seed's own reveal click — currentIsSeed has
    // already flipped false (CopilotClient's onConfirmQuestion already ran).
    await render(
      baseProps({
        questions: [seed],
        current: seed,
        currentIsSeed: false,
        answerHidden: false,
        onUnconfirm,
      }),
    );
    const undo = findButton(/not the interviewer/i);
    await act(async () => {
      undo.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(onUnconfirm).toHaveBeenCalledWith(1);
  });

  // Control: proves the control is additive — a caller that never passes
  // `onUnconfirm` (practice mode, and every test that predates M7) renders
  // with no such button at all, rather than one that throws when clicked.
  it("[control] renders no undo control at all when onUnconfirm is not passed", async () => {
    const current = entry(1, "Tell me about yourself.", { status: "done", points: ["A specific accomplishment."] });
    await render(baseProps({ questions: [current], current, currentIsSeed: false, answerHidden: false }));
    expect(findButton(/not the interviewer/i)).toBeUndefined();
  });

  it("does not render the undo control while the answer is still hidden behind the reveal button", async () => {
    const onUnconfirm = vi.fn();
    const seed = entry(1, "Tell me about yourself.", { status: "done", points: ["A specific accomplishment."] });
    await render(
      baseProps({
        questions: [seed],
        current: seed,
        currentIsSeed: true,
        answerHidden: true,
        onRevealAnswer: () => {},
        revealLabel: "Show answer",
        onUnconfirm,
      }),
    );
    expect(findButton(/not the interviewer/i)).toBeUndefined();
  });
});

describe("AC-N18.15: practice mode (no confirm props at all) renders byte-identically", () => {
  it("omitting current/currentIsSeed/history/waiting entirely falls back to the old pinnedId-based render", async () => {
    const q1 = entry(1, "Practice question", { status: "done", points: ["Sample point."] });
    await render(baseProps({ questions: [q1] }));
    expect(text()).toContain("Sample point.");
    expect(text()).not.toContain("Waiting to show");
    expect(text()).not.toContain("Previous questions");
  });
});
