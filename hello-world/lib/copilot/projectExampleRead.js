// How the answer route gets Row 1 of the example-projects group onto a `done`
// frame without that ever costing the answer anything: the pool read, its
// deadline, and the derivation of the fragment the response paths spread.
//
// WHY THE READ NEEDS A DEADLINE AND A LATE WAIT. The route reads the pool row on
// every question (a primary-key lookup, deliberately not cached -- see
// getProjectPool in lib/supabase/applicationProjectPool.js, and the pool changes
// mid-session as a cold pool warms). That read used to be awaited BEFORE the
// model call, with nothing bounding it, so a slow or hung database turned an
// example nicety into the whole answer: measured, a pool read that never
// resolved meant the POST never returned and the model was called zero times.
//
// So the read is STARTED early (it overlaps the context fan-out), its WAIT is
// handed to the response paths to settle at the END -- inside the streaming
// producer just before the `done` frame, and just before the JSON body in the
// two non-streaming Gemini branches, exactly as the verified-company-facts wait
// is (lib/copilot/answerCompanyFacts.js) -- and the deadline runs from the
// moment the read STARTS, so a hung read costs at most what is left of this
// budget by the time the answer is ready, and usually nothing.
//
// A read that misses the deadline is reported as a read ERROR, the same shape a
// failed query has, and so reads as `failed` on the card (buildProjectExample's
// poolError arm), never as `pending`: nothing is being prepared on the user's
// behalf, and "still being prepared" for a database that did not answer would
// be a claim about work that is not happening. The read itself keeps running
// after the deadline; nothing cancels it and nothing waits on it.

import { settleWithin } from "./answerSessionCache.js";
import { buildProjectExample, withPoolTags } from "./projectExampleSelect.js";
import { wantsEmbedded } from "@/lib/llm/featureEngine";

// A flagged guess, named so it is tuned from the quality probe rather than
// rewritten as a literal in the route. A healthy primary-key lookup is tens of
// milliseconds, so this is the point past which waiting longer delays the `done`
// frame more than a late example is worth. Not exported: nothing outside this
// module needs the number, and an export whose only reader is a test is one the
// export-reachability ledger (lib/sourceScan/exportReachability.ledger.md) has
// to carry for no benefit.
const POOL_READ_DEADLINE_MS = 1500;

const POOL_READ_TIMEOUT_ERROR = "Timed out reading the project pool.";

// Races `read` (a promise of getProjectPool's `{ pool, error }`) against the
// deadline. Never rejects: a rejection resolves to the timeout shape too.
function boundPoolRead(read, ms = POOL_READ_DEADLINE_MS) {
  return settleWithin(read, ms, { fallback: { pool: null, error: POOL_READ_TIMEOUT_ERROR } });
}

// Starts Row 1 for one request and returns a PROMISE of the fragment to spread
// onto the `done` frame: `{ projectExample }`, or `{}` when this request has
// none. `{}` is deliberate: no application selected, or an embedded engine (an
// invented project has no honest offline equivalent), means the key is OMITTED,
// and that absence is how those surfaces render no example group at all. So the
// two embedded response payloads spread nothing, and the three Gemini ones
// spread this (route.projectExample.test.js counts the sites).
//
//   read()  starts the pool read -- called here, and only when the request wants
//           a Row 1 at all, so a request without one touches no table
//   pick(pool)  is the ROUTE's per-question selection (selectPoolProject over
//           this question). It is passed in rather than imported so the pick
//           stays visibly the route's, made fresh for each question and kept in
//           this request only: never in answerContextCache, never written back
//           to the pool row (the client's question-keyed cache may carry it).
//           Selection is pure, so Row 1 adds no model call.
//
// The status contract is buildProjectExample's (lib/copilot/projectExampleSelect.js):
// a read that ERRORED or timed out is `failed`, a row that is merely not there
// yet is `pending`. withPoolTags adds the owner probe's evidence (the whole
// pool's tags) to a ready or no_match value.
//
// NEVER REJECTS, and that is load-bearing: the promise is awaited inside the
// stream producer and ahead of the JSON bodies, where a throw would tear down an
// answer that is otherwise complete. A derivation failure is a `failed` card,
// not a failed answer.
export function startProjectExampleField({ read, pick, applicationId, engine }) {
  const wanted = !!applicationId && !wantsEmbedded(engine);
  let bounded;
  try {
    bounded = wanted ? boundPoolRead(read()) : Promise.resolve({ pool: null, error: null });
  } catch (err) {
    // A thunk that throws before it returns a promise is a failed read like any other.
    bounded = Promise.resolve({ pool: null, error: err?.message || POOL_READ_TIMEOUT_ERROR });
  }

  const derive = ({ pool, error }) => {
    try {
      if (error) console.warn("copilot answer: could not read the project pool", error);
      const picked = pick(pool);
      const projectExample = buildProjectExample({ pool, poolError: error, pick: picked, applicationId, engine, now: Date.now() });
      return projectExample ? { projectExample: withPoolTags(projectExample, { pool, pick: picked }) } : {};
    } catch (err) {
      console.warn("copilot answer: could not derive the project example", err?.message || err);
      return wanted ? { projectExample: { status: "failed" } } : {};
    }
  };
  return Promise.resolve(bounded).then(derive, (err) => derive({ pool: null, error: err?.message || POOL_READ_TIMEOUT_ERROR }));
}
