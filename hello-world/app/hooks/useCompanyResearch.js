"use client";

import { useRef, useState } from "react";
import { weaveSources, DEFAULT_PLACEMENT } from "../../lib/document/coverLetterWeave";
import { readEngine } from "../settings/engine";
import {
  planAcceptForEntry,
  mergeAcceptedFacts,
  planRemoveFact,
  coverFactStrategy,
  filterEligibleArticles,
  relocateSurvivors,
} from "../../lib/acceptedFacts/factInsertion";
import { planMoveFact } from "../../lib/acceptedFacts/factMove";
import { commitFactMove } from "../../lib/acceptedFacts/commitFactMove";
import { captureCoverSnapshot, moveOptimisticPatch, moveSuccessPatch, moveAcceptedFactsPatch, resolveNoopMove } from "../../lib/acceptedFacts/moveOptimism";
import { commitSmoothedFact } from "../../lib/acceptedFacts/commitSmoothedFact";
import { applyCoverDocxEdits } from "../../lib/acceptedFacts/factDocx";
import { recordDecision } from "../../lib/activityLog/appActivityLog";
import { uploadCoverDocx, fetchCoverDocxB64 } from "../../lib/document/coverDocxStore";
import { messageForRefusal } from "../../lib/acceptedFacts/factRefusalMessage";
import { editedForScope, withEditedScope } from "../../lib/document/previewBlob";
import { isDocxResume } from "../../lib/document/docx";
import { articleUrlKey, dedupeArrivedArticles, withMintedIds } from "../../lib/research/articleIdentity";

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
// N59: shown instead of SESSION_ONLY_NOTICE once the spliced document is
// actually persisted (uploadCoverDocx returned a path) -- the styled copy
// now survives a reload, so the old "download it now" urgency is no longer
// accurate and would mislead the candidate into thinking it is still lost.
const PERSISTED_NOTICE =
  "The fact was added to your cover letter, and this session's styled copy is now saved — it survives a reload.";
// N81 Finding B: shown when a re-accept dedupes -- the shared seam guard
// (planCoverFacts) recognised the fact's id AND text as already present in
// this letter, so nothing was inserted. Info, not error (mirrors the auto
// path's N77 "nothing new" handling): the accept still resolves `{ok:true}`,
// the dialog just needs to say something instead of sitting there silent.
const ALREADY_PRESENT_NOTICE = "That fact is already in your cover letter.";
// N81 closing round, Bug 2 (fresh-verifier NOT-SHIP on 5e96be2): a job with
// NO tailored cover letter yet always has `coverChanged === false` (there is
// nothing for planCoverFacts to touch), so the `!coverChanged` branch below
// used to fall through to ALREADY_PRESENT_NOTICE -- telling the candidate a
// fact is "already in your cover letter" when there is no cover letter at
// all. This mirrors the sibling auto path's own no-cover-letter wording and
// severity (autoInsertFactsForJob, below) exactly, so the two paths agree.
const NO_COVER_LETTER_REASON = "No cover letter to insert into.";
// N89 Part 1 (owner-blocking, 2026-09-28): shown for the LINE-ONLY path -- a
// Gemini cover letter never produces server-side docx bytes, so when the
// candidate's uploaded template File is still in session and the letter has
// lines, the fact is inserted into the TEXT and no docx is spliced/uploaded;
// the preview and download instead rebuild from the uploaded template
// (resolveDocumentBlob's existing last-resort branch). Distinct from
// SESSION_ONLY_NOTICE/PERSISTED_NOTICE (those describe a SPLICED document's
// persistence state, which never applies here -- there is no spliced doc).
const LINE_REBUILD_NOTICE =
  "The fact was added to your cover letter. The download rebuilds it from your uploaded template.";

// Per-job company research: warmed in the background when a preview opens, shown
// behind the preview's "Research company" button, and (on apply) woven into the
// cover letter. Ephemeral / session-only.
//
// Depends on the parent's tailoring map (to read/weave the cover letter) and the
// preview reload key (to refresh the open preview after weaving).

// `withEditedScope` (setting one scope of the per-scope edited flag) is
// imported from lib/document/previewBlob.js above -- that file already
// exported it beside `editedForScope`, this hook just had its own duplicate
// copy (removed; behaviour byte-identical).

