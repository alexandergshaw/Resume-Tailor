// AC-P2: the two pure pieces of the streaming answer path — the NDJSON wire
// framing shared by the route and the client (splitFrames), and the partial
// -> bullets parser that lets the card fill in while the model is still
// writing (pointsFromPartialJson). Both pure functions, no fetch, no
// ReadableStream, no React — this repo's vitest config runs
// `environment: "node"` with no jsdom, so a decision buried inside a fetch
// loop or a stream reader would be unreachable from a test, and an
// unfalsifiable parser is exactly where a truncated answer would hide. Same
// reasoning as answerWindow.js and answerPoints.js.

// Splits a buffer of newline-delimited JSON into every COMPLETE frame it
// contains, plus whatever trailing partial line hasn't seen its newline yet.
// Tolerates \r\n, blank/whitespace-only lines, and a line that isn't valid
// JSON at all (a keep-alive from a proxy, or a connection dropped mid-frame)
// — dropped rather than thrown, so one bad line never takes the rest of the
// stream down with it. Never throws, on any input.
export function splitFrames(buffer) {
  if (typeof buffer !== "string") return { frames: [], rest: "" };

  const lines = buffer.split(/\r\n|\n/);
  const rest = lines.pop() ?? "";
  const frames = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    try {
      frames.push(JSON.parse(line));
    } catch {
      // Malformed or truncated frame — drop it and keep going.
    }
  }
  return { frames, rest };
}

// Strips a leading markdown fence the way parseModelJson (lib/llm/
// extractEmployment.js) tolerates one on a complete document — here there is
// no closing fence to anchor on yet, since the document may still be
// arriving, so only the OPENING fence is stripped.
const LEADING_FENCE_RE = /^```[a-zA-Z]*\n?/;

// Scans a (possibly incomplete) JSON document for its top-level `points`
// array and returns every element that has FINISHED arriving — a string
// still being written, still open at the point the buffer ends, is excluded
// rather than returned truncated. The result grows monotonically as more of
// the same document is fed in: once a point has appeared it never changes or
// disappears on a later call, and once the array closes, later text (a
// sibling `cues`/`type` field) is never read into it. Never throws.
export function pointsFromPartialJson(input) {
  if (typeof input !== "string") return [];

  const text = input.replace(LEADING_FENCE_RE, "");
  const opener = /"points"\s*:\s*\[/.exec(text);
  if (!opener) return [];

  const points = [];
  const n = text.length;
  let i = opener.index + opener[0].length;

  while (i < n) {
    while (i < n && /[\s,]/.test(text[i])) i += 1;
    if (i >= n) break;
    if (text[i] === "]") return points;
    if (text[i] !== '"') return points; // not a string element — bail safely

    i += 1; // step past the opening quote
    let value = "";
    let closed = false;
    while (i < n) {
      const ch = text[i];
      if (ch === "\\") {
        if (i + 1 >= n) break; // trailing backslash — incomplete escape
        const next = text[i + 1];
        if (next === "u") {
          const hex = text.slice(i + 2, i + 6);
          if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
            i = n; // incomplete unicode escape — the string hasn't fully arrived
            break;
          }
          value += String.fromCodePoint(parseInt(hex, 16));
          i += 6;
          continue;
        }
        const decoded = { '"': '"', "\\": "\\", "/": "/", n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" };
        value += next in decoded ? decoded[next] : next;
        i += 2;
        continue;
      }
      if (ch === '"') {
        closed = true;
        i += 1;
        break;
      }
      value += ch;
      i += 1;
    }

    if (!closed) return points; // still being written — exclude it
    points.push(value);
  }

  return points;
}
