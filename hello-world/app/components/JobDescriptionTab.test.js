// @vitest-environment jsdom
//
// A per-file jsdom override (vitest.config.js stays `environment: "node"`).
// It exists because several of this feature's acceptance criteria are ABOUT
// the rendering -- which control is disabled mid-run, what the progress
// actually says, whether a status is legible without colour, whether every
// box and every remove button has an accessible name. Extracting those into
// a pure function is not possible: they ARE the markup. The repo's older
// comments claiming nothing here can be rendered under test are out of date;
// app/copilot/useCopilotDashboard.wiring.test.js is the precedent.
//
// The component is deliberately presentational -- state and the tailoring
// pipeline live in app/hooks/useManualPostings.js -- so everything below is
// props in, callbacks out, with no network and no React state of its own.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import JobDescriptionTab from "./JobDescriptionTab.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

function entry(id, text, overrides = {}) {
  return {
    id,
    text,
    status: "idle",
    error: "",
    warning: "",
    jobId: null,
    jobTitle: "",
    company: "",
    ...overrides,
  };
}

function baseProps(overrides) {
  return {
    entries: [entry("p1", "")],
    // `running` is THIS tab's queue; `busy` is any manual generation in
    // flight, including one started from a StatusBar chip. Only `running`
    // has completed/total behind it, which is why they are separate props:
    // a chip regenerate must not borrow the queue's counters.
    running: false,
    busy: false,
    completed: 0,
    total: 0,
    lastRun: null,
    error: "",
    onAddPosting: vi.fn(),
    onRemovePosting: vi.fn(),
    onChangePosting: vi.fn(),
    onSubmit: vi.fn(),
    onRetryFailed: vi.fn(),
    onPreviewEntry: vi.fn(),
    askAiAbout: vi.fn(),
    tailorEngine: "embedded",
    onReviewFields: vi.fn(),
    ...overrides,
  };
}

async function render(props) {
  await act(async () => {
    root.render(createElement(JobDescriptionTab, props));
  });
}

// The real textareas, excluding MUI's aria-hidden auto-resize shadow.
function postingBoxes() {
  return [...container.querySelectorAll("textarea")].filter(
    (el) => el.getAttribute("aria-hidden") !== "true",
  );
}

// The accessible name a screen reader would announce: aria-label if present,
// otherwise the <label> associated by `for`.
function accessibleName(el) {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria;
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const target = container.querySelector(`#${CSS.escape(labelledBy)}`);
    if (target) return target.textContent.trim();
  }
  if (el.id) {
    const label = container.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) return label.textContent.trim();
  }
  return "";
}

function buttons() {
  return [...container.querySelectorAll("button")];
}

function buttonNamed(pattern) {
  return buttons().find((b) => pattern.test((b.getAttribute("aria-label") || b.textContent).trim()));
}

