// @vitest-environment jsdom
//
// The aids shown beside a drafted copilot answer, and specifically WHERE each
// one says its material came from.
//
// This is not cosmetic. The user reads "on your resume" and then says the
// claim out loud to an interviewer. If it is not on their resume, that is a
// bad moment the tool caused. So the label has to be driven by the aid's own
// `source`, never defaulted to the resume for anything that merely is not
// "prep".
//
// The defect these tests pin: roleLabel mapped `source === "prep"` to prep
// notes and EVERYTHING ELSE to "on your resume", and the no-role row hardcoded
// "From your resume" regardless of source. A third source could therefore only
// ever be mislabelled. It was latent rather than live only because the answer
// route worked around it by leaving those fields empty - designing around a
// component that cannot tell the truth, rather than fixing it.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import AnswerAids from "./AnswerAids.js";
import { PROJECT_PAGE_SOURCE } from "../../lib/copilot/projectStories.js";

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

async function render(props) {
  await act(async () => {
    root.render(createElement(AnswerAids, props));
  });
  return container.textContent || "";
}

const anchor = (over = {}) => ({
  title: "Senior Engineer",
  company: "Initech",
  project: "",
  description: [],
  matched: true,
  source: "resume",
  ...over,
});

describe("where the aid says its material came from", () => {
  it("says the resume for resume material", async () => {
    const text = await render({ anchor: anchor({ source: "resume" }) });
    expect(text).toMatch(/on your resume/i);
  });

  it("says the prep notes for prep material", async () => {
    const text = await render({ anchor: anchor({ source: "prep" }) });
    expect(text).toMatch(/prep notes/i);
    expect(text).not.toMatch(/on your resume/i);
  });

  it("says the project pages for project-page material, and never the resume", async () => {
    // The whole point. This currently renders "on your resume", which is false
    // and which the user will repeat to an interviewer.
    const text = await render({ anchor: anchor({ source: PROJECT_PAGE_SOURCE }) });
    expect(text).toMatch(/project page/i);
    expect(text).not.toMatch(/on your resume/i);
    expect(text).not.toMatch(/prep notes/i);
  });

  it("keeps the closest-versus-most-recent distinction for every source", async () => {
    // `matched: false` means nothing overlapped, so calling it a closest match
    // would claim a relevance never computed. That must survive the fix.
    for (const source of ["resume", "prep", PROJECT_PAGE_SOURCE]) {
      const matched = await render({ anchor: anchor({ source, matched: true }) });
      expect(matched, source).toMatch(/closest role/i);
      const recent = await render({ anchor: anchor({ source, matched: false }) });
      expect(recent, source).toMatch(/most recent role/i);
    }
  });
});

describe("the row with no role line", () => {
  // An upstream plausibility gate can suppress a mis-parsed job title, leaving
  // title and company empty while description phrases survive. The row still
  // renders - and used to be hardcoded to "From your resume".
  const noRole = (source) =>
    anchor({ title: "", company: "", description: ["Cut settlement to one day"], source });

  it("still attributes resume material to the resume", async () => {
    const text = await render({ anchor: noRole("resume") });
    expect(text).toMatch(/resume/i);
    expect(text).toMatch(/Cut settlement to one day/);
  });

  it("does not call project-page material a resume", async () => {
    const text = await render({ anchor: noRole(PROJECT_PAGE_SOURCE) });
    expect(text).toMatch(/Cut settlement to one day/);
    expect(text).not.toMatch(/resume/i);
    expect(text).toMatch(/project page/i);
  });

  it("does not call prep material a resume", async () => {
    const text = await render({ anchor: noRole("prep") });
    expect(text).not.toMatch(/resume/i);
  });
});

describe("attribution when the source is unknown", () => {
  it("falls back to the resume wording rather than rendering nothing or undefined", async () => {
    // Deliberate, and documented in the component today: an absent or
    // unrecognised source must not render "undefined" at the user. The fix
    // makes KNOWN sources honest without changing this.
    for (const source of [undefined, null, "", "something-new"]) {
      const text = await render({ anchor: anchor({ source }) });
      expect(text, String(source)).toMatch(/on your resume/i);
      expect(text, String(source)).not.toMatch(/undefined/);
    }
  });
});

describe("what must not change", () => {
  it("renders nothing at all when there is nothing to show", async () => {
    const text = await render({ anchor: null, buzzwords: [], idealProject: null });
    expect(text.trim()).toBe("");
  });

  it("keeps each description phrase on its own line rather than splicing them", async () => {
    // Two bullets joined into one sentence with no separator was a real defect
    // here; the array shape is what prevents it.
    const text = await render({
      anchor: anchor({ title: "", company: "", description: ["First phrase", "Second phrase"] }),
    });
    expect(text).toContain("First phrase");
    expect(text).toContain("Second phrase");
    expect(text).not.toContain("First phraseSecond phrase");
  });

  it("still shows the project row under a source-neutral label", async () => {
    const text = await render({ anchor: anchor({ project: "Payments migration" }) });
    expect(text).toContain("Payments migration");
  });
});
