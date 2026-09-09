// AC-12 — THE CALL-SITE CENSUS, AS AN EXECUTABLE INVARIANT.
// Plus AC-18 (the app/page.js line budget) and the Phase-1/Phase-2 boundary.
//
// ===========================================================================
// WHY r1'S SWEEP WAS BLIND, MEASURED
// ===========================================================================
//
// r1 swept for the strings `setMainTab(`, `setActiveSection(`, `setSelectedId(`,
// `setView(`, `setTab(`, `setMode(`. Executed over this repo, that sweep sees
// only INVOCATIONS. Of the 18 lines under `app/` (non-test) that reference
// `setMainTab`/`setActiveSection`, those terms match 7:
//
//     page.js:291, :303, :1890, :2364, StatusBar.js:278, :279,
//     useDuplicateApplyCheck.js:260
//
// The other 11 are two `useState` declarations and NINE hand-offs the sweep
// cannot see — page.js:1656, :2832, :2889, :3136, :3137, StatusBar.js:45,
// :46, :61 and useDuplicateApplyCheck.js:34. Every mutation that reaches the
// user goes through one of those. And `setView(` matches ZERO sites in the
// entire repo: `setView` is only ever handed off (LiveFeedTab.js:663
// `onChangeView={setView}`), with the real invocations on the far side at
// FeedToolbar.js:106,116. By the discipline of hrefSafety.sweep.test.js:14-15
// — "a sweep that silently matched nothing cannot pass" — a term matching zero
// sites is itself the defect.
//
// THE REWRITE, in four properties:
//
//   1. COMMENTS ARE STRIPPED FIRST. StatusBar.js:61 mentions `setMainTab` in
//      PROSE ("callbacks closed over page.js's own state (the dismissal set,
//      `setMainTab` + `setInterviewSearch`)"). An unstripped sweep registers
//      a comment as a call site, and the registry then documents a site that
//      does not exist. This file uses `lib/sourceScan/tokenizeSource.js`'s
//      `codeMask` view — comments, regex literals AND string contents blanked
//      — which is strictly stronger than the `stripComments` idiom
//      themeSystem.test.js:53-57 uses, and byte-aligned with the original so
//      line numbers survive.
//
//   2. EVERY REFERENCE IS CLASSIFIED, not just the callable-looking ones:
//      `declaration`, `invocation`, `jsx-attr-name` (`setMainTab={...}` — the
//      PROP name, not a reference to the variable), `object-key`
//      (`setMainTab: value`), `jsx-handoff` (`={setMainTab}` — the VALUE
//      position) and `identifier-handoff` (object shorthand, destructured
//      parameter, bare identifier). The two hand-off kinds are precisely what
//      r1 could not see.
//
//   3. IT ANCHORS ON (file, symbol, kind), never on a bare setter name.
//      `setMode` and `setTab` are heavily overloaded on non-navigation state
//      in this repo — colorMode.js:31, SettingsMenu.js:48,
//      DocumentPreviewDialog.js:167-168, PageEditor.js:63,
//      library/ImportDialog.js:28, login/page.js:33 — so a bare-name sweep
//      would drown in allow-listed false positives, and the allow-list would
//      become the place a real site hides. The NOT_SWEPT block below records
//      each excluded name WITH the reason and asserts it really does occur,
//      so an exclusion cannot be a typo.
//
//   4. THE CLASSIFIER IS EXERCISED AGAINST PLANTED SITES, permanently, at the
//      bottom of this file — one missed INVOCATION and one missed HAND-OFF.
//      The same block runs r1's terms over the same two plants and records
//      that they see only the first. A sweep that cannot demonstrate it
//      catches the shape it exists for is a sweep nobody should trust.
//
// ===========================================================================
// THE PROPERTY THIS FILE ENFORCES (r2 §6.2)
// ===========================================================================
//
// Six mutation paths must route through the stack; two rehydration sites must
// NOT. Expressed as an exact census of every remaining reference to the two
// raw setters:
//
//   app/page.js                     2 declarations (it owns the state)
//                                   2 invocations, and ONLY the two whose
//                                     argument is bound from
//                                     localStorage.getItem (page.js:291/:303)
//                                   2 jsx-attr-names + 1 object-key — prop
//                                     NAMES whose VALUES must be routed
//                                   ZERO jsx-handoffs, ZERO identifier-handoffs
//   app/components/StatusBar.js     2 destructured params + 2 invocations of
//                                     them (goToCard). Unchanged: page.js is
//                                     what binds those props to the routed
//                                     setters.
//   app/hooks/useDuplicateApplyCheck.js
//                                   1 destructured param + 1 invocation, same
//                                     reasoning.
//   anywhere else                   nothing at all.
//
// Plus the positive half: the routed symbols must actually APPEAR at each of
// the six sites. Without it an implementer could satisfy the census by
// deleting the navigations instead of routing them.
//
// NOTE ON THE LINE NUMBERS IN THE COMMENTS BELOW. They are r2's, taken at HEAD
// 32a0626, and they are citations rather than anchors: a separate, concurrent
// fix to app/page.js (the LibraryUpdateDialog dismissal path, r2 §2.7) already
// shifts everything past ~line 2000 down by 24. Nothing in this file matches
// on a line number — the registry is keyed on (file, symbol, kind) — precisely
// so that drift cannot break it, and the failure output prints the CURRENT
// line for each site it finds.
//
// PHASE 2 IS NOT IN SCOPE and is asserted against: the two new modules may not
// contain `pushState`, `replaceState`, `popstate`, `history.back`,
// `history.go`, or any import of `lib/activityLog`.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { tokenizeSource } from "../../lib/sourceScan/tokenizeSource.js";

