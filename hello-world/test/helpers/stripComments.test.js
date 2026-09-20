import { describe, it, expect } from "vitest";
import { stripLineComments, stripCommentLines } from "./stripComments.js";

// This file exists because the CRLF defect it guards against shipped once
// already: every codeOf()/stripLineComments() copy across this repo split on
// "\n" and matched `//` with a plain (non-multiline) `$`, which is a
// complete no-op on a CRLF checkout (this repo's: core.autocrlf=true smudges
// every checkout to CRLF) -- `.` never matches the trailing "\r" a CRLF split
// leaves on every line, so `$` (end-of-string only, no `/m`) never matches
// and the comment survives. These cases fail against that old, unfixed
// per-file logic (verified by hand against a copy of it before this helper
// existed) and must keep passing against the shared helper.

describe("stripLineComments -- trailing or whole-line `//`, LF and CRLF alike", () => {
  it("strips a trailing comment on an LF-joined file", () => {
    const input = 'const a = 1; // SECRET_TOKEN\nconst b = 2;';
    expect(stripLineComments(input)).not.toContain("SECRET_TOKEN");
  });

  it("strips the SAME trailing comment on a CRLF-joined file", () => {
    const input = 'const a = 1; // SECRET_TOKEN\r\nconst b = 2;';
    expect(stripLineComments(input)).not.toContain("SECRET_TOKEN");
  });

  it("produces identical output for the LF and CRLF versions of the same source", () => {
    const lf = 'const a = 1; // SECRET_TOKEN\nif (x) {\n  // another comment\n  doThing();\n}\n';
    const crlf = lf.replace(/\n/g, "\r\n");
    expect(stripLineComments(crlf).replace(/\r\n/g, "\n")).toBe(stripLineComments(lf));
  });

  it("a token that appears ONLY inside a `//` comment is not mistaken for a live call, on CRLF input", () => {
    // This is the exact shape a source-text instrument relies on: a symbol
    // named only in prose must not satisfy an assertion about real code
    // calling it.
    const input = '// startInterviewPrepResearch({ applicationId });\r\nconst x = 1;\r\n';
    expect(stripLineComments(input)).not.toMatch(/startInterviewPrepResearch\s*\(/);
  });
});

describe("stripCommentLines -- whole-line `//` only, LF and CRLF alike", () => {
  it("strips a pure comment line on CRLF input", () => {
    const input = '  // startPositionGlossary({ positionId });\r\nconst x = 1;\r\n';
    expect(stripCommentLines(input)).not.toMatch(/startPositionGlossary\s*\(/);
  });

  it("leaves a trailing comment's CODE half intact (only the whole-line shape is stripped)", () => {
    const input = 'const a = 1; // not a whole-line comment\r\nconst b = 2;\r\n';
    expect(stripCommentLines(input)).toContain("const a = 1;");
  });

  it("produces identical output for the LF and CRLF versions of the same source", () => {
    const lf = 'const a = 1;\nif (x) {\n  // a whole comment line\n  doThing();\n}\n';
    const crlf = lf.replace(/\n/g, "\r\n");
    expect(stripCommentLines(crlf).replace(/\r\n/g, "\n")).toBe(stripCommentLines(lf));
  });
});
