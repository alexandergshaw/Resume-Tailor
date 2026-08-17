// @vitest-environment jsdom
//
// The briefing panel. Written before app/components/experience/TechWatchPanel.js
// exists.
//
// These acceptance criteria ARE the markup and cannot be extracted into a pure
// function: whether a blank root cause renders a heading with nothing under it,
// whether an exploited item says so in words rather than in a colour, whether
// the live region announces two consecutive identical updates. PageTree.test.js
// is the precedent for rendering a whole component here.
//
// The data hook is mocked so this file tests rendering only; useTechWatch's own
// polling and error-retention behavior is tested in app/hooks/useTechWatch.test.js.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("../../hooks/useTechWatch", () => ({ useTechWatch: vi.fn() }));

import { useTechWatch } from "../../hooks/useTechWatch";
import TechWatchPanel from "./TechWatchPanel.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

const NOW = new Date("2026-08-17T15:30:00.000Z");

function item(overrides = {}) {
  return {
    id: "osv:nextjs:GHSA-267c",
    sourceId: "osv",
    category: "vulnerability",
    severity: "high",
    title: "Next.js middleware bypass in App Router applications",
    technologyId: "nextjs",
    technology: "Next.js",
    affected: ">= 15.2.0, < 15.5.16",
    occurredAt: "2026-08-17T14:05:00.000Z",
    timePrecision: "minute",
    status: "",
    summary: "",
    rootCause: "",
    remedy: "",
    workaround: "",
    exploited: false,
    cveIds: ["CVE-2026-44575"],
    sources: [],
    ...overrides,
  };
}

function aiRow(overrides = {}) {
  return {
    technologyId: "typescript",
    technology: "TypeScript",
    cycle: "5.9",
    latest: "5.9.3",
    releasedAt: null,
    supportEndsAt: "2026-03-01",
    eolAt: null,
    state: "security-only",
    inUse: false,
    source: "ai",
    citation: { label: "devblogs.microsoft.com", url: "https://devblogs.microsoft.com/typescript/x/" },
    ...overrides,
  };
}

function hookState(overrides = {}) {
  return {
    lifecycleGaps: { rows: [], loading: false, error: "" },
    data: {
      generatedAt: "2026-08-17T15:29:00.000Z",
      windowHours: 24,
      items: [],
      lifecycle: [],
      watchlist: { entries: [], usedDefaults: false, truncated: false },
      sources: [],
    },
    loading: false,
    error: "",
    signedOut: false,
    lastLoadedAt: "2026-08-17T15:29:00.000Z",
    windowHours: 24,
    setWindowHours: vi.fn(),
    reload: vi.fn(),
    ...overrides,
  };
}

function render(state) {
  useTechWatch.mockReturnValue(state);
  act(() => {
    root.render(createElement(TechWatchPanel, { now: NOW }));
  });
}

