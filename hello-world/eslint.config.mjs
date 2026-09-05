import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  // Guard: in the MUI version this app pins, flex props passed as JSX attributes on
  // Stack/Box/etc. are IGNORED (they must go inside `sx`). Passing e.g.
  // `<Stack alignItems="center">` silently does nothing — which produced the
  // oversized/mis-positioned Library buttons. Flag it so it can't regress.
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    rules: {
      // eslint-config-next leaves `no-undef` off (it assumes TypeScript does
      // this job, and this project has no tsconfig — see the development-loop
      // note that `tsc --noEmit` is vacuous here). That left a whole class of
      // defect with no gate at all: `usePracticeAnswer.js` shipped on main
      // referencing an undeclared `replayUrl`/`setReplayUrl`, which took
      // practice mode down with a ReferenceError on first render. It passed
      // lint, passed `npm run build` (an undeclared reference is legal syntax,
      // not a compile error), and passed 2816 tests, because vitest runs with
      // `environment: "node"` and no jsdom, so no test in this repo can render
      // a component or a hook. This rule is the only thing that catches it.
      "no-undef": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "JSXOpeningElement[name.name=/^(Stack|Box|Grid|Grid2|Paper|Card|CardContent|CardActions|Container|Toolbar)$/] > JSXAttribute[name.name=/^(justifyContent|alignItems|alignContent|justifyItems|flexWrap|flexDirection|alignSelf|justifySelf)$/]",
          message:
            "Flex props are ignored as JSX attributes on MUI layout components in this MUI version — put them inside sx={{ … }} instead (e.g. sx={{ alignItems: 'center' }}).",
        },
      ],
    },
  },
  // `setApplicationStatusByUser` (lib/supabase/applicationStatusWriter.js) is
  // the USER-INTENT door (AC-2, 3-plan-dataloss.md PART 3/F-11): it carries
  // none of the machine writer's fail-closed allow-list, and is safe only
  // because its caller puts a typed, date-naming confirmation and a tenant
  // filter in front of it. A caller importing it directly gets none of that.
  //
  // CORRECTION to the acceptance criteria's own text: AC-2 states the
  // permitted-importer set as `["app/hooks/useApplicationDialogs.js",
  // "app/page.js"]`. Measured against the tree as it actually landed, that is
  // now wrong: F-1's edit 3 (3-plan-dataloss.md PART 4) deletes
  // `handleToggleApplied`'s un-apply branch from app/page.js under decision
  // R1 — the one call site that would have needed this door — and PART 2's
  // third cross-wave contract confirms page.js supplies only a `confirm`
  // CALLBACK to the hook (`confirm: (message) => window.confirm(message)` at
  // app/page.js:260), never the writer symbol itself. Grepping the tree
  // confirms it: app/page.js imports `writeApplicationStatus`,
  // `loadAppliedOrLaterExternalIds` and `deleteUntrackedApplication` from
  // this same module (`app/page.js:84-87`), but never
  // `setApplicationStatusByUser`. Exempting app/page.js anyway would silently
  // widen the door R1 deliberately closed — if a future change reintroduced a
  // direct call there, an exemption written to match a stale AC number would
  // let it back in unlinted. The set enforced below, and asserted by
  // `lib/applications/userDoorImporters.test.js`, is the MEASURED one:
  // `["app/hooks/useApplicationDialogs.js"]`. Reported as a finding in the
  // wave-4 report, not silently "corrected" in the AC document itself.
  //
  // Scope note: `ignores` below also names the writer module's OWN unit
  // tests — lib/supabase/applicationStatusWriter.test.js and
  // lib/supabase/applicationStatusGuardWalk.test.js — which import
  // `setApplicationStatusByUser` directly, by alias, to exercise it as a
  // whitebox unit under test; that is not the AC-2 boundary this rule
  // enforces (a PRODUCTION caller bypassing the door's two sanctioned
  // entry points). Deliberately NOT a blanket `**/*.test.js` exemption: that
  // would also exempt `lib/applications/statusVocabularySweep.test.js`, the
  // very file this rule's own required positive control (F-11, [R2-5])
  // plants a temporary violation in — a blanket test-file exemption would
  // make that control permanently unable to fire.
  //
  // TWO entries are required, not one: `paths` matches the `@/…` alias form
  // exactly, `patterns` glob-matches the relative form (`./…`, `../…`,
  // `../../lib/supabase/…`, any depth) that 25 of the imports under `app/`
  // use — including, today, both exempted files' own style. Skipping either
  // form leaves half the codebase's import style unchecked. The two
  // `patterns` globs are anchored on a literal leading "." or ".." segment
  // specifically so they do NOT also match the alias form — an unanchored
  // `**/supabase/applicationStatusWriter.js` matches BOTH the alias and
  // relative specifiers, which double-reports every alias-form violation
  // (one error from `paths`, a second from `patterns`) and was caught by this
  // rule's own required positive control (see the plan's F-11, [R2-5]).
  //
  // Known limits, not covered by this rule (the wave-4 static sweep in
  // lib/applications/userDoorImporters.test.js covers the source-text shapes
  // it can, but neither this rule nor that sweep can see everything):
  // `import * as ns from "…/applicationStatusWriter"` (a namespace import,
  // which this rule does not inspect for member access) and a dynamic
  // `import("…/applicationStatusWriter")` (an expression, not a static
  // specifier this rule's `paths`/`patterns` match against).
  {
    files: ["**/*.{js,jsx}"],
    ignores: [
      "app/hooks/useApplicationDialogs.js",
      "lib/supabase/applicationStatusWriter.test.js",
      "lib/supabase/applicationStatusGuardWalk.test.js",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/supabase/applicationStatusWriter.js",
              importNames: ["setApplicationStatusByUser"],
              message:
                "setApplicationStatusByUser is the user-intent door (AC-2) and is reachable only from app/hooks/useApplicationDialogs.js — everywhere else, use upsertApplication or writeApplicationStatus instead.",
            },
            {
              name: "@/lib/supabase/applicationStatusWriter",
              importNames: ["setApplicationStatusByUser"],
              message:
                "setApplicationStatusByUser is the user-intent door (AC-2) and is reachable only from app/hooks/useApplicationDialogs.js — everywhere else, use upsertApplication or writeApplicationStatus instead.",
            },
          ],
          patterns: [
            {
              // Anchored on a literal "." / ".." first segment (never a bare
              // "**", which would also swallow the "@" of the alias form —
              // see the note above). "**" here absorbs any number of
              // additional ".." segments, so this matches "./x", "../x",
              // "../../lib/supabase/x", etc. regardless of the importing
              // file's depth.
              group: [
                "./**/applicationStatusWriter",
                "./**/applicationStatusWriter.js",
                "../**/applicationStatusWriter",
                "../**/applicationStatusWriter.js",
              ],
              importNames: ["setApplicationStatusByUser"],
              message:
                "setApplicationStatusByUser is the user-intent door (AC-2) and is reachable only from app/hooks/useApplicationDialogs.js — everywhere else, use upsertApplication or writeApplicationStatus instead.",
            },
          ],
        },
      ],
    },
  },
  // eslint-plugin-react-hooks v7 (pulled in by eslint-config-next's
  // core-web-vitals preset) ships the React Compiler's component-purity
  // rules, which assume every capitalized function is production render
  // code. jsdom hook-test harnesses in this repo (the pattern established by
  // app/copilot/useCopilotDashboard.wiring.test.js) use a small `Probe`
  // component purely to call a hook under `act()` and, when the test needs
  // to inspect what the hook returned between actions, assign that return
  // value to an outer-scope variable so assertions can read it. That's
  // exactly what react-hooks/globals exists to catch in real components, but
  // it's the intended shape of this test-only pattern, not a bug -- scoped
  // to test files so the rule stays fully active for actual app code.
  {
    files: ["**/*.test.js"],
    rules: {
      "react-hooks/globals": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated (never committed -- see .gitignore) MediaPipe wasm runtime,
    // staged here at build/dev time by scripts/copy-mediapipe.mjs from the
    // installed @mediapipe/tasks-vision package -- third-party vendor JS,
    // not this app's source, same reasoning as the .next/** build output
    // above.
    "public/mediapipe/wasm/**",
  ]),
]);

export default eslintConfig;
