// The client half of the tech-buzzwords row, shared by live mode's
// useDraftAnswer and practice mode's useSampleAnswer / useRoomQuestions so the
// producers cannot drift. Mirrors projectExampleLive.js in shape: no React
// import and no fetch of its own -- the request function and the state writer
// are handed in, which keeps this testable in the node environment and lets each
// hook keep its own staleness guard (live mode's id + draft token, practice
// mode's generation counter) around the write.
//
// THE ROW IS ADDITIVE AND CAN FAIL ALONE. It never blocks the answer that
// triggered it: the caller fires it after the answer has already landed and does
// not await it. Whatever goes wrong (a rejected request, a timeout, a payload
// that is not a usable list) ends in { status: "failed" } on the card, never a
// rejected promise and never a thrown error into the draft path.
//
// THE WATCHDOG. The server bounds the generation call, but a dropped connection
// can leave the browser waiting on a request that will never answer, and a card
// stuck on "Finding terms" forever is a lie about work that is not happening.
// After TECH_TERMS_PENDING_MAX_MS the pending state is forced to failed and the
// request is aborted.
//
// THE WATCHDOG MUST OUTLAST THE SERVER. The route's model call is bounded by
// TECH_TERMS_GEN_TIMEOUT_MS (20 s, lib/copilot/techTermsGen.js) with the
// application read ahead of it and the round trip around it. A watchdog shorter
// than that aborts a request the server was about to answer and paints "failed"
// over a ready row. So this is the server's budget plus a margin for the read
// and the network, never less; techTermsLive.test.js pins the inequality against
// the server constant. The server constant is deliberately NOT imported here:
// that module is server-only and this one ships to the browser. A flagged guess
// for the margin, named and exported so it is tuned from the quality probe
// instead of being rewritten as a literal in a hook.

export const TECH_TERMS_PENDING_MAX_MS = 30_000;

const FAILED = { status: "failed" };

// The sub-route's body -> the value stored as `techTerms`.
//   { techTerms: null } ......... undefined (the embedded engine: render nothing)
//   a ready, non-empty list ..... { status: "ready", terms }
//   anything else ............... { status: "failed" }
export function normalizeTechTermsResult(body) {
  const result = body?.techTerms;
  if (result === null) return undefined;
  if (result && result.status === "ready" && Array.isArray(result.terms)) {
    const terms = result.terms.filter((t) => typeof t === "string" && t.trim() !== "");
    if (terms.length > 0) return { status: "ready", terms };
  }
  return FAILED;
}

// Starts the row for one answer. Returns false and does nothing when it does not
// apply (no application selected, or the embedded engine, which has no honest
// offline equivalent of a model-chosen vocabulary list); returns true once it
// has begun.
//
//   fetchTerms({ applicationId, question, signal }) -> Promise<{ techTerms }>
//   apply(value, settled) is how the caller writes the result. It is called
//     first with { status: "pending" } and settled = false, then exactly once
//     more with the final value and settled = true. `value` is undefined for
//     "nothing to show". The caller owns the staleness guard around the write.
export function startTechTerms({
  applicationId,
  question,
  engine,
  fetchTerms,
  apply,
  timeoutMs = TECH_TERMS_PENDING_MAX_MS,
}) {
  if (!applicationId || engine === "embedded") return false;
  if (typeof fetchTerms !== "function" || typeof apply !== "function") return false;

  // A caller's apply() throwing (a setState after the card unmounted, say) must
  // not reach the draft path, and must not become an uncaught error when the
  // watchdog's timer is the one that called it.
  const write = (value, settledNow) => {
    try {
      apply(value, settledNow);
    } catch {
      // The card already has whatever it was last given.
    }
  };

  write({ status: "pending" }, false);

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let settled = false;
  let timer = null;
  const finish = (value) => {
    if (settled) return;
    settled = true;
    if (timer !== null) clearTimeout(timer);
    write(value, true);
  };

  timer = setTimeout(() => {
    finish(FAILED);
    controller?.abort();
  }, timeoutMs);

  let call;
  try {
    call = Promise.resolve(fetchTerms({ applicationId, question, signal: controller?.signal }));
  } catch (err) {
    call = Promise.reject(err);
  }
  call.then(
    (body) => finish(normalizeTechTermsResult(body)),
    () => finish(FAILED),
  );
  return true;
}
