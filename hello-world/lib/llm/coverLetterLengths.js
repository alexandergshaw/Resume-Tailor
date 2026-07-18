// Enforce the per-line length budget without ever breaking a sentence: a line
// within the cap passes through; an over-budget line is cut back to its last
// complete sentence within the cap; a single sentence that overruns the cap is
// kept whole — a slightly long paragraph wraps harmlessly in the .docx, while
// a mid-sentence cut reads as broken output.
export function enforceCoverLetterLengths(resultLines, templateLines) {
  return resultLines.map((rawLine, idx) => {
    const template = templateLines[idx] || "";
    const targetLen = template.length;
    const line = String(rawLine || "");

    // Preserve blank slots so paragraph breaks survive.
    if (targetLen === 0) return "";

    // Cap to +15% to enforce the hard upper bound from the prompt.
    const maxLen = Math.max(targetLen + 5, Math.ceil(targetLen * 1.15));
    if (line.length <= maxLen) return line;

    // Cut at the last sentence boundary within the cap ([.!?] plus any closing
    // quotes/parens, followed by whitespace or end). Only accept a boundary in
    // the back half of the cap so we don't gut the paragraph.
    const head = line.slice(0, maxLen + 1);
    const boundaryRe = /[.!?]["')\]]*(?=\s|$)/g;
    let cutEnd = -1;
    let m;
    while ((m = boundaryRe.exec(head)) !== null) {
      const end = m.index + m[0].length;
      if (end <= maxLen) cutEnd = end;
    }
    if (cutEnd >= Math.floor(maxLen * 0.5)) return line.slice(0, cutEnd);

    // No usable sentence boundary: keep the whole line rather than break it.
    return line;
  });
}
