// The client half of the example-projects group, shared by live mode's
// useDraftAnswer and practice mode's useSampleAnswer so the two cannot drift:
// the Row 2 fire (an invented project written for the question just answered),
// and the rule for which Row 1 value a REUSED answer may carry forward.
// No React import and no fetch of its own: the request function and the state
// writer are handed in, which is what keeps this testable in the node
// environment and lets each hook keep its own staleness guard (live mode's
// id + draft token, practice mode's generation counter) around the write.
//
// ROW 2 IS ADDITIVE AND CAN FAIL ALONE. It never blocks the answer that
// triggered it: the caller fires it after the answer has already landed and
// does not await it. Whatever goes wrong (a rejected request, a timeout, a
// payload that is not a usable example) ends in { status: "failed" } on the
// card, never a rejected promise and never a thrown error into the draft path.
//
// THE WATCHDOG. The server bounds Row 2's model call, but a dropped connection
// can leave the browser waiting on a request that will never answer, and a card
// stuck on "Writing one for this question" forever is a lie about work that is
// not happening. After ROW2_PENDING_MAX_MS the pending state is forced to
// failed and the request is aborted.
//
// THE WATCHDOG MUST OUTLAST THE SERVER. The route's model call is bounded by
// ON_THE_SPOT_TIMEOUT_MS (30 s, lib/copilot/projectExampleGen.js) with the
// application read ahead of it and the round trip around it, and the owner
// removed the cap on Row 2 precisely so a slow success lands. A watchdog shorter
// than that (it was 20 s) aborted a request the server was about to answer and
// painted "Couldn't write one this time" over a project that was seconds away.
// So this is the server's budget plus a margin for the reads and the network,
// never less; projectExampleLive.watchdog.test.js pins the inequality against the
// server constant. A flagged guess for the margin, named and exported so it is
// tuned from the quality probe instead of being rewritten as a literal in a hook.

export const ROW2_PENDING_MAX_MS = 40_000;

const FAILED = { status: "failed" };

// Whether a ready entry is shaped like one. Mirrors the render guard in
// AnswerAids: a title and at least one bullet, every bullet a string. Anything
// less is a failed Row 2, because showing a half-built example is worse than
// saying the model could not write one.
function isUsableEntry(entry) {
  return (
    !!entry &&
    typeof entry.title === "string" &&
    entry.title.trim() !== "" &&
    Array.isArray(entry.bullets) &&
    entry.bullets.length > 0 &&
    entry.bullets.every((b) => typeof b === "string" && b.trim() !== "")
  );
}

// The sub-route's body -> the value stored as `projectExampleLive`.
//   { projectExample: null } ..... undefined (the embedded engine: render nothing)
//   a usable ready entry ......... that entry
//   anything else ................ { status: "failed" }
export function normalizeLiveResult(body) {
  const example = body?.projectExample;
  if (example === null) return undefined;
  if (example && example.status === "ready" && isUsableEntry(example)) return example;
  return FAILED;
}

// Row 1 as it arrives on the answer response: kept only if it is shaped like a
// status value, otherwise undefined. Absent stays absent and is NOT defaulted --
// the server omits the field for "no application selected" and for the embedded
// engine, and absence is how a card renders no example group at all; defaulting
// it to "pending" would tell those users an example is forever being prepared.
export function projectExampleFromResponse(projectExample) {
  return projectExample && typeof projectExample.status === "string" ? projectExample : undefined;
}

// Which Row 1 value a REUSED answer carries. A reused answer makes no server
// call, so there is no fresh pool read to replace the value it was cached with,
// and replaying a non-final state would put a stale line on a card whose pool
// has long since changed: "Still being prepared" for a pool that is ready, or
// "Couldn't prepare" for one that has been retried. A ready or no_match value
// is a statement about this question and is safe to replay; a pending or failed
// one is dropped (nothing renders) rather than replayed.
export function finalProjectExample(projectExample) {
  const status = projectExample?.status;
  return status === "ready" || status === "no_match" ? projectExample : undefined;
}

// Starts Row 2 for one answer. Returns false and does nothing when Row 2 does
// not apply (no application selected, or the embedded engine, which has no
// honest offline equivalent of an invented project); returns true once it has
// begun.
//
//   fetchLive({ applicationId, question, signal }) -> Promise<{ projectExample }>
//   apply(value, settled) is how the caller writes the result. It is called
//     first with { status: "pending" } and settled = false, then exactly once
//     more with the final value and settled = true. `value` is undefined for
//     "nothing to show". The caller owns the staleness guard around the write.
export function startProjectExampleLive({
  applicationId,
  question,
  engine,
  fetchLive,
  apply,
  timeoutMs = ROW2_PENDING_MAX_MS,
}) {
  if (!applicationId || engine === "embedded") return false;
  if (typeof fetchLive !== "function" || typeof apply !== "function") return false;

  apply({ status: "pending" }, false);

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let settled = false;
  let timer = null;
  const finish = (value) => {
    if (settled) return;
    settled = true;
    if (timer !== null) clearTimeout(timer);
    apply(value, true);
  };

  timer = setTimeout(() => {
    finish(FAILED);
    controller?.abort();
  }, timeoutMs);

  let call;
  try {
    call = Promise.resolve(fetchLive({ applicationId, question, signal: controller?.signal }));
  } catch (err) {
    call = Promise.reject(err);
  }
  call
    .then(
      (body) => finish(normalizeLiveResult(body)),
      () => finish(FAILED),
    )
    .catch(() => {
      // A caller's apply() throwing must not become an unhandled rejection: the
      // card already has whatever it was last given, and this runs after the
      // answer it belongs to has been delivered.
    });
  return true;
}
