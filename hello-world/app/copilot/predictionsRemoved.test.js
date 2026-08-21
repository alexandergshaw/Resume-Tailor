// AC-R1.5: the predicted next question and its pre-drafted answer are GONE
// from the copilot — not defaulted off, not hidden behind a switch, not
// left unwired. Removed rather than disabled, so this file's job is to
// prove the code is absent, which makes it a source-text test.
//
// Reading source text is normally a poor test. It is the right tool here
// because the property being asserted IS the shape of the source: a feature
// that still exists behind a `false` constant is exactly the outcome this
// change was asked to avoid, and no behavioural test can distinguish
// "deleted" from "unreachable this render".
//
// Two disciplines this repo learned the hard way and applies below:
//   - An assertion of ABSENCE is satisfied by a dead file. Every banned
//     sweep is paired with a POSITIVE CONTROL on the same file — a string
//     that must still be there — so deleting a whole module cannot make
//     this suite green.
//   - A malformed ban is indistinguishable from a clean result. The CANARY
//     block at the bottom feeds every banned pattern a string it MUST
//     match, so a regex that can never match anything fails loudly instead
//     of reporting all-clear having checked nothing.

import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const APP_DIR = fileURLToPath(new URL("../../app", import.meta.url));
const LIB_DIR = fileURLToPath(new URL("../../lib", import.meta.url));
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

function read(rel) {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

// Every .js file under app/ and lib/, for the repo-wide sweeps at the
// bottom. Walks the tree rather than taking a hand-written list: a stale
// list is how a surviving import escapes a sweep like this.
//
// The four files that make up this removal's acceptance gate are the only
// exclusions, and they have to be: each one quotes the removed feature's
// identifiers and user-visible strings VERBATIM — that is what makes their
// bans falsifiable, and it is the whole point of this file's canary block
// below. Without the exclusion every repo-wide sweep would match the gate's
// own samples and fail forever no matter what the rest of the tree looked
// like.
//
// Excluded by explicit resolved path, never by a `.test.js` suffix rule: a
// surviving reference in any OTHER test file — including one importing a
// module that no longer exists, which would fail at collection time — must
// still be caught here.
const GATE_FILES = [
  "app/copilot/predictionsRemoved.test.js",
  "app/copilot/useCopilotDashboard.noSpeculation.test.js",
  "app/copilot/dashboard/CopilotDashboard.render.test.js",
  "lib/copilot/practiceNotices.noPreDraft.test.js",
].map((rel) => path.resolve(path.join(ROOT, rel)));

// Walked and READ exactly once, then shared. This is not premature
// optimisation — it is the difference between this file passing and failing
// on a fresh checkout. The tree is ~709 files / 7MB; a cold-cache read of
// all of it measured 14.6 SECONDS against vitest's 5s default `testTimeout`,
// while the warm re-read is under a second. With a sweep per test, whichever
// one ran first on a cold filesystem cache timed out and reported as a real
// violation ("nothing anywhere imports the deleted modules" — Test timed out
// in 5000ms), passing on every rerun. A test that fails only on the first
// run after a checkout is how these sweeps end up deleted by someone who
// reasonably concludes they are broken. One read, in a beforeAll with an
// explicit budget, keeps the cost visible and bounded.
let CACHE = null;

function sourceFiles() {
  if (CACHE) return CACHE;
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (full.endsWith(".js") && !GATE_FILES.includes(path.resolve(full))) found.push(full);
    }
  };
  walk(APP_DIR);
  walk(LIB_DIR);
  CACHE = found.map((f) => [path.relative(ROOT, f).split(path.sep).join("/"), readFileSync(f, "utf8")]);
  return CACHE;
}

// Every file whose source matches `pattern`, as repo-relative paths — the
// shape all three sweeps below assert `toEqual([])` against, so a violation
// names itself instead of reporting a bare count.
function filesMatching(pattern) {
  const test = typeof pattern === "string" ? (src) => src.includes(pattern) : (src) => pattern.test(src);
  return sourceFiles()
    .filter(([, src]) => test(src))
    .map(([rel]) => rel);
}

