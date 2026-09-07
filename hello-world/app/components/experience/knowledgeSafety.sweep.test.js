// The knowledge feature's invariants, as an executable source scan.
//
// Every property below is already true of the code as written and true for a
// stated reason. This file exists so that it stays true in a file that does
// not exist yet - a `href={citation.url}` added next year, a `tools:` block
// added to "just add web search", an `opacity: 0.38` copied off another panel.
//
// ---------------------------------------------------------------------------
// A SWEEP THAT FINDS NOTHING BECAUSE ITS SCANNER IS BROKEN IS INDISTINGUISHABLE
// FROM A CLEAN CODEBASE. That is not hypothetical here: this repo shipped a
// stripper that silently blanked a real `window.open(` site and under-reported
// its own sweep by one, with no error, because a `"` inside a regex literal
// desynced its quote tracker for the rest of the file. So this file:
//
//   * imports lib/sourceScan/tokenizeSource.js - the ONE shared, regex-aware
//     stripper both shipped sweeps now use - rather than writing a fourth copy;
//   * asserts it actually READ the feature's files, by name and by count;
//   * carries a POSITIVE CONTROL: pointed at real repo files that genuinely
//     contain each construct, every rule finds it;
//   * carries a FALSE-NEGATIVE CONTROL: a planted source containing every
//     banned construct is caught by every rule;
//   * carries a FALSE-POSITIVE CONTROL: the same constructs written inside a
//     line comment, a block comment and a string are counted by nothing -
//     including against a REAL repo file whose prose names the construct it
//     promises never to use.
//
// ---------------------------------------------------------------------------
// WHY THIS SWEEP SCANS lib/ AND THE SHIPPED href SWEEP DOES NOT.
// app/components/hrefSafety.sweep.test.js sets its root to `app` and never
// looks at `lib/` at all; its sibling windowOpenSafety.sweep.test.js scans
// both. That asymmetry is specific to `href` and easy to assume away, and five
// of this feature's modules live under lib/ - including the two that build the
// model prompt and the one that writes the downloadable log.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { tokenizeSource } from "../../../lib/sourceScan/tokenizeSource.js";

const ROOT = process.cwd();

// Every source file of the knowledge-summary feature. Listed explicitly rather
// than globbed: a glob that stopped matching would silently sweep nothing,
// which is the exact failure this file's controls exist to make impossible.
const FEATURE_FILES = [
  "app/components/experience/KnowledgePanel.js",
  "app/components/experience/KnowledgeQuestionBox.js",
  "app/components/experience/KnowledgeHistory.js",
  "app/components/experience/knowledgePanelStyles.js",
  "app/hooks/useKnowledgeScope.js",
  "lib/experience/knowledgeScope.js",
  "lib/experience/knowledgePrompts.js",
  "lib/experience/knowledgeView.js",
  "lib/experience/knowledgeLog.js",
  "lib/experience/knowledgeLoad.js",
  "lib/supabase/experienceKnowledge.js",
  "lib/supabase/experienceKnowledgePurge.js",
  "app/api/experience/knowledge/route.js",
  "app/api/experience/knowledge/question/route.js",
];

/**
 * The rules.
 *
 * `view` decides which of tokenizeSource's two parallel views a rule reads,
 * and it is load-bearing rather than a detail:
 *
 *   "code"     comments AND string contents blanked. For a rule about real
 *              code - a JSX attribute, a property access, an object key. A
 *              `href` written in prose or inside a quoted example can never
 *              register.
 *   "readable" comments blanked, string contents KEPT. For the two rules whose
 *              subject IS a string: a colour literal, and a module specifier
 *              in an import. Reading those off "code" would find nothing,
 *              forever, and look clean.
 */
