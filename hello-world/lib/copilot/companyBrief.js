// AC-T2.1..T2.4. Pure shaping half of the live-interview "company brief" cue
// (T2 in Group T): the candidate says "pull up the company" and the panel
// shows a short research brief for the SELECTED posting. This module owns
// the two boundaries around the network call that already exists at
// app/api/company-research/route.js:
//   - companyBriefRequest: posting -> the route's request body
//   - normalizeBriefArticles: the route's response.articles -> what is safe
//     to render (trimmed, capped, every entry addressable by a stable id)
//   - briefStatusMessage: the sentence a polite `aria-live` region announces
// It deliberately does NOT fetch, does NOT own React state, and does NOT
// touch the DOM or a clock — that is app/copilot/useCompanyBrief.js (T2-2),
// a later wave. Kept pure so it is reachable from this repo's node-only
// vitest setup with no mocking, the same discipline
// lib/copilot/applicationDocsPrompt.js and lib/copilot/answerStatus.js
// already follow.

// AC-T2.2: how many article cards the panel ever renders. Matches the
// route's own WANT (app/api/company-research/route.js) for the Gemini path,
// but this constant exists independently because the embedded-engine path
// (researchCompanyLocal) and a hand-added URL card are not bound by WANT —
// this is the one place that caps what the CANDIDATE sees, regardless of
// how many the route happened to return.
export const MAX_BRIEF_ARTICLES = 3;

// AC-T2.1: cap on the posting DESCRIPTION text this module puts in the
// route's request body. Deliberately set to the SAME value as the route's
// own (private, unexported) MAX_POSTING_CHARS in
// app/api/company-research/route.js — the route slices `posting` to that
// length again before it ever reaches the prompt, so capping to a smaller
// number here would silently throw away posting text the route would
// otherwise have used, and capping to a larger number would just ship extra
// bytes over the wire for the route to discard. Because the route does not
// export its constant, this is a duplicated literal rather than a shared
// import; if the route's cap ever changes, this one should change with it.
export const MAX_BRIEF_POSTING_CHARS = 6000;

// AC-T2.1: builds the exact body app/api/company-research/route.js's POST
// expects from the posting the live session already has selected
// (`normalizePostingRows`'s shape, lib/copilot/postings.js:
// { id, title, company, description, url, appliedAt, label }). Returns null
// rather than a half-formed body when there is nothing to research: no
// posting at all, or a posting whose `company` is blank (postings.js
// documents `company` can be "" — e.g. a tracked row saved before a company
// name was filled in). A null return is the caller's (T2-2's hook) signal
// to leave the "company" cue a no-op instead of sending a request the route
// would reject with its own 400.
export function companyBriefRequest(posting) {
  if (!posting) return null;
  const company = String(posting.company || "").trim();
  if (!company) return null;
  const jobTitle = String(posting.title || "").trim();
  const description = String(posting.description || "");
  return {
    company,
    jobTitle,
    // The route's own field is named `posting` but holds description TEXT,
    // not the posting object (see route.js:270 and buildPrompt) — matching
    // that naming here, not the posting object's shape, is what keeps this
    // a drop-in body for the existing route rather than a new contract.
    posting: description.slice(0, MAX_BRIEF_POSTING_CHARS),
  };
}

// AC-T2.2: the route's articles, made safe to render. Trims every field so
// stray whitespace from a model or a scraped page never reaches the DOM
// as-is; drops an entry with no `title` or no `summary` because a card with
// neither is not information, it's a blank box the candidate would have to
// puzzle over mid-interview; caps at MAX_BRIEF_ARTICLES for the same reason
// the panel is a short brief and not a research dump; and guarantees a
// stable, non-empty `id` for every survivor so the presentation layer has a
// React key even when the route (or the embedded engine, or a hand-summarized
// URL card) omitted one or sent a duplicate.
//
// The id is derived from the entry's POSITION among the entries this call
// keeps (`brief-art-${out.length}` at push time), never from the current
// time — this module is required to stay reachable with no clock, and a
// position-based id is deterministic besides, which a clock-based one is
// not (two calls in the same instant would collide).
export function normalizeBriefArticles(articles) {
  const list = Array.isArray(articles) ? articles : [];
  const out = [];
  for (const raw of list) {
    if (out.length >= MAX_BRIEF_ARTICLES) break;
    if (!raw) continue;
    const title = String(raw.title || "").trim();
    const summary = String(raw.summary || "").trim();
    if (!title || !summary) continue;
    const id = String(raw.id || "").trim() || `brief-art-${out.length}`;
    out.push({
      id,
      title,
      source: String(raw.source || "").trim(),
      date: String(raw.date || "").trim(),
      url: String(raw.url || "").trim(),
      summary,
      suggestion: String(raw.suggestion || "").trim(),
    });
  }
  return out;
}

// AC-T2.3: the sentence a visually-hidden `role="status" aria-live="polite"`
// region (AC-T2.13) announces for each brief status. Unlike
// lib/copilot/answerStatus.js's answerStatusMessage — which returns "" for
// idle AND for error, on the reasoning that a sibling Alert already
// announces the error — this function is required to return a distinct,
// NON-EMPTY sentence for every one of idle/loading/done(>0)/done(0)/error.
// That is a deliberate difference, not a drift from the established
// pattern: T2's panel is a whole new on-screen surface a candidate can open
// mid-interview, so its own status line needs to say what state it's in on
// first read, not rely on a screen reader having already encountered a
// separate Alert.
//
// The reason distinctness matters at all: React only announces an
// `aria-live` region when its TEXT actually changes (an unchanged commit is
// invisible to assistive tech), so if two different statuses shared a
// sentence, the transition INTO the second one would render nothing new and
// go unannounced — silently, with no error to catch it. Each branch below
// therefore has to differ from every other branch's text for every input,
// not just for the specific inputs the test happens to check.
export function briefStatusMessage({ status, count, company, error } = {}) {
  const name = String(company || "").trim() || "this company";

  if (status === "loading") {
    return `Looking up ${name}.`;
  }
  if (status === "done") {
    const n = Number.isFinite(count) && count > 0 ? count : 0;
    if (n > 0) {
      return `Found ${n} article${n === 1 ? "" : "s"} about ${name}.`;
    }
    // AC-T2.3/no-fabrication guard: zero results is its own sentence, never
    // silently reused from the error branch's wording — a search that ran
    // and found nothing is a different fact from a search that failed.
    return `No recent articles were found for ${name}.`;
  }
  if (status === "error") {
    // Never invent an explanation when the caller didn't pass one: the
    // field stays absent from the sentence rather than a placeholder like
    // "an unknown error" standing in for a real one.
    const msg = String(error || "").trim();
    return msg ? `Could not look up ${name}. ${msg}` : `Could not look up ${name}.`;
  }
  // idle, and any status this module doesn't recognize yet: nothing has
  // been requested (or the panel doesn't know what happened), but AC-T2.3
  // still requires a real, non-empty, distinct sentence here rather than
  // the "" answerStatusMessage uses for its idle case.
  return "Company research has not been requested yet.";
}
