// @vitest-environment jsdom
//
// Wave 3A of 3-plan-dupapply.md: the duplicate-application banner's VISIBLE
// SURFACE. StatusBar.js renders whatever `presentVerdict()`
// (lib/duplicateApply/verdictPresentation.js, shipped in Wave 2) decided --
// no copy string, no severity decision, no partition logic lives here. Every
// fixture below therefore builds a verdict object and runs it through the
// REAL, shipped `presentVerdict` to produce the `dupeNotice` prop, rather
// than hand-typing a `{ signals: [...] }` shape -- if this file typed its own
// kicker/sentence/evidence text, a passing suite would prove nothing about
// whether StatusBar actually renders the presentation module's output
// verbatim.
//
// Same createRoot + act idiom as StatusBar.test.js (no @testing-library in
// this repo).
//
// What this file deliberately does NOT assert: getComputedStyle on any
// CSS-module class (vitest.config.js sets no `css` option, so Vitest's own
// `css: false` default applies NO CSS-module style in jsdom -- background,
// position and colour all read as browser defaults regardless of what
// app/page.module.css declares), and `element.className.toContain(styles.X)`
// (the CSS-module import proxy fabricates a hashed name for ANY property
// access, including a class that does not exist in the real stylesheet, so
// that assertion is self-satisfying in both the correct and the broken
// shape). Every structural assertion below uses a `data-dupe-*` attribute
// instead, per 1e's own V-9 ruling.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import StatusBar from "./StatusBar.js";
import { presentVerdict, FORBIDDEN_STRINGS } from "../../lib/duplicateApply/verdictPresentation.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = vi.fn(() => ({
      matches: false,
      media: "",
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    }));
  }
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

function job(id, overrides = {}) {
  return { id, title: `Title for ${id}`, company: "Acme", url: "", ...overrides };
}

function baseProps(overrides = {}) {
  return {
    trackedJobs: [job("url-https://example.com/posting")],
    setTrackedJobs: vi.fn(),
    tailoringMap: {},
    jobResults: [],
    resumeFile: null,
    toolbarScrollRef: { current: null },
    toolbarCanScrollLeft: false,
    toolbarCanScrollRight: false,
    handleToolbarWheel: vi.fn(),
    handleToolbarScroll: vi.fn(),
    scrollToolbar: vi.fn(),
    isDocxResume: vi.fn(() => false),
    getDownloadFileNameForTitle: vi.fn(() => "resume.docx"),
    askAiAbout: vi.fn(),
    buildJobContextString: vi.fn(() => ""),
    setMainTab: vi.fn(),
    setActiveSection: vi.fn(),
    downloadResumeForChipJob: vi.fn(),
    handleToggleApplied: vi.fn(),
    handleIgnoreJob: vi.fn(),
    handleUntrackJob: vi.fn(),
    openResumePreview: vi.fn(),
    openCompanyResearch: vi.fn(),
    onRegenerate: vi.fn(),
    appliedByExternalId: null,
    ...overrides,
  };
}

async function render(props) {
  await act(async () => {
    root.render(createElement(StatusBar, props));
  });
}

function banner() {
  return container.querySelector('[data-dupe-flag="banner"]');
}
function signals() {
  return [...container.querySelectorAll("[data-dupe-signal]")];
}
function rows() {
  return [...container.querySelectorAll("[data-dupe-row]")];
}

// ---------------------------------------------------------------------------
// Fixtures -- verdict SHAPES only. Every kicker/sentence/evidence string a
// test reads comes back out of `presentVerdict`, never typed here.
// ---------------------------------------------------------------------------

const CLEAR_CLEAR = { samePosition: { verdict: "clear" }, company: { verdict: "clear" } };

