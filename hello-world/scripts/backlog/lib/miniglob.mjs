// A minimal glob matcher for `owns` patterns, scoped to exactly what backlog items need: POSIX-
// style relative paths, `**` (any number of path segments), `*` (within one segment), and literal
// segments. No external dependency — the pattern set this repo's `owns` fields need is small and
// fully covered by this grammar, and a hand-rolled matcher keeps the whole backlog toolchain free
// of a dependency this file's own author would have to trust unverified.

/** Converts one glob pattern into a RegExp anchored to a full-string match. */
export function globToRegExp(pattern) {
  let out = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*" && pattern[i + 1] === "*") {
      // "**" — across any number of path segments, including zero.
      out += ".*";
      i += 2;
      // Swallow one following "/" so "a/**/b" can match "a/b" too.
      if (pattern[i] === "/") i += 1;
      continue;
    }
    if (ch === "*") {
      out += "[^/]*";
      i += 1;
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      i += 1;
      continue;
    }
    // Escape every regex-special character that is not one of the glob operators above.
    if ("\\^$.|+()[]{}".includes(ch)) {
      out += "\\" + ch;
    } else {
      out += ch;
    }
    i += 1;
  }
  return new RegExp("^" + out + "$");
}

/** Returns the sorted, de-duplicated union of files (from `allFiles`) matched by any pattern. */
export function matchOwns(patterns, allFiles) {
  const regexes = patterns.map(globToRegExp);
  const matched = new Set();
  for (const file of allFiles) {
    if (regexes.some((re) => re.test(file))) matched.add(file);
  }
  return [...matched].sort();
}
