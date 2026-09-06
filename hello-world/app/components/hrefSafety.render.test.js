// @vitest-environment jsdom
//
// Per-file jsdom override (vitest.config.js stays `environment: "node"`),
// following app/components/JobDescriptionTab.test.js and
// app/components/feed/FeedPostingCard.test.js.
//
// WHAT THIS GATES, and why no pure function can.
//
// `public.positions` is a shared catalogue: `positions_select_all` has qual
// `true` and `positions_update_authenticated` has qual
// `auth.role() = 'authenticated'`, so any signed-in account can UPDATE any
// row - and `upsertPosition` overwrites the whole row on conflict. A second
// account tailoring the same posting therefore controls the `url` this
// user's tracking table renders as an href. The same is true of every
// model-, feed- and search-derived URL on the render paths below.
//
// Measured on the installed React 19.2.4 by rendering a real `<a href={raw}>`:
// React rewrites `javascript:` (5 of its 6 obfuscations) and NOTHING else -
// `data:`, `vbscript:`, `intent:`, `blob:`, `file:`, `//host`,
// `https://acme.com@evil.example/x` and `https://` all reach the DOM
// untouched. So the framework is not the control; safeExternalHref is.
//
// The requirement is specifically that a refused URL renders NO ANCHOR AT
// ALL. `href=""` resolves to the current page, `href="#"` is a dead control
// a keyboard user still tabs to, and an <a> with no href is an unfocusable
// stub that still reads as a link to some assistive tech. So each case below
// asserts the anchor is absent, not merely that its href changed - and each
// is paired with a positive control on the same component, so "renders
// nothing at all" cannot pass it.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import FeedPostingCard from "./feed/FeedPostingCard.js";
import TechWatchItemCard from "./experience/TechWatchItemCard.js";
import AppViewDialog from "./AppViewDialog.js";
import CompanyBriefPanel from "../copilot/CompanyBriefPanel.js";
import MarkdownPreview from "./experience/MarkdownPreview.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// One hostile value per render path. Every one of these reaches the DOM
// unchanged under React 19.2.4 today.
const HOSTILE = "https://acme.com@evil.example/x";
const HOSTILE_DATA = "data:text/html,<script>alert(1)</script>";
const GOOD = "https://boards.greenhouse.io/acme/jobs/1";

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

async function render(Component, props) {
  await act(async () => {
    root.render(createElement(Component, props));
  });
}

// MUI Dialog renders through a portal, so the subtree is NOT under
// `container`. Scanning document.body covers both cases and is the only
// query that would notice an anchor escaping into the portal.
function anchors() {
  return [...document.body.querySelectorAll("a")];
}

function anchorHrefs() {
  return anchors().map((a) => a.getAttribute("href"));
}

/**
 * The full assertion "renders no anchor at all" actually needs three parts:
 * the hostile string is nowhere in an href, there is no dead `#`/empty
 * anchor standing in for it, and no href-less <a> stub was left behind.
 */
function expectNoAnchorFor(hostile) {
  expect(anchorHrefs()).not.toContain(hostile);
  expect(anchorHrefs()).not.toContain("");
  expect(anchorHrefs()).not.toContain("#");
  expect(anchors().filter((a) => a.getAttribute("href") === null)).toHaveLength(0);
}

// --------------------------------------------------------------------------

describe("FeedPostingCard - posting.url comes straight from the shared catalogue", () => {
  const posting = (url) => ({
    id: "p1",
    title: "Senior React Engineer",
    company: "Acme",
    location: "Remote - US",
    remote_type: "remote",
    source: "greenhouse",
    url,
    description_snippet: "Own features end to end.",
    posted_at: "2026-08-12T00:00:00.000Z",
  });

  const props = (url) => ({
    posting: posting(url),
    busy: false,
    canTailor: true,
    currentUser: { id: "u1" },
    nowTs: Date.parse("2026-08-13T00:00:00.000Z"),
    onTailor: vi.fn(),
    onAutoFill: vi.fn(),
    onHide: vi.fn(),
  });

  it("renders the open-posting link for a real https URL (positive control)", async () => {
    await render(FeedPostingCard, props(GOOD));
    expect(anchorHrefs()).toContain(GOOD);
  });

  it("renders NO anchor when another account swapped the host behind userinfo", async () => {
    await render(FeedPostingCard, props(HOSTILE));
    expectNoAnchorFor(HOSTILE);
  });

  it("renders NO anchor for a data: URL", async () => {
    await render(FeedPostingCard, props(HOSTILE_DATA));
    expectNoAnchorFor(HOSTILE_DATA);
  });

  it("still shows the posting itself when its link is refused", async () => {
    // Degrading to plain text, not to a blank card: the row is still the
    // user's tracked posting and must stay legible.
    await render(FeedPostingCard, props(HOSTILE));
    expect(document.body.textContent).toContain("Senior React Engineer");
  });
});

