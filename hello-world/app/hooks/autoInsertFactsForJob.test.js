// @vitest-environment jsdom
//
// N72 -- THE AUTO-INSERT FUNCTION (autoInsertFactsForJob), the half of N61 the
// owner asked for in their own words: "have the facts inserted and highlighted
// by the time the modal opens up". These are the HOOK-LEVEL behaviour tests --
// the auto-select predicate, the removed-fact skip, the write-time re-checks
// (open-ness and stale lines). The function does not exist on HEAD, so every
// test opens by asserting it is even a function -- a clean, unambiguous RED
// reason ("not a function") until N72 lands, distinct from a wrong-behaviour
// red.
//
// WHY HOOK-LEVEL AND NOT RENDER-AND-CLICK HERE. Auto-insert is NOT driven by a
// human click: the candidate never presses "insert". The trigger that fires it
// (the coordinating effect + the generation-start warm) is backlog N73, and
// lives in app/components/DocumentPreviewMount.js / app/page.js -- another
// seat's files. So for N72 the *function* is the deliverable, and these tests
// drive the function directly and assert on the hook's own observable state.
// The end-to-end proof that the function's OUTPUT reaches the real highlight
// and the real one-click removal the candidate uses is in the sibling
// autoInsertFactsForJob.rc.test.js, which mounts the real preview and clicks.
//
// THE CONTRACT THESE TESTS BIND (verified against the shipped tree, not the
// stale plan). The plan's `insertedFactTexts` string array is NOT what ships:
// the tree builds and reads LOCATED `{id, text, lineIndex, offset, url, title}`
// records (built in acceptFacts, app/hooks/useCompanyResearch.js:441-444; read
// by the body highlight at app/hooks/useDocumentPreview.js:422 and by the strip
// at app/components/DocumentPreviewMount.js:93). So the auto-insert function
// must produce that same located shape.
//
//   autoInsertFactsForJob(jobId, isOpen)
//     - isOpen is a LIVE getter, () => boolean, not a snapshot boolean: only a
//       getter can observe the modal closing WHILE the write is in flight, and
//       "re-check open-ness at the write, not only when it fires" (backlog N72)
//       is exactly that observation. It is re-read at entry AND at the write.
//     - auto-select predicate: an article inserts unasked ONLY if it carries a
//       real, openable, non-redirect source -- articleUrlKey(url) !== null,
//       reusing the SAME gate the manual path already trusts. Failing toward
//       NOT inserting: an unsourced claim in the candidate's own voice to an
//       employer is the worst thing this app can produce (N35).
//     - removed-fact skip: a fact whose identity is already in this
//       application's removed log is never re-inserted by a later auto-run.
//     - no clobber: the tailoringMap write re-reads the FRESH lines, so a hand
//       edit committed after the run's own snapshot survives.
//
// MEASUREMENT LIMIT, stated per backlog N74: this repo runs under jsdom + React
// act(), which is a synchronization barrier. An "edit injected mid-flight" here
// is a second edit committed strictly between the function's snapshot and its
// write -- so the clobber test proves ORDERING (the write re-reads fresh state),
// NOT true concurrency. It is labelled as such below and claims no more.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import { useCompanyResearch } from "./useCompanyResearch.js";
import { sanitizeStoredFacts } from "@/lib/acceptedFacts/factStore.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };

// Two researched articles with REAL, openable, non-redirect source urls -- both
// eligible for auto-insert. Distinct full sentences (their `suggestion`, which
// is the text the accept path inserts -- CompanyResearchDialog.js:127) so each
// is independently locatable in the letter.
const REAL_1 = {
  title: "Acme opens a Dublin telemetry lab",
  url: "https://news.example.com/acme/dublin-lab",
  source: "news.example.com",
  summary: "Acme has opened a new telemetry lab in Dublin.",
  suggestion: "I was glad to see Acme opened a Dublin telemetry lab, and it is part of what draws me to this role.",
};
const REAL_2 = {
  title: "Acme wins a sustainability award",
  url: "https://press.example.org/acme/award",
  source: "press.example.org",
  summary: "Acme received a national sustainability award.",
  suggestion: "Acme winning a national sustainability award is a big reason I am excited about this opportunity.",
};
// A fact with NO usable url -- articleUrlKey refuses it (safeExternalHref null).
const NULL_URL = {
  title: "Acme rumoured to be hiring",
  url: "",
  source: "",
  summary: "Unsourced chatter about Acme hiring.",
  suggestion: "I hear Acme is growing fast, and I would love to be part of that momentum.",
};
// A fact behind a Gemini grounding REDIRECT -- articleUrlKey refuses it
// (servesGroundingRedirect): the token is minted per request, so the link the
// candidate could "open to check" is not stable and may not resolve at all.
const REDIRECT = {
  title: "Acme in the news",
  url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbCdEf123456",
  source: "vertexaisearch.cloud.google.com",
  summary: "A grounded citation with a redirect url.",
  suggestion: "Acme's recent coverage caught my eye, and it reinforced why I want to contribute here.",
};

let ENGINE_B64 = "";
let ENGINE_LINES = [];

beforeAll(async () => {
  const cl = await embeddedEngine.tailorCoverLetter({
    jobPosting: "Staff Engineer at Acme. React, Node, telemetry, accessibility.",
    jobTitle: "Staff Engineer",
    companyName: "Acme",
  });
  ENGINE_B64 = cl.docxB64;
  ENGINE_LINES = cl.resultLines;
});

let store = { facts: [], removed: [], revision: null };
let putBodies = [];
let researchArticles = [];
let putGate = null; // when set, the accepted-facts PUT awaits it before responding
let probe = null;
let container = null;
let root = null;

