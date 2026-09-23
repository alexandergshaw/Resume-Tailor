// @vitest-environment jsdom
//
// N35 follow-on -- how the provenance id is DERIVED, not merely that two ids
// differ. Sibling to app/hooks/acceptFactIdCollision.test.js, which pins the
// cross-session collision (F1) and the id-less article (F4). Nothing in that
// file is weakened here; this one attacks the derivation that commit cc2406d
// introduced at `useCompanyResearch.js:68-76` (`mintArticleId` /
// `withMintedIds`, called from `fetchResearchInto` at :123):
//
//     safeExternalHref(url) ? `art-${hashString(url).toString(36)}`
//                           : `art-run${runStamp}-${index}`
//
// Four properties, in the order the verifier found them.
//
// ---------------------------------------------------------------------------
// V1 -- TWO ARTICLES AT ONE URL COLLAPSE INTO ONE ID (the blocker)
// ---------------------------------------------------------------------------
// The id is derived PURELY from the url, so two articles sharing a url get ONE
// id. Reachable with no adversary: app/api/company-research/route.js:164
// rewrites every article's url to `scraped.finalUrl || candidate`, so a
// syndicated copy and its canonical -- or two grounding redirects for one
// story -- arrive at the client as the same url. Downstream, all three of the
// dialog's per-card maps are keyed on that id
// (`CompanyResearchDialog.js:86-90`): `selected`, `suggestions`, `targets`.
// So today:
//   * `Object.fromEntries` keeps the LAST article's suggestion, and BOTH cards
//     render it -- the first article's text is not on screen anywhere;
//   * `selected` is a Set of ids, so unchecking one card unchecks BOTH;
//   * `mergeAcceptedFacts` (lib/acceptedFacts/factInsertion.js:160-173) is
//     identity-by-normalised-text, so the two identical texts merge and ONE
//     accepted fact silently disappears;
//   * React renders duplicate keys (`CompanyResearchDialog.js:165`).
// The embedded engine is safe -- it dedupes candidates before building cards
// (lib/research/companyResearchLocal.js:97-128) -- so this is the Gemini
// route's path only.
//
// OWNER RULING (2026-09-23): dedupe articles by url ON ARRIVAL, before
// minting. Url-derived ids and their cross-session stability are KEPT; do not
// switch to hashing title/summary.
//
// WHAT IS THEREFORE *NOT* ASSERTED HERE: a dedupe OUTCOME. Collapsing the two
// same-url cards into one, and keeping two cards with two distinct ids, are
// both acceptable shapes. Every assertion below is written over whatever
// cards the run actually produces, so both shapes pass -- what is forbidden is
// the SILENT part: a card whose text is another card's, a card that cannot be
// deselected on its own, and a fact the candidate ticked that never reaches
// the store.
//
// ---------------------------------------------------------------------------
// V5 -- THE FALLBACK ARM IS EXERCISED BY NO FIXTURE ANYWHERE
// ---------------------------------------------------------------------------
// `art-run${runStamp}-${index}` is reached only when `safeExternalHref`
// refuses the url, and no fixture in the repo produced such an article, so
// four separate mutations to it survived the whole suite (dropping the
// `safeExternalHref` guard; dropping the `-${index}`; a constant `art-run`;
// `runStamp` pinned to 0). The fixtures below reach it the way production
// really does: route.js:170 returns `{ ...a, url: groundedUri }` with
// `groundedUri === ""` for an article the grounding metadata never matched,
// so `url: ""` is a REAL arrival shape, not hardening. `javascript:alert(1)`
// stands in for the hostile/unusable url `safeExternalHref` exists to refuse.
//
// NOTE FOR THE IMPLEMENTER: the two `url: ""` articles below are DIFFERENT
// articles that merely share the absence of a url. A dedupe keyed on the raw
// url string would collapse them into one card and lose a real research
// result. Dedupe only articles with a usable url.
//
// ---------------------------------------------------------------------------
// V3 -- NO NORMALIZATION, SO ONE ARTICLE HAS MANY IDS
// ---------------------------------------------------------------------------
// `hashString(url)` hashes the raw string, so every spelling of one url is a
// different article as far as the id is concerned. The equivalences pinned
// below are the four defensible ones only -- host case, fragment, tracking
// parameters, trailing slash. Scheme (`http:` vs `https:`) and the `www.`
// prefix are deliberately left UNASSERTED in both directions: two sites can
// legitimately differ by scheme, and this file takes no position on the
// prefix. Path and non-tracking query content are asserted to be MEANINGFUL
// (two urls differing there must not merge), because an over-normalizing key
// re-creates V1 between genuinely different articles.
//
// ---------------------------------------------------------------------------
// V3(b) -- A GROUNDING REDIRECT IS AN OPAQUE PER-REQUEST TOKEN
// ---------------------------------------------------------------------------
// `https://vertexaisearch.cloud.google.com/grounding-api-redirect/<token>` is
// what the grounding metadata hands back, and the token is minted per request:
// the same story yields a different url on every run. This repo already knows
// that (lib/tracking/citationHref.js:77 `servesGroundingRedirect`,
// lib/interviewPrep/prepParse.js:327-332). `safeExternalHref` ACCEPTS such a
// url -- it is https with a real host -- so today it takes the hash arm and
// the comment's promise ("stable for the SAME article across sessions") is
// simply false for those articles. The property pinned below is that promise,
// measured rather than read: run the identical research payload twice and ask
// whether the id came back the same. For an ordinary url it must (that is the
// claim, and it is the built-in canary proving the instrument can observe
// equality at all); for a redirect url it must not, because nothing about
// that url is stable. Either fix satisfies it -- take the fallback arm, or
// normalize the redirect away -- and no id FORMAT is asserted anywhere.
//
// ---------------------------------------------------------------------------
// REACHABILITY
// ---------------------------------------------------------------------------
// Every measurement drives the real hook and the really-mounted dialog:
// articles arrive through the real `/api/company-research` fetch inside
// `fetchResearchInto`, cards are selected by clicking the real checkboxes, and
// every accept is a real click on the real "Insert into cover letter" control.
// `research.acceptFacts(...)` is never called directly, and no article list is
// ever handed to the dialog as a test-controlled prop.
//
// jsdom note: MUI's Dialog portals into document.body, never the mount
// container, so every DOM query goes through `document`.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import { useCompanyResearch } from "./useCompanyResearch.js";
import CompanyResearchDialog from "@/app/components/CompanyResearchDialog.js";
import { sanitizeStoredFacts } from "@/lib/acceptedFacts/factStore.js";
import { mergeAcceptedFacts } from "@/lib/acceptedFacts/factInsertion.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };

function article(overrides) {
  return {
    id: "art-0",
    title: "Acme story",
    url: "https://news.example.com/acme/story",
    source: "Acme Newsroom",
    date: "2026-02-01",
    summary: "A thing Acme did.",
    suggestion: "Acme did a thing in 2026.",
    ...overrides,
  };
}

// --- V1: the verifier's exact reproduction --------------------------------
// Same `url`, different suggestions. This is a syndicated copy and its
// canonical after route.js has rewritten both to the same `finalUrl`.
const SHARED_URL = "https://wire.example.com/2026/acme-dublin-lab";
const DUP_FIRST = article({
  id: "art-0",
  title: "Acme opens a Dublin telemetry lab",
  url: SHARED_URL,
  suggestion: "Acme's new Dublin telemetry lab is exactly the work I want to do.",
});
const DUP_SECOND = article({
  id: "art-1",
  title: "Dublin lab opens for Acme",
  url: SHARED_URL,
  source: "Tech Wire",
  suggestion: "I followed Acme's Dublin telemetry investment closely this year.",
});
// The SAME pair with the urls differing by host and path and nothing else.
const SPLIT_FIRST = { ...DUP_FIRST, url: "https://wire.example.com/2026/acme-dublin-lab" };
const SPLIT_SECOND = { ...DUP_SECOND, url: "https://techwire.example.com/2026/acme-dublin-lab" };

// --- V5: the fallback arm -------------------------------------------------
const NO_URL_FIRST = article({
  id: "art-0",
  title: "Acme names a new CTO",
  url: "",
  suggestion: "Acme's new CTO has written about the telemetry work I care about.",
});
const NO_URL_SECOND = article({
  id: "art-1",
  title: "Acme opens a Cork office",
  url: "",
  suggestion: "Acme's Cork office is a short commute from me, which I like.",
});
const UNSAFE_URL = article({
  id: "art-2",
  title: "Acme wins a design award",
  url: "javascript:alert(1)",
  suggestion: "Acme's design award says a lot about how it treats its users.",
});
const SAFE_URL = article({
  id: "art-3",
  title: "Acme funds an apprenticeship",
  url: "https://awards.example.com/acme-2026",
  suggestion: "Acme's apprenticeship funding is the kind of investment I look for.",
});
const MIXED_RUN = [NO_URL_FIRST, NO_URL_SECOND, UNSAFE_URL, SAFE_URL];