// hit + capability-indeterminate: S-10a's cell. Renders because same-position
// raises alone; the company axis is named too (C-4's "once ANY banner is
// raised, every non-clear signal is named, including a capability reason").
const HIT_PLUS_CAPABILITY = {
  samePosition: {
    verdict: "hit",
    match: {
      applicationId: 11,
      company: "Acme",
      title: "Backend Engineer",
      status: "applied",
      appliedAt: "2026-01-05T00:00:00Z",
      url: "https://acme.com/job/11",
    },
  },
  company: { verdict: "indeterminate", reason: "no-company-key" },
};

// company hit, three evidence rows: two dated (different dates) and one
// UNDATED (appliedAt: null) -- S-14a's "listed, never dropped" requirement.
const COMPANY_HIT_WITH_UNDATED_ROW = {
  samePosition: { verdict: "clear" },
  company: {
    verdict: "hit",
    count: 3,
    evidence: [
      { applicationId: 21, company: "Acme Inc", title: "PM", status: "applied", appliedAt: "2026-02-10T00:00:00Z" },
      { applicationId: 22, company: "Acme Inc", title: "Analyst", status: "tailored", appliedAt: "2026-02-01T00:00:00Z" },
      { applicationId: 23, company: "Acme Inc", title: "Designer", status: "phone_screen", appliedAt: null },
    ],
  },
};

// A verdict whose only outstanding signal is a CAPABILITY reason on both
// axes -- shouldRenderBanner is false, presentVerdict returns null. This is
// NOT "clear"; it is the S-10h cell (capability/capability), and it must
// render exactly as nothing, same as clear/clear.
const BOTH_CAPABILITY = {
  samePosition: { verdict: "indeterminate", reason: "no-posting-identity" },
  company: { verdict: "indeterminate", reason: "no-company-key" },
};

function present(verdict, overrides = {}) {
  return presentVerdict({
    verdict,
    jobId: "url-https://example.com/posting",
    jobTitle: "Backend Engineer",
    candidateCompany: "Acme",
    queueLength: 1,
    timeZone: "UTC",
    statusLabels: {},
    ...overrides,
  });
}

describe("StatusBar duplicate-application banner — the all-clear and capability-only cases render NOTHING", () => {
  it("clear/clear: presentVerdict returns null, and StatusBar renders no banner and no extra DOM", async () => {
    const dupeNotice = present(CLEAR_CLEAR);
    expect(dupeNotice).toBeNull(); // sanity: the fixture really is the all-clear shape

    const withoutFeature = baseProps();
    delete withoutFeature.dupeNotice;
    await render(withoutFeature);
    const styleBefore = container.firstElementChild.getAttribute("style");
    const htmlBefore = container.firstElementChild.outerHTML;

    await render(baseProps({ dupeNotice: null }));
    expect(banner()).toBeNull();
    expect(container.querySelectorAll("[data-dupe-flag]").length).toBe(0);
    // S-15.5 / byte-identical dock: wiring the (null) prop through changes
    // NOTHING about the dock's rendered style or markup versus a caller that
    // never passed the prop at all.
    expect(container.firstElementChild.getAttribute("style")).toBe(styleBefore);
    expect(container.firstElementChild.outerHTML).toBe(htmlBefore);
  });

  it("capability/capability (S-10h, NOT the same fixture as clear/clear): still renders nothing", async () => {
    const dupeNotice = present(BOTH_CAPABILITY);
    expect(dupeNotice).toBeNull(); // presentVerdict's own partition, re-confirmed
    await render(baseProps({ dupeNotice }));
    expect(banner()).toBeNull();
  });

  it("never adds a click, a focus change, or a pixel to the clean case: the dock's flexWrap is untouched with dupeNotice null", async () => {
    await render(baseProps({ dupeNotice: null }));
    expect(container.firstElementChild.style.flexWrap).toBe("");
  });
});