const text = () => container.textContent;
const region = () => container.querySelector('[role="region"]');
const status = () => container.querySelector('[role="status"]');
// The cards, addressable on their own. Assertions about what a CARD says must
// not be made over the whole panel's textContent: the hour heading above it is
// also in there, and in UTC that heading legitimately reads "00:00 - 01:00".
const cards = () => [...container.querySelectorAll('[data-techwatch-item]')];
const buttonNamed = (name) =>
  [...container.querySelectorAll("button")].find(
    (b) => (b.getAttribute("aria-label") || b.textContent || "").trim().toLowerCase().includes(name.toLowerCase()),
  );

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("structure and naming", () => {
  it("is a landmark region named by its own heading", () => {
    render(hookState());
    const heading = container.querySelector("h3");
    expect(heading).toBeTruthy();
    expect(heading.textContent).toContain("Tech watch");
    expect(heading.id).toBeTruthy();
    expect(region().getAttribute("aria-labelledby")).toBe(heading.id);
  });

  it("puts hour headings one level below the panel heading", () => {
    render(hookState({ data: { ...hookState().data, items: [item()] } }));
    const h4 = container.querySelector("h4");
    expect(h4).toBeTruthy();
    expect(h4.textContent).toMatch(/\d{2}:\d{2}/);
  });

  it("makes the support table a real heading, so it can be navigated to", () => {
    // Read off the live accessibility tree: "Support & decommission" rendered
    // as a plain generic, so a screen-reader user moving by heading jumped
    // from the last hour bucket straight past the entire support table - the
    // section that answers "is anything I depend on already dead".
    render(
      hookState({
        data: {
          ...hookState().data,
          items: [item()],
          lifecycle: [
            {
              technologyId: "react",
              technology: "React",
              cycle: "17",
              latest: "17.0.2",
              releasedAt: "2020-10-20",
              supportEndsAt: "2022-03-29",
              eolAt: null,
              state: "security-only",
              inUse: true,
            },
          ],
        },
      }),
    );
    const headings = [...container.querySelectorAll("h4")].map((h) => h.textContent);
    expect(headings.some((h) => /support|decommission/i.test(h))).toBe(true);
    // and the hour heading is still there beside it
    expect(headings.some((h) => /\d{2}:\d{2}/.test(h))).toBe(true);
  });

  it("collapses and expands from a real button that reports its state", () => {
    render(hookState());
    const toggle = buttonNamed("Tech watch");
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.getAttribute("aria-expanded")).toBe("true"); // default expanded
    act(() => toggle.click());
    expect(buttonNamed("Tech watch").getAttribute("aria-expanded")).toBe("false");
  });

  it("remembers the collapsed choice across mounts", async () => {
    render(hookState());
    act(() => buttonNamed("Tech watch").click());
    await act(async () => root.unmount());
    root = createRoot(container);
    render(hookState());
    expect(buttonNamed("Tech watch").getAttribute("aria-expanded")).toBe("false");
  });
});

describe("the briefing itself", () => {
  it("renders an item's technology, title and affected range", () => {
    render(hookState({ data: { ...hookState().data, items: [item()] } }));
    expect(text()).toContain("Next.js");
    expect(text()).toContain("Next.js middleware bypass in App Router applications");
    expect(text()).toContain(">= 15.2.0, < 15.5.16");
  });

  it("renders root cause, remedy and workaround only when the source supplied them", () => {
    render(
      hookState({
        data: {
          ...hookState().data,
          items: [item({ rootCause: "Prefetch routes skipped the middleware check." })],
        },
      }),
    );
    expect(text()).toContain("Root cause");
    expect(text()).toContain("Prefetch routes skipped the middleware check.");
    // A blank field must render nothing at all - never a heading over empty
    // space, and never "unknown", which reads as a finding rather than a gap.
    expect(text()).not.toContain("Remedy");
    expect(text()).not.toContain("Workaround");
    expect(text()).not.toContain("unknown");
  });

  it("renders every supplied field when the source is generous", () => {
    render(
      hookState({
        data: {
          ...hookState().data,
          items: [
            item({
              rootCause: "A bad config push.",
              remedy: "Upgrade to 15.5.16.",
              workaround: "Move the check into the route handler.",
            }),
          ],
        },
      }),
    );
    expect(text()).toContain("Root cause");
    expect(text()).toContain("Remedy");
    expect(text()).toContain("Workaround");
    expect(text()).toContain("Move the check into the route handler.");
  });

  it("says an item is actively exploited in words, not only in colour", () => {
    render(hookState({ data: { ...hookState().data, items: [item({ exploited: true, severity: "critical" })] } }));
    expect(text()).toContain("Actively exploited");
  });

  it("gives documentation links text that means something out of context", () => {
    render(
      hookState({
        data: {
          ...hookState().data,
          items: [item({ sources: [{ label: "Advisory", url: "https://nvd.nist.gov/vuln/detail/CVE-2026-44575" }] })],
        },
      }),
    );
    const link = container.querySelector('a[href^="https://nvd.nist.gov"]');
    expect(link).toBeTruthy();
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
    const name = link.textContent.trim();
    expect(name.length).toBeGreaterThan(4);
    expect(["here", "link", "read more", "click here"]).not.toContain(name.toLowerCase());
    // "Meaningful out of context" is the actual requirement, and a bare
    // "Advisory" fails it: a briefing with six cards gives a screen-reader
    // user listing links six identical entries with nothing to tell them
    // apart. The technology name is what disambiguates them.
    expect(name).toContain("Next.js");
  });

  it("shows a date rather than a clock time for a day-precision item", () => {
    render(
      hookState({
        data: {
          ...hookState().data,
          items: [
            item({
              id: "kev:tomcat:CVE-2026-34486",
              sourceId: "kev",
              technologyId: "tomcat",
              technology: "Apache Tomcat",
              title: "Apache Tomcat path traversal",
              occurredAt: "2026-08-17T00:00:00.000Z",
              timePrecision: "day",
              exploited: true,
            }),
          ],
        },
      }),
    );
    // The source published a day, not an hour. Rendering a clock time on the
    // card would claim a precision the feed never had.
    //
    // Scoped to the card, NOT to the panel: the hour heading above it is
    // legitimately "00:00 - 01:00" when the viewer is in UTC, so a
    // panel-wide assertion here fails on CI and passes only in a
    // west-of-Greenwich zone.
    const [card] = cards();
    expect(card).toBeTruthy();
    expect(card.textContent).toContain("Reported on");
    expect(card.textContent).not.toMatch(/\d{2}:\d{2}/);
  });

  it("renders the item's category and severity, not only its prose", () => {
    render(hookState({ data: { ...hookState().data, items: [item({ severity: "critical" })] } }));
    const [card] = cards();
    expect(card.textContent.toLowerCase()).toContain("vulnerability");
    expect(card.textContent.toLowerCase()).toContain("critical");
  });
});

