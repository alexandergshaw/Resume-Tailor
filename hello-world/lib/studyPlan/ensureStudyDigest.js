// N157 SC-A: the client wrapper over the digest route, and the two named entry
// points of the create-time ordering contract. It issues NO grounded call of
// its own -- it only POSTs the already-grounded /api/application-digest route
// (an Interactions-API call, wire-tested in
// app/api/application-digest/route.wire.test.js). N157 adds no transport.
//
//   ensureStudyDigest   force:false -- the CREATE path. The route returns a
//                       ready digest as-is (no spend) and researches only a
//                       missing or failed one.
//   refreshStudyDigest  force:true  -- the manual "Refresh research" path, the
//                       ONLY call that spends a fresh grounded search.
//
// The two are the same request apart from `force`, and getting that flag wrong
// is silent: a stray force:true on the create path just double-bills every
// create and looks identical to the user. Hence two named functions rather than
// one call site that must remember to pass the right boolean.
//
// This mirrors the tracking table's requestDigest (app/hooks/
// useApplicationDigests.js) deliberately as a separate copy: that file is a
// "use client" React hook module, and importing it here would drag the
// tracking tab into the study-plan feature's blast radius.

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

/**
 * One POST to the digest route. Resolves to the route's `digest`; throws the
 * server's error message (or a status-bearing fallback) on a non-ok response.
 * `force` defaults to false so the create path can never double-bill.
 *
 * @param {{ applicationId: string, engine: string, force?: boolean }} args
 */
export async function requestStudyDigest({ applicationId, engine, force = false } = {}) {
  const res = await fetch("/api/application-digest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applicationId, engine, force }),
  });
  const json = await readJson(res);
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json.digest;
}

/** Create-time "ensure research": reuse a ready digest, research only if missing. */
export function ensureStudyDigest(args) {
  return requestStudyDigest({ ...args, force: false });
}

/** Manual "Refresh research": the only path that spends a fresh grounded call. */
export function refreshStudyDigest(args) {
  return requestStudyDigest({ ...args, force: true });
}
