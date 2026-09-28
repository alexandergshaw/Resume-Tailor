"use client";

import { useRef, useState } from "react";
import { weaveSources } from "../../lib/document/coverLetterWeave";
import { readEngine } from "../settings/engine";
import { planAcceptForEntry, mergeAcceptedFacts, planRemoveFact } from "../../lib/acceptedFacts/factInsertion";
import { applyCoverDocxEdits } from "../../lib/acceptedFacts/factDocx";
import { messageForRefusal } from "../../lib/acceptedFacts/factRefusalMessage";
import { editedForScope } from "../../lib/document/previewBlob";
import { hashString } from "../../lib/text/phrasing";
import { safeExternalHref } from "../../lib/url/safeExternalHref";
import { servesGroundingRedirect } from "../../lib/tracking/citationHref";

// PB1 (plan.check.r2): shown when the accept is refused because the
// engine's own copy of the cover letter is missing -- a restored chip or a
// cover version switch leaves `coverLetterDocxB64` empty while `edited`
// stays false, so a silent rebuild would ship the fact inside the
// candidate's GENERIC uploaded template instead of their tailored letter.
// Named vocabulary only -- no internals (no "docxB64", no code, no null).
const NO_ENGINE_BYTES_REASON =
  "We can't add this to your cover letter right now because its saved file is missing. " +
  "Regenerate the cover letter in this session, then try again.";
// PM2/§2.3's disclosed-limit notice: shown when the fact is added to an
// ALREADY hand-edited letter's text, where the splice is skipped on purpose
// (the candidate's own edits are never overwritten) -- so the bytes and the
// text diverge and the download rebuilds onto the hand-edited version.
const HAND_EDITED_NOTICE =
  "Your own edits are kept. The fact was added to the letter's text; the downloaded file is rebuilt from your edits.";
// B4 (verify.r1.md): the spliced bytes live in session memory only -- there
// is no mechanism yet that persists them, so a reload before downloading
// loses the styled copy and the next download rebuilds the letter (with the
// fact's TEXT intact) onto whatever generic template is on hand. Disclosed
// here, at accept time, rather than discovered later at download time.
const SESSION_ONLY_NOTICE =
  "The fact was added to your cover letter. Download it now — this session's styled copy isn't saved, " +
  "so after a reload the download is rebuilt from your uploaded template.";

// Per-job company research: warmed in the background when a preview opens, shown
// behind the preview's "Research company" button, and (on apply) woven into the
// cover letter. Ephemeral / session-only.
//
// Depends on the parent's tailoring map (to read/weave the cover letter) and the
// preview reload key (to refresh the open preview after weaving).

// Sets one scope of the tailoring entry's per-scope edited flag ({ resume,
// cover }) without disturbing the other, mirroring the same helper in
// useDocumentPreview.js (AC-2/AC-7: an entry may carry no `edited` field yet,
// or a legacy plain boolean from before this migration — normalize either
// into the per-scope shape before overwriting the target scope).
function withEditedScope(entry, scope, value) {
  const e = entry?.edited;
  const base = e && typeof e === "object" ? e : { resume: !!e, cover: !!e };
  return { ...base, [scope]: value };
}

// Tracking-only query parameters this app strips when deriving an article's
// dedupe/identity key -- campaign noise that varies per link to the SAME
// story, never content that changes which story the link points at.
const TRACKING_PARAM_NAMES = new Set(["gclid", "fbclid", "mc_cid", "mc_eid"]);

// N35/V1/V3/V3(b): the key two arrived articles are the SAME article by. Null
// for a url `safeExternalHref` refuses (there is no stable string to key on
// -- F4's hardening case, an id-less/url-less article, included) and for a
// grounding-redirect url: `servesGroundingRedirect` (lib/tracking/citationHref.js)
// already knows `vertexaisearch.cloud.google.com/grounding-api-redirect/<token>`
// is minted PER REQUEST, so the string looks stable but is not, and keying on
// it would silently promise a durability the token cannot honour. Everything
// else is normalised only in the four ways the owner ruling names -- host
// case, fragment, tracking parameters, trailing slash -- because normalising
// anything else (path, non-tracking query content) would merge genuinely
// different articles and re-create the same collision with a different
// cause. Scheme (`http:`/`https:`) and the `www.` prefix are deliberately
// left exactly as given: two sites can legitimately differ by scheme, and
// this app takes no position on the prefix either way.
function articleUrlKey(rawUrl) {
  const href = safeExternalHref(rawUrl);
  if (href === null) return null;
  let parsed;
  try {
    parsed = new URL(href);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (servesGroundingRedirect(host, href)) return null;

  parsed.hostname = host;
  parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()]) {
    if (key.startsWith("utm_") || TRACKING_PARAM_NAMES.has(key)) parsed.searchParams.delete(key);
  }
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  return parsed.href;
}