describe("support and decommission", () => {
  it("flags a version the user's own pages name that is out of support", () => {
    render(
      hookState({
        data: {
          ...hookState().data,
          lifecycle: [
            {
              technologyId: "react",
              technology: "React",
              cycle: "17",
              latest: "17.0.2",
              releasedAt: "2020-10-20",
              supportEndsAt: "2022-03-29",
              eolAt: null,
              state: "security-only",
              inUse: true,
            },
            {
              technologyId: "react",
              technology: "React",
              cycle: "19",
              latest: "19.2.8",
              releasedAt: "2024-12-05",
              supportEndsAt: null,
              eolAt: null,
              state: "supported",
              inUse: false,
            },
          ],
        },
      }),
    );
    expect(text()).toContain("React 17");
    // The flag has to survive a screen reader and a greyscale monitor.
    expect(text()).toMatch(/out of active support|no longer/i);
    expect(text()).toContain("2022");
    // Negative control: the supported row is passed in and must NOT be
    // flagged. Without this, an implementation that flags every lifecycle
    // row passes.
    expect(text()).not.toMatch(/React 19[\s\S]{0,120}out of active support/i);
  });

  it("says when an in-use version is about to lose support", () => {
    render(
      hookState({
        data: {
          ...hookState().data,
          lifecycle: [
            {
              technologyId: "nextjs",
              technology: "Next.js",
              cycle: "15",
              latest: "15.5.23",
              releasedAt: "2024-10-21",
              supportEndsAt: null,
              eolAt: "2026-10-21",
              state: "supported",
              inUse: true,
            },
          ],
        },
      }),
    );
    // Two months out. The timeline deliberately excludes it (it is not an
    // event in this hour), so if the support table stays silent the user
    // never hears about a decommission they have time to act on.
    expect(text()).toContain("Next.js 15");
    expect(text()).toMatch(/2026|days/);
  });
});

