"use client";

import { useCallback, useRef, useState } from "react";
import { readEngine } from "@/app/settings/engine";
import { companyBriefRequest, normalizeBriefArticles } from "@/lib/copilot/companyBrief";

// AC-T2.5..T2.9. Data layer behind the live-interview "company" voice cue
// (T2 in Group T): the candidate says "pull up the company" (or presses the
// sidebar button, T3) and app/copilot/CompanyBriefPanel.js shows a short
// research brief for the SELECTED posting. This hook owns exactly three
// things — WHETHER a request goes out, WHEN, and which one's result is
// allowed to land — and delegates every bit of SHAPING to
// lib/copilot/companyBrief.js (companyBriefRequest for the request body,
// normalizeBriefArticles for the response). It deliberately does NOT
// restate either of those, does NOT touch the DOM, and does NOT render
// anything — see app/copilot/CompanyBriefPanel.js (T2-3) for presentation.
//
// AC-T2.6, and this is the whole point of the file: a company brief costs a
// real network call (a Gemini google-search grounded generation, or the
// embedded engine's own web fetches), so it must never fire on mount, never
// on a posting change, never when a live session starts — only when the
// candidate actually asks for it via openBrief()/refresh(). This codebase
// has already paid for the "an effect fires a network call the user never
// asked for" defect once before (AC-I4, on a feature since removed); this
// hook exists so it cannot recur here by construction: there is deliberately
// no useEffect in this file. Nothing runs a fetch except the two callbacks
// openBrief and refresh.

// `forId` is the posting id `status`/`articles`/etc. actually belong to —
// null until a fetch has ever been kicked off. Carrying it INSIDE state
// (rather than in a ref compared during render) is the same trick
// useApplicationDocs.js's `resolveDocs` uses for its own `forId`: this
// repo's lint config forbids reading `ref.current` during render
// (react-hooks/refs), so "does this result still belong to the posting
// on screen" has to be answered by comparing two pieces of STATE/props,
// never a ref.
const INITIAL_STATE = { forId: null, status: "idle", articles: [], warnings: [], error: "", company: "" };

export function useCompanyBrief(posting) {
  const [state, setState] = useState(INITIAL_STATE);
  const [open, setOpen] = useState(false);
  // AC-T2.9: the generation guard, the same discipline draftGenRef already
  // uses in useLiveSession.js and genRef uses in useApplicationDocs.js. A
  // brief takes long enough (a live model call with search, or the embedded
  // engine's own page fetches) that the candidate can plausibly trigger a
  // second one — refresh(), or moving to a different posting and asking
  // again — before the first has resolved. Read only from inside runFetch's
  // own callbacks (after each await), never during render, so this never
  // trips react-hooks/refs either.
  const genRef = useRef(0);

  const postingId = posting?.id ?? null;
  // AC-T2.7: whether `state` was built for the posting currently on screen.
  // A plain comparison of two values already available at render time (a
  // ref read happens nowhere here) — not an effect, so nothing needs to
  // "notice" a posting change and reset anything; the stale result simply
  // stops being reported the very next render, for free.
  const belongsToCurrentPosting = state.forId === postingId;
  const effective = belongsToCurrentPosting ? state : INITIAL_STATE;

  const runFetch = useCallback(async (currentPosting) => {
    const gen = (genRef.current += 1);
    const id = currentPosting?.id ?? null;

    // AC-T2.1/AC-T2.8: the ONLY source of the request body. Built from
    // companyBriefRequest's return value alone — never by spreading
    // `currentPosting` into the fetch body.
    //
    // Why that matters enough to call out twice: normalizePostingRows (lib/
    // copilot/postings.js) puts a `url` field on every posting — the JOB
    // ADVERT'S OWN URL, not a news article about the company. The route
    // (app/api/company-research/route.js:275) branches on `if (url)` into
    // "custom-URL mode", where it fetches and summarizes THAT url instead
    // of researching the company by name. Spread the posting in and this
    // hook would silently ask the route to re-summarize the job ad the
    // candidate already read, under the label "company brief" — every
    // existing test (shape, status codes, article normalization) would
    // stay green, because nothing in those tests checks WHICH resource was
    // fetched. So: only the three fields companyBriefRequest names, plus
    // engine, ever reach the body. Do not "simplify" this back to a spread.
    const requestFields = companyBriefRequest(currentPosting);
    if (!requestFields) {
      // No posting, or a posting with no company on file: nothing to
      // research. openBrief/refresh still open the panel so the candidate
      // can see why nothing happened; there is simply no request to make
      // and no loading state to show for one that was never sent.
      setState({ ...INITIAL_STATE, forId: id });
      return;
    }

    setState({ forId: id, status: "loading", articles: [], warnings: [], error: "", company: requestFields.company });

    let res;
    try {
      res = await fetch("/api/company-research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...requestFields, engine: readEngine() }),
      });
    } catch (err) {
      // AC-T2.8: a rejected fetch (offline, DNS failure, ...) surfaces its
      // own message rather than throwing into the caller.
      if (genRef.current !== gen) return; // AC-T2.9: superseded, ignore.
      setState({
        forId: id,
        status: "error",
        articles: [],
        warnings: [],
        error: err?.message || "Company research failed.",
        company: requestFields.company,
      });
      return;
    }

    // AC-T2.8: whatever the body turns out to be (JSON or not — a proxy
    // error page, an empty 500, ...), this never throws past here.
    const data = await res.json().catch(() => ({}));

    if (genRef.current !== gen) return; // AC-T2.9: superseded, ignore.

    if (!res.ok) {
      // AC-T2.8: the 503 (Gemini key not configured) and every other
      // non-OK status share one path — both carry the real reason in
      // `data.error`. The fallback text only shows up for the (route
      // never actually does this) case of a non-OK response with no body.
      setState({
        forId: id,
        status: "error",
        articles: [],
        warnings: [],
        error: data?.error || "Company research failed.",
        company: requestFields.company,
      });
      return;
    }

    setState({
      forId: id,
      status: "done",
      // AC-T2.2/T2.5: run the route's raw payload through the shared
      // normalizer — never hand it to the render layer untouched.
      articles: normalizeBriefArticles(data?.articles),
      warnings: Array.isArray(data?.warnings) ? data.warnings : [],
      error: "",
      company: requestFields.company,
    });
  }, []);

  // AC-T2.6: fires only from a click/voice-cue handler, never on mount or
  // posting change (there is no effect in this file to do so).
  //
  // AC-T2.7: a result already loaded ("done") for the CURRENT posting is
  // shown again with no second request — `effective` above already
  // resolves to INITIAL_STATE the moment the posting no longer matches, so
  // "idle" here covers both "never asked" and "posting just changed". An
  // "error" is deliberately NOT sticky: opening again after a failure is
  // this hook's only retry path (there is no separate `retry`), so it must
  // re-fetch, not keep repeating the same failure forever.
  const openBrief = useCallback(() => {
    setOpen(true);
    if (effective.status === "idle" || effective.status === "error") {
      runFetch(posting);
    }
  }, [effective.status, posting, runFetch]);

  // AC-T2.7: always issues a new request, regardless of what is currently
  // loaded or in flight.
  const refresh = useCallback(() => {
    setOpen(true);
    runFetch(posting);
  }, [posting, runFetch]);

  const closeBrief = useCallback(() => {
    setOpen(false);
  }, []);

  return {
    status: effective.status,
    articles: effective.articles,
    warnings: effective.warnings,
    error: effective.error,
    company: effective.company,
    open,
    openBrief,
    closeBrief,
    refresh,
  };
}