function json(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function entryWithEngineLetter(overrides = {}) {
  return {
    status: "done",
    result: "",
    resultLines: [],
    docxB64: "",
    docxPath: "",
    coverLetterResultLines: [...ENGINE_LINES],
    coverLetterDocxB64: ENGINE_B64,
    coverVersionId: "ver-1",
    ...overrides,
  };
}

function HookProbe({ initialMap }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const research = useCompanyResearch({ tailoringMap, setTailoringMap, setPreviewReloadKey });
  probe = { tailoringMap, setTailoringMap, research, previewReloadKey };
  return null;
}

beforeEach(() => {
  store = { facts: [], removed: [], revision: null };
  putBodies = [];
  researchArticles = [];
  putGate = null;
  probe = null;
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const u = String(url);
    if (u.includes("/api/company-research")) return json({ articles: researchArticles, warnings: [] });
    if (u.includes("/api/accepted-facts")) {
      if (method === "GET") return json({ facts: store.facts, removed: store.removed, revision: store.revision });
      const body = JSON.parse(init.body);
      putBodies.push(body);
      if (putGate) await putGate; // hold the response open to test a mid-flight close / edit
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

// Drain a run that awaits a real docx (de)serialize -- microtask flushes alone
// are not enough (the removal suite advances real time the same way).
async function drain(steps = 20) {
  for (let n = 0; n < steps; n += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

async function mount(initialMap) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(HookProbe, { initialMap }));
  });
  await flush();
}

// Warm the job's research the real way -- openCompanyResearch fires the POST
// (returning researchArticles) AND seeds the accepted-facts state from the GET
// (returning `store`, incl. its removed log). One call, both sources seeded.
async function seedResearch(articles, { removed = [] } = {}) {
  researchArticles = articles;
  store = { facts: [], removed, revision: removed.length ? 1 : null };
  await act(async () => {
    probe.research.openCompanyResearch(JOB);
  });
  await flush();
}

function coverLines() {
  return probe.tailoringMap[JOB_ID]?.coverLetterResultLines || [];
}
function insertedFacts() {
  return probe.tailoringMap[JOB_ID]?.insertedFacts || [];
}
function assertIsFunction() {
  expect(
    typeof probe.research.autoInsertFactsForJob,
    "autoInsertFactsForJob is not exposed by useCompanyResearch -- the N72 auto-insert function does not exist yet",
  ).toBe("function");
}

describe("N72 auto-select predicate: only a real, openable, non-redirect source inserts unasked", () => {
  it("inserts the sourced facts and excludes the url-less and grounding-redirect ones", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await seedResearch([REAL_1, NULL_URL, REDIRECT, REAL_2]);
    assertIsFunction();

    await act(async () => {
      await probe.research.autoInsertFactsForJob(JOB_ID, () => true);
    });
    await drain();

    const text = coverLines().join("\n");
    // Positive control -- the eligible facts DID insert (else "excludes the
    // others" would be vacuous: a function that inserts nothing passes too).
    expect(text, "an eligible sourced fact was not auto-inserted").toContain(REAL_1.suggestion);
    expect(text, "an eligible sourced fact was not auto-inserted").toContain(REAL_2.suggestion);
    // The predicate excludes the uncheckable claims (the N35 failure direction).
    expect(text, "a url-less fact was auto-inserted into the letter").not.toContain(NULL_URL.suggestion);
    expect(text, "a grounding-redirect fact was auto-inserted into the letter").not.toContain(REDIRECT.suggestion);
    // Exactly the two eligible facts are recorded as located inserted facts.
    expect(insertedFacts().map((r) => r.text).sort()).toEqual([REAL_2.suggestion, REAL_1.suggestion].sort());
  });

  it("each auto-inserted fact is recorded LOCATED, and the located span holds its own text", async () => {
    // The shipped highlight (useDocumentPreview.js:422) and removal
    // (removeInsertedFact) both key on {lineIndex, offset}. A record that is
    // merely {id,text} (the stale insertedFactTexts contract) would leave every
    // auto-inserted fact unhighlighted AND unremovable -- reaching an employer
    // unreviewed. So: every record locates its own text at its own offset.
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await seedResearch([REAL_1, REAL_2]);
    assertIsFunction();

    await act(async () => {
      await probe.research.autoInsertFactsForJob(JOB_ID, () => true);
    });
    await drain();

    const records = insertedFacts();
    expect(records.length, "not both eligible facts were recorded").toBe(2);
    const lines = coverLines();
    for (const r of records) {
      expect(typeof r.lineIndex, `record for ${JSON.stringify(r.text)} carries no numeric lineIndex`).toBe("number");
      expect(typeof r.offset, `record for ${JSON.stringify(r.text)} carries no numeric offset`).toBe("number");
      // the located span in the actual line IS the recorded text (F2 invariant)
      const span = String(lines[r.lineIndex] ?? "").slice(r.offset, r.offset + r.text.length);
      expect(span, `record's located span does not hold its own text`).toBe(r.text);
      // provenance carried through for the strip's source link + the removed log
      expect(r.url, "record carries no source url for the review strip's link").toBeTruthy();
    }
  });
});

describe("N72 removed-fact skip: a retracted fact is never silently re-inserted", () => {
  it("skips a fact whose identity is in this application's removed log, but still inserts the others", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    // REAL_1 was removed earlier (its identity is in the removed log the GET
    // seeds); REAL_2 was not. A later auto-run must respect that.
    await seedResearch([REAL_1, REAL_2], { removed: [REAL_1.url] });
    assertIsFunction();

    await act(async () => {
      await probe.research.autoInsertFactsForJob(JOB_ID, () => true);
    });
    await drain();

    const text = coverLines().join("\n");
    expect(text, "a previously-removed fact was silently re-inserted by auto-insert").not.toContain(REAL_1.suggestion);
    // Control: the non-removed eligible fact still inserts, so "skipped" is not
    // just "the whole run did nothing".
    expect(text, "the non-removed eligible fact was not inserted").toContain(REAL_2.suggestion);
  });
});

