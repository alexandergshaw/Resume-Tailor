// @vitest-environment jsdom
//
// AC-T2.10..T2.14 (superseded in part by AC-group-T-amendment.md section
// I11, and by the BL-1/BL-3/BL-4/SF-4/SF-5 fixes below, adversarial
// mutation-harness review). Renders the real CompanyBriefPanel with
// react-dom -- see app/components/JobDescriptionTab.test.js for the worked
// pattern this follows. CompanyBriefPanel is purely presentational (every
// value a prop mirroring useCompanyBrief's return), so every state below is
// reached by passing props directly, with no hook or fetch involved.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import CompanyBriefPanel from "./CompanyBriefPanel.js";
import { companyResearchDestination } from "@/lib/copilot/groundingNotice";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SOURCE = readFileSync(path.join(process.cwd(), "app/copilot/CompanyBriefPanel.js"), "utf8");

let container;
let root;

const ARTICLES = [
  {
    id: "art-1",
    title: "Acme raises Series C",
    source: "TechCrunch",
    date: "2026-02-01",
    url: "https://example.com/acme-series-c",
    summary: "Acme raised $80M to expand its billing platform.",
    suggestion: "Ask how the raise changes the roadmap for your team.",
  },
  {
    id: "art-2",
    title: "Acme opens a new engineering hub",
    source: "Acme Newsroom",
    date: "2026-01-15",
    summary: "Acme is opening a new engineering hub in Austin.",
    suggestion: "Ask whether this role is tied to the new hub.",
  },
];

function baseProps(overrides) {
  return {
    status: "idle",
    articles: [],
    warnings: [],
    error: "",
    company: "Acme Corp",
    onRefresh: vi.fn(),
    onBack: vi.fn(),
    isEmbedded: false,
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
    root.render(createElement(CompanyBriefPanel, props));
  });
}

function accessibleName(el) {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria;
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => container.querySelector(`#${CSS.escape(id)}`))
      .filter(Boolean)
      .map((n) => n.textContent.trim())
      .join(" ");
    if (text) return text;
  }
  return el.textContent.trim();
}

function buttons() {
  return [...container.querySelectorAll("button")];
}

function links() {
  return [...container.querySelectorAll("a")];
}

function buttonNamed(pattern) {
  return buttons().find((b) => pattern.test(accessibleName(b)));
}