describe("StatusBar duplicate-application banner — exactly one banner, structurally a plain node (C-2)", () => {
  it("is not an MUI Alert: no `role` and no `aria-live` on the banner node itself (the live region is a SEPARATE node owned by app/page.js, not this component)", async () => {
    const dupeNotice = present(HIT_PLUS_CAPABILITY);
    await render(baseProps({ dupeNotice }));
    const el = banner();
    expect(el).not.toBeNull();
    expect(el.tagName).toBe("DIV");
    expect(el.getAttribute("role")).toBeNull();
    expect(el.hasAttribute("aria-live")).toBe(false);
    // This component never renders a live region at all -- S-11 places it in
    // app/page.js. Confirms this file doesn't accidentally duplicate it.
    expect(container.querySelector('[data-dupe-flag="live"]')).toBeNull();
  });

  it("renders exactly one banner, tagged with the job id it is about", async () => {
    const dupeNotice = present(HIT_PLUS_CAPABILITY);
    await render(baseProps({ dupeNotice }));
    const banners = container.querySelectorAll('[data-dupe-flag="banner"]');
    expect(banners.length).toBe(1);
    expect(banners[0].getAttribute("data-dupe-job")).toBe(dupeNotice.jobId);
  });

  it("contains no anchor and no href anywhere -- one navigation control, not a per-row link (S-14a, N-9)", async () => {
    const dupeNotice = present(COMPANY_HIT_WITH_UNDATED_ROW);
    await render(baseProps({ dupeNotice }));
    const el = banner();
    expect(el.querySelectorAll("a").length).toBe(0);
    expect(el.querySelectorAll("[href]").length).toBe(0);
    expect(el.querySelectorAll('[data-dupe-action="open-applications"]').length).toBe(1);
    expect(el.querySelectorAll('[data-dupe-action="dismiss"]').length).toBe(1);
  });
});

describe("StatusBar duplicate-application banner — severity is distinguishable WITHOUT colour", () => {
  it("hit and capability-indeterminate render with different glyph SHAPE (data-testid), different data-dupe-severity, different kicker/sentence text, and hit-before-other DOM order", async () => {
    const dupeNotice = present(HIT_PLUS_CAPABILITY);
    await render(baseProps({ dupeNotice }));
    const lines = signals();
    expect(lines.length).toBe(2); // both axes named once a banner is raised (C-4)

    // Order channel: hit is always first.
    expect(lines[0].getAttribute("data-dupe-signal")).toBe("same-position");
    expect(lines[0].getAttribute("data-dupe-severity")).toBe("hit");
    expect(lines[1].getAttribute("data-dupe-signal")).toBe("company");
    expect(lines[1].getAttribute("data-dupe-severity")).toBe("indeterminate");

    // Shape channel: MUI's createSvgIcon sets data-testid = `${displayName}Icon`
    // outside production builds -- a triangle for hit, a circle for anything
    // else. Never the same icon for both severities.
    expect(lines[0].querySelector('[data-testid="ReportProblemOutlinedIcon"]')).not.toBeNull();
    expect(lines[0].querySelector('[data-testid="InfoOutlinedIcon"]')).toBeNull();
    expect(lines[1].querySelector('[data-testid="InfoOutlinedIcon"]')).not.toBeNull();
    expect(lines[1].querySelector('[data-testid="ReportProblemOutlinedIcon"]')).toBeNull();

    // Word + sentence channels: rendered verbatim from presentVerdict's own
    // output, never re-typed or re-derived here.
    expect(lines[0].textContent).toContain(dupeNotice.signals[0].kicker);
    expect(lines[0].textContent).toContain(dupeNotice.signals[0].sentence);
    expect(lines[1].textContent).toContain(dupeNotice.signals[1].kicker);
    expect(lines[1].textContent).toContain(dupeNotice.signals[1].sentence);
    expect(dupeNotice.signals[0].kicker).not.toBe(dupeNotice.signals[1].kicker);
    // The reason clause is carried as a data attribute for instrumentation,
    // matching the shipped reason string exactly.
    expect(lines[1].getAttribute("data-dupe-reason")).toBe("no-company-key");
    expect(lines[0].hasAttribute("data-dupe-reason")).toBe(false); // hit carries no reason
  });
});

