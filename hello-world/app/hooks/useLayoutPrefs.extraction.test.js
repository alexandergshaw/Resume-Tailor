// node (this repo's default environment) — a SOURCE-TEXT test, for the reason
// app/copilot/SessionControls.extraction.test.js's header gives: the property
// under test IS the shape of the source — which module owns the persisted
// layout prefs, whether the caller still carries a copy, and above all WHERE
// the caller instantiates the hook.
//
// app/hooks/useLayoutPrefs.js is a LINE-BUDGET EXTRACTION out of app/page.js,
// not a feature change. page.js sat at 3233 lines against a binding ceiling of
// 3249 (the strictest of FIVE separate cap assertions — see this file's
// sibling guards and the roster in app/navigation/surfaceStack.sweep.test.js
// :726-738), i.e. sixteen lines of headroom for the whole app.
//
// THE FAILURE MODE THIS FILE EXISTS TO CATCH, beyond the usual two, is the one
// specific to a React hook extraction: hook call order is POSITIONAL, so an
// extraction that moves a useEffect relative to another useEffect is a
// behaviour change wearing a relocation's clothes. This hook carries FIVE
// effects, more than either of its sibling extractions, so the ordering guard
// below is the load-bearing assertion in this file — not the line count.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

// Byte-for-byte the helper SessionControls.extraction.test.js:41-45 uses, so
// "not a stub" means the same thing across every extraction guard in the repo.
const codeLines = (src) =>
  src
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("/*")).length;

// Whole-line `//` and block comments only — a mid-line `//` strip would
// truncate any line holding a URL. Both files below carry comments naming the
// very symbols under test, so every claim reads the comment-free source.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const PAGE = read("../page.js");
const HOOK = read("./useLayoutPrefs.js");
const PAGE_CODE = stripComments(PAGE);
const HOOK_CODE = stripComments(HOOK);

