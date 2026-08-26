// AC-V4.1/V4.3/V4.4/V4.7. The pure half of "verified company facts": the
// prompt asked of the model, defensive parsing of what it sends back, the
// shape a raw fact is normalized into, and the block that shape renders as
// inside buildPointsPrompt. Zero network, zero Supabase, zero Gemini client
// — a straight function of its arguments, same discipline as
// lib/copilot/companyBrief.js and lib/copilot/pageCitations.js.
//
// What actually RUNS the model call and does the corroboration (reusing
// lib/llm/grounding.js and lib/meeting/referenceContract.js rather than
// re-implementing either) is the server-only sibling,
// lib/copilot/companyFactsSource.js's buildCompanyFacts. This module has no
// opinion on whether a claim is TRUE — only on what shape a claim has to be
// in before it is even a candidate for corroboration.
//
// THE FAILURE THIS EXISTS TO PREVENT, restated because it is the whole point
// of the group this belongs to: in the session the user recorded on
// 2026-08-25, asked "What do you know about Purple Wave?", the copilot said
// "My research indicates a strong focus on continuous improvement" about a
// company it never researched. This module is the shape of what an actual,
// checkable claim looks like — one sentence, one source URL, one category —
// so there is something concrete for the corroboration step to check a
// claim AGAINST, instead of a paragraph of paraphrased job-description
// vocabulary with nothing to verify.

// AC-V4.1: a "small set" of claims, not a research dump — the same
// reasoning lib/copilot/companyBrief.js's MAX_BRIEF_ARTICLES states for its
// own cap: a candidate glancing at this mid-question can act on a handful of
// facts, not a list.
export const MAX_COMPANY_FACTS = 5;

// AC-V4.1's four categories, restated as the wire vocabulary a raw fact's
// `kind` field is checked against. Ordering is not semantic — it is only
// ever used as a whitelist membership test, never sorted on — so it is a Set
// rather than an array of priorities.
const VALID_FACT_KINDS = new Set(["what", "market", "size", "recent"]);

// The system instruction for the one company-facts model call
// (companyFactsSource.js's buildCompanyFacts). Kept short and declarative,
// mirroring POINTS_SYSTEM/ANSWER_SYSTEM in answerPrompts.js: a single joined
// string, not an array, because it is passed straight to
// `config.systemInstruction`.
export const COMPANY_FACTS_SYSTEM = [
  "You are a research assistant helping a job candidate learn about an employer before a live interview.",
  "Using Google Search, find a small set of ATOMIC, CHECKABLE claims about the company — statements a real page actually makes, never an inference, an estimate, or a claim built by combining two sources that neither states on its own.",
  "Every claim must be traceable to exactly one page you actually visited, and you must return that page's URL with it.",
].join(" ");

// AC-V4.1: builds the one prompt buildCompanyFacts sends, or `null` when
// there is no company to research at all — the same "nothing to research, do
// not send a request" contract lib/copilot/companyBrief.js's
// companyBriefRequest already uses, and the caller's signal to skip the
// model call entirely rather than ask a search engine about an empty string.
export function buildCompanyFactsPrompt(input) {
  const opts = input && typeof input === "object" ? input : {};
  const company = typeof opts.company === "string" ? opts.company.trim() : "";
  if (!company) return null;
  const jobTitle = typeof opts.jobTitle === "string" ? opts.jobTitle.trim() : "";

  return [
    `Research the company "${company}" for a candidate about to interview there.`,
    jobTitle
      ? `They are interviewing for the "${jobTitle}" role, so prefer facts relevant to that role when there is a choice.`
      : "",
    "Find up to " + MAX_COMPANY_FACTS + " claims, covering — where a real page actually supports it — what the company does, its industry or market, its size or footprint, and any recent development (funding, a launch, an acquisition, layoffs, leadership change).",
    "For each claim return:",
    '- claim: ONE atomic, checkable sentence. Never combine two sources into a claim neither states on its own.',
    "- url: the exact page the claim came from.",
    '- kind: one of "what", "market", "size", "recent".',
    "",
    `Output ONLY a JSON object: {"facts": [ {"claim": "", "url": "", "kind": ""} ]} with at most ${MAX_COMPANY_FACTS} items. No commentary outside the JSON.`,
  ]
    .filter(Boolean)
    .join("\n");
}