// --- V3: spellings of one url --------------------------------------------
const CANON = "https://news.example.com/acme/dublin-lab";
// Each spelling carries its own suggestion, so that a run which collapses
// them is still readable: whichever card survives names itself.
function spelling(url, n) {
  return article({ id: `art-${n}`, title: `Dublin lab (spelling ${n})`, url, suggestion: `Spelling ${n}: Acme's Dublin lab.` });
}
const HOST_CASE = [spelling(CANON, 0), spelling("https://NEWS.EXAMPLE.COM/acme/dublin-lab", 1)];
const FRAGMENT = [spelling(CANON, 0), spelling(`${CANON}#section-2`, 1)];
const TRACKING = [
  spelling(CANON, 0),
  spelling(`${CANON}?utm_source=newsletter&utm_medium=email&utm_campaign=spring`, 1),
];
const TRAILING_SLASH = [spelling(CANON, 0), spelling(`${CANON}/`, 1)];
// Tracking stripped, meaningful query kept: these two must be ONE id.
const TRACKED_SAME_STORY = [
  spelling(`${CANON}?utm_source=a&story=2`, 0),
  spelling(`${CANON}?utm_medium=b&story=2`, 1),
];
// Genuinely different articles. These must stay distinct under ANY
// normalization -- an over-normalizing key re-creates V1 here.
const DIFFERENT_URLS = [
  spelling(CANON, 0),
  spelling("https://news.example.com/acme/cork-office", 1),
  spelling(`${CANON}?story=2`, 2),
  spelling(`${CANON}?story=3`, 3),
];

// --- V3(b): the grounding redirect ---------------------------------------
const REDIRECT_URL =
  "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQH0LqPk7opaque-token-for-one-request";
const REDIRECT_ARTICLE = article({
  id: "art-0",
  title: "Acme's telemetry lab lands in Dublin",
  url: REDIRECT_URL,
  suggestion: "Acme's Dublin telemetry lab is the reason I applied.",
});
const PLAIN_ARTICLE = article({
  id: "art-0",
  title: "Acme's telemetry lab lands in Dublin",
  url: "https://news.example.com/acme/dublin-lab",
  suggestion: "Acme's Dublin telemetry lab is the reason I applied.",
});

let ENGINE_B64 = "";
let ENGINE_LINES = [];

beforeAll(async () => {
  // A REAL engine cover letter: the accept refuses outright without engine
  // bytes (PB1) and the docx splice really runs, so a stub would change which
  // branch every store-level assertion below measures.
  const cl = await embeddedEngine.tailorCoverLetter({
    jobPosting: "Staff Engineer at Acme. React, Node, telemetry, accessibility.",
    jobTitle: "Staff Engineer",
    companyName: "Acme",
  });
  ENGINE_B64 = cl.docxB64;
  ENGINE_LINES = cl.resultLines;
});

// --- the fake server ------------------------------------------------------
// State survives across mounts, because "two research runs" is only a real
// scenario if run 2's GET returns what run 1's PUT stored. Facts are run
// through the REAL `sanitizeStoredFacts`, the function
// app/api/accepted-facts/route.js stores through.

let store = { facts: [], removed: [], revision: null };
let researchQueue = [];
let putBodies = [];
let research = null;
let container = null;
let root = null;
let acceptPromise = null;
let lastSelection = null;

const EMPTY = [];

function Probe({ initialMap }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
  research = useCompanyResearch({ tailoringMap, setTailoringMap, setPreviewReloadKey: () => {} });
  // The article list comes from the HOOK's own state, populated by the real
  // `/api/company-research` fetch -- never from a prop the test controls.
  const r = research.researchByJob[JOB_ID] || {};
  return createElement(CompanyResearchDialog, {
    open: research.companyResearch.open,
    company: research.companyResearch.company,
    needsCompany: !!r.needsCompany,
    loading: !!r.loading,
    error: r.error || "",
    articles: r.articles || EMPTY,
    warnings: r.warnings || EMPTY,
    busy: !!research.companyResearch.busy,
    acceptError: research.companyResearch.acceptError || "",
    acceptNotice: research.companyResearch.acceptNotice || "",
    coverLetterLines: tailoringMap[JOB_ID]?.coverLetterResultLines || EMPTY,
    onClose: () => research.closeCompanyResearch(),
    onApply: () => {},
    // Production binds `onAccept={research.acceptFacts}` (app/page.js:2975).
    // The selection is recorded and the promise kept ONLY so the test can read
    // what the dialog emitted and await the genuinely-async docx splice.
    onAccept: (selection) => {
      lastSelection = selection;
      acceptPromise = research.acceptFacts(selection);
      return acceptPromise;
    },
    onResearch: () => {},
    onAddUrl: () => {},
  });
}

function entryWithEngineLetter() {
  return {
    status: "done",
    result: "",
    resultLines: [],
    docxB64: "",
    docxPath: "",
    coverLetterResultLines: [...ENGINE_LINES],
    coverLetterDocxB64: ENGINE_B64,
    coverVersionId: "ver-1",
  };
}

