// @vitest-environment jsdom
//
// N49 fix round (verify.r1.md B2): the checker mounted the REAL PrepPackPanel
// with forged/stale provenance and measured four over-claims, all through the
// real render path -- these four cases, pinned here the same way.
// `stageItemLabel` used to print `provenance.publishers` verbatim; nothing
// anywhere derived it. These four rows are the reason it now takes the
// snapshot too and recomputes the "reported" claim from the sources that
// actually survive `safeExternalHref`, `servesGroundingRedirect` and a
// publisher-key merge (AC-N49.5.3, AC-N49.6, AC-N49.7), never trusting a
// stored count that exceeds what those sources actually support.
//
// Each case appends its forged sources at NEW indices past the shared
// fixture's own five (0-4) and overrides only stage 0's own provenance, so
// every other item in the pack keeps reading its ORIGINAL, honest sources --
// nothing here depends on any other stage's own label.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import PrepPackPanel from "./PrepPackPanel.js";
import { maximalResearchPack, maximalResearchPanelProps, researchSources } from "@/test/helpers/prepResearchFixture.js";
import { norm, visibleText } from "@/test/helpers/prepPanelInstruments.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let containers;
let roots;
beforeEach(() => {
  containers = [];
  roots = [];
});
afterEach(() => {
  roots.forEach((root) => act(() => root.unmount()));
  containers.forEach((node) => node.remove());
});

async function mount(props) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  containers.push(container);
  roots.push(root);
  await act(async () => root.render(createElement(PrepPackPanel, props)));
  return container;
}

/** Stage 0's own host ("Recruiter screen"), with `provenance` replaced and
 *  `extraSources` appended past the shared fixture's own five. */
function forgedHost(extraSources, provenance) {
  const pack = maximalResearchPack();
  pack.sections.stages.research = {
    ...pack.sections.stages.research,
    sources: [...researchSources(), ...extraSources],
  };
  pack.sections.stages.stages[0].provenance = provenance;
  return maximalResearchPanelProps({}, { pack });
}

function stageHost(root) {
  return [...root.querySelectorAll('[data-n49-item="stage"]')].find((h) => norm(h.textContent).startsWith("Recruiter screen"));
}

describe("verify.r1.md B2 -- four forged-provenance over-claims, fixed", () => {
  it("case A: publishers claims 2, only ONE source row -- reads single, one link, never reported", async () => {
    const props = forgedHost([{ url: "https://news.example.com/forged-a", title: "t" }], {
      category: "verified",
      src: [5],
      publishers: 2,
    });
    const root = await mount(props);
    const host = stageHost(root);
    const token = host.querySelector("[data-n49-token]");
    expect(token.getAttribute("data-n49-token")).toBe("single");
    expect(norm(visibleText(token))).toMatch(/^Possible\s*[-‐-―−:]?\s*1 source$/);
    const anchors = [...host.querySelectorAll("a[data-n49-source]")];
    expect(anchors).toHaveLength(1);
  });

  it("case B: two rows on the SAME merged publisher (glassdoor.com/.co.uk) -- reads single, one link, never reported", async () => {
    const props = forgedHost(
      [
        { url: "https://www.glassdoor.com/Reviews/northwind-a", title: "t1" },
        { url: "https://www.glassdoor.co.uk/Reviews/northwind-b", title: "t2" },
      ],
      { category: "verified", src: [5, 6], publishers: 2 },
    );
    const root = await mount(props);
    const host = stageHost(root);
    const token = host.querySelector("[data-n49-token]");
    expect(token.getAttribute("data-n49-token")).toBe("single");
    expect(norm(visibleText(token))).toMatch(/^Possible\s*[-‐-―−:]?\s*1 source$/);
    const anchors = [...host.querySelectorAll("a[data-n49-source]")];
    expect(anchors).toHaveLength(1);
    expect(norm(anchors[0].textContent)).toBe("glassdoor.com");
  });

  it("case C: publishers claims 3, both source URLs fail the href gate -- reads unsourced, zero links, two inert notices", async () => {
    const props = forgedHost([{ url: "javascript:alert(1)" }, { url: "javascript:alert(2)" }], {
      category: "verified",
      src: [5, 6],
      publishers: 3,
    });
    const root = await mount(props);
    const host = stageHost(root);
    const token = host.querySelector("[data-n49-token]");
    expect(token.getAttribute("data-n49-token")).toBe("unsourced");
    expect(norm(visibleText(token))).toMatch(/^Possible\s*[-‐-―−:]?\s*not sourced$/);
    expect(host.querySelectorAll("a[data-n49-source]")).toHaveLength(0);
    expect(host.querySelectorAll("[data-n49-source-inert]")).toHaveLength(2);
    expect(root.innerHTML).not.toContain("javascript:");
  });

  it("case D: publishers claims 2, both sources are vertexaisearch grounding redirects -- reads unsourced, and the redirector is never shown as a publisher", async () => {
    const props = forgedHost(
      [
        { url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AAAA" },
        { url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/BBBB" },
      ],
      { category: "verified", src: [5, 6], publishers: 2 },
    );
    const root = await mount(props);
    const host = stageHost(root);
    const token = host.querySelector("[data-n49-token]");
    expect(token.getAttribute("data-n49-token")).toBe("unsourced");
    expect(norm(visibleText(token))).toMatch(/^Possible\s*[-‐-―−:]?\s*not sourced$/);
    expect(host.querySelectorAll("a[data-n49-source]")).toHaveLength(0);
    expect(host.querySelectorAll("[data-n49-source-inert]")).toHaveLength(0);
    expect(root.innerHTML).not.toContain("vertexaisearch");
  });
});
