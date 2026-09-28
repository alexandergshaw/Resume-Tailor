// @vitest-environment jsdom
//
// N73 spend safety -- crit 2 (do not double-spend) and crit 4 (never warm the
// unattended cron/feed path). Company research is a paid, user-triggered call
// (the AC notes the route's 30/600s/user limiter); "one research call per job"
// is real money.
//
// TWO instruments live here:
//
// 1. THE DEDUPE SEAM (crit 2). The mechanism that makes the new
//    generation-start warm free -- so a job that also warms at preview-open
//    still pays once -- is useCompanyResearch's researchStartedRef, keyed on
//    jobId (useCompanyResearch.js:160,206). This seat's contribution is that
//    BOTH warm sites pass the SAME jobId (pinned in
//    useManualTailor.research.test.js and useDocumentPreview.lateWarm.test.js).
//    This file pins the OTHER half of the composition: same key => one paid
//    call; different key => two. It is GREEN on HEAD (it exercises the existing
//    dedupe, which N73 relies on but does not author) -- a dependency guard
//    plus the discrimination control that proves the count assertion is not
//    trivially "always 1".
//
// 2. THE CRON/FEED CENSUS (crit 4). The unattended generation path
//    (app/api/cron/tailor/route.js, lib/feed/tailorAndQueue.js) generates in
//    bulk with no modal and nobody watching; warming research there is
//    unbounded background spend with no review surface. A checker confirmed the
//    hook never mounts there. This is a call-site census (a deliberate
//    source-text sweep, per the standing exception): assert those files
//    reference no research warm, canaried against a KNOWN warm site so a broken
//    regex or wrong root cannot make the guard vacuously pass. GREEN on HEAD;
//    it fails the day a warm is wired into cron/feed.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import { useCompanyResearch } from "./useCompanyResearch.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// 1. The dedupe seam -- real useCompanyResearch, real researchStartedRef
// ---------------------------------------------------------------------------

let probe = null;
let container = null;
let root = null;

function HookProbe() {
  const [tailoringMap, setTailoringMap] = useState({});
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const research = useCompanyResearch({ tailoringMap, setTailoringMap, setPreviewReloadKey });
  probe = { research, previewReloadKey };
  return null;
}

function researchCallCount() {
  return globalThis.fetch.mock.calls.filter(([u]) => String(u).includes("/api/company-research")).length;
}

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(HookProbe));
  });
}

async function flush() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(async () => {
  probe = null;
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ articles: [], warnings: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  await mount();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  if (container) container.remove();
  root = null;
  container = null;
  delete globalThis.fetch;
});

describe("N73 crit 2 -- the per-job dedupe collapses two same-key warms into one paid call", () => {
  it("two warms for the SAME job fire /api/company-research exactly once", async () => {
    // This is the composition the generation-start warm + the preview-open warm
    // reduce to: both pass one jobId, so the second is free.
    await act(async () => {
      probe.research.startBackgroundResearch({ jobId: "job-1", company: "Acme", jobTitle: "Eng", posting: "p" });
      probe.research.startBackgroundResearch({ jobId: "job-1", company: "Acme", jobTitle: "Eng", posting: "p" });
    });
    await flush();
    expect(researchCallCount(), "the same job paid for research twice -- the dedupe key is not shared").toBe(1);
  });

  it("DISCRIMINATION CONTROL: two warms for DIFFERENT jobs fire twice", async () => {
    // Proves the assertion above is not trivially satisfiable -- if the two
    // warm sites ever keyed on different ids (the exact crit-2 regression), the
    // count would be two. This is why the two behavioural tests pin that both
    // sites use the run's own syntheticJobId.
    await act(async () => {
      probe.research.startBackgroundResearch({ jobId: "job-1", company: "Acme", jobTitle: "Eng", posting: "p" });
      probe.research.startBackgroundResearch({ jobId: "job-2", company: "Beta", jobTitle: "Eng", posting: "p" });
    });
    await flush();
    expect(researchCallCount(), "two distinct jobs did not each research once -- the count instrument is degenerate").toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 2. The cron/feed census (crit 4) -- a deliberate call-site sweep
// ---------------------------------------------------------------------------

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
// Any way this codebase warms company research: the endpoint, the hook warm, or
// its inner fetch helper. If a warm is wired into cron/feed, at least one of
// these appears.
const WARM_MARK = /company-research|startBackgroundResearch|fetchResearchInto/;

describe("N73 crit 4 -- the unattended cron/feed generation path warms NO research", () => {
  it("CANARY: the regex actually finds a real warm site (so an absence below is meaningful)", () => {
    // useDocumentPreview.js is a genuine warm site today. If this canary ever
    // stops matching, the absence assertions below prove nothing (bad regex or
    // wrong root), so this must pass first.
    expect(WARM_MARK.test(read("./useDocumentPreview.js")), "the warm-site regex matched no known warm site -- the census is blind").toBe(true);
  });

  it("app/api/cron/tailor/route.js does not warm company research", () => {
    expect(
      WARM_MARK.test(read("../api/cron/tailor/route.js")),
      "the unattended cron generation path warms company research -- unbounded spend with no review surface",
    ).toBe(false);
  });

  it("lib/feed/tailorAndQueue.js does not warm company research", () => {
    expect(
      WARM_MARK.test(read("../../lib/feed/tailorAndQueue.js")),
      "the feed bulk-generation path warms company research -- unbounded spend with no review surface",
    ).toBe(false);
  });
});
