// The tracking surface's memoization, at the ONE seam its own tests cannot see:
// app/page.js.
//
// app/components/TrackingTab.renderCount.test.js proves the rows skip when
// their props are stable. It cannot prove the PAGE hands them stable props,
// because app/page.js is a single un-exported "use client" component that
// cannot be mounted (the constraint app/page.untrackChip.wiring.test.js and
// app/page.autoTailoredUrl.test.js also record). So the three page-level
// pieces are pinned by the shape of the source, with comments stripped so a
// sentence about them cannot satisfy a check.
//
//   1. visibleApplicationData and emailClassificationsByAppId are useMemo'd on
//      the inputs they read (rebuilt per render they were a fresh array/object
//      each time, which defeats every React.memo below them).
//   2. The example-project prewarm hook is called from a leaf component, not
//      from Home, so its settle-time state does not re-render the page.
//   3. TrackingTab does not do a per-row findIndex scan.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripComments } from "@/lib/sourceScan/tokenizeSource.js";

const read = (rel) => stripComments(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));
const page = read("./page.js");
const tab = read("./components/TrackingTab.js");

// The source of the function whose signature starts `signature` (ending at its
// opening paren), by brace-depth counting from the `{` that opens its BODY --
// the parameter list is skipped first, since a destructured parameter is a `{`
// too.
function bodyOf(source, signature) {
  const at = source.indexOf(signature);
  if (at === -1) return null;
  let parens = 1;
  let paramsEnd = at + signature.length;
  for (; paramsEnd < source.length && parens > 0; paramsEnd += 1) {
    if (source[paramsEnd] === "(") parens += 1;
    else if (source[paramsEnd] === ")") parens -= 1;
  }
  let depth = 0;
  for (let i = source.indexOf("{", paramsEnd); i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(at, i + 1);
    }
  }
  return null;
}

const squash = (s) => s.replace(/\s+/g, " ");

describe("page.js memoizes the tracking surface's derived props", () => {
  it("visibleApplicationData is a useMemo on exactly its inputs", () => {
    expect(squash(page)).toMatch(
      /const visibleApplicationData = useMemo\( \(\) => selectVisibleApplications\(applicationData, interviewSearch, interviewSort\), \[applicationData, interviewSearch, interviewSort\],? \);/,
    );
  });

  it("emailClassificationsByAppId is a useMemo on the Gmail messages, and TrackingTab is handed that binding", () => {
    expect(squash(page)).toMatch(
      /const emailClassificationsByAppId = useMemo\( \(\) => classificationsByAppId\(gmailMessages\), \[gmailMessages\],? \);/,
    );
    expect(page).toMatch(/emailClassificationsByAppId=\{emailClassificationsByAppId\}/);
    // The shape it replaced: a fresh object built inline in the JSX prop.
    expect(page).not.toMatch(/emailClassificationsByAppId=\{Object\.fromEntries/);
  });
});

describe("page.js mounts the example-project prewarm from a leaf", () => {
  it("[canary] the extractor finds the leaf and Home", () => {
    expect(bodyOf(page, "function ProjectPoolPrewarm(")).not.toBeNull();
    expect(bodyOf(page, "export default function Home(")).not.toBeNull();
  });

  it("the leaf calls the hook with the tracking rows and renders nothing", () => {
    const leaf = bodyOf(page, "function ProjectPoolPrewarm(");
    expect(leaf).toMatch(/useApplicationProjectPool\(\{\s*applications:\s*applicationData\s*\}\)/);
    expect(leaf).toMatch(/return null;/);
  });

  it("Home renders the leaf and does not call the hook itself", () => {
    const home = bodyOf(page, "export default function Home(");
    expect(home).toMatch(/<ProjectPoolPrewarm applicationData=\{applicationData\} \/>/);
    expect(home).not.toMatch(/useApplicationProjectPool\(/);
  });
});

describe("TrackingTab keeps per-row work constant", () => {
  it("looks each row's index up in a precomputed map instead of scanning applicationData", () => {
    expect(tab).not.toMatch(/\.findIndex\(/);
    expect(tab).toMatch(/indexApplicationsById\(applicationData\)/);
  });

  it("hands the rows fixed-identity handlers", () => {
    expect(tab).toMatch(/useStableHandlers\(/);
  });
});
