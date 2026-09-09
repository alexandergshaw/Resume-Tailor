// node — a SOURCE-TEXT test, same reasoning as its two siblings
// (useLayoutPrefs / useEmploymentImport .extraction.test.js).
//
// app/hooks/useMaterialsLocker.js is a LINE-BUDGET EXTRACTION out of
// app/page.js (3233 lines against a binding 3249 ceiling). It carries the
// supplementary materials locker: Supabase Storage for signed-in users,
// in-memory for the session otherwise, plus the one route into the chat panel.
//
// This module carries ONE effect, so — unlike its effect-free sibling — the
// positional argument matters, and the ordering guard below is what carries
// it: page.js instantiates the hook at the exact source position that effect
// already occupied.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const codeLines = (src) =>
  src
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("/*")).length;

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const PAGE = read("../page.js");
const HOOK = read("./useMaterialsLocker.js");
const PAGE_CODE = stripComments(PAGE);
const HOOK_CODE = stripComments(HOOK);

describe("the materials locker moved to useMaterialsLocker.js", () => {
  it("[control] stripping comments leaves real code behind, in both files", () => {
    expect(PAGE_CODE).toMatch(/export default function Home\(\)/);
    expect(HOOK_CODE).toMatch(/export function useMaterialsLocker\(/);
    expect(HOOK).toMatch(/there is\n\/\/ only ever one chat/); // module doc only
    expect(HOOK_CODE).not.toMatch(/only ever one chat/);
    expect(PAGE).toMatch(/Supabase Storage \+ the chat hand-off/); // call-site comment only
    expect(PAGE_CODE).not.toMatch(/Supabase Storage \+ the chat hand-off/);
  });

  it("exists and is not a stub", () => {
    // 114 today. The four handlers plus the effect are 102 raw lines; a stub
    // that kept only upload would fall far below this.
    expect(codeLines(HOOK)).toBeGreaterThan(90);
  });

  it("owns all four handlers and both the signed-in and signed-out paths", () => {
    expect(HOOK_CODE).toMatch(/async function uploadMaterials\(fileList\)/);
    expect(HOOK_CODE).toMatch(/async function downloadMaterialFile\(item\)/);
    expect(HOOK_CODE).toMatch(/async function removeMaterialFile\(item\)/);
    expect(HOOK_CODE).toMatch(/async function askAiAboutMaterial\(item\)/);
    // Signed-out users keep files in memory for the session; losing this
    // branch makes the whole locker silently do nothing when logged out.
    expect(HOOK_CODE).toMatch(/source: "local"/);
    expect(HOOK_CODE).toMatch(/25 \* 1024 \* 1024/);
    expect(HOOK_CODE.match(/useEffect\(/g) || []).toHaveLength(1);
  });

  it("page.js no longer holds any of it", () => {
    expect(PAGE_CODE).not.toMatch(/const \[materials,/);
    expect(PAGE_CODE).not.toMatch(/const \[materialsBusy/);
    expect(PAGE_CODE).not.toMatch(/const \[materialsError/);
    expect(PAGE_CODE).not.toMatch(/async function uploadMaterials/);
    expect(PAGE_CODE).not.toMatch(/async function askAiAboutMaterial/);
    expect(PAGE_CODE).not.toMatch(/listMaterials/);
    expect(PAGE_CODE).not.toMatch(/downloadMaterialBlob/);
    // The orphaned import must be gone too, not left dangling.
    expect(PAGE_CODE).not.toMatch(/triggerBlobDownload/);
    expect(PAGE_CODE).not.toMatch(/lib\/supabase\/materials/);
  });
});

describe("the extraction is ADOPTED, not merely added", () => {
  it("page.js imports it and destructures all seven returned values", () => {
    expect(PAGE_CODE).toMatch(
      /import \{ useMaterialsLocker \} from "\.\/hooks\/useMaterialsLocker"/,
    );
    for (const name of [
      "materials",
      "materialsBusy",
      "materialsError",
      "uploadMaterials",
      "downloadMaterialFile",
      "removeMaterialFile",
      "askAiAboutMaterial",
    ]) {
      expect(PAGE_CODE, `page.js does not destructure ${name}`).toMatch(
        new RegExp(`^\\s{4}${name},$`, "m"),
      );
    }
  });

  it("is handed the real user and the real chat, not literals", () => {
    // `currentUser: null` type-checks and renders: the locker simply never
    // loads a signed-in user's stored files, and every upload silently falls
    // into the in-memory branch and is lost on reload. `chat: {}` throws only
    // when the user clicks "Ask AI about this file".
    expect(PAGE_CODE).toMatch(/\} = useMaterialsLocker\(\{ currentUser, chat \}\);/);
    expect(PAGE_CODE).not.toMatch(/useMaterialsLocker\(\{[^}]*currentUser:/);
    expect(PAGE_CODE).not.toMatch(/useMaterialsLocker\(\{[^}]*chat:/);
  });

  it("all seven reach <ApplyingControls>", () => {
    expect(PAGE_CODE).toMatch(/materials=\{materials\}/);
    expect(PAGE_CODE).toMatch(/materialsBusy=\{materialsBusy\}/);
    expect(PAGE_CODE).toMatch(/materialsError=\{materialsError\}/);
    expect(PAGE_CODE).toMatch(/uploadMaterials=\{uploadMaterials\}/);
    expect(PAGE_CODE).toMatch(/downloadMaterialFile=\{downloadMaterialFile\}/);
    expect(PAGE_CODE).toMatch(/removeMaterialFile=\{removeMaterialFile\}/);
    expect(PAGE_CODE).toMatch(/askAiAboutMaterial=\{askAiAboutMaterial\}/);
    // The literal mutants: each renders a locker that looks right and does
    // nothing.
    expect(PAGE_CODE).not.toMatch(/materials=\{\[\]\}/);
    expect(PAGE_CODE).not.toMatch(/materialsBusy=\{(?:true|false)\}/);
    expect(PAGE_CODE).not.toMatch(/materialsError=\{""\}/);
  });
});

describe("the move is ORDER-PRESERVING, which is what made it safe", () => {
  // This hook's single effect loads the user's stored files on sign-in. It
  // keeps its index among page.js's effects because the hook is instantiated
  // exactly where that effect sat: after the employment-import handler,
  // before the per-field copy helper's state. Only the three useState calls
  // moved, and a whole-file census confirmed nothing referenced `materials`,
  // `materialsBusy` or `materialsError` between their old declaration site
  // and here. (TDZ alone would not prove that: a read from inside an effect
  // or handler closure runs after the component body and would not throw.)
  const at = (needle) => {
    const i = PAGE_CODE.indexOf(needle);
    expect(i, `page.js no longer contains ${needle}`).toBeGreaterThan(-1);
    return i;
  };

  it("is instantiated in the exact gap its effect vacated", () => {
    expect(at("useMaterialsLocker({")).toBeGreaterThan(at("useEmploymentImport({"));
    expect(at("useMaterialsLocker({")).toBeGreaterThan(at("useLayoutPrefs()"));
    // The per-field copy helper's state is the next hook in page.js after the
    // vacated block. If the call site ever drifts past it, this hook's effect
    // has changed index relative to every effect below.
    expect(at("useMaterialsLocker({")).toBeLessThan(at("const [fieldCopyKey"));
  });

  it("[control] the ordering probe can tell positions apart", () => {
    expect(at("const [fieldCopyKey")).not.toBe(at("useMaterialsLocker({"));
    expect(at("useEmploymentImport({")).toBeLessThan(at("const [fieldCopyKey"));
  });

  it("depends only on values page.js already had above the call site", () => {
    // `chat` and `currentUser` must both be declared BEFORE this call, or the
    // hook reads a TDZ binding at render time. This is the one ordering
    // constraint the extraction actually introduces.
    expect(at("const chat = useChat({")).toBeLessThan(at("useMaterialsLocker({"));
    expect(at("const [currentUser, setCurrentUser]")).toBeLessThan(at("useMaterialsLocker({"));
  });
});

describe("nothing was lost on the way out", () => {
  const union = [PAGE, HOOK].join("\n");
  const mustSurvive = [
    // Why signed-out users get an in-memory locker rather than an error.
    "in-memory for the session",
    // Why remote files are fetched before being handed to the chat pipeline.
    "we fetch the bytes from Storage first",
  ];
  for (const fragment of mustSurvive) {
    it(`still explains: ${fragment}`, () => {
      expect(union).toContain(fragment);
    });
  }
});
