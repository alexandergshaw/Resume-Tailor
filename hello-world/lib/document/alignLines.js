// Content-aware alignment of edited text lines onto a template's paragraph
// slots. Exact (trimmed) line matches anchor via LCS so unchanged lines keep
// their slot (and its formatting) even when other lines are inserted or
// deleted around them. Between anchors, leftover lines pair with leftover
// slots in order; extra lines become inserts, extra slots become removals.
//
// Returns an ordered list of operations:
//   { type: "fill",   slot: <templateIndex>, text: <line> }
//   { type: "remove", slot: <templateIndex> }
//   { type: "insert", afterSlot: <templateIndex | -1>, text: <line> }
// Ops are emitted in template order; inserts carry the slot they follow
// (-1 = before the first slot). Every template index appears exactly once as
// fill or remove; every line appears exactly once as fill or insert.
export function alignLinesToSlots(templateTexts, lines) {
  const normalize = (s) => String(s ?? "").trim();

  // Compute LCS using dynamic programming
  const normalizedTemplates = templateTexts.map(normalize);
  const normalizedLines = lines.map(normalize);

  const m = normalizedTemplates.length;
  const n = normalizedLines.length;

  // DP table: dp[i][j] = length of LCS of first i templates and first j lines
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      if (normalizedTemplates[i - 1] === normalizedLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find the actual LCS matches (as pairs of indices)
  const lcsMatches = [];
  let i = m;
  let j = n;

  while (i > 0 && j > 0) {
    if (normalizedTemplates[i - 1] === normalizedLines[j - 1]) {
      lcsMatches.unshift([i - 1, j - 1]); // Store as [templateIndex, lineIndex]
      i -= 1;
      j -= 1;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i -= 1;
    } else {
      j -= 1;
    }
  }

  // Build operations by processing gaps between LCS anchors
  const ops = [];
  let templateIdx = 0;
  let lineIdx = 0;
  let lastFilledSlot = -1; // Track the slot of the last fill operation

  for (const [anchorTemplate, anchorLine] of lcsMatches) {
    // Process gap before this anchor
    const slotGap = anchorTemplate - templateIdx;
    const lineGap = anchorLine - lineIdx;

    // Pair as many as we can
    const pairCount = Math.min(slotGap, lineGap);
    for (let k = 0; k < pairCount; k += 1) {
      const line = lines[lineIdx + k];
      if (normalize(line).length > 0) {
        ops.push({ type: "fill", slot: templateIdx + k, text: line });
        lastFilledSlot = templateIdx + k;
      } else {
        // A blank edited line consumes the slot: remove it so the original
        // template text does not survive into the rebuilt document.
        ops.push({ type: "remove", slot: templateIdx + k });
      }
    }

    // Extra slots become removes
    for (let k = pairCount; k < slotGap; k += 1) {
      ops.push({ type: "remove", slot: templateIdx + k });
    }

    // Extra lines become inserts (after the last filled slot in this gap)
    for (let k = pairCount; k < lineGap; k += 1) {
      const line = lines[lineIdx + k];
      if (normalize(line).length > 0) {
        ops.push({ type: "insert", afterSlot: lastFilledSlot, text: line });
      }
    }

    // Fill the anchor
    ops.push({ type: "fill", slot: anchorTemplate, text: lines[anchorLine] });
    lastFilledSlot = anchorTemplate;

    templateIdx = anchorTemplate + 1;
    lineIdx = anchorLine + 1;
  }

  // Process trailing gap (after the last anchor)
  const trailingSlots = m - templateIdx;
  const trailingLines = n - lineIdx;

  const pairCount = Math.min(trailingSlots, trailingLines);
  for (let k = 0; k < pairCount; k += 1) {
    const line = lines[lineIdx + k];
    if (normalize(line).length > 0) {
      ops.push({ type: "fill", slot: templateIdx + k, text: line });
      lastFilledSlot = templateIdx + k;
    } else {
      // A blank edited line consumes the slot: remove it so the original
      // template text does not survive into the rebuilt document.
      ops.push({ type: "remove", slot: templateIdx + k });
    }
  }

  // Extra trailing slots become removes
  for (let k = pairCount; k < trailingSlots; k += 1) {
    ops.push({ type: "remove", slot: templateIdx + k });
  }

  // Extra trailing lines become inserts
  for (let k = pairCount; k < trailingLines; k += 1) {
    const line = lines[lineIdx + k];
    if (normalize(line).length > 0) {
      ops.push({ type: "insert", afterSlot: lastFilledSlot, text: line });
    }
  }

  return ops;
}