const RULES = [
  {
    id: "href",
    view: "code",
    re: /\bhref\b/g,
    why: "nothing in this panel has a URL to point at; a model-authored link renders as inert text",
  },
  {
    id: "dangerouslySetInnerHTML",
    view: "code",
    re: /\bdangerouslySetInnerHTML\b/g,
    why: "model output is rendered as React elements, never as HTML",
  },
  {
    id: "window.open",
    view: "code",
    re: /\bwindow\s*\.\s*open\b/g,
    why: "no navigation of any kind is initiated from model output",
  },
  {
    id: "location navigation",
    view: "code",
    re: /\blocation\s*\.\s*(?:assign|replace)\b|\blocation\s*\.\s*href\s*=/g,
    why: "same reason as window.open, by the other three spellings",
  },
  {
    id: "router navigation",
    view: "code",
    re: /\brouter\s*\.\s*(?:push|replace)\b/g,
    why: "a citation selects a page in component state; it is not a route",
  },
  {
    id: "model tools",
    view: "code",
    re: /\btools\b/g,
    why: "grounding is refused: responseMimeType is incompatible with it, and no-web-access is this feature's only anti-exfiltration property",
  },
  {
    id: "googleSearch",
    view: "code",
    re: /\bgoogleSearch\b/g,
    why: "see model tools",
  },
  {
    id: "grounded source helpers",
    view: "code",
    re: /\b(?:resolveGroundedSources|extractGroundingSources)\b/g,
    why: "importing either would be the first half of adding web grounding back",
  },
  {
    id: "opacity",
    view: "code",
    re: /\bopacity\b/g,
    why: "a blocked control kept in the tab order so its reason can be READ cannot be rendered at 1.8:1; the label swaps instead",
  },
  {
    id: "nested scroller",
    view: "readable",
    re: /overflow[XY]?\s*:\s*["'](?:auto|scroll)["']/g,
    why: "a nested scroller traps the wheel and hides its content from find-in-page; the collapsed body is `overflow: hidden` plus a real control",
  },
  {
    id: "motion",
    view: "code",
    re: /\b(?:transition|animation)\s*:/g,
    why: "prefers-reduced-motion occurs zero times in this repo and zero times in the installed MUI tree, so there is no guard to opt into",
  },
  {
    id: "motion components",
    view: "code",
    re: /\b(?:Collapse|Fade|Grow|Slide|Zoom|Skeleton|CircularProgress)\b/g,
    why: "MUI's collapsing container leaves its subtree mounted and readable while hiding it, which would silence a live region placed inside it",
  },
  {
    id: "colour literal",
    view: "readable",
    re: /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\brgba?\s*\(|\bhsla?\s*\(/g,
    why: "a literal colour flips in NEITHER theme channel: prefers-color-scheme occurs exactly once in this repo, inside the no-flash script, and there is no @media dark rule at all",
  },
  {
    id: "banned import",
    view: "readable",
    re: /from\s+["'][^"']*(?:lib\/supabase\/admin|lib\/scrape\/|lib\/copilot\/pageCitations|lib\/copilot\/answerPoints|lib\/tracking\/renderCitedMarkdown|api\/copilot\/answer\/route)[^"']*["']/g,
    // pageCitations' whole contract is POSITIONAL pairing - it returns a
    // positionally-indexed array - and importing it would look like reuse
    // while quietly reintroducing the resolution mode this feature refused.
    why: "each of these is a positional-citation or grounded-source path this feature deliberately does not use",
  },
];

// `fetch(` is banned in the lib/ modules only: they are pure or server-side and
// take a client, never resolve one. The client hook fetches, which is its job.
const LIB_ONLY_RULE = {
  id: "fetch in lib/",
  view: "code",
  re: /\bfetch\s*\(/g,
  why: "the lib modules are pure or take an authenticated client; a fetch there is a second, ungated network path",
};

function viewsOf(source) {
  const { readable, codeMask } = tokenizeSource(source);
  return { readable, code: codeMask };
}

/** Every match of `rule` in `source`, as { line, text }. */
function hits(source, rule) {
  const text = viewsOf(source)[rule.view];
  const out = [];
  const re = new RegExp(rule.re.source, rule.re.flags.includes("g") ? rule.re.flags : `${rule.re.flags}g`);
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ line: text.slice(0, m.index).split("\n").length, text: m[0] });
    if (m.index === re.lastIndex) re.lastIndex += 1;
  }
  return out;
}

const SOURCES = FEATURE_FILES.map((rel) => ({ rel, full: path.join(ROOT, rel) }))
  .filter((f) => existsSync(f.full))
  .map((f) => ({ ...f, src: readFileSync(f.full, "utf8") }));

describe("the sweep actually reads the feature", () => {
  it("finds every file it claims to scan - a missing file must fail here, not vanish from the sweep", () => {
    const missing = FEATURE_FILES.filter((rel) => !existsSync(path.join(ROOT, rel)));
    expect(missing).toEqual([]);
    expect(SOURCES).toHaveLength(FEATURE_FILES.length);
  });

  it("reads real, non-trivial sources rather than empty strings", () => {
    for (const { rel, src } of SOURCES) {
      expect(src.length, `${rel} is empty`).toBeGreaterThan(400);
    }
  });

  it("tokenizes without desyncing: both views stay the same length as the source", () => {
    // The failure mode that under-reported a shipped sweep by one real site.
    for (const { rel, src } of SOURCES) {
      const { readable, code } = viewsOf(src);
      expect(readable.length, `${rel} readable view desynced`).toBe(src.length);
      expect(code.length, `${rel} code view desynced`).toBe(src.length);
    }
  });
});

describe("the knowledge feature holds its invariants", () => {
  for (const rule of RULES) {
    it(`has no ${rule.id} anywhere in the feature`, () => {
      const found = SOURCES.flatMap(({ rel, src }) => hits(src, rule).map((h) => `${rel}:${h.line} ${h.text}`));
      expect(found, `${rule.id} — ${rule.why}`).toEqual([]);
    });
  }

  it("has no fetch( in any of the feature's lib/ modules", () => {
    const found = SOURCES.filter(({ rel }) => rel.startsWith("lib/")).flatMap(({ rel, src }) =>
      hits(src, LIB_ONLY_RULE).map((h) => `${rel}:${h.line}`),
    );
    expect(found, LIB_ONLY_RULE.why).toEqual([]);
  });

  it("ships no markdown library - the renderer is this repo's own tokenizer", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    for (const banned of ["react-markdown", "marked", "markdown-it", "remark", "rehype", "dompurify", "snarkdown"]) {
      expect(names, `${banned} must not be a dependency`).not.toContain(banned);
    }
  });

  it("keeps the shipped href sweep's ungated allow-list at exactly two entries", () => {
    // Growing that list is the cheap way to defeat the OTHER sweep, and this
    // feature renders model markdown through the very component whose
    // same-origin branch is one of the two entries.
    const src = readFileSync(path.join(ROOT, "app/components/hrefSafety.sweep.test.js"), "utf8");
    const listStart = src.indexOf("const ALLOWED_UNGATED");
    expect(listStart).toBeGreaterThan(-1);
    const list = src.slice(listStart, src.indexOf("\n];", listStart));
    expect((list.match(/^\s{2}\{$/gm) || []).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// THE THREE CONTROLS
// ---------------------------------------------------------------------------

// Real repo files that genuinely contain the constructs above. If the scanner
// stops finding these, every `it` in the block above is passing vacuously.
const POSITIVE_CONTROLS = [
  { file: "app/components/experience/MarkdownPreview.js", rule: "href" },
  { file: "app/components/experience/MarkdownPreview.js", rule: "colour literal" },
  { file: "app/components/DocumentPreviewDialog.js", rule: "dangerouslySetInnerHTML" },
  { file: "app/components/experience/PageTreeItem.js", rule: "motion" },
  { file: "app/components/ApplyingControls.js", rule: "opacity" },
  { file: "app/components/ChatPanel.js", rule: "nested scroller" },
];

describe("[positive control] the rules find their construct in real repo files that have it", () => {
  for (const { file, rule: id } of POSITIVE_CONTROLS) {
    it(`finds ${id} in ${file}`, () => {
      const rule = RULES.find((r) => r.id === id);
      const src = readFileSync(path.join(ROOT, file), "utf8");
      expect(hits(src, rule).length, `${id} not found in ${file} — the scanner is broken`).toBeGreaterThan(0);
    });
  }
});

// One synthetic source carrying a deliberate violation of every rule.
const PLANTED = `
import { resolveGroundedSources } from "@/lib/copilot/answerPoints";
import { pageCitations } from "@/lib/copilot/pageCitations";
const brand = "#1976d2";
const shade = "rgba(0, 0, 0, 0.23)";
const SX = { opacity: 0.38, transition: "all 200ms", overflowY: "auto" };
function go(row, router) {
  window.open(row.url, "_blank");
  location.assign(row.url);
  location.href = row.url;
  router.push(row.url);
  fetch("/api/thing");
  return { tools: [{ googleSearch: {} }], sources: extractGroundingSources(row) };
}
const el = <a href={row.url} dangerouslySetInnerHTML={{ __html: row.html }} />;
const spinner = <CircularProgress />;
`;

describe("[false-negative control] a planted violation is caught by every rule", () => {
  for (const rule of [...RULES, LIB_ONLY_RULE]) {
    it(`catches a planted ${rule.id}`, () => {
      expect(hits(PLANTED, rule).length, `a deliberate ${rule.id} was NOT caught`).toBeGreaterThan(0);
    });
  }
});

// The same constructs, written where they are harmless. `readable`-view rules
// (colour literal, nested scroller, banned import) are subjects that ARE
// strings, so their false-positive control is the comment, not the string
// literal - putting them in a string is the real thing, not a false positive.
const COMMENTED = `
// never window.open, never location.assign, never location.href = url
/* no dangerouslySetInnerHTML, no href, no opacity, no transition: none
   no tools, no googleSearch, no resolveGroundedSources,
   no extractGroundingSources, no router.push, no fetch(, no CircularProgress,
   no #1976d2, no rgba(0,0,0,0.23), no overflowY: "auto",
   and never from "@/lib/copilot/pageCitations" */
const SAFE = 1;
`;

const IN_STRINGS = `
const prose = "window.open and location.assign and router.push and fetch( and href";
const more = 'dangerouslySetInnerHTML, opacity, transition:, tools, googleSearch';
const third = \`resolveGroundedSources extractGroundingSources CircularProgress\`;
const re = /[\\\\/:*?"<>|]/g;
const afterRegex = "still a string, not code";
`;

describe("[false-positive control] the same constructs in a comment are counted by nothing", () => {
  for (const rule of [...RULES, LIB_ONLY_RULE]) {
    it(`ignores ${rule.id} written inside a comment`, () => {
      expect(hits(COMMENTED, rule).map((h) => h.text), `${rule.id} matched inside a comment`).toEqual([]);
    });
  }

  for (const rule of [...RULES, LIB_ONLY_RULE].filter((r) => r.view === "code")) {
    it(`ignores ${rule.id} written inside a string literal`, () => {
      expect(hits(IN_STRINGS, rule).map((h) => h.text), `${rule.id} matched inside a string`).toEqual([]);
    });
  }

  it("[real file] MarkdownPreview.js promises in prose never to use dangerouslySetInnerHTML, and the sweep does not count the promise", () => {
    // The strongest false-positive control available: a REAL repo file whose
    // comment names the exact construct, twice, and whose code contains none.
    const src = readFileSync(path.join(ROOT, "app/components/experience/MarkdownPreview.js"), "utf8");
    expect(src).toContain("dangerouslySetInnerHTML");
    const rule = RULES.find((r) => r.id === "dangerouslySetInnerHTML");
    expect(hits(src, rule)).toEqual([]);
  });

  it("finds a real site AFTER a regex literal containing a quote, without desyncing", () => {
    // The measured shape that silently deleted a real window.open( site from a
    // shipped sweep. The regex here is `/[\\/:*?"<>|]/g`.
    const src = ['const cleaned = (p || "").replace(/[\\\\/:*?"<>|]/g, "");', "window.open(u);"].join("\n");
    expect(hits(src, RULES.find((r) => r.id === "window.open")).length).toBe(1);
  });
});
