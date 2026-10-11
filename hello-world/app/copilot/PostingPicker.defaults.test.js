// @vitest-environment jsdom
//
// N157 SC-C sub-chunk C-c (4b TDD seat) -- the additive `required` / `initialId`
// props on the shared PostingPicker (PD-2). Binds to docs/loop/N157.SC-C.design.r2.md
// section 2 (F2), section 5.4 (restore the last-used application), the pinned
// empty-account string of section 7, and ledger DES-N157-C18.
//
// WHY A NEW FILE. There is NO PostingPicker test today, and the picker is shared
// by live mode and practice mode (the only callers before this change). Adding
// `required` / `initialId` must be byte-identical by DEFAULT -- a perturbation of
// the empty-account message or an auto-fired onChange would ship a defect into
// two shipped surfaces (R11, SILENT). This file pins both the preserved default
// and the two new behaviours.
//
// RED on HEAD: PostingPicker.js does not accept `required` or `initialId` yet, so
// the required-branch string assertion and the initialId preselect reds; the
// default-behaviour assertions are GREEN on HEAD (they describe today's picker)
// and exist as the regression floor the implementer must not break. That mix is
// deliberate and disclosed in tests.r1.md -- the default rows are the
// byte-identical guard, not new coverage.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import { makeTheme } from "@/app/theme/index.js";
import { STUDY_COPY } from "@/lib/studyPlan/studyPlanCopy.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const fetchPracticePostings = vi.fn();
vi.mock("@/lib/copilot/postings", () => ({ fetchPracticePostings: (...a) => fetchPracticePostings(...a) }));

let PostingPicker;
let container;
let root;

const OPTION = { id: "app-7", title: "Staff Engineer", company: "Acme", label: "Staff Engineer — Acme" };

beforeEach(async () => {
  ({ default: PostingPicker } = await import("./PostingPicker.js"));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  fetchPracticePostings.mockReset();
  vi.restoreAllMocks();
});

async function mount(props) {
  await act(async () => {
    root.render(
      createElement(
        ThemeProvider,
        { theme: makeTheme("light") },
        createElement(PostingPicker, { value: null, onChange: () => {}, ...props }),
      ),
    );
  });
  // Flush the mount-time fetchPracticePostings().then(...).finally(...).
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const helperText = () => document.body.querySelector(".MuiFormHelperText-root")?.textContent ?? "";

describe("DEFAULT (no required, no initialId): byte-identical to today's picker", () => {
  it("an empty account still shows the hyphen + 'You can also ...' message (unchanged)", async () => {
    fetchPracticePostings.mockResolvedValue([]);
    await mount();
    // Today's behaviour: the message folds the blankHint in after an em dash.
    expect(helperText()).toContain("You can also");
  });

  it("with no initialId, onChange is NOT auto-fired (a wrong default must not spend a grounded search)", async () => {
    const onChange = vi.fn();
    fetchPracticePostings.mockResolvedValue([OPTION]);
    await mount({ onChange });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("required=true: the empty-account message loses its false 'You can also' tail (F2)", () => {
  it("renders exactly the pinned emptyAccount string, with no em dash and no 'You can also'", async () => {
    fetchPracticePostings.mockResolvedValue([]);
    await mount({ required: true });
    const text = helperText();
    expect(text).toBe(STUDY_COPY.picker.emptyAccount);
    expect(text).not.toContain("You can also");
    expect(text).not.toContain("—");
  });
});

describe("initialId: restore the last-used application AFTER options load (section 5.4)", () => {
  it("fires onChange ONCE with the matching option when initialId matches, after the options arrive", async () => {
    const onChange = vi.fn();
    fetchPracticePostings.mockResolvedValue([OPTION]);
    await mount({ initialId: "app-7", onChange });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(OPTION);
  });

  it("does NOT fire onChange when initialId matches no loaded option (no bogus selection)", async () => {
    const onChange = vi.fn();
    fetchPracticePostings.mockResolvedValue([OPTION]);
    await mount({ initialId: "does-not-exist", onChange });
    expect(onChange).not.toHaveBeenCalled();
  });
});
