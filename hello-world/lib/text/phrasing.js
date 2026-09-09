// Deterministic phrasing variation. Pure templated output is a dead giveaway
// that a feature isn't an LLM: every company gets the exact same sentence. This
// picks among equivalent phrasings using a hash of a seed string, so the wording
// varies with the input (different company/question → different opener) while
// staying stable for a given input (idempotent, cache-friendly, testable).

// FNV-1a 32-bit hash — small, fast, and stable across runs/platforms.
export function hashString(str) {
  let h = 0x811c9dc5;
  const s = String(str || "");
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Deterministically pick one option, chosen by the seed. Same seed + options →
// same choice; different seeds spread across the options.
export function pick(seed, options) {
  const list = Array.isArray(options) ? options.filter((o) => o != null) : [];
  if (list.length === 0) return "";
  return list[hashString(seed) % list.length];
}

// Pick `n` distinct options in a seed-determined order (fewer available → all of
// them, still reordered). Useful when you want a couple of varied phrases.
//
// MECHANISM, and why it replaced a retry-on-collision `while` loop: the old
// version advanced a single hash value with an LCG step (`h = imul(h, C) + 1`)
// and re-tried whenever the resulting index had already been used. That
// requires the LCG to have full period (Hull-Dobell) to guarantee every index
// is eventually reachable — and `0x01000193` doesn't satisfy it, so for any
// `list.length` divisible by 4 only half the indices were ever reachable and
// the loop spun forever once every reachable slot was taken. A retry loop's
// termination is a global property of the generator (does it visit every
// residue?), not something you can see at the call site — which is exactly
// why it broke silently here and why "fix the constant" is not the real fix.
//
// This implementation is a seeded PARTIAL FISHER-YATES shuffle instead: draw
// position 0, then 1, then 2, ... swapping in an element chosen from the
// shrinking "undrawn" tail of the list. Each draw is a single hash-and-modulo
// against the CURRENT tail size (never against a used/unused check), so there
// is no collision to retry on and nothing to loop until — the outer loop runs
// exactly `count` times, full stop. Termination is now a property of the code
// shape (a bounded `for`), not of the hash function's reachability, so no
// choice of hash can reintroduce this bug, and every list index is reachable
// again at every position, for some seed — which is what actually fixes the
// original defect.
//
// What this is NOT: a uniform shuffle. Every draw in one call hashes the
// same `seed` prefix, and for single-digit `i` the low 4 bits of that hash
// are just `(H mod 16) XOR i`, where `H` is the prefix's own hash — so the
// draws in one call are far from independent.
// Measured: the reachable PERMUTATION space (whole orderings, not individual
// indices) is about half of `length!` at lengths 4-5 and roughly 4% of it by
// length 8, not the full `length!`. That is a real skew, but it does not
// reintroduce the old bug: distinctness is still guaranteed by construction
// (each `j` is drawn from the current tail, never re-visited) and every
// option still reaches every position across the seed space, which is the
// property that actually hung before. This module's contract is varied,
// seed-stable PHRASING ("the wording varies with the input"), not
// cryptographic shuffling or unbiased sampling, so a skewed permutation
// distribution is an acceptable tradeoff here, not a defect.
export function pickDistinct(seed, options, n = options?.length ?? 0) {
  const list = Array.isArray(options) ? options.filter((o) => o != null) : [];

  // THE CLAMP. Kept exactly as it was semantically (`Math.min(n, list.length)`),
  // just moved out of the loop condition and computed once, up front, as its
  // own named value — so an over-ask (`n > list.length`) or a non-positive `n`
  // can never make the draw loop below ask for more distinct entries than the
  // list can supply. That was the one thing that could not be lost in this
  // rewrite: losing it means `pickDistinct(seed, twoOptions, 5)` walks past
  // the end of an ever-shrinking pool and never terminates. See
  // phrasing.test.js's "clamps n greater than options.length instead of
  // spinning" test, which exists specifically because this line is easy to
  // drop by accident.
  const count = Math.max(0, Math.min(n, list.length));
  if (count === 0) return [];

  const pool = list.slice();
  for (let i = 0; i < count; i += 1) {
    // Hash the seed together with the position being filled. There is no
    // shared mutable PRNG state carried between draws — unlike advancing one
    // `h` via repeated multiplication by the same constant, which is what
    // broke the old version — so there is no period/reachability defect to
    // inherit here. That fixes termination and distinctness; it does NOT
    // make the draws statistically independent or uniformly distributed
    // (see the header comment above). `remaining` is the size of the
    // still-undrawn tail — positions [i, pool.length) — so the chosen index
    // always lands in that tail and never revisits an already-placed
    // position.
    const remaining = pool.length - i;
    const j = i + (hashString(`${seed}:${i}`) % remaining);
    const drawn = pool[i];
    pool[i] = pool[j];
    pool[j] = drawn;
  }
  return pool.slice(0, count);
}