describe("StatusBar duplicate-application banner — evidence rows, undated included (S-14a)", () => {
  it("renders all THREE rows, none dropped, the undated one tagged and listed LAST", async () => {
    const dupeNotice = present(COMPANY_HIT_WITH_UNDATED_ROW);
    await render(baseProps({ dupeNotice }));
    const rendered = rows();
    expect(rendered.length).toBe(3);
    expect(dupeNotice.evidence.length).toBe(3); // sanity: presentVerdict really kept all three

    // Newest-dated first, undated last (1e V-5) -- verified structurally,
    // not by re-deriving the sort here.
    expect(rendered.map((r) => r.getAttribute("data-dupe-row-dated"))).toEqual(["known", "known", "unknown"]);

    const last = rendered[rendered.length - 1];
    expect(last.textContent).toContain("date unknown");
    expect(last.getAttribute("data-dupe-row-dated")).toBe("unknown");

    // Every row's rendered text is the presentation module's OWN main/meta
    // strings, verbatim -- this file never reformats a company/title/date.
    rendered.forEach((el, i) => {
      expect(el.textContent).toContain(dupeNotice.evidence[i].main);
      expect(el.textContent).toContain(dupeNotice.evidence[i].meta);
    });
  });

  it("renders NO evidence list at all when the verdict carries none (hit + capability fixture has exactly one evidence row: the matched posting)", async () => {
    const dupeNotice = present(HIT_PLUS_CAPABILITY);
    await render(baseProps({ dupeNotice }));
    expect(dupeNotice.evidence.length).toBe(1);
    expect(rows().length).toBe(1);
    expect(rows()[0].getAttribute("data-dupe-row-dated")).toBe("known");
  });
});

describe("StatusBar duplicate-application banner — the queue ('1 of N'), taken verbatim from the presentation module", () => {
  it("renders the queueLabel text when N > 1, and tags it with a stable, non-CSS-module hook", async () => {
    const dupeNotice = present(HIT_PLUS_CAPABILITY, { queueLength: 3 });
    expect(dupeNotice.queueLabel).toBe("1 of 3");
    await render(baseProps({ dupeNotice }));
    const queueEl = container.querySelector("[data-dupe-queue]");
    expect(queueEl).not.toBeNull();
    expect(queueEl.textContent).toBe("1 of 3");
  });

  it("renders NO queue indicator at all when there is only one outstanding verdict (the dominant case; zero extra DOM)", async () => {
    const dupeNotice = present(HIT_PLUS_CAPABILITY, { queueLength: 1 });
    expect(dupeNotice.queueLabel).toBeNull();
    await render(baseProps({ dupeNotice }));
    expect(container.querySelector("[data-dupe-queue]")).toBeNull();
  });
});

describe("StatusBar duplicate-application banner — no invented copy", () => {
  it("never renders any of verdictPresentation's own FORBIDDEN_STRINGS, across a hit case and an evidence-bearing indeterminate case", async () => {
    expect(FORBIDDEN_STRINGS.length).toBeGreaterThan(0); // sanity: importing the real list, not an empty stub

    for (const verdict of [HIT_PLUS_CAPABILITY, COMPANY_HIT_WITH_UNDATED_ROW]) {
      const dupeNotice = present(verdict);
      await render(baseProps({ dupeNotice }));
      const text = banner().textContent.toLowerCase();
      for (const forbidden of FORBIDDEN_STRINGS) {
        expect(text.includes(forbidden.toLowerCase()), `banner text unexpectedly contains forbidden string "${forbidden}"`).toBe(false);
      }
    }
  });

  it("the two static control labels are the only copy this file supplies itself, and they are prohibitions-compliant on their face", async () => {
    // Distinguishes "this component invents verdict copy" (forbidden) from
    // "this component owns two fixed CONTROL labels, like every other
    // control in this dock" (expected, same as "Dismiss"/"Clear all"
    // elsewhere in this same file). Neither string asserts a negative.
    const dupeNotice = present(HIT_PLUS_CAPABILITY);
    await render(baseProps({ dupeNotice }));
    const el = banner();
    expect(el.querySelector('[data-dupe-action="open-applications"]').textContent).toBe("Open your applications");
    expect(el.querySelector('[data-dupe-action="dismiss"]').textContent).toBe("Dismiss");
  });
});

