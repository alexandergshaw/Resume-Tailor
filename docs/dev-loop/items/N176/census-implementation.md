# N176 measured adoption-census integration amendment

Author /root/prep_tests; new measured caller/census obligation, not a new source semantic review round. Authorized deadline20:10Z unchanged. Read actual original adoption.test.js SHA256CA6910B7206F5B7B4B70398F471A8CE4312101D2298B9582FF50A49193086DFC and new route's actual auth/limiter/denial helper. No tests/gates/processes/provider calls, original source writes or launcher edits.

Proposed sole write/import path: hello-world/lib/rateLimit/adoption.test.js. Excluded proposed bytes: corrected/candidate/hello-world/lib/rateLimit/adoption.test.js SHA2565530F6901D6E9ED6786C0AFA6B6C77489CB0BE342860AFDD0D18120BD1010FEF.

The new model-calling route already constructs module-scope createRateLimiter({limit:6,windowMs:600000}), authenticates via getAuth before identify/check and returns helper-built429 with rateLimitHeaders(decision). Missing BOUNDED census registration causes the full gate to fail. This proposal adds exactly that6/600000 route with reason/disclosed per-instance limitation. It does NOT defer/exempt it, change the route, increase limits or weaken transitive census, limiter construction/import/numeric checks.

Existing generic denial-shape assertions require inline status:429 and headers:rateLimitHeaders; this route uses a shared response(status,...,headers) wrapper. Rather than modify independently reviewed route solely for source-text style, exact route-only test branch verifies the actual denial call passes429 plus rateLimitHeaders(decision), AND verifies actual helper forwards status/headers into Response.json without losing them. Other routes retain existing exact denial assertions. New explicit tests require bounded/nondeferred membership, real model reach, and getAuth→401 refusal→limiter attribution ordering with no getSession. Formerly-unauthenticated GATED cohort is unchanged; this new route is born authenticated.

Independent checker must inspect proposed diff and actual route/helper fidelity before root imports it. Actual focused census/full gates remain pending; no pass claimed. Six existing route behavioral/auth/denial controls and all original classifier/protection paths remain intact. No rate-limit implementation or test allowance is changed.

## Read-only launcher readiness diagnostic

Original scripts/regression/launcher.test.js SHA2566555F516B52D465E4DA0811E5088465ED3395664832F219DB29105FEE35DCD47, timeout-kill fixture lines391/398/400: child writes grand.pid with writeFileSync; parent waits only existsSync, then Number(readFileSync(...)). File creation precedes write completion across processes, so a parent observation in that interval sees empty text and Number('') becomes0. Existence therefore does not establish a valid published PID. This mechanism is established by code/Node file semantics, not a newly executed race reproduction. It is independent of whether the actual launcher killed its descendants.

Proposed precise oracle-preserving fix (NOT written): keep same30000ms readiness bound and all before/after process-tree/token/timeout assertions. Replace existence-only predicate with a predicate that reads the file, treats ENOENT or empty/incomplete PID text as not ready, requires /^[1-9][0-9]*$/ plus safe positive integer, then captures grandPid from those same validated bytes. Reuse captured value, avoiding a second unvalidated read. Unexpected filesystem errors still throw; do not accept0, length-only readiness, timeout-as-success or skip survivor checks. Optionally fixture writer can publish temp+rename atomically after separately admitted review, but the bounded validated-read predicate alone fixes this exact race without changing launcher production, runbook copies, timeouts or kill semantics.

Suggested shape:

    let grandPid = 0;
    await waitFor(() => {
      let value;
      try { value = readFileSync(grandPidPath, 'utf8').trim(); }
      catch (error) { if (error.code === 'ENOENT') return false; throw error; }
      if (!/^[1-9][0-9]*$/.test(value)) return false;
      const candidate = Number(value);
      if (!Number.isSafeInteger(candidate) || candidate <= 0) return false;
      grandPid = candidate;
      return true;
    }, 30000);

Census proposal requires independent check; launcher change requires separate exact path admission before any edit/execution. Original files unchanged by this assignment.