describe("grounded lifecycle for the gaps", () => {
  const gapSource = {
    id: "endoflife:typescript",
    label: "TypeScript lifecycle",
    technologyId: "typescript",
    ok: true,
    error: null,
    itemCount: 0,
    note: "no lifecycle feed",
  };

  it("marks an AI-sourced row as such, so it can never pass for a primary source", () => {
    // Every other number in this panel is quoted from a public feed. A
    // model-authored end-of-support date rendered in the same style would
    // make the most trustworthy section on screen the least.
    render(
      hookState({
        lifecycleGaps: { rows: [aiRow()], loading: false, error: "" },
        data: { ...hookState().data, sources: [gapSource] },
      }),
    );
    expect(text()).toContain("TypeScript 5.9");
    expect(text()).toMatch(/AI search|found by ai|ai-sourced/i);
  });

  it("shows the citation as a real link", () => {
    render(
      hookState({
        lifecycleGaps: { rows: [aiRow()], loading: false, error: "" },
        data: { ...hookState().data, sources: [gapSource] },
      }),
    );
    const link = container.querySelector('a[href^="https://devblogs.microsoft.com"]');
    expect(link).toBeTruthy();
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.textContent.trim().length).toBeGreaterThan(4);
  });

  it("replaces the gap line for a technology it managed to answer", () => {
    render(
      hookState({
        lifecycleGaps: { rows: [aiRow()], loading: false, error: "" },
        data: { ...hookState().data, sources: [gapSource] },
      }),
    );
    // Still saying "TypeScript: no lifecycle feed" beside a filled-in
    // TypeScript row contradicts itself on the same screen.
    expect(text()).not.toMatch(/TypeScript lifecycle: no lifecycle feed/);
  });

  it("keeps the gap line for a technology it could not answer", () => {
    const javaGap = { ...gapSource, id: "endoflife:java", label: "Java lifecycle", technologyId: "java" };
    render(
      hookState({
        lifecycleGaps: { rows: [aiRow()], loading: false, error: "" },
        data: { ...hookState().data, sources: [gapSource, javaGap] },
      }),
    );
    expect(text()).toContain("Java lifecycle: no lifecycle feed");
  });

  it("says the search is running rather than leaving a space that fills in silently", () => {
    render(
      hookState({
        lifecycleGaps: { rows: [], loading: true, error: "" },
        data: { ...hookState().data, sources: [gapSource] },
      }),
    );
    expect(text()).toMatch(/looking|searching|checking/i);
  });

  it("falls back to the honest gap line when the search fails", () => {
    render(
      hookState({
        lifecycleGaps: { rows: [], loading: false, error: "model unavailable" },
        data: { ...hookState().data, sources: [gapSource] },
      }),
    );
    // A failed top-up must leave chunk A's behaviour exactly as it was.
    expect(text()).toContain("TypeScript lifecycle: no lifecycle feed");
  });

  it("renders nothing extra when there are no gaps at all", () => {
    render(hookState());
    expect(text()).not.toMatch(/AI search|found by ai/i);
  });
});

describe("honesty about coverage", () => {
  it("names the sources it could not reach", () => {
    render(
      hookState({
        data: {
          ...hookState().data,
          sources: [
            { id: "osv:nextjs", label: "OSV Next.js", technologyId: "nextjs", ok: false, error: "503", itemCount: 0, note: null },
            { id: "statuspage:github", label: "GitHub status", technologyId: "github", ok: true, error: null, itemCount: 2, note: null },
          ],
        },
      }),
    );
    expect(text()).toContain("OSV Next.js");
    expect(text()).toMatch(/could not|unavailable|unreachable/i);
  });

  it("names a technology that has no lifecycle feed instead of implying all-clear", () => {
    render(
      hookState({
        data: {
          ...hookState().data,
          sources: [
            { id: "endoflife:typescript", label: "TypeScript lifecycle", technologyId: "typescript", ok: true, error: null, itemCount: 0, note: "no lifecycle feed" },
          ],
        },
      }),
    );
    expect(text()).toContain("TypeScript");
    expect(text()).toMatch(/no (public )?lifecycle feed/i);
  });

  it("does not file 'this feed does not exist' under 'we could not reach it'", () => {
    // Observed in the real rendered page: with both kinds present, the note
    // rows follow the "Sources we could not reach" heading with nothing
    // between them, so a reader going down the list sees three unreachable
    // sources. That collapses exactly the distinction the `note` field was
    // added to preserve - "TypeScript has no lifecycle feed" becomes
    // "we failed to reach TypeScript's lifecycle feed", which is a claim
    // about our reliability rather than a fact about TypeScript.
    render(
      hookState({
        data: {
          ...hookState().data,
          sources: [
            { id: "statuspage:supabase", label: "Supabase status page", technologyId: "supabase", ok: false, error: "503", itemCount: 0, note: null },
            { id: "endoflife:typescript", label: "TypeScript lifecycle", technologyId: "typescript", ok: true, error: null, itemCount: 0, note: "no lifecycle feed" },
          ],
        },
      }),
    );
    const t = text();
    expect(t).toContain("Supabase status page");
    expect(t).toContain("TypeScript lifecycle: no lifecycle feed");
    // A label of its own has to sit between the failure list and the note
    // list, or the note list inherits the heading above it.
    expect(t).toMatch(
      /could not reach[\s\S]*?(no feed|nothing published|not published|no data to publish)[\s\S]*?TypeScript lifecycle: no lifecycle feed/i,
    );
  });

  it("only claims a quiet window when every source actually answered", () => {
    render(
      hookState({
        data: {
          ...hookState().data,
          items: [],
          sources: [{ id: "osv:nextjs", label: "OSV Next.js", technologyId: "nextjs", ok: true, error: null, itemCount: 0, note: null }],
        },
      }),
    );
    expect(text()).toMatch(/nothing reported/i);

    render(
      hookState({
        data: {
          ...hookState().data,
          items: [],
          sources: [{ id: "osv:nextjs", label: "OSV Next.js", technologyId: "nextjs", ok: false, error: "503", itemCount: 0, note: null }],
        },
      }),
    );
    expect(text()).not.toMatch(/nothing reported/i);
  });

  it("keeps the last good briefing on screen when a refresh fails, and says so", () => {
    render(
      hookState({
        error: "Could not refresh the briefing.",
        data: { ...hookState().data, items: [item()] },
      }),
    );
    expect(text()).toContain("Next.js middleware bypass in App Router applications");
    expect(text()).toContain("Could not refresh the briefing.");
  });
});

