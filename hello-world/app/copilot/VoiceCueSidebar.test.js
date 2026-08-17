// @vitest-environment jsdom
//
// AC-T3.1..T3.7 (superseded in part by AC-group-T-amendment.md section I,
// and by the BL-1..BL-4/SF-1..SF-6 fixes below, adversarial mutation-harness
// review). Renders the real VoiceCueSidebar component with react-dom,
// following the worked jsdom examples in app/components/JobDescriptionTab.test.js
// and app/copilot/useCopilotDashboard.wiring.test.js. Accessible names are read
// the way a browser/screen reader would resolve them (aria-label,
// aria-labelledby, else visible text) — never by reading props off the
// component.
//
// The registry-driven test dynamically imports the component AFTER
// vi.doMock-ing lib/copilot/voiceCues, rather than statically importing it
// at module top, specifically so a test can swap in a fake registry and
// prove the component actually reads from the import rather than from a
// hand-written, hardcoded list of the three real cues.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { VOICE_CUES } from "@/lib/copilot/voiceCues";
import { companyResearchDestination } from "@/lib/copilot/groundingNotice";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SOURCE = readFileSync(path.join(process.cwd(), "app/copilot/VoiceCueSidebar.js"), "utf8");

let container;
let root;

beforeEach(() => {
  vi.resetModules();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.doUnmock("@/lib/copilot/voiceCues");
});

// Loads the component fresh, optionally with a fake VOICE_CUES registry
// swapped in via vi.doMock — the only way to tell "reads the registry" apart
// from "was hand-written to look like it does".
async function loadSidebar(customCues) {
  if (customCues) {
    vi.doMock("@/lib/copilot/voiceCues", () => ({ VOICE_CUES: customCues }));
  }
  const mod = await import("./VoiceCueSidebar.js");
  return mod.default;
}

async function render(Component, props) {
  await act(async () => {
    root.render(createElement(Component, props));
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

// The exact wording of a cue's `title` is voiceCues.js's own content, not
// this test file's concern (and it has already changed once during this
// review's own timeline) -- so tests that need "the pin cue's button" look
// it up from the real, live registry rather than hardcoding its current
// English.
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function titleForAction(action) {
  const cue = VOICE_CUES.find((c) => c.action === action);
  if (!cue) throw new Error(`No VOICE_CUES entry with action "${action}"`);
  return cue.title;
}

function buttonForAction(action) {
  return buttonNamed(new RegExp(`^${escapeRegExp(titleForAction(action))}$`));
}

async function click(el) {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function baseProps(overrides) {
  return {
    collapsed: false,
    onToggleCollapsed: vi.fn(),
    pinned: false,
    onActivate: vi.fn(),
    isEmbedded: false,
    hasCompany: false,
    ...overrides,
  };
}

describe("VoiceCueSidebar -- landmark and heading structure", () => {
  it("is a labelled region whose name comes from its own h3", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps());
    const region = container.querySelector('[role="region"]');
    expect(region).not.toBeNull();
    const labelledBy = region.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const heading = container.querySelector(`#${CSS.escape(labelledBy)}`);
    expect(heading.tagName).toBe("H3");
    expect(heading.textContent).toBe("Voice cues");
  });

  it("never uses MUI Drawer (no dialog/presentation role, no focus trap wrapper)", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps());
    // Drawer's temporary variant renders an aria-hidden backdrop and a
    // MuiModal-root wrapper; permanent/persistent still emit a
    // MuiDrawer-root class. None of that should be present here.
    expect(container.querySelector(".MuiDrawer-root")).toBeNull();
    expect(container.querySelector(".MuiModal-root")).toBeNull();
  });
});

