// @vitest-environment jsdom
//
// A per-file jsdom override (vitest.config.js stays `environment: "node"`),
// following app/components/JobDescriptionTab.test.js. These acceptance
// criteria ARE the markup -- which element is a heading, what a control is
// actually named, whether a source is legible without reading the database --
// so there is no pure function to extract them into.
//
// The card is deliberately presentational: props in, callbacks out, no state,
// no network.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { sourceProvenance } from "@/lib/feed/liveFeedClient";
import FeedPostingCard from "./FeedPostingCard.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

const POSTING = {
  id: "p1",
  title: "Senior React Engineer",
  company: "Acme",
  location: "Remote - US",
  remote_type: "remote",
  source: "greenhouse",
  url: "https://boards.greenhouse.io/acme/jobs/1",
  description_snippet: "Own features end to end.",
  salary_min: 180000,
  salary_max: 220000,
  posted_at: "2026-08-12T00:00:00.000Z",
};

function baseProps(overrides = {}) {
  return {
    posting: POSTING,
    busy: false,
    canTailor: true,
    currentUser: { id: "u1" },
    nowTs: Date.parse("2026-08-13T00:00:00.000Z"),
    onTailor: vi.fn(),
    onAutoFill: vi.fn(),
    onHide: vi.fn(),
    ...overrides,
  };
}

function render(props) {
  act(() => {
    root.render(createElement(FeedPostingCard, props));
  });
}

// A model of what an assistive technology actually resolves, rather than of
// one technique for supplying it. Two rules matter here and an earlier version
// of this helper got both wrong:
//
//   - `aria-labelledby` and `title` are valid ways to name a control. Accepting
//     only `aria-label` fails a correct implementation for no stated reason.
//   - The accessibility tree DROPS aria-hidden, [hidden] and display:none
//     subtrees, so a text fallback that keeps them accepts a name no screen
//     reader can reach. A button whose only label is a visually-hidden
//     aria-hidden span reads as named to a naive helper and as nothing at all
//     to a real user.
function accessibleName(el) {
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    return labelledBy
      .split(/\s+/)
      .map((id) => container.querySelector(`#${id}`)?.textContent || "")
      .join(" ")
      .trim();
  }
  const label = el.getAttribute("aria-label");
  if (label) return label.trim();

  const clone = el.cloneNode(true);
  for (const node of clone.querySelectorAll('[aria-hidden="true"], [hidden]')) node.remove();
  for (const node of [...clone.querySelectorAll("*")]) {
    if (node.style?.display === "none" || node.style?.visibility === "hidden") node.remove();
  }
  const text = (clone.textContent || "").trim();
  return text || (el.getAttribute("title") || "").trim();
}

const controls = () => [...container.querySelectorAll("button, a[href]")];
const named = (needle) =>
  controls().find((el) => accessibleName(el).toLowerCase().includes(needle));

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("FeedPostingCard - source is legible", () => {
  it("shows the human label for the source, never the stored value", () => {
    render(baseProps({ posting: { ...POSTING, source: "highered_rss" } }));
    const text = container.textContent;
    expect(text).not.toContain("highered_rss");
    expect(text).toContain("Higher");
  });

  it("shows the provenance sentence for ai_search, and for no other source", () => {
    // Tied to the exact string the helper owns. A looser regex was satisfied
    // by the words in the "Open posting" control, so a card rendering no
    // provenance at all passed.
    render(baseProps({ posting: { ...POSTING, source: "ai_search" } }));
    expect(container.textContent).not.toContain("ai_search");
    expect(container.textContent).toContain(sourceProvenance("ai_search"));

    render(baseProps({ posting: { ...POSTING, source: "greenhouse" } }));
    expect(container.textContent).not.toContain(sourceProvenance("ai_search"));
  });

  it("does not claim the AI-found job is still open or vetted for quality", () => {
    render(baseProps({ posting: { ...POSTING, source: "ai_search" } }));
    // Positive control first: without it a card rendering nothing passes.
    expect(container.textContent).toContain(sourceProvenance("ai_search"));
    expect(container.textContent.toLowerCase()).not.toMatch(
      /still open|currently open|guarantee|vetted|high.quality/,
    );
  });

  it("renders the remote type as a label rather than a raw enum", () => {
    render(baseProps({ posting: { ...POSTING, remote_type: "onsite", location: "Austin, TX" } }));
    expect(container.textContent).toContain("On-site");
    expect(container.textContent).not.toMatch(/\bonsite\b/);
  });
});

