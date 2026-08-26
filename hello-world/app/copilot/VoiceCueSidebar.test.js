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
import { COMPANY_FACTS_CLAUSE } from "@/lib/copilot/practiceNotices";
import { SPEAKER_ATTRIBUTION, cueAvailabilityNotice, cueRowNote } from "@/lib/copilot/cuePolicy";

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

// AC-V2.6. The degraded-state disclosure: when the STT provider can't tell
// voices apart, hold still works from a spoken cue but release/company are
// button-only this session — and the user must be told that, in terms a
// screen reader can read, without needing the panel open. Every assertion
// here reads its expectation off lib/copilot/cuePolicy.js's own exports
// rather than hardcoding a sentence, for the same anti-drift reason that
// module exists at all (see its own header and VoiceCueSidebar.js's).
describe("VoiceCueSidebar -- degraded attribution disclosure (AC-V2.1/V2.6)", () => {
  it("says nothing extra by default (no prop passed), matching every non-degraded state", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps());
    expect(container.textContent).not.toMatch(/can't tell voices apart/i);
  });

  it("discloses the degraded state while expanded, when the provider can't tell voices apart", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps({ collapsed: false, speakerAttribution: SPEAKER_ATTRIBUTION.UNAVAILABLE }));
    expect(container.textContent).toContain(cueAvailabilityNotice(SPEAKER_ATTRIBUTION.UNAVAILABLE));
  });

  // The whole point of V2.6's "must not depend on the panel being open":
  // collapsed is the state a LIVE session is actually in, and a live session
  // is the only state any of this can matter in at all (mirrors BL-2's own
  // reasoning for the mic/delay note and the company destination notice).
  it("discloses the degraded state while COLLAPSED too, not only expanded (V2.6)", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps({ collapsed: true, speakerAttribution: SPEAKER_ATTRIBUTION.UNAVAILABLE }));
    // AC-V2.6.2: the COLLAPSED variant of the same policy sentence. This
    // assertion used to read the one-argument (expanded) wording, which
    // passed while the rail told a live session to use buttons it was not
    // rendering — see the C4 block below.
    expect(container.textContent).toContain(
      cueAvailabilityNotice(SPEAKER_ATTRIBUTION.UNAVAILABLE, { collapsed: true }),
    );
  });

  it("says nothing extra for a diarizing (active) session, expanded or collapsed", async () => {
    const Sidebar = await loadSidebar();
    for (const collapsed of [false, true]) {
      await render(Sidebar, baseProps({ collapsed, speakerAttribution: SPEAKER_ATTRIBUTION.ACTIVE }));
      expect(container.textContent).not.toMatch(/can't tell voices apart/i);
    }
  });

  it("marks the release and company rows, but not the hold row, when unavailable", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps({ collapsed: false, speakerAttribution: SPEAKER_ATTRIBUTION.UNAVAILABLE }));
    const pinNote = cueRowNote("pin", SPEAKER_ATTRIBUTION.UNAVAILABLE);
    const unpinNote = cueRowNote("unpin", SPEAKER_ATTRIBUTION.UNAVAILABLE);
    const companyNote = cueRowNote("company", SPEAKER_ATTRIBUTION.UNAVAILABLE);
    expect(pinNote).toBe("");
    expect(unpinNote.trim()).not.toBe("");
    expect(companyNote.trim()).not.toBe("");
    expect(container.textContent).toContain(unpinNote);
    expect(container.textContent).toContain(companyNote);
  });

  it("marks no row at all once attribution is active again", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps({ collapsed: false, speakerAttribution: SPEAKER_ATTRIBUTION.ACTIVE }));
    expect(container.textContent).not.toContain(cueRowNote("unpin", SPEAKER_ATTRIBUTION.UNAVAILABLE));
    expect(container.textContent).not.toContain(cueRowNote("company", SPEAKER_ATTRIBUTION.UNAVAILABLE));
  });

  // The degraded notice is prose, not a status token — the same requirement
  // cuePolicy.test.js pins on cueAvailabilityNotice directly.
  it("renders the degraded notice as a real sentence, not a bare status word", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps({ collapsed: false, speakerAttribution: SPEAKER_ATTRIBUTION.UNAVAILABLE }));
    expect(container.textContent).toMatch(/[.!]/);
  });

  // Never colour alone (AC-X2): the disclosure must be real text content a
  // screen reader reads, not a swatch or an icon-only marker.
  it("carries the degraded state as text, not merely as a style change", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps({ collapsed: false, speakerAttribution: SPEAKER_ATTRIBUTION.UNAVAILABLE }));
    const notice = [...container.querySelectorAll("p")].find((el) =>
      el.textContent.includes(cueAvailabilityNotice(SPEAKER_ATTRIBUTION.UNAVAILABLE)),
    );
    expect(notice).toBeDefined();
    expect(getComputedStyle(notice).display).not.toBe("none");
  });

  it("does not disturb the buttons' accessible names while degraded", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps({ collapsed: false, speakerAttribution: SPEAKER_ATTRIBUTION.UNAVAILABLE, pinned: true }));
    for (const el of buttons()) {
      expect(accessibleName(el)).toBe(el.textContent.trim());
    }
  });
});