describe("VoiceCueSidebar -- registry-driven rendering (AC-T3.1)", () => {
  it("renders one row (h4) per real VOICE_CUES entry, in order", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps());
    const headings = [...container.querySelectorAll("h4")].map((h) => h.textContent);
    expect(headings).toEqual(VOICE_CUES.map((c) => c.title));
  });

  it("would fail if the row list were hardcoded: a swapped-in fake registry changes what renders", async () => {
    const fakeCues = [
      { id: "fake-1", action: "pin", title: "Zzyzx cue one", summary: "First fake summary.", phrases: ["Say one", "Say two", "Say three"], patterns: [] },
      { id: "fake-2", action: "unpin", title: "Zzyzx cue two", summary: "Second fake summary.", phrases: ["Say four"], patterns: [] },
      { id: "fake-3", action: "company", title: "Zzyzx cue three", summary: "Third fake summary.", phrases: ["Say five"], patterns: [] },
      { id: "fake-4", action: "custom", title: "Zzyzx cue four", summary: "Fourth fake summary.", phrases: ["Say six"], patterns: [] },
    ];
    const Sidebar = await loadSidebar(fakeCues);
    await render(Sidebar, baseProps());
    const headings = [...container.querySelectorAll("h4")].map((h) => h.textContent);
    expect(headings).toEqual(fakeCues.map((c) => c.title));
    expect(headings).toHaveLength(4);
    // None of the REAL titles should appear -- a hardcoded component would
    // still show them regardless of what was imported.
    for (const realCue of VOICE_CUES) {
      expect(headings).not.toContain(realCue.title);
    }
  });

  it("renders every cue's phrases as a role=list, tolerating Safari's list-style:none semantics drop", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps());
    const lists = container.querySelectorAll('[role="list"]');
    // At least one per cue, plus the outer row list (SF-1).
    expect(lists.length).toBeGreaterThanOrEqual(VOICE_CUES.length + 1);
  });

  // SF-1 (adversarial review): the old test only asserted a lower bound on
  // role="list" count, which cannot fail while any three lists exist at
  // all -- it would stay green even if the OUTER row <ul> (list-style:none,
  // same Safari hazard the phrase lists already guard against) carried no
  // role="list" whatsoever, which was exactly the shipped state. Replaced
  // with a direct structural invariant: every <ul> this component renders
  // carries role="list".
  it("gives every <ul> it renders a role=list (SF-1)", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps());
    const uls = [...container.querySelectorAll("ul")];
    expect(uls.length).toBeGreaterThan(0);
    for (const ul of uls) {
      expect(ul.getAttribute("role")).toBe("list");
    }
  });

  // SF-2 (adversarial review): "Also say:" used to be a <span> sitting as a
  // direct, non-<li> child of a role="list" -- invalid list content. It now
  // lives outside the list entirely.
  it("keeps 'Also say:' out of the phrase <ul> (SF-2)", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps());
    for (const ul of container.querySelectorAll("ul")) {
      for (const child of ul.children) {
        expect(child.tagName).toBe("LI");
      }
    }
    expect(container.textContent).toMatch(/Also say:/);
  });

  // S21 (mutation harness survivor pattern): the outer row list's direct
  // children must actually be <li> elements -- a row rendered as a <div>
  // would leave the list with no listitem children at all, silently.
  it("gives the outer row list only <li> children", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps());
    const outerList = [...container.querySelectorAll('[role="list"]')].find(
      (ul) => ul.querySelectorAll("h4").length === VOICE_CUES.length,
    );
    expect(outerList).toBeDefined();
    expect(outerList.children.length).toBe(VOICE_CUES.length);
    for (const child of outerList.children) {
      expect(child.tagName).toBe("LI");
    }
  });

  // S07/S08 (mutation harness survivors): the phrase list used to have no
  // coverage at all for "renders more than zero, more than one phrase".
  // Real cues advertise more phrases than MAX_PHRASES (3), so every phrase
  // list should render exactly 3 items.
  it("renders more than one example phrase per cue, capped at 3 (S07/S08)", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps());
    const rows = [...container.querySelectorAll("li[aria-labelledby]")];
    expect(rows.length).toBe(VOICE_CUES.length);
    rows.forEach((row, i) => {
      const cue = VOICE_CUES[i];
      const phraseItems = row.querySelectorAll('[role="list"] li');
      const expectedCount = Math.min(3, cue.phrases.length);
      expect(expectedCount).toBeGreaterThan(1); // sanity: the real registry has >1 phrase per cue
      expect(phraseItems.length).toBe(expectedCount);
    });
  });

  // S10 (mutation harness survivor): the summary line had no coverage.
  it("renders each cue's summary text (S10)", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps());
    for (const cue of VOICE_CUES) {
      // The summary now renders WHOLE (the truncating helper is gone; see
      // VoiceCueSidebar.js's own comment for why a clipped sentence with an
      // ellipsis was the wrong fix). Assert the full string, not a prefix --
      // a prefix assertion is exactly what let the truncation ship.
      // Historical note, kept deliberately: assert a real prefix of
      // the registry's own text shows up, not an exact re-derivation of the
      // truncation rule (that would just duplicate the implementation).
      expect(container.textContent).toContain(cue.summary);
    }
  });
});