describe("N72 no review surface: auto-insert does nothing when the modal is not open", () => {
  it("makes no change and no store write when isOpen() is false at fire time", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await seedResearch([REAL_1, REAL_2]);
    assertIsFunction();

    const before = coverLines().join("\n");
    const putsBefore = putBodies.length;
    await act(async () => {
      await probe.research.autoInsertFactsForJob(JOB_ID, () => false);
    });
    await drain();

    expect(coverLines().join("\n"), "auto-insert wrote to a letter with no open review surface").toBe(before);
    expect(insertedFacts().length, "auto-insert recorded facts with no open review surface").toBe(0);
    expect(putBodies.length, "auto-insert persisted to the store with no open review surface").toBe(putsBefore);
  });

  it("does not persist if the modal closes while the write is in flight (re-check AT the write)", async () => {
    // The subtle case: open when the run fires, closed by the time it writes.
    // isOpen returns true for the entry check, false for every later call --
    // exactly a modal closed mid-flight. A function that only checks open-ness
    // when it FIRES (not at the write) would still persist the fact.
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await seedResearch([REAL_1, REAL_2]);
    assertIsFunction();

    const putsBefore = putBodies.length;
    let calls = 0;
    const isOpen = () => calls++ === 0; // true once (entry), false thereafter (the write)

    await act(async () => {
      await probe.research.autoInsertFactsForJob(JOB_ID, isOpen);
    });
    await drain();

    expect(calls, "isOpen was never re-checked after the entry gate -- a mid-flight close cannot be detected").toBeGreaterThan(1);
    expect(coverLines().join("\n"), "a fact was spliced into a letter after its review surface closed").not.toContain(REAL_1.suggestion);
    expect(insertedFacts().length, "a fact was recorded after its review surface closed").toBe(0);
    expect(
      putBodies.length,
      "a fact was PERSISTED to the store after the modal closed mid-flight -- it could resurface unreviewed on a version switch",
    ).toBe(putsBefore);
  });
});

describe("N72 no clobber: the write re-reads the fresh letter (ORDERING, not concurrency -- N74)", () => {
  it("a hand edit committed after the run's snapshot survives, and the fact still lands on the fresh lines", async () => {
    // N74 measurement limit, stated honestly: act() serializes, so this is a
    // hand edit committed strictly BETWEEN the run's snapshot and its write --
    // it proves the write re-reads fresh state (ORDERING), never a true race.
    // Mechanism: the accepted-facts PUT is held open (putGate); the run reaches
    // its write and suspends there; we commit the hand edit; then release.
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await seedResearch([REAL_1]);
    assertIsFunction();

    let releasePut;
    putGate = new Promise((resolve) => {
      releasePut = resolve;
    });

    const HAND_EDIT = "I am personally relocating to Dublin this spring.";
    let done;
    await act(async () => {
      done = probe.research.autoInsertFactsForJob(JOB_ID, () => true);
    });
    // The run has taken its pre-await snapshot and is now suspended on the PUT.
    // Commit a hand edit to a DIFFERENT line than the fact's, marking the cover
    // scope edited -- exactly what the candidate typing mid-flight would do.
    await act(async () => {
      probe.setTailoringMap((m) => {
        const cur = m[JOB_ID];
        const lines = [...cur.coverLetterResultLines];
        lines[lines.length - 2] = `${lines[lines.length - 2]} ${HAND_EDIT}`;
        return { ...m, [JOB_ID]: { ...cur, coverLetterResultLines: lines, edited: { resume: false, cover: true } } };
      });
    });
    await flush();
    expect(coverLines().join("\n"), "sanity: the hand edit was committed before release").toContain(HAND_EDIT);

    await act(async () => {
      releasePut();
      await done;
    });
    await drain();

    const text = coverLines().join("\n");
    expect(text, "auto-insert clobbered the candidate's hand edit with a stale pre-await snapshot").toContain(HAND_EDIT);
    expect(text, "auto-insert did not add the fact to the fresh letter after the mid-flight edit").toContain(REAL_1.suggestion);
  });
});
