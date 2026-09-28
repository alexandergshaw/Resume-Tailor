// N60 SECOND CHUNK, Step D (4b) -- Part F composite-surface guards. Source-text
// sweeps (the reachability/census exception to the zero-power rule), each pattern
// canaried against a known positive.
//
// AC2-F1: every new app/components/feed/*.js file must be listed in
//   lib/feed/liveFeedWiring.test.js's FEED_COMPONENTS, or it inherits NO
//   1000-line ceiling (measured fact: a feed component not in that list is
//   uncapped). RED at HEAD: the three new files are not listed yet.
// AC2-F2: the chat/review surface is NOT rendered inside LiveFeedTab's
//   `filterPanel` (the sheet LiveFeedTab documents as a fixed mobile defect).
// AC2-F3: no new app/*/page.js route / nav destination -- the chat is one entry
//   into the existing Automation view.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const NEW_FEED_COMPONENTS = ["FeedConfigChat.js", "DerivedConfigReview.js", "CadenceControl.js"];

describe("AC2-F1: the new feed components inherit the 1000-line ceiling via FEED_COMPONENTS", () => {
  const wiringSrc = read("../../../lib/feed/liveFeedWiring.test.js");

  it("[canary] the ceiling list already names existing feed components", () => {
    // If this fails the scan is looking at the wrong file / list and every
    // assertion below is invalid, not a zero.
    expect(wiringSrc).toMatch(/FeedAutomationPanel\.js/);
    expect(wiringSrc).toMatch(/FEED_COMPONENTS/);
  });

  it.each(NEW_FEED_COMPONENTS)("%s is listed in FEED_COMPONENTS so it is capped at 1000 lines", (file) => {
    // A new file in app/components/feed/ that is NOT in this list ships with no
    // line ceiling at all -- the exact hole Part F names.
    expect(wiringSrc.includes(file), `${file} must appear in liveFeedWiring.test.js's FEED_COMPONENTS`).toBe(true);
  });
});

describe("AC2-F2: the chat/review surface is not rendered inside LiveFeedTab's filterPanel", () => {
  const tabSrc = read("../LiveFeedTab.js");
  // Extract the `const filterPanel = ( ... );` slice.
  const slice = (() => {
    const start = tabSrc.indexOf("const filterPanel = (");
    if (start === -1) return null;
    // Balance to the matching ");" that closes the JSX expression.
    const rest = tabSrc.slice(start);
    const end = rest.indexOf("\n  );");
    return end === -1 ? rest : rest.slice(0, end);
  })();

  it("[canary] the filterPanel slice was located and holds the refine panel", () => {
    expect(slice, "the filterPanel slice must be found").not.toBeNull();
    expect(slice).toMatch(/FeedRefinePanel/);
  });

  it("does not mount the chat, the review, or the whole automation panel inside the filter sheet", () => {
    expect(slice).not.toMatch(/FeedConfigChat/);
    expect(slice).not.toMatch(/DerivedConfigReview/);
    expect(slice).not.toMatch(/FeedAutomationPanel/);
  });
});

describe("AC2-F3: the chat adds no new page route / nav destination", () => {
  // The feature lives in the existing Automation view (FeedToolbar's third
  // button), reached inside app/page.js -- not a new app/<x>/page.js route.
  const routeDirs = ["../../feed-config", "../../automation", "../../feed", "../../chat"];
  it.each(routeDirs)("there is no %s/page.js route directory", (dir) => {
    let existed = true;
    try {
      readFileSync(fileURLToPath(new URL(`${dir}/page.js`, import.meta.url)), "utf8");
    } catch {
      existed = false;
    }
    expect(existed, `${dir}/page.js must not exist -- the chat is one entry into the Automation view`).toBe(false);
  });

  it("[canary] an existing route (login) IS found by the same probe", () => {
    let existed = true;
    try {
      readFileSync(fileURLToPath(new URL("../../login/page.js", import.meta.url)), "utf8");
    } catch {
      existed = false;
    }
    expect(existed, "the probe can see a real route -- so a null result above is a true absence").toBe(true);
  });
});