describe("controls", () => {
  it("offers all three windows", () => {
    render(hookState());
    expect(text()).toMatch(/24 hours/i);
    expect(text()).toMatch(/3 days/i);
    expect(text()).toMatch(/7 days/i);
  });

  it("routes a window change through the hook rather than fetching on its own", () => {
    const setWindowHours = vi.fn();
    render(hookState({ setWindowHours }));
    const seven = buttonNamed("7 days");
    expect(seven).toBeTruthy();
    act(() => seven.click());
    // Rendering three inert labels satisfies the test above on its own; this
    // is what proves the control is wired to anything.
    expect(setWindowHours).toHaveBeenCalledWith(168);
  });

  it("keeps Refresh reachable while it is running, explaining why it is busy", () => {
    const reload = vi.fn();
    render(hookState({ loading: true, reload }));
    const refresh = buttonNamed("Refresh");
    expect(refresh).toBeTruthy();
    // A native `disabled` would drop the control out of the tab order at
    // exactly the moment its explanation appears.
    expect(refresh.hasAttribute("disabled")).toBe(false);
    expect(refresh.getAttribute("aria-disabled")).toBe("true");
    const describedBy = refresh.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(container.querySelector(`#${CSS.escape(describedBy)}`).textContent.trim().length).toBeGreaterThan(0);
  });

  it("announces an update through a polite live region", () => {
    render(hookState({ data: { ...hookState().data, items: [item()] } }));
    const live = status();
    expect(live).toBeTruthy();
    expect(live.getAttribute("aria-live")).toBe("polite");
    // A bare /1/ would pass against any region containing a timestamp, the
    // year 2026, or a count of 21.
    expect(live.textContent).toMatch(/\b1 item\b/);
  });

  it("keeps the visually-hidden live region one pixel, not a full-size overlay", () => {
    // In MUI's `sx`, a bare number is a MULTIPLIER, not pixels:
    // @mui/system/sizing/sizing.js does `value <= 1 && value !== 0 ?
    // `${value * 100}%` : value`. So `width: 1, height: 1` renders
    // 100% x 100%, and combined with `position: absolute` that is an overlay
    // covering the whole panel rather than the 1px sink this is meant to be.
    // ExperienceTab.js's own HIDDEN_STATUS_SX uses the "1px" STRINGS for
    // exactly this reason. Measured under jsdom: numeric -> "100%",
    // string -> "1px".
    render(hookState({ data: { ...hookState().data, items: [item()] } }));
    const live = status();
    const style = getComputedStyle(live);
    expect(style.width).toBe("1px");
    expect(style.height).toBe("1px");
  });

  it("announces two consecutive updates with identical counts distinguishably", () => {
    // React bails out of an unchanged setState, so a live region whose text
    // is byte-identical to what is already committed emits no DOM mutation
    // and the user hears nothing on every refresh after the first.
    const state = hookState({ data: { ...hookState().data, items: [item()] } });
    render(state);
    const first = status().textContent;
    render({ ...state, lastLoadedAt: "2026-08-17T15:31:00.000Z" });
    const second = status().textContent;
    expect(second).not.toBe(first);
  });
});

