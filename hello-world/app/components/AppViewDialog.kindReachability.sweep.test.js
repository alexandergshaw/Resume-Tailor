// The class defect behind the N33/N25 prep-pack door bug, generalised:
// `AppViewDialog.js` grows a new `appDialog.kind` branch and nothing ever
// checks that some non-test call site actually SETS `appDialog.kind` to that
// value with `open: true`. `PrepPackPanel` shipped a complete consumer with
// zero producers for exactly this reason. This sweep would have caught it,
// and is meant to catch the next panel added the same way.
//
// Static-source, like TrackingTab.digest.test.js's own wiring checks --
// reading the caller's source IS the property under test here. Two
// independent extractions of "what AppViewDialog.js can render" are unioned
// (the `dialogTitle`/render `appDialog.kind === "..."` comparisons, and the
// `pages` array's literal kinds) so a change to either shape alone does not
// silently shrink the set being checked.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const DIALOG_SOURCE = read("./AppViewDialog.js");

function extractRenderableKinds(source) {
  const fromComparisons = Array.from(source.matchAll(/appDialog\.kind === "([a-zA-Z]+)"/g)).map((m) => m[1]);
  const pagesBlock = source.match(/const pages = \[([\s\S]*?)\]\.filter\(Boolean\);/);
  const fromPages = pagesBlock
    ? Array.from(pagesBlock[1].matchAll(/"([a-zA-Z]+)"/g)).map((m) => m[1])
    : [];
  return Array.from(new Set([...fromComparisons, ...fromPages]));
}

const RENDERABLE_KINDS = extractRenderableKinds(DIALOG_SOURCE);

// AppViewDialog.js itself is deliberately excluded from the call-site search:
// its Previous/Next chevrons only move between pages already open, and its
// Close buttons only ever reset to the "jd" default -- neither is a door a
// candidate can walk through from the tracking row, which is the property
// this sweep is about.
const CALL_SITE_FILES = [
  "./tracking/ApplicationCard.js",
  "./TrackingTab.js",
  "../hooks/useApplicationDialogs.js",
];

function kindsOpenedFrom(rel) {
  const source = read(rel);
  const opened = new Set();
  for (const call of source.matchAll(/setAppDialog\(\s*\{[^}]*\}\s*\)/g)) {
    const text = call[0];
    if (!/open:\s*true/.test(text)) continue; // a close/reset call, not a door
    const kindMatch = text.match(/kind:\s*"([a-zA-Z]+)"/);
    if (kindMatch) opened.add(kindMatch[1]);
  }
  return opened;
}

function allOpenedKinds() {
  const opened = new Set();
  for (const rel of CALL_SITE_FILES) {
    for (const kind of kindsOpenedFrom(rel)) opened.add(kind);
  }
  return opened;
}

describe("every appDialog.kind AppViewDialog can render has a non-test call site that OPENS it", () => {
  it("[canary] the static extraction actually finds the known kinds (an empty result would make every assertion below vacuous)", () => {
    expect(RENDERABLE_KINDS.length).toBeGreaterThan(0);
    expect(RENDERABLE_KINDS).toEqual(
      expect.arrayContaining(["communications", "jd", "resume", "digest", "prep"])
    );
  });

  it("has a { open: true, kind: \"<kind>\" } call site outside AppViewDialog.js for every renderable kind", () => {
    const opened = allOpenedKinds();
    const missing = RENDERABLE_KINDS.filter((kind) => !opened.has(kind));
    expect(
      missing,
      `AppViewDialog.js can render kind(s) [${missing.join(", ")}] but no non-test file ever ` +
        `calls setAppDialog({ open: true, kind: "<that kind>" }) -- the panel would be unreachable`
    ).toEqual([]);
  });
});