function json(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  store = { facts: [], removed: [], revision: null };
  researchQueue = [];
  putBodies = [];
  research = null;
  acceptPromise = null;
  lastSelection = null;
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const u = String(url);
    if (u.includes("/api/company-research")) {
      return json({ articles: researchQueue.shift() || [], warnings: [] });
    }
    if (u.includes("/api/accepted-facts")) {
      if (method === "GET") return json({ facts: store.facts, removed: store.removed, revision: store.revision });
      const body = JSON.parse(init.body);
      putBodies.push(body);
      store = {
        facts: sanitizeStoredFacts(body.facts),
        removed: Array.isArray(body.declinedUrls) ? body.declinedUrls : [],
        revision: (store.revision ?? 0) + 1,
      };
      return json({ facts: store.facts, removed: store.removed, revision: store.revision, versionSaved: !!body.coverVersion });
    }
    return json({});
  });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  if (container) container.remove();
  root = null;
  container = null;
  delete globalThis.fetch;
});

async function flush(times = 6) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// One browser session. `researchStartedRef` is per-hook-instance, so a fresh
// mount really re-runs research. The article count is asserted as a RANGE:
// dedupe-on-arrival is an allowed outcome, so pinning it to the fixture length
// would be pinning a dedupe shape this file deliberately leaves open. What is
// pinned is that the run ARRIVED (at least one card) and that nothing was
// invented (never more cards than articles sent).
async function openSession(articles) {
  researchQueue.push(articles);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Probe, { initialMap: { [JOB_ID]: entryWithEngineLetter() } }));
  });
  await act(async () => {
    research.openCompanyResearch(JOB);
  });
  await flush();
  const got = hookArticles();
  expect(got.length, "the research run never reached the hook -- instrument failure, not a product verdict")
    .toBeGreaterThan(0);
  expect(got.length, "the hook produced MORE cards than the run returned").toBeLessThanOrEqual(articles.length);
  return got;
}

async function closeSession() {
  await act(async () => root.unmount());
  container.remove();
  root = null;
  container = null;
}

function hookArticles() {
  return research?.researchByJob?.[JOB_ID]?.articles || [];
}

function articleIds() {
  return hookArticles().map((a) => a.id);
}

// The per-article suggestion editors, read off the DOM. MUI's multiline
// TextField renders a hidden shadow textarea for autosizing beside the real
// one; only the real one is returned. Canaried below.
function suggestionFieldValues() {
  return [...document.querySelectorAll("textarea")]
    .filter((t) => t.getAttribute("aria-hidden") !== "true")
    .map((t) => t.value);
}

// One per card in `renderPick`; nothing else in the dialog renders a checkbox.
function checkboxes() {
  return [...document.querySelectorAll('input[type="checkbox"]')];
}

function acceptControl() {
  return [...document.querySelectorAll("button")].find(
    (b) => (b.textContent || "").trim() === "Insert into cover letter",
  );
}

// A real click on the real control, with the accept allowed to be refused.
// Used only where what is measured is what the DIALOG emitted, which happens
// strictly before the hook can refuse anything.
async function clickAcceptRaw() {
  const button = acceptControl();
  expect(
    button,
    `no "Insert into cover letter" control; buttons were: ${[...document.querySelectorAll("button")]
      .map((b) => JSON.stringify((b.textContent || "").trim()))
      .join(", ")}`,
  ).toBeTruthy();
  expect(button.disabled).toBe(false);
  acceptPromise = null;
  lastSelection = null;
  await act(async () => {
    button.click();
  });
  expect(acceptPromise, "the accept control was clicked but no accept was started").toBeTruthy();
  await act(async () => {
    await acceptPromise;
  });
  expect(lastSelection, "the control was clicked but the dialog emitted no selection").toBeTruthy();
}

async function clickAccept() {
  await clickAcceptRaw();
  expect(research.companyResearch.acceptError || "", "the accept was refused; nothing below is a verdict").toBe("");
}

// Tick exactly one card, by clicking the real checkboxes. Asserting the
// RESULT of the clicks is the point: `selected` is a Set of ids
// (CompanyResearchDialog.js:86), so under V1 unticking one same-url card
// unticks its twin as well, and the candidate cannot express "this one, not
// that one" at all.
async function selectOnlyCard(index, total) {
  for (let j = 0; j < total; j += 1) {
    const box = checkboxes()[j];
    expect(box, `card ${j} has no checkbox`).toBeTruthy();
    if (box.checked !== (j === index)) {
      await act(async () => {
        box.click();
      });
    }
  }
  const want = Array.from({ length: total }, (_, j) => j === index);
  expect(
    checkboxes().map((b) => b.checked),
    `ticking only card ${index} did not take: the cards' checkboxes are coupled, so the candidate cannot choose between them`,
  ).toEqual(want);
}

