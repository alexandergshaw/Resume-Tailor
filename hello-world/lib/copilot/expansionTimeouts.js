// THE TWO ABORT BUDGETS of one "More detail" round trip, in one module.
//
// PURE, on purpose: no React, no node API and no environment read at module
// scope, so the browser bundle (expansionClient.js) and the server bundle
// (lib/config/env.js, then the expand route) can both import it. That is what
// lets one number be the source of truth for both sides of the wire.
//
// The client's abort budget for one expansion round trip. The SERVER's own
// budget must always be strictly smaller, so that when both fire it is the
// server's diagnosis ("that took too long to look up") that wins the race, not
// the browser's generic abort. That ordering is ENFORCED by the clamp below,
// not left to a comment an environment value could silently violate.
export const EXPANSION_CLIENT_TIMEOUT_MS = 10000;

// What the server waits on the model when COPILOT_EXPANSION_TIMEOUT_MS is
// unset, unparseable, zero or negative. A guess to retune against live latency.
export const DEFAULT_EXPANSION_SERVER_TIMEOUT_MS = 8000;

/**
 * The server's model-call budget, clamped so it is STRICTLY BELOW the client's.
 *
 * Returns a positive value no greater than EXPANSION_CLIENT_TIMEOUT_MS - 1 for
 * every input: NaN, zero, negative and non-numbers fall back to the default;
 * anything at or above the client budget is pulled down to one millisecond
 * under it. So "server < client" holds by construction, whatever an operator
 * sets.
 */
export function clampExpansionServerTimeout(rawMs) {
  const ceiling = EXPANSION_CLIENT_TIMEOUT_MS - 1;
  const n = Number.isFinite(rawMs) && rawMs > 0 ? rawMs : DEFAULT_EXPANSION_SERVER_TIMEOUT_MS;
  return Math.min(n, ceiling);
}