describe("StatusBar duplicate-application banner — remedies, reachable at zero extra clicks (S-14)", () => {
  it("Open your applications calls onOpenApplications with the presentation module's OWN guarded search seed, verbatim -- never re-derived here", async () => {
    // Safe case: every cited row's raw company contains the candidate's.
    const dupeNotice = present(COMPANY_HIT_WITH_UNDATED_ROW, { candidateCompany: "Acme" });
    expect(dupeNotice.interviewSearchSeed).toBe("Acme");
    const onOpenApplications = vi.fn();
    await render(baseProps({ dupeNotice, onOpenApplications }));
    await act(async () => {
      banner().querySelector('[data-dupe-action="open-applications"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onOpenApplications).toHaveBeenCalledTimes(1);
    expect(onOpenApplications).toHaveBeenCalledWith("Acme");
  });

  it("passes through the GUARD'S refusal untouched: when the evidence company text does not contain the candidate's, the seed is '' and StatusBar must not substitute its own value", async () => {
    const mismatchVerdict = {
      samePosition: { verdict: "clear" },
      company: {
        verdict: "hit",
        count: 1,
        evidence: [{ applicationId: 31, company: "Beta Corp", title: "Eng", status: "applied", appliedAt: "2026-01-01T00:00:00Z" }],
      },
    };
    const dupeNotice = present(mismatchVerdict, { candidateCompany: "Acme" });
    expect(dupeNotice.interviewSearchSeed).toBe(""); // sanity: guard really refused
    const onOpenApplications = vi.fn();
    await render(baseProps({ dupeNotice, onOpenApplications }));
    await act(async () => {
      banner().querySelector('[data-dupe-action="open-applications"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onOpenApplications).toHaveBeenCalledWith("");
  });

  it("Dismiss calls onDupeDismiss with the job id, and does not also fire onOpenApplications", async () => {
    const dupeNotice = present(HIT_PLUS_CAPABILITY);
    const onDupeDismiss = vi.fn();
    const onOpenApplications = vi.fn();
    await render(baseProps({ dupeNotice, onDupeDismiss, onOpenApplications }));
    await act(async () => {
      banner().querySelector('[data-dupe-action="dismiss"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onDupeDismiss).toHaveBeenCalledTimes(1);
    expect(onDupeDismiss).toHaveBeenCalledWith(dupeNotice.jobId);
    expect(onOpenApplications).not.toHaveBeenCalled();
  });

  it("never blocks: the pre-existing 'Clear all' control is present and unmodified whether or not a banner is showing", async () => {
    await render(baseProps({ dupeNotice: present(HIT_PLUS_CAPABILITY) }));
    const clearButtons = [...container.querySelectorAll("button")].filter((b) => b.textContent === "Clear all");
    expect(clearButtons.length).toBe(1);
    expect(clearButtons[0].disabled).toBe(false);
  });
});

describe("StatusBar duplicate-application banner — the dock's inline style (S-15.5's checkable form)", () => {
  it("gains flexWrap: 'wrap' ONLY while a banner is present", async () => {
    await render(baseProps({ dupeNotice: null }));
    expect(container.firstElementChild.style.flexWrap).toBe("");

    await render(baseProps({ dupeNotice: present(HIT_PLUS_CAPABILITY) }));
    expect(container.firstElementChild.style.flexWrap).toBe("wrap");

    await render(baseProps({ dupeNotice: null }));
    expect(container.firstElementChild.style.flexWrap).toBe("");
  });
});
