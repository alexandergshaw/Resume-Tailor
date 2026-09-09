// The glossary hover renders nothing unless a provider is mounted above it, and
// the provider fetches nothing unless it is given a real application id.
//
// THIS FILE EXISTS BECAUSE THAT EXACT SEAM ALREADY SHIPPED BROKEN ONCE. The
// ask-AI box went out in 7e3d48c sending `applicationId: ""` on every request in
// every state: neither session client passed the prop, and StickyQuestionStrip
// declares `applicationId = ""` as a DEFAULT PARAMETER, so nothing threw, nothing
// warned, and a well-formed request went out asking about no application at all.
// The strip's own suite covered it -- it asserted the strip forwards the prop to
// the box -- which is one level too deep to see a mount site that never supplied
// it. A default parameter is what makes this class of bug silent: it turns
// "nobody passed this" into a legal value.
//
// So these cases assert from the CLIENTS, which are the things that must supply
// the value, and they reject a hardcoded one as firmly as a missing one.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const LIVE = "app/copilot/CopilotClient.js";
const PRACTICE = "app/copilot/practice/PracticeClient.js";

/** Source with comments stripped -- prose naming a symbol is not a mount. */
function codeOf(rel) {
  const raw = readFileSync(path.join(process.cwd(), rel), "utf8");
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/^\s*\/\/.*$/, ""))
    .join("\n");
}

const CLIENTS = [
  { rel: LIVE, label: "live" },
  { rel: PRACTICE, label: "practice" },
];

describe("the glossary provider is actually mounted, with a real application id", () => {
  it.each(CLIENTS)("[instrument] $label client source is readable and non-trivial", ({ rel }) => {
    // Without this, every absence assertion below could be reading "" and
    // passing for the wrong reason.
    const code = codeOf(rel);
    expect(code.length).toBeGreaterThan(5000);
    expect(code).toMatch(/export default function/);
  });

  it.each(CLIENTS)("$label client imports GlossaryProvider", ({ rel }) => {
    expect(
      codeOf(rel),
      `${rel} must import GlossaryProvider, or the glossary hover renders nothing on this surface`,
    ).toMatch(/import\s*\{[^}]*\bGlossaryProvider\b[^}]*\}\s*from\s*["'][^"']*GlossaryProvider["']/);
  });

  it.each(CLIENTS)("$label client mounts it", ({ rel }) => {
    expect(codeOf(rel), `${rel} imports GlossaryProvider but never renders it`).toMatch(
      /<GlossaryProvider\b/,
    );
  });

  it.each(CLIENTS)("$label client feeds it the SELECTED posting, not a constant", ({ rel }) => {
    const code = codeOf(rel);
    const mount = /<GlossaryProvider\b([\s\S]*?)>/.exec(code);
    expect(mount, `${rel} has no <GlossaryProvider ...> to read`).not.toBeNull();
    const props = mount[1];

    // The value must be an EXPRESSION reading the posting the user picked.
    expect(
      props,
      `${rel} must pass applicationId={posting?.id || ""} -- the same fact useApplicationDocs, ` +
        `useRoomQuestions and AskAiBox already consume on this surface`,
    ).toMatch(/applicationId=\{[^}]*posting\?\.id/);

    // And must NOT be a literal. This is the ask-AI defect stated as an
    // assertion: a well-formed request for nothing is worse than a broken one,
    // because nothing reports it.
    expect(props, `${rel} hardcodes applicationId`).not.toMatch(/applicationId=\{?\s*""\s*\}?/);
    expect(props).not.toMatch(/applicationId=\{?\s*null\s*\}?/);
  });

  it("[control] the guard can fail -- a mount with a literal id is rejected", () => {
    // Proves the assertion above is not vacuous, without mutating a real file.
    const planted = `<GlossaryProvider applicationId={""} positionId={""}>`;
    const props = /<GlossaryProvider\b([\s\S]*?)>/.exec(planted)[1];
    expect(props).not.toMatch(/applicationId=\{[^}]*posting\?\.id/);
    expect(props).toMatch(/applicationId=\{?\s*""\s*\}?/);
  });

  it("[control] a mention inside a comment is not a mount", () => {
    const planted = `// <GlossaryProvider applicationId={posting?.id}>\nconst x = 1;`;
    const stripped = planted
      .split("\n")
      .map((line) => line.replace(/^\s*\/\/.*$/, ""))
      .join("\n");
    expect(stripped).not.toMatch(/<GlossaryProvider\b/);
  });
});
