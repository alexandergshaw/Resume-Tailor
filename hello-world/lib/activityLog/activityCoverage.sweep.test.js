// "EVERYTHING THAT HAS HAPPENED", AS AN EXECUTABLE DEFINITION.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
// ---------------------------------------------------------------------------
// The owner asked for "logs [that] encompass everything that has happened on
// the app in that session". A comment saying "this captures everything" is a
// claim nothing can falsify, and a log that quietly misses whole subsystems is
// worse than one that states its scope honestly -- a reader cannot tell
// "nothing happened" from "this subsystem does not report".
//
// So the scope is a REGISTRY (lib/activityLog/activityChannels.js), the
// registry is what the downloaded file prints, and this sweep is what keeps the
// registry true:
//
//   1. Three of the four channels are CHOKE POINTS -- one wrapper each around
//      `fetch`, the error surfaces and `history`. Nothing has to opt in, so a
//      subsystem nobody thought about is captured anyway. That the wrappers
//      actually fire is proved behaviourally in activityInstrumentation.test.js;
//      what THIS file proves is the complement: that nothing in the tree
//      reaches the network or changes the page AROUND those wrappers without
//      being named, in the file the user downloads, as something it does not
//      contain.
//
//   2. The fourth channel is a CALL SITE (`recordActivity`), and a call-site
//      channel can always be forgotten. The registry says so in those words,
//      and the document prints it.
//
// A new WebSocket-based subsystem, a new full-page navigation, or a new feature
// log therefore fails this sweep on the day it is written, until someone either
// routes it through the recorder or writes down -- in the artifact itself --
// that it is not covered.
//
// It uses the same shared, regex-literal-aware stripper the other four sweeps
// in this repo use (lib/sourceScan/tokenizeSource.js) rather than a private
// copy: an earlier private fork was silently wrong and under-reported real
// sites with no error at all.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { tokenizeSource } from "../sourceScan/tokenizeSource.js";
import { CAPTURED_CHANNELS, UNCAPTURED_SURFACES, FEATURE_LOG_LEDGER } from "./activityChannels.js";
import { renderActivityLog } from "./activityLogDocument.js";
import { createActivityLog } from "./appActivityLog.js";

const ROOT = process.cwd();
const rel = (full) => path.relative(ROOT, full).split(path.sep).join("/");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".js")) out.push(full);
  }
  return out;
}

/** Every production .js under app/ and lib/, code-masked. */
function readTree() {
  const files = new Map();
  for (const dir of ["app", "lib"]) {
    for (const full of walk(path.join(ROOT, dir))) {
      const r = rel(full);
      if (r.endsWith(".test.js")) continue;
      files.set(r, readFileSync(full, "utf8"));
    }
  }
  return files;
}
const TREE = readTree();