describe("VoiceCueSidebar -- accessible names (AC-X2, amendment I4, SF-3)", () => {
  it("gives every button a distinct, non-empty accessible name", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps());
    const names = buttons().map(accessibleName);
    expect(names.every((n) => n.length > 0)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  it("never gives a control an aria-label that differs from (or exists alongside) its visible text", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps({ pinned: true }));
    const labelled = [...container.querySelectorAll("[aria-label]")];
    // This component's whole design (amendment I4 / F96) is to carry no
    // aria-label at all on any of these controls, so the decorate-vs-match
    // question never even arises -- assert that invariant directly.
    expect(labelled).toHaveLength(0);
  });

  // SF-3 (adversarial review): the aria-label ban above cannot catch a
  // control named via aria-labelledby pointing at UNRELATED text (e.g. a
  // "Go" button whose accessible name comes from a sibling heading) -- a
  // textbook WCAG 2.5.3 Label in Name failure with zero aria-label anywhere.
  // Asserted directly, across every collapse state and pin state, this one
  // invariant subsumes the aria-label ban and catches that shape of bug too.
  it("resolves every button's and link's accessible name to its own trimmed visible text, in every state", async () => {
    const Sidebar = await loadSidebar();
    for (const props of [
      baseProps({ collapsed: false, pinned: false }),
      baseProps({ collapsed: false, pinned: true }),
      baseProps({ collapsed: true, pinned: false }),
      baseProps({ collapsed: true, pinned: true }),
    ]) {
      await render(Sidebar, props);
      for (const el of [...buttons(), ...links()]) {
        expect(accessibleName(el)).toBe(el.textContent.trim());
      }
    }
  });
});

describe("VoiceCueSidebar -- the hold control is one stable button (amendment I5)", () => {
  it("keeps the SAME accessible name whether pinned is false or true", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps({ pinned: false }));
    const holdOff = buttonForAction("pin");
    expect(holdOff).toBeDefined();
    const nameOff = accessibleName(holdOff);

    await render(Sidebar, baseProps({ pinned: true }));
    const holdOn = buttonForAction("pin");
    expect(holdOn).toBeDefined();
    expect(accessibleName(holdOn)).toBe(nameOff);
  });

  it("carries aria-pressed reflecting the pinned state, on the hold button only", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps({ pinned: false }));
    expect(buttonForAction("pin").getAttribute("aria-pressed")).toBe("false");

    await render(Sidebar, baseProps({ pinned: true }));
    expect(buttonForAction("pin").getAttribute("aria-pressed")).toBe("true");

    // The release button is a one-shot action, not a toggle -- it carries
    // no aria-pressed at all.
    expect(buttonForAction("unpin").hasAttribute("aria-pressed")).toBe(false);
  });

  it("shows a non-colour state carrier (text badge) alongside the pressed hold button", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps({ pinned: true }));
    expect(container.textContent).toMatch(/currently held/i);
  });

  // S11 (mutation harness survivor): only the PRESENCE of the badge was
  // ever asserted, never its absence -- a badge that renders on every row
  // regardless of pinned state stayed green.
  it("shows the 'Currently held' badge on no row at all when nothing is pinned (S11)", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps({ pinned: false }));
    expect(container.textContent).not.toMatch(/currently held/i);
  });
});

