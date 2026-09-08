// @vitest-environment jsdom
//
// BLOCKER 2 — every route a user can land on has a main landmark, and it is
// the one the skip link targets.
//
// Measured at HEAD (1515a16) before this feature: `<main>` existed on exactly
// ONE route, `app/page.js:2836`. `/copilot`, `/library` and `/login` had no
// landmark of any kind — so on three of the four routes a screen-reader user
// had nothing to jump to, and (once blocker 1 shipped) the skip link would
// have pointed at nothing at all. A skip link with no target is worse than no
// skip link, which is why these two land together.
//
// ---------------------------------------------------------------------------
// WHAT IS RENDERED vs WHAT IS READ FROM SOURCE, and why
// ---------------------------------------------------------------------------
//
// `/copilot`, `/library` and `/login` are RENDERED here and the landmark is
// asserted through the real DOM. The first two are ten-line server components
// whose client is mocked out, so the render is exercising exactly the element
// this change adds and nothing else.
//
// `app/page.js` is NOT rendered: it is a 3233-line client component with ~90
// imports, Supabase, and localStorage state, and no test in this repo mounts
// it. Its landmark is therefore read out of source. That is a genuinely weaker
// instrument and is labelled as such rather than dressed up — but it is not
// vacuous: the regex demands the id ON the `<main>` tag itself, and the
// "exactly one" case would catch a second landmark being introduced.
//
// `app/layout.js` is also read from source, for the ordering claim: it renders
// no DOM of its own that a jsdom test can mount (it IS the `<html>`/`<body>`).
// SkipLink.test.js mounts the same order as a tree and asserts the resulting
// focusable order; this file pins that layout.js actually has that order. The
// two are complements — neither alone is enough.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";

const APP_DIR = path.join(process.cwd(), "app");
const read = (rel) => readFileSync(path.join(APP_DIR, rel), "utf8");

// Same idiom as app/theme/themeSystem.test.js: an ordering claim made with
// `indexOf` over raw source is defeated by PROSE. layout.js's own comment
// explains why the link must not move inside `<AppHeader>` and why it sits
// outside `<Providers>` — both of which put those tag names in the file
// ahead of the real `<SkipLink />`. MEASURED, not hypothetical: the first
// draft of the two ordering cases below failed for exactly that reason.
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// The id every route's landmark must carry and the skip link must target.
const MAIN_ID = "main-content";

vi.mock("./copilot/CopilotClient", () => ({
  default: () => createElement("div", { "data-testid": "copilot-client" }, "copilot"),
}));
vi.mock("@/app/components/LibraryEditor", () => ({
  default: () => createElement("div", { "data-testid": "library-editor" }, "library"),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => null }),
  usePathname: () => "/login",
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: {} }),
}));

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
});

async function renderRoute(Component) {
  await act(async () => {
    root.render(createElement(Component));
  });
}

/**
 * The landmark contract one route must satisfy: exactly one `main`, carrying
 * the shared id, and programmatically focusable so the skip link can actually
 * land the caret on it.
 */
function expectMainLandmark(label) {
  const mains = container.querySelectorAll("main, [role='main']");
  expect(mains.length, `${label} should expose exactly one main landmark, found ${mains.length}`).toBe(1);
  const el = mains[0];
  expect(el.id, `${label}'s main landmark must carry id="${MAIN_ID}" — the skip link's target`).toBe(MAIN_ID);
  expect(
    el.getAttribute("tabindex"),
    `${label}'s main landmark needs tabindex="-1" so activating the skip link moves the CARET, not ` +
      "just the scroll position. Safari and Firefox do not focus a non-focusable fragment target. " +
      '-1 keeps it out of sequential traversal, so it costs no tab stop.',
  ).toBe("-1");
  return el;
}

// ==================================================================== /copilot

describe("/copilot has a main landmark", () => {
  it("wraps its client in the shared main landmark", async () => {
    const { default: CopilotPage } = await import("./copilot/page.js");
    await renderRoute(CopilotPage);
    const main = expectMainLandmark("/copilot");
    expect(
      main.querySelector("[data-testid='copilot-client']"),
      "the landmark must CONTAIN the page's content, not sit beside it",
    ).not.toBeNull();
  });
});

// ==================================================================== /library