async function click(el) {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

async function type(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
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

describe("JobDescriptionTab -- the boxes (AC-1, AC-10)", () => {
  it("renders one box per posting, each named by its position", async () => {
    await render(baseProps({ entries: [entry("p1", "A"), entry("p2", "B"), entry("p3", "")] }));
    const boxes = postingBoxes();
    expect(boxes).toHaveLength(3);
    expect(boxes.map(accessibleName)).toEqual(["Job posting 1", "Job posting 2", "Job posting 3"]);
    expect(boxes.map((b) => b.value)).toEqual(["A", "B", ""]);
  });

  it("adds a posting through the parent", async () => {
    const props = baseProps();
    await render(props);
    await click(buttonNamed(/add another posting/i));
    expect(props.onAddPosting).toHaveBeenCalledTimes(1);
  });

  it("reports typing against the right posting", async () => {
    const props = baseProps({ entries: [entry("p1", ""), entry("p2", "")] });
    await render(props);
    await type(postingBoxes()[1], "typed into the second");
    expect(props.onChangePosting).toHaveBeenCalledWith("p2", "typed into the second");
  });

  it("offers no remove control while there is only one posting", async () => {
    await render(baseProps());
    expect(buttonNamed(/remove job posting/i)).toBeUndefined();
  });

  it("gives every remove control a name that says which posting it removes", async () => {
    const props = baseProps({ entries: [entry("p1", "A"), entry("p2", "B")] });
    await render(props);
    expect(buttonNamed(/^remove job posting 1$/i)).toBeDefined();
    const second = buttonNamed(/^remove job posting 2$/i);
    expect(second).toBeDefined();
    await click(second);
    expect(props.onRemovePosting).toHaveBeenCalledWith("p2");
  });

  it("disables adding and removing while a run is in flight", async () => {
    await render(
      baseProps({
        entries: [entry("p1", "A", { status: "processing" }), entry("p2", "B", { status: "pending" })],
        running: true,
        busy: true,
        total: 2,
        completed: 0,
      }),
    );
    expect(buttonNamed(/add another posting/i).disabled).toBe(true);
    expect(buttonNamed(/^remove job posting 1$/i).disabled).toBe(true);
  });

  it("stops the user typing into a posting that is already being tailored", async () => {
    // The box was the ONE control left editable mid-run. Typing resets the
    // entry to idle, and the in-flight worker's patch then lands "Ready", a
    // job id, and a title on the NEW text -- a Preview button describing a
    // document generated from text the user has already replaced.
    await render(
      baseProps({
        entries: [entry("p1", "A", { status: "processing" }), entry("p2", "B", { status: "pending" })],
        running: true,
        busy: true,
        total: 2,
        completed: 0,
      }),
    );
    postingBoxes().forEach((box) => expect(box.disabled).toBe(true));
  });

  it("stops the user typing while a run started elsewhere is in flight", async () => {
    await render(
      baseProps({ entries: [entry("p1", "A")], running: false, busy: true }),
    );
    postingBoxes().forEach((box) => expect(box.disabled).toBe(true));
  });

  it("keeps focus in the panel after a posting is removed", async () => {
    // The remove control unmounts itself. With no focus management the
    // caret lands on <body> and a keyboard user is thrown to the top of the
    // document -- and going from two boxes to one removes EVERY remove
    // button at once, so there is nothing adjacent left to fall back to.
    const props = baseProps({ entries: [entry("p1", "A"), entry("p2", "B")] });
    await render(props);
    await click(buttonNamed(/^remove job posting 2$/i));
    expect(props.onRemovePosting).toHaveBeenCalledWith("p2");

    // The parent owns the list, so removal arrives as new props.
    await render(baseProps({ ...props, entries: [entry("p1", "A")] }));
    expect(document.activeElement).not.toBe(document.body);
    expect(container.contains(document.activeElement)).toBe(true);
  });

  it("presents the postings as a list, so they can be navigated as one", async () => {
    await render(baseProps({ entries: [entry("p1", "A"), entry("p2", "B"), entry("p3", "C")] }));
    const list = container.querySelector("ul, ol");
    expect(list).not.toBeNull();
    expect(list.querySelectorAll("li")).toHaveLength(3);
  });
});

describe("JobDescriptionTab -- submitting and progress (AC-3)", () => {
  it("submits through the parent", async () => {
    const props = baseProps({ entries: [entry("p1", "A")] });
    await render(props);
    await click(buttonNamed(/generate/i));
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  it("counts the run off while it is in flight, and disables the submit control", async () => {
    await render(
      baseProps({
        entries: [entry("p1", "A", { status: "done" }), entry("p2", "B", { status: "processing" }), entry("p3", "C", { status: "pending" })],
        running: true,
        busy: true,
        completed: 1,
        total: 3,
      }),
    );
    expect(container.textContent).toContain("Tailoring 1 of 3");
    const submit = buttons().find((b) => b.type === "submit");
    expect(submit.disabled).toBe(true);
  });

  it("never borrows a finished run's counters for work that did not come from this tab", async () => {
    // The counters are not reset when a run ends, so a StatusBar chip's
    // Regenerate arrives with the previous run's numbers still in place.
    // Reading them would report "Tailoring 3 of 3" -- a count belonging to
    // finished work, AND an assertion that the run is complete while it is
    // still in flight. The count must come from `running`, never from `busy`.
    await render(
      baseProps({
        entries: [entry("p1", "A", { status: "done", jobId: "manual-1" })],
        running: false,
        busy: true,
        completed: 3,
        total: 3,
        lastRun: { done: 3, failed: 0 },
      }),
    );
    const submit = buttons().find((b) => b.type === "submit");
    expect(submit.textContent).toBe("Generating…");
    expect(container.textContent).not.toContain("Tailoring");
    expect(container.querySelector('[role="status"]').textContent).toBe("Generating…");
  });

  it("falls back to a generic busy label when running outside the queue (no count to report)", async () => {
    // running:true with completed:0, total:0 is what a StatusBar chip's
    // "Regenerate" produces -- it drives `running` through
    // manualTailor.submitting alone, never touching the queue's counters.
    await render(
      baseProps({
        entries: [entry("p1", "A")],
        running: false,
        busy: true,
        completed: 0,
        total: 0,
      }),
    );
    const submit = buttons().find((b) => b.type === "submit");
    expect(submit.textContent).toBe("Generating…");
    expect(submit.textContent).not.toContain("Tailoring");
    const live = container.querySelector('[role="status"]');
    expect(live.textContent).toBe("Generating…");
  });

  it("announces the run politely rather than silently", async () => {
    await render(
      baseProps({
        entries: [entry("p1", "A", { status: "processing" })],
        running: true,
        busy: true,
        completed: 0,
        total: 1,
      }),
    );
    const live = container.querySelector('[role="status"]');
    expect(live).not.toBeNull();
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toContain("Tailoring 0 of 1");
  });

  it("announces the outcome once the run is over", async () => {
    await render(
      baseProps({
        entries: [entry("p1", "A", { status: "done", jobId: "manual-1" }), entry("p2", "B", { status: "error", error: "nope" })],
        lastRun: { done: 1, failed: 1 },
      }),
    );
    const live = container.querySelector('[role="status"]');
    expect(live.textContent).toMatch(/1 .*tailored/i);
    expect(live.textContent).toMatch(/1 failed/i);
  });

  it("reports what the last RUN produced, not what the boxes currently say", async () => {
    // Derived from live entries, this announcement fires while the user is
    // typing: editing a finished posting resets it to idle, so the region
    // politely interrupts to report a smaller number. It counts boxes;
    // it should report the run.
    await render(
      baseProps({
        entries: [entry("p1", "edited since"), entry("p2", "B", { status: "done", jobId: "manual-2" })],
        lastRun: { done: 2, failed: 0 },
      }),
    );
    expect(container.querySelector('[role="status"]').textContent).toMatch(/2 .*tailored/i);
  });

  it("says nothing at all before the first run", async () => {
    await render(baseProps({ entries: [entry("p1", "A")] }));
    expect(container.querySelector('[role="status"]').textContent).toBe("");
  });
});

describe("JobDescriptionTab -- per-posting state (AC-3, AC-4, AC-5, AC-10)", () => {
  it("shows nothing but the box for a posting that has never been run", async () => {
    await render(baseProps({ entries: [entry("p1", "A")] }));
    expect(container.textContent).not.toMatch(/queued|working|ready|failed/i);
  });

  it("states each posting's status in words, not by colour alone", async () => {
    await render(
      baseProps({
        entries: [
          entry("p1", "A", { status: "pending" }),
          entry("p2", "B", { status: "processing" }),
          entry("p3", "C", { status: "done", jobId: "manual-3" }),
          entry("p4", "D", { status: "error", error: "The engine said no." }),
        ],
        completed: 4,
        total: 4,
      }),
    );
    expect(container.textContent).toContain("Queued");
    expect(container.textContent).toContain("Working");
    expect(container.textContent).toContain("Ready");
    expect(container.textContent).toContain("Failed");
  });

  it("shows a failed posting's own message on its own card", async () => {
    await render(
      baseProps({
        entries: [entry("p1", "A", { status: "done", jobId: "manual-1" }), entry("p2", "B", { status: "error", error: "The engine said no." })],
      }),
    );
    expect(container.textContent).toContain("The engine said no.");
  });

  it("shows a warning on a posting that succeeded anyway", async () => {
    await render(
      baseProps({
        entries: [entry("p1", "A", { status: "done", jobId: "manual-1", warning: "Cover letter failed." })],
      }),
    );
    expect(container.textContent).toContain("Cover letter failed.");
    expect(container.textContent).toContain("Ready");
  });

  it("opens a finished posting's documents on demand", async () => {
    const done = entry("p1", "A", { status: "done", jobId: "manual-1", jobTitle: "Staff Engineer", company: "Acme" });
    const props = baseProps({ entries: [done, entry("p2", "B", { status: "done", jobId: "manual-2" })] });
    await render(props);
    const previews = buttons().filter((b) => /preview documents/i.test(b.textContent));
    expect(previews).toHaveLength(2);
    await click(previews[0]);
    expect(props.onPreviewEntry).toHaveBeenCalledWith(done);
  });

  it("gives each preview control a name that says which posting it opens", async () => {
    // Visible text alone is the accessible name here, and it is identical on
    // every finished card -- a screen-reader user listing the buttons hears
    // "Preview documents" five times with nothing to tell them apart. The
    // remove controls were named positionally; these were not.
    await render(
      baseProps({
        entries: [
          entry("p1", "A", { status: "done", jobId: "manual-1" }),
          entry("p2", "B", { status: "done", jobId: "manual-2" }),
        ],
      }),
    );
    expect(buttonNamed(/^preview documents for job posting 1$/i)).toBeDefined();
    expect(buttonNamed(/^preview documents for job posting 2$/i)).toBeDefined();
  });

  it("attaches a posting's failure to the posting's own field", async () => {
    // The pill, the error and the warning are loose text with no association
    // to the box they describe: a screen-reader user who tabs to a failed
    // posting hears "Job posting 2, edit, multiline" and nothing else.
    await render(
      baseProps({
        entries: [
          entry("p1", "A", { status: "done", jobId: "manual-1" }),
          entry("p2", "B", { status: "error", error: "The engine said no." }),
        ],
      }),
    );
    const failed = postingBoxes()[1];
    expect(failed.getAttribute("aria-invalid")).toBe("true");
    const describedBy = failed.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const described = describedBy
      .split(/\s+/)
      .map((id) => container.querySelector(`#${CSS.escape(id)}`))
      .filter(Boolean)
      .map((el) => el.textContent)
      .join(" ");
    expect(described).toContain("The engine said no.");
  });

  it("attaches a posting's warning to its field too, without calling it invalid", async () => {
    await render(
      baseProps({
        entries: [entry("p1", "A", { status: "done", jobId: "manual-1", warning: "Cover letter failed." })],
      }),
    );
    const box = postingBoxes()[0];
    expect(box.getAttribute("aria-invalid")).not.toBe("true");
    const describedBy = box.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const described = describedBy
      .split(/\s+/)
      .map((id) => container.querySelector(`#${CSS.escape(id)}`))
      .filter(Boolean)
      .map((el) => el.textContent)
      .join(" ");
    expect(described).toContain("Cover letter failed.");
  });

  it("names the role and company a finished posting resolved to", async () => {
    await render(
      baseProps({
        entries: [entry("p1", "A", { status: "done", jobId: "manual-1", jobTitle: "Staff Engineer", company: "Acme" })],
      }),
    );
    expect(container.textContent).toContain("Staff Engineer");
    expect(container.textContent).toContain("Acme");
  });

  it("offers a retry that names how many failed, and only once something has failed", async () => {
    const props = baseProps({
      entries: [entry("p1", "A", { status: "done", jobId: "manual-1" }), entry("p2", "B", { status: "error", error: "nope" })],
      completed: 2,
      total: 2,
    });
    await render(props);
    const retry = buttonNamed(/retry failed \(1\)/i);
    expect(retry).toBeDefined();
    await click(retry);
    expect(props.onRetryFailed).toHaveBeenCalledTimes(1);

    await render(baseProps({ entries: [entry("p1", "A", { status: "done", jobId: "manual-1" })] }));
    expect(buttonNamed(/retry failed/i)).toBeUndefined();
  });
});

describe("JobDescriptionTab -- the side controls (AC-7)", () => {
  it("pins a lone posting to the chat exactly as before", async () => {
    const props = baseProps({ entries: [entry("p1", "The posting")] });
    await render(props);
    await click(buttonNamed(/ask ai/i));
    expect(props.askAiAbout).toHaveBeenCalledWith({
      label: "Pasted Job Description",
      content: "Pasted Job Description:\nThe posting",
    });
  });

  it("pins every posting when there are several", async () => {
    const props = baseProps({ entries: [entry("p1", "First"), entry("p2", "Second")] });
    await render(props);
    await click(buttonNamed(/ask ai/i));
    const pinned = props.askAiAbout.mock.calls[0][0];
    expect(pinned.label).toBe("Pasted Job Descriptions (2)");
    expect(pinned.content).toContain("First");
    expect(pinned.content).toContain("Second");
  });

  it("cannot pin nothing", async () => {
    await render(baseProps({ entries: [entry("p1", "  ")] }));
    expect(buttonNamed(/ask ai/i).disabled).toBe(true);
  });

  it("offers field review only on the external engine", async () => {
    await render(baseProps({ tailorEngine: "embedded", entries: [entry("p1", "A")] }));
    expect(buttonNamed(/review .*fields/i)).toBeUndefined();

    await render(baseProps({ tailorEngine: "external", entries: [entry("p1", "A")] }));
    expect(buttonNamed(/review .*fields/i)).toBeDefined();
  });

  it("reviews the fields of the one posting there is", async () => {
    const props = baseProps({ tailorEngine: "external", entries: [entry("p1", "The posting")] });
    await render(props);
    const review = buttonNamed(/review .*fields/i);
    expect(review.disabled).toBe(false);
    await click(review);
    expect(props.onReviewFields).toHaveBeenCalledWith("The posting");
  });

  it("refuses to review fields when it would be ambiguous which posting is meant", async () => {
    const props = baseProps({
      tailorEngine: "external",
      entries: [entry("p1", "First"), entry("p2", "Second")],
    });
    await render(props);
    const review = buttonNamed(/review .*fields/i);
    expect(review.getAttribute("aria-disabled")).toBe("true");
    await click(review);
    expect(props.onReviewFields).not.toHaveBeenCalled();
    // A disabled control with no stated reason is a dead end for the user.
    expect(container.textContent).toMatch(/one posting at a time/i);
  });

  it("keeps the refusal reachable by keyboard, and attached to the control it explains", async () => {
    // A real `disabled` attribute removes the control from the tab order
    // EXACTLY when the explanation appears, so the only users who cannot
    // reach the reason are the ones who cannot see it either. aria-disabled
    // keeps it focusable and describable while still refusing the action.
    await render(
      baseProps({
        tailorEngine: "external",
        entries: [entry("p1", "First"), entry("p2", "Second")],
      }),
    );
    const review = buttonNamed(/review .*fields/i);
    expect(review.disabled).toBe(false);
    expect(review.getAttribute("tabindex")).not.toBe("-1");
    const describedBy = review.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const reason = container.querySelector(`#${CSS.escape(describedBy.split(/\s+/)[0])}`);
    expect(reason.textContent).toMatch(/one posting at a time/i);
  });
});

describe("JobDescriptionTab -- tab-wide error (AC-6)", () => {
  it("shows the tab-wide message when there is one", async () => {
    await render(baseProps({ error: "Please upload a resume file." }));
    expect(container.textContent).toContain("Please upload a resume file.");
  });

  it("shows nothing when there is no error", async () => {
    await render(baseProps());
    expect(container.querySelector(".MuiAlert-root")).toBeNull();
  });
});
