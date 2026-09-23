// N35 fix round -- verify.r1.md B1.
//
// `app/page.js:2958` is the ONLY production render of `CompanyResearchDialog`.
// Before this fix it passed `onClose`, `onApply`, `onResearch` and `onAddUrl`
// but no `onAccept`, `acceptError` or `acceptNotice` -- the dialog itself
// already declares all three (`CompanyResearchDialog.js` renders the accept
// control as `{onAccept ? <Button…/> : null}`, so it never appeared, and the
// refusal/notice boxes render only when those props are non-empty, so
// neither could ever be seen). `useCompanyResearch#acceptFacts` and the
// accept state it maintains were fully built and fully tested against a
// hand-assembled prop set, and never reached a real user.
//
// WHY SOURCE-SCANNING. Same constraint as `page.duplicateApply.wiring.test.js`'s
// own header: `app/page.js` is a single un-exported "use client" component
// pulling in Supabase, fetch and a screen's worth of hooks, so it cannot be
// mounted for a behavioral test without dragging all of that in for no
// benefit. This reads the real source and asserts on the real call site's
// shape, the way that file already does for `<StatusBar>`.
//
// CLOSING THE CLASS, NOT JUST THIS INSTANCE. verify.r1.md's framing: this is
// the fifth time in this session a complete mechanism shipped with its last
// hop to the user missing. Rather than hard-coding the three prop names, the
// second describe below reads `CompanyResearchDialog`'s OWN destructured
// prop list, keeps whichever of those names mention "accept", and requires
// each to be threaded through the page.js call site FROM `research` -- so a
// rename, or a fourth accept-surface prop added to the dialog later and
// never wired at this call site, both fail here instead of shipping silently
// the way the first three did.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pageSource = readFileSync(fileURLToPath(new URL("./page.js", import.meta.url)), "utf8");
const dialogSource = readFileSync(
  fileURLToPath(new URL("./components/CompanyResearchDialog.js", import.meta.url)),
  "utf8",
);

function callSiteOf(source, tagName) {
  const m = source.match(new RegExp(`<${tagName}\\b[\\s\\S]*?/>`));
  return m ? m[0] : null;
}

// Every destructured prop name in `export default function CompanyResearchDialog({ ... })`.
function propNamesOf(source, componentName) {
  const sig = source.match(new RegExp(`export default function ${componentName}\\(\\{([\\s\\S]*?)\\}\\)\\s*\\{`));
  if (!sig) return [];
  return sig[1]
    .split("\n")
    .map((line) => line.trim())
    .map((line) => line.match(/^([A-Za-z0-9_$]+)/)?.[1])
    .filter(Boolean);
}

describe("CompanyResearchDialog's production call site is wired for accept (B1)", () => {
  const callSite = callSiteOf(pageSource, "CompanyResearchDialog");

  it("the call site exists (sanity check for the extractor itself)", () => {
    expect(callSite).not.toBeNull();
  });

  it("there is exactly one production render of CompanyResearchDialog", () => {
    expect(pageSource.match(/<CompanyResearchDialog\b/g) || []).toHaveLength(1);
  });

  it("passes onAccept bound to research.acceptFacts", () => {
    expect(callSite).toMatch(/onAccept=\{research\.acceptFacts\}/);
  });

  it("passes acceptError sourced from the research hook's own state", () => {
    expect(callSite).toMatch(/acceptError=\{research\.companyResearch\.acceptError\}/);
  });

  it("passes acceptNotice sourced from the research hook's own state", () => {
    expect(callSite).toMatch(/acceptNotice=\{research\.companyResearch\.acceptNotice\}/);
  });
});

describe("class guard: every accept-related prop the dialog itself declares is threaded from `research` at the call site", () => {
  const dialogProps = propNamesOf(dialogSource, "CompanyResearchDialog");
  const acceptProps = dialogProps.filter((name) => /accept/i.test(name));
  const callSite = callSiteOf(pageSource, "CompanyResearchDialog");

  it("the extractor really does see the dialog's declared props (sanity check)", () => {
    expect(dialogProps).toEqual(expect.arrayContaining(["open", "onClose", "onApply"]));
  });

  it("found at least the three accept props this fix was written for", () => {
    // A floor, not a ceiling -- if the dialog later grows a fourth
    // accept-related prop, the walk below is what actually enforces it.
    expect(acceptProps).toEqual(expect.arrayContaining(["onAccept", "acceptError", "acceptNotice"]));
  });

  it("every accept-related prop is bound at the call site to a value that reads from `research`", () => {
    for (const name of acceptProps) {
      const m = callSite.match(new RegExp(`${name}=\\{([^}]*)\\}`));
      expect(m, `${name} is not passed at all in the production call site`).not.toBeNull();
      expect(
        m[1].includes("research."),
        `${name}={${m?.[1]}} does not read from the research hook -- a literal or a different source would silently break the wiring`,
      ).toBe(true);
    }
  });
});
