// @vitest-environment jsdom
//
// TDD RED hand-off -- N43, part 1 of 2: a company-sourced fact in the prep
// pack is CITED AND LINKED. This file owns the two states that produce
// on-screen citation apparatus (cited, and cited-but-unsafe-URL), the href
// discipline, the accessible names, and per-section numbering. Its sibling
// `PrepPackPanel.citationStates.test.js` owns the states that produce NO
// apparatus (legitimately uncited, legacy, arrived-but-not-placed), the
// one-marker-per-stage rule and the explicit-margin class guard.
//
// Binds to <scratchpad>/chunks/N43/ac.r1.md (AC-N43.1/.2/.3/.7/.8/.10) and is
// specified by <scratchpad>/chunks/N43/design-experience.r1.md ss1, ss2 rows
// 1 and 4, ss4, ss6.
//
// ---------------------------------------------------------------------------
// WHY EVERY BLOCK BELOW IS RED ON HEAD
// ---------------------------------------------------------------------------
// `PrepPackPanel.js` renders NO citation data at all today. `AnswerSection`
// reads only `line?.text` (:130), `AskThemSection` only `question?.text`
// (:145), `StagesSection` only `stage.name` / `stage.questions` (:160-167).
// There is no `href` anywhere in the file, so there is no anchor, no marker,
// no source list and no accessible name to compute. Each `it` below asserts
// the POSITIVE artefact first (a marker exists, a link exists, a numbered
// entry exists) and only then constrains it, so no case in this file can pass
// by finding nothing and then looping over nothing.
//
// ---------------------------------------------------------------------------
// THE ONE STRUCTURAL CONTRACT THIS FILE PINS, AND WHY IT IS NOT AN INVENTION
// ---------------------------------------------------------------------------
// A citation marker is an element carrying `data-citation-marker="{n}"`.
// That attribute is NOT new: `DigestPanel.js:550` already renders exactly
// `data-citation-marker={String(entry.n)}` on its own marker anchors, and
// `DigestPanel.js:147`'s `a:not([data-citation-marker])` selector already
// depends on it. N43's own binding instruction is to reuse the DigestPanel
// precedent rather than invent a second one, so this file reuses its hook
// too, including the convention that the attribute's VALUE is the citation
// number. The unsafe-URL marker (a `<span>`, never an `<a>`) carries the same
// attribute so it is findable at all -- an unfindable marker is an
// untestable one.
//
// Everything else this file locates, it locates the way a reader or a screen
// reader would: by accessible name, by heading structure, by visible text.
//
// ---------------------------------------------------------------------------
// WHAT THIS FILE DELIBERATELY DOES NOT PIN
// ---------------------------------------------------------------------------
// design-experience.r1.md ss9 gates three decisions on an owner SQL
// measurement that has not run: the exact wording of the pack-level
// "arrived but not placed" sentence, the DEPTH of the per-item note beside an
// unsafe URL, and whether cross-section duplication earns a cross-reference
// annotation. Nothing below asserts any of that copy. The unsafe state is
// tested for its MEANING -- the claim is still shown, it is inert, and
// something beyond the bare claim text is said about it -- never for the
// draft string "(source link unavailable)".
//
// ---------------------------------------------------------------------------
// WHAT CANNOT BE ASSERTED HERE, STATED RATHER THAN FAKED
// ---------------------------------------------------------------------------
//   * Rendered geometry. jsdom has no layout, so MARKER_SX's 24x24 WCAG 2.5.8
//     floor and its measured `marginBlock: -6px` line-height compensation are
//     NOT measured here. `scrollWidth`/`getBoundingClientRect` are useless in
//     this environment.
//   * Whether CSS `::before`/`::after` bracket glyphs actually paint. jsdom
//     does not render generated content, so this file reads the marker's
//     NUMBER (from its text and from its attribute) and never asserts the
//     brackets are visible.
//   * Whether a browser's focus ring is actually painted on `:focus-visible`.
//     What is asserted is the DOM precondition for tab order (an element is
//     focusable iff it is a link with an href, a form control, or carries a
//     non-negative tabindex), never a real focus traversal.
//   * Colour contrast of anything.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { safeExternalHref } from "@/lib/url/safeExternalHref.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SPECIFIER = "./PrepPackPanel.js";
let modPromise;
function load() {
  if (!modPromise) modPromise = import(SPECIFIER);
  return modPromise;
}

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(props) {
  const mod = await load();
  const PrepPackPanel = mod.default;
  await act(async () => {
    root.render(createElement(PrepPackPanel, props));
  });
  return container;
}

/** Renders a local element tree into the same harness. Used ONLY by the
 *  instrument canaries, never as a stand-in for the component under test. */