const APP_DIR = path.join(process.cwd(), "app");
const PAGE_JS = path.join(APP_DIR, "page.js");

/** The two Phase 1 surface setters. Nothing else is swept — see NOT_SWEPT. */
const SYMBOLS = ["setMainTab", "setActiveSection"];

/**
 * The routed replacements `useSurfaceNav` returns. Accepted either as a
 * property of whatever the hook's result was bound to (`nav.goMainTab`) or as
 * a destructured bare identifier (`goMainTab`) — the same two-shape rule
 * hrefSafety.sweep.test.js's `isGated` uses, for the same reason: a source-
 * text rule must not force one particular local naming style.
 */
const ROUTED = { setMainTab: "goMainTab", setActiveSection: "goSection" };
const routedRe = (name, tail = "") => new RegExp(`(?:\\b[\\w$]+\\.)?\\b${name}\\b${tail}`);

/**
 * Names deliberately NOT swept, each with the reason, and each asserted to
 * really occur — so an exclusion can never be a silent typo the way r1's
 * `setView(` was.
 */
const NOT_SWEPT = [
  {
    name: "setSelectedId",
    why:
      "ExperienceTab.js:146's master-detail drill-down is component-local state that page.js unmounts " +
      "(page.js:3050-3052), so it is outside the descriptor r2 §4 rules on and outside Phase 1 entirely " +
      "(r2 §8.6 prices lifting it).",
  },
  {
    name: "setView",
    why:
      "LiveFeedTab.js:63's feed/queue toggle is component-local and unmounts with the tab. It is also " +
      "the name that proved r1's sweep was a string match rather than a census: `setView(` matches zero " +
      "sites repo-wide because the identifier is only ever handed off.",
  },
  {
    name: "setTab",
    why:
      "LibraryEditor.js:28's numeric sub-tab is component-local (the tab-0 case AC-B1b observes), and " +
      "the bare name is overloaded on unrelated state elsewhere, so sweeping it would produce an " +
      "allow-list long enough to hide a real site in.",
  },
  {
    name: "setMode",
    why:
      "CopilotClient.js:74's live/practice/roles mode is component-local, and `setMode` is the app's " +
      "most overloaded setter name — colorMode.js:31 and SettingsMenu.js:48 are the colour theme, not " +
      "navigation. This is the clearest case for anchoring on (file, symbol) rather than on a name.",
  },
];

// --------------------------------------------------------------------------
// The classifier
// --------------------------------------------------------------------------

const KINDS = [
  "declaration",
  "invocation",
  "jsx-attr-name",
  "object-key",
  "jsx-handoff",
  "identifier-handoff",
];

function lineAt(src, index) {
  return src.slice(0, index).split("\n").length;
}

/** Last non-whitespace character of `text`, or "". */
function lastNonSpace(text) {
  for (let i = text.length - 1; i >= 0; i -= 1) {
    if (!/\s/.test(text[i])) return { ch: text[i], at: i };
  }
  return { ch: "", at: -1 };
}

/** First non-whitespace character at or after `from`, or "". */
function firstNonSpace(text, from) {
  for (let i = from; i < text.length; i += 1) {
    if (!/\s/.test(text[i])) return { ch: text[i], at: i };
  }
  return { ch: "", at: -1 };
}

/** The balanced argument text of a call whose `(` is at `open`, read off `readable`. */
function callArgs(readable, open) {
  let depth = 0;
  for (let i = open; i < readable.length; i += 1) {
    if (readable[i] === "(") depth += 1;
    else if (readable[i] === ")") {
      depth -= 1;
      if (depth === 0) return readable.slice(open + 1, i).trim();
    }
  }
  return "";
}

/**
 * The balanced argument spans of every `name(...)` call, computed on
 * `codeMask` so a parenthesis inside a string cannot unbalance them. Used to
 * tell the ONE legitimate raw hand-off — the registration into
 * `useSurfaceNav({ mainTab, setMainTab, ... })`, which is how the hook gets
 * the setters it applies a popped descriptor with — from every other hand-off,
 * which is unrouted by definition.
 */
function callSpans(codeMask, name) {
  const spans = [];
  const re = new RegExp(`\\b${name}\\s*\\(`, "g");
  let m;
  while ((m = re.exec(codeMask)) !== null) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    for (let i = open; i < codeMask.length; i += 1) {
      if (codeMask[i] === "(") depth += 1;
      else if (codeMask[i] === ")") {
        depth -= 1;
        if (depth === 0) {
          spans.push([open, i]);
          break;
        }
      }
    }
  }
  return spans;
}

/**
 * Every reference to `symbol` in one source, classified. Operates on
 * `codeMask` (comments, regex literals and string CONTENTS all blanked) so a
 * setter named in prose or inside a string can never register.
 */