describe("VoiceCueSidebar -- one click performs the cue's action", () => {
  it("calls onActivate with the cue's action for each button", async () => {
    const Sidebar = await loadSidebar();
    const props = baseProps();
    await render(Sidebar, props);

    await click(buttonForAction("pin"));
    expect(props.onActivate).toHaveBeenLastCalledWith("pin");

    await click(buttonForAction("unpin"));
    expect(props.onActivate).toHaveBeenLastCalledWith("unpin");

    await click(buttonForAction("company"));
    expect(props.onActivate).toHaveBeenLastCalledWith("company");
  });
});

describe("VoiceCueSidebar -- collapse (AC-T3.5, amendment I3)", () => {
  it("renders full rows while not collapsed", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps({ collapsed: false }));
    expect(container.querySelectorAll("h4")).toHaveLength(VOICE_CUES.length);
  });

  it("renders a one-line summary and no cue rows while collapsed", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps({ collapsed: true }));
    expect(container.querySelectorAll("h4")).toHaveLength(0);
    expect(container.textContent).toMatch(/voice cues? available/i);
  });

  it("toggles via the expand/collapse control, which reports its state with aria-expanded", async () => {
    const Sidebar = await loadSidebar();
    const props = baseProps({ collapsed: true });
    await render(Sidebar, props);
    const toggle = buttonNamed(/show voice cues/i);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await click(toggle);
    expect(props.onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  // S14 (mutation harness survivor): the mic/delay/in-person note had no
  // coverage at all in the expanded state. Checked two ways on purpose: a
  // textContent match alone would stay green even if the note were hidden
  // via CSS (jsdom keeps hidden text in `textContent`) -- that is
  // literally how S14's own mutant hid it (an added `display: "none"`, text
  // node left in place) -- so this also asserts the element that carries
  // the text is not display:none.
  it("renders the full microphone/delay/in-person note while expanded, and it stays visible (S14)", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps({ collapsed: false }));
    expect(container.textContent).toMatch(/own microphone/i);
    expect(container.textContent).toMatch(/short delay/i);
    expect(container.textContent).toMatch(/in person/i);
    // MUI Typography's default variant renders a bare <p> with the text as
    // its only child -- queried alone (not mixed with ancestor <div>s, whose
    // aggregate textContent would also match and mask a hidden descendant).
    const note = [...container.querySelectorAll("p")].find((el) => /own microphone/i.test(el.textContent || ""));
    expect(note).toBeDefined();
    expect(getComputedStyle(note).display).not.toBe("none");
  });

  // BL-2 (adversarial review): the disclosure and the mic/delay note used
  // to live ONLY inside the expanded CueRow/footer -- exactly the state the
  // rail auto-collapses OUT of the instant a session goes live, which is
  // the only state a spoken cue can actually fire in. Both must render in
  // the collapsed branch too.
  it("renders a one-line mic/delay/in-person note while collapsed (BL-2)", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps({ collapsed: true }));
    expect(container.textContent).toMatch(/microphone/i);
    expect(container.textContent).toMatch(/short pause|delay/i);
    expect(container.textContent).toMatch(/in person/i);
  });

  it("renders the company-research destination disclosure while collapsed, when there is a company to research (BL-2)", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps({ collapsed: true, isEmbedded: false, hasCompany: true }));
    expect(container.textContent).toContain(companyResearchDestination({ isEmbedded: false, hasCompany: true }));
  });

  it("discloses nothing about the company cue while collapsed when there is no company to research", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps({ collapsed: true, isEmbedded: false, hasCompany: false }));
    expect(container.textContent).not.toMatch(/sends the company|searches the web for the company/i);
  });
});

describe("VoiceCueSidebar -- no aria-live region (S12, mutation harness survivor)", () => {
  it("never mounts an aria-live attribute, collapsed or expanded", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps({ collapsed: false }));
    expect(container.querySelector("[aria-live]")).toBeNull();
    await render(Sidebar, baseProps({ collapsed: true }));
    expect(container.querySelector("[aria-live]")).toBeNull();
  });
});