describe("the summary line", () => {
  it("counts by category and says how fresh the briefing is", () => {
    render(
      hookState({
        lastLoadedAt: "2026-08-17T15:25:00.000Z", // five minutes before `now`
        data: {
          ...hookState().data,
          items: [
            item({ id: "a", category: "outage" }),
            item({ id: "b", category: "vulnerability" }),
            item({ id: "c", category: "lifecycle" }),
          ],
        },
      }),
    );
    expect(text()).toMatch(/1 outage/i);
    expect(text()).toMatch(/as of/i);
    // formatRelative takes epoch MILLISECONDS. Handed a Date it computes NaN
    // and silently degrades to a bare locale date, forever - so assert the
    // relative form actually rendered.
    expect(text()).toMatch(/\b5m ago\b/);
  });

  it("pluralizes every count it prints", () => {
    render(
      hookState({
        data: {
          ...hookState().data,
          items: [
            item({ id: "v1", category: "vulnerability" }),
            item({ id: "v2", category: "vulnerability" }),
            item({ id: "l1", category: "lifecycle" }),
            item({ id: "l2", category: "lifecycle" }),
          ],
        },
      }),
    );
    // "5 vulnerability" reads as a typo in the middle of an otherwise
    // carefully-worded briefing, and it sits in the first line the user sees.
    expect(text()).not.toMatch(/\b2 vulnerability\b/);
    expect(text()).toMatch(/\b2 vulnerabilities\b/);
  });

  it("uses the singular for a count of one", () => {
    render(
      hookState({
        data: { ...hookState().data, items: [item({ id: "v1", category: "vulnerability" })] },
      }),
    );
    expect(text()).toMatch(/\b1 vulnerability\b/);
    expect(text()).not.toMatch(/\b1 vulnerabilities\b/);
  });

  it("counts exploited items separately when there are any", () => {
    render(
      hookState({
        data: { ...hookState().data, items: [item({ exploited: true, severity: "critical" })] },
      }),
    );
    expect(text()).toMatch(/1 (actively )?exploited/i);
  });
});

describe("stating what the briefing cannot cover", () => {
  it("says so when no source in the briefing publishes workarounds", () => {
    // Statuspage and CISA have no workaround field at all, and only about
    // half of OSV's advisories carry one. Rendering nothing leaves the user
    // to conclude no workaround exists, which is a different claim.
    render(hookState({ data: { ...hookState().data, items: [item({ workaround: "" })] } }));
    expect(text()).toMatch(/workaround/i);
    expect(text()).toMatch(/no source|not published|none of the sources/i);
  });

  it("does not say that when a workaround is present", () => {
    render(
      hookState({
        data: { ...hookState().data, items: [item({ workaround: "Enforce the check in the route." })] },
      }),
    );
    expect(text()).toContain("Enforce the check in the route.");
    expect(text()).not.toMatch(/no source|none of the sources/i);
  });

  it("says when the watchlist was truncated", () => {
    render(
      hookState({
        data: {
          ...hookState().data,
          watchlist: {
            entries: Array.from({ length: 12 }, (_, i) => ({
              id: `t${i}`,
              label: `Tech ${i}`,
              detectedIn: ["p1"],
              detectedVersions: [],
              hits: 1,
            })),
            usedDefaults: false,
            truncated: true,
          },
        },
      }),
    );
    // A user with thirty technologies is briefed on twelve; being told is the
    // difference between a partial briefing and a wrong one.
    expect(text()).toMatch(/12/);
    expect(text()).toMatch(/most|top|first|not all|only/i);
  });
});

describe("signed out", () => {
  it("renders nothing at all rather than an error the user cannot act on", () => {
    render(hookState({ signedOut: true, data: null }));
    expect(container.innerHTML).toBe("");
  });
});