export function classifyReferences(rawSrc, symbol, label = "source") {
  const { readable, codeMask } = tokenizeSource(rawSrc, { label });
  const out = [];
  const re = new RegExp(`\\b${symbol}\\b`, "g");
  let m;
  while ((m = re.exec(codeMask)) !== null) {
    const start = m.index;
    const end = start + symbol.length;
    const prev = lastNonSpace(codeMask.slice(0, start));
    const next = firstNonSpace(codeMask, end);
    const line = lineAt(codeMask, start);

    let kind;
    let args;
    const declWindow = codeMask.slice(Math.max(0, start - 80), start + symbol.length + 40);
    if (new RegExp(`const\\s*\\[\\s*[A-Za-z_$][\\w$]*\\s*,\\s*${symbol}\\s*\\]\\s*=\\s*useState`).test(declWindow)) {
      kind = "declaration";
    } else if (next.ch === "(") {
      kind = "invocation";
      args = callArgs(readable, next.at);
    } else if (next.ch === "=" && codeMask[next.at + 1] !== "=" && firstNonSpace(codeMask, next.at + 1).ch === "{") {
      kind = "jsx-attr-name";
    } else if (next.ch === ":") {
      kind = "object-key";
    } else if (prev.ch === "{" && lastNonSpace(codeMask.slice(0, prev.at)).ch === "=" && next.ch === "}") {
      kind = "jsx-handoff";
    } else {
      kind = "identifier-handoff";
    }

    out.push({
      symbol,
      kind,
      line,
      args,
      index: start,
      registrationHandoff: callSpans(codeMask, "useSurfaceNav").some(([a, b]) => start > a && start < b),
      text: rawSrc.split("\n")[line - 1].trim().slice(0, 90),
    });
  }
  return out;
}

// --------------------------------------------------------------------------
// The registry: (file, symbol, kind) -> how many, and why they are allowed.
// Anything not on it is unregistered, and unregistered is the failure.
// --------------------------------------------------------------------------

const REGISTRY = [
  {
    file: "page.js",
    symbol: "setMainTab",
    kind: "declaration",
    count: 1,
    why: "page.js:200 — page.js owns mainTab; SURFACE_FIELDS is drawn on exactly this ownership (r2 §4).",
  },
  {
    file: "page.js",
    symbol: "setActiveSection",
    kind: "declaration",
    count: 1,
    why: "page.js:154 — page.js owns activeSection, which is why the label may name a section (AC-B1c).",
  },
  {
    file: "page.js",
    symbol: "setMainTab",
    kind: "invocation",
    count: 1,
    rehydration: true,
    why:
      "page.js:303's localStorage rehydration. It is a RESTORE, not a navigation: routing it would " +
      "open every cold start with a phantom entry pointing at `applying` (r2 §6.1, AC-19).",
  },
  {
    file: "page.js",
    symbol: "setActiveSection",
    kind: "invocation",
    count: 1,
    rehydration: true,
    why: "page.js:291's localStorage rehydration, same reason.",
  },
  {
    file: "page.js",
    symbol: "setMainTab",
    kind: "jsx-attr-name",
    count: 1,
    why:
      "page.js:3136 `setMainTab={...}` — StatusBar's PROP name, not a reference to page.js's setter. " +
      "The prop's VALUE must be the routed setter; asserted separately below.",
  },
  {
    file: "page.js",
    symbol: "setActiveSection",
    kind: "jsx-attr-name",
    count: 1,
    why: "page.js:3137 `setActiveSection={...}` — StatusBar's prop name, same reasoning.",
  },
  {
    file: "page.js",
    symbol: "setMainTab",
    kind: "object-key",
    count: 1,
    why:
      "page.js:1656's option name in the useDuplicateApplyCheck({...}) call. Today it is an object " +
      "SHORTHAND (`setMainTab,`), which is an identifier hand-off and therefore unrouted; routing it " +
      "makes it an explicit key (`setMainTab: nav.goMainTab`). That shorthand is one of the nine sites " +
      "r1's sweep could not see.",
  },
  {
    file: "page.js",
    symbol: "setMainTab",
    kind: "identifier-handoff",
    count: 1,
    registrationOnly: true,
    why:
      "THE ONE legitimate raw hand-off: the registration into " +
      "`useSurfaceNav({ mainTab, setMainTab, activeSection, setActiveSection })`. The hook needs the " +
      "raw setters to apply a popped descriptor with; every OTHER hand-off of the same identifier is " +
      "unrouted by definition. `registrationOnly` checks the enclosing call by its balanced argument " +
      "span, so this entry cannot be borrowed to launder page.js:1656's object shorthand.",
  },
  {
    file: "page.js",
    symbol: "setActiveSection",
    kind: "identifier-handoff",
    count: 1,
    registrationOnly: true,
    why: "The other half of the same registration hand-off into useSurfaceNav.",
  },
  {
    file: "hooks/useSurfaceNav.js",
    symbol: "setMainTab",
    kind: "identifier-handoff",
    count: 4,
    optional: true,
    why:
      "The routing layer's own destructured parameter. This module is WHERE the raw setter is supposed " +
      "to end up — the census exists to prove nothing else calls it. `optional` because the parameter " +
      "may legitimately be named or destructured differently; the bounded count still stops the stack " +
      "itself from sprouting extra call sites.",
  },
  {
    file: "hooks/useSurfaceNav.js",
    symbol: "setActiveSection",
    kind: "identifier-handoff",
    count: 4,
    optional: true,
    why: "The routing layer's other destructured parameter, same reasoning.",
  },
  {
    file: "hooks/useSurfaceNav.js",
    symbol: "setMainTab",
    kind: "invocation",
    count: 4,
    optional: true,
    why:
      "applyState: the raw setter is invoked here when a descriptor is applied (a navigate, and a back " +
      "press). This is the one file in the app allowed to do it.",
  },
  {
    file: "hooks/useSurfaceNav.js",
    symbol: "setActiveSection",
    kind: "invocation",
    count: 4,
    optional: true,
    why: "applyState's other half.",
  },
  {
    file: "components/StatusBar.js",
    symbol: "setMainTab",
    kind: "identifier-handoff",
    count: 1,
    why: "StatusBar.js:45 — a destructured PROP. page.js binds it; StatusBar itself needs no change.",
  },
  {
    file: "components/StatusBar.js",
    symbol: "setActiveSection",
    kind: "identifier-handoff",
    count: 1,
    why: "StatusBar.js:46 — a destructured prop, same reasoning.",
  },
  {
    file: "components/StatusBar.js",
    symbol: "setMainTab",
    kind: "invocation",
    count: 1,
    why:
      "StatusBar.js:278, inside goToCard — invokes the prop, which page.js has bound to the routed " +
      "setter. This is half of r2 §6.2's two-level gesture; AC-4 pins that the pair yields ONE entry.",
  },
  {
    file: "components/StatusBar.js",
    symbol: "setActiveSection",
    kind: "invocation",
    count: 1,
    why: "StatusBar.js:279, the other half of goToCard.",
  },
  {
    file: "hooks/useDuplicateApplyCheck.js",
    symbol: "setMainTab",
    kind: "identifier-handoff",
    count: 1,
    why: "useDuplicateApplyCheck.js:34 — a destructured option; page.js binds it.",
  },
  {
    file: "hooks/useDuplicateApplyCheck.js",
    symbol: "setMainTab",
    kind: "invocation",
    count: 1,
    why:
      "useDuplicateApplyCheck.js:260, inside onOpenApplications — the fourth programmatic jump, absent " +
      "from r1's three-jump list entirely (AC-5).",
  },
];

