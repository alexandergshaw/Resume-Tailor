// Turns the caller's own "Professional Experience" project pages into a
// context block for the GEMINI tailoring prompt (see
// lib/experience/tailorContext.test.js for the full contract this file must
// satisfy; its comments explain WHY each rule exists, not just what). Pure:
// no fetch, no Supabase — the caller (app/api/tailor/route.js) fetches the
// pages server-side, scoped to the signed-in user, and hands the raw rows
// in here.
//
// Deliberately NOT lib/experience/tailorSources.js's fragmentsFromPages.
// That module mines sentence-shaped list items for the deterministic
// engine's slot substitution and discards prose in the process — a page's
// "## Overview" paragraph never survives it, only its list items do. Gemini
// is at its best with exactly that narrative, so this module sends each
// page's title plus its whole raw body, unparsed. The only piece reused
// from that module is isGeneratedPage, so the exclusion rule for a
// model-authored page (any generated_kind set) stays defined in exactly one
// place — the single thing stopping a model's own claims from reaching a
// document the user sends to employers under their name is not worth a
// second, hand-synced copy.
//
// The budget is the other half of this file's job. app/api/tailor/route.js
// caps five separate inputs with bare .slice() calls that report nothing —
// there is no token counting anywhere on that path, so blowing Gemini's
// limit surfaces as a generic 500. This module must not become a sixth
// silent slice: it stays within MAX_TAILOR_CONTEXT_CHARS, and whenever a
// page had to be left out it says so both inside the returned content (what
// the MODEL sees) and via the returned `truncated`/`includedCount` flags
// (what the route's response warning needs).
//
// Whole pages only — never a page cut mid-sentence. A page trimmed midway
// through reads to the model as a claim that stops partway through; a whole
// project dropped and announced as dropped is more honest than half a
// project presented as complete. So pages are included greedily, in the
// order given, and a page that would overflow the budget is skipped
// entirely rather than truncated.

import { isGeneratedPage } from "./tailorSources.js";

export const MAX_TAILOR_CONTEXT_CHARS = 20000;

// Reserved out of the budget for the "N pages not included" notice, which is
// assembled last (after we already know how many pages were dropped) — sized
// generously above the worst realistic notice string so the notice itself is
// never what has to be cut.
const NOTICE_RESERVE_CHARS = 300;

// Joins two whole-page entries inside the block. Exported so a test that
// needs the literal (e.g. lib/experience/untrustedText.test.js's forgery
// list) imports the constant instead of hardcoding "---" a second time —
// a hardcoded copy would keep passing even if this separator's shape ever
// changed, silently going stale exactly like the anti-pattern flagged for
// meetingContext.js.
export const SEPARATOR = "\n\n---\n\n";

function str(value) {
  return typeof value === "string" ? value : "";
}

// Server-side-enforced exclusion: a generated page (any generated_kind set)
// or an archived one (any non-null archived_at) never becomes prompt
// context, no matter what the caller passes in. This function is the only
// place that decides eligibility — app/api/tailor/route.js must not
// pre-filter the rows it fetches and rely on that instead.
function isEligible(page) {
  if (!page || typeof page !== "object") return false;
  if (isGeneratedPage(page)) return false;
  if (page.archived_at !== null && page.archived_at !== undefined) return false;
  return true;
}

// One page's whole-page text: its title as a label line, then its whole raw
// body (unparsed — see this file's header comment). A page with neither a
// usable title nor a usable body contributes nothing and is dropped before
// the budget loop ever sees it, so it can never produce a placeholder like
// "Project: Untitled project" with nothing under it.
function formatPage(page) {
  const title = str(page.title).trim();
  const body = str(page.body).trim();
  const heading = `Project: ${title || "Untitled project"}`;
  return body ? `${heading}\n${body}` : heading;
}

function pluralize(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

// buildTailorContextBlock(pages) -> { block, truncated, includedCount }.
//
// `block` is "" whenever there is nothing eligible to say — never a header
// with nothing under it — so a caller with no eligible pages can splice this
// in and get a byte-identical prompt to one that never called this function.
//
// `truncated` is true the moment any eligible page had to be left out to
// stay within budget; `includedCount` is how many pages actually made it in.
// Never throws: junk input (null/undefined/malformed rows) is simply
// skipped rather than crashing the caller.
export function buildTailorContextBlock(pagesInput) {
  const pages = Array.isArray(pagesInput) ? pagesInput : [];

  const pieces = pages
    .filter(isEligible)
    .map((page) => ({ title: str(page.title).trim(), body: str(page.body).trim(), text: formatPage(page) }))
    .filter((p) => p.title || p.body);

  if (pieces.length === 0) {
    return { block: "", truncated: false, includedCount: 0 };
  }

  const budgetForPages = Math.max(0, MAX_TAILOR_CONTEXT_CHARS - NOTICE_RESERVE_CHARS);

  const included = [];
  let used = 0;
  let droppedCount = 0;

  for (const piece of pieces) {
    const addLen = piece.text.length + (included.length > 0 ? SEPARATOR.length : 0);
    if (used + addLen > budgetForPages) {
      droppedCount += 1;
      continue;
    }
    included.push(piece.text);
    used += addLen;
  }

  const truncated = droppedCount > 0;
  const noticeBlock = truncated
    ? `[Note: ${pluralize(droppedCount, "project page")} not included to fit the AI context budget.]`
    : "";

  let block = [included.join(SEPARATOR), noticeBlock].filter(Boolean).join("\n\n");

  // Defensive final clamp: the budgeting above is designed to always hold,
  // but if some future change ever overshoots it anyway, the hard contract
  // (block never exceeds MAX_TAILOR_CONTEXT_CHARS) must still hold rather
  // than silently breaking it. The included pages are always the earlier
  // part of `block` and the notice always the tail, so a cut here can only
  // ever remove notice text, never a page already promised to be whole.
  if (block.length > MAX_TAILOR_CONTEXT_CHARS) {
    block = block.slice(0, MAX_TAILOR_CONTEXT_CHARS);
  }

  return { block, truncated, includedCount: included.length };
}