// AC-V4.1: pulls the model's `facts` array out of its response text.
// Modelled on app/api/company-research/route.js's parseArticles, and for the
// identical documented reason: Gemini's googleSearch tool is incompatible
// with `responseMimeType: "application/json"`, so the real response is
// prose wrapped around a fenced JSON block, not a bare JSON document. This
// is a private re-derivation rather than an import of parseArticles because
// importing from an `app/api/…` route into `lib/` would be a wrong-way
// dependency (lib/ is imported BY routes, never the reverse), and
// `parseModelJson` (lib/llm/extractEmployment.js) is written for the
// JSON-mime path this call deliberately does not use.
//
// Returns a raw, UNVALIDATED array — normalizeCompanyFacts below is what
// turns it into something trustworthy. Never throws; anything that is not
// parseable JSON with a `facts` array degrades to `[]`.
export function parseFactsResponse(rawText) {
  const text = String(rawText || "");
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (!objMatch) return [];
  try {
    const parsed = JSON.parse(objMatch[0]);
    return Array.isArray(parsed?.facts) ? parsed.facts : [];
  } catch {
    return [];
  }
}

// AC-V4.1/V4.7: turns the model's raw, unvalidated `facts` array into the
// Fact[] shape the rest of this feature trusts — `{ id, claim, url, kind }`.
// Every field is trimmed; an entry missing a non-empty `claim` or `url` is
// dropped outright rather than shipped as a blank (a fact with no source is
// not a smaller fact, it is nothing to corroborate against). `kind` is
// checked against the closed vocabulary and normalized to "what" when it is
// missing or unrecognised — the record notes `kind` is a hint for ordering,
// never itself a claim, so an odd value from the model is not a reason to
// drop an otherwise-good fact.
//
// The id is assigned by POSITION in this function's OWN output (mirroring
// lib/copilot/companyBrief.js's normalizeBriefArticles, which does the same
// for its `brief-art-${out.length}` ids) — deterministic, and stable for
// exactly as long as this array is: buildCompanyFacts calls this ONCE, and
// the ids assigned here survive unchanged through its later corroboration
// filter, so a surviving fact's id is always the one this function gave it,
// never renumbered after a sibling gets dropped.
export function normalizeCompanyFacts(raw, options) {
  const opts = options && typeof options === "object" ? options : {};
  const cap = typeof opts.cap === "number" && opts.cap > 0 ? opts.cap : MAX_COMPANY_FACTS;
  const list = Array.isArray(raw) ? raw : [];

  const out = [];
  for (const entry of list) {
    if (out.length >= cap) break;
    if (!entry || typeof entry !== "object") continue;
    const claim = typeof entry.claim === "string" ? entry.claim.trim() : "";
    const url = typeof entry.url === "string" ? entry.url.trim() : "";
    if (!claim || !url) continue;
    const rawKind = typeof entry.kind === "string" ? entry.kind.trim().toLowerCase() : "";
    const kind = VALID_FACT_KINDS.has(rawKind) ? rawKind : "what";
    out.push({ id: `fact-${out.length}`, claim, url, kind });
  }
  return out;
}

// AC-V4.3: the text buildPointsPrompt injects under its own "VERIFIED
// COMPANY FACTS" heading — one line per surviving fact, `(fact id: <id>)
// <claim>`, joined by newline. Deliberately does NOT include the URL: the
// route already holds the real value and hands it to the candidate through
// resolveFactSources' whitelist, so putting it in the prompt would only
// create a second copy for the model to paraphrase (or invent its own),
// exactly the rule lib/copilot/pageCitations.js already states for page
// titles. Deliberately does NOT include the heading itself — that line, and
// the authority sentence around it, are buildPointsPrompt's own, because the
// heading's presence is what the empty-block / no-employer states in
// answerPrompts.js need to gate independently of this function.
//
// Returns "" for an empty or non-array `facts` — the caller's signal that
// there is nothing to show, never an empty heading with nothing under it
// (V4.7: an empty section invites the model to fill it in on its own).
export function companyFactsBlock(facts) {
  const list = Array.isArray(facts) ? facts : [];
  if (list.length === 0) return "";
  return list.map((fact) => `(fact id: ${fact.id}) ${fact.claim}`).join("\n");
}