// `articleUrlKey`/`dedupeArrivedArticles`/`mintArticleId`/`withMintedIds`
// (the N35 arrival-identity helpers) moved to lib/research/articleIdentity.js
// -- see that module's own header comment -- under the same N92 Wave 1
// file-size contingency as `relocateSurvivors` above. Behaviour is
// byte-identical; only imported now.

// N62 Capability A: `defaultPlacement` is the user's saved placement default
// (a PLACEMENTS id, from useCoverFactPlacement via page.js), threaded so the
// TRULY automatic path (autoInsertFactsForJob) honours it too -- not just the
// research dialog. Absent/falsy is byte-identical to today: every fact still
// resolves to DEFAULT_PLACEMENT.
// N59: `supabase`/`currentUser` are new props (page.js wires the same client
// and user it already uses for the rest of the tailoring map) -- needed to
// resolve a saved letter's stored docx_path back into bytes, and to persist
// a fresh splice's bytes so the NEXT reload has something to resolve. Both
// are optional: every call below degrades to "resolves nothing" / "persists
// nothing" (never throws) when either is absent, so a caller that has not
// been updated yet keeps today's session-only behaviour.
// N89 Part 1: `coverLetterFile` is the candidate's uploaded cover-letter
// template (page.js state, forwarded here new in this chunk) -- the AC-9
// discriminator between a Gemini letter that can be rebuilt from its
// template (Shape B) and one that genuinely cannot (residual Shape C).
// N92 Wave 2 (Control C): `forwardPositioning` is the user's saved forward
// preference (page.js's `forward` from useCoverFactPlacement) -- threaded
// only into the truly-automatic path below (autoInsertFactsForJob), never
// into acceptFacts' manual path (AC-C8: a hand-set placement outranks it).
export function useCompanyResearch({
  tailoringMap,
  setTailoringMap,
  setPreviewReloadKey,
  defaultPlacement,
  forwardPositioning,
  supabase,
  currentUser,
  coverLetterFile,
}) {
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

  // N89 Part 1 (AC-9): Shape B (Gemini, no bytes, but the uploaded template
  // is still in session) vs the residual Shape C (no bytes, no template --
  // refuse, unchanged). `canRebuild` is the ONE line Part 2 later widens to
  // also accept a stored template path.
  const hasInSessionTemplate = isDocxResume(coverLetterFile);
  const canRebuild = hasInSessionTemplate;

  // N59/K8: the single seam every splice-producing path below resolves a
  // faithful engine source through -- in-session bytes if the entry still
  // has them (the common case, right after a generation), else the entry's
  // OWN stored docx_path (a restored chip or a cover-version switch),
  // fetched through the real storage round-trip. "" when neither is
  // available; fetchCoverDocxB64 already never throws, so this never does
  // either. Splicing this resolved value (not entry.coverLetterDocxB64
  // directly) is what fixes K8: a fix that widened the refusal gate but kept
  // splicing the empty in-session field would still fail every path-only
  // accept.
  async function resolveCoverEngineBytes(entry) {
    if (typeof entry?.coverLetterDocxB64 === "string" && entry.coverLetterDocxB64.length > 0) {
      return entry.coverLetterDocxB64;
    }
    const path = typeof entry?.coverLetterDocxPath === "string" ? entry.coverLetterDocxPath : "";
    if (!path) return "";
    const b64 = await fetchCoverDocxB64(supabase, path);
    return b64 || "";
  }

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
  // Returns the seeded `{facts, removed, revision}` (or null on failure) so a
  // caller that needs the value THIS SAME turn -- `autoInsertFactsForJob`
  // below -- doesn't have to read it back off `acceptedFactsByJob` state,
  // which a `setState` call cannot make visible within the same synchronous
  // continuation.
  async function fetchAcceptedFactsInto(jobId) {
    if (!jobId) return null;
    try {
      const res = await fetch(`/api/accepted-facts?jobRef=${encodeURIComponent(jobId)}`);
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      if (!data) return null;
      const seeded = { facts: data.facts || [], removed: data.removed || [], revision: data.revision ?? null };
      setAcceptedFactsByJob((m) => ({ ...m, [jobId]: seeded }));
      return seeded;
    } catch {
      /* best-effort seed -- an accept still works with baseRevision null */
      return null;
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
  // PB1 (plan.check.r2), widened by N59/AC-6: REFUSED, with no write of any
  // kind, when the entry has a cover letter (non-empty coverLetterResultLines)
  // but no FAITHFUL engine source for it -- neither in-session bytes nor a
  // docx_path that actually resolves (resolveCoverEngineBytes above). A
  // restored chip or a cover-version switch used to always fail this; now
  // either source is accepted, and only a letter with NEITHER (pre-migration,
  // or an upload that never happened) is refused. Splicing text-only in that
  // state would proceed silently and every later download would rebuild the
  // fact into the candidate's GENERIC uploaded template instead of their
  // tailored letter.
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
    // M3 (verify.r1.md): the dialog has no removal UI, so accept resends the
    // CURRENT removed log instead of the dialog's `[]` placeholder (the RPC
    // replaces, never appends). N90: an explicit accept also un-declines
    // exactly the keys THIS click is accepting -- never any other removed
    // entry -- so a fact the candidate hasn't touched stays suppressed
    // exactly as before.
    const priorRemoved = acceptedFactsByJob[jobId]?.removed || [];
    const acceptedKeys = new Set(facts.flatMap((f) => [f?.url, f?.id]).filter(Boolean));
    const declinedUrls = priorRemoved.filter((key) => !acceptedKeys.has(key));

    const hasCoverLetter = Array.isArray(entry.coverLetterResultLines) && entry.coverLetterResultLines.length > 0;
    // K8: resolved ONCE here and spliced against below -- never
    // entry.coverLetterDocxB64 directly, which is empty for exactly the
    // restored/switched letters this widening exists to unblock.
    const resolvedCoverDocxB64 = hasCoverLetter ? await resolveCoverEngineBytes(entry) : "";
    const hasCoverBytes = resolvedCoverDocxB64.length > 0;
    // N89 Part 1: refuse only when there is NEITHER a faithful byte source
    // NOR an in-session template to rebuild onto (residual Shape C) -- a
    // Gemini letter with its uploaded template still in session (Shape B)
    // falls through to the line-only path below instead of refusing here.
    if (hasCoverLetter && !hasCoverBytes && !canRebuild) {
      setCompanyResearch((prev) => ({ ...prev, acceptError: NO_ENGINE_BYTES_REASON, acceptNotice: "" }));
      return { ok: false, reason: NO_ENGINE_BYTES_REASON };
    }
    // N81 closing round, Bug 2: refuse honestly, before any write, rather than
    // let `!coverChanged` below fall through to ALREADY_PRESENT_NOTICE for a
    // job that never had a cover letter to begin with.
    if (!hasCoverLetter) {
      setCompanyResearch((prev) => ({ ...prev, acceptError: NO_COVER_LETTER_REASON, acceptNotice: "" }));
      return { ok: false, reason: NO_COVER_LETTER_REASON };
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
      // N89 Part 1: the one selector both siblings use, so they cannot drift
      // (AC-5). hasCoverLetter is true here (the `!hasCoverLetter` refusal
      // above already returned), so "refuse" is unreachable at this point.
      const strategy = coverFactStrategy({ hasCoverBytes, canRebuild, coverAlreadyEdited });
      let coverDocxB64 = entry.coverLetterDocxB64;
      // K10: explicit null unless a splice actually uploads a fresh object
      // below -- never the pre-accept path (stale) and never left absent.
      let coverDocxPath = null;
      let notice = "";

      if (coverChanged && strategy === "splice") {
        const spliced = await applyCoverDocxEdits(resolvedCoverDocxB64, entry.coverLetterResultLines, plan.cover.edits);
        if (!spliced.applied) {
          const reason = messageForRefusal(spliced.reason);
          setCompanyResearch((prev) => ({ ...prev, busy: false, acceptError: reason }));
          return { ok: false, reason };
        }
        coverDocxB64 = spliced.docxB64;
        // N59/AC-9: persist the spliced bytes (accept-path key, R2) so the
        // NEXT reload has something to resolve -- closing the exact gap this
        // chunk exists for. Best-effort: uploadCoverDocx never throws, and a
        // failed upload still leaves the in-session accept fully usable, just
        // session-only (SESSION_ONLY_NOTICE), same as before this chunk.
        coverDocxPath = await uploadCoverDocx(supabase, currentUser?.id, coverDocxB64);
        notice = coverDocxPath ? PERSISTED_NOTICE : SESSION_ONLY_NOTICE;
      } else if (coverChanged && coverAlreadyEdited) {
        notice = HAND_EDITED_NOTICE;
      } else if (coverChanged && strategy === "lines") {
        // Shape B (N89 Part 1): no engine bytes, but the uploaded template is
        // still in session -- insert into the text only, skip the docx-byte
        // splice. coverDocxPath stays null; the download/preview rebuild
        // from coverLetterFile + the now-updated lines (resolveDocumentBlob's
        // existing uploaded-template last resort).
        notice = LINE_REBUILD_NOTICE;
      } else if (!coverChanged) {
        notice = ALREADY_PRESENT_NOTICE;
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
          coverVersion: coverChanged
            ? { lines: plan.cover.lines, insertedFacts: plan.cover.record, docxPath: coverDocxPath }
            : null,
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
      // N89 Part 1/P1-3 (AC-4): repaint the preview beneath the dialog --
      // unlike the auto path and removeInsertedFact, this never bumped the
      // reload key before, so an accepted fact never showed until some other
      // reload happened to fire.
      if (coverChanged) setPreviewReloadKey((k) => k + 1);
      return { ok: true };
    } catch (err) {
      const reason = err?.message || "Couldn't save the accepted facts. Try again.";
      setCompanyResearch((prev) => ({ ...prev, busy: false, acceptError: reason }));
      return { ok: false, reason };
    }
  }

  // `relocateSurvivors` (the N61 stale-offset fix for coalesced facts) moved
  // to lib/acceptedFacts/factInsertion.js -- see that export's own header
  // comment -- under the N92 Wave 1 file-size contingency, the same kind of
  // move N89 Part 1 already made for `coverFactStrategy`/
  // `filterEligibleArticles`. Behaviour is byte-identical; only imported now.

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
  //
  // K10: this is the one RPC-writing sibling of acceptFacts/autoInsertFactsForJob
  // that could leave the version row non-durable in a way no single-function
  // test would catch -- so it resolves the same way (in-session bytes OR the
  // entry's own docx_path) and uploads the fact-removed splice on success.
  // When nothing resolves (or the letter is already hand-edited), the PUT
  // carries an EXPLICIT `docxPath: null` -- never the pre-removal path, which
  // still carries the removed clause, and never left absent.
  async function removeInsertedFact(jobId, factId) {
    if (!jobId) return { ok: false, reason: "No job is open." };
    const entry = tailoringMap[jobId] || {};
    const insertedFacts = Array.isArray(entry.insertedFacts) ? entry.insertedFacts : [];
    const record = insertedFacts.find((r) => r.id === factId);
    if (!record) return { ok: false, reason: "That fact is no longer in the letter." };
    const lines = Array.isArray(entry.coverLetterResultLines) ? entry.coverLetterResultLines : [];
    const removal = planRemoveFact(lines, record);
    if (!removal.changed) return { ok: false, reason: "That fact is no longer in the letter." };

    const resolvedCoverDocxB64 = await resolveCoverEngineBytes(entry);
    const hasCoverBytes = resolvedCoverDocxB64.length > 0;
    const coverAlreadyEdited = editedForScope(entry, "cover");
    let coverDocxB64 = entry.coverLetterDocxB64;
    let coverDocxPath = null;
    if (hasCoverBytes && !coverAlreadyEdited) {
      const spliced = await applyCoverDocxEdits(resolvedCoverDocxB64, lines, [removal.edit]);
      coverDocxB64 = spliced.applied ? spliced.docxB64 : "";
      if (spliced.applied) {
        coverDocxPath = await uploadCoverDocx(supabase, currentUser?.id, coverDocxB64);
      }
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
          coverVersion: { lines: removal.lines, insertedFacts: remainingFacts, docxPath: coverDocxPath },
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

  // N92 Wave 1 (Control A): move one inserted fact forward or backward by
  // exactly one sentence (the owner's "controls to move each fact forward or
  // backward a sentence"). A PARALLEL of removeInsertedFact above -- an
  // ADDITION, not a rewrite of any existing function. `planMoveFact`
  // (lib/acceptedFacts/factMove.js) is the single pure primitive that
  // decides where the fact lands; Wave 2's forward nudge calls the exact
  // SAME function from a different seam (AC-C2). The byte-splice+PUT I/O
  // mirroring removeInsertedFact:665-676 lives in
  // lib/acceptedFacts/commitFactMove.js (a file-size extraction, not a
  // behaviour change) -- this function keeps the plan/boundary decision and
  // every React state update, since the decision ledger binds
  // `recordDecision` to this module (design section 5).
  //
  // N95 (owner ruling: optimistic-with-rollback) -- shifts the position
  // synchronously on click, reconciled against the commit below; the server
  // write is untouched (AC-X1). Rules: lib/acceptedFacts/moveOptimism.js.
  async function moveInsertedFact(jobId, factId, direction) {
    if (!jobId) return { ok: false, reason: "No job is open." };
    const entry = tailoringMap[jobId] || {};
    const insertedFacts = Array.isArray(entry.insertedFacts) ? entry.insertedFacts : [];
    const lines = Array.isArray(entry.coverLetterResultLines) ? entry.coverLetterResultLines : [];
    const moved = planMoveFact({ lines, records: insertedFacts, id: factId, direction });
    if (!moved.changed) {
      const { outcome, reason } = resolveNoopMove(moved);
      recordDecision("fact-position", outcome, { direction, reason: moved.reason, code: moved.reason });
      return { ok: false, reason };
    }

    // Captured before the optimistic write (frozen `entry`) -- the commit
    // below reads THIS entry, not the nulled live state (AC-X1).
    const preMove = captureCoverSnapshot(entry);
    setTailoringMap((current) => {
      const cur = current[jobId] || {};
      return { ...current, [jobId]: { ...cur, ...moveOptimisticPatch(moved) } };
    });
    setPreviewReloadKey((k) => k + 1);

    const resolvedCoverDocxB64 = await resolveCoverEngineBytes(entry);
    const hasCoverBytes = resolvedCoverDocxB64.length > 0;
    const coverAlreadyEdited = editedForScope(entry, "cover");
    const commit = await commitFactMove({
      jobId,
      lines,
      moved,
      hasCoverBytes,
      coverAlreadyEdited,
      resolvedCoverDocxB64,
      entryCoverDocxB64: entry.coverLetterDocxB64,
      supabase,
      currentUserId: currentUser?.id,
      facts: acceptedFactsByJob[jobId]?.facts || [],
      baseRevision: acceptedFactsByJob[jobId]?.revision ?? null,
      declinedUrls: acceptedFactsByJob[jobId]?.removed || [],
    });
    if (!commit.ok) {
      recordDecision("fact-position", "failed", { direction, reason: "save-failed", code: "save-failed" });
      // Exact rollback: the cover-scoped snapshot only, merged over current state (never a wholesale replace).
      setTailoringMap((current) => {
        const cur = current[jobId] || {};
        return { ...current, [jobId]: { ...cur, ...preMove } };
      });
      setPreviewReloadKey((k) => k + 1);
      return { ok: false, reason: commit.reason };
    }

    // moveSuccessPatch resolves the open decision: coverLetterDocxPath is RECONCILED on success, not left nulled.
    setTailoringMap((current) => {
      const cur = current[jobId] || {};
      const patch = moveSuccessPatch({ moved, hasCoverBytes, coverAlreadyEdited, preMove, commit, curCoverDocxB64: cur.coverLetterDocxB64 });
      return { ...current, [jobId]: { ...cur, ...patch } };
    });
    setAcceptedFactsByJob((m) => ({ ...m, [jobId]: moveAcceptedFactsPatch(commit, acceptedFactsByJob[jobId]) }));
    setPreviewReloadKey((k) => k + 1);
    recordDecision("fact-position", "acted", { direction, reason: "moved", code: "moved" });
    return { ok: true };
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
  //
  // N77: every refusal returns `{ ok: false, reason, severity, code }`, not
  // just `{ ok, reason }` -- on HEAD the caller discarded the result
  // entirely, so nine distinct refusal paths all looked like silence. `code`
  // is the stable machine discriminator (`"no-engine-bytes"`,
  // `"already-edited"`, `"nothing-eligible"`, ...); `severity` tells the
  // caller how to SHOW it: "failure" (role=alert, something is actually
  // broken), "info" (role=status, a normal "nothing new" outcome, never
  // dressed as an error), or "silent" (never shown on screen -- currently
  // only the already-edited ruling below -- but still always recorded). On
  // success the return also carries `count`, the real number of facts this
  // call inserted (`facts.length`, never a literal).
  async function autoInsertFactsForJob(jobId, isOpen) {
    if (!jobId || typeof isOpen !== "function" || !isOpen()) {
      // No surface exists to show anything on, so this refuses SILENTLY on
      // screen (there is nothing to render into) but is still recorded by
      // the caller -- see the `severity` contract on this function's own
      // header comment below.
      return { ok: false, reason: "No open review surface.", severity: "silent", code: "no-open-surface" };
    }
    const entry = tailoringMap[jobId] || {};
    const hasCoverLetter = Array.isArray(entry.coverLetterResultLines) && entry.coverLetterResultLines.length > 0;
    if (!hasCoverLetter) {
      return { ok: false, reason: "No cover letter to insert into.", severity: "failure", code: "no-cover-letter" };
    }
    // K8/AC-6: resolve a faithful engine source the same way acceptFacts
    // does -- in-session bytes, or the entry's own stored docx_path (a saved
    // application opened fresh, with no in-session bytes at all -- the exact
    // shape the owner's activity log showed refusing).
    const resolvedCoverDocxB64 = await resolveCoverEngineBytes(entry);
    // K9: the resolve above is a new await the entry gate's isOpen() check
    // could not see through -- re-check here so a candidate who closes the
    // modal mid-resolve does not get a wasted splice attempted against a
    // surface that is already gone.
    if (!isOpen()) return { ok: false, reason: "No open review surface.", severity: "silent", code: "no-open-surface" };
    const hasCoverBytes = resolvedCoverDocxB64.length > 0;
    // N89 Part 1: refuse only when there is neither a faithful byte source
    // nor an in-session template to rebuild onto (residual Shape C) -- see
    // the identical reasoning in acceptFacts above.
    if (!hasCoverBytes && !canRebuild) {
      return { ok: false, reason: NO_ENGINE_BYTES_REASON, severity: "failure", code: "no-engine-bytes" };
    }
    // RULING (settled): suppressing auto-insert into a hand-edited letter is
    // deliberate -- the candidate's own edits are never overwritten, and
    // nothing here is broken. This refuses SILENTLY on screen (severity
    // "silent"; no alert, no status) but is ALWAYS recorded to the activity
    // log by the caller, so a diagnoser can tell "suppressed because you
    // edited it" apart from "broken".
    if (editedForScope(entry, "cover")) {
      return { ok: false, reason: "Cover letter already edited.", severity: "silent", code: "already-edited" };
    }
    // N89 Part 1: past this point coverAlreadyEdited is always false (the
    // branch above already returned), so this is "splice" (bytes resolved)
    // or "lines" (Shape B -- no bytes, template in session).
    const strategy = coverFactStrategy({ hasCoverBytes, canRebuild, coverAlreadyEdited: false });

    // N61 (AC-N61.20, cross-session gap): `acceptedFactsByJob[jobId]` is
    // seeded ONLY by the manual research dialog (`openCompanyResearch` ->
    // `fetchAcceptedFactsInto`). The auto path has no such call, so on this
    // job's FIRST auto-insert this session, reading `acceptedFactsByJob`
    // straight off state would see the same empty/never-seeded shape as a
    // job with no removals and no existing store row -- indistinguishable
    // from a fact the candidate genuinely removed in an EARLIER session,
    // which would then be re-inserted unasked. Fetched fresh here so the
    // eligibility filter below always sees this application's real removed
    // log, seeded or not.
    //
    // This fetch ALSO carries `revision`, which `acceptFacts` above already
    // depends on to avoid a stale-base 409 (see `fetchAcceptedFactsInto`'s own
    // "B5" comment): an unseeded `revision` is `null`, and a PUT with a null
    // base against an application that already HAS a facts row -- i.e. every
    // returning candidate who has ever accepted or removed a fact here -- is
    // a conflict the store refuses. Without this fetch, auto-insert would 409
    // silently for exactly the candidates the removal log matters most for,
    // making the whole feature look like a no-op weeks later.
    //
    // If the fetch fails AND this job was never seeded any other way (no
    // prior manual-dialog open, no earlier accept/remove/auto-insert this
    // session), there is no trustworthy removed-log/revision to act on --
    // REFUSE rather than treat "couldn't check" as "nothing was ever removed,
    // and no row exists yet". A missed insertion is a lost improvement; a
    // wrongly-reinstated retracted fact, or a silent 409 no-op, are worse.
    const priorSeed = acceptedFactsByJob[jobId];
    const freshSeed = await fetchAcceptedFactsInto(jobId);
    if (!isOpen()) return { ok: false, reason: "No open review surface.", severity: "silent", code: "no-open-surface" };
    const seeded = freshSeed || priorSeed;
    if (!seeded) {
      return {
        ok: false,
        reason: "Couldn't verify prior removals before inserting.",
        severity: "failure",
        code: "verify-failed",
      };
    }

    const articles = researchByJob[jobId]?.articles || [];
    const priorFacts = seeded.facts || [];
    const removedLog = seeded.removed || [];
    const removedSet = new Set(removedLog);
    // N81: the id-level "already inserted" guard now lives at the shared seam
    // (`planCoverFacts` in lib/acceptedFacts/factInsertion.js), which both this
    // auto path and the manual accept path (`acceptFacts` above) route
    // through -- a local guard here duplicated that check and would leave a
    // third caller of the seam unprotected. An article already inserted is
    // therefore left "eligible" by this filter; `planAcceptForEntry` below
    // skips it via `coverRecord`, yields no edit, and the caller falls
    // through to the existing "nothing-new" info result just below.
    // N90: filterEligibleArticles (factInsertion.js) also tallies why each
    // dropped article was excluded, for the nothing-eligible log below.
    const { eligible, ...dropped } = filterEligibleArticles(articles, { urlKey: articleUrlKey, removedSet, priorFacts });
    if (eligible.length === 0) {
      return { ok: false, reason: "No eligible facts to insert.", severity: "info", code: "nothing-eligible", articleCount: articles.length, ...dropped };
    }

    // N62 Capability A: every auto-inserted fact takes the saved default
    // placement (finding: this is the ONLY truly automatic path the owner
    // named -- a preference threaded only into the research dialog would
    // leave this path always resolving to "intro" regardless).
    const placement = defaultPlacement || DEFAULT_PLACEMENT;
    const facts = eligible.map((a) => ({ id: a.id, text: a.suggestion, url: a.url, title: a.title, placement }));
    const priorRecord = priorFacts.map((f) => ({ id: f?.id ?? null, text: f?.text ?? "" }));
    // N92 Wave 2 (Control C, AC-C1): threaded here so the truly-automatic
    // path honours the saved forward preference the same way it already
    // honours the saved placement default just above.
    const plan = planAcceptForEntry(entry, { facts, coverRecord: priorRecord, forwardNudge: forwardPositioning });
    if (plan.cover.edits.length === 0) {
      return { ok: false, reason: "Nothing new to insert.", severity: "info", code: "nothing-new" };
    }

    // N89 Part 1 hazard (P1-2): hoisted to FUNCTION scope, not declared
    // inside the `if` below -- setTailoringMap further down reads
    // spliced.docxB64 conditionally, and a block-scoped declaration would
    // leave it undefined there for Shape B, which never enters the block at
    // all (a null deref).
    let spliced = null;
    let coverDocxPath = null;
    if (strategy === "splice") {
      // The staleness guard `applyCoverDocxEdits` already makes (factDocx.js:33-34)
      // compares each edit's `before` against `entry.coverLetterResultLines` --
      // the snapshot this plan was built from -- so a splice against bytes that
      // have since moved on is refused rather than silently misapplied. Spliced
      // against the RESOLVED bytes (K8) -- entry.coverLetterDocxB64 alone is
      // empty for exactly the saved-letter case this function exists to fix.
      spliced = await applyCoverDocxEdits(resolvedCoverDocxB64, entry.coverLetterResultLines, plan.cover.edits);
      if (!spliced.applied) {
        return { ok: false, reason: messageForRefusal(spliced.reason), severity: "failure", code: "splice-refused" };
      }

      // Write-time re-check #1: the docx splice above was a real await; do not
      // fire the store write for a review surface that closed while it ran.
      if (!isOpen()) return { ok: false, reason: "No open review surface.", severity: "silent", code: "no-open-surface" };

      // N59/AC-9: persist the spliced bytes (accept-path key, R2) so a later
      // reload -- or the next auto-insert run, which itself depends on this
      // resolving -- has something to resolve. Best-effort; a failed upload
      // still lets this run succeed in-session, same as before this chunk.
      coverDocxPath = await uploadCoverDocx(supabase, currentUser?.id, spliced.docxB64);
    }
    // Shape B (strategy === "lines"): no splice, no upload, coverDocxPath
    // stays null. No re-check is needed here -- unlike the splice branch
    // above, nothing awaited since the last isOpen() check.

    const mergedFacts = mergeAcceptedFacts(priorFacts, facts);
    let res;
    try {
      res = await fetch("/api/accepted-facts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobRef: jobId,
          facts: mergedFacts,
          baseRevision: seeded.revision ?? null,
          declinedUrls: removedLog,
          coverVersion: { lines: plan.cover.lines, insertedFacts: plan.cover.record, docxPath: coverDocxPath },
        }),
      });
    } catch (err) {
      return {
        ok: false,
        reason: err?.message || "Couldn't add company facts.",
        severity: "failure",
        code: "save-failed",
      };
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const reason = typeof data?.error === "string" && data.error ? data.error : "Couldn't add company facts.";
      return { ok: false, reason, severity: "failure", code: "save-failed" };
    }

    // Write-time re-check #2: the PUT above was also a real await -- the
    // candidate may have closed the modal while it was in flight. No local
    // write for a fact the review surface no longer exists to show.
    if (!isOpen()) return { ok: false, reason: "No open review surface.", severity: "silent", code: "no-open-surface" };

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
      // N92 Wave 2: the re-plan branch must carry the SAME forwardNudge the
      // snapshot plan above was built with, or a candidate typing mid-await
      // would silently lose the forward nudge on this run.
      const coverPlan = linesChanged
        ? planAcceptForEntry(cur, { facts, coverRecord: priorRecord, forwardNudge: forwardPositioning })
        : plan;
      if (linesChanged && coverPlan.cover.edits.length === 0) return current;

      const next = { ...cur };
      next.coverLetterResultLines = coverPlan.cover.lines;
      next.coverLetterPreviewHtml = undefined;
      // N89 Part 1: guarded on strategy === "splice" too -- Shape B has no
      // spliced bytes (spliced is null) and must never write bytes anyway.
      if (!linesChanged && strategy === "splice") next.coverLetterDocxB64 = spliced.docxB64;
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
    // N92 Wave 2 (AC-X1): records under the SAME `fact-position` entry
    // Control A's move uses (design section 5, no second ledger entry) --
    // only when the preference actually moved a fact this run, so forward OFF
    // (or a nudge that had nothing to move into) records nothing. Counts/enums
    // only -- `plan.cover.nudgedCount` is a number, never the fact's own text.
    if (forwardPositioning && plan.cover.nudgedCount > 0) {
      recordDecision("fact-position", "acted", { direction: "forward", reason: "auto-nudge", code: "auto-nudge", count: plan.cover.nudgedCount });
    }
    // N77: `facts.length` is the real count of articles this call found
    // eligible and spliced in -- not a literal -- so a caller that logs it
    // (DocumentPreviewMount.js) reports the actual number inserted, and a
    // one-fact run and a two-fact run are never reported identically.
    return { ok: true, count: facts.length };
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
    moveInsertedFact,
    // N92 Wave 3 (Control B, AC-B8a): persists a confirmed smoothed rewrite
    // via commitSmoothedFact.js -- never imports the smoothing seam itself.
    applySmoothedFact: (jobId, after) =>
      commitSmoothedFact({
        jobId, after, entry: tailoringMap[jobId] || {}, resolveCoverEngineBytes,
        supabase, currentUserId: currentUser?.id, acceptedFactsByJob: acceptedFactsByJob[jobId],
        setTailoringMap, setAcceptedFactsByJob, setPreviewReloadKey,
      }),
    autoInsertFactsForJob,
  };
}
