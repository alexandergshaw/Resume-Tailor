// The ONLY module that reads/writes public.application_accepted_facts, or
// calls its accept RPC (N35). app/api/accepted-facts/route.js is its only
// caller.

import { PLACEMENTS, DEFAULT_PLACEMENT } from "../document/coverLetterWeave.js";
import { safeExternalHref } from "../url/safeExternalHref.js";

// M4 (verify.r1.md): nothing sanitised what the client stores -- the request
// body's `facts` array went straight into `p_facts`, so any authenticated
// user could write arbitrary JSON into their own row (own-row only, so not a
// privilege issue, but not the shape the app itself relies on either). A
// field whitelist + per-field caps here, ahead of the DB's own byte/array
// caps, so a malformed field degrades to a dropped/clipped value instead of
// a 500 or a stored blob the rest of the app cannot render.
const MAX_FACTS = 5;
const FACT_TEXT_MAX = 600;
const FACT_FIELD_MAX = 300;

function clip(value, max) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function sanitizeFact(raw) {
  if (!raw || typeof raw !== "object") return null;
  const text = clip(String(raw.text ?? "").trim(), FACT_TEXT_MAX);
  if (!text) return null;
  const placement = PLACEMENTS.some((p) => p.id === raw.placement) ? raw.placement : DEFAULT_PLACEMENT;
  return {
    id: raw.id != null ? clip(String(raw.id), FACT_FIELD_MAX) : null,
    text,
    url: safeExternalHref(raw.url) ? String(raw.url) : "",
    title: clip(String(raw.title ?? ""), FACT_FIELD_MAX),
    source: clip(String(raw.source ?? ""), FACT_FIELD_MAX),
    placement,
    textOrigin: clip(String(raw.textOrigin ?? ""), 40),
  };
}

// Keeps the MOST RECENT `MAX_FACTS` -- callers merge prior + new facts
// before this runs (M2), so the newest are the ones worth keeping if the cap
// is ever actually hit.
export function sanitizeStoredFacts(raw) {
  const list = Array.isArray(raw) ? raw.map(sanitizeFact).filter(Boolean) : [];
  return list.length > MAX_FACTS ? list.slice(-MAX_FACTS) : list;
}

async function findOwnedApplication(supabase, userId, jobRef) {
  const { data: position } = await supabase.from("positions").select("id").eq("external_id", jobRef).maybeSingle();
  if (!position) return null;
  const { data: application } = await supabase
    .from("applications")
    .select("id, cover_letter_id")
    .eq("user_id", userId)
    .eq("position_id", position.id)
    .maybeSingle();
  return application || null;
}

// B5 (verify.r1.md): the missing read side of optimistic concurrency. With
// no GET, `baseRevision` lives only in React state and is `null` in every
// fresh session, so the RPC always reads "no row yet" -- when a row DOES
// exist, that loses the insert's `on conflict do nothing` and the accept
// gets a 409 ("Reload and try again") that reloading can never fix, because
// there was nothing that would seed the real revision. This reads the
// current facts/removed/revision so a client CAN seed it.
export async function getFactsForJob(supabase, userId, jobRef) {
  const application = await findOwnedApplication(supabase, userId, jobRef);
  if (!application) return { status: "no-application" };
  const { data } = await supabase
    .from("application_accepted_facts")
    .select("facts, retracted, revision")
    .eq("application_id", application.id)
    .maybeSingle();
  if (!data) return { status: "ok", facts: [], removed: [], revision: null };
  return { status: "ok", facts: data.facts || [], removed: data.retracted || [], revision: data.revision ?? null };
}

// PM3's fix (plan.check.r2): a facts-changing accept on an application that
// HAS a cover letter must carry the letter's new text, or the store and the
// served letter are left disagreeing. `coverVersion` is
// `{lines, insertedFacts}` or null/undefined -- when the application has a
// cover letter and none is supplied, this refuses BEFORE the RPC runs
// (status "cover-required"), so nothing is written.
//
// Exactly one `supabase.rpc(...)` call on the write path, and no other
// statement on it -- the transaction lives entirely inside
// accept_application_facts (20260923030000_application_accepted_facts.sql).
// Never throws: every failure mode is a `status` the caller maps to an HTTP
// response.
export async function acceptFactsForJob(supabase, userId, { jobRef, facts, baseRevision, removed, coverVersion }) {
  const application = await findOwnedApplication(supabase, userId, jobRef);
  if (!application) return { status: "no-application" };

  const hasCoverLetter = !!application.cover_letter_id;
  if (hasCoverLetter && !coverVersion) {
    return { status: "cover-required" };
  }

  const { data, error } = await supabase.rpc("accept_application_facts", {
    p_application_id: application.id,
    p_base_revision: typeof baseRevision === "number" ? baseRevision : null,
    p_facts: sanitizeStoredFacts(facts),
    p_removed: Array.isArray(removed) ? removed : [],
    p_cover_content: coverVersion ? (coverVersion.lines || []).join("\n") : null,
    p_cover_lines: coverVersion ? coverVersion.lines || [] : null,
    p_inserted_facts: coverVersion ? coverVersion.insertedFacts || [] : null,
  });

  if (error) {
    if (error.code === "23514") return { status: "too-large" };
    if (error.code === "23503") return { status: "no-application" };
    if (error.code === "PGRST202" || error.code === "42883") return { status: "unavailable" };
    return { status: "error" };
  }

  return { ...(data || {}), status: data?.status || "ok", versionSaved: !!coverVersion };
}