// ---------------------------------------------------------------------------
// THE BYPASS CENSUS.
//
// Everything a browser tab can do that the three choke points cannot see. A
// `fetch` needs no entry here -- that IS the choke point. These are the ways
// around it.
// ---------------------------------------------------------------------------
const BYPASS_PATTERNS = [
  { id: "websocket", re: /\bnew\s+WebSocket\s*\(/g },
  { id: "xhr", re: /\bnew\s+XMLHttpRequest\s*\(/g },
  { id: "eventsource", re: /\bnew\s+EventSource\s*\(/g },
  { id: "beacon", re: /\bsendBeacon\s*\(/g },
  { id: "full-page-navigation", re: /\blocation\s*\.\s*(?:assign|replace)\s*\(/g },
  { id: "href-navigation", re: /\blocation\s*\.\s*href\s*=/g },
  { id: "new-window", re: /\bwindow\s*\.\s*open\s*\(|(?<![\w.])open\s*\(\s*(?:url|target|posting)/g },
];

/**
 * @returns Map<file, Set<patternId>> -- only real code counts; a statement
 * written inside a comment, a string or a template literal is not a bypass.
 */
function censusBypasses(files) {
  const found = new Map();
  for (const [file, src] of files) {
    let code;
    try {
      code = tokenizeSource(src).codeMask;
    } catch {
      // A file the shared tokenizer refuses is a finding, not a skip: it would
      // otherwise be a silent hole in this census.
      code = src;
    }
    for (const { id, re } of BYPASS_PATTERNS) {
      re.lastIndex = 0;
      if (re.test(code)) {
        if (!found.has(file)) found.set(file, new Set());
        found.get(file).add(id);
      }
    }
  }
  return found;
}
const BYPASSES = censusBypasses(TREE);

/** Every module any UNCAPTURED_SURFACES entry claims responsibility for. */
const LEDGERED_MODULES = new Set(UNCAPTURED_SURFACES.flatMap((s) => s.modules || []));

describe("the census actually ran", () => {
  // A sweep that finds nothing because its scanner is broken is
  // indistinguishable from a clean codebase (exportReachability.sweep.test.js's
  // own words). These are the floors that make everything below non-vacuous.
  it("reads a real, whole tree", () => {
    expect(TREE.size).toBeGreaterThanOrEqual(400);
    expect(TREE.has("app/components/SettingsMenu.js")).toBe(true);
    expect(TREE.has("lib/activityLog/activityChannels.js")).toBe(true);
  });

  it("finds the bypasses this app is known to have", () => {
    // Named, real sites. If the tokenizer or a pattern regresses these vanish
    // and every "is it accounted for?" assertion below passes on an empty set.
    expect([...BYPASSES.keys()]).toContain("lib/copilot/stt/deepgram.js");
    expect([...BYPASSES.keys()]).toContain("lib/window/openPostingBeside.js");
    expect(BYPASSES.get("lib/copilot/stt/deepgram.js").has("websocket")).toBe(true);
    expect(BYPASSES.size).toBeGreaterThanOrEqual(6);
  });

  it("does not count a bypass written in a comment or a string", () => {
    // lib/sourceScan/tokenizeSource.js's own header quotes `window.open(`
    // several times in prose, and app/api/drive/oauth2callback/route.js emits
    // `window.location.replace("/")` inside an HTML string it sends to the
    // browser. Neither is a bypass in THIS tab's code.
    expect(TREE.get("lib/sourceScan/tokenizeSource.js")).toContain("window.open(");
    expect(BYPASSES.has("lib/sourceScan/tokenizeSource.js")).toBe(false);
  });
});

describe("[THE DEFINITION] every way around the choke points is written down", () => {
  it("accounts for every bypassing module in UNCAPTURED_SURFACES", () => {
    // THE load-bearing assertion of this whole feature. A new subsystem that
    // talks to the network or moves the page without going through `fetch`
    // fails here, and the only two ways to go green are to route it through the
    // recorder or to declare it -- in the artifact the user downloads -- as
    // something the file does not contain.
    const unaccounted = [...BYPASSES.keys()].filter((file) => !LEDGERED_MODULES.has(file));
    expect(
      unaccounted.sort(),
      "a subsystem bypasses the activity log's choke points and the log never says so",
    ).toEqual([]);
  });

  it("keeps every ledgered module real, and every entry non-empty", () => {
    // The reverse direction, deliberately checked as "the file still exists"
    // rather than "the file still bypasses": app/page.js is a 3000-line god
    // component under continuous edit and one of five identical `window.open`
    // call sites; a ledger entry going momentarily stale there must not fail
    // the gate that catches real new holes. A wholly deleted module does.
    expect(LEDGERED_MODULES.size).toBeGreaterThanOrEqual(8);
    for (const file of LEDGERED_MODULES) {
      expect(TREE.has(file), `${file} is on the not-captured ledger but no longer exists`).toBe(true);
    }
    for (const surface of UNCAPTURED_SURFACES) {
      expect(surface.what.length, `${surface.id} does not say what it is`).toBeGreaterThan(20);
      expect(surface.why.length, `${surface.id} is excused with no reason`).toBeGreaterThan(40);
    }
  });

  it("declares the server side, which no browser log can see", () => {
    const routes = [...TREE.keys()].filter((f) => f.startsWith("app/api/") && f.endsWith("/route.js"));
    expect(routes.length).toBeGreaterThan(50);
    const serverEntry = UNCAPTURED_SURFACES.find((s) => s.id === "server");
    expect(serverEntry, "the log never says server-side work is invisible to it").toBeTruthy();
    expect(serverEntry.what).toContain("API route");
  });

  it("marks exactly one channel as a call site, and says a call site can be forgotten", () => {
    const callSites = CAPTURED_CHANNELS.filter((c) => c.how === "call-site");
    const chokePoints = CAPTURED_CHANNELS.filter((c) => c.how === "choke-point");
    expect(chokePoints.length).toBeGreaterThanOrEqual(3);
    expect(callSites).toHaveLength(1);
    expect(callSites[0].what.toLowerCase()).toContain("recordactivity");
  });
});

describe("[THE DEFINITION] every feature log is folded in, or is on the ledger", () => {
  // The aggregation half. This repo's standing rule gives every feature that
  // can carry a log its own log; the app-wide layer AGGREGATES those rather
  // than duplicating them, so the set of feature logs and the set of ledger
  // entries have to stay in step.
  const FEATURE_LOG_RE = /\/[a-z][A-Za-z]*(?:Log|LogDocument|LogArchive)\.js$/;
  const featureLogModules = [...TREE.keys()].filter(
    (f) =>
      f.startsWith("lib/") &&
      FEATURE_LOG_RE.test(f) &&
      // The aggregator's own modules are not a feature log to aggregate.
      !f.startsWith("lib/activityLog/"),
  );

  it("finds the feature logs this repo actually has", () => {
    expect(featureLogModules).toContain("lib/duplicateApply/duplicateApplyLogDocument.js");
    expect(featureLogModules).toContain("lib/copilot/sessionLog.js");
    expect(featureLogModules).toContain("lib/experience/knowledgeLog.js");
    expect(featureLogModules.length).toBeGreaterThanOrEqual(5);
  });

  it("matches FEATURE_LOG_LEDGER exactly, in both directions", () => {
    expect(FEATURE_LOG_LEDGER.map((e) => e.module).sort()).toEqual([...featureLogModules].sort());
  });

  it("gives every unattached feature log a reason a reader can act on", () => {
    const unattached = FEATURE_LOG_LEDGER.filter((e) => !e.attached);
    for (const entry of unattached) {
      expect(entry.why.length, `${entry.module} is unattached with no reason`).toBeGreaterThan(60);
    }
    // …and at least one IS attached, so "aggregation" is a thing that happens
    // rather than a thing that is described.
    expect(FEATURE_LOG_LEDGER.some((e) => e.attached)).toBe(true);
  });
});

describe("[THE DEFINITION] the registry is what the downloaded file says", () => {
  // The registry could be perfectly maintained and never reach the artifact.
  // These two assertions are what make the ledgers above load-bearing for a
  // human holding the .md rather than for a test suite.
  const md = renderActivityLog(createActivityLog({ now: () => 1, startedAt: 1 }).snapshot());

  it("prints every captured channel and every gap into the file", () => {
    for (const channel of CAPTURED_CHANNELS) expect(md).toContain(channel.what);
    for (const gap of UNCAPTURED_SURFACES) expect(md).toContain(gap.what);
  });

  it("prints the feature-log ledger into the file", () => {
    for (const entry of FEATURE_LOG_LEDGER) expect(md).toContain(entry.label);
  });
});

// ---------------------------------------------------------------------------
// CONTROL -- THE BLIND SCANNER. Every assertion above is a statement about what
// a walk of the tree found. Re-run the census over nothing and prove the
// non-vacuity floors go red; without this, a broken reader would make the whole
// file pass by finding no bypasses to complain about.
// ---------------------------------------------------------------------------
describe("[control] a census that reads nothing fails the floors, it does not pass quietly", () => {
  const blind = censusBypasses(new Map());

  it("finds no bypasses at all", () => {
    expect(blind.size).toBe(0);
  });

  it("turns the known-bypass floor red", () => {
    expect(() => expect([...blind.keys()]).toContain("lib/copilot/stt/deepgram.js")).toThrow();
    expect(() => expect(blind.size).toBeGreaterThanOrEqual(6)).toThrow();
  });

  it("would report the tree as fully accounted for -- which is exactly why the floors exist", () => {
    const unaccounted = [...blind.keys()].filter((file) => !LEDGERED_MODULES.has(file));
    expect(unaccounted).toEqual([]);
  });

  it("turns the tree floor red when the walker returns nothing", () => {
    expect(() => expect(new Map().size).toBeGreaterThanOrEqual(400)).toThrow();
  });
});