async function renderFixture(element) {
  await act(async () => {
    root.render(element);
  });
  return container;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
// `PrepPackPanel.js:81-86`'s SECTION_LABELS, restated as literals rather than
// imported: adding an export purely so a test can reach something is
// forbidden here and would move lib/sourceScan/exportReachability.sweep.test.js.
const SECTION_LABELS = {
  aboutYou: "Tell me about yourself",
  whyRole: "Why this role",
  askThem: "Questions to ask them",
  stages: "Interview stages",
};
const ALL_SECTIONS = ["aboutYou", "whyRole", "askThem", "stages"];

// Four claims with DISTINCT, non-overlapping text, so an assertion that finds
// one can never be satisfied by another. Every sourceUrl below passes
// safeExternalHref (asserted in the canary block, not assumed).
const CLAIM_A = {
  id: "claim-a",
  text: "Acme opened a Dublin engineering hub in March 2026.",
  sourceUrl: "https://newsroom.example.com/acme/dublin-hub",
};
const CLAIM_B = {
  id: "claim-b",
  text: "Acme moved its platform team to a weekly release train.",
  sourceUrl: "https://press.example.org/acme/release-train",
};
const CLAIM_C = {
  id: "claim-c",
  text: "Acme reported eighteen percent revenue growth in its Q3 filing.",
  sourceUrl: "https://investors.example.net/acme/q3-filing",
};

// The fifth state design-experience.r1.md ss2 row 4 exists for: `isCitedClaim`
// (prepParse.js:333-345) checks only that `sourceUrl` is a non-empty, trimmed,
// non-redirect STRING. It never calls `new URL()`, never checks the protocol
// and never checks credentials -- so each of these reaches the client already
// "cited" and still fails safeExternalHref. Four different rules, so a build
// that hard-codes one refusal cannot pass the whole set.
// Each string is DISTINCTIVE -- none of them is a substring of any safe
// fixture URL -- which is what makes the attribute-leak scan below a sound
// substring test rather than a false-positive generator. That property is
// asserted in the canary block, not assumed. (`"https://"` is the canonical
// empty-hostname refusal and is canaried separately for exactly this reason:
// it IS a prefix of every safe URL here, so scanning for it would report a
// leak on a perfectly good link.)
const UNSAFE_SOURCE_URLS = {
  scheme: "javascript:alert(document.domain)",
  credentials: "https://newsroom.example.com@evil.example/acme",
  untrimmed: "  https://newsroom.example.com/acme/padded  ",
  unparseable: "acme-quarterly-filing/not-a-url",
};
const EMPTY_HOSTNAME_URL = "https://";
const CLAIM_UNSAFE = {
  id: "claim-unsafe",
  text: "Acme named accessibility a 2026 engineering priority.",
  sourceUrl: UNSAFE_SOURCE_URLS.scheme,
};

function cite(claim) {
  return { kind: "claim", claimId: claim.id };
}

function pack({ aboutYou = [], whyRole = [], askThem = [], stages = [], claims = [], ...rest } = {}) {
  return {
    version: 1,
    sections: {
      aboutYou: { answer: { lines: aboutYou } },
      whyRole: { answer: { lines: whyRole } },
      askThem: { questions: askThem },
      stages: { stages },
    },
    claims,
    ...rest,
  };
}

function stage({ name, questions = [], recommendedAnswer = null, support = null }) {
  return { name, questions, recommendedAnswer, support };
}

function baseProps(overrides = {}) {
  return {
    applicationId: "app-1",
    pack: null,
    status: "ready",
    completeSections: ALL_SECTIONS,
    attemptsExhausted: false,
    candidateName: null,
    interviewerNames: [],
    error: null,
    onDownloadLog: vi.fn(),
    onSaveNames: vi.fn(),
    generating: false,
    triggerMessage: null,
    onGenerateNow: vi.fn(),
    hasDescription: true,
    ...overrides,
  };
}

/** The workhorse fixture. Every section carries at least one resolved
 *  citation, numbering must restart in each, and CLAIM_A/CLAIM_B are each
 *  cited from two different sections so cross-section independence is
 *  exercised rather than assumed. */
function citedPack() {
  return pack({
    claims: [CLAIM_A, CLAIM_B, CLAIM_C],
    aboutYou: [
      { text: "I led the migration of a twelve-service platform.", support: cite(CLAIM_A) },
      { text: "I mentor two junior engineers each quarter.", support: null },
    ],
    whyRole: [{ text: "The release cadence here matches how I like to work.", support: cite(CLAIM_B) }],
    askThem: [
      { text: "How does the platform team decide what ships weekly?", support: cite(CLAIM_B) },
      { text: "What changed for the team after the Q3 results?", support: cite(CLAIM_C) },
      { text: "What does success look like in the first ninety days?", support: null },
    ],
    stages: [
      stage({
        name: "Hiring manager screen",
        questions: [
          "Walk me through your last platform migration.",
          "How do you handle a release that has to be rolled back?",
          "What would you want to change in your first month?",
        ],
        recommendedAnswer: "Lead with the twelve-service migration and the rollback you owned.",
        support: cite(CLAIM_A),
      }),
      stage({
        name: "Panel interview",
        questions: ["Tell us about a disagreement with a peer."],
        recommendedAnswer: null,
        support: null,
      }),
    ],
  });
}

// ---------------------------------------------------------------------------
// Instruments. Every one is canaried below against a local fixture with a
// KNOWN answer, because a resolver that silently returns "" or [] would make
// every assertion in this file pass for the wrong reason.
// ---------------------------------------------------------------------------

const HEADING_SELECTOR = 'h1,h2,h3,h4,h5,h6,[role="heading"]';
const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"];

/** Visible text of a subtree, with `aria-hidden="true"`, `display:none` and
 *  `visibility:hidden` subtrees excluded. Same shape as
 *  PrepPackPanel.sectionHeaders.test.js:181 -- this repo's one accessible-name
 *  resolution, reused rather than forked. */
function visibleText(node) {
  if (node.nodeType === 3) return node.nodeValue || "";
  if (node.nodeType !== 1) return "";
  if (node.getAttribute("aria-hidden") === "true") return "";
  const view = node.ownerDocument.defaultView;
  const style = view.getComputedStyle(node);
  if (style.display === "none" || style.visibility === "hidden") return "";
  let out = "";
  for (const child of node.childNodes) out += visibleText(child);
  return out;
}

function norm(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

/** The element's ACCESSIBLE NAME: `aria-labelledby` wins over `aria-label`,
 *  which wins over visible content. Identical to
 *  PrepPackPanel.sectionHeaders.test.js:199. */
function accessibleName(el) {
  const labelledby = el.getAttribute("aria-labelledby");
  if (labelledby && labelledby.trim()) {
    return norm(
      labelledby
        .trim()
        .split(/\s+/)
        .map((id) => {
          const target = el.ownerDocument.getElementById(id);
          return target ? visibleText(target) : "";
        })
        .join(" ")
    );
  }
  const label = el.getAttribute("aria-label");
  if (label != null && label.trim()) return label.trim();
  return norm(visibleText(el));
}

function headingElements(el) {
  return [...el.querySelectorAll(HEADING_SELECTOR)].filter((node) => {
    if (node.getAttribute("aria-hidden") === "true") return false;
    const role = (node.getAttribute("role") || "").trim();
    if (role) return role.split(/\s+/)[0] === "heading";
    return HEADING_TAGS.includes(node.tagName.toLowerCase());
  });
}

/** Every citation marker, in DOM order. See this file's header for why
 *  `data-citation-marker` is the hook. */
function markers(el) {
  return [...el.querySelectorAll("[data-citation-marker]")];
}

/** A marker's number, read TWICE from two independent places: the attribute
 *  value DigestPanel's own precedent carries, and the digits in the marker's
 *  visible text. They must agree -- a build whose attribute and glyph
 *  disagree is showing the reader a different number from the one it
 *  believes it rendered. Returns null when they disagree, so a caller's
 *  `toEqual([1, 2])` fails loudly instead of silently taking one of them. */
function markerNumber(marker) {
  const fromAttr = (marker.getAttribute("data-citation-marker") || "").trim();
  const fromText = norm(visibleText(marker)).replace(/[^\d]/g, "");
  if (!/^\d+$/.test(fromAttr)) return null;
  if (fromText !== fromAttr) return null;
  return Number(fromAttr);
}

/** Is this element in the tab order? An anchor counts only WITH an href --
 *  which is exactly the distinction the unsafe-URL state turns on. */
function isFocusable(node) {
  const tag = node.tagName.toLowerCase();
  if (node.hasAttribute("disabled")) return false;
  const tabindex = (node.getAttribute("tabindex") || "").trim();
  if (/^-?\d+$/.test(tabindex)) return Number(tabindex) >= 0;
  if (tag === "a" || tag === "area") return node.hasAttribute("href");
  return ["button", "input", "select", "textarea", "summary"].includes(tag);
}

/** Every element in the subtree carrying an `href` ATTRIBUTE -- read off the
 *  DOM, never off the source text, so a value React let through is caught
 *  whatever expression produced it. */
function hrefElements(el) {
  return [...el.querySelectorAll("[href]")];
}

/** The section's own per-section source list: the `<ol>` beside the
 *  sub-heading named "Sources for {section label}".
 *
 *  STRUCTURAL ASSUMPTION, stated because it is one (same discipline as
 *  PrepPackPanel.sectionHeaders.test.js:241): design-experience.r1.md ss1 puts
 *  the sub-heading and the list as siblings inside one wrapper Box. A build
 *  that changes that nesting makes these assertions fail LOUDLY rather than
 *  pass silently.
 *
 *  The heading string itself is specified in ss1 (it reuses SECTION_LABELS
 *  verbatim so the section is spelled once) and is NOT one of the three
 *  copy decisions ss9 gates on the owner's measurement. */
function sourceHeadingFor(el, section) {
  const want = `Sources for ${SECTION_LABELS[section]}`;
  return headingElements(el).find((node) => accessibleName(node) === want) || null;
}
function sourceListFor(el, section) {
  const heading = sourceHeadingFor(el, section);
  if (!heading || !heading.parentElement) return null;
  return heading.parentElement.querySelector("ol");
}
function sourceListItems(el, section) {
  const list = sourceListFor(el, section);
  return list ? [...list.children].filter((child) => child.tagName.toLowerCase() === "li") : [];
}

/** The markers that belong to one section: those inside the wrapper the
 *  section's own `<h3>` lives in, EXCLUDING anything inside that section's
 *  source list (list numbering comes from the `<ol>`, not from markers). */
function sectionRoot(el, section) {
  const heading = headingElements(el).find((node) => accessibleName(node) === SECTION_LABELS[section]);
  return heading ? heading.parentElement : null;
}
function sectionMarkers(el, section) {
  const scope = sectionRoot(el, section);
  if (!scope) return [];
  const list = sourceListFor(el, section);
  return markers(scope).filter((marker) => !(list && list.contains(marker)));
}

/** The nearest ancestor of `node` whose normalized visible text is exactly
 *  `want`. Used to prove a marker is attached to ONE piece of content rather
 *  than floating in the section: if an ancestor's WHOLE visible text is the
 *  line plus the marker's own digits, that ancestor can contain nothing else. */
function ancestorWhoseTextIs(node, want) {
  const target = norm(want);
  let cursor = node.parentElement;
  while (cursor) {
    if (norm(visibleText(cursor)) === target) return cursor;
    cursor = cursor.parentElement;
  }
  return null;
}

// ---------------------------------------------------------------------------

describe("INSTRUMENT CANARIES -- these prove the helpers discriminate; they are NOT N43 coverage and they pass on HEAD", () => {
  it("accessibleName prefers aria-label over content and drops aria-hidden subtrees", async () => {
    const el = await renderFixture(
      createElement(
        "div",
        null,
        createElement("h4", { "aria-label": "Named by label" }, "ignored content"),
        createElement("h4", null, "Named by content", createElement("span", { "aria-hidden": "true" }, " HIDDEN"))
      )
    );
    const found = headingElements(el).map(accessibleName);
    expect(found).toEqual(["Named by label", "Named by content"]);
  });

  it("markerNumber agrees with both readings and returns null when the attribute and the glyph disagree", async () => {
    const el = await renderFixture(
      createElement(
        "div",
        null,
        createElement("a", { href: "https://ok.example.com/a", "data-citation-marker": "1" }, "1"),
        createElement("span", { "data-citation-marker": "2" }, "2"),
        createElement("span", { "data-citation-marker": "3" }, "9")
      )
    );
    expect(markers(el)).toHaveLength(3);
    expect(markers(el).map(markerNumber)).toEqual([1, 2, null]);
  });

  it("isFocusable separates an anchor WITH an href from one without, and honours tabindex", async () => {
    const el = await renderFixture(
      createElement(
        "div",
        null,
        createElement("a", { id: "with", href: "https://ok.example.com/a" }, "linked"),
        createElement("a", { id: "without" }, "inert"),
        createElement("span", { id: "neg", tabIndex: -1 }, "skipped"),
        createElement("span", { id: "pos", tabIndex: 0 }, "reachable"),
        createElement("span", { id: "plain" }, "plain")
      )
    );
    const by = (id) => el.querySelector(`#${id}`);
    expect([by("with"), by("without"), by("neg"), by("pos"), by("plain")].map(isFocusable)).toEqual([
      true,
      false,
      false,
      true,
      false,
    ]);
  });

  it("hrefElements reads the attribute off the DOM, including one React let through", async () => {
    const el = await renderFixture(
      createElement(
        "div",
        null,
        createElement("a", { href: "https://ok.example.com/a" }, "safe"),
        createElement("a", { href: "data:text/html,<b>x</b>" }, "unsafe but rendered")
      )
    );
    expect(hrefElements(el).map((node) => node.getAttribute("href"))).toEqual([
      "https://ok.example.com/a",
      "data:text/html,<b>x</b>",
    ]);
  });

  it("the fixture URLs are what this file claims they are -- three safe, five refused, each for its own rule", () => {
    for (const claim of [CLAIM_A, CLAIM_B, CLAIM_C]) {
      expect(safeExternalHref(claim.sourceUrl), `${claim.id} must be linkable`).toBe(claim.sourceUrl);
    }
    for (const [rule, url] of Object.entries({ ...UNSAFE_SOURCE_URLS, emptyHostname: EMPTY_HOSTNAME_URL })) {
      expect(safeExternalHref(url), `${rule} must be refused`).toBe(null);
      // ...and each is nevertheless a non-empty, non-redirect string, i.e.
      // exactly what isCitedClaim lets past on its way to the client.
      expect(typeof url).toBe("string");
      expect(url.trim().length).toBeGreaterThan(0);
      expect(url).not.toMatch(/vertexaisearch\.cloud\.google\.com/i);
    }
  });

  it("the leak scan's substring test is SOUND: no refused fixture is contained in any safe fixture URL", () => {
    // Without this, a refused string that happened to be a prefix of a good
    // URL (as "https://" is) would make the scan report a leak on a link
    // that is perfectly correct -- a false alarm that teaches an implementer
    // to distrust the instrument.
    for (const [rule, url] of Object.entries(UNSAFE_SOURCE_URLS)) {
      for (const claim of [CLAIM_A, CLAIM_B, CLAIM_C]) {
        expect(claim.sourceUrl.includes(url.trim()), `${rule} is not distinctive enough to scan for`).toBe(false);
      }
    }
    // ...and the canonical counter-example, kept out of the scan for that
    // very reason.
    expect(CLAIM_A.sourceUrl.includes(EMPTY_HOSTNAME_URL)).toBe(true);
  });

  it("sourceListFor finds nothing when no such heading exists, so a missing list cannot read as an empty one", async () => {
    const el = await renderFixture(createElement("div", null, createElement("h4", null, "Something else")));
    expect(sourceListFor(el, "aboutYou")).toBe(null);
    expect(sourceListItems(el, "aboutYou")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-N43.1 / .2 / .3 -- the cited state renders a marker AND a list entry
// ---------------------------------------------------------------------------

describe("N43 state 1 (cited): a resolved support renders a linked marker and its own section list entry", () => {
  it("an aboutYou line with a resolved support gets a marker; the uncited line beside it gets none", async () => {
    const el = await render(baseProps({ pack: citedPack() }));
    const found = sectionMarkers(el, "aboutYou");
    expect(found, "AC-N43.1: the cited aboutYou line must carry exactly one marker").toHaveLength(1);

    // The marker belongs to the CITED line, not merely to the section: its
    // nearest ancestor whose visible text is "line text + number" is the line.
    const marker = found[0];
    const n = markerNumber(marker);
    expect(n).toBe(1);
    const owner = ancestorWhoseTextIs(marker, `I led the migration of a twelve-service platform.${n}`);
    expect(owner, "the marker must sit inside the cited line's own box").not.toBe(null);

    // The over-fire control, in the same render: the uncited sibling line is
    // present and carries nothing citation-shaped.
    const uncited = [...el.querySelectorAll("*")].filter(
      (node) => norm(visibleText(node)) === "I mentor two junior engineers each quarter."
    );
    expect(uncited.length, "the uncited line must still render").toBeGreaterThan(0);
    for (const node of uncited) expect(markers(node)).toHaveLength(0);
  });

  it("the cited line's marker is a real link to the claim's own sourceUrl, opened safely", async () => {
    const el = await render(baseProps({ pack: citedPack() }));
    const marker = sectionMarkers(el, "aboutYou")[0];
    expect(marker, "AC-N43.1: no marker rendered at all").toBeTruthy();
    expect(marker.tagName.toLowerCase(), "a cited marker is an anchor, not a span").toBe("a");
    expect(marker.getAttribute("href")).toBe(CLAIM_A.sourceUrl);
    expect(marker.getAttribute("target")).toBe("_blank");
    const rel = (marker.getAttribute("rel") || "").split(/\s+/);
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
    expect(isFocusable(marker), "a working citation must be reachable by keyboard").toBe(true);
  });

  it("each askThem question is cited independently -- two questions, two different numbers, not one shared marker", async () => {
    const el = await render(baseProps({ pack: citedPack() }));
    const found = sectionMarkers(el, "askThem");
    expect(found, "AC-N43.2: two cited questions must produce two markers").toHaveLength(2);
    expect(found.map(markerNumber)).toEqual([1, 2]);
    expect(found[0].getAttribute("href")).toBe(CLAIM_B.sourceUrl);
    expect(found[1].getAttribute("href")).toBe(CLAIM_C.sourceUrl);

    // Each marker is inside its OWN <li>, and the uncited third question's
    // <li> has none -- the under-fire and over-fire controls together.
    const items = [...(sectionRoot(el, "askThem")?.querySelectorAll("li") || [])].filter(
      (li) => !sourceListFor(el, "askThem")?.contains(li)
    );
    expect(items.length, "the three question <li>s must still render").toBe(3);
    expect(items.map((li) => markers(li).length)).toEqual([1, 1, 0]);
  });

  it("the section's own numbered source list carries one entry per marker, in the same order, linked", async () => {
    const el = await render(baseProps({ pack: citedPack() }));
    const list = sourceListFor(el, "askThem");
    expect(list, "AC-N43.1: the askThem section must render its own source list").toBeTruthy();
    expect(list.tagName.toLowerCase(), "the numbers come from an ordered list").toBe("ol");

    const items = sourceListItems(el, "askThem");
    expect(items).toHaveLength(2);
    expect(norm(visibleText(items[0]))).toContain(CLAIM_B.text);
    expect(norm(visibleText(items[1]))).toContain(CLAIM_C.text);

    const links = items.map((li) => li.querySelector("a"));
    expect(links.map((a) => a && a.getAttribute("href"))).toEqual([CLAIM_B.sourceUrl, CLAIM_C.sourceUrl]);
  });

  it("a section with no resolved citation renders NO source list at all -- the list is gated, not empty", async () => {
    const el = await render(
      baseProps({
        pack: pack({
          claims: [CLAIM_A],
          aboutYou: [{ text: "I led the migration of a twelve-service platform.", support: cite(CLAIM_A) }],
          whyRole: [{ text: "The pace here suits me.", support: null }],
        }),
      })
    );
    // Under-fire control first: the cited section DOES have its list, so a
    // build that renders no lists anywhere cannot pass this case.
    expect(sourceListFor(el, "aboutYou"), "the cited section must have a list").toBeTruthy();
    expect(sourceHeadingFor(el, "whyRole"), "an uncited section must not announce sources").toBe(null);
    expect(sourceListFor(el, "whyRole")).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// AC-N43.6 (a11y half) -- the accessible names
// ---------------------------------------------------------------------------

describe("N43 accessibility: a marker's accessible name is the source, never a bare bracketed digit", () => {
  it("a cited marker is named `Source {n}: {claim.text}`, overriding its decorative digits", async () => {
    const el = await render(baseProps({ pack: citedPack() }));
    const marker = sectionMarkers(el, "aboutYou")[0];
    expect(marker, "no marker rendered").toBeTruthy();

    // The visible content is the digits (DigestPanel.js:553's own convention:
    // the brackets are CSS generated content, so textContent is the number).
    expect(norm(visibleText(marker))).toBe("1");
    // ...and the NAME a screen reader announces is not that.
    expect(accessibleName(marker)).toBe(`Source 1: ${CLAIM_A.text}`);
    expect(accessibleName(marker)).not.toMatch(/^\[?\d+\]?$/);
  });

  it("every marker names the claim its OWN href points at -- a misattributed name is caught, not a duplicate one", async () => {
    // Under per-section numbering two markers in DIFFERENT sections may
    // legitimately share both a number and a name (the same claim cited
    // twice), so uniqueness is NOT the property to test. Misattribution is:
    // the name must be derived from the same claim the destination is.
    const el = await render(baseProps({ pack: citedPack() }));
    const all = markers(el).filter((marker) => ALL_SECTIONS.some((s) => sectionMarkers(el, s).includes(marker)));
    expect(all.length, "five cited items: aboutYou 1, whyRole 1, askThem 2, stages 1").toBe(5);

    const byUrl = new Map([CLAIM_A, CLAIM_B, CLAIM_C].map((claim) => [claim.sourceUrl, claim]));
    for (const marker of all) {
      const claim = byUrl.get(marker.getAttribute("href"));
      expect(claim, `a marker linked somewhere this pack never claimed: ${marker.getAttribute("href")}`).toBeTruthy();
      const name = accessibleName(marker);
      expect(name, "a bare number is never an accessible name").not.toMatch(/^\[?\d+\]?$/);
      expect(name).toBe(`Source ${markerNumber(marker)}: ${claim.text}`);
    }
  });

  it("no MUI Tooltip supplies the name -- any hover text is a native `title`, which never replaces the name", async () => {
    // [[mui-a11y-traps]]: a MUI Tooltip steals a control's accessible name.
    // The design forbids one here. The DOM signature of a MUI tooltip on a
    // control is `aria-describedby` pointing at an injected popper, so the
    // check is that the marker's name comes from its own aria-label and that
    // nothing describes it from outside this container.
    const el = await render(baseProps({ pack: citedPack() }));
    const marker = sectionMarkers(el, "aboutYou")[0];
    expect(marker, "no marker rendered").toBeTruthy();
    expect(marker.getAttribute("aria-label")).toBe(`Source 1: ${CLAIM_A.text}`);
    const described = marker.getAttribute("aria-describedby");
    if (described) {
      for (const id of described.trim().split(/\s+/)) {
        expect(document.getElementById(id), `aria-describedby -> ${id} must not be a popper`).toBe(null);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// AC-N43.10 -- per-section numbering
// ---------------------------------------------------------------------------

describe("N43 numbering is per-section: it restarts in each section and never leaks across them", () => {
  it("each of the four sections numbers from 1 independently", async () => {
    const el = await render(baseProps({ pack: citedPack() }));
    const perSection = Object.fromEntries(
      ALL_SECTIONS.map((section) => [section, sectionMarkers(el, section).map(markerNumber)])
    );
    // Under-fire control: assert the population BEFORE the numbering, so a
    // build that renders nothing cannot satisfy "numbers restart".
    expect(perSection).toEqual({ aboutYou: [1], whyRole: [1], askThem: [1, 2], stages: [1] });
  });

  it("the same claim cited from two different sections is numbered independently in each", async () => {
    const el = await render(baseProps({ pack: citedPack() }));
    // CLAIM_A is cited by the aboutYou line AND by the first stage. Both are
    // the first citation in their own section, so both read 1 -- independently
    // assigned, not shared state.
    const aboutMarker = sectionMarkers(el, "aboutYou")[0];
    const stageMarker = sectionMarkers(el, "stages")[0];
    expect(aboutMarker && stageMarker, "both sections must be cited").toBeTruthy();
    expect(aboutMarker.getAttribute("href")).toBe(CLAIM_A.sourceUrl);
    expect(stageMarker.getAttribute("href")).toBe(CLAIM_A.sourceUrl);
    expect(markerNumber(aboutMarker)).toBe(1);
    expect(markerNumber(stageMarker)).toBe(1);

    // CLAIM_B is cited in whyRole (its section's first, so 1) and in askThem
    // (also its section's first, so 1). A GLOBAL counter would make the
    // second one 2 or 3 -- this is the assertion that kills global numbering.
    expect(markerNumber(sectionMarkers(el, "whyRole")[0])).toBe(1);
    expect(markerNumber(sectionMarkers(el, "askThem")[0])).toBe(1);

    // Each section's own list carries exactly the claims that section cites,
    // never a neighbour's.
    expect(sourceListItems(el, "whyRole").map((li) => norm(visibleText(li)))).toHaveLength(1);
    expect(norm(visibleText(sourceListItems(el, "whyRole")[0]))).toContain(CLAIM_B.text);
    expect(norm(visibleText(sourceListFor(el, "whyRole")))).not.toContain(CLAIM_A.text);
    expect(norm(visibleText(sourceListFor(el, "whyRole")))).not.toContain(CLAIM_C.text);
  });

  it("two lines in the SAME section citing one claim share one number and one list entry", async () => {
    const el = await render(
      baseProps({
        pack: pack({
          claims: [CLAIM_A, CLAIM_B],
          aboutYou: [
            { text: "First line about the Dublin hub.", support: cite(CLAIM_A) },
            { text: "Second line about the same hub.", support: cite(CLAIM_A) },
            { text: "A line about the release train.", support: cite(CLAIM_B) },
          ],
        }),
      })
    );
    const found = sectionMarkers(el, "aboutYou");
    expect(found, "three cited lines must each carry a marker").toHaveLength(3);
    // AC-N43.10's dedup key is the claim id, exact match: the two CLAIM_A
    // lines share number 1, and CLAIM_B is 2, not 3.
    expect(found.map(markerNumber)).toEqual([1, 1, 2]);
    const items = sourceListItems(el, "aboutYou");
    expect(items, "one entry per DISTINCT claim, not one per citing line").toHaveLength(2);
    expect(norm(visibleText(items[0]))).toContain(CLAIM_A.text);
    expect(norm(visibleText(items[1]))).toContain(CLAIM_B.text);
  });
});

// ---------------------------------------------------------------------------
// AC-N43.7(b) -- CITED BUT UNSAFE URL. The state most likely to be got wrong.
// ---------------------------------------------------------------------------

describe("N43 state 4 (cited but unsafe URL): the claim is shown, INERT, and no href ever reaches the DOM", () => {
  /** One cited-and-safe claim plus one cited-and-unsafe claim, in the same
   *  section, so every case below carries its own over-fire control: the safe
   *  one must still link. */
  function mixedPack(unsafeUrl) {
    return pack({
      claims: [CLAIM_A, { ...CLAIM_UNSAFE, sourceUrl: unsafeUrl }],
      aboutYou: [
        { text: "A line whose source is linkable.", support: cite(CLAIM_A) },
        { text: "A line whose source is not linkable.", support: cite(CLAIM_UNSAFE) },
      ],
    });
  }

  it("renders a marker for the unsafe claim -- it is NOT silently folded into the uncited state", async () => {
    const el = await render(baseProps({ pack: mixedPack(UNSAFE_SOURCE_URLS.scheme) }));
    const found = sectionMarkers(el, "aboutYou");
    expect(found, "AC-N43.7(b): a cited-but-unsafe claim still made a claim; dropping it misrepresents the pack").toHaveLength(2);
    expect(found.map(markerNumber)).toEqual([1, 2]);
  });

  it("the unsafe marker is a span with NO href attribute and is not in the tab order", async () => {
    const el = await render(baseProps({ pack: mixedPack(UNSAFE_SOURCE_URLS.scheme) }));
    const [safeMarker, unsafeMarker] = sectionMarkers(el, "aboutYou");
    expect(unsafeMarker, "no unsafe marker rendered").toBeTruthy();

    // The over-fire control, same render: the SAFE marker is still a link.
    expect(safeMarker.tagName.toLowerCase()).toBe("a");
    expect(isFocusable(safeMarker)).toBe(true);

    expect(unsafeMarker.tagName.toLowerCase(), "never an anchor -- an href-less <a> stub is also forbidden").toBe("span");
    expect(unsafeMarker.hasAttribute("href"), "no href attribute may reach the DOM for a refused URL").toBe(false);
    expect(unsafeMarker.getAttribute("role")).not.toBe("link");
    expect(unsafeMarker.getAttribute("role")).not.toBe("button");
    expect(isFocusable(unsafeMarker), "a broken-looking focus stop is worse than a silent one").toBe(false);
    expect(unsafeMarker.querySelectorAll("[href]"), "and nothing inside it links either").toHaveLength(0);
  });

  it("for each of the four rules safeExternalHref refuses, the refused string appears in NO href and NO attribute value", async () => {
    for (const [rule, url] of Object.entries(UNSAFE_SOURCE_URLS)) {
      await render(baseProps({ pack: mixedPack(url) }));
      const el = container;
      // Under-fire control FIRST: this case cannot pass by rendering nothing.
      expect(sectionMarkers(el, "aboutYou").length, `${rule}: both markers must render`).toBe(2);

      const trimmed = url.trim();
      for (const node of [...el.querySelectorAll("*")]) {
        for (const attr of [...node.attributes]) {
          expect(
            attr.value.includes(trimmed),
            `${rule}: the refused URL leaked into ${node.tagName.toLowerCase()}[${attr.name}]`
          ).toBe(false);
        }
      }
      // ...and no href-shaped fallback was invented in its place.
      const hrefs = hrefElements(el).map((node) => node.getAttribute("href"));
      expect(hrefs, `${rule}: href="" and href="#" are both forbidden`).not.toContain("");
      expect(hrefs).not.toContain("#");
    }
  });

  it("the unsafe claim still appears in the section's source list, as inert text carrying more than the bare claim", async () => {
    const el = await render(baseProps({ pack: mixedPack(UNSAFE_SOURCE_URLS.credentials) }));
    const items = sourceListItems(el, "aboutYou");
    expect(items, "both claims get an entry; only one of them is a link").toHaveLength(2);

    // Over-fire control: the safe entry IS a link.
    expect(items[0].querySelector("a[href]")).toBeTruthy();

    const unsafeItem = items[1];
    expect(norm(visibleText(unsafeItem)), "the claim itself is still shown").toContain(CLAIM_UNSAFE.text);
    expect(unsafeItem.querySelectorAll("[href]"), "and it is not clickable").toHaveLength(0);
    expect([...unsafeItem.querySelectorAll("*")].some(isFocusable)).toBe(false);
    // MEANING, not wording: something beyond the bare claim text is said, so
    // the reader is not left wondering why this one is not a link. ss9 gates
    // HOW MUCH is said, so the exact sentence is deliberately not pinned.
    expect(norm(visibleText(unsafeItem))).not.toBe(norm(CLAIM_UNSAFE.text));
    expect(norm(visibleText(unsafeItem)).length).toBeGreaterThan(norm(CLAIM_UNSAFE.text).length);
  });

  it("the unsafe marker carries a real accessible name, never a bare bracketed digit", async () => {
    const el = await render(baseProps({ pack: mixedPack(UNSAFE_SOURCE_URLS.unparseable) }));
    const unsafeMarker = sectionMarkers(el, "aboutYou")[1];
    expect(unsafeMarker, "no unsafe marker rendered").toBeTruthy();
    const name = accessibleName(unsafeMarker);
    expect(name, "a screen reader must not meet a naked digit mid-sentence").not.toMatch(/^\[?\d+\]?$/);
    expect(name.length).toBeGreaterThan(3);
    expect(name).toContain("2");
    // It must not be dressed as a working source the way a cited marker is.
    expect(name).not.toBe(`Source 2: ${CLAIM_UNSAFE.text}`);
  });
});

// ---------------------------------------------------------------------------
// AC-N43.7 / .8 -- the href rule, as BEHAVIOUR over the rendered DOM
// ---------------------------------------------------------------------------

describe("N43 href discipline: every href this panel renders is one safeExternalHref would return verbatim", () => {
  it("holds as a CLASS GUARD over every href in a richly cited pack", async () => {
    const el = await render(baseProps({ pack: citedPack() }));
    const hrefs = hrefElements(el);
    // Under-fire control: a panel that renders no anchors passes any
    // "every anchor is safe" rule vacuously, so the population is asserted
    // first. Four markers plus four source-list anchors.
    expect(hrefs.length, "the cited pack must actually produce links").toBeGreaterThanOrEqual(8);
    for (const node of hrefs) {
      const raw = node.getAttribute("href");
      expect(safeExternalHref(raw), `href="${raw}" is not a value the gate would return`).toBe(raw);
    }
    // WHAT THIS GUARD CANNOT CATCH, stated: it proves no href is UNSAFE. It
    // cannot prove an href points at the RIGHT claim -- the per-claim
    // assertions above are what do that, and both instruments are kept.
  });

  it("holds when every claim in the pack is unsafe: zero anchors, and the markers still render", async () => {
    const el = await render(
      baseProps({
        pack: pack({
          claims: [
            { ...CLAIM_UNSAFE, id: "u1", sourceUrl: UNSAFE_SOURCE_URLS.scheme },
            { ...CLAIM_B, id: "u2", sourceUrl: UNSAFE_SOURCE_URLS.credentials },
          ],
          aboutYou: [{ text: "First unsafe line.", support: { kind: "claim", claimId: "u1" } }],
          whyRole: [{ text: "Second unsafe line.", support: { kind: "claim", claimId: "u2" } }],
        }),
      })
    );
    // Under-fire control FIRST -- without it "zero hrefs" is what HEAD does.
    expect(sectionMarkers(el, "aboutYou")).toHaveLength(1);
    expect(sectionMarkers(el, "whyRole")).toHaveLength(1);
    expect(sourceListItems(el, "aboutYou")).toHaveLength(1);
    expect(hrefElements(el), "no refused URL may become an anchor").toHaveLength(0);
  });
});