// --------------------------------------------------------------------------
// The walk
// --------------------------------------------------------------------------

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".js") && !entry.endsWith(".test.js")) out.push(full);
  }
  return out;
}

const rel = (full) => path.relative(APP_DIR, full).split(path.sep).join("/");

function auditSources(sources) {
  const sites = [];
  for (const { file, src } of sources) {
    for (const symbol of SYMBOLS) {
      for (const ref of classifyReferences(src, symbol, file)) sites.push({ file, src, ...ref });
    }
  }

  const unregistered = [];
  for (const site of sites) {
    const entry = REGISTRY.find(
      (e) => e.file === site.file && e.symbol === site.symbol && e.kind === site.kind,
    );
    if (!entry) {
      unregistered.push({ ...site, reason: `no registry entry for (${site.file}, ${site.symbol}, ${site.kind})` });
      continue;
    }
    if (entry.registrationOnly && !site.registrationHandoff) {
      unregistered.push({
        ...site,
        reason:
          "this hands the RAW setter to something other than useSurfaceNav. The only raw hand-off " +
          "page.js may make is the registration into the hook itself; everything else must be handed " +
          "the routed setter.",
      });
      continue;
    }
    if (entry.rehydration) {
      // Only a call whose argument is an identifier this file binds from
      // localStorage.getItem is a rehydration. A string-literal argument
      // (`setMainTab("interviewing")`) is a NAVIGATION and must be routed.
      const arg = site.args || "";
      const isBoundFromStorage =
        /^[A-Za-z_$][\w$]*$/.test(arg) &&
        new RegExp(`\\b${arg}\\s*=\\s*localStorage\\.getItem\\s*\\(`).test(site.src);
      if (!isBoundFromStorage) {
        unregistered.push({
          ...site,
          reason:
            `${site.symbol}(${arg}) is a NAVIGATION, not a rehydration — its argument is not an ` +
            `identifier bound from localStorage.getItem. It must route through the stack.`,
        });
      }
    }
  }

  const counts = new Map();
  for (const site of sites) {
    const key = `${site.file}|${site.symbol}|${site.kind}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const overCount = REGISTRY.filter((e) => {
    const seen = counts.get(`${e.file}|${e.symbol}|${e.kind}`) || 0;
    return seen > e.count;
  }).map((e) => ({
    ...e,
    seen: counts.get(`${e.file}|${e.symbol}|${e.kind}`),
  }));

  return { sites, unregistered, counts, overCount };
}

const REAL_SOURCES = walk(APP_DIR).map((full) => ({ file: rel(full), src: readFileSync(full, "utf8") }));
const REAL = auditSources(REAL_SOURCES);

const describeSite = (s) =>
  `${s.file}:${s.line} [${s.kind}] ${s.text}` + (s.reason ? `\n      -> ${s.reason}` : "");

// ==========================================================================

describe("AC-12 — the sweep can see anything at all", () => {
  it("finds every reference kind it exists to classify, so no branch is dead", () => {
    const kinds = new Set(REAL.sites.map((s) => s.kind));
    expect(REAL.sites.length, "the sweep matched nothing — it cannot pass empty").toBeGreaterThanOrEqual(13);
    for (const kind of ["declaration", "invocation", "identifier-handoff"]) {
      expect(kinds, `no ${kind} classified anywhere under app/`).toContain(kind);
    }
  });

  it("does not count a setter named in a comment", () => {
    // StatusBar.js:61 is prose. If it registered, the census below would be
    // documenting a call site that does not exist.
    const statusBar = REAL.sites.filter((s) => s.file === "components/StatusBar.js");
    expect(
      statusBar.some((s) => s.line === 61),
      "StatusBar.js:61 mentions setMainTab in a COMMENT and must not be a site",
    ).toBe(false);
    expect(statusBar.length, "…but the file's four real sites must still be found").toBe(4);
  });

  it("every registry entry matches at least one real site", () => {
    // A stale entry is a place a real site can hide, and it is exactly how a
    // census stops being a census.
    const stale = REGISTRY.filter(
      (e) => !e.optional && !(REAL.counts.get(`${e.file}|${e.symbol}|${e.kind}`) > 0),
    );
    expect(
      stale.map((e) => `${e.file} ${e.symbol} ${e.kind}`),
      "these registry entries match nothing — the code moved and the registry did not",
    ).toEqual([]);
  });

  it("every excluded setter name is a real name, deliberately left out", () => {
    const all = REAL_SOURCES.map((s) => s.src).join("\n");
    for (const entry of NOT_SWEPT) {
      expect(
        new RegExp(`\\b${entry.name}\\b`).test(all),
        `${entry.name} does not occur under app/ at all — an exclusion that excludes nothing is a typo`,
      ).toBe(true);
      expect(entry.why.length, `${entry.name} needs a written reason`).toBeGreaterThan(60);
    }
  });
});

describe("AC-12 — every surface mutation is on the registry", () => {
  it("no unregistered reference to a raw surface setter survives under app/", () => {
    expect(
      REAL.unregistered.map(describeSite),
      "Each line below mutates or hands off `mainTab`/`activeSection` without going through the " +
        "navigation stack, so the back button cannot know the user was ever there (r2 §6.2).\n" +
        "Route it through useSurfaceNav's goMainTab/goSection/navigate, or add a registry entry with a " +
        "written reason.",
    ).toEqual([]);
  });

  it("no (file, symbol, kind) appears more often than the registry allows", () => {
    expect(
      REAL.overCount.map((e) => `${e.file} ${e.symbol} ${e.kind}: ${e.seen} sites, ${e.count} allowed`),
      "an extra site of an allowed shape is still an unrouted site",
    ).toEqual([]);
  });

  it("app/page.js hands off NOTHING raw except the registration into the hook", () => {
    // The nine sites r1's sweep could not see are all in this shape. After the
    // fix page.js may still NAME the props (`setMainTab={...}`, `setMainTab:`)
    // but may never pass the raw setter as their value — with exactly one
    // exception, `useSurfaceNav({ mainTab, setMainTab, ... })` itself, which is
    // how the hook gets the setters it applies a popped descriptor with.
    const raw = REAL.sites.filter(
      (s) =>
        s.file === "page.js" &&
        !s.registrationHandoff &&
        (s.kind === "jsx-handoff" || s.kind === "identifier-handoff"),
    );
    expect(
      raw.map(describeSite),
      "page.js:2832 `onChange={setMainTab}`, page.js:2889 `onChange={setActiveSection}`, " +
        "page.js:3136/:3137's prop values and page.js:1656's object shorthand are the hand-offs that " +
        "make the stack blind. Each must pass the routed setter instead.",
    ).toEqual([]);
  });
});

describe("AC-12 — the six mutation paths actually route (r2 §6.2)", () => {
  const pageSrc = existsSync(PAGE_JS) ? readFileSync(PAGE_JS, "utf8") : "";
  const pageCode = pageSrc ? tokenizeSource(pageSrc, { label: "page.js" }).readable : "";

  const SITES = [
    ["1 — the main tab strip (page.js:2832)", /onChange=\{(?:[\w$]+\.)?goMainTab\}/],
    ["2 — the section sub-tabs (page.js:2889)", /onChange=\{(?:[\w$]+\.)?goSection\}/],
    ["3 — toggling an already-applied job (page.js:1890)", /(?:[\w$]+\.)?goMainTab\(\s*"interviewing"\s*\)/],
    ["4 — after a no-download batch tailor (page.js:2364)", /(?:[\w$]+\.)?goMainTab\(\s*"applying"\s*\)/],
    ["5 — StatusBar.goToCard's two props (page.js:3136-3137)", /setMainTab=\{(?:[\w$]+\.)?goMainTab\}/],
    ["5 — StatusBar.goToCard's two props (page.js:3136-3137)", /setActiveSection=\{(?:[\w$]+\.)?goSection\}/],
    ["6 — useDuplicateApplyCheck's option (page.js:1656)", /setMainTab:\s*(?:[\w$]+\.)?goMainTab/],
  ];

  it("app/page.js consumes the hook", () => {
    expect(
      /useSurfaceNav/.test(pageCode),
      "page.js must call useSurfaceNav({ mainTab, setMainTab, activeSection, setActiveSection }). " +
        "The stack, the labels and the button all live outside this file (r2 §5); page.js only consumes.",
    ).toBe(true);
  });

  for (const [label, pattern] of SITES) {
    it(`routes path ${label}`, () => {
      expect(pattern.test(pageCode), `no match for ${pattern} in app/page.js`).toBe(true);
    });
  }

  it("the two rehydration sites are deliberately NOT routed", () => {
    expect(
      /setMainTab\(\s*savedTab\s*\)/.test(pageCode),
      "page.js:303 must keep calling the RAW setter — a routed rehydration pushes a phantom entry on " +
        "every cold start (r2 §6.1, AC-19)",
    ).toBe(true);
    expect(/setActiveSection\(\s*saved\s*\)/.test(pageCode), "page.js:291 must stay raw too").toBe(true);
  });

  it("the provider is mounted above the header, not inside a page", () => {
    // r2 §5: the stack lives in a provider in app/layout.js, ABOVE
    // <AppHeader />, because the header and page.js are siblings. Mounted
    // anywhere below either one and the control and the surfaces would hold
    // two different stacks.
    const candidates = ["layout.js", "components/Providers.js"]
      .map((f) => path.join(APP_DIR, f))
      .filter(existsSync)
      .map((f) => readFileSync(f, "utf8"));
    expect(
      candidates.some((src) => /<SurfaceNavProvider/.test(src)),
      "neither app/layout.js nor app/components/Providers.js renders <SurfaceNavProvider>",
    ).toBe(true);
  });
});

// ==========================================================================
// AC-18 — the app/page.js line budget (r2 §5, B-3)
// ==========================================================================

describe("AC-18 — the feature fits in app/page.js's remaining headroom", () => {
  // WHY THIS IS ONE `it` AND NOT THREE. A bare `lines < 3050` passes today,
  // against a page.js that does not carry the feature — a green assertion
  // defending nothing. The budget is only meaningful once the feature is IN
  // the file, so the two are asserted together and fail together.
  //
  // WHY THE BUDGET IS A FOOTPRINT AND NOT `baseline + 10`. r2 §5 measured
  // app/page.js at 3207 lines and derived 42 lines of headroom. That figure is
  // correct at HEAD 32a0626 and ALREADY STALE in the working tree: a separate,
  // concurrent fix to the LibraryUpdateDialog dismissal path (r2 §2.7's
  // "being fixed separately") adds +24 lines to this same file, taking it to
  // 3231 and the headroom to 18. An absolute `<= 3217` assertion would
  // therefore fail on a change that has nothing to do with the back button —
  // the classic false failure that gets a budget test deleted.
  //
  // So the budget is expressed the way r2 §5's own cost table argues it: SIX
  // of the seven touched sites are SUBSTITUTIONS (`onChange={setMainTab}` ->
  // `onChange={nav.goMainTab}`) and cost zero net lines; only the import and
  // the hook call are additions. Net cost = feature-mentioning lines minus the
  // substitution sites. That is robust against formatting (a hook call broken
  // over six lines is still one site) and against every other edit to the
  // file, while still failing loudly if the stack, the label table or the mode
  // computation is inlined here instead of living in the new modules.
  const FEATURE_BUDGET = 10;
  const FEATURE_VOCAB = /useSurfaceNav|SurfaceNavProvider|SURFACE_FIELDS|goMainTab|goSection|surfaceStack|BackButton/;

  /** The seven substitution sites r2 §5 prices at zero net lines. */
  const SUBSTITUTIONS = [
    /onChange=\{(?:[\w$]+\.)?goMainTab\}/,
    /onChange=\{(?:[\w$]+\.)?goSection\}/,
    /(?:[\w$]+\.)?goMainTab\(\s*"interviewing"\s*\)/,
    /(?:[\w$]+\.)?goMainTab\(\s*"applying"\s*\)/,
    /setMainTab=\{(?:[\w$]+\.)?goMainTab\}/,
    /setActiveSection=\{(?:[\w$]+\.)?goSection\}/,
    /setMainTab:\s*(?:[\w$]+\.)?goMainTab/,
  ];

  it("carries the feature, stays under the shipped ceiling, and costs <= 10 net lines", () => {
    const src = readFileSync(PAGE_JS, "utf8");
    const lines = src.split("\n");

    expect(
      FEATURE_VOCAB.test(src),
      "app/page.js does not mention the navigation stack at all, so every measurement below would be " +
        "made against the file BEFORE the feature and would prove nothing about its cost.",
    ).toBe(true);

    // Deliberately duplicated from the four assertions in four other files, so
    // the ceiling fails HERE, at implementation time, rather than in an
    // unrelated suite: app/page.untrackChip.wiring.test.js:121 (<3050),
    // app/components/DocumentPreviewMount.test.js:81 (<3050),
    // lib/feed/feedTailorFullDescription.test.js:102 (<=3050) and
    // lib/drive/lineCeiling.test.js:32 (<3309, with :27-31 recording "Do not
    // raise the constant"). The binding cap is 3249, not 3050 — the two
    // `toBeLessThan(3050)` assertions are stricter than the
    // `toBeLessThanOrEqual` one.
    // RATCHETED 3250 -> 3050 on 2026-09-08, in all five places at once, after
    // an extraction took app/page.js from 3233 to 2965 by moving three domain
    // hooks out (useLayoutPrefs, useEmploymentImport, useMaterialsLocker).
    // Leaving the cap at 3250 would have let the file silently regrow into the
    // 268 lines just freed, which is the whole failure mode these pins exist to
    // stop -- a ceiling that only ever rises measures nothing. 3050 keeps ~85
    // lines of ordinary working room.
    //
    // Worth knowing before raising it again: react-hooks v7's compiler analysis
    // BAILS OUT on a component this size, measured by lifting page.js's own
    // mount-hydration effect verbatim into a probe module, where
    // `react-hooks/set-state-in-effect` fires -- while `npx eslint app/page.js`
    // stays silent. Roughly eight effects in that file are therefore unlinted.
    // The cap is not stylistic; below some size the linter starts working again.
    expect(
      lines.length,
      `app/page.js is ${lines.length} lines and has blown the ceiling four other test files also pin`,
    ).toBeLessThan(3050);

    const mentions = lines.filter((line) => FEATURE_VOCAB.test(line));
    const substitutions = mentions.filter((line) => SUBSTITUTIONS.some((re) => re.test(line)));
    const netAdded = mentions.length - substitutions.length;

    expect(
      netAdded,
      `the feature touches ${mentions.length} lines in app/page.js, of which ${substitutions.length} ` +
        `are substitutions on lines that already existed, for a net cost of ${netAdded}. r2 §5 ` +
        `itemises Phase 1 at about +2, because the stack, the descriptor labels, the mode computation ` +
        `and the button all live in NEW files (app/hooks/useSurfaceNav.js, app/components/BackButton.js) ` +
        `with the provider mounted in app/layout.js. If it will not fit, the named fallback is ` +
        `extracting the ChatFab/ChatPanel mount block, which ` +
        `app/components/ChatFab.keyboard.test.js:16-21 already documents as an intended extraction — ` +
        `"The fix is therefore an EXTRACTION, which makes page.js SMALLER, not larger."`,
    ).toBeLessThanOrEqual(FEATURE_BUDGET);
  });
});

// ==========================================================================
// The Phase 1 / Phase 2 boundary
// ==========================================================================

describe("Phase 1 touches no browser history and no activity log (r2 §0, §8)", () => {
  const NEW_MODULES = ["hooks/useSurfaceNav.js", "components/BackButton.js"];
  const BANNED = [
    ["pushState", "the history mirror is Phase 2 and is NOT approved"],
    ["replaceState", "same"],
    ["popstate", "there is no mirror to listen to, and a handler here needs the §8.2 nonce guard"],
    ["history.back", "Phase 1's control pops the stack directly (r2 §6.1)"],
    ["history.go", "same"],
    ["activityLog", "lib/activityLog owns pushState globally; touching it is Phase 2's §8.3 prerequisite"],
  ];

  for (const mod of NEW_MODULES) {
    it(`app/${mod} exists and stays inside Phase 1`, () => {
      const full = path.join(APP_DIR, mod);
      expect(existsSync(full), `app/${mod} does not exist`).toBe(true);
      // `readable`, NOT `codeMask`. MEASURED: a first draft of this guard used
      // `codeMask`, which blanks string CONTENTS, and a planted
      // `addEventListener("popstate", ...)` walked straight through it — the
      // event name is a string literal, and so is every `lib/activityLog`
      // import specifier. `readable` blanks comments (so prose about Phase 2,
      // including this file's own, cannot trip it) while keeping string
      // contents, which is exactly the view this check needs.
      const { readable } = tokenizeSource(readFileSync(full, "utf8"), { label: mod });
      const offenders = BANNED.filter(([needle]) => readable.includes(needle)).map(
        ([needle, why]) => `${needle}: ${why}`,
      );
      expect(
        offenders,
        `app/${mod} reaches into Phase 2. Phase 2 costs a popstate handler, a per-page-load nonce, a ` +
          `predicate over 24 overlays and surgery on the downloadable activity log — none of which the ` +
          `user asked for, and none of which is approved.`,
      ).toEqual([]);
    });
  }
});

// ==========================================================================
// THE PLANTED SITES — the positive control for the whole file
// ==========================================================================

describe("the classifier itself, against deliberately missed sites", () => {
  // r1's sweep, verbatim: a bare string match on the callable form.
  const r1Terms = (src, symbol) => (src.match(new RegExp(`${symbol}\\(`, "g")) || []).length;

  const PLANT_INVOCATION = '\n  const x = <div onClick={() => setMainTab("feed")} />;\n';
  const PLANT_HANDOFF = "\n  const y = <Thing onPick={setActiveSection} />;\n";

  const pageSrc = readFileSync(PAGE_JS, "utf8");

  it("flags a planted INVOCATION that nobody routed", () => {
    const audit = auditSources([{ file: "page.js", src: pageSrc + PLANT_INVOCATION }]);
    const flagged = audit.unregistered.concat(audit.overCount);
    expect(
      flagged.length,
      "a raw setMainTab(\"feed\") added to page.js must not pass the census",
    ).toBeGreaterThan(auditSources([{ file: "page.js", src: pageSrc }]).unregistered.length);
    expect(
      audit.sites.some((s) => s.kind === "invocation" && s.args === '"feed"'),
      "the plant was not even classified",
    ).toBe(true);
  });

  it("flags a planted HAND-OFF that r1's sweep could not see", () => {
    const audit = auditSources([{ file: "page.js", src: pageSrc + PLANT_HANDOFF }]);
    const planted = audit.sites.filter((s) => s.kind === "jsx-handoff" && s.symbol === "setActiveSection");
    expect(planted.length, "`onPick={setActiveSection}` was not classified as a hand-off").toBeGreaterThan(0);
    expect(
      audit.unregistered.some((u) => u.kind === "jsx-handoff"),
      "a hand-off of the raw setter must be unregistered — page.js is allowed no jsx-handoffs at all",
    ).toBe(true);
  });

  it("records that r1's terms see the invocation and MISS the hand-off", () => {
    // The measurement that justifies rewriting AC-12 at all. Not a claim in
    // prose: run both plants through r1's own sweep and count.
    const base = { setMainTab: r1Terms(pageSrc, "setMainTab"), setActiveSection: r1Terms(pageSrc, "setActiveSection") };
    const withInvocation = r1Terms(pageSrc + PLANT_INVOCATION, "setMainTab");
    const withHandoff = r1Terms(pageSrc + PLANT_HANDOFF, "setActiveSection");

    expect(withInvocation, "r1's `setMainTab(` does catch a planted invocation").toBe(base.setMainTab + 1);
    expect(
      withHandoff,
      "r1's `setActiveSection(` is blind to `onPick={setActiveSection}` — the hand-off shape that " +
        "covers nine of the eighteen real sites, including every one r2 §5's own cost list names first",
    ).toBe(base.setActiveSection);
  });

  it("ignores a setter named inside a string or a comment", () => {
    const src = [
      'const note = "call setMainTab(\\"feed\\") here";',
      "// setActiveSection(\"manual\") is prose, not code",
      "/* setMainTab({}) */",
    ].join("\n");
    expect(classifyReferences(src, "setMainTab")).toEqual([]);
    expect(classifyReferences(src, "setActiveSection")).toEqual([]);
  });

  it("separates a prop NAME from the value handed to it", () => {
    const both = classifyReferences("<StatusBar setMainTab={setMainTab} />", "setMainTab");
    expect(both.map((s) => s.kind)).toEqual(["jsx-attr-name", "jsx-handoff"]);

    const routed = classifyReferences("<StatusBar setMainTab={nav.goMainTab} />", "setMainTab");
    expect(
      routed.map((s) => s.kind),
      "once the value is routed only the prop NAME remains — which is what makes the census's " +
        "\"page.js hands off nothing raw\" rule expressible at all",
    ).toEqual(["jsx-attr-name"]);
  });

  it("separates an object shorthand from an explicit routed key", () => {
    expect(classifyReferences("useDuplicateApplyCheck({ trackedJobs, setMainTab, x });", "setMainTab").map((s) => s.kind))
      .toEqual(["identifier-handoff"]);
    expect(classifyReferences("useDuplicateApplyCheck({ setMainTab: nav.goMainTab });", "setMainTab").map((s) => s.kind))
      .toEqual(["object-key"]);
  });

  it("tells the ONE legitimate raw hand-off apart from every other one", () => {
    // Without this discrimination the registry entry that permits
    // `useSurfaceNav({ mainTab, setMainTab, ... })` would also permit
    // page.js:1656's `useDuplicateApplyCheck({ ..., setMainTab })` — the exact
    // site r2 §6.2 row 6 requires to be routed.
    const registration = classifyReferences(
      "const nav = useSurfaceNav({ mainTab, setMainTab, activeSection, setActiveSection });",
      "setMainTab",
    );
    expect(registration.map((s) => s.kind)).toEqual(["identifier-handoff"]);
    expect(registration[0].registrationHandoff).toBe(true);

    const laundered = classifyReferences(
      "const nav = useSurfaceNav({ mainTab, setMainTab, activeSection, setActiveSection });\n" +
        "const dupe = useDuplicateApplyCheck({ trackedJobs, setMainTab });",
      "setMainTab",
    );
    expect(laundered).toHaveLength(2);
    expect(
      laundered[1].registrationHandoff,
      "a hand-off OUTSIDE the useSurfaceNav call must not inherit the registration exemption",
    ).toBe(false);
  });

  it("does not mistake a comparison for a JSX attribute", () => {
    expect(classifyReferences("if (setMainTab === other) {}", "setMainTab").map((s) => s.kind))
      .toEqual(["identifier-handoff"]);
  });

  it("classifies a useState declaration as a declaration, not a hand-off", () => {
    expect(classifyReferences('const [mainTab, setMainTab] = useState("applying");', "setMainTab").map((s) => s.kind))
      .toEqual(["declaration"]);
  });

  it("every kind the classifier can emit is one the registry vocabulary knows", () => {
    for (const site of REAL.sites) expect(KINDS).toContain(site.kind);
    expect(routedRe(ROUTED.setMainTab).test("nav.goMainTab")).toBe(true);
    expect(routedRe(ROUTED.setActiveSection).test("goSection")).toBe(true);
  });
});
