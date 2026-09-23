// Accept (or retract) company facts for one application (N35). GET reads the
// current facts/removed/revision back (B5, verify.r1.md -- without it,
// `baseRevision` was always null in a fresh session, so "Reload and try
// again" never actually helped); PUT accepts.
//
// The route stays thin on purpose: parse the request, defer to
// lib/acceptedFacts/factStore.js's ONE `accept_application_facts` RPC call
// for every write, and map its status onto an HTTP response. PM3
// (plan.check.r2): a facts-changing PUT that would leave a cover-letter-
// bearing application with no updated letter text is refused before the
// RPC runs, so a 200 can never mean "the facts moved but the served letter
// didn't" -- `versionSaved` states which of the two happened, truthfully,
// on every success.

import { getAuth, unauthorized, badRequest } from "@/lib/experience/apiAuth.js";
import { acceptFactsForJob, getFactsForJob } from "@/lib/acceptedFacts/factStore.js";

const STATUS_TO_HTTP = {
  conflict: 409,
  "no-application": 404,
  "too-large": 400,
  unavailable: 503,
  error: 500,
};
const STATUS_MESSAGE = {
  conflict: "Someone else changed these facts first. Reload and try again.",
  "no-application": "Couldn't find that application.",
  "too-large": "That's too much to save at once.",
  unavailable: "Accepting facts isn't available right now. Try again shortly.",
  error: "Couldn't save the accepted facts. Try again.",
};

export async function GET(request) {
  const { supabase, userId } = await getAuth();
  if (!userId) return unauthorized();

  const jobRef = new URL(request.url).searchParams.get("jobRef") || "";
  if (!jobRef) return badRequest("jobRef is required.");

  const result = await getFactsForJob(supabase, userId, jobRef);
  if (result.status !== "ok") {
    const status = STATUS_TO_HTTP[result.status] || 500;
    return Response.json({ error: STATUS_MESSAGE[result.status] || STATUS_MESSAGE.error }, { status });
  }
  return Response.json({ facts: result.facts, removed: result.removed, revision: result.revision }, { status: 200 });
}

export async function PUT(request) {
  const { supabase, userId } = await getAuth();
  if (!userId) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("The request body isn't valid JSON.");
  }

  const jobRef = typeof body?.jobRef === "string" ? body.jobRef : "";
  if (!jobRef) return badRequest("jobRef is required.");

  const coverVersion =
    body?.coverVersion && Array.isArray(body.coverVersion.lines) ? body.coverVersion : null;

  const result = await acceptFactsForJob(supabase, userId, {
    jobRef,
    facts: body?.facts,
    baseRevision: body?.baseRevision,
    removed: body?.declinedUrls,
    coverVersion,
  });

  if (result.status === "cover-required") {
    // M6 (verify.r1.md): the old wording ("...must include the updated
    // cover letter text") describes the API's own contract, not something a
    // candidate can act on. Reworded to name the actual remedy: the client
    // has no local copy of the letter to send, so open it in the preview
    // (which loads one) and try again.
    return badRequest("Open the cover letter in the preview, then try accepting these facts again.");
  }
  if (result.status !== "ok") {
    const status = STATUS_TO_HTTP[result.status] || 500;
    const body = { error: STATUS_MESSAGE[result.status] || STATUS_MESSAGE.error };
    if (result.status === "conflict") {
      body.revision = result.revision ?? null;
      body.facts = result.facts || [];
      body.removed = result.removed || [];
    }
    return Response.json(body, { status });
  }

  return Response.json(
    {
      facts: result.facts || [],
      removed: result.removed || [],
      revision: result.revision ?? null,
      versionSaved: !!result.versionSaved,
      previousFacts: result.previousFacts || [],
    },
    { status: 200 },
  );
}
