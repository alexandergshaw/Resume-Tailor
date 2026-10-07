// @vitest-environment jsdom
//
// N125 L14 (the atomicity gate, deferred from the 4b pass until step 7 pinned
// the hook and the render-site wiring): a surface reading useIdealProject while
// ANYTHING still renders the draft's own frozen `idealProject` is a DOUBLE
// example — it renders fine, it looks plausible, and nothing errors. This file
// is the instrument for that defect, across every place a drafted answer's aids
// render: QuestionFeed's card, CopilotDashboard's current-answer panel and its
// history item, practice's SampleAnswer, and practice's QuestionCard (which
// carries SampleAnswer).
//
// HOW IT HAS POWER. Every fixture below carries a FROZEN example on the state
// the site is handed — the shape a live entry, a done frame or a practice
// cache entry really has — with a title no hook response can produce. The hook
// is answered (by a stubbed fetch) with a different READY example and a
// different TAILORED one. Then, per site:
//   - the frozen title must render ZERO times: a site that still passes the
//     draft's `idealProject` to AnswerAids puts it on screen, and fails here;
//   - the hook's READY must render EXACTLY ONCE, before and after TAILORED
//     lands, and the count of example blocks (each opens with the "Not from
//     your resume." disclosure) must be 1 then 2 — never 2 then 3.
// And the instrument itself is proved: a deliberately DOUBLED composition (a
// bare AnswerAids fed the frozen example, beside the hook-fed one — exactly the
// state the atomicity constraint forbids) is mounted and the SAME counter must
// read two blocks. A counter that could not see a double would read one there,
// and the "exactly once" assertions on the real sites would pass vacuously.
//
// Two halves of the wiring are NOT mountable and are pinned the way this repo
// pins them (PracticeClient.codeLanguageWiring.test.js: "PracticeClient cannot
// be rendered under test"): PracticeClient and CopilotClient hand the scope
// their posting's id and no longer hand any renderer a frozen `idealProject`.
// And one structural property no per-site mount can express — that no FIFTH
// site can quietly bring the frozen example back — is checked over the tree:
// the only non-test importer of AnswerAids is IdealAnswerAids.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import AnswerAids from "./AnswerAids.js";
import IdealAnswerAids, { IdealProjectScope } from "./IdealAnswerAids.js";
import QuestionFeed from "./QuestionFeed.js";
import CopilotDashboard from "./dashboard/CopilotDashboard.js";
import SampleAnswer from "./practice/SampleAnswer.js";
import QuestionCard from "./practice/QuestionCard.js";
import { stripLineComments } from "@/test/helpers/stripComments.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const HERE = dirname(fileURLToPath(import.meta.url));
const QUESTION = "Tell me about a project you owned.";

// A complete worked example (four sections, three outcomes), so every aid the
// test builds renders as a full example block, not the legacy summary line.
const aid = (title) => ({
  shape: "Education, Agile",
  summary: "They want a project built around Education and Agile, owned end to end, with a measurable outcome.",
  metrics: ["adoption rate", "time-to-ship"],
  project: {
    title,
    sections: [
      { label: "Problem", body: "Two thirds of licensed teachers never returned after their first week, and the flow ran to seven screens." },
      { label: "Built", body: "A single-screen flow with the roster pre-filled, and an assistant flagging incomplete records before submission entirely." },
      { label: "Ran", body: "Two-week sprints with a teacher advisory group in every review, and a written decision log so trade-offs stayed settled." },
      { label: "Landed", body: "Baselined against the prior term and measured the same way after, including the one part that did not move at all." },
    ],
    outcomes: [
      { metric: "adoption rate", figure: "34% to 71% active weekly" },
      { metric: "NPS", figure: "+9 to +38" },
      { metric: "time-to-ship", figure: "9 weeks to 3" },
    ],
  },
});

const FROZEN = aid("FROZEN SESSION EXAMPLE");
const HOOK_READY = "HOOK READY EXAMPLE";
const HOOK_TAILORED = "HOOK TAILORED EXAMPLE";

