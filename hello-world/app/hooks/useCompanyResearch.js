"use client";

import { useRef, useState } from "react";
import { weaveSources } from "../../lib/document/coverLetterWeave";
import { readEngine } from "../settings/engine";

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

export function useCompanyResearch({ tailoringMap, setTailoringMap, setPreviewReloadKey }) {
  const [companyResearch, setCompanyResearch] = useState({
    open: false,
    jobId: null,
    company: "",
    jobTitle: "",
    posting: "",
    busy: false,
  });
  const [researchByJob, setResearchByJob] = useState({});
  const [companyResearchByJob, setCompanyResearchByJob] = useState({});
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
          articles: Array.isArray(data.articles) ? data.articles : [],
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

  // Open the research dialog over the preview, ensuring the job's research has
  // been kicked off (it usually already was, when the preview opened).
  function openCompanyResearch(job) {
    if (!job) return;
    const t = tailoringMap[job.id] || {};
    const company = (job.company || "").trim();
    const jobTitle = t.generatedJobTitle || job.title || "";
    const posting = job.description || t.jobDescription || "";
    setCompanyResearch({ open: true, jobId: job.id, company, jobTitle, posting, busy: false });
    startBackgroundResearch({ jobId: job.id, company, jobTitle, posting });
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

  return {
    companyResearch,
    researchByJob,
    companyResearchByJob,
    startBackgroundResearch,
    openCompanyResearch,
    researchTypedCompany,
    applyCompanyResearch,
    closeCompanyResearch,
    addResearchUrl,
  };
}