describe("FeedPostingCard - structure and naming", () => {
  it("gives the posting title a heading so the feed can be navigated by heading", () => {
    // TabHeader renders the tab's h2, so a card title is an h3. Before this it
    // was a bold Box: a screen-reader user had no way to move between
    // postings, and the feed read as one undifferentiated run of text.
    render(baseProps());
    const heading = container.querySelector("h3");
    expect(heading).toBeTruthy();
    expect(heading.textContent).toContain("Senior React Engineer");
  });

  it("renders as an article rather than a bare div", () => {
    render(baseProps());
    expect(container.querySelector("article")).toBeTruthy();
  });

  it("renders exactly the four controls the card is supposed to have", () => {
    // Pinning the COUNT alone let a mutant swap Auto Fill for a do-nothing
    // decoy and pass every naming assertion, so identity is pinned too.
    render(baseProps());
    expect(controls()).toHaveLength(4);
    for (const needle of ["open", "tailor", "auto fill", "hide"]) {
      expect(named(needle)).toBeTruthy();
    }
  });

  it("gives EVERY control a name a screen reader can actually reach", () => {
    // MUI's Tooltip labels its DIRECT child. Three of these buttons are
    // wrapped in a <span> so a disabled button can still show a tooltip --
    // which put the name on the span and left the button itself nameless.
    render(baseProps());
    for (const el of controls()) {
      expect(accessibleName(el)).not.toBe("");
    }
  });

  it("names each control for THIS posting, so a list of them is distinguishable", () => {
    // Forty cards previously produced forty controls all named "Hide".
    render(baseProps());
    for (const el of controls()) {
      expect(accessibleName(el)).toContain("Senior React Engineer");
    }
  });

  it("keeps names distinct within a single card", () => {
    render(baseProps());
    const names = controls().map(accessibleName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps each visible control label inside its accessible name", () => {
    // WCAG 2.5.3. A voice-control user says the words they can see, so an
    // aria-label that contradicts the visible label makes the control
    // unreachable by voice even though it is perfectly named for a reader.
    render(baseProps());
    for (const el of controls()) {
      const visible = (el.textContent || "").trim();
      if (!visible) continue; // icon-only controls have no visible label
      expect(accessibleName(el).toLowerCase()).toContain(visible.toLowerCase());
    }
  });

  it("still names its controls when they are disabled", () => {
    // The disabled state is exactly when the <span> wrapper exists, so this is
    // the case the wrapper defect actually broke.
    render(baseProps({ currentUser: null, canTailor: false }));
    for (const el of controls()) {
      expect(accessibleName(el)).not.toBe("");
    }
  });
});

describe("FeedPostingCard - everything the card already showed, it still shows", () => {
  it("shows the company, the location, and the description snippet", () => {
    render(baseProps());
    expect(container.textContent).toContain("Acme");
    expect(container.textContent).toContain("Remote - US");
    expect(container.textContent).toContain("Own features end to end.");
  });

  it("shows how long ago the posting went up, measured against nowTs", () => {
    render(baseProps());
    expect(container.textContent).toContain("1d ago");
  });

  it("labels the salary and remote chips in text, never colour alone", () => {
    render(baseProps());
    expect(container.textContent).toContain("$180k");
    expect(container.textContent).toContain("$220k");
    expect(container.textContent).toContain("Remote");
  });

  it("renders the PARSED salary when the columns are empty, not an echo of the snippet", () => {
    // Pre-existing behaviour that must survive the extraction: older feed rows
    // predate the salary columns. Asserting on the digits alone was satisfied
    // by the snippet those digits came from, which is also on the card --
    // so this asserts formatSalary's own rendering instead.
    render(
      baseProps({
        posting: {
          ...POSTING,
          salary_min: null,
          salary_max: null,
          description_snippet: "Compensation: $150,000 - $170,000 per year.",
        },
      }),
    );
    expect(container.textContent).toContain("$150k");
    expect(container.textContent).toContain("$170k");
  });
});

describe("FeedPostingCard - behaviour", () => {
  it("wires each control to its OWN handler", () => {
    const props = baseProps();
    render(props);

    act(() => named("hide").click());
    expect(props.onHide).toHaveBeenCalledWith(POSTING);

    act(() => named("tailor").click());
    expect(props.onTailor).toHaveBeenCalledWith(POSTING);

    act(() => named("auto fill").click());
    expect(props.onAutoFill).toHaveBeenCalledWith(POSTING);
    // Auto Fill and Hide sit next to each other and take the same argument, so
    // a crossed wire produces no visible symptom.
    expect(props.onHide).toHaveBeenCalledTimes(1);
  });

  it("disables tailoring when there is no resume to tailor", () => {
    render(baseProps({ canTailor: false }));
    expect(named("tailor").disabled).toBe(true);
  });

  it("leaves the posting link genuinely usable when signed out", () => {
    render(baseProps({ currentUser: null }));
    const link = container.querySelector("a[href]");
    expect(link.getAttribute("href")).toBe(POSTING.url);
    // MUI keeps `href` on a disabled anchor and signals the disabled state
    // with aria-disabled, tabindex="-1" and a Mui-disabled class carrying
    // pointer-events:none, so asserting the href alone proves nothing.
    expect(link.getAttribute("aria-disabled")).not.toBe("true");
    expect(link.getAttribute("tabindex")).not.toBe("-1");
    expect(link.className).not.toMatch(/Mui-disabled/);

    for (const button of container.querySelectorAll("button")) {
      expect(button.disabled).toBe(true);
    }
  });

  it("disables every action while the card is busy, and fires nothing if clicked", () => {
    const props = baseProps({ busy: true });
    render(props);
    for (const button of container.querySelectorAll("button")) {
      expect(button.disabled).toBe(true);
      act(() => button.click());
    }
    expect(props.onTailor).not.toHaveBeenCalled();
    expect(props.onAutoFill).not.toHaveBeenCalled();
    expect(props.onHide).not.toHaveBeenCalled();
  });
});