describe("/library has a main landmark", () => {
  it("wraps its editor in the shared main landmark", async () => {
    const { default: LibraryPage } = await import("./library/page.js");
    await renderRoute(LibraryPage);
    const main = expectMainLandmark("/library");
    expect(
      main.querySelector("[data-testid='library-editor']"),
      "the landmark must CONTAIN the page's content, not sit beside it",
    ).not.toBeNull();
  });
});

// ====================================================================== /login

describe("/login has a main landmark", () => {
  it("marks its full-screen surface as the main landmark", async () => {
    // AppHeader returns null on /login, so this route has NO other landmark of
    // any kind — and the skip link in layout.js still renders here.
    const { default: LoginPage } = await import("./login/page.js");
    await renderRoute(LoginPage);
    expectMainLandmark("/login");
    expect(
      container.querySelector("input"),
      "[instrument] the login form did not render, so the landmark assertion above proved nothing",
    ).not.toBeNull();
  });
});

// ========================================================= / (the main route)

describe("/ (app/page.js) targets the same landmark id", () => {
  // SOURCE-READ, not rendered — see this file's header for why, and treat it
  // as the weaker of the two instruments used here.
  const src = () => read("page.js");

  it("its <main> carries the shared id and is focusable", () => {
    const tag = /<main\b[^>]*>/.exec(src());
    expect(tag, "app/page.js renders no <main> at all").toBeTruthy();
    expect(tag[0], `app/page.js's <main> must carry id="${MAIN_ID}"`).toContain(`id="${MAIN_ID}"`);
    expect(tag[0], "app/page.js's <main> must carry tabIndex={-1}").toMatch(/tabIndex=\{-1\}/);
  });

  it("renders exactly one <main>, so the id stays unique", () => {
    const count = (src().match(/<main\b/g) || []).length;
    expect(count, `app/page.js opens <main> ${count} times; duplicate ids break the skip link`).toBe(1);
  });
});

// =================================================================== layout.js

describe("app/layout.js mounts the skip link first", () => {
  const src = () => read("layout.js");

  it("imports and renders SkipLink", () => {
    expect(src(), "layout.js must import the SkipLink component").toMatch(
      /import\s+SkipLink\s+from\s+["'][^"']*SkipLink["']/,
    );
    expect(src(), "layout.js must render <SkipLink />").toMatch(/<SkipLink\s*\/>/);
  });

  it("renders it BEFORE AppHeader, which is what makes it the document's first tab stop", () => {
    const body = stripComments(src());
    const skip = body.indexOf("<SkipLink");
    const header = body.indexOf("<AppHeader");
    expect(skip, "no <SkipLink in layout.js").toBeGreaterThan(-1);
    expect(header, "[instrument] no <AppHeader in layout.js — the ordering claim has no anchor").toBeGreaterThan(-1);
    expect(
      skip < header,
      "SkipLink must precede AppHeader. Mounting it INSIDE the header instead would break " +
        "AppHeader.backButton.test.js's §3 (back control is header.firstElementChild) and its AC-15.",
    ).toBe(true);
  });

  it("keeps it outside <Providers>, so it needs no theme and no client boundary to be first", () => {
    const body = stripComments(src());
    const skip = body.indexOf("<SkipLink");
    const providers = body.indexOf("<Providers");
    // Guarded explicitly: indexOf returns -1 for "absent", and -1 is less than
    // any real index — so without these two the case would PASS on a layout.js
    // that renders no SkipLink at all.
    expect(skip, "no <SkipLink in layout.js").toBeGreaterThan(-1);
    expect(providers, "[instrument] no <Providers in layout.js").toBeGreaterThan(-1);
    expect(skip < providers, "<SkipLink /> must be rendered before <Providers>").toBe(true);
  });
});

// ============================================== the two halves actually agree

describe("the skip link and the landmarks are wired to the same id", () => {
  it("SkipLink's main href is exactly the id every route renders", () => {
    const src = read("components/SkipLink.js");
    expect(
      src,
      `SkipLink must target #${MAIN_ID} — the id asserted on all four routes above. This case is the ` +
        "only thing tying the two halves together; without it each could be internally consistent " +
        "and still not point at each other.",
    ).toContain(`href="#${MAIN_ID}"`);
  });
});