describe("TechWatchItemCard - source.url is model output", () => {
  const item = (url) => ({
    id: "t1",
    technology: "OpenSSL",
    title: "Buffer overflow in X.509 parsing",
    category: "vulnerability",
    severity: "high",
    occurredAt: "2026-08-01T00:00:00.000Z",
    timePrecision: "day",
    sources: [{ url, label: "Advisory" }],
  });

  it("renders the documentation link for a real https URL (positive control)", async () => {
    await render(TechWatchItemCard, { item: item(GOOD) });
    expect(anchorHrefs()).toContain(GOOD);
  });

  it("renders NO anchor for a userinfo host swap", async () => {
    await render(TechWatchItemCard, { item: item(HOSTILE) });
    expectNoAnchorFor(HOSTILE);
  });

  it("renders NO anchor for a vbscript: URL", async () => {
    await render(TechWatchItemCard, { item: item("vbscript:msgbox(1)") });
    expectNoAnchorFor("vbscript:msgbox(1)");
  });

  it("keeps the advisory itself readable when its source link is refused", async () => {
    await render(TechWatchItemCard, { item: item(HOSTILE) });
    expect(document.body.textContent).toContain("Buffer overflow in X.509 parsing");
  });
});

describe("CompanyBriefPanel - article.url is grounded-search output", () => {
  const props = (url) => ({
    // "done", not "ready": CompanyBriefPanel.js:218 renders the article list
    // only in the "done" branch. The first draft of this fixture said
    // "ready" and the positive control caught it, which is what a positive
    // control is for.
    status: "done",
    articles: [
      {
        id: "art-1",
        title: "Acme raises Series C",
        source: "TechCrunch",
        date: "2026-02-01",
        url,
        summary: "Acme raised $80M.",
        suggestion: "Ask how the raise changes the roadmap.",
      },
    ],
    warnings: [],
    error: "",
    company: "Acme Corp",
    onRefresh: vi.fn(),
    onBack: vi.fn(),
    isEmbedded: false,
  });

  it("links a real https article (positive control)", async () => {
    await render(CompanyBriefPanel, props(GOOD));
    expect(anchorHrefs()).toContain(GOOD);
  });

  it("renders NO anchor for a userinfo host swap, keeping the headline as text", async () => {
    await render(CompanyBriefPanel, props(HOSTILE));
    expectNoAnchorFor(HOSTILE);
    expect(document.body.textContent).toContain("Acme raises Series C");
  });
});

describe("AppViewDialog digest sources - the stored jsonb has no element type guarantee", () => {
  const props = (url) => ({
    appDialog: { open: true, rowIndex: 0, kind: "digest" },
    setAppDialog: vi.fn(),
    applicationData: [
      {
        id: "a1",
        positions: { company: "Acme", title: "Engineer", description: "" },
        generated_resumes: null,
      },
    ],
    communicationsDialog: { applicationId: null, loading: false, error: "", items: [] },
    loadCommunicationsForApp: vi.fn(),
    openAddCommunicationDialog: vi.fn(),
    digestsById: {
      a1: {
        markdown: "Acme is hiring.",
        sources: [{ url, title: "Acme newsroom" }],
        updated_at: "2026-09-01T00:00:00.000Z",
      },
    },
  });

  it("links a real https source (positive control)", async () => {
    await render(AppViewDialog, props(GOOD));
    expect(anchorHrefs()).toContain(GOOD);
  });

  it("renders NO anchor for a userinfo host swap", async () => {
    await render(AppViewDialog, props(HOSTILE));
    expectNoAnchorFor(HOSTILE);
  });

  it("renders NO anchor when the stored element is an object, not a string", async () => {
    // `sources jsonb not null default '[]'` - read-back guarantees nothing,
    // and String({url}) is "[object Object]" as an href today.
    await render(AppViewDialog, props({ nested: "https://acme.com" }));
    expect(anchorHrefs()).not.toContain("[object Object]");
    expect(anchors().filter((a) => a.getAttribute("href") === null)).toHaveLength(0);
  });

  it("still names the source when its link is refused", async () => {
    await render(AppViewDialog, props(HOSTILE));
    expect(document.body.textContent).toContain("Acme newsroom");
  });
});

describe("MarkdownPreview - lib/experience/markdown.js's sanitizeUrl is a prefix test, not a parse", () => {
  // These four are the compensating detectors for the ONE allow-listed
  // ungated href in hrefSafety.sweep.test.js. The same-origin and mailto:
  // branches must keep working (they are why that entry exists); the
  // external branch must be closed.
  it("renders NO anchor for a userinfo host swap inside a markdown link", async () => {
    await render(MarkdownPreview, { markdown: `[acme.com](${HOSTILE})` });
    expectNoAnchorFor(HOSTILE);
    // The label survives as inert text - a refused link must not delete
    // what the author wrote.
    expect(document.body.textContent).toContain("acme.com");
  });

  it("still links a real external https markdown link (positive control)", async () => {
    await render(MarkdownPreview, { markdown: `[docs](${GOOD})` });
    expect(anchorHrefs()).toContain(GOOD);
  });

  it("still links a same-origin path, which the control refuses by construction", async () => {
    await render(MarkdownPreview, { markdown: "[other](/pages/other)" });
    expect(anchorHrefs()).toContain("/pages/other");
    // And still without rel - the distinction MarkdownPreview.test.js pins.
    expect(anchors()[0].getAttribute("rel")).toBeNull();
  });

  it("still links a mailto:", async () => {
    await render(MarkdownPreview, { markdown: "[mail](mailto:hiring@acme.example)" });
    expect(anchorHrefs()).toContain("mailto:hiring@acme.example");
  });
});
