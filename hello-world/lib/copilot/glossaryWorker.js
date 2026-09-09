// THE CRON WORKER. Phase 2 -- the grounded research pass -- runs here and
// nowhere else: `client.interactions.create` appears in exactly one place in
// this feature and it is reachable only from `/api/cron/position-glossary`.
//
// ---------------------------------------------------------------------------
// WHY A WORKER AT ALL
// ---------------------------------------------------------------------------
// One research batch's worst case is about 92 seconds (45 s timeout + backoff +
// 45 s retry -- the figure the digest route derives for the same call shape).
// Ten of them do not fit one serverless invocation at ANY `maxDuration` this
// platform offers. A design that made ten calls from one request could never
// finish, so `status: 'ready'` -- defined as `recalled_count = 0` and enforced by
// a database CHECK -- was ARITHMETICALLY UNREACHABLE while every gate and every
// panel line reasoned about it.
//
// `after()` does not solve this and was checked rather than assumed: it hands a
// thenable to the platform's `waitUntil`, so the work still runs inside the
// invocation's lifetime. It defers work PAST THE RESPONSE, which is a latency
// tool, not a compute-budget tool.
//
// THE THREE THINGS THAT MAKE `ready` REACHABLE:
//   1. The cursor is durable and the worker resumes from it, so no invocation
//      has to finish the job.
//   2. A CONTINUATION IS NOT A RETRY. The 24-hour gate governs starting a NEW
//      generation; carrying on with one already in flight is gated only by the
//      cursor, the lease and the call caps. Conflating them is what made a row
//      wait a day for its next 120-second slice.
//   3. The research floor is evaluated ONLY when the cursor is exhausted. A row
//      at 3 of 10 batches is `partial` IN FLIGHT, not `partial` and settled.
//
// ---------------------------------------------------------------------------
// THE BATCHING INVARIANT
// ---------------------------------------------------------------------------
// Within one generation, the first `research_total * RESEARCH_BATCH_SIZE`
// positions of `terms` ARE the generation's work list, ordered so that the terms
// needing research come first. Research upgrades IN PLACE, so positions never
// move while a generation runs and batch `i` is always `terms[i*12 .. i*12+12)`.
// That is what makes the cursor meaningful across invocations -- slicing a
// filtered "still recalled" list instead would silently skip a term every time a
// batch succeeded.
//
// Because upgrades are in place, `researched_count` is MONOTONE BY CONSTRUCTION
// within a fingerprint: a continuation can never lower it.
//
// ---------------------------------------------------------------------------
// EVERY MODEL CALL IS COUNTED BEFORE IT IS MADE
// ---------------------------------------------------------------------------
// Both counters increment on the ATTEMPT, not on success. A call that throws
// still cost money, and a counter that only counted successes would let a
// failing transport spend without bound.

import {
  RESEARCH_BATCH_SIZE,
  RESEARCH_TIMEOUT_MS,
  RESEARCH_MAX_RETRIES,
  BATCH_WORST_CASE_MS,
  INVOCATION_BUDGET_MS,
  INVOCATION_RESERVE_MS,
  MAX_POSTINGS_PER_RUN,
  MAX_BATCH_RETRIES_PER_GENERATION,
  MAX_LIFETIME_MODEL_CALLS,
  MAX_ABSOLUTE_MODEL_CALLS,
} from "./glossaryConstants.js";
import { RESEARCH_SYSTEM_PROMPT, buildResearchPrompt } from "./glossaryPrompt.js";
import { joinResearchBatch } from "./glossaryResearch.js";
import { definitionRejection } from "./glossaryTerms.js";
import { computeStatus } from "./glossaryStore.js";

/** Batch `index` of a generation's work list. See THE BATCHING INVARIANT above. */
export function batchOf(row, index) {
  const terms = Array.isArray(row?.terms) ? row.terms : [];
  return terms.slice(index * RESEARCH_BATCH_SIZE, (index + 1) * RESEARCH_BATCH_SIZE);
}