// P1.7. The company-FACTS transfer (distinct from the company CUE above) fires
// on every drafted answer, mid-session, with nothing clicked. The surface that
// would otherwise carry that disclosure — `postingGroundingNotice`, rendered
// by SessionSetup — sits inside a `<Collapse in={expanded}>` that `start()`
// itself collapses, so for the entire live window it is out of the DOM while
// the transfer keeps firing. This rail is the surface that survives, which is
// the same reason BL-2 put `companyResearchDestination` in both of its
// branches, and the disclosure is asserted here in BOTH for that reason.
describe("VoiceCueSidebar -- the company-facts transfer, disclosed for the whole live window (P1.7)", () => {
  it("states it in the collapsed rail — the state a live session is actually in", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps({ collapsed: true, isEmbedded: false, hasCompany: true }));
    expect(container.textContent).toContain(COMPANY_FACTS_CLAUSE);
  });

  it("states it in the expanded rail too", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps({ collapsed: false, isEmbedded: false, hasCompany: true }));
    expect(container.textContent).toContain(COMPANY_FACTS_CLAUSE);
  });

  it("says none of it with no company on file — no search can fire", async () => {
    const Sidebar = await loadSidebar();
    for (const collapsed of [true, false]) {
      await render(Sidebar, baseProps({ collapsed, isEmbedded: false, hasCompany: false }));
      expect(container.textContent).not.toContain(COMPANY_FACTS_CLAUSE);
    }
  });

  it("says none of it on the embedded engine, which runs no facts search at all", async () => {
    const Sidebar = await loadSidebar();
    for (const collapsed of [true, false]) {
      await render(Sidebar, baseProps({ collapsed, isEmbedded: true, hasCompany: true }));
      expect(container.textContent).not.toContain(COMPANY_FACTS_CLAUSE);
    }
  });

  // Accessibility, the same two rules AC-X2/BL-2 already pin on the notices
  // beside it: the sentence is real text a screen reader reads, in a visible
  // element, and nothing about it is carried by colour.
  it("carries it as visible text, not as a style or an aria-hidden aside", async () => {
    const Sidebar = await loadSidebar();
    for (const collapsed of [true, false]) {
      await render(Sidebar, baseProps({ collapsed, isEmbedded: false, hasCompany: true }));
      const el = [...container.querySelectorAll("p")].find((node) =>
        node.textContent.includes(COMPANY_FACTS_CLAUSE),
      );
      expect(el).toBeDefined();
      expect(getComputedStyle(el).display).not.toBe("none");
      expect(el.closest("[aria-hidden='true']")).toBeNull();
    }
  });

  // It is the SHARED constant, not a fourth hand-written copy of the fact —
  // the component states nothing about the network on its own account (BL-1).
  it("reads the sentence from the shared module rather than restating it", async () => {
    expect(SOURCE).not.toMatch(/sends the company name and this job's title to Google Gemini with web search/);
    expect(SOURCE).toMatch(/answerCompanyFactsNotice/);
  });
});