describe("VoiceCueSidebar -- company cue disclosure (amendment E4, BL-1, BL-2)", () => {
  it("states where a company lookup sends data, visible before the cue is ever spoken, derived from isEmbedded/hasCompany", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps({ isEmbedded: false, hasCompany: true }));
    expect(container.textContent).toContain(companyResearchDestination({ isEmbedded: false, hasCompany: true }));
    expect(container.textContent).toMatch(/sends the company name.*to google gemini/i);
  });

  it("names the embedded engine's honest, multi-provider destination, with no posting-text claim", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps({ isEmbedded: true, hasCompany: true }));
    expect(container.textContent).toContain(companyResearchDestination({ isEmbedded: true, hasCompany: true }));
    expect(container.textContent).toMatch(/brave, google or duckduckgo/i);
  });

  it("says nothing about a company destination when there is no company on file to research (BL-1)", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps({ isEmbedded: false, hasCompany: false }));
    expect(container.textContent).not.toMatch(/sends the company|searches the web for the company/i);
  });
});

// SF-6 (adversarial review): the rail's own vertical budget, and the
// row-heading-equals-button-text duplication that blew it. Structural
// proxies for both, since jsdom has no real layout engine to measure pixel
// heights against.
describe("VoiceCueSidebar -- vertical budget and row structure (SF-6)", () => {
  it("renders each row's title exactly once (the button IS the h4, not a sibling of it)", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps());
    for (const cue of VOICE_CUES) {
      const occurrences = [...container.querySelectorAll("h4, button")].filter(
        (el) => el.textContent.trim() === cue.title,
      );
      // The h4 and the button are the SAME element (button nested inside
      // h4), so querying both tags for the exact title string should find
      // it counted at most twice (once as "h4", once as "button", for one
      // physical node) -- never four matches from two separate elements.
      expect(occurrences.length).toBeLessThanOrEqual(2);
      const h4 = [...container.querySelectorAll("h4")].find((h) => h.textContent.trim() === cue.title);
      expect(h4.querySelector("button")).not.toBeNull();
    }
  });

  it("keeps row padding at the measured row size, not the card size (S23)", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps());
    const row = container.querySelector("li[aria-labelledby]");
    expect(getComputedStyle(row).paddingTop).toBe("10px"); // py: 1.25 * 8px
  });

  // S17/S18 (mutation harness survivors): the rail's own width/breakpoint
  // constants aren't reliably resolvable via getComputedStyle in jsdom
  // (MUI's responsive sx values compile to real @media rules, which jsdom's
  // layout-free CSSOM doesn't evaluate against a viewport), so this is
  // pinned at the source level -- the same literal the I1 comment documents
  // the arithmetic against.
  it("keeps the rail at 280px wide, stacking at md (900), not sm (600) (S17/S18)", () => {
    expect(SOURCE).toContain('const RAIL_SX = { width: { xs: "100%", md: 280 }, flexShrink: 0, minWidth: 0 };');
  });

  // S19/P18-equivalent: var(--text-muted) fails WCAG 1.4.3 at this app's
  // measured contrast (per the mutation-harness review); this file must
  // only ever use var(--text-secondary) for body copy.
  it("never uses var(--text-muted) (S19)", () => {
    expect(SOURCE).not.toContain("text-muted");
  });

  // S20: display:contents on a list drops its list semantics outright.
  it("never sets display: contents on any list (S20)", () => {
    expect(SOURCE).not.toMatch(/display:\s*["']contents["']/);
  });

  // S23: the row style must not be re-inflated into a bordered/rounded card
  // (the exact shape this component moved away from per I2/SF-6).
  it("keeps the row style free of card framing (borderRadius/minHeight) (S23)", () => {
    const rowSxMatch = SOURCE.match(/const ROW_SX = (\{[\s\S]*?\});/);
    expect(rowSxMatch).not.toBeNull();
    expect(rowSxMatch[1]).not.toMatch(/borderRadius/);
    expect(rowSxMatch[1]).not.toMatch(/minHeight/);
    expect(rowSxMatch[1]).toContain("borderBottom");
  });
});
