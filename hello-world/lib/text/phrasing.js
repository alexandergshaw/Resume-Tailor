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
export function pickDistinct(seed, options, n = options?.length ?? 0) {
  const list = Array.isArray(options) ? options.filter((o) => o != null) : [];
  const out = [];
  const used = new Set();
  let h = hashString(seed);
  while (out.length < Math.min(n, list.length)) {
    const idx = h % list.length;
    if (!used.has(idx)) {
      used.add(idx);
      out.push(list[idx]);
    }
    // Advance the hash so we don't loop on the same index.
    h = (Math.imul(h, 0x01000193) + 1) >>> 0;
  }
  return out;
}