// N35/V1: dedupe articles by url ON ARRIVAL, before minting (owner ruling,
// 2026-09-23). route.js:164 rewrites every article's url to
// `scraped.finalUrl || candidate`, so a syndicated copy and its canonical --
// or two grounding redirects for one story -- can arrive at the same url;
// left alone, they would mint the SAME id below and collapse into one
// coupled card downstream. An article whose key is null is never treated as
// a duplicate of another null-keyed article: absence of a usable url is not
// evidence of sameness (route.js:170 really returns `url: ""` for an article
// the grounding metadata never matched), and deduping on that would drop
// real research results.
function dedupeArrivedArticles(articles) {
  const list = Array.isArray(articles) ? articles : [];
  const seenKeys = new Set();
  const out = [];
  for (const a of list) {
    const key = articleUrlKey(a?.url);
    if (key !== null) {
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
    }
    out.push(a);
  }
  return out;
}

// N35/F1+F4: mint a provenance id ON ARRIVAL, at the one seam every research
// article passes through regardless of producer (the Gemini route and the
// embedded engine both mint `art-${i}` BY POSITION -- route.js:76,
// companyResearchLocal.js:78 -- so a run's first card is always `art-0`,
// whatever article it actually is). Two different accepted facts must never
// share an id, so this overrides whatever the producer sent, deriving the id
// from `articleUrlKey` above: stable for the SAME article across sessions (a
// re-run finds the same article at the same url, and it should read back as
// the same fact), yet distinct between different articles because different
// articles carry different urls. An article whose key is null -- an unusable
// or missing url, or a grounding-redirect url with no stable identity of its
// own -- falls back to a per-run component instead: non-durable, per the
// owner ruling, but still distinct and never null.
function mintArticleId(article, runStamp, index) {
  const key = articleUrlKey(article?.url);
  if (key !== null) return `art-${hashString(key).toString(36)}`;
  return `art-run${runStamp}-${index}`;
}

function withMintedIds(articles, runStamp) {
  return (Array.isArray(articles) ? articles : []).map((a, i) => ({ ...a, id: mintArticleId(a, runStamp, i) }));
}

