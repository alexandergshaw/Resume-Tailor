// N49/N51: THE DIGEST NAME SCREEN. See digestRoleScreen.test.js's own header
// for the full domain reasoning -- this module implements the rule it
// specifies. In short: once the company digest can carry an "## Interview
// process" section, the model will start writing lines like "  - Conducted
// by: Sarah Chen." -- a named human being, attributed to the candidate's own
// interview, on a page the candidate reads as fact. This is what stops that
// line reaching any digest surface, on stored markdown, so it also covers
// digests written before this rule existed.
//
// TWO ROUTES (plan.r2.md section 2.2). ROUTE B: a STRONG attribution label
// ("conducted by", "interviewed by", ...) followed by a colon or a dash. The
// remainder CLAIMS to be who conducts the interview, so it is withheld
// unless the allow-list admits it as a job -- this is the only route that
// catches "Interviewer: Sarah." (a lone first name is not a Title-Case pair)
// and "Conducted by: sarah chen." (lower case defeats every Title-Case run).
// ROUTE A: a strong label in ordinary prose (bare whitespace, no separator),
// or a WEAK label with a colon ("with", "who", "panel", ...). These are not
// claims about who conducts anything, so they are withheld only when the
// remainder carries a detected person span. The same span test also covers
// Stage/Question item lines directly.
//
// THE CLIENT-SAFE SPAN TEST IS A SUPERSET, NOT THE SERVER'S DETECTOR. The
// server's given-name lexicon (100,000+ entries) must never reach a client
// bundle, so this module never imports it. Instead: any sliding Title-Case
// pair (the union of an ASCII run and a Unicode run -- see below), minus
// vocabulary phrases, minus a span the employer's own name covers. It is
// allowed, and expected, to over-withhold (a Title-Case pair that happens
// not to be a name); it must never under-withhold one the server would
// catch, which is why it is built from the shape, not a curated blocklist.
//
// THE UNICODE UNION (m4). The ASCII-only run ("Sarah Chen") misses an
// accented name like "José García" -- "é" is not in `[a-z]`, so the run
// never completes a second word. A Unicode-aware run (using \p{Lu}/\p{Ll})
// catches that, but on its OWN it misses the opposite case: "eSarah Chen"
// with no space (a model's own run-on) is caught by the ASCII pattern's
// ASCII-only `\b`, which treats "é"/any non-ASCII character as a boundary
// and lets a plain-ASCII pair start right after it -- while a lookbehind
// built on the correct Unicode letter class would see that same "é" and
// (correctly, in general) refuse to start a match there. Neither run alone
// is a superset; the UNION of both is.
import { admitRoleLabel, isVocabularyPhrase, isVocabularyWord } from "@/lib/interviewPrep/interviewerRoles.js";
import { stripTerminal } from "@/lib/interviewPrep/interviewProcessGrammar.js";
import { markdownStamp } from "./renderCitedMarkdown.js";

const INVISIBLE_RE = /[​-‍⁠﻿]/g;
const SPACE_LIKE_RE = /[   　]/g;
const STRONG = "conducted\\s+by|interviewed\\s+by|led\\s+by|run\\s+by|hosted\\s+by|interviewers?|panelists?";
const WEAK = "with|who|people|panel|names?";
const MARK = "(?:\\*\\*|__|\\*|_)?";
const PREFIX = `^\\s*(?:(?:[-*+•–—]|\\d{1,3}[.)])\\s+)?${MARK}\\s*`;
const STRONG_SEP_RE = new RegExp(`${PREFIX}(?:${STRONG})(?![A-Za-z])\\s*${MARK}\\s*(?::|[\\-‐-―])\\s*${MARK}\\s*(.*)$`, "i");
const STRONG_BARE_RE = new RegExp(`${PREFIX}(?:${STRONG})(?![A-Za-z])\\s*${MARK}\\s+(.*)$`, "i");
const WEAK_COLON_RE = new RegExp(`${PREFIX}(?:${WEAK})(?![A-Za-z])\\s*${MARK}\\s*:\\s*${MARK}\\s*(.*)$`, "i");
const ITEM_RE = new RegExp(`${PREFIX}(stage|question)(?![A-Za-z])\\s*${MARK}\\s*(?::|[\\-‐-―])\\s*${MARK}\\s*(.*)$`, "i");