let container;
let root;
let tailoredGate;
let requests;
const originalFetch = globalThis.fetch;

// READY answers at once; TAILORED is held until the test releases it, so the
// "before TAILORED" and "after TAILORED" states are both observable.
function installFetch() {
  requests = [];
  let release;
  tailoredGate = new Promise((resolve) => {
    release = resolve;
  });
  tailoredGate.release = release;
  globalThis.fetch = vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    if (body.tailored) {
      await tailoredGate;
      return { ok: true, json: async () => ({ tier: "tailored", source: "model", idealProject: aid(HOOK_TAILORED) }) };
    }
    return { ok: true, json: async () => ({ tier: "ready", source: "model", idealProject: aid(HOOK_READY) }) };
  });
}

beforeEach(() => {
  installFetch();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  globalThis.fetch = originalFetch;
});

async function flush(times = 8) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {});
  }
}

// Every site is mounted under the same scope production mounts it under.
async function mount(node) {
  await act(async () => {
    root.render(createElement(IdealProjectScope, { applicationId: "app-1" }, node));
  });
  await flush();
}

async function releaseTailored() {
  await act(async () => {
    tailoredGate.release();
  });
  await flush();
}

// Read from document.body, not the container: MUI portals land on body.
const text = () => document.body.textContent || "";
const countOf = (needle) => text().split(needle).length - 1;
// One block per example: each opens with this exact disclosure line.
const blocks = () => countOf("Not from your resume.");

function questionEntry(overrides = {}) {
  return {
    id: "q1",
    question: QUESTION,
    at: Date.now(),
    status: "done",
    points: ["We moved settlement onto Kafka."],
    cues: ["The migration"],
    buzzwords: [],
    anchor: null,
    idealProject: FROZEN,
    pageSources: [],
    type: "behavioral",
    error: "",
    speakerTag: null,
    provisional: false,
    ...overrides,
  };
}

const DASHBOARD_BASE = {
  pace: { measured: true, wordsPerMinute: 140, paceLabel: "conversational" },
  fillers: { measured: true, fillerCount: 1, fillerRate: 1.2, fillerLabel: "clean" },
};

const SAMPLE_BASE = {
  visible: true,
  status: "done",
  points: ["We moved settlement onto Kafka."],
  cues: ["The migration"],
  buzzwords: [],
  anchor: null,
  question: QUESTION,
  // The FROZEN example, passed under the OLD prop name a regressed site would
  // still read. It must be inert.
  idealProject: FROZEN,
  pageSources: [],
  grounding: null,
  error: "",
  isEmbedded: false,
  onToggle: () => {},
  onRetry: () => {},
  onRegenerate: () => {},
};

const noop = () => {};
const CARD_BASE = {
  question: QUESTION,
  type: "general",
  loading: false,
  error: "",
  exhausted: false,
  sessionActive: true,
  hasPosting: true,
  live: false,
  answering: false,
  settling: false,
  onNext: noop,
  onRetry: noop,
  onStartAnswer: noop,
  onDoneAnswer: noop,
  sampleVisible: true,
  sampleStatus: "done",
  sampleAnswerPoints: ["We moved settlement onto Kafka."],
  sampleCues: ["The migration"],
  sampleBuzzwords: [],
  sampleAnchor: null,
  // The OLD prop PracticeClient used to pass, carrying the frozen example.
  sampleIdealProject: FROZEN,
  samplePageSources: [],
  sampleGrounding: null,
  sampleError: "",
  isEmbedded: false,
  onToggleSample: noop,
  onRetrySample: noop,
  onRegenerateSample: noop,
};

