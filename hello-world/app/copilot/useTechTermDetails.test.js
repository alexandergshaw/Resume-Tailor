// @vitest-environment jsdom
//
// N150 Wave C/D — the detail scope behind the tech-buzzword chips, driven the way
// a person reaches it: a REAL AnswerAids inside a REAL TechTermDetailScope, a click
// on a chip, and the DOM read back. Only the network function is replaced, so the
// store, the key, the open state and the rendering are all the real ones.
//
// What this pins that the structural suites cannot:
//   • a click asks exactly once with the explicit request fields, shows the
//     loading line, then the explanation; collapse-then-reopen costs nothing;
//   • a failure reads as a failure with a Retry that re-asks, an honest empty has
//     no Retry (retrying it only spends money to be told the same thing);
//   • a term no answer in the scope suggested is an inert (disabled) chip, never a
//     button that silently does nothing;
//   • the outcome callback the session log hangs off fires once per issued
//     request, with the term and status and nothing else.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

const fetchTechTermDetail = vi.fn();
vi.mock("@/lib/copilot/techTermDetailClient", () => ({
  fetchTechTermDetail: (...args) => fetchTechTermDetail(...args),
}));

import AnswerAids from "./AnswerAids.js";
import { TechTermDetailScope } from "./useTechTermDetails.js";
import { resetTechTermDetailStore } from "@/lib/copilot/techTermDetailStore";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TERMS = ["idempotency keys", "circuit breaker"];
const TECH_TERMS = { status: "ready", terms: TERMS };
const QUESTIONS = [{ id: "q1", question: "How do you make retries safe?", techTerms: TECH_TERMS }];
const REQUEST = { applicationId: "app-1", engine: "gemini" };

let container;
let root;

beforeEach(() => {
  resetTechTermDetailStore();
  fetchTechTermDetail.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function mount({ questions = QUESTIONS, onDetailOutcome } = {}) {
  await act(async () =>
    root.render(
      createElement(
        TechTermDetailScope,
        { questions, request: REQUEST, onDetailOutcome },
        createElement(AnswerAids, { techTerms: TECH_TERMS }),
      ),
    ),
  );
}

const chip = (name) => [...document.body.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === name);
const retryButton = () => [...document.body.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Retry");
const text = () => document.body.textContent || "";

// A macrotask flush after the click: the store settles a record a few microtasks
// after the fetcher resolves, and the write that re-renders the chip row lands
// outside the click's own act() unless the act is held open past it.
async function click(el) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("opening a chip", () => {
  it("asks once with the explicit request fields, then shows the explanation", async () => {
    fetchTechTermDetail.mockResolvedValue({ detail: "Idempotency keys let a retried request be recognised.", empty: false });
    await mount();
    await click(chip("idempotency keys"));

    expect(fetchTechTermDetail).toHaveBeenCalledTimes(1);
    expect(fetchTechTermDetail).toHaveBeenCalledWith({
      term: "idempotency keys",
      question: "How do you make retries safe?",
      applicationId: "app-1",
      engine: "gemini",
    });
    expect(text()).toContain("Idempotency keys let a retried request be recognised.");
    expect(chip("idempotency keys").getAttribute("aria-expanded")).toBe("true");
    // The other chip is untouched.
    expect(chip("circuit breaker").getAttribute("aria-expanded")).toBe("false");
  });

  it("shows a loading line while the request is in flight", async () => {
    let release;
    fetchTechTermDetail.mockReturnValue(new Promise((resolve) => (release = resolve)));
    await mount();
    await click(chip("circuit breaker"));
    expect(text()).toContain("Looking that up");

    await act(async () => release({ detail: "A circuit breaker stops calling a failing dependency.", empty: false }));
    expect(text()).not.toContain("Looking that up");
    expect(text()).toContain("A circuit breaker stops calling a failing dependency.");
  });

  it("collapsing hides the explanation and reopening it asks nothing more", async () => {
    fetchTechTermDetail.mockResolvedValue({ detail: "Explanation text.", empty: false });
    await mount();
    await click(chip("idempotency keys"));
    expect(text()).toContain("Explanation text.");

    await click(chip("idempotency keys"));
    expect(text()).not.toContain("Explanation text.");
    expect(chip("idempotency keys").getAttribute("aria-expanded")).toBe("false");

    await click(chip("idempotency keys"));
    expect(text()).toContain("Explanation text.");
    expect(fetchTechTermDetail).toHaveBeenCalledTimes(1);
  });
});

describe("a request that does not produce an explanation", () => {
  it("a failure reads as one, and Retry asks again", async () => {
    fetchTechTermDetail.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "http" }));
    fetchTechTermDetail.mockResolvedValueOnce({ detail: "Second time works.", empty: false });
    await mount();
    await click(chip("idempotency keys"));
    expect(text()).toContain("Couldn't look that up.");

    await click(retryButton());
    expect(fetchTechTermDetail).toHaveBeenCalledTimes(2);
    expect(text()).toContain("Second time works.");
  });

  it("a timeout says so", async () => {
    fetchTechTermDetail.mockRejectedValue(Object.assign(new Error("x"), { code: "timeout" }));
    await mount();
    await click(chip("idempotency keys"));
    expect(text()).toContain("That took too long to look up.");
  });

  it("an honest empty says nothing more and offers no Retry", async () => {
    fetchTechTermDetail.mockResolvedValue({ detail: "", empty: true });
    await mount();
    await click(chip("idempotency keys"));
    expect(text()).toContain("Nothing useful to add for this one.");
    expect(retryButton()).toBeUndefined();
  });

  it("the kill switch offers no Retry either", async () => {
    fetchTechTermDetail.mockRejectedValue(Object.assign(new Error("x"), { code: "disabled" }));
    await mount();
    await click(chip("idempotency keys"));
    expect(text()).toContain("unavailable on this server");
    expect(retryButton()).toBeUndefined();
  });
});

describe("a term the scope cannot resolve", () => {
  it("is a disabled chip and asks nothing when clicked", async () => {
    await mount({ questions: [] });
    const button = chip("idempotency keys");
    expect(button.disabled).toBe(true);
    await click(button);
    expect(fetchTechTermDetail).not.toHaveBeenCalled();
  });
});

describe("the outcome callback", () => {
  it("fires once per issued request with the term and status only", async () => {
    fetchTechTermDetail.mockResolvedValue({ detail: "Explanation text.", empty: false });
    const onDetailOutcome = vi.fn();
    await mount({ onDetailOutcome });

    await click(chip("idempotency keys"));
    expect(onDetailOutcome).toHaveBeenCalledTimes(1);
    expect(onDetailOutcome).toHaveBeenCalledWith({ term: "idempotency keys", status: "done", code: null });

    // Collapse and reopen issues nothing, so it reports nothing.
    await click(chip("idempotency keys"));
    await click(chip("idempotency keys"));
    expect(onDetailOutcome).toHaveBeenCalledTimes(1);
  });

  it("reports a failure with its enumerated code, never the message", async () => {
    fetchTechTermDetail.mockRejectedValue(Object.assign(new Error("raw provider text"), { code: "timeout" }));
    const onDetailOutcome = vi.fn();
    await mount({ onDetailOutcome });
    await click(chip("circuit breaker"));
    expect(onDetailOutcome).toHaveBeenCalledWith({ term: "circuit breaker", status: "error", code: "timeout" });
    expect(JSON.stringify(onDetailOutcome.mock.calls)).not.toContain("raw provider text");
  });
});