function addUsage(totals, usage) {
  // A ZERO THAT MEANS "WE COULD NOT MEASURE" AND A ZERO THAT MEANS "NOTHING WAS
  // SPENT" MUST NOT BE THE SAME VALUE. A missing usage object leaves the field
  // null; only an observed number ever turns it into a number.
  const out = { ...totals };
  for (const key of [
    "total_input_tokens",
    "total_output_tokens",
    "total_thought_tokens",
    "grounding_tool_count",
  ]) {
    const value = usage?.[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    out[key] = (out[key] ?? 0) + value;
  }
  return out;
}

const EMPTY_USAGE = Object.freeze({
  total_input_tokens: null,
  total_output_tokens: null,
  total_thought_tokens: null,
  grounding_tool_count: null,
});

function mergeReasons(into, from) {
  const out = { ...into };
  for (const [key, value] of Object.entries(from || {})) out[key] = (out[key] || 0) + value;
  return out;
}

/**
 * Runs batches for ONE leased row until the deadline, the cursor, a call cap or
 * an upstream stop signal ends the loop. Writes after EVERY batch, so a worker
 * the platform kills after batch six leaves six batches of paid work durably
 * stored and the next invocation starts at six.
 */
export async function researchRowToDeadline({
  row,
  store,
  client,
  model,
  clock,
  deadlineAt,
  maxBatches = Infinity,
  onCall,
}) {
  const state = {
    terms: Array.isArray(row.terms) ? row.terms.map((t) => ({ ...t })) : [],
    cursor: row.research_cursor || 0,
    total: row.research_total || 0,
    batches: row.research_batches || 0,
    unsearched: row.unsearched_batches || 0,
    malformed: row.malformed_batches || 0,
    callsFingerprint: row.model_calls_fingerprint || 0,
    callsTotal: row.model_calls_total || 0,
    refusals: { ...(row.refusal_reasons || {}) },
    usage: { ...EMPTY_USAGE, ...(row.usage_totals || {}) },
    stageCounts: row.stage_counts || null,
    truncatedReason: row.truncated_reason || null,
    reason: null,
    stopped: null,
  };

  let retriesLeft = MAX_BATCH_RETRIES_PER_GENERATION;
  let ranHere = 0;

  while (state.cursor < state.total && ranHere < maxBatches) {
    // The deadline, not a count, bounds the invocation. A batch that returns in
    // twelve seconds lets the loop keep going; the worst case is what this
    // guards against.
    if (clock() + BATCH_WORST_CASE_MS > deadlineAt) break;
    // The caps are checked BEFORE the call, so the attempt that would exceed one
    // is never made. The database CHECKs are the backstop under this, not the
    // mechanism.
    if (state.callsFingerprint >= MAX_LIFETIME_MODEL_CALLS) break;
    if (state.callsTotal >= MAX_ABSOLUTE_MODEL_CALLS) break;

    const batch = batchOf(state, state.cursor);
    if (batch.length === 0) {
      state.cursor = state.total;
      break;
    }

    const outcome = await runOneBatch({ batch, client, model, state, onCall });
    ranHere += 1;
    state.batches += 1;

    if (outcome.stop) {
      // The one upstream signal that means STOP rather than TRY AGAIN. Burning
      // an attempt on it would convert a quota event into a permanent row
      // failure, so the cursor does not advance and the row keeps its place in
      // the queue.
      state.reason = outcome.stop;
      state.stopped = outcome.stop;
      await writeProgress({ row, store, state });
      break;
    }

    // A MECHANISM FAILURE IS RETRYABLE; A SOURCING FAILURE IS NOT. A batch that
    // did not search means the tools payload did not reach the wire, or Google
    // returned no search step -- retryable, and the criterion that catches a
    // tools-nesting regression after the wire test stops running. A batch that
    // searched and found nothing to cite is a SOURCING outcome; retrying it
    // spends money to learn the same thing.
    if (outcome.unsearched && retriesLeft > 0 && !outcome.retried) {
      retriesLeft -= 1;
      const second = await runOneBatch({ batch, client, model, state, onCall, retried: true });
      ranHere += 1;
      state.batches += 1;
      applyBatch({ state, batch, outcome: second });
      if (second.unsearched) state.unsearched += 1;
    } else {
      applyBatch({ state, batch, outcome });
      if (outcome.unsearched) state.unsearched += 1;
    }

    state.cursor += 1;
    await writeProgress({ row, store, state });
  }

  return state;
}

async function runOneBatch({ batch, client, model, state, onCall, retried = false }) {
  // Counted BEFORE the call: an attempt that throws still cost money.
  state.callsFingerprint += 1;
  state.callsTotal += 1;

  let interaction = null;
  try {
    interaction = await client.interactions.create(
      {
        model,
        // `input`, not `contents`. `system_instruction` and `tools` are TOP
        // LEVEL, and `tools` carries a `type` discriminant. This is the OPPOSITE
        // of the rule governing every `models.generateContent` call site in this
        // repo, and both rules are live here at the same time. Nesting `tools`
        // in a `config` object would be silently DROPPED by the SDK's parameter
        // transformer -- no error, no warning, no search, no citations, every
        // term falling back to `recalled`, and a full grounded bill anyway. Only
        // the wire test can see that, which is why one exists beside this route.
        system_instruction: RESEARCH_SYSTEM_PROMPT,
        input: buildResearchPrompt(batch),
        tools: [{ type: "google_search" }],
      },
      // PER CALL, never on the client: `getGeminiClient` memoises a module
      // singleton whose next-gen transport is memoised on it, so a client-level
      // option would reach seven other features. And `maxRetries` counts
      // RETRIES, not attempts -- 1 means two attempts.
      { timeout: RESEARCH_TIMEOUT_MS, maxRetries: RESEARCH_MAX_RETRIES },
    );
  } catch (error) {
    return { threw: true, error, unsearched: false, retried, join: null, usage: null };
  } finally {
    if (typeof onCall === "function") onCall();
  }

  if (interaction?.status === "budget_exceeded") {
    return { stop: "budget-exceeded", retried, join: null, usage: interaction?.usage || null };
  }

  // THE PER-BATCH TRY. A vendor shape surprise must mark this batch's terms
  // recalled and advance the cursor, never throw out of the loop and discard
  // work already paid for.
  let join = null;
  try {
    join = joinResearchBatch(interaction, { batchSize: batch.length });
  } catch {
    return {
      threw: true,
      malformed: true,
      unsearched: false,
      retried,
      join: null,
      usage: interaction?.usage || null,
    };
  }

  return {
    threw: false,
    unsearched: join.searched === false,
    retried,
    join,
    usage: interaction?.usage || null,
  };
}

function applyBatch({ state, batch, outcome }) {
  state.usage = addUsage(state.usage, outcome.usage);

  if (outcome.malformed || (outcome.threw && !outcome.join)) {
    state.malformed += 1;
    // Terms keep their harvest definitions and stay `recalled`. They are not
    // lost, which is only possible because the harvest wrote a definition for
    // every term in the first place.
    return;
  }
  if (!outcome.join) return;

  state.refusals = mergeReasons(state.refusals, outcome.join.refusalReasons);
  state.stageCounts = outcome.join.stageCounts;
  if (outcome.join.truncated) state.truncatedReason = "model";

  const start = (state.cursor || 0) * RESEARCH_BATCH_SIZE;
  for (const result of outcome.join.results) {
    const position = start + (result.index - 1);
    const term = state.terms[position];
    if (!term || term.provenance !== "recalled") continue;
    if (position >= start + batch.length) continue;

    // A GROUNDED-BUT-UNSOURCED DEFINITION STILL REPLACES THE RECALLED ONE: it
    // was written with search context, so it is at least as good. The contract
    // is re-applied here because a grounded definition can be a restatement or
    // carry a pasted URL too, and on failure the term falls back to its harvest
    // definition -- which is only possible because it has one.
    if (definitionRejection(term.term, result.definition) === null) {
      term.definition = result.definition;
    }

    if (result.provenance === "researched") {
      term.provenance = "researched";
      term.source_url = result.sourceUrl;
      term.source_host = result.sourceHost;
      if (result.sourceTitle) term.source_title = result.sourceTitle;
    }
  }
}

async function writeProgress({ row, store, state }) {
  const researched = state.terms.filter((t) => t.provenance === "researched").length;
  const recalled = state.terms.length - researched;
  const status = computeStatus({
    hasDescription: true,
    embedded: false,
    harvestFailed: false,
    termCount: state.terms.length,
    recalledCount: recalled,
    researchCursor: state.cursor,
    researchTotal: state.total,
  });

  await store.writeRow(row.position_id, {
    status,
    terms: state.terms,
    researched_count: researched,
    recalled_count: recalled,
    research_cursor: state.cursor,
    research_batches: state.batches,
    unsearched_batches: state.unsearched,
    malformed_batches: state.malformed,
    model_calls_fingerprint: state.callsFingerprint,
    model_calls_total: state.callsTotal,
    refusal_reasons: state.refusals,
    usage_totals: state.usage,
    stage_counts: state.stageCounts,
    truncated_reason: state.truncatedReason,
    researched_at: researched > 0 ? new Date().toISOString() : row.researched_at || null,
    ...(state.reason ? { reason: state.reason } : {}),
  });
}

/**
 * One cron invocation. Selects its OWN work -- it takes no parameters and cannot
 * be aimed at a chosen posting, which is what makes a shared-secret gate an
 * acceptable authorisation surface for a route that spends money.
 */
export async function runGlossaryWorker({
  store,
  client,
  model,
  clock = Date.now,
  limit = MAX_POSTINGS_PER_RUN,
  onCall,
}) {
  const summary = { postings: 0, batches: 0, leasedOut: 0, reason: null };

  // Checked before any work: this is the control that stops a response-shape
  // surprise from paying full price on every posting to rediscover the same
  // fact. In-flight generations are unaffected by design -- it refuses to start
  // NEW work, and the queue read below is what it gates.
  if (await store.circuitOpen()) {
    summary.reason = "circuit-open";
    return summary;
  }

  const deadlineAt = clock() + INVOCATION_BUDGET_MS - INVOCATION_RESERVE_MS;
  const queue = await store.selectQueue({ limit, now: clock() });

  for (const queued of queue) {
    if (clock() + BATCH_WORST_CASE_MS > deadlineAt) break;

    // ZERO ROWS FROM THE LEASE MEANS ANOTHER INVOCATION HOLDS IT: skip, never
    // wait. A worker the platform kills leaves a lease that expires shortly
    // after the function was already dead.
    const { row } = await store.acquireLease(queued.position_id, { now: clock() });
    if (!row) {
      summary.leasedOut += 1;
      continue;
    }

    try {
      const state = await researchRowToDeadline({
        row,
        store,
        client,
        model,
        clock,
        deadlineAt,
        onCall,
      });
      summary.postings += 1;
      summary.batches += state.batches - (row.research_batches || 0);
      if (state.stopped) {
        summary.reason = state.stopped;
        break;
      }
    } finally {
      // Cleared in a `finally`, so a worker that finishes in thirty seconds
      // releases immediately and the next cron tick can continue the same row.
      await store.releaseLease(queued.position_id);
    }
  }

  return summary;
}
