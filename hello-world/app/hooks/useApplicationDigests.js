"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { listDigests } from "../../lib/supabase/applicationDigests";
import { runWithConcurrency } from "../../lib/tailor/runWithConcurrency";
import { selectAutoDigestTargets, AUTO_DIGEST_CONCURRENCY } from "../../lib/tracking/applicationDigest";
import { readEngine } from "../settings/engine";

// The tracking table's researched "what the posting does not tell you"
// column. Existing digests are read straight from Supabase with the
// browser's own RLS-scoped client (the same client page.js already uses for
// applications/positions/resumes) - a GET round trip through an API route
// would exist only to re-wrap what RLS already grants directly. The route,
// app/api/application-digest, is used for exactly one thing: the grounded
// model call itself, which needs a server-side API key this client never
// sees.
//
// page.js instantiates this hook and passes its three return values down to
// <TrackingTab>; nothing else about the digest pipeline lives in page.js,
// which is already far over this repo's line cap.

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

// One POST to the digest route, shared by the auto fan-out below and the
// manual Research button (TrackingTab's researchOne) - the only difference
// between the two call sites is `force`. See applicationDigest.js's own
// header comment for why a `failed` digest is never retried by the auto
// path, only ever by the button.
async function requestDigest(applicationId, { force = false } = {}) {
  const res = await fetch("/api/application-digest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applicationId, engine: readEngine(), force }),
  });
  const json = await readJson(res);
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json.digest;
}

export function useApplicationDigests(applications) {
  const [digestsById, setDigestsById] = useState({});
  const [researchingIds, setResearchingIds] = useState(() => new Set());
  const [userId, setUserId] = useState(null);
  // The id SET this hook has already fetched-and-auto-fired for. page.js
  // recreates `applications` as a new array on every reload (not on every
  // render), but keying the effect below off array identity would still
  // refire on any re-render that happens to pass a fresh array with the same
  // rows - this ref makes the fetch-then-auto-populate sequence run exactly
  // once per distinct set of row ids, matching AUTO_DIGEST trap #2 in the AC.
  const loadedKeyRef = useRef("");

  const rows = useMemo(() => (Array.isArray(applications) ? applications : []), [applications]);
  const rowsKey = useMemo(
    () => rows.map((r) => r?.id).filter(Boolean).sort().join(","),
    [rows],
  );

  // Who to scope the Supabase read to. Resolved here rather than accepted as
  // a prop because every other piece this hook needs (rows, engine) is
  // already self-contained - adding a currentUser prop just to thread one id
  // through would be one more thing page.js has to remember to pass.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      if (!cancelled) setUserId(data?.user?.id || null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setDigest = useCallback((applicationId, digest) => {
    setDigestsById((prev) => ({ ...prev, [applicationId]: digest }));
  }, []);

  const markResearching = useCallback((applicationId, on) => {
    setResearchingIds((prev) => {
      const has = prev.has(applicationId);
      if (on === has) return prev;
      const next = new Set(prev);
      if (on) next.add(applicationId);
      else next.delete(applicationId);
      return next;
    });
  }, []);

  // Shared by the auto fan-out and the Research button. A network-level
  // throw (offline, a non-2xx the route itself did not turn into a recorded
  // digest) still has to leave the cell showing something actionable rather
  // than snapping back to "no digest" silently - the route's OWN failures
  // arrive as an ordinary 200 with status "failed" (see route.js), this
  // catch only covers failures that never made it that far.
  const runOne = useCallback(
    async (applicationId, { force = false } = {}) => {
      if (!applicationId) return;
      markResearching(applicationId, true);
      try {
        const digest = await requestDigest(applicationId, { force });
        if (digest) setDigest(applicationId, digest);
      } catch (err) {
        setDigest(applicationId, {
          application_id: applicationId,
          status: "failed",
          markdown: "",
          sources: [],
          error: err?.message || "Research failed.",
        });
      } finally {
        markResearching(applicationId, false);
      }
    },
    [markResearching, setDigest],
  );

  const researchOne = useCallback((applicationId) => runOne(applicationId, { force: true }), [runOne]);

  // Fetch what is already stored, then - only once digestsById reflects
  // reality - decide what auto-populates. selectAutoDigestTargets has to see
  // the REAL existing digests to exclude them, so the auto fan-out cannot
  // start until this read resolves.
  useEffect(() => {
    if (!userId || !rowsKey || loadedKeyRef.current === rowsKey) return undefined;
    loadedKeyRef.current = rowsKey;
    let cancelled = false;
    const ids = rowsKey.split(",");

    (async () => {
      const supabase = createClient();
      const { digests } = await listDigests(supabase, userId, ids);
      if (cancelled || !digests) return;
      setDigestsById((prev) => ({ ...prev, ...digests }));

      const targets = selectAutoDigestTargets(rows, digests, { now: new Date() });
      if (targets.length === 0 || cancelled) return;
      await runWithConcurrency(targets, AUTO_DIGEST_CONCURRENCY, (id) => runOne(id, { force: false }));
    })();

    return () => {
      cancelled = true;
    };
    // `rows` and `runOne` are intentionally omitted: this must fire once per
    // distinct rowsKey, never on every re-render that recreates `rows`/
    // `runOne` with the same underlying ids (see useTechWatch.js's `gapKey`
    // for the identical shape and reasoning).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, rowsKey]);

  return { digestsById, researchingIds, researchOne };
}