describe("the persisted layout prefs moved to useLayoutPrefs.js", () => {
  it("[control] stripping comments leaves real code behind, in both files", () => {
    // Without this, every `not.toMatch` below is satisfied by a stripper that
    // returned "" — the vacuity failure this repo's other source tests each
    // pin in their own way.
    expect(PAGE_CODE).toMatch(/export default function Home\(\)/);
    expect(HOOK_CODE).toMatch(/export function useLayoutPrefs\(\)/);
    // ...and that it really removed comment text the bans would trip on,
    // rather than being an identity function. Both were RED before the
    // stripper existed.
    expect(HOOK).toMatch(/eslint-disable react-hooks\/set-state-in-effect/); // in the block comment
    expect(HOOK_CODE).not.toMatch(/NOT a rule being weakened/); // ...and only there
    expect(PAGE).toMatch(/Persisted UI layout prefs/); // in the call site's comment
    expect(PAGE_CODE).not.toMatch(/Persisted UI layout prefs/);
  });

  it("exists and is not a stub", () => {
    // 100 today. A token extraction that moved the three useState lines out
    // and left the five effects behind would pass "the file exists".
    expect(codeLines(HOOK)).toBeGreaterThan(80);
  });

  it("owns all five effects and the resize handler that used to sit in page.js", () => {
    expect(HOOK_CODE.match(/useEffect\(/g) || []).toHaveLength(5);
    expect(HOOK_CODE).toMatch(/localStorage\.getItem\("interviewCompanyColWidth"/);
    expect(HOOK_CODE).toMatch(/localStorage\.setItem\("interviewRoleColWidth"/);
    expect(HOOK_CODE).toMatch(/localStorage\.setItem\("fabPos"/);
    expect(HOOK_CODE).toMatch(/window\.addEventListener\("resize", clampFab\)/);
    expect(HOOK_CODE).toMatch(/function startColResize\(which, event\)/);
    // The clamp is what stops a FAB position saved on a big screen stranding
    // the button off-canvas on a small one. Losing it is invisible until a
    // user rotates a phone.
    expect(HOOK_CODE).toMatch(/Math\.max\(8, window\.innerWidth - 80\)/);
    expect(HOOK_CODE).toMatch(/Math\.max\(8, window\.innerHeight - 48\)/);
  });

  it("page.js no longer holds any of it", () => {
    // Each names something the old block could not exist without, and that
    // nothing else in page.js legitimately needs — so a leftover copy, or a
    // second one, turns this red. A DUPLICATED persist effect is invisible to
    // every behavioural test in the suite and would double every write.
    expect(PAGE_CODE).not.toMatch(/const \[companyColWidth/);
    expect(PAGE_CODE).not.toMatch(/const \[roleColWidth/);
    expect(PAGE_CODE).not.toMatch(/const \[fabPos/);
    expect(PAGE_CODE).not.toMatch(/function startColResize/);
    expect(PAGE_CODE).not.toMatch(/interviewCompanyColWidth/);
    expect(PAGE_CODE).not.toMatch(/interviewRoleColWidth/);
    expect(PAGE_CODE).not.toMatch(/localStorage\.setItem\("fabPos"/);
    expect(PAGE_CODE).not.toMatch(/clampFab/);
  });
});

describe("the extraction is ADOPTED, not merely added", () => {
  it("page.js imports it and destructures every value it needs", () => {
    expect(PAGE_CODE).toMatch(/import \{ useLayoutPrefs \} from "\.\/hooks\/useLayoutPrefs"/);
    // A hook has no JSX mount to inspect, so the equivalent of S9's
    // "wired, not merely mounted" is the destructuring: `useLayoutPrefs()`
    // called and thrown away type-checks, runs its effects, and leaves every
    // consumer below reading an undefined binding.
    expect(PAGE_CODE).toMatch(
      /const \{ companyColWidth, roleColWidth, fabPos, setFabPos, startColResize \} = useLayoutPrefs\(\);/,
    );
  });

  it("the five returned values reach their real consumers, not literals", () => {
    // Each of these is a silent loss: the table still renders with a
    // hard-coded 140px column, the FAB still appears at a fixed corner. None
    // of it throws, and no behavioural test in this repo renders page.js.
    expect(PAGE_CODE).toMatch(/companyColWidth=\{companyColWidth\}/);
    expect(PAGE_CODE).toMatch(/roleColWidth=\{roleColWidth\}/);
    expect(PAGE_CODE).toMatch(/startColResize=\{startColResize\}/);
    expect(PAGE_CODE).toMatch(/pos=\{fabPos\}/);
    expect(PAGE_CODE).toMatch(/onPosChange=\{setFabPos\}/);
    expect(PAGE_CODE).toMatch(/fabPos=\{fabPos\}/);
    // The mutants these bans exclude, each of which renders fine.
    expect(PAGE_CODE).not.toMatch(/companyColWidth=\{\d/);
    expect(PAGE_CODE).not.toMatch(/roleColWidth=\{\d/);
    expect(PAGE_CODE).not.toMatch(/pos=\{\{/);
  });
});

describe("the move is ORDER-PRESERVING, which is what made it safe", () => {
  // THE load-bearing property. React hook order is positional: an extraction
  // that hoists five effects to the top of a component with ~39 of them
  // changes when each runs relative to the others, and this repo's mount
  // effects genuinely interact through localStorage (page.js's saved-search
  // pair is the live example: one effect READS a key a later one WRITES, so
  // swapping them would hand the reader an empty list).
  //
  // This hook is therefore instantiated at the exact source position its
  // effects vacated — after the Gmail background-refresh effect, before the
  // employment-import handler — so no effect changes index relative to any
  // other. Only three useState calls moved, and a whole-file census confirmed
  // nothing referenced them in between. (A TDZ argument would NOT be enough
  // here: a read from inside an effect or handler closure runs after the
  // component body and would not throw.)
  const at = (needle) => {
    const i = PAGE_CODE.indexOf(needle);
    expect(i, `page.js no longer contains ${needle}`).toBeGreaterThan(-1);
    return i;
  };

  it("is instantiated in the exact gap its effects vacated", () => {
    expect(at("useLayoutPrefs()")).toBeGreaterThan(at("setInterval(loadGmailMessages"));
    expect(at("useLayoutPrefs()")).toBeLessThan(at("useEmploymentImport({"));
    expect(at("useLayoutPrefs()")).toBeLessThan(at("useMaterialsLocker({"));
  });

  it("[control] the ordering probe can tell positions apart", () => {
    // Without this the three assertions above pass vacuously if indexOf ever
    // starts returning a constant.
    expect(at("setInterval(loadGmailMessages")).not.toBe(at("useLayoutPrefs()"));
    expect(at("useEmploymentImport({")).toBeGreaterThan(at("useLayoutPrefs()"));
  });

  it("keeps the suppression scoped to the one effect that needs it", () => {
    // The eslint-disable here is a pre-existing condition the extraction
    // exposed, not a rule being weakened: the identical effect lints clean
    // inside page.js only because eslint-plugin-react-hooks v7's compiler
    // analysis bails out on a component that size. If it is ever widened to
    // the whole file, the other four effects stop being linted silently.
    expect(HOOK).toMatch(/eslint-disable react-hooks\/set-state-in-effect/);
    expect(HOOK).toMatch(/eslint-enable react-hooks\/set-state-in-effect/);
    const off = HOOK.indexOf("eslint-disable react-hooks/set-state-in-effect");
    const on = HOOK.indexOf("eslint-enable react-hooks/set-state-in-effect");
    expect(on).toBeGreaterThan(off);
    // The re-enable must come BEFORE the persist effects, not at the end of
    // the hook — otherwise the scope silently covers all five.
    expect(on).toBeLessThan(HOOK.indexOf('localStorage.setItem("interviewCompanyColWidth"'));
  });
});

describe("nothing was lost on the way out", () => {
  // The union of caller and new module must still carry the sentences whose
  // loss would cost the next reader a re-derivation of a real decision.
  const union = [PAGE, HOOK].join("\n");
  const mustSurvive = [
    // Why the FAB position is clamped on hydration as well as on resize.
    "can't strand the FAB off-screen on a small one",
    // Why the widths are bounded at all.
    "persisted to localStorage",
  ];
  for (const fragment of mustSurvive) {
    it(`still explains: ${fragment}`, () => {
      expect(union).toContain(fragment);
    });
  }
});