// Accept every card on screen, ONE CARD PER CLICK. One card per click is
// deliberate and unrelated to this chunk: accepting two cards in a single
// click is refused outright today (both facts resolve to the same default
// placement, the second edit's `before` is the first edit's output,
// factDocx.js returns `stale-plan`, and the hook surfaces the no-engine-bytes
// message). Driving two cards at once here would make every store-level
// assertion below that refusal wearing an id defect's clothes, and no correct
// id scheme could turn it green.
async function acceptEveryCardSeparately() {
  const shown = suggestionFieldValues();
  expect(shown.length, "no cards rendered -- instrument failure, not a product verdict").toBeGreaterThan(0);
  expect(checkboxes().length, "one checkbox per card is the harness' assumption").toBe(shown.length);
  for (let i = 0; i < shown.length; i += 1) {
    await selectOnlyCard(i, shown.length);
    await clickAccept();
  }
  return shown;
}

function lastBody() {
  expect(putBodies.length, "no write to /api/accepted-facts was made at all").toBeGreaterThan(0);
  return putBodies[putBodies.length - 1];
}

// Returns the ids under which two or more DISTINCT texts were filed --
// the ruling stated mechanically. Indifferent to scheme, and quiet when the
// same fact legitimately appears twice under one id.
function collidingIds(list) {
  const byId = new Map();
  for (const f of list || []) {
    const key = String(f?.id ?? "");
    if (!byId.has(key)) byId.set(key, new Set());
    byId.get(key).add(String(f?.text ?? "").trim());
  }
  return [...byId.entries()].filter(([, texts]) => texts.size > 1).map(([id]) => id);
}

function expectUsableIds(ids, label) {
  expect(ids.length, `${label}: no ids to inspect -- vacuous`).toBeGreaterThan(0);
  for (const id of ids) {
    expect(typeof id, `${label}: id sent as ${JSON.stringify(id)}`).toBe("string");
    expect(String(id || "").trim(), `${label}: id sent as ${JSON.stringify(id)}`).not.toBe("");
  }
}

// A real pause between two research runs. It exists so that an implementation
// whose per-run component is a millisecond clock (today's `Date.now()`) really
// does advance between them -- the property under test is "run 2 does not
// reuse run 1's id", not the resolution of anyone's clock. A counter or a
// random nonce needs no such pause, which is a reason to prefer one.
async function pauseBetweenRuns() {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  });
}

// ---------------------------------------------------------------------------
// Harness sanity. If any of these is red, every verdict below is an instrument
// failure rather than a product finding.
// ---------------------------------------------------------------------------