// The ASCII run: JS's `\b` is ASCII-word-only, so any non-ASCII character
// (an accent, an em dash) already reads as a boundary -- which is what
// makes it catch a name glued directly onto one ("eSarah Chen").
const ASCII_PAIR_RE = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g;
// The Unicode run: `\p{Lu}`/`\p{Ll}` cover an accented character as part of
// the SAME word ("José", "Weiß", "Zoë"), which the ASCII run cannot. The
// lookbehind/lookahead refuse to start or extend a match beside another
// letter, which is the correct, stricter reading the ASCII run lacks.
const UNICODE_PAIR_RE = /(?<![\p{L}])\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+)+(?!\p{L})/gu;

function clean(line) {
  return typeof line === "string" ? line.replace(INVISIBLE_RE, "").replace(SPACE_LIKE_RE, " ") : null;
}
function stripMarkup(s) {
  return s.replace(/^(?:\*\*|__|\*|_)+|(?:\*\*|__|\*|_)+$/g, "").trim();
}

/** The label's strength/separator shape, and the text after it -- the one
 *  parser both routes are built on. `strong && separated` is route B;
 *  anything else that matched is route A. */
export function attributionMatch(line) {
  const s = clean(line);
  if (s === null) return null;
  let m = STRONG_SEP_RE.exec(s);
  if (m) return { strong: true, separated: true, remainder: m[1] };
  m = WEAK_COLON_RE.exec(s);
  if (m) return { strong: false, separated: true, remainder: m[1] };
  m = STRONG_BARE_RE.exec(s);
  if (m) return { strong: true, separated: false, remainder: m[1] };
  return null;
}

/** A "- Stage: ..."/"- Question: ..." line's own item text, through its
 *  markup and either separator. */
export function itemMatch(line) {
  const s = clean(line);
  if (s === null) return null;
  const m = ITEM_RE.exec(s);
  return m ? { kind: m[1].toLowerCase(), item: m[2] } : null;
}

/** Every Title-Case pair in `text`, ASCII run union Unicode run, each pair
 *  split into its adjacent two-word windows (so a three-word run yields both
 *  overlapping pairs, matching how `employerCoverage` below walks them). */
function titleCasePairs(text) {
  const out = [];
  if (typeof text !== "string" || !text) return out;
  for (const re of [ASCII_PAIR_RE, UNICODE_PAIR_RE]) {
    re.lastIndex = 0;
    let run = re.exec(text);
    while (run) {
      const w = run[0].split(/\s+/);
      for (let i = 0; i < w.length - 1; i += 1) out.push(`${w[i]} ${w[i + 1]}`);
      run = re.exec(text);
    }
  }
  return out;
}

// ---- employer exemption: a span the employer's own name covers is not a
// person, over the same detector the caller supplies (design.r3.md section
// 11.3's contract, inlined here since this is the only importer).
const LEGAL_FORM_SUFFIXES = [
  ["inc"], ["incorporated"], ["corp"], ["corporation"], ["co"], ["company"], ["companies"], ["llp"], ["plc"],
  ["ltd"], ["limited"], ["gmbh"], ["ag"], ["sa"], ["nv"], ["bv"], ["international"], ["&", "co"], ["&", "company"],
  ["and", "company"], ["and", "co"],
];
const SECOND_PARTY_RE = /\s[-‐-―|:/@]\s|[()[\]]|\bc\/o\b|\s(?:at|for|via|by|with|attn)\s/i;