// AC-V2.6.1 / C3 (accessibility audit). WCAG 1.3.1 Info and Relationships.
// The row's degraded-state note was real text on screen and, structurally,
// nothing at all: the row's `aria-labelledby` points only at the button, and
// the note was a positional sibling <p> with no programmatic relationship to
// the control it describes. A user tabbing the rail landed on "Release the
// question, button" with nothing announced to say that saying it does nothing
// this session — the note was reachable only by reading the rail
// sequentially, which is exactly the "visually adjacent, programmatically
// unrelated" pattern 1.3.1 exists to fail.
//
// aria-describedby, never aria-label: the description is announced AFTER the
// name and is separate from it, so amendment I4's "no aria-label anywhere in
// this file" invariant and WCAG 2.5.3 Label in Name both survive untouched.
// Those two assertions are restated at the foot of this block rather than
// merely relied on, because they are the exact thing the obvious wrong fix
// (folding the note into the button's name) would break.
describe("VoiceCueSidebar -- the degraded state reaches the control, not just the page (AC-V2.6.1)", () => {
  function describedText(el) {
    const ids = (el.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
    return ids
      .map((id) => container.querySelector(`#${CSS.escape(id)}`))
      .filter(Boolean)
      .map((n) => n.textContent.trim())
      .join(" ");
  }

  it("describes the release and company buttons with the policy's own row note", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps({ collapsed: false, speakerAttribution: SPEAKER_ATTRIBUTION.UNAVAILABLE }));
    for (const action of ["unpin", "company"]) {
      const button = buttonForAction(action);
      expect(button).toBeDefined();
      const note = cueRowNote(action, SPEAKER_ATTRIBUTION.UNAVAILABLE);
      expect(note.trim()).not.toBe("");
      // Not merely "has the attribute": it resolves to a real element in this
      // tree whose text is the shared module's own sentence. A dangling id
      // reference announces nothing at all and is invisible to a check that
      // only reads the attribute.
      expect(button.getAttribute("aria-describedby")).toBeTruthy();
      expect(describedText(button)).toBe(note.trim());
    }
  });

  it("leaves the hold button undescribed, because holding still works by voice", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps({ collapsed: false, speakerAttribution: SPEAKER_ATTRIBUTION.UNAVAILABLE }));
    expect(cueRowNote("pin", SPEAKER_ATTRIBUTION.UNAVAILABLE)).toBe("");
    expect(buttonForAction("pin").getAttribute("aria-describedby")).toBeNull();
  });

  it("describes nothing at all once attribution is active", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps({ collapsed: false, speakerAttribution: SPEAKER_ATTRIBUTION.ACTIVE }));
    for (const el of buttons()) {
      expect(el.getAttribute("aria-describedby")).toBeNull();
    }
  });

  it("changes no accessible name, and introduces no aria-label (I4 / WCAG 2.5.3)", async () => {
    const Sidebar = await loadSidebar();
    for (const pinned of [false, true]) {
      await render(
        Sidebar,
        baseProps({ collapsed: false, pinned, speakerAttribution: SPEAKER_ATTRIBUTION.UNAVAILABLE }),
      );
      expect([...container.querySelectorAll("[aria-label]")]).toHaveLength(0);
      for (const el of [...buttons(), ...links()]) {
        expect(accessibleName(el)).toBe(el.textContent.trim());
      }
    }
  });
});

// AC-V2.6.2 / C4 (accessibility audit). WCAG 3.3.2: the rail must not tell a
// user to press buttons that are not on screen. The collapsed rail renders
// exactly one button — the expand toggle, above this notice — so the
// expanded wording's "…from their buttons below" is false there, and
// collapsed is the state a live session is actually in. The wording split
// lives in lib/copilot/cuePolicy.js (cuePolicy.test.js pins the two strings
// themselves); what is asserted here is that this component asks for the
// right one, which no test of the pure module can see.
describe("VoiceCueSidebar -- the degraded notice matches the rail it is in (AC-V2.6.2)", () => {
  const EXPANDED = cueAvailabilityNotice(SPEAKER_ATTRIBUTION.UNAVAILABLE, { collapsed: false });
  const COLLAPSED = cueAvailabilityNotice(SPEAKER_ATTRIBUTION.UNAVAILABLE, { collapsed: true });

  it("uses the collapsed wording, and not the expanded one, while collapsed", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps({ collapsed: true, speakerAttribution: SPEAKER_ATTRIBUTION.UNAVAILABLE }));
    expect(container.textContent).toContain(COLLAPSED);
    expect(container.textContent).not.toContain(EXPANDED);
  });

  it("uses the expanded wording while expanded", async () => {
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps({ collapsed: false, speakerAttribution: SPEAKER_ATTRIBUTION.UNAVAILABLE }));
    expect(container.textContent).toContain(EXPANDED);
  });

  it("never promises buttons below in a rail that renders none", async () => {
    // Read off the DOM rather than off the string: the claim is about what is
    // actually on screen beneath the notice, and the collapsed rail's only
    // button is the toggle, which sits above it.
    const Sidebar = await loadSidebar();
    await render(Sidebar, baseProps({ collapsed: true, speakerAttribution: SPEAKER_ATTRIBUTION.UNAVAILABLE }));
    const notice = [...container.querySelectorAll("p")].find((el) => el.textContent.includes(COLLAPSED));
    expect(notice).toBeDefined();
    const after = [...container.querySelectorAll("button")].filter(
      (b) => notice.compareDocumentPosition(b) & window.Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(after).toHaveLength(0);
    expect(notice.textContent).not.toMatch(/buttons below/i);
  });
});

