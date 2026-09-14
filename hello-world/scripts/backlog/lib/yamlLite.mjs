// A deliberately tiny, restricted YAML reader for docs/backlog.yml only. It is NOT a general YAML
// parser: it supports exactly the grammar backlog.yml is authored in (a top-level list of flat
// maps, every scalar either `null`, a double-quoted string, or a flow array of those) and throws
// loudly on anything else, rather than silently misreading a hand-edit. See docs/backlog.yml's own
// header for the field list this grammar produces.

const FIELD_LINE = /^ {2}([a-zA-Z_]+): (.*)$/;
const ITEM_START = /^- id: (.*)$/;

/** Splits `str` on `sep` only at positions not inside a double-quoted run, honouring `\"`/`\\`. */
function splitTopLevel(str, sep) {
  const parts = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];
    if (inQuotes) {
      current += ch;
      if (ch === "\\" && i + 1 < str.length) {
        current += str[i + 1];
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      current += ch;
      continue;
    }
    if (ch === sep) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

function parseQuotedString(raw, lineNo) {
  if (raw[0] !== '"' || raw[raw.length - 1] !== '"' || raw.length < 2) {
    throw new Error(`yamlLite: malformed quoted string at line ${lineNo}: ${raw}`);
  }
  const inner = raw.slice(1, -1);
  let out = "";
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch === "\\" && i + 1 < inner.length) {
      const next = inner[i + 1];
      if (next === '"' || next === "\\") {
        out += next;
        i += 1;
        continue;
      }
      // Not a recognised escape — keep both characters literally rather than swallowing the
      // backslash silently (a silent swallow is exactly the kind of defect this repo hunts).
      out += ch;
      continue;
    }
    if (ch === '"') {
      throw new Error(`yamlLite: unescaped quote inside string at line ${lineNo}: ${raw}`);
    }
    out += ch;
  }
  return out;
}

function parseValue(raw, lineNo) {
  const trimmed = raw.trim();
  if (trimmed === "null") return null;
  if (trimmed === "[]") return [];
  if (trimmed[0] === "[" && trimmed[trimmed.length - 1] === "]") {
    const inner = trimmed.slice(1, -1);
    return splitTopLevel(inner, ",").map((seg) => parseValue(seg.trim(), lineNo));
  }
  if (trimmed[0] === '"') return parseQuotedString(trimmed, lineNo);
  throw new Error(`yamlLite: unrecognized scalar at line ${lineNo}: ${raw}`);
}

/**
 * Parses backlog.yml's restricted grammar into an array of plain item objects.
 * Throws (rather than silently dropping lines) on any line that is not a comment, blank, an
 * `- id: "..."` item start, or a 2-space-indented `key: value` field line.
 */
export function parseBacklogYaml(text) {
  const lines = text.split("\n");
  const items = [];
  let current = null;

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const itemMatch = line.match(ITEM_START);
    if (itemMatch) {
      current = { id: parseValue(itemMatch[1], lineNo) };
      items.push(current);
      continue;
    }

    const fieldMatch = line.match(FIELD_LINE);
    if (fieldMatch) {
      if (!current) {
        throw new Error(`yamlLite: field line before any "- id:" at line ${lineNo}: ${line}`);
      }
      const [, key, rawValue] = fieldMatch;
      current[key] = parseValue(rawValue, lineNo);
      continue;
    }

    throw new Error(`yamlLite: unrecognized line ${lineNo}: ${line}`);
  }

  return items;
}