beforeAll(() => {
  sourceFiles();
}, 60_000);

// Per-file contract: what must be gone, and what must still be there.
// `banned` are the feature's own identifiers and user-visible strings.
// `keep` are load-bearing survivors — the file's real job, which this
// change must not have taken with it.
const FILES = [
  {
    rel: "app/copilot/useCopilotDashboard.js",
    banned: [
      /predict/i,
      /predraft/i,
      /speculat/i,
      /questionClient/,
      /answerClient/,
      /fetchNextQuestion/,
      /draftAnswer/,
      // The transport bans are what make the runtime assertion in
      // useCopilotDashboard.noSpeculation.test.js total. That test stubs
      // `fetch`, which a review defeated in one line — `const send =
      // globalThis.fetch.bind(globalThis)` at module scope captures the real
      // transport before any stub installed inside an `it` can replace it —
      // and defeated again with `XMLHttpRequest`, which nothing stubs at
      // all. No runtime stub can close every route (a Worker, an `<img>`
      // beacon), but this file can: everything this hook does is
      // livePace.js arithmetic, so it has no business touching a transport
      // by any name.
      /\bfetch\s*\(/,
      /XMLHttpRequest/,
      /sendBeacon/,
      /new Worker/,
      /\/api\/copilot\//,
    ],
    keep: [/computeLivePace/, /computeLiveFillers/, /recordSpeechSample/, /resetForSession/],
  },
  {
    rel: "app/copilot/dashboard/CopilotDashboard.js",
    // The four synonym bans catch the same feature under a new name. A
    // review reintroduced both panels verbatim as "Likely next question" /
    // "Answer to the likely next question" and every vocabulary check here
    // stayed green, because none of them said "predict". Banned over the
    // whole SOURCE rather than only the exported copy objects: that mutant's
    // successor put its strings inline in the JSX, where a sweep over
    // LIVE_COPY/PRACTICE_COPY never sees them.
    banned: [
      /predict/i,
      /predraft/i,
      /pre-draft/i,
      /togglePredictions/,
      /look[- ]?ahead/i,
      /upcoming/i,
      /anticipat/i,
      /coming next/i,
    ],
    // `chipLabel="Unconfirmed"` rather than the bare word: deleting the
    // whole provisional branch still leaves "Unconfirmed" in three of
    // AccentPanel's surrounding comments, so the loose form passed against
    // a mutant that had removed the branch entirely.
    keep: [/currentQuestionTitle/, /deliveryTitle/, /chipLabel="Unconfirmed"/, /latestQuestionEntry/],
  },
  {
    // The two client-module bans are what stop the removal being defeated
    // by RELOCATION. Banning the speculative call only inside the hook
    // leaves "move the same effect one file up into the component" wide
    // open, and an adversarial review demonstrated exactly that mutant
    // green: a `useEffect` here calling fetchNextQuestion and then
    // draftAnswer into a local ref reproduces the whole feature with the
    // hook untouched. Neither client module is imported here any more, so
    // the ban costs nothing and closes the escape.
    rel: "app/copilot/CopilotClient.js",
    banned: [
      /predict/i,
      /predraft/i,
      /onPrefetchedAnswer/,
      /usePredictionVisibility/,
      /from "@\/lib\/copilot\/questionClient"/,
      /from "@\/lib\/copilot\/answerClient"/,
      // Banning the client-module IMPORTS alone still allowed the same two
      // requests to be issued by raw `fetch` from here. A blanket fetch ban
      // is wrong for this file — it legitimately probes
      // `/api/copilot/token` on mount — so the two speculative ENDPOINTS are
      // named instead.
      /"\/api\/copilot\/question"/,
      /"\/api\/copilot\/answer"/,
    ],
    keep: [/answerCacheRef/, /useCopilotDashboard/, /recordSpeechSample/],
  },
  {
    // Same relocation ban as live mode above. Practice mode's DRILL
    // questions do come from questionClient — but through
    // usePracticeQuestions.js, never from this component directly, which is
    // why the ban here is safe and why the survivor is pinned separately
    // below.
    rel: "app/copilot/practice/PracticeClient.js",
    banned: [
      /predict/i,
      /predraft/i,
      /onPrefetchedAnswer/,
      /\.prime\(/,
      /questionClient/,
      /answerClient/,
      /"\/api\/copilot\/question"/,
      /"\/api\/copilot\/answer"/,
    ],
    keep: [/useCopilotDashboard/, /shouldQueueSampleAnswer/, /sampleAnswer\.queue\(/, /buildPrivacyNotice/],
  },
  {
    // NOTE: /predict/i would also match this file's pre-existing, unrelated
    // "wrap points unpredictable as labels change" comment, so the ban here
    // is on the feature's own words only.
    rel: "app/copilot/practice/PracticeControls.js",
    banned: [/predicted/i, /prediction/i, /predraft/i, /pre-draft/i],
    keep: [/Save recordings to my account/, /Include camera frames in AI feedback/],
  },
  {
    rel: "app/copilot/practice/useSampleAnswer.js",
    banned: [/predict/i, /predraft/i, /\bprime\b/],
    // Deliberately specific. `/cacheRef/` and `/queue/` both passed against
    // a mutant that had deleted `queue` outright — nine leftover comment
    // mentions plus the now-orphaned `queueGenRef`/`queuedForRef` satisfied
    // them. A `keep` regex cannot tell a live function from its own
    // obituary unless it names the definition, the export, and the write.
    // `/\bqueue\b\s*[,}]/` rather than an anchored `/^\s+queue,$/m`: the
    // latter is just as strong but breaks the moment the returned object is
    // reformatted onto one line, which is a legitimate edit that should not
    // fail this.
    keep: [/const queue = useCallback/, /\bqueue\b\s*[,}]/, /cacheRef\.current\.set/],
  },
  {
    rel: "lib/copilot/practiceNotices.js",
    banned: [/predict/i, /predraft/i, /pre-draft/i],
    keep: [/Revealing a sample answer/, /buildPrivacyNotice/],
  },
];

// Deleted outright — a module kept around "in case" is the disabled-not-
// removed outcome in another form.
const DELETED = [
  "lib/copilot/predictionPrefs.js",
  "lib/copilot/predictionPrefs.test.js",
  "app/copilot/usePredictionVisibility.js",
  "app/copilot/useCopilotDashboard.wiring.test.js",
];

describe("the predicted question/answer feature is removed from both modes", () => {
  for (const { rel, banned, keep } of FILES) {
    describe(rel, () => {
      it("still exists and still does its own job", () => {
        // The positive control. Without this, deleting the file outright
        // would satisfy every banned assertion below.
        expect(existsSync(path.join(ROOT, rel))).toBe(true);
        const src = read(rel);
        for (const pattern of keep) expect(src).toMatch(pattern);
      });

      it("carries none of the prediction feature's vocabulary", () => {
        const src = read(rel);
        for (const pattern of banned) expect(src).not.toMatch(pattern);
      });
    });
  }

  for (const rel of DELETED) {
    it(`${rel} no longer exists`, () => {
      expect(existsSync(path.join(ROOT, rel))).toBe(false);
    });
  }

  it("[control] the repo-wide sweep walks a populated tree", () => {
    // Three sweeps below assert an EMPTY offender list. An empty list is
    // also what a walk that found no files at all produces, so pin that the
    // walk is real: it returns hundreds of files, it reaches both roots, and
    // the four gate files are the only things it excludes.
    const swept = sourceFiles().map(([rel]) => rel);
    expect(swept.length).toBeGreaterThan(100);
    expect(swept).toContain("app/copilot/CopilotClient.js");
    expect(swept).toContain("lib/copilot/practiceNotices.js");
    expect(swept).not.toContain("app/copilot/predictionsRemoved.test.js");
    // And that the sources really came with it — a walk that collected paths
    // but read empty strings would satisfy every sweep below.
    expect(sourceFiles().every(([, src]) => typeof src === "string" && src.length > 0)).toBe(true);
  });

  it("nothing anywhere under app/ or lib/ imports the deleted modules", () => {
    expect(filesMatching(/predictionPrefs|usePredictionVisibility/)).toEqual([]);
  });

  it("the preference's localStorage key is neither read nor written anywhere", () => {
    expect(filesMatching("copilot-show-predictions")).toEqual([]);
  });

  it("the three survivors that resemble the removed feature are still wired", () => {
    // Each of these is a DIFFERENT feature that a careless removal would
    // plausibly sweep up, because each looks like the thing being deleted:
    // practice mode's drill questions come from the very route the
    // prediction used; useSampleAnswer.queue drafts an answer nobody has
    // asked to see yet; and live mode's Auto-draft writes into the cache
    // the pre-draft used to write into. Deleting any of them would look
    // superficially consistent with this change and would silently cost a
    // working feature.
    expect(read("app/copilot/practice/usePracticeQuestions.js")).toMatch(/fetchNextQuestion\(\{/);
    expect(read("app/copilot/practice/PracticeClient.js")).toMatch(/sampleAnswer\.queue\(/);
    expect(read("app/copilot/CopilotClient.js")).toMatch(/answerCacheRef/);
  });

  it("no surface anywhere still offers to pre-draft a predicted answer", () => {
    expect(filesMatching("Pre-draft predicted answer")).toEqual([]);
  });
});

describe("[canary] every banned pattern can actually match", () => {
  // A ban that matches nothing reports the same all-clear as a genuine
  // removal. Each pattern is fed a string drawn from the code being
  // removed, so a broken regex fails here instead of passing silently
  // above.
  const SAMPLES = [
    "predictedQuestion,",
    "const predraftKey = predraftKeyFor(a, b, c);",
    "speculativeWorkEnabled(active, predictionsEnabled)",
    'import { fetchNextQuestion } from "@/lib/copilot/questionClient";',
    'import { draftAnswer } from "@/lib/copilot/answerClient";',
    'togglePredictions: "Show predicted question and answer",',
    "onPrefetchedAnswer,",
    "usePredictionVisibility()",
    "sampleAnswer.prime(question, payload)",
    "Pre-drafting only applies while the predicted question and answer are shown.",
    "Pre-draft predicted answer",
    'const res = await fetch("/api/copilot/question", { method: "POST" });',
    "const xhr = new XMLHttpRequest();",
    'navigator.sendBeacon("/api/copilot/answer", body);',
    'const w = new Worker("/speculate.js");',
    'lookaheadTitle: "Likely next question",',
    "upcoming: true,",
    "anticipatedQuestion,",
    'comingNextTitle: "What is coming next",',
  ];
  // Deduped by identity into a Map rather than by packing source+flags into
  // a delimited string and parsing it back. That encoding used "///" as the
  // delimiter and broke the moment a pattern's own source contained a
  // slash — `/\/api\/copilot\//` split into fragments and threw
  // "Invalid flags supplied to RegExp constructor" at collection time,
  // taking the whole file down. Payload never delimits payload; the same
  // rule the deleted prediction signature was built on.
  const ALL = new Map(FILES.flatMap((f) => f.banned.map((r) => [String(r), r])));

  for (const [label, re] of ALL) {
    it(`${label} matches at least one real sample`, () => {
      // `re.test` advances `lastIndex` on a /g regex; none of these are
      // global, but `.some` short-circuits either way, so build a fresh
      // matcher per call rather than relying on that.
      expect(SAMPLES.some((s) => new RegExp(re.source, re.flags).test(s))).toBe(true);
    });
  }
});