function foldToken(t) {
  return String(t)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^[^a-z0-9&]+|[^a-z0-9&]+$/g, "")
    .replace(/(?:'s|’s)$/, "")
    .replace(/[^a-z0-9&]+$/g, "");
}
function wordTokens(text) {
  return String(text).normalize("NFC").split(/[\s\-‐-―]+/).map(foldToken).filter(Boolean);
}
function titleCaseWords(s) {
  return s.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}
function employerForms(employer, detectSpans) {
  if (typeof employer !== "string" || !employer.trim()) return [];
  const e = employer.normalize("NFC");
  if (SECOND_PARTY_RE.test(e)) return [];
  const spans = detectSpans(titleCaseWords(e)).map((s) => s.split(" "));
  for (let i = 0; i < spans.length; i += 1) {
    for (let j = i + 1; j < spans.length; j += 1) {
      if (!spans[i].some((w) => spans[j].includes(w))) return [];
    }
  }
  const tokens = wordTokens(e);
  if (tokens.length === 0) return [];
  const bases = [tokens];
  if (tokens[0] === "the" && tokens.length > 1) bases.push(tokens.slice(1));
  const forms = [...bases];
  for (const base of bases) {
    for (const suffix of LEGAL_FORM_SUFFIXES) {
      const n = suffix.length;
      if (base.length > n && suffix.every((t, k) => base[base.length - n + k] === t)) forms.push(base.slice(0, base.length - n));
    }
  }
  return forms;
}

/** A predicate: does the employer's own name cover this exact span? */
function employerCoverage(text, employer, detectSpans) {
  if (typeof text !== "string") return () => false;
  const forms = employerForms(employer, detectSpans);
  if (forms.length === 0) return () => false;
  const toks = wordTokens(text);
  const intervals = [];
  for (const f of forms) {
    for (let i = 0; i + f.length <= toks.length; i += 1) {
      if (f.every((t, k) => toks[i + k] === t)) intervals.push([i, i + f.length]);
    }
  }
  if (intervals.length === 0) return () => false;
  return (span) => {
    const [w1, w2] = String(span).split(/\s+/).map(foldToken);
    const positions = [];
    for (let j = 0; j + 1 < toks.length; j += 1) if (toks[j] === w1 && toks[j + 1] === w2) positions.push(j);
    if (positions.length === 0) return false;
    return positions.every(
      (j) => intervals.some(([s, e]) => (j >= s && j + 1 < e) || (j === e - 1 && isVocabularyWord(w2))),
    );
  };
}

/** Person-shaped spans in `text`: Title-Case pairs, minus vocabulary
 *  phrases, minus a span the employer's own name covers. */
function personShapedSpans(text, context = {}) {
  if (typeof text !== "string") return [];
  const spans = titleCasePairs(text).filter((s) => !isVocabularyPhrase(s));
  if (spans.length === 0) return spans;
  const covered = employerCoverage(text, context?.employer ?? null, titleCasePairs);
  return spans.filter((s) => !covered(s));
}

/** The digest name screen's one decision. Fails CLOSED: with no context, no
 *  exemption applies, so this only ever withholds AT LEAST as much as a call
 *  with one. */
export function isWithheldDigestLine(line, context = {}) {
  const a = attributionMatch(line);
  if (a) {
    if (a.strong && a.separated) {
      const rest = stripMarkup(a.remainder);
      return admitRoleLabel(stripTerminal(rest.replace(/(?:\*\*|__|\*|_)+$/g, ""))) === null;
    }
    return personShapedSpans(a.remainder, context).length > 0;
  }
  const it = itemMatch(line);
  if (it) return personShapedSpans(it.item, context).length > 0;
  return false;
}

// A stable token identifying this screen's own logic, so a stored verdict
// set can be told apart from a different rule's. T4b owns the exact recipe
// this is hashed over; here it is treated as an opaque, stable literal, the
// same way every caller (client included) treats it.
function fnv16(seed) {
  let h1 = 0x811c9dc5;
  let h2 = 0xc59d1c81;
  for (let i = 0; i < seed.length; i += 1) {
    const code = seed.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code + i;
    h2 = Math.imul(h2, 0x01000193);
  }
  const hex = (n) => (n >>> 0).toString(16).padStart(8, "0");
  return `${hex(h1)}${hex(h2)}`.slice(0, 16);
}

/** The digest screen's own rule id, `dsr-` plus 16 hex characters. Opaque to
 *  every caller -- it is compared for equality against a stored value, never
 *  parsed -- so a version bump is a one-line change to the seed below. */
export const DIGEST_SCREEN_RULE_ID = `dsr-${fnv16("digestRoleScreen.v1")}`;

function withheldIndexes(lines, context) {
  const out = [];
  lines.forEach((line, i) => {
    if (isWithheldDigestLine(line, context)) out.push(i);
  });
  return out;
}

function lineRanges(text) {
  const lines = text.split("\n");
  let off = 0;
  return lines.map((t) => {
    const r = { start: off, end: off + t.length };
    off += t.length + 1;
    return r;
  });
}

function validStoredSet(withheldLines, lineCount) {
  if (!Array.isArray(withheldLines)) return null;
  const seen = new Set();
  for (const i of withheldLines) {
    if (!Number.isInteger(i) || i < 0 || i >= lineCount || seen.has(i)) return null;
    seen.add(i);
  }
  return [...seen];
}

/**
 * The one render-time splice for withheld lines, mirroring
 * renderCitedMarkdown.js's own discipline: refuse to trust a stale or
 * mismatched record, and re-derive from scratch rather than guess.
 *
 * `outcome` carries a `markdownStamp(markdown)` pair (`len`/`hash`) plus
 * `withheldLines`/`withheldLinesRule` when a verdict set was stored at write
 * time. It is trusted only when the rule id matches THIS module's own id and
 * the stamp matches `markdown` exactly; anything else re-screens.
 *
 * @param {{markdown: unknown, presentation?: unknown, accepted?: unknown[], outcome?: unknown, context?: object}} args
 * @returns {{presentation: string, accepted: object[], withheld: number, basis: "none"|"stored"|"fallback"}}
 */
export function withholdDigestLines({ markdown, presentation, accepted, outcome, context = {} } = {}) {
  const stored = typeof markdown === "string" ? markdown : "";
  const pres = typeof presentation === "string" ? presentation : stored;
  const acc = Array.isArray(accepted) ? accepted : [];
  const storedLines = stored.split("\n");

  let withheld = null;
  let basis = "fallback";
  if (outcome && typeof outcome === "object") {
    const ruleMatches = outcome.withheldLinesRule === DIGEST_SCREEN_RULE_ID;
    const stamp = markdownStamp(stored);
    const stampMatches = outcome.len === stamp.len && outcome.hash === stamp.hash;
    if (ruleMatches && stampMatches) {
      const valid = validStoredSet(outcome.withheldLines, storedLines.length);
      if (valid !== null) {
        withheld = valid;
        basis = "stored";
      }
    }
  }
  if (withheld === null) {
    withheld = withheldIndexes(storedLines, context);
    basis = "fallback";
  }

  if (withheld.length === 0) {
    return { presentation: pres, accepted: acc, withheld: 0, basis: "none" };
  }

  const presLines = pres.split("\n");
  const drop = new Set(withheld);
  if (presLines.length !== storedLines.length) {
    // The splice invariant is index-based; a presentation whose line count
    // has drifted from the stored markdown cannot be indexed safely, so
    // every attribution-shaped line is re-screened directly and every
    // accepted citation is dropped rather than spliced against an offset
    // that may no longer mean anything.
    const kept = presLines.filter((l) => !isWithheldDigestLine(l, context));
    return { presentation: kept.join("\n"), accepted: [], withheld: presLines.length - kept.length, basis: "fallback" };
  }

  const ranges = lineRanges(stored);
  return {
    presentation: presLines.filter((_, i) => !drop.has(i)).join("\n"),
    accepted: acc.filter((a) => !withheld.some((i) => Number.isInteger(a?.end) && a.end >= ranges[i].start && a.end <= ranges[i].end)),
    withheld: withheld.length,
    basis,
  };
}