async function click(el) {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

describe("CompanyBriefPanel -- landmark structure", () => {
  it("is a labelled region whose name comes from its own h3", async () => {
    await render(baseProps());
    const region = container.querySelector('[role="region"]');
    expect(region).not.toBeNull();
    const labelledBy = region.getAttribute("aria-labelledby");
    const heading = container.querySelector(`#${CSS.escape(labelledBy)}`);
    expect(heading.tagName).toBe("H3");
    expect(heading.textContent).toContain("Acme Corp");
  });

  it("offers a back control rather than a second dismiss button (amendment I11)", async () => {
    const props = baseProps();
    await render(props);
    const back = buttonNamed(/back to voice cues/i);
    expect(back).toBeDefined();
    await click(back);
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });
});

describe("CompanyBriefPanel -- five distinct, non-empty states (AC-T2.11)", () => {
  it("idle, no company on file: states plainly that there is nothing to research yet", async () => {
    await render(baseProps({ status: "idle", company: "" }));
    expect(container.textContent).toMatch(/nothing to research/i);
    expect(container.querySelector(".MuiAlert-root")).toBeNull();
    expect(container.querySelectorAll('[data-testid^="brief-skeleton-"]')).toHaveLength(0);
  });

  // BL-4 (adversarial review): useCompanyBrief.js resets to idle on every
  // posting change, INCLUDING a change onto a posting with a perfectly good
  // company on file -- simply one no result has been fetched for yet. The
  // panel used to unconditionally claim "No company name is on file" in
  // this state too, directly under a heading reading "Company research:
  // Acme Corp" -- a demonstrable falsehood. It must prompt, not deny, when
  // `company` is present.
  it("idle with a company on file (posting just changed, no result loaded yet): prompts toward the action, does not deny the company exists (BL-4)", async () => {
    await render(baseProps({ status: "idle", company: "Acme Corp" }));
    expect(container.textContent).not.toMatch(/no company name is on file/i);
    expect(container.textContent).not.toMatch(/nothing to research/i);
    expect(container.textContent).toContain("Acme Corp");
    expect(container.textContent).toMatch(/refresh/i);
  });

  it("loading: renders three height-accurate skeleton cards and nothing else", async () => {
    await render(baseProps({ status: "loading" }));
    const skeletons = container.querySelectorAll('[data-testid^="brief-skeleton-"]');
    expect(skeletons).toHaveLength(3);
    expect(container.querySelector(".MuiAlert-root")).toBeNull();
    expect(container.textContent).not.toMatch(/nothing to research/i);
  });

  // P15 (mutation harness survivor): the skeletons render via MUI's
  // `Skeleton`, whose `width`/`height` props become REAL inline styles (not
  // sx classes) -- see node_modules/@mui/material/Skeleton/Skeleton.js,
  // which spreads `style: { width, height, ...style }` onto the root. That
  // makes "height-accurate" a directly checkable DOM invariant, not just a
  // visual claim.
  it("loading: skeletons stay height-accurate, mirroring ArticleCard's own rhythm (P15)", async () => {
    await render(baseProps({ status: "loading" }));
    const first = container.querySelector('[data-testid="brief-skeleton-0"]');
    const heights = [...first.querySelectorAll(".MuiSkeleton-root")].map((el) => el.style.height);
    expect(heights).toEqual(["22px", "16px", "16px", "16px", "16px"]);
  });

  it("done with articles: renders a card per article", async () => {
    await render(baseProps({ status: "done", articles: ARTICLES }));
    expect(container.querySelectorAll('[data-testid^="brief-skeleton-"]')).toHaveLength(0);
    expect(container.textContent).toContain("Acme raises Series C");
    expect(container.textContent).toContain("Acme opens a new engineering hub");
  });

  it("done with none: states plainly that nothing was found, distinct from idle's message", async () => {
    await render(baseProps({ status: "done", articles: [] }));
    expect(container.textContent).toMatch(/no recent coverage/i);
    expect(container.textContent).not.toMatch(/nothing to research/i);
  });

  it("error: renders role=alert with an inline Retry action, never plain coloured text", async () => {
    const props = baseProps({ status: "error", error: "Company research needs the Gemini API key." });
    await render(props);
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert.textContent).toContain("Company research needs the Gemini API key.");
    const retry = buttonNamed(/^retry$/i);
    expect(retry).toBeDefined();
    await click(retry);
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("all five states render mutually distinct, non-empty body content", async () => {
    const bodies = [];
    for (const overrides of [
      { status: "idle" },
      { status: "loading" },
      { status: "done", articles: ARTICLES },
      { status: "done", articles: [] },
      { status: "error", error: "boom" },
    ]) {
      await render(baseProps(overrides));
      expect(container.textContent.trim().length).toBeGreaterThan(0);
      bodies.push(container.textContent);
    }
    expect(new Set(bodies).size).toBe(bodies.length);
  });
});

describe("CompanyBriefPanel -- article links (AC-T2.12)", () => {
  it("uses the article title as the link text, never 'here' or the bare URL", async () => {
    await render(baseProps({ status: "done", articles: ARTICLES }));
    const link = [...container.querySelectorAll("a")].find((a) => a.href === ARTICLES[0].url);
    expect(link).toBeDefined();
    expect(link.textContent.trim()).toBe(ARTICLES[0].title);
    expect(link.textContent.trim().toLowerCase()).not.toBe("here");
  });

  it("carries target=_blank and rel=noopener noreferrer", async () => {
    await render(baseProps({ status: "done", articles: ARTICLES }));
    const link = [...container.querySelectorAll("a")].find((a) => a.href === ARTICLES[0].url);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("renders an article with no url as plain text, not a broken link", async () => {
    await render(baseProps({ status: "done", articles: ARTICLES }));
    const linkTexts = [...container.querySelectorAll("a")].map((a) => a.textContent.trim());
    expect(linkTexts).not.toContain(ARTICLES[1].title);
    expect(container.textContent).toContain(ARTICLES[1].title);
  });
});

describe("CompanyBriefPanel -- the suggestion (AC-T2.10, amendment I11)", () => {
  it("labels the suggestion 'Ask this', placed after the summary", async () => {
    await render(baseProps({ status: "done", articles: ARTICLES }));
    expect(container.textContent).toContain("Ask this");
    const summaryIndex = container.textContent.indexOf(ARTICLES[0].summary);
    const askIndex = container.textContent.indexOf("Ask this");
    const suggestionIndex = container.textContent.indexOf(ARTICLES[0].suggestion);
    expect(summaryIndex).toBeGreaterThan(-1);
    expect(askIndex).toBeGreaterThan(summaryIndex);
    expect(suggestionIndex).toBeGreaterThan(askIndex);
  });

  // SF-4/P17/P23 (mutation harness): the suggestion had no coverage beyond
  // the FIRST article. ARTICLES[1] has no `url` (already used above to
  // prove it renders as plain text, not a link) -- reused here to prove its
  // suggestion still renders too, which directly kills a mutant that
  // suppresses the suggestion for any article lacking a url (P17), and
  // renders both articles' suggestions to kill a mutant that only ever
  // shows the first (P23).
  it("renders a suggestion for every article, not just the first, including one with no url (SF-4/P17)", async () => {
    await render(baseProps({ status: "done", articles: ARTICLES }));
    expect(container.textContent).toContain(ARTICLES[0].suggestion);
    expect(container.textContent).toContain(ARTICLES[1].suggestion);
  });
});

describe("CompanyBriefPanel -- dates (AC-T2.10)", () => {
  it("wraps the date in <time> with both dateTime and title set to the absolute value", async () => {
    await render(baseProps({ status: "done", articles: ARTICLES }));
    const timeEls = [...container.querySelectorAll("time")];
    expect(timeEls).toHaveLength(2);
    expect(timeEls[0].getAttribute("dateTime")).toBe(ARTICLES[0].date);
    expect(timeEls[0].getAttribute("title")).toBe(ARTICLES[0].date);
    expect(timeEls[0].textContent).toBe(ARTICLES[0].date);
  });
});

describe("CompanyBriefPanel -- no aria-live region (amendment I8)", () => {
  it("never mounts an aria-live attribute, in any state", async () => {
    for (const overrides of [
      { status: "idle" },
      { status: "loading" },
      { status: "done", articles: ARTICLES },
      { status: "done", articles: [] },
      { status: "error", error: "boom" },
    ]) {
      await render(baseProps(overrides));
      expect(container.querySelector("[aria-live]")).toBeNull();
    }
  });
});

describe("CompanyBriefPanel -- accessible names (SF-3)", () => {
  it("gives every button a distinct, non-empty accessible name", async () => {
    await render(baseProps({ status: "error", error: "boom" }));
    const names = buttons().map(accessibleName);
    expect(names.every((n) => n.length > 0)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  it("carries no aria-label anywhere (visible text is the accessible name throughout)", async () => {
    await render(baseProps({ status: "done", articles: ARTICLES }));
    expect(container.querySelectorAll("[aria-label]")).toHaveLength(0);
  });

  // SF-3 (adversarial review): the aria-label ban alone cannot catch a
  // control named via aria-labelledby pointing at UNRELATED visible text
  // (e.g. a "Go" button whose name comes from the panel's own heading) --
  // asserted directly, across every status, so that shape of bug cannot
  // ship silently either.
  it("resolves every button's and link's accessible name to its own trimmed visible text, in every status", async () => {
    for (const overrides of [
      { status: "idle" },
      { status: "loading" },
      { status: "done", articles: ARTICLES },
      { status: "done", articles: [] },
      { status: "error", error: "boom" },
    ]) {
      await render(baseProps(overrides));
      for (const el of [...buttons(), ...links()]) {
        expect(accessibleName(el)).toBe(el.textContent.trim());
      }
    }
  });

  it("the Refresh control is disabled while a request is already loading", async () => {
    await render(baseProps({ status: "loading" }));
    expect(buttonNamed(/^refresh$/i).disabled).toBe(true);
  });
});

// BL-3 (adversarial review): this panel used to carry NO destination
// disclosure at all, though the acceptance criteria require one here too,
// derived exactly the way VoiceCueSidebar.js's is.
describe("CompanyBriefPanel -- company-research destination disclosure (BL-3)", () => {
  it("discloses the destination in every status, when there is a company on file", async () => {
    for (const overrides of [
      { status: "idle" },
      { status: "loading" },
      { status: "done", articles: ARTICLES },
      { status: "done", articles: [] },
      { status: "error", error: "boom" },
    ]) {
      await render(baseProps({ ...overrides, company: "Acme Corp", isEmbedded: false }));
      expect(container.textContent).toContain(companyResearchDestination({ isEmbedded: false, hasCompany: true }));
    }
  });

  it("names the embedded engine's honest, multi-provider destination, with no posting-text claim", async () => {
    await render(baseProps({ status: "idle", company: "Acme Corp", isEmbedded: true }));
    expect(container.textContent).toContain(companyResearchDestination({ isEmbedded: true, hasCompany: true }));
    expect(container.textContent).toMatch(/brave, google or duckduckgo/i);
  });

  it("says nothing about a destination when there is no company on file at all", async () => {
    await render(baseProps({ status: "idle", company: "", isEmbedded: false }));
    expect(container.textContent).not.toMatch(/sends the company|searches the web for the company/i);
  });
});

// SF-4 (adversarial review): `warnings` had no coverage at all.
describe("CompanyBriefPanel -- warnings (SF-4, P11)", () => {
  it("renders every warning it is given", async () => {
    await render(baseProps({ status: "done", articles: ARTICLES, warnings: ["Gathered by web search without AI."] }));
    expect(container.textContent).toContain("Gathered by web search without AI.");
  });

  // SF-5 (adversarial review): `warnings.length` with only an `= []`
  // default crashes on an explicit `warnings={null}` -- a default
  // parameter only fires for `undefined`, never for a passed `null`.
  it("does not crash when warnings is explicitly null (SF-5)", async () => {
    await expect(render(baseProps({ status: "done", articles: ARTICLES, warnings: null }))).resolves.not.toThrow();
    expect(container.textContent).toContain("Acme raises Series C");
  });
});

describe("CompanyBriefPanel -- source hygiene (mutation harness survivors)", () => {
  // S19/P18-equivalent: var(--text-muted) fails WCAG 1.4.3 at this app's
  // measured contrast (per the review); this file must only ever use
  // var(--text-secondary) for body copy.
  it("never uses var(--text-muted)", () => {
    expect(SOURCE).not.toContain("text-muted");
  });
});
