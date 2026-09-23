"use client";

import { useRef, useState } from "react";
import { weaveSources } from "../../lib/document/coverLetterWeave";
import { readEngine } from "../settings/engine";
import { planAcceptForEntry, mergeAcceptedFacts } from "../../lib/acceptedFacts/factInsertion";
import { applyCoverDocxEdits } from "../../lib/acceptedFacts/factDocx";
import { editedForScope } from "../../lib/document/previewBlob";
import { hashString } from "../../lib/text/phrasing";
import { safeExternalHref } from "../../lib/url/safeExternalHref";

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

// N35/F1+F4: mint a provenance id ON ARRIVAL, at the one seam every research
// article passes through regardless of producer (the Gemini route and the
// embedded engine both mint `art-${i}` BY POSITION -- route.js:76,
// companyResearchLocal.js:78 -- so a run's first card is always `art-0`,
// whatever article it actually is). Two different accepted facts must never
// share an id, so this overrides whatever the producer sent, deriving the id
// from the article's own url: stable for the SAME article across sessions
// (a re-run finds the same article at the same url, and it should read back
// as the same fact), yet distinct between different articles because
// different articles carry different urls. `safeExternalHref` is the app's
// one "is this usable as a url" check; an article that fails it (or carries
// none at all, F4's hardening case) has no stable key to derive from, so it
// falls back to a per-run component instead -- non-durable, per the owner
// ruling, but still distinct and never null.
function mintArticleId(article, runStamp, index) {
  const url = typeof article?.url === "string" ? article.url.trim() : "";
  if (safeExternalHref(url)) return `art-${hashString(url).toString(36)}`;
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
          articles: withMintedIds(data.articles, Date.now()),
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
          setCompanyResearch((prev) => ({ ...prev, busy: false, acceptError: NO_ENGINE_BYTES_REASON }));
          return { ok: false, reason: NO_ENGINE_BYTES_REASON };
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
  };
}