export function useCompanyResearch({ tailoringMap, setTailoringMap, setPreviewReloadKey }) {
  const [companyResearch, setCompanyResearch] = useState({
    open: false,
    jobId: null,
    company: "",
    jobTitle: "",
    posting: "",
    busy: false,
    acceptError: "",
    acceptNotice: "",
  });
  const [researchByJob, setResearchByJob] = useState({});
  const [companyResearchByJob, setCompanyResearchByJob] = useState({});
  const [acceptedFactsByJob, setAcceptedFactsByJob] = useState({});
  const researchStartedRef = useRef(new Set());

  async function fetchResearchInto({ jobId, company, jobTitle, posting }) {
    if (!jobId || !company) return;
    researchStartedRef.current.add(jobId);
    setResearchByJob((m) => ({
      ...m,
      [jobId]: { loading: true, articles: [], warnings: [], error: "", needsCompany: false },
    }));
    try {
      const res = await fetch("/api/company-research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, jobTitle: jobTitle || "", posting: posting || "", engine: readEngine() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 503) {
        setResearchByJob((m) => ({
          ...m,
          [jobId]: {
            loading: false, articles: [], warnings: [], needsCompany: false,
            error: data?.error || "Company research is unavailable (Gemini key not configured).",
          },
        }));
        return;
      }
      if (!res.ok) throw new Error(data?.error || "Company research failed.");
      setResearchByJob((m) => ({
        ...m,
        [jobId]: {
          loading: false, needsCompany: false, error: "",
          articles: withMintedIds(dedupeArrivedArticles(data.articles), Date.now()),
          warnings: Array.isArray(data.warnings) ? data.warnings : [],
        },
      }));
    } catch (err) {
      setResearchByJob((m) => ({
        ...m,
        [jobId]: { loading: false, articles: [], warnings: [], needsCompany: false, error: err.message || "Company research failed." },
      }));
    }
  }

  // Warm research for a job once (deduped). With no company yet, mark needsCompany
  // so the dialog prompts for one instead of spinning forever.
  function startBackgroundResearch({ jobId, company, jobTitle, posting }) {
    if (!jobId || researchStartedRef.current.has(jobId)) return;
    const co = String(company || "").trim();
    if (!co) {
      researchStartedRef.current.add(jobId);
      setResearchByJob((m) =>
        m[jobId] ? m : { ...m, [jobId]: { loading: false, articles: [], warnings: [], error: "", needsCompany: true } },
      );
      return;
    }
    fetchResearchInto({ jobId, company: co, jobTitle, posting });
  }

  // Fetch + summarize a user-pasted article URL into a source card, appended to
  // the job's research results.
  async function addResearchUrl(url) {
    const jobId = companyResearch.jobId;
    if (!jobId) return;
    try {
      const res = await fetch("/api/company-research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, company: companyResearch.company, jobTitle: companyResearch.jobTitle, engine: readEngine() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResearchByJob((m) => ({ ...m, [jobId]: { ...(m[jobId] || {}), error: data?.error || "Couldn't add that URL." } }));
        return;
      }
      const added = (data.articles || []).map((a, i) => ({ ...a, id: `url-${Date.now()}-${i}` }));
      setResearchByJob((m) => {
        const cur = m[jobId] || { articles: [], warnings: [] };
        return {
          ...m,
          [jobId]: {
            ...cur,
            loading: false,
            needsCompany: false,
            error: "",
            articles: [...(cur.articles || []), ...added],
            warnings: [...(cur.warnings || []), ...(data.warnings || [])],
          },
        };
      });
    } catch (err) {
      setResearchByJob((m) => ({ ...m, [jobId]: { ...(m[jobId] || {}), error: err.message || "Couldn't add that URL." } }));
    }
  }

  // B5 (verify.r1.md): read back the current facts/removed/revision so
  // `acceptFacts` below has a real `baseRevision` instead of always sending
  // `null` -- the sole reason "Reload and try again" used to do nothing: a
  // null base is read by the RPC as "no row exists yet", which loses the
  // race against a row that already does. Best-effort: a failed fetch just
  // leaves the state as it was, and the first accept in a truly-new session
  // still works with baseRevision null (there really is no row yet).
  async function fetchAcceptedFactsInto(jobId) {
    if (!jobId) return;
    try {
      const res = await fetch(`/api/accepted-facts?jobRef=${encodeURIComponent(jobId)}`);
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      if (!data) return;
      setAcceptedFactsByJob((m) => ({
        ...m,
        [jobId]: { facts: data.facts || [], removed: data.removed || [], revision: data.revision ?? null },
      }));
    } catch {
      /* best-effort seed -- an accept still works with baseRevision null */
    }
  }

  // Open the research dialog over the preview, ensuring the job's research has
  // been kicked off (it usually already was, when the preview opened).
  function openCompanyResearch(job) {
    if (!job) return;
    const t = tailoringMap[job.id] || {};
    const company = (job.company || "").trim();
    const jobTitle = t.generatedJobTitle || job.title || "";
    const posting = job.description || t.jobDescription || "";
    setCompanyResearch({ open: true, jobId: job.id, company, jobTitle, posting, busy: false, acceptError: "", acceptNotice: "" });
    startBackgroundResearch({ jobId: job.id, company, jobTitle, posting });
    fetchAcceptedFactsInto(job.id);
  }

  // The user typed a company in the dialog's input (when none was known).
  function researchTypedCompany(name) {
    const company = String(name || "").trim();
    if (!company || !companyResearch.jobId) return;
    setCompanyResearch((prev) => ({ ...prev, company }));
    fetchResearchInto({ jobId: companyResearch.jobId, company, jobTitle: companyResearch.jobTitle, posting: companyResearch.posting });
  }

  // Apply chosen references at their chosen placements: weave them into the cover
  // letter and refresh the open preview so the woven version shows.
  function applyCompanyResearch(placements) {
    const jobId = companyResearch.jobId;
    const picks = Array.isArray(placements) ? placements.filter((c) => c?.suggestion?.trim()) : [];
    setCompanyResearch((prev) => ({ ...prev, open: false }));
    if (!jobId || picks.length === 0) return;
    setCompanyResearchByJob((m) => ({ ...m, [jobId]: picks }));
    const wovenLines = weaveSources(tailoringMap[jobId]?.coverLetterResultLines || [], picks);
    setTailoringMap((current) => ({
      ...current,
      [jobId]: {
        ...(current[jobId] || {}),
        coverLetterResultLines: wovenLines,
        coverLetterPreviewHtml: undefined,
        coverLetterDocxB64: undefined,
        // AC-5: this action only touches the cover letter — clear/set just
        // its edited flag so a hand-edited résumé's edited state survives.
        edited: withEditedScope(current[jobId], "cover", true),
      },
    }));
    setPreviewReloadKey((k) => k + 1);
  }

  // Close the research dialog (the preview stays open underneath).
  function closeCompanyResearch() {
    setCompanyResearch((prev) => ({ ...prev, open: false }));
  }

  // Accept chosen facts into the cover letter (and record them server-side),
  // in place of the weave-and-apply flow above. `selection` is
  // `{facts: AcceptedFactInput[], declinedUrls: string[]}`.
  //
  // PB1 (plan.check.r2): REFUSED, with no write of any kind, when the entry
  // has a cover letter (non-empty coverLetterResultLines) but no engine
  // bytes for it (coverLetterDocxB64 missing/empty) -- a restored chip or a
  // cover-version switch. Splicing text-only in that state would proceed
  // silently and every later download would rebuild the fact into the
  // candidate's GENERIC uploaded template instead of their tailored letter.
  //
  // On success `edited` is NEVER assigned (T17/PB1's load-bearing fact): an
  // unedited accept keeps `resolveDocumentBlob`'s verbatim-serve branch
  // reachable, so the download and the Drive-save/preview seam both serve
  // the spliced bytes directly rather than rebuilding.
  async function acceptFacts(selection) {
    const jobId = companyResearch.jobId;
    if (!jobId) return { ok: false, reason: "No job is open." };
    const entry = tailoringMap[jobId] || {};
    const facts = Array.isArray(selection?.facts) ? selection.facts : [];
    const priorFacts = acceptedFactsByJob[jobId]?.facts || [];
    // M3 (verify.r1.md): the dialog has no removal UI yet, so it always
    // sends `declinedUrls: []`. Sending that through unchanged would WIPE
    // any existing retracted log on every accept (the RPC replaces, never
    // appends). Until the removal pass lands, resend the CURRENT log
    // unchanged instead of the dialog's placeholder value.
    const declinedUrls = acceptedFactsByJob[jobId]?.removed || [];

    const hasCoverLetter = Array.isArray(entry.coverLetterResultLines) && entry.coverLetterResultLines.length > 0;
    const hasCoverBytes = typeof entry.coverLetterDocxB64 === "string" && entry.coverLetterDocxB64.length > 0;
    if (hasCoverLetter && !hasCoverBytes) {
      setCompanyResearch((prev) => ({ ...prev, acceptError: NO_ENGINE_BYTES_REASON, acceptNotice: "" }));
      return { ok: false, reason: NO_ENGINE_BYTES_REASON };
    }

    setCompanyResearch((prev) => ({ ...prev, busy: true, acceptError: "", acceptNotice: "" }));
    try {
      // M2 (verify.r1.md): coverRecord starts from the PRIOR accepted facts
      // (not always []), so `insertedFacts` on the new letter version states
      // every fact the letter really carries, not just this click's.
      const priorRecord = priorFacts.map((f) => ({ id: f?.id ?? null, text: f?.text ?? "" }));
      const plan = planAcceptForEntry(entry, { facts, coverRecord: priorRecord });
      const coverChanged = plan.cover.edits.length > 0;
      const coverAlreadyEdited = editedForScope(entry, "cover");
      let coverDocxB64 = entry.coverLetterDocxB64;
      let notice = "";

      if (coverChanged && hasCoverLetter && hasCoverBytes && !coverAlreadyEdited) {
        const spliced = await applyCoverDocxEdits(entry.coverLetterDocxB64, entry.coverLetterResultLines, plan.cover.edits);
        if (!spliced.applied) {
          const reason = messageForRefusal(spliced.reason);
          setCompanyResearch((prev) => ({ ...prev, busy: false, acceptError: reason }));
          return { ok: false, reason };
        }
        coverDocxB64 = spliced.docxB64;
        // B4 (verify.r1.md): the spliced bytes are session-only -- nothing
        // yet persists them past a reload -- so a successful splice is
        // disclosed as such, the same way the hand-edited branch below
        // already discloses ITS limit.
        notice = SESSION_ONLY_NOTICE;
      } else if (coverChanged && coverAlreadyEdited) {
        notice = HAND_EDITED_NOTICE;
      }

      // M2 (verify.r1.md): send the MERGED set (prior + this click's, deduped
      // by normalised text), not just this click's -- otherwise a second
      // accept REPLACES the stored set instead of adding to it.
      const mergedFacts = mergeAcceptedFacts(priorFacts, facts);

      const res = await fetch("/api/accepted-facts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobRef: jobId,
          facts: mergedFacts,
          baseRevision: acceptedFactsByJob[jobId]?.revision ?? null,
          declinedUrls,
          coverVersion: coverChanged ? { lines: plan.cover.lines, insertedFacts: plan.cover.record } : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const reason = typeof data?.error === "string" && data.error ? data.error : "Couldn't save the accepted facts. Try again.";
        // B5 (verify.r1.md): a 409 names the winning revision/facts/removed.
        // Adopting them means the next attempt (another click, or a fresh
        // page load that re-seeds from the GET) uses the right baseRevision
        // instead of repeating the exact conflict "reload and try again"
        // could not otherwise fix.
        if (res.status === 409) {
          setAcceptedFactsByJob((m) => ({
            ...m,
            [jobId]: { facts: data.facts || [], removed: data.removed || [], revision: data.revision ?? null },
          }));
        }
        setCompanyResearch((prev) => ({ ...prev, busy: false, acceptError: reason }));
        return { ok: false, reason };
      }

      setTailoringMap((current) => {
        const cur = current[jobId] || {};
        const next = { ...cur };
        if (coverChanged) {
          next.coverLetterResultLines = plan.cover.lines;
          next.coverLetterPreviewHtml = undefined;
          if (hasCoverLetter && hasCoverBytes && !coverAlreadyEdited) next.coverLetterDocxB64 = coverDocxB64;
          // N61: keep this session's LOCATED record in sync -- it is what the
          // removal strip and the body highlight both read. `plan.cover.record`
          // mixes this click's freshly-located entries (lineIndex/offset) with
          // whatever `priorRecord` already carried (never located, kept only
          // for the store's provenance log above); a fact this session located
          // on an EARLIER accept and that this click didn't touch keeps ITS OWN
          // prior location rather than being dropped.
          const located = plan.cover.record.filter((r) => typeof r.lineIndex === "number" && typeof r.offset === "number");
          const untouched = (cur.insertedFacts || []).filter((p) => !located.some((r) => r.id === p.id));
          next.insertedFacts = [...untouched, ...located].map((r) => {
            const meta = mergedFacts.find((f) => f?.id === r.id);
            return { id: r.id, text: r.text, lineIndex: r.lineIndex, offset: r.offset, url: meta?.url || r.url || "", title: meta?.title || r.title || "" };
          });
        }
        if (plan.pristineCoverLines !== undefined) next.pristineCoverLines = plan.pristineCoverLines;
        return { ...current, [jobId]: next };
      });
      setAcceptedFactsByJob((m) => ({
        ...m,
        [jobId]: { facts: data.facts || [], removed: data.removed || [], revision: data.revision ?? null },
      }));
      setCompanyResearch((prev) => ({ ...prev, busy: false, acceptError: "", acceptNotice: notice }));
      return { ok: true };
    } catch (err) {
      const reason = err?.message || "Couldn't save the accepted facts. Try again.";
      setCompanyResearch((prev) => ({ ...prev, busy: false, acceptError: reason }));
      return { ok: false, reason };
    }
  }

  // N61 (live defect, chunk N61): every researched article defaults to the
  // "intro" placement, so two or three accepted facts routinely COALESCE
  // onto one paragraph (planCoverFacts groups same-line facts into a single
  // edit -- see that function's own header comment). Removing one of several
  // same-line facts left every LATER survivor's stored `offset` stale
  // against the now-shorter line: `planRemoveFact(survivor)` then found the
  // survivor's text was not where the record said and refused
  // `{changed:false}` (permanently unremovable), and `markInsertedFacts`
  // matched nothing either (permanently unhighlighted) -- an unremovable,
  // unhighlightable claim reaching the employer-bound letter.
  //
  // `facts` is already in screen order (the order `planCoverFacts` located
  // them in, preserved by `[...untouched, ...located]` in `acceptFacts`
  // above), so relocating each survivor's text against the NEW line with a
  // per-line cursor -- mirroring `planCoverFacts`' own locate loop -- finds
  // each survivor's OWN occurrence rather than a sibling's, satisfying the
  // invariant removal must never break: every surviving record locates its
  // own text in the resulting line, regardless of removal order.
  function relocateSurvivors(lines, facts) {
    const arr = Array.isArray(lines) ? lines : [];
    const cursorByLine = new Map();
    return (Array.isArray(facts) ? facts : []).map((f) => {
      if (typeof f?.lineIndex !== "number" || typeof f?.text !== "string" || !f.text) return f;
      const line = String(arr[f.lineIndex] ?? "");
      const from = cursorByLine.get(f.lineIndex) || 0;
      let at = line.indexOf(f.text, from);
      if (at < 0) at = line.indexOf(f.text);
      if (at >= 0) cursorByLine.set(f.lineIndex, at + f.text.length);
      return at >= 0 ? { ...f, offset: at } : f;
    });
  }

  // Remove one inserted fact from THIS job's cover letter, everywhere it can
  // egress (N61, the owner's "I should be able to remove any of the facts
  // with a simple click"). jobId-parameterised, not bound to
  // `companyResearch.jobId` -- the removal control lives in the PREVIEW
  // modal, not the research dialog. LOCATED, not text-keyed (F2): `record`
  // is this session's own located entry from `entry.insertedFacts`, so a
  // duplicated or overlapping fact is excised at its own line/offset, never
  // the wrong occurrence.
  //
  // Deliberately NOT gated on the engine's cover bytes: the accept path's
  // `NO_ENGINE_BYTES_REASON` refusal protects INSERTION (never splice a fact
  // into the candidate's generic template); that danger does not apply to
  // removal, whose safe outcome is the fact leaving, so text removal
  // proceeds even with no bytes to splice (a restored chip / cover-version
  // switch, AC-N61.19). A splice REFUSAL (stale bytes) is likewise never
  // allowed to trap the fact -- the bytes are dropped to "" (forcing the
  // download to rebuild from the now fact-free lines) rather than shipping
  // stale bytes that still carry the removed clause.
  async function removeInsertedFact(jobId, factId) {
    if (!jobId) return { ok: false, reason: "No job is open." };
    const entry = tailoringMap[jobId] || {};
    const insertedFacts = Array.isArray(entry.insertedFacts) ? entry.insertedFacts : [];
    const record = insertedFacts.find((r) => r.id === factId);
    if (!record) return { ok: false, reason: "That fact is no longer in the letter." };
    const lines = Array.isArray(entry.coverLetterResultLines) ? entry.coverLetterResultLines : [];
    const removal = planRemoveFact(lines, record);
    if (!removal.changed) return { ok: false, reason: "That fact is no longer in the letter." };

    const hasCoverBytes = typeof entry.coverLetterDocxB64 === "string" && entry.coverLetterDocxB64.length > 0;
    const coverAlreadyEdited = editedForScope(entry, "cover");
    let coverDocxB64 = entry.coverLetterDocxB64;
    if (hasCoverBytes && !coverAlreadyEdited) {
      const spliced = await applyCoverDocxEdits(entry.coverLetterDocxB64, lines, [removal.edit]);
      coverDocxB64 = spliced.applied ? spliced.docxB64 : "";
    }

    const remainingFacts = relocateSurvivors(removal.lines, insertedFacts.filter((r) => r.id !== factId));
    const priorRemoved = acceptedFactsByJob[jobId]?.removed || [];
    const removedKey = record.url || record.id || "";
    const removedLog = removedKey && !priorRemoved.includes(removedKey) ? [...priorRemoved, removedKey] : priorRemoved;
    const storedFacts = (acceptedFactsByJob[jobId]?.facts || []).filter((f) => f?.id !== factId);

    try {
      const res = await fetch("/api/accepted-facts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobRef: jobId,
          facts: storedFacts,
          baseRevision: acceptedFactsByJob[jobId]?.revision ?? null,
          declinedUrls: removedLog,
          coverVersion: { lines: removal.lines, insertedFacts: remainingFacts },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const reason = typeof data?.error === "string" && data.error ? data.error : "Couldn't remove that fact. Try again.";
        return { ok: false, reason };
      }
      setTailoringMap((current) => {
        const cur = current[jobId] || {};
        return {
          ...current,
          [jobId]: {
            ...cur,
            coverLetterResultLines: removal.lines,
            coverLetterPreviewHtml: undefined,
            coverLetterDocxB64: hasCoverBytes ? coverDocxB64 : cur.coverLetterDocxB64,
            insertedFacts: remainingFacts,
          },
        };
      });
      setAcceptedFactsByJob((m) => ({
        ...m,
        [jobId]: { facts: data.facts || [], removed: data.removed || [], revision: data.revision ?? null },
      }));
      setPreviewReloadKey((k) => k + 1);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err?.message || "Couldn't remove that fact. Try again." };
    }
  }

  // N72: auto-insert this job's eligible researched facts WITHOUT a per-fact
  // accept click (owner ruling: "review after the fact" -- the safety line
  // moves from insertion to egress, so the highlight + one-click removal in
  // the modal ARE the review, not a click before insertion). `isOpen` is a
  // LIVE getter, re-read here at entry and again at the write below -- a
  // snapshot boolean cannot see a candidate who closes the modal mid-flight,
  // which is exactly the case the write-time re-check exists to catch.
  //
  // THE AUTO-SELECT PREDICATE. An article inserts unasked only when it
  // carries a real, openable, non-redirect source (`articleUrlKey` -- the
  // same gate the manual accept path already trusts), is not already in this
  // application's removed log (so a retracted fact is never silently
  // reinstated by a later run), and actually carries suggestion text to
  // insert. Fails toward NOT inserting: an unsourced or invented claim in the
  // candidate's own voice, reaching an employer unreviewed, is the worst
  // failure this app can produce.
  async function autoInsertFactsForJob(jobId, isOpen) {
    if (!jobId || typeof isOpen !== "function" || !isOpen()) {
      return { ok: false, reason: "No open review surface." };
    }
    const entry = tailoringMap[jobId] || {};
    const hasCoverLetter = Array.isArray(entry.coverLetterResultLines) && entry.coverLetterResultLines.length > 0;
    if (!hasCoverLetter) return { ok: false, reason: "No cover letter to insert into." };
    const hasCoverBytes = typeof entry.coverLetterDocxB64 === "string" && entry.coverLetterDocxB64.length > 0;
    if (!hasCoverBytes) return { ok: false, reason: NO_ENGINE_BYTES_REASON };
    if (editedForScope(entry, "cover")) return { ok: false, reason: "Cover letter already edited." };

    const articles = researchByJob[jobId]?.articles || [];
    const priorFacts = acceptedFactsByJob[jobId]?.facts || [];
    const removedLog = acceptedFactsByJob[jobId]?.removed || [];
    const removedSet = new Set(removedLog);
    const eligible = articles.filter((a) => {
      if (!a || articleUrlKey(a.url) === null) return false;
      if (!String(a.suggestion || "").trim()) return false;
      if (removedSet.has(a.url) || removedSet.has(a.id)) return false;
      return true;
    });
    if (eligible.length === 0) return { ok: false, reason: "No eligible facts to insert." };

    const facts = eligible.map((a) => ({ id: a.id, text: a.suggestion, url: a.url, title: a.title }));
    const priorRecord = priorFacts.map((f) => ({ id: f?.id ?? null, text: f?.text ?? "" }));
    const plan = planAcceptForEntry(entry, { facts, coverRecord: priorRecord });
    if (plan.cover.edits.length === 0) return { ok: false, reason: "Nothing new to insert." };

    // The staleness guard `applyCoverDocxEdits` already makes (factDocx.js:33-34)
    // compares each edit's `before` against `entry.coverLetterResultLines` --
    // the snapshot this plan was built from -- so a splice against bytes that
    // have since moved on is refused rather than silently misapplied.
    const spliced = await applyCoverDocxEdits(entry.coverLetterDocxB64, entry.coverLetterResultLines, plan.cover.edits);
    if (!spliced.applied) return { ok: false, reason: messageForRefusal(spliced.reason) };

    // Write-time re-check #1: the docx splice above was a real await; do not
    // fire the store write for a review surface that closed while it ran.
    if (!isOpen()) return { ok: false, reason: "No open review surface." };

    const mergedFacts = mergeAcceptedFacts(priorFacts, facts);
    let res;
    try {
      res = await fetch("/api/accepted-facts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobRef: jobId,
          facts: mergedFacts,
          baseRevision: acceptedFactsByJob[jobId]?.revision ?? null,
          declinedUrls: removedLog,
          coverVersion: { lines: plan.cover.lines, insertedFacts: plan.cover.record },
        }),
      });
    } catch (err) {
      return { ok: false, reason: err?.message || "Couldn't add company facts." };
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const reason = typeof data?.error === "string" && data.error ? data.error : "Couldn't add company facts.";
      return { ok: false, reason };
    }

    // Write-time re-check #2: the PUT above was also a real await -- the
    // candidate may have closed the modal while it was in flight. No local
    // write for a fact the review surface no longer exists to show.
    if (!isOpen()) return { ok: false, reason: "No open review surface." };

    setTailoringMap((current) => {
      const cur = current[jobId];
      if (!cur) return current;
      // DO NOT copy acceptFacts' own updater (~:425-448): it writes
      // `plan.cover.lines` unconditionally from the pre-await snapshot,
      // harmless for a candidate's own click but a CLOBBER here -- this run
      // can fire while the candidate is typing. Compare the snapshot this
      // plan was built from against the CURRENT lines; if they moved on,
      // recompute the insert against the FRESH lines and drop the spliced
      // bytes computed against the stale ones (they no longer match what the
      // fresh text says -- the same divergence acceptFacts already accepts
      // for an already-hand-edited letter).
      const snapshotLines = Array.isArray(entry.coverLetterResultLines) ? entry.coverLetterResultLines : [];
      const freshLines = Array.isArray(cur.coverLetterResultLines) ? cur.coverLetterResultLines : [];
      const linesChanged =
        freshLines.length !== snapshotLines.length || freshLines.some((line, i) => line !== snapshotLines[i]);
      const coverPlan = linesChanged ? planAcceptForEntry(cur, { facts, coverRecord: priorRecord }) : plan;
      if (linesChanged && coverPlan.cover.edits.length === 0) return current;

      const next = { ...cur };
      next.coverLetterResultLines = coverPlan.cover.lines;
      next.coverLetterPreviewHtml = undefined;
      if (!linesChanged) next.coverLetterDocxB64 = spliced.docxB64;
      const located = coverPlan.cover.record.filter((r) => typeof r.lineIndex === "number" && typeof r.offset === "number");
      const untouched = (cur.insertedFacts || []).filter((p) => !located.some((r) => r.id === p.id));
      next.insertedFacts = [...untouched, ...located].map((r) => {
        const meta = mergedFacts.find((f) => f?.id === r.id);
        return { id: r.id, text: r.text, lineIndex: r.lineIndex, offset: r.offset, url: meta?.url || r.url || "", title: meta?.title || r.title || "" };
      });
      if (coverPlan.pristineCoverLines !== undefined) next.pristineCoverLines = coverPlan.pristineCoverLines;
      return { ...current, [jobId]: next };
    });
    setAcceptedFactsByJob((m) => ({
      ...m,
      [jobId]: { facts: data.facts || [], removed: data.removed || [], revision: data.revision ?? null },
    }));
    // Bump the reload key so an already-open preview re-parses the body model
    // and shows the fact highlighted, the same way removeInsertedFact does.
    setPreviewReloadKey((k) => k + 1);
    return { ok: true };
  }

  return {
    companyResearch,
    researchByJob,
    companyResearchByJob,
    acceptedFactsByJob,
    startBackgroundResearch,
    openCompanyResearch,
    researchTypedCompany,
    applyCompanyResearch,
    closeCompanyResearch,
    addResearchUrl,
    acceptFacts,
    removeInsertedFact,
    autoInsertFactsForJob,
  };
}