describe("harness sanity", () => {
  it("the fixture is a real engine cover letter", () => {
    expect(ENGINE_LINES.length).toBeGreaterThan(3);
    expect(ENGINE_B64.length).toBeGreaterThan(100000);
  });

  it("CANARY: the card readers return one distinct value per card, and the checkboxes are independent", async () => {
    // Known positive for `suggestionFieldValues`, `checkboxes` and
    // `selectOnlyCard`, on a run whose urls differ. Without it, every V1 red
    // below is equally well explained by a reader that returns one entry per
    // page, or by a `selectOnlyCard` that cannot tick anything.
    await openSession([SPLIT_FIRST, SPLIT_SECOND]);
    expect(suggestionFieldValues()).toEqual([SPLIT_FIRST.suggestion, SPLIT_SECOND.suggestion]);
    expect(checkboxes().map((b) => b.checked)).toEqual([true, true]);
    await selectOnlyCard(1, 2);
    expect(checkboxes().map((b) => b.checked)).toEqual([false, true]);
    await closeSession();
  });

  it("CONTROL: the collision guard fires on a hand-built collision and stays quiet otherwise", () => {
    expect(collidingIds([{ id: "a", text: "one" }, { id: "b", text: "two" }])).toEqual([]);
    expect(collidingIds([{ id: "a", text: "one" }, { id: "a", text: "two" }])).toEqual(["a"]);
    expect(collidingIds([{ id: null, text: "one" }, { text: "two" }])).toEqual([""]);
    expect(collidingIds([{ id: "a", text: "one" }, { id: "a", text: "one" }])).toEqual([]);
  });

  it("CONTROL (mechanism): the merge collapses equal texts and keeps distinct ones", () => {
    // Why a collapsed EDITOR becomes a lost FACT, isolated from the defect so
    // this stays green before and after the fix. Both directions, so a merge
    // that deduped everything -- or nothing -- fails here rather than quietly
    // explaining a V1 red that was never about ids.
    expect(mergeAcceptedFacts([], [{ text: "Acme did a thing." }, { text: "Acme did a thing." }])).toHaveLength(1);
    expect(mergeAcceptedFacts([], [{ text: "Acme did a thing." }, { text: "Acme did another." }])).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// V1: two articles at one url.
// ---------------------------------------------------------------------------

describe("V1: a run returning two articles at the same url", () => {
  it("no two cards share an id", async () => {
    const got = await openSession([DUP_FIRST, DUP_SECOND]);
    const ids = articleIds();
    expectUsableIds(ids, "the hook's article ids");
    expect(ids.length, "the card count and the id count disagree").toBe(got.length);
    expect(new Set(ids).size, `the hook's article ids were ${JSON.stringify(ids)}`).toBe(ids.length);
    await closeSession();
  });

  it("no card renders another card's text", async () => {
    // The user-visible half. `suggestions` is keyed on the id
    // (CompanyResearchDialog.js:87), so under one shared id
    // `Object.fromEntries` keeps the LAST article's suggestion and both cards
    // show it -- the first article's sentence is on screen nowhere.
    await openSession([DUP_FIRST, DUP_SECOND]);
    const shown = suggestionFieldValues();
    const offered = new Set([DUP_FIRST.suggestion, DUP_SECOND.suggestion]);
    expect(shown.length, "no cards rendered at all").toBeGreaterThan(0);
    expect(shown.length, "there are more editors than cards").toBe(hookArticles().length);
    for (const value of shown) {
      expect(offered.has(value), `a card is showing text no article sent: ${JSON.stringify(value)}`).toBe(true);
    }
    expect(new Set(shown).size, `the cards are showing ${JSON.stringify(shown)}`).toBe(shown.length);
    await closeSession();
  });

  it("each card can be ticked on its own", async () => {
    // `selected` is a Set of ids, so two cards under one id are one entry and
    // unticking either untickes both. Driven by real clicks on the real
    // checkboxes; `selectOnlyCard` asserts the resulting checked states.
    await openSession([DUP_FIRST, DUP_SECOND]);
    const total = checkboxes().length;
    expect(total, "no checkboxes rendered").toBeGreaterThan(0);
    for (let i = 0; i < total; i += 1) await selectOnlyCard(i, total);
    await closeSession();
  });

  it("the payload the dialog emits carries one distinct fact per card", async () => {
    // Pinned at the dialog's own output as well as at the wire, because the
    // wire alone is ambiguous: `mergeAcceptedFacts`' text dedupe collapses two
    // identical texts there even if the dialog HAD emitted two distinct rows.
    // This says whether the rows were ever distinct.
    //
    // `clickAcceptRaw` on purpose: with every card ticked the accept is
    // refused for the unrelated placement reason recorded at
    // `acceptEveryCardSeparately`, and that refusal happens strictly AFTER the
    // dialog has emitted this payload.
    await openSession([DUP_FIRST, DUP_SECOND]);
    const shown = suggestionFieldValues();
    await clickAcceptRaw();
    const facts = lastSelection.facts;
    expect(facts.map((f) => f.text), "the dialog emitted a different set of texts from the one on screen").toEqual(shown);
    expectUsableIds(facts.map((f) => f.id), "the emitted facts' ids");
    // `collidingIds` alone is not enough HERE, and measuring that was worth
    // the line: under V1 both rows carry the same id AND the same text, so
    // the guard -- which by design ignores one fact filed twice -- stays
    // quiet. The distinctness of the ids and the merge survival below are
    // what actually bite on this fixture.
    expect(collidingIds(facts), `the dialog emitted ${JSON.stringify(facts)}`).toEqual([]);
    expect(new Set(facts.map((f) => f.id)).size, `the dialog emitted ${JSON.stringify(facts)}`).toBe(facts.length);
    expect(
      mergeAcceptedFacts([], facts).length,
      "the merge silently dropped one of the emitted facts -- two cards, one fact",
    ).toBe(facts.length);
    await closeSession();
  });

  it("every card the candidate ticks reaches the store as its own fact", async () => {
    // The end-to-end statement of "nothing is silent": accept each card on its
    // own and the store must end up holding exactly what was on screen, in
    // order, under distinct ids. Satisfied by collapsing the twins into one
    // card (one card, one fact) and by keeping two distinct cards (two cards,
    // two facts) alike.
    await openSession([DUP_FIRST, DUP_SECOND]);
    const shown = await acceptEveryCardSeparately();
    const body = lastBody();
    expect(new Set(shown).size, "the cards on screen are not distinct -- that is the V1 defect, measured here").toBe(
      shown.length,
    );
    expect(body.facts.map((f) => f.text), "the store does not hold what was on screen").toEqual(shown);
    expectUsableIds(body.facts.map((f) => f.id), "body.facts ids");
    expect(collidingIds(body.facts), `body.facts were ${JSON.stringify(body.facts)}`).toEqual([]);
    // Through the REAL store sanitiser too, because an id that is distinct on
    // the wire and clipped to a shared prefix in the store still collides in
    // `generated_cover_letters.inserted_facts`.
    expect(collidingIds(sanitizeStoredFacts(body.facts))).toEqual([]);
    expect(collidingIds(body.coverVersion.insertedFacts)).toEqual([]);
    await closeSession();
  });

  it("CONTROL (under-fires): the same pair at DIFFERENT urls already works", async () => {
    // SPLIT_FIRST/SECOND are DUP_FIRST/SECOND with the url changed and nothing
    // else, driven through the identical path. GREEN TODAY. It proves the reds
    // above are about the shared url, and not about the harness, the merge,
    // the checkbox driver or a store that can only ever hold one fact -- and,
    // as an over-fire control, that a dedupe must NOT collapse two genuinely
    // different articles.
    await openSession([SPLIT_FIRST, SPLIT_SECOND]);
    expect(hookArticles()).toHaveLength(2);
    const shown = await acceptEveryCardSeparately();
    expect(shown).toEqual([SPLIT_FIRST.suggestion, SPLIT_SECOND.suggestion]);
    const body = lastBody();
    expect(body.facts.map((f) => f.text)).toEqual(shown);
    expect(new Set(body.facts.map((f) => f.id)).size).toBe(2);
    expect(collidingIds(body.facts)).toEqual([]);
    await closeSession();
  });
});

// ---------------------------------------------------------------------------
// V5: the fallback arm.
// ---------------------------------------------------------------------------

describe("V5: articles whose url cannot be a key", () => {
  it("two url-less articles, an unusable url and a usable one all get distinct ids", async () => {
    // GREEN TODAY, and stated as coverage rather than as a red: it exists
    // because no fixture anywhere reached `art-run${runStamp}-${index}`, so
    // four separate mutations to that line survived the whole suite. The two
    // `url: ""` articles are what kill three of them -- `hashString("")` is a
    // constant, and a fallback without the index (or a constant `art-run`)
    // files both under one id.
    const got = await openSession(MIXED_RUN);
    expect(got, "an article was dropped: a missing or unusable url is not a duplicate").toHaveLength(MIXED_RUN.length);
    const ids = articleIds();
    expectUsableIds(ids, "the hook's article ids");
    expect(new Set(ids).size, `the hook's article ids were ${JSON.stringify(ids)}`).toBe(ids.length);
    await closeSession();
  });

  it("their facts reach the store under distinct ids", async () => {
    // The same run carried all the way to the wire, so a scheme that is
    // distinct in the hook's state and collapsed by the time the PUT is built
    // is caught here rather than passing above.
    await openSession(MIXED_RUN);
    const shown = await acceptEveryCardSeparately();
    expect(new Set(shown).size, "the four cards are not showing four distinct suggestions").toBe(shown.length);
    const body = lastBody();
    expect(body.facts.map((f) => f.text)).toEqual(shown);
    expectUsableIds(body.facts.map((f) => f.id), "body.facts ids");
    expect(collidingIds(body.facts), `body.facts were ${JSON.stringify(body.facts)}`).toEqual([]);
    expect(new Set(body.facts.map((f) => f.id)).size).toBe(body.facts.length);
    await closeSession();
  });

  it("a second run does not reuse the first run's fallback id for a different article", async () => {
    // GREEN TODAY. The fourth surviving mutant -- `runStamp` pinned to 0 --
    // is distinct WITHIN a run (the index still varies) and can only be seen
    // ACROSS runs, which is exactly the case the fallback's own comment calls
    // non-durable-but-distinct. Two different url-less articles, both at index
    // 0 of their run.
    await openSession([NO_URL_FIRST]);
    const first = articleIds();
    expectUsableIds(first, "run 1 ids");
    await closeSession();
    await pauseBetweenRuns();
    await openSession([NO_URL_SECOND]);
    const second = articleIds();
    expectUsableIds(second, "run 2 ids");
    expect(second[0], `both runs minted ${JSON.stringify(first[0])} for different url-less articles`).not.toBe(first[0]);
    await closeSession();
  });
});

// ---------------------------------------------------------------------------
// V3: spellings of one url.
// ---------------------------------------------------------------------------

describe("V3: equivalent spellings of one url are one article", () => {
  // Measured as the number of DISTINCT ids across the run, which is
  // indifferent to whether the duplicates were collapsed into one card or kept
  // as two: what is forbidden is one article wearing two identities. (Two
  // cards sharing one id is forbidden separately, by V1 above -- the two
  // together mean equivalent spellings must collapse, which is the owner's
  // ruled fix.)
  async function distinctIdsFor(articles, label) {
    await openSession(articles);
    const ids = articleIds();
    expectUsableIds(ids, label);
    const size = new Set(ids).size;
    await closeSession();
    return size;
  }

  it("the host's case does not change the id", async () => {
    expect(await distinctIdsFor(HOST_CASE, "host case")).toBe(1);
  });

  it("a fragment does not change the id", async () => {
    expect(await distinctIdsFor(FRAGMENT, "fragment")).toBe(1);
  });

  it("tracking parameters do not change the id", async () => {
    expect(await distinctIdsFor(TRACKING, "utm parameters")).toBe(1);
  });

  it("a trailing slash does not change the id", async () => {
    expect(await distinctIdsFor(TRAILING_SLASH, "trailing slash")).toBe(1);
  });

  it("stripping the tracking keeps the rest of the query", async () => {
    // The two-directional half of the tracking rule: same story, different
    // campaign. If this is satisfied by discarding the query outright, the
    // control below goes red.
    expect(await distinctIdsFor(TRACKED_SAME_STORY, "tracked same story")).toBe(1);
  });

  it("CONTROL (over-fires): genuinely different urls keep genuinely different ids", async () => {
    // GREEN TODAY, and the counterweight to every assertion above: "one id per
    // run" satisfies all five of them and would re-create V1 across four
    // different articles. Two differ by path, two by a meaningful query value
    // that is not a tracking parameter.
    await openSession(DIFFERENT_URLS);
    expect(hookArticles(), "a genuinely different article was deduped away").toHaveLength(DIFFERENT_URLS.length);
    const ids = articleIds();
    expectUsableIds(ids, "different urls");
    expect(new Set(ids).size, `four different urls produced ids ${JSON.stringify(ids)}`).toBe(DIFFERENT_URLS.length);
    await closeSession();
  });
});

// ---------------------------------------------------------------------------
// V3(b): the grounding redirect.
// ---------------------------------------------------------------------------

describe("V3(b): a grounding-redirect url carries no stable identity", () => {
  // Both tests run the IDENTICAL research payload twice and compare the id.
  // The pair is the instrument: the ordinary-url case is the canary proving
  // the comparison can observe equality at all, and the redirect case is the
  // property.
  async function idAcrossTwoRuns(articles) {
    await openSession(articles);
    const first = articleIds();
    expectUsableIds(first, "run 1 ids");
    await closeSession();
    await pauseBetweenRuns();
    await openSession(articles);
    const second = articleIds();
    expectUsableIds(second, "run 2 ids");
    await closeSession();
    return [first[0], second[0]];
  }

  it("CANARY: an ordinary url yields the same id in two runs", async () => {
    // GREEN TODAY, and the claim the derivation's own comment makes: "stable
    // for the SAME article across sessions". Load-bearing -- without it, the
    // redirect assertion below would be satisfied by a build that minted a
    // fresh id for everything, which would abandon the stability claim
    // entirely rather than scope it honestly.
    const [first, second] = await idAcrossTwoRuns([PLAIN_ARTICLE]);
    expect(second, "an ordinary article's id is no longer stable across runs").toBe(first);
  });

  it("a vertexaisearch redirect url does not", async () => {
    // The token in `grounding-api-redirect/<token>` is minted per request, so
    // an id derived from it is a stability claim about a string that is not
    // stable. The property is that the claim is not made -- whether by taking
    // the fallback arm or by normalizing the redirect away, no format is
    // pinned. The article itself must still be offered: route.js keeps an
    // unreachable grounded link on purpose because it still resolves in a
    // browser, so dropping the card would throw away a real research result.
    const [first, second] = await idAcrossTwoRuns([REDIRECT_ARTICLE]);
    expect(
      second,
      `both runs minted ${JSON.stringify(first)} from an opaque per-request redirect token`,
    ).not.toBe(first);
  });

  it("a redirect article and an ordinary one in one run do not share an id", async () => {
    // Cheap, and it closes the shape where the redirect is normalized to a
    // constant: every redirect article in a run would then be one card, which
    // is V1 again with a different cause.
    await openSession([REDIRECT_ARTICLE, SAFE_URL]);
    const ids = articleIds();
    expectUsableIds(ids, "mixed run ids");
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size, `ids were ${JSON.stringify(ids)}`).toBe(2);
    await closeSession();
  });
});

// WHAT THIS FILE CANNOT CATCH, stated so the next reader does not over-trust
// it. (1) It stops at the request body and at `sanitizeStoredFacts`; the
// route, the RPC and the `inserted_facts` column are not exercised. (2) It
// cannot see a WRONG but unique id -- one that is distinct, non-empty and
// derived from the other article's url -- because no id FORMAT is pinned
// anywhere. (3) V3 pins four equivalences and says nothing about scheme or the
// `www.` prefix in either direction, so an implementation that normalizes
// those, and one that does not, both pass. (4) The two cross-run tests depend
// on two research runs being distinguishable to the implementation's own
// per-run component; `pauseBetweenRuns` makes that true for a millisecond
// clock, and a build whose runs were genuinely indistinguishable would pass
// them for the wrong reason.
