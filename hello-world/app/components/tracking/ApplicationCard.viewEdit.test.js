// @vitest-environment jsdom
//
// N132 AC-1/2/3 + AC-4 reachability (mobile card). The "View/Edit" control in
// ApplicationCard that opens the rich preview/edit modal.
//
// WHAT THIS FILE PROVES, AND WHAT IT DOES NOT.
// It renders the REAL ApplicationCard and drives the REAL button the way a
// user does (a click on the rendered control), then asserts the click reaches
// the `openApplicationPreview` prop with this row's `app`. That is the
// reachability half: the control EXISTS, is shown/hidden on the right gate,
// and is wired to the handler prop. It does NOT prove what the handler then
// does (jobId resolution, entry population, tab) -- that is the open-path
// file. A direct handler call would not satisfy AC-1/2/3, so the gate is
// driven through the rendered DOM here.
//
// PROP NAME. The control's prop is `openApplicationPreview`, per the binding
// plan (N132.plan.r1.md Step 4 / 6 and design 2) -- NOT `onOpenPreview`, which
// is the SEPARATE AppViewDialog prop (design 1, Step 6, out of scope here).
// The 4b brief's "onOpenPreview" refers to that AppViewDialog door; see the
// report's plan-gap note.
//
// RED REASON (on HEAD): ApplicationCard renders no "View/Edit" button and
// accepts no `openApplicationPreview` prop, so every presence/click assertion
// fails. After plan Step 4 lands the button, each must go green.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";

import ApplicationCard from "./ApplicationCard.js";
import { makeTheme } from "../../theme/index.js";

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
  vi.restoreAllMocks();
});

// ------------------------------------------------------------------ fixtures

const RESUME = {
  content: "Alex Shaw\nStaff Engineer",
  content_lines: ["Alex Shaw", "Staff Engineer"],
  docx_path: "resumes/app-1.docx",
};
const COVER = {
  content: "Dear Hiring Manager,\nHello.",
  content_lines: ["Dear Hiring Manager,", "Hello."],
  docx_path: "covers/app-1.docx",
};

function makeApp(overrides = {}) {
  return {
    id: "app-1",
    status: "applied",
    applied_at: "2026-01-05T00:00:00.000Z",
    application_url: "https://jobs.example.com/apply/1",
    positions: {
      id: "pos-1",
      external_id: "job-ext-1",
      company: "Acme",
      title: "Staff Engineer",
      url: null,
      description: "Build things.",
    },
    generated_resumes: RESUME,
    generated_cover_letters: COVER,
    ...overrides,
  };
}

function baseProps(app, overrides = {}) {
  return {
    app,
    idx: 0,
    applicationStages: {},
    emailClassificationsByAppId: {},
    resumeFile: { name: "base-resume.docx" },
    isDocxResume: () => true,
    highlightedAppId: null,
    renderDigestCell: () => null,
    setAppDialog: vi.fn(),
    setStageError: vi.fn(),
    setStageDialog: vi.fn(),
    openCommsInAppDialog: vi.fn(),
    askAiAbout: vi.fn(),
    buildApplicationContextString: () => "context",
    openEditApplicationDialog: vi.fn(),
    handleDeleteApplication: vi.fn(),
    downloadDocxFiles: vi.fn(async () => ""),
    openApplicationPreview: vi.fn(),
    ...overrides,
  };
}

async function render(props) {
  await act(async () => {
    root.render(
      createElement(
        ThemeProvider,
        { theme: makeTheme("light") },
        createElement(ApplicationCard, props),
      ),
    );
  });
}

const name = (node) => (node.textContent || "").replace(/\s+/g, " ").trim();
const buttons = () => Array.from(container.querySelectorAll("button"));
const byName = (label) => buttons().find((b) => name(b) === label);
const click = async (node) => {
  await act(async () => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
};

// ===========================================================================
// AC-1 -- shown when the app has a resume OR a cover.
// ===========================================================================

describe("AC-1 the control is present when documents exist", () => {
  it("resume + cover: renders a 'View/Edit' control", async () => {
    await render(baseProps(makeApp()));
    expect(byName("View/Edit"), "no View/Edit on a resume+cover row").toBeTruthy();
  });

  it("cover only: still renders 'View/Edit' (the feature's reason to exist)", async () => {
    await render(baseProps(makeApp({ generated_resumes: null })));
    expect(byName("View/Edit"), "no View/Edit on a cover-only row").toBeTruthy();
  });

  it("resume only: renders 'View/Edit'", async () => {
    await render(baseProps(makeApp({ generated_cover_letters: null })));
    expect(byName("View/Edit")).toBeTruthy();
  });
});

// ===========================================================================
// AC-2 -- hidden when the app has neither.
// ===========================================================================

describe("AC-2 the control is hidden when there are no documents", () => {
  it("neither resume nor cover: NO 'View/Edit' control", async () => {
    await render(
      baseProps(makeApp({ generated_resumes: null, generated_cover_letters: null })),
    );
    expect(byName("View/Edit")).toBeUndefined();
  });

  it("[power control] the same fixture DOES render it once a resume is present", async () => {
    // Guards against a vacuous AC-2: if the button never rendered under ANY
    // input, the hidden assertion would pass for the wrong reason.
    await render(baseProps(makeApp({ generated_resumes: null, generated_cover_letters: null })));
    expect(byName("View/Edit")).toBeUndefined();
    await render(baseProps(makeApp()));
    expect(byName("View/Edit")).toBeTruthy();
  });
});

// ===========================================================================
// AC-3 -- label distinct from the existing "Resume" text-view button.
// ===========================================================================

describe("AC-3 the label is distinct from the Resume text button", () => {
  it("both 'Resume' and 'View/Edit' coexist on a resume-bearing row and are different nodes", async () => {
    await render(baseProps(makeApp()));
    const resumeBtn = byName("Resume");
    const viewEdit = byName("View/Edit");
    expect(resumeBtn, "the existing Resume text button is gone").toBeTruthy();
    expect(viewEdit, "no View/Edit button").toBeTruthy();
    expect(viewEdit).not.toBe(resumeBtn);
  });
});

// ===========================================================================
// AC-4 (reachability) -- the real click reaches the handler prop with `app`.
// ===========================================================================

describe("AC-4 clicking View/Edit invokes openApplicationPreview(app)", () => {
  it("calls the prop exactly once, with this row's app", async () => {
    const props = baseProps(makeApp());
    await render(props);
    const viewEdit = byName("View/Edit");
    expect(viewEdit, "no View/Edit button to click").toBeTruthy();

    // Control: not fired before the click (distinguishes an over-firing wire).
    expect(props.openApplicationPreview).not.toHaveBeenCalled();

    await click(viewEdit);

    expect(props.openApplicationPreview).toHaveBeenCalledTimes(1);
    expect(props.openApplicationPreview).toHaveBeenCalledWith(props.app);
  });

  it("[control] clicking the OTHER actions does not call openApplicationPreview", async () => {
    // The new wire must be exclusive to View/Edit -- a handler attached to the
    // wrong button would still pass the test above by luck if, say, Resume
    // also fired it.
    const props = baseProps(makeApp());
    await render(props);
    await click(byName("Resume"));
    await click(byName("Comms"));
    expect(props.openApplicationPreview).not.toHaveBeenCalled();
  });
});