async function openHistoryItem() {
  const toggle = [...document.body.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-expanded") === "false" && (b.textContent || "").includes("An older question"),
  );
  expect(toggle, "the history item's expand button").toBeTruthy();
  await act(async () => {
    toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await flush();
}

// [site name, mount, setup that reveals the example if the site hides it]
const SITES = [
  ["QuestionFeed's card", () => createElement(QuestionFeed, { questions: [questionEntry()], onDraft: noop }), null],
  [
    "CopilotDashboard's current-answer panel",
    () => createElement(CopilotDashboard, { ...DASHBOARD_BASE, questions: [questionEntry()] }),
    null,
  ],
  [
    "CopilotDashboard's history item",
    () =>
      createElement(CopilotDashboard, {
        ...DASHBOARD_BASE,
        questions: [],
        history: [questionEntry({ id: "h1", question: "An older question about leadership?" })],
      }),
    openHistoryItem,
  ],
  ["practice's SampleAnswer", () => createElement(SampleAnswer, SAMPLE_BASE), null],
  ["practice's QuestionCard (carrying SampleAnswer)", () => createElement(QuestionCard, CARD_BASE), null],
];

describe("every render site shows the example EXACTLY ONCE — the hook's, never the frozen one (N125 L14)", () => {
  it.each(SITES)("%s", async (_name, build, reveal) => {
    await mount(build());
    if (reveal) await reveal();

    // POSITIVE CONTROL: the hook's READY is on screen at all. Without this,
    // "the frozen one is absent" is satisfied by a site rendering nothing.
    expect(countOf(HOOK_READY), "the hook's READY example is rendered once").toBe(1);
    expect(countOf("A ready example")).toBe(1);
    expect(blocks(), "one example block before TAILORED lands").toBe(1);
    // THE ASSERTION THIS FILE EXISTS FOR: the draft's frozen example is read
    // by no renderer.
    expect(countOf("FROZEN SESSION EXAMPLE"), "the frozen idealProject is read by a renderer").toBe(0);
    // TAILORED is in flight: the pending cue, and no second block yet.
    expect(text()).toMatch(/Tailoring to this question/);
    expect(countOf(HOOK_TAILORED)).toBe(0);

    await releaseTailored();

    expect(countOf(HOOK_READY), "READY is added to, not swapped for or duplicated").toBe(1);
    expect(countOf(HOOK_TAILORED)).toBe(1);
    expect(countOf("Tailored to this question")).toBe(1);
    expect(blocks(), "exactly READY + TAILORED after TAILORED lands").toBe(2);
    expect(countOf("FROZEN SESSION EXAMPLE")).toBe(0);
    expect(text()).not.toMatch(/Tailoring to this question…/);
  });

  it("asks the endpoint for the question of the entry it renders, not a neighbour's", async () => {
    await mount(createElement(QuestionFeed, { questions: [questionEntry({ question: "Why this team?" })], onDraft: noop }));
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((r) => r.question === "Why this team?" && r.applicationId === "app-1")).toBe(true);
  });
});

describe("the instrument can see a double (N125 L14 positive control)", () => {
  it("reads TWO blocks, and the frozen title, for a bare AnswerAids fed the frozen example beside the hook-fed one", async () => {
    // Exactly the state the atomicity constraint forbids: a surface reading
    // the hook while something still renders the draft's own idealProject.
    await mount(
      createElement(
        Fragment,
        null,
        createElement(AnswerAids, { buzzwords: [], anchor: null, idealProject: FROZEN }),
        createElement(IdealAnswerAids, { buzzwords: [], anchor: null, question: QUESTION }),
      ),
    );
    // The same counters the real-site assertions use.
    expect(blocks()).toBe(2);
    expect(countOf("FROZEN SESSION EXAMPLE")).toBe(1);
    expect(countOf(HOOK_READY)).toBe(1);
  });

  it("is quiet about the same sites once the frozen render is removed (the contrast)", async () => {
    await mount(createElement(IdealAnswerAids, { buzzwords: [], anchor: null, question: QUESTION }));
    expect(blocks()).toBe(1);
    expect(countOf("FROZEN SESSION EXAMPLE")).toBe(0);
  });
});

describe("the embedded engine shows READY once and no tailoring at any site (N125 L10/L14)", () => {
  beforeEach(() => {
    localStorage.setItem("tailorEngine", "embedded");
  });
  afterEach(() => {
    localStorage.removeItem("tailorEngine");
  });

  it.each(SITES.filter(([name]) => !name.includes("history")))("%s", async (_name, build) => {
    await mount(build());
    expect(countOf(HOOK_READY)).toBe(1);
    expect(blocks()).toBe(1);
    expect(countOf("FROZEN SESSION EXAMPLE")).toBe(0);
    expect(text()).not.toMatch(/Tailoring to this question/);
    expect(requests.some((r) => r.tailored === true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The wiring no mount can reach, and the structural guard over the tree.
// ---------------------------------------------------------------------------
const read = (rel) => stripLineComments(readFileSync(join(HERE, rel), "utf8"));

describe("PracticeClient and CopilotClient wire the scope and hand no renderer a frozen example (N125 L14)", () => {
  const PRACTICE = read("./practice/PracticeClient.js");
  const COPILOT = read("./CopilotClient.js");

  it("both shells mount IdealProjectScope with the selected posting's id", () => {
    for (const [name, src] of [["PracticeClient", PRACTICE], ["CopilotClient", COPILOT]]) {
      expect(src, name).toMatch(/<IdealProjectScope\s+applicationId=\{posting\?\.id \|\| ""\}\s*>/);
      expect(src, name).toMatch(/<\/IdealProjectScope>/);
      expect(src, name).toMatch(/import\s*\{\s*IdealProjectScope\s*\}\s*from\s*["'][^"']*IdealAnswerAids(?:\.js)?["']/);
    }
  });

  it("PracticeClient no longer reads useSampleAnswer's idealProject, or threads it to the card or the dashboard entry", () => {
    expect(PRACTICE).not.toMatch(/\bsampleAnswer\s*\.\s*idealProject\b/);
    expect(PRACTICE).not.toMatch(/\bsampleIdealProject\b/);
    expect(PRACTICE).not.toMatch(/\bidealProject\s*:/);
    // Positive control: the same entry still carries every OTHER aid, so this
    // is a statement about idealProject and not a gutted file.
    expect(PRACTICE).toMatch(/buzzwords:\s*sampleAnswer\.buzzwords/);
    expect(PRACTICE).toMatch(/anchor:\s*sampleAnswer\.anchor/);
  });

  it("CopilotClient hands no renderer an idealProject prop", () => {
    expect(COPILOT).not.toMatch(/\bidealProject\s*=\s*\{/);
    expect(read("./TranscriptDisclosure.js")).not.toMatch(/\bidealProject\s*=\s*\{/);
    // Positive control: it still hands the entries themselves to both
    // surfaces (the feed via TranscriptDisclosure, which mounts QuestionFeed).
    expect(COPILOT).toMatch(/<CopilotDashboard\b[^>]*\bquestions=\{questions\}/);
    expect(COPILOT).toMatch(/<TranscriptDisclosure\b/);
    expect(read("./TranscriptDisclosure.js")).toMatch(/<QuestionFeed\b/);
  });
});

describe("AnswerAids has exactly one non-test importer: IdealAnswerAids (N125 L14)", () => {
  it("no other module under app/ can render the frozen example by reaching AnswerAids directly", () => {
    const appDir = join(HERE, "..");
    const importers = readdirSync(appDir, { recursive: true })
      .map((f) => String(f))
      .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))
      .filter((f) => {
        const src = stripLineComments(readFileSync(join(appDir, f), "utf8"));
        return /from\s+["'][^"']*\/AnswerAids(?:\.js)?["']/.test(src);
      })
      .map((f) => relative(appDir, join(appDir, f)).split(sep).join("/"));
    // Positive control: the scan found the one importer it must, so an empty
    // list can only mean a wrong scan root, not a clean tree.
    expect(importers).toEqual(["copilot/IdealAnswerAids.js"]);
  });
});