// AC-V2.8. The rail states the policy; it must state the policy that is
// actually in force, not the one the raw attribution flag implies.
//
// The session under test is the token-blip one: `speakerAttribution` reads
// "unavailable" because `diarizationActive` carries a deliberate
// `tokenFetchSucceeded` term (R-151), while the stream was still built with
// `diarize: true` and Deepgram fetched its own token — so speaker tags arrive,
// the correction bar works, and cuePolicy.js now permits the candidate's
// release and company cues. A rail that keeps saying "button only this
// session" in that session is telling the user something false about what
// their own product will do, which is the same class of defect as a privacy
// notice describing a transfer that does not happen.
describe("VoiceCueSidebar -- the disclosure follows the evidence, not the flag (AC-V2.8)", () => {
  const TAGS = { userTag: 1, confidence: "high", overridden: false, tags: [0, 1] };
  const NO_TAGS = { userTag: null, confidence: "unknown", overridden: false, tags: [] };

  for (const collapsed of [false, true]) {
    it(`drops the degraded notice once tags prove voices are separable (collapsed=${collapsed})`, async () => {
      const Sidebar = await loadSidebar();
      await render(
        Sidebar,
        baseProps({
          collapsed,
          speakerAttribution: SPEAKER_ATTRIBUTION.UNAVAILABLE,
          speakerSnapshot: TAGS,
        }),
      );
      expect(container.textContent).not.toMatch(/can't tell voices apart/i);
    });
  }

  it("stops calling release and company button-only in that session", async () => {
    const Sidebar = await loadSidebar();
    await render(
      Sidebar,
      baseProps({
        collapsed: false,
        speakerAttribution: SPEAKER_ATTRIBUTION.UNAVAILABLE,
        speakerSnapshot: TAGS,
      }),
    );
    expect(container.textContent).not.toMatch(/button only this session/i);
  });

  it("still says all of it when there is genuinely no evidence", async () => {
    // The negative control: without it every assertion above is satisfied by
    // deleting the disclosure, which is the harm AC-V2.6 exists to prevent.
    const Sidebar = await loadSidebar();
    await render(
      Sidebar,
      baseProps({
        collapsed: false,
        speakerAttribution: SPEAKER_ATTRIBUTION.UNAVAILABLE,
        speakerSnapshot: NO_TAGS,
      }),
    );
    expect(container.textContent).toContain(cueAvailabilityNotice(SPEAKER_ATTRIBUTION.UNAVAILABLE));
    expect(container.textContent).toContain(cueRowNote("unpin", SPEAKER_ATTRIBUTION.UNAVAILABLE));
  });

  it("treats an unwired snapshot prop as no evidence, never as evidence", async () => {
    // Backward compatibility that fails SAFE. Every older caller and mock in
    // this repo passes no snapshot at all; none of them may be promoted into
    // silence by omission.
    const Sidebar = await loadSidebar();
    await render(
      Sidebar,
      baseProps({ collapsed: false, speakerAttribution: SPEAKER_ATTRIBUTION.UNAVAILABLE }),
    );
    expect(container.textContent).toContain(cueAvailabilityNotice(SPEAKER_ATTRIBUTION.UNAVAILABLE));
  });

  it("never promotes a state that was not claiming unavailability", async () => {
    // Tags on a meeting session (attribution deliberately OFF) or on
    // tab/system must not change a single word of this rail.
    for (const speakerAttribution of [
      SPEAKER_ATTRIBUTION.ACTIVE,
      SPEAKER_ATTRIBUTION.OFF,
      SPEAKER_ATTRIBUTION.NOT_APPLICABLE,
      SPEAKER_ATTRIBUTION.PENDING,
    ]) {
      const Sidebar = await loadSidebar();
      await render(Sidebar, baseProps({ collapsed: false, speakerAttribution, speakerSnapshot: TAGS }));
      expect(container.textContent).not.toMatch(/can't tell voices apart/i);
      expect(container.textContent).not.toMatch(/button only this session/i);
    }
  });
});
